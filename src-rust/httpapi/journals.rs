use super::common::{AppError, AppState};
use crate::domain::{self, AmountedLine, LineInput};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use std::collections::HashSet;

pub async fn next_voucher_handler(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let year_month = chrono::Local::now().format("%Y%m").to_string();
    let conn = state.db.lock();
    let voucher_no = next_voucher(&conn, state.config.company_id, &year_month)?;
    Ok(Json(json!({ "voucherNo": voucher_no })))
}

pub fn next_voucher(conn: &Connection, company_id: i64, year_month: &str) -> Result<String, AppError> {
    let prefix = format!("JRN-{}-", year_month);
    let pattern = format!("{}%", prefix);

    let last_voucher: Option<String> = conn
        .query_row(
            "SELECT voucher_no FROM journal_entries WHERE company_id = ?1 AND voucher_no LIKE ?2 ORDER BY id DESC LIMIT 1",
            params![company_id, pattern],
            |row| row.get(0),
        )
        .optional()?;

    let mut sequence = 1;
    if let Some(voucher) = last_voucher {
        if let Some(pos) = voucher.rfind('-') {
            if let Ok(num) = voucher[pos + 1..].parse::<i32>() {
                sequence = num + 1;
            }
        }
    }

    Ok(format!("{}{:03}", prefix, sequence))
}

pub struct WriteEntryParams {
    pub user_id: i64,
    pub voucher_no: String,
    pub entry_date: String,
    pub description: String,
    pub source: String,
    pub status: String,
    pub lines: Vec<AmountedLine>,
    pub import_batch_id: Option<i64>,
    pub reversal_of_id: Option<i64>,
}

pub fn write_entry(
    tx: &Transaction,
    company_id: i64,
    operator_id: i64,
    params: WriteEntryParams,
) -> Result<i64, AppError> {
    let date_regex = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap();
    if !date_regex.is_match(&params.entry_date) {
        return Err(AppError::bad_request("Tanggal jurnal tidak valid."));
    }

    let balanced = domain::assert_balanced(&params.lines)?;

    let period_id: i64 = {
        let period: Option<(i64, String)> = tx
            .query_row(
                "SELECT id, status FROM accounting_periods WHERE company_id = ?1 AND ?2 BETWEEN start_date AND end_date LIMIT 1",
                params![company_id, params.entry_date],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;

        match period {
            None => return Err(AppError::bad_request("Tanggal transaksi belum memiliki periode akuntansi.")),
            Some((_, status)) if status != "OPEN" => {
                return Err(AppError::bad_request("Periode transaksi telah ditutup dan dikunci."));
            }
            Some((id, _)) => id,
        }
    };

    // Validasi akun aktif
    let mut account_ids: HashSet<i64> = HashSet::new();
    for line in &balanced {
        account_ids.insert(line.account_id);
    }
    for acc_id in &account_ids {
        let is_active: Option<i32> = tx
            .query_row(
                "SELECT is_active FROM accounts WHERE id = ?1 AND company_id = ?2",
                params![acc_id, company_id],
                |r| r.get(0),
            )
            .optional()?;

        match is_active {
            Some(1) => (),
            _ => return Err(AppError::bad_request("Satu atau beberapa akun tidak aktif atau tidak ditemukan.")),
        }
    }

    let source = if params.source.is_empty() { "MANUAL" } else { &params.source };
    let status = if params.status.is_empty() { "DRAFT" } else { &params.status };

    let (posted_by, posted_at) = if status == "POSTED" {
        (Some(params.user_id), Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()))
    } else {
        (None, None)
    };

    tx.execute(
        "INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, import_batch_id, reversal_of_id, created_by, posted_by, posted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            company_id,
            period_id,
            params.voucher_no,
            params.entry_date,
            params.description,
            source,
            status,
            params.import_batch_id,
            params.reversal_of_id,
            params.user_id,
            posted_by,
            posted_at
        ],
    )?;

    let entry_id = tx.last_insert_rowid();

    for (index, line) in balanced.iter().enumerate() {
        tx.execute(
            "INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                entry_id,
                line.account_id,
                (index + 1) as i32,
                line.memo,
                line.debit,
                line.credit
            ],
        )?;
    }

    let action = if status == "POSTED" { "POSTED" } else { "CREATED" };
    let details = json!({ "source": source, "voucherNo": params.voucher_no });
    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'JOURNAL_ENTRY', ?3, ?4, ?5)",
        params![company_id, operator_id, entry_id, action, details.to_string()],
    )?;

    Ok(entry_id)
}

