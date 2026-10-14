use super::common::{AppError, AppState};
use super::journals::{write_entry, WriteEntryParams};
use crate::domain::{self, AmountedLine};
use crate::export::xlsx::journal_template;
use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::header,
    response::Response,
    Json,
};
use calamine::{Data, Reader, Xlsx};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Cursor;

pub async fn import_template_handler() -> Result<Response, AppError> {
    let bytes = journal_template().map_err(|e| AppError::internal(e.to_string()))?;
    let response = Response::builder()
        .header(header::CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header(header::CONTENT_DISPOSITION, "attachment; filename=\"template-jurnal-finova.xlsx\"")
        .body(Body::from(bytes))
        .map_err(|e| AppError::internal(e.to_string()))?;
    Ok(response)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportLine {
    pub account_id: i64,
    pub debit: f64,
    pub credit: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportEntry {
    #[serde(rename = "voucherNo")]
    pub voucher_no: String,
    #[serde(rename = "entryDate")]
    pub entry_date: String,
    pub description: String,
    pub lines: Vec<ImportLine>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportError {
    pub line: Value,
    pub message: String,
}

pub async fn import_preview(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name = "jurnal.xlsx".to_string();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        if field.name() == Some("file") {
            if let Some(name) = field.file_name() {
                file_name = name.to_string();
            }
            let bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::bad_request(e.to_string()))?;
            file_data = Some(bytes.to_vec());
            break;
        }
    }

    let data = file_data.ok_or_else(|| AppError::bad_request("Berkas Excel wajib diunggah."))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash_hex = hex::encode(hasher.finalize());

    let conn = state.db.lock();
    let parsed = parse_import_data(&conn, state.config.company_id, &data)?;

    let status = if parsed.errors.is_empty() {
        "PREVIEW"
    } else {
        "REJECTED"
    };

    let payload_json = serde_json::to_string(&parsed.entries).unwrap();
    let errors_json = serde_json::to_string(&parsed.errors).unwrap();

    conn.execute(
        "INSERT INTO import_batches (company_id, uploaded_by, original_filename, content_hash, status, total_rows, valid_entries, payload_json, errors_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            state.config.company_id,
            state.operator_id,
            file_name,
            hash_hex,
            status,
            parsed.total_rows as i64,
            parsed.entries.len() as i64,
            payload_json,
            errors_json,
        ],
    )?;

    let batch_id = conn.last_insert_rowid();

    let _ = state.db.audit(
        state.config.company_id,
        state.operator_id,
        "IMPORT_BATCH",
        Some(batch_id),
        if status == "PREVIEW" { "PREVIEWED" } else { "REJECTED" },
        Some(&json!({
            "totalRows": parsed.total_rows,
            "errors": parsed.errors.len(),
        })),
    );

    let summaries: Vec<Value> = parsed
        .entries
        .iter()
        .map(|e| {
            json!({
                "voucherNo": e.voucher_no,
                "entryDate": e.entry_date,
                "description": e.description,
                "lineCount": e.lines.len()
            })
        })
        .collect();

    Ok(Json(json!({
        "batchId": batch_id,
        "valid": parsed.errors.is_empty(),
        "totalRows": parsed.total_rows,
        "entries": summaries,
        "errors": parsed.errors,
    })))
}

pub struct ParsedImport {
    pub total_rows: usize,
    pub entries: Vec<ImportEntry>,
    pub errors: Vec<ImportError>,
}

fn parse_import_data(conn: &Connection, company_id: i64, data: &[u8]) -> Result<ParsedImport, AppError> {
    let cursor = Cursor::new(data);
    let mut excel: Xlsx<_> = calamine::open_workbook_from_rs(cursor)
        .map_err(|e| AppError::bad_request(format!("Berkas Excel tidak valid: {}", e)))?;

    let sheet_name = excel
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| AppError::bad_request("Lembar kerja kosong."))?;

    let range = excel
        .worksheet_range(&sheet_name)
        .map_err(|e| AppError::bad_request(format!("Gagal membaca lembar: {}", e)))?;

    let mut rows_iter = range.rows();
    let header_row = rows_iter
        .next()
        .ok_or_else(|| AppError::bad_request("Format spreadsheet tidak memiliki judul kolom."))?;

    let mut col_map: HashMap<String, usize> = HashMap::new();
    for (i, cell) in header_row.iter().enumerate() {
        let name = cell.to_string().trim().to_lowercase().replace(' ', "");
        col_map.insert(name, i);
    }

    let get_col = |name: &str| -> Option<usize> {
        let key = name.to_lowercase().replace(' ', "");
        col_map.get(&key).copied()
    };

    let col_voucher = get_col("nobukti").ok_or_else(|| AppError::bad_request("Kolom NoBukti tidak ditemukan."))?;
    let col_date = get_col("tanggal").ok_or_else(|| AppError::bad_request("Kolom Tanggal tidak ditemukan."))?;
    let col_code = get_col("kodeakun").ok_or_else(|| AppError::bad_request("Kolom KodeAkun tidak ditemukan."))?;
    let col_debit = get_col("debit").ok_or_else(|| AppError::bad_request("Kolom Debit tidak ditemukan."))?;
    let col_credit = get_col("kredit").ok_or_else(|| AppError::bad_request("Kolom Kredit tidak ditemukan."))?;
    let col_desc = get_col("keterangan");

    // Accounts map
    let mut acc_stmt = conn.prepare("SELECT id, code, is_active FROM accounts WHERE company_id = ?1")?;
    let mut account_by_code: HashMap<String, (i64, bool)> = HashMap::new();
    let rows = acc_stmt.query_map(params![company_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i32>(2)? != 0))
    })?;
    for item in rows {
        let (id, code, is_active) = item?;
        account_by_code.insert(code, (id, is_active));
    }

    struct Grouped {
        voucher: String,
        entry_date: String,
        description: String,
        lines: Vec<ImportLine>,
        row_numbers: Vec<usize>,
    }

    let mut grouped: HashMap<String, Grouped> = HashMap::new();
    let mut order = Vec::new();
    let mut errors: Vec<ImportError> = Vec::new();
    let mut total_rows = 0;

    for (row_idx, row) in rows_iter.enumerate() {
        let line_num = row_idx + 2;
        total_rows += 1;

        let voucher = row.get(col_voucher).map(clean_cell_str).unwrap_or_default();
        let raw_date = row.get(col_date).map(clean_cell_str).unwrap_or_default();
        let entry_date = parse_excel_date(&raw_date);
        let code = row.get(col_code).map(clean_cell_str).unwrap_or_default();
        let debit = row.get(col_debit).and_then(clean_cell_num).unwrap_or(0.0);
        let credit = row.get(col_credit).and_then(clean_cell_num).unwrap_or(0.0);
        let desc = col_desc
            .and_then(|c| row.get(c))
            .map(clean_cell_str)
            .unwrap_or_default();

        if voucher.is_empty() {
            errors.push(ImportError {
                line: json!(line_num),
                message: "NoBukti wajib diisi.".to_string(),
            });
        }
        if entry_date.is_empty() {
            errors.push(ImportError {
                line: json!(line_num),
                message: "Tanggal harus memakai format YYYY-MM-DD atau DD/MM/YYYY.".to_string(),
            });
        }

        let acc_opt = account_by_code.get(&code);
        match acc_opt {
            Some((_, true)) => (),
            _ => {
                errors.push(ImportError {
                    line: json!(line_num),
                    message: format!(
                        "Kode akun {} tidak aktif atau tidak ditemukan.",
                        if code.is_empty() { "(kosong)" } else { &code }
                    ),
                });
            }
        }

        let debit_val = domain::round_money(debit);
        let credit_val = domain::round_money(credit);

        if (debit_val > 0.0 && credit_val > 0.0)
            || (debit_val == 0.0 && credit_val == 0.0)
            || debit_val < 0.0
            || credit_val < 0.0
        {
            errors.push(ImportError {
                line: json!(line_num),
                message: "Isi tepat salah satu nominal Debit atau Kredit.".to_string(),
            });
        }

        if voucher.is_empty() || entry_date.is_empty() || acc_opt.is_none() {
            continue;
        }

        let acc_id = acc_opt.unwrap().0;
        let line = ImportLine {
            account_id: acc_id,
            debit: debit_val,
            credit: credit_val,
        };

        if let Some(existing) = grouped.get_mut(&voucher) {
            if existing.entry_date != entry_date {
                errors.push(ImportError {
                    line: json!(line_num),
                    message: format!("NoBukti {} memiliki tanggal yang berbeda.", voucher),
                });
            }
            existing.lines.push(line);
            existing.row_numbers.push(line_num);
        } else {
            order.push(voucher.clone());
            grouped.insert(
                voucher.clone(),
                Grouped {
                    voucher: voucher.clone(),
                    entry_date,
                    description: if desc.is_empty() { format!("Impor {}", voucher) } else { desc },
                    lines: vec![line],
                    row_numbers: vec![line_num],
                },
            );
        }
    }

    let mut entries = Vec::new();
    for v in &order {
        let g = grouped.get_mut(v).unwrap();
        let amounted: Vec<AmountedLine> = g
            .lines
            .iter()
            .map(|l| AmountedLine {
                account_id: l.account_id,
                debit: l.debit,
                credit: l.credit,
                ..Default::default()
            })
            .collect();

        if let Err(e) = domain::assert_balanced(&amounted) {
            errors.push(ImportError {
                line: json!(g.row_numbers.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(", ")),
                message: format!("{}: {}", v, e),
            });
        }

        // Check period open
        let is_open: Option<String> = conn
            .query_row(
                "SELECT status FROM accounting_periods WHERE company_id = ?1 AND ?2 BETWEEN start_date AND end_date LIMIT 1",
                params![company_id, g.entry_date],
                |r| r.get(0),
            )
            .ok();

        if is_open.as_deref() != Some("OPEN") {
            errors.push(ImportError {
                line: json!(g.row_numbers.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(", ")),
                message: format!("{}: Periode transaksi telah ditutup atau belum tersedia.", v),
            });
        }

        entries.push(ImportEntry {
            voucher_no: g.voucher.clone(),
            entry_date: g.entry_date.clone(),
            description: g.description.clone(),
            lines: g.lines.clone(),
        });
    }

    // Check duplicate voucher numbers
    for v in &order {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM journal_entries WHERE company_id = ?1 AND voucher_no = ?2)",
                params![company_id, v],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if exists {
            errors.push(ImportError {
                line: json!(""),
                message: format!("NoBukti {} sudah pernah digunakan.", v),
            });
        }
    }

    Ok(ParsedImport {
        total_rows,
        entries,
        errors,
    })
}