pub async fn post_journal(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let mut voucher_no = body["voucherNo"].as_str().unwrap_or("").trim().to_string();
    let entry_date = body["entryDate"].as_str().unwrap_or("").trim().to_string();
    let description = body["description"].as_str().unwrap_or("").trim().to_string();
    let mut status = body["status"].as_str().unwrap_or("DRAFT").trim().to_string();
    if status.is_empty() {
        status = "DRAFT".to_string();
    }

    if description.is_empty() || entry_date.is_empty() || (status != "DRAFT" && status != "POSTED") {
        return Err(AppError::bad_request("Tanggal, keterangan, dan status jurnal tidak valid."));
    }

    let raw_lines = body["lines"].as_array().ok_or_else(|| {
        AppError::bad_request("Jurnal harus memiliki sedikitnya dua baris.")
    })?;

    let line_inputs: Vec<LineInput> = serde_json::from_value(Value::Array(raw_lines.clone()))
        .map_err(|e| AppError::bad_request(e.to_string()))?;

    let normalized = domain::normalize_and_assert(&line_inputs)?;

    let mut conn = state.db.lock();

    if voucher_no.is_empty() {
        if entry_date.len() >= 7 {
            let ym = entry_date[..7].replace('-', "");
            voucher_no = next_voucher(&conn, state.config.company_id, &ym)?;
        }
        if voucher_no.is_empty() {
            return Err(AppError::bad_request("Tanggal jurnal tidak valid."));
        }
    }

    let tx = conn.transaction()?;
    let id = write_entry(
        &tx,
        state.config.company_id,
        state.operator_id,
        WriteEntryParams {
            user_id: state.operator_id,
            voucher_no: voucher_no.clone(),
            entry_date,
            description,
            source: "MANUAL".to_string(),
            status,
            lines: normalized,
            import_batch_id: None,
            reversal_of_id: None,
        },
    )?;
    tx.commit()?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": id, "voucherNo": voucher_no })),
    ))
}

pub async fn get_journal(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    let entry = fetch_entry(&conn, state.config.company_id, id)?;
    Ok(Json(json!({ "entry": entry })))
}

pub fn fetch_entry(conn: &Connection, company_id: i64, id: i64) -> Result<Value, AppError> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.company_id, e.period_id, e.voucher_no, e.entry_date, e.description,
                e.source, e.status, e.import_batch_id, e.reversal_of_id, e.created_by,
                e.posted_by, e.posted_at, e.created_at, e.updated_at, u.name AS created_by_name
         FROM journal_entries e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE e.id = ?1 AND e.company_id = ?2",
    )?;

    let mut entry = stmt
        .query_row(params![id, company_id], |row| {
            Ok(json!({
                "id": row.get::<_, i64>("id")?,
                "company_id": row.get::<_, i64>("company_id")?,
                "period_id": row.get::<_, i64>("period_id")?,
                "voucher_no": row.get::<_, String>("voucher_no")?,
                "entry_date": row.get::<_, String>("entry_date")?,
                "description": row.get::<_, String>("description")?,
                "source": row.get::<_, String>("source")?,
                "status": row.get::<_, String>("status")?,
                "import_batch_id": row.get::<_, Option<i64>>("import_batch_id")?,
                "reversal_of_id": row.get::<_, Option<i64>>("reversal_of_id")?,
                "created_by": row.get::<_, i64>("created_by")?,
                "posted_by": row.get::<_, Option<i64>>("posted_by")?,
                "posted_at": row.get::<_, Option<String>>("posted_at")?,
                "created_at": row.get::<_, String>("created_at")?,
                "updated_at": row.get::<_, String>("updated_at")?,
                "created_by_name": row.get::<_, Option<String>>("created_by_name")?,
            }))
        })
        .optional()?
        .ok_or_else(|| AppError::not_found("Jurnal tidak ditemukan."))?;

    let mut line_stmt = conn.prepare(
        "SELECT l.id, l.journal_entry_id, l.account_id, l.line_no, l.memo, l.debit, l.credit,
                a.code, a.name AS account_name
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
         WHERE l.journal_entry_id = ?1 ORDER BY l.line_no",
    )?;

    let lines = line_stmt
        .query_map(params![id], |row| {
            Ok(json!({
                "id": row.get::<_, i64>("id")?,
                "journal_entry_id": row.get::<_, i64>("journal_entry_id")?,
                "account_id": row.get::<_, i64>("account_id")?,
                "line_no": row.get::<_, i32>("line_no")?,
                "memo": row.get::<_, Option<String>>("memo")?,
                "debit": row.get::<_, f64>("debit")?,
                "credit": row.get::<_, f64>("credit")?,
                "code": row.get::<_, String>("code")?,
                "account_name": row.get::<_, String>("account_name")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    if let Some(obj) = entry.as_object_mut() {
        obj.insert("lines".to_string(), Value::Array(lines));
    }

    Ok(entry)
}

pub async fn put_journal(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let voucher_no = body["voucherNo"].as_str().unwrap_or("").trim().to_string();
    let entry_date = body["entryDate"].as_str().unwrap_or("").trim().to_string();
    let description = body["description"].as_str().unwrap_or("").trim().to_string();

    let raw_lines = body["lines"].as_array().ok_or_else(|| {
        AppError::bad_request("Jurnal harus memiliki sedikitnya dua baris.")
    })?;

    let line_inputs: Vec<LineInput> = serde_json::from_value(Value::Array(raw_lines.clone()))
        .map_err(|e| AppError::bad_request(e.to_string()))?;

    let normalized = domain::normalize_and_assert(&line_inputs)?;

    let mut conn = state.db.lock();
    let tx = conn.transaction()?;

    let entry = fetch_entry(&tx, state.config.company_id, id)?;
    if entry["status"].as_str() != Some("DRAFT") {
        return Err(AppError::bad_request("Hanya jurnal draft yang dapat diubah."));
    }

    let period_id: i64 = {
        let period: Option<(i64, String)> = tx
            .query_row(
                "SELECT id, status FROM accounting_periods WHERE company_id = ?1 AND ?2 BETWEEN start_date AND end_date LIMIT 1",
                params![state.config.company_id, entry_date],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;

        match period {
            None => return Err(AppError::bad_request("Tanggal transaksi belum memiliki periode akuntansi.")),
            Some((_, status)) if status != "OPEN" => {
                return Err(AppError::bad_request("Periode transaksi telah ditutup dan dikunci."));
            }
            Some((p_id, _)) => p_id,
        }
    };

    tx.execute(
        "UPDATE journal_entries SET voucher_no = ?1, entry_date = ?2, period_id = ?3, description = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?5",
        params![voucher_no, entry_date, period_id, description, id],
    )?;

    tx.execute("DELETE FROM journal_lines WHERE journal_entry_id = ?1", params![id])?;

    for (index, line) in normalized.iter().enumerate() {
        tx.execute(
            "INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, line.account_id, (index + 1) as i32, line.memo, line.debit, line.credit],
        )?;
    }

    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'JOURNAL_ENTRY', ?3, 'UPDATED', NULL)",
        params![state.config.company_id, state.operator_id, id],
    )?;

    tx.commit()?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn post_journal_flag(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let mut conn = state.db.lock();
    let tx = conn.transaction()?;

    let entry = fetch_entry(&tx, state.config.company_id, id)?;
    if entry["status"].as_str() != Some("DRAFT") {
        return Err(AppError::bad_request("Jurnal ini sudah diposting."));
    }

    let entry_date = entry["entry_date"].as_str().unwrap_or("");
    let is_open: Option<String> = tx
        .query_row(
            "SELECT status FROM accounting_periods WHERE company_id = ?1 AND ?2 BETWEEN start_date AND end_date LIMIT 1",
            params![state.config.company_id, entry_date],
            |r| r.get(0),
        )
        .optional()?;

    if is_open.as_deref() != Some("OPEN") {
        return Err(AppError::bad_request("Periode transaksi telah ditutup dan dikunci."));
    }

    tx.execute(
        "UPDATE journal_entries SET status = 'POSTED', posted_by = ?1, posted_at = datetime('now', 'localtime') WHERE id = ?2",
        params![state.operator_id, id],
    )?;

    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'JOURNAL_ENTRY', ?3, 'POSTED', NULL)",
        params![state.config.company_id, state.operator_id, id],
    )?;

    tx.commit()?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_journal(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let mut conn = state.db.lock();
    let tx = conn.transaction()?;

    let entry = fetch_entry(&tx, state.config.company_id, id)?;
    let voucher_no = entry["voucher_no"].as_str().unwrap_or("");
    if entry["status"].as_str() != Some("DRAFT") {
        return Err(AppError::bad_request(format!(
            "Jurnal {} sudah diposting sehingga tidak dapat dihapus tanpa menghapus jejak audit. Gunakan Jurnal Pembalik.",
            voucher_no
        )));
    }
    if entry["source"].as_str() != Some("MANUAL") {
        return Err(AppError::bad_request(
            "Jurnal hasil impor, penutup, atau pembalik tidak dapat dihapus. Buat jurnal koreksi manual.",
        ));
    }

    tx.execute("DELETE FROM journal_lines WHERE journal_entry_id = ?1", params![id])?;
    tx.execute("DELETE FROM journal_entries WHERE id = ?1", params![id])?;

    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'JOURNAL_ENTRY', ?3, 'DELETED', NULL)",
        params![state.config.company_id, state.operator_id, id],
    )?;

    tx.commit()?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn reverse_journal(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let mut conn = state.db.lock();
    let tx = conn.transaction()?;

    let original = fetch_entry(&tx, state.config.company_id, id)?;
    if original["status"].as_str() != Some("POSTED") {
        return Err(AppError::bad_request("Hanya jurnal terposting yang dapat dibalik."));
    }

    let existing: Option<i64> = tx
        .query_row(
            "SELECT id FROM journal_entries WHERE company_id = ?1 AND reversal_of_id = ?2 LIMIT 1",
            params![state.config.company_id, id],
            |r| r.get(0),
        )
        .optional()?;

    let original_voucher = original["voucher_no"].as_str().unwrap_or("");
    if existing.is_some() {
        return Err(AppError::bad_request(format!(
            "Jurnal {} sudah memiliki pembalik dan tidak dapat dibalik dua kali.",
            original_voucher
        )));
    }

    let lines = original["lines"].as_array().unwrap();
    let mut mirrored = Vec::new();
    for l in lines {
        mirrored.push(AmountedLine {
            account_id: l["account_id"].as_i64().unwrap(),
            line_no: l["line_no"].as_i64().unwrap() as i32,
            debit: l["credit"].as_f64().unwrap(),
            credit: l["debit"].as_f64().unwrap(),
            memo: l["memo"].as_str().map(|s| s.to_string()),
            ..Default::default()
        });
    }

    let voucher_no = body["voucherNo"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("REV-{}", original_voucher));

    let entry_date = body["entryDate"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(|s| domain::date_text(s))
        .unwrap_or_else(|| domain::date_text(original["entry_date"].as_str().unwrap()));

    let original_desc = original["description"].as_str().unwrap_or("");
    let description = format!("Pembalik: {}", original_desc);

    let reversal_id = write_entry(
        &tx,
        state.config.company_id,
        state.operator_id,
        WriteEntryParams {
            user_id: state.operator_id,
            voucher_no,
            entry_date,
            description,
            source: "REVERSAL".to_string(),
            status: "POSTED".to_string(),
            lines: mirrored,
            import_batch_id: None,
            reversal_of_id: Some(id),
        },
    )?;

    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'JOURNAL_ENTRY', ?3, 'REVERSED', ?4)",
        params![
            state.config.company_id,
            state.operator_id,
            id,
            json!({ "reversalEntryId": reversal_id }).to_string()
        ],
    )?;

    tx.commit()?;
    Ok((StatusCode::CREATED, Json(json!({ "id": reversal_id }))))
}

pub async fn journal_audit(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT a.id, a.company_id, a.user_id, a.entity_type, a.entity_id, a.action, a.details_json, a.created_at,
                u.name AS user_name
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.company_id = ?1 AND a.entity_type = 'JOURNAL_ENTRY' AND a.entity_id = ?2
         ORDER BY a.created_at DESC",
    )?;

    let logs = stmt
        .query_map(params![state.config.company_id, id], |row| {
            let action: String = row.get("action")?;
            let label = match action.as_str() {
                "CREATED" => "Jurnal dibuat",
                "POSTED" => "Jurnal diposting",
                "UPDATED" => "Jurnal diubah",
                "REVERSED" => "Jurnal dibalikkan",
                "DELETED" => "Jurnal dihapus",
                _ => &action,
            };

            let details_str: Option<String> = row.get("details_json")?;
            let details: Option<Value> = details_str.and_then(|s| serde_json::from_str(&s).ok());

            Ok(json!({
                "id": row.get::<_, i64>("id")?,
                "company_id": row.get::<_, i64>("company_id")?,
                "user_id": row.get::<_, Option<i64>>("user_id")?,
                "user_name": row.get::<_, Option<String>>("user_name")?,
                "entity_type": row.get::<_, String>("entity_type")?,
                "entity_id": row.get::<_, Option<i64>>("entity_id")?,
                "action": action,
                "action_label": label,
                "details": details,
                "created_at": row.get::<_, String>("created_at")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(json!({ "logs": logs })))
}