fn clean_cell_str(dt: &Data) -> String {
    match dt {
        Data::String(s) => s.trim().to_string(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 {
                (*f as i64).to_string()
            } else {
                f.to_string()
            }
        }
        _ => String::new(),
    }
}

fn clean_cell_num(dt: &Data) -> Option<f64> {
    match dt {
        Data::Float(f) => Some(*f),
        Data::Int(i) => Some(*i as f64),
        Data::String(s) => s.trim().replace(',', "").parse::<f64>().ok(),
        _ => None,
    }
}

fn parse_excel_date(text: &str) -> String {
    let t = text.trim();
    if t.is_empty() {
        return String::new();
    }

    // Cek jika serial number Excel
    if let Ok(serial) = t.parse::<f64>() {
        let days = serial as i64;
        let base = chrono::NaiveDate::from_ymd_opt(1899, 12, 30).unwrap();
        if let Some(date) = base.checked_add_signed(chrono::Duration::days(days)) {
            return date.format("%Y-%m-%d").to_string();
        }
    }

    let re_iso = regex::Regex::new(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$").unwrap();
    if let Some(caps) = re_iso.captures(t) {
        let y = caps[1].parse::<i32>().unwrap();
        let m = caps[2].parse::<u32>().unwrap();
        let d = caps[3].parse::<u32>().unwrap();
        if let Some(date) = chrono::NaiveDate::from_ymd_opt(y, m, d) {
            return date.format("%Y-%m-%d").to_string();
        }
    }

    let re_id = regex::Regex::new(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$").unwrap();
    if let Some(caps) = re_id.captures(t) {
        let d = caps[1].parse::<u32>().unwrap();
        let m = caps[2].parse::<u32>().unwrap();
        let y = caps[3].parse::<i32>().unwrap();
        if let Some(date) = chrono::NaiveDate::from_ymd_opt(y, m, d) {
            return date.format("%Y-%m-%d").to_string();
        }
    }

    String::new()
}

pub async fn import_confirm(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let mut conn = state.db.lock();
    let tx = conn.transaction()?;

    let (status, payload_json): (String, String) = tx
        .query_row(
            "SELECT status, payload_json FROM import_batches WHERE id = ?1 AND company_id = ?2",
            params![id, state.config.company_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| AppError::not_found("Batch impor tidak ditemukan."))?;

    if status != "PREVIEW" {
        return Err(AppError::bad_request("Batch ini tidak siap dikonfirmasi."));
    }

    let entries: Vec<ImportEntry> = serde_json::from_str(&payload_json)
        .map_err(|_| AppError::bad_request("Isi batch impor tidak dapat dibaca."))?;

    for entry in &entries {
        let lines: Vec<AmountedLine> = entry
            .lines
            .iter()
            .map(|l| AmountedLine {
                account_id: l.account_id,
                debit: l.debit,
                credit: l.credit,
                ..Default::default()
            })
            .collect();

        write_entry(
            &tx,
            state.config.company_id,
            state.operator_id,
            WriteEntryParams {
                user_id: state.operator_id,
                voucher_no: entry.voucher_no.clone(),
                entry_date: entry.entry_date.clone(),
                description: entry.description.clone(),
                source: "IMPORT".to_string(),
                status: "POSTED".to_string(),
                lines,
                import_batch_id: Some(id),
                reversal_of_id: None,
            },
        )?;
    }

    tx.execute(
        "UPDATE import_batches SET status = 'POSTED', posted_at = datetime('now', 'localtime') WHERE id = ?1",
        params![id],
    )?;

    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'IMPORT_BATCH', ?3, 'POSTED', ?4)",
        params![
            state.config.company_id,
            state.operator_id,
            id,
            json!({ "entries": entries.len() }).to_string()
        ],
    )?;

    let posted_count = entries.len();
    tx.commit()?;

    Ok(Json(json!({ "ok": true, "posted": posted_count })))
}
