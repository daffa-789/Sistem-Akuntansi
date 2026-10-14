use super::common::{AppError, AppState};
use super::journals::{write_entry, WriteEntryParams};
use crate::domain::{self, Account, AmountedLine, Entry, Line};
use axum::{
    extract::{Path, Query, State},
    Json,
};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct ReportQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(rename = "accountId")]
    pub account_id: Option<i64>,
}

pub struct ReportContext {
    pub company: Value,
    pub accounts: Vec<Value>,
    pub typed_accounts: Vec<Account>,
    pub all_entries: Vec<Entry>,
    pub period_entries: Vec<Entry>,
}

pub fn get_report_context(
    conn: &Connection,
    company_id: i64,
    from: &str,
    to: &str,
    include_drafts: bool,
) -> Result<ReportContext, AppError> {
    let company: Value = conn.query_row(
        "SELECT id, name, address, phone, email, currency FROM companies WHERE id = ?1",
        params![company_id],
        |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "name": r.get::<_, String>(1)?,
                "address": r.get::<_, Option<String>>(2)?,
                "phone": r.get::<_, Option<String>>(3)?,
                "email": r.get::<_, Option<String>>(4)?,
                "currency": r.get::<_, String>(5)?,
            }))
        },
    )?;

    let mut acc_stmt = conn.prepare(
        "SELECT id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account, is_active
         FROM accounts WHERE company_id = ?1 ORDER BY code",
    )?;

    let mut accounts = Vec::new();
    let mut typed_accounts = Vec::new();

    let acc_rows = acc_stmt.query_map(params![company_id], |r| {
        let id: i64 = r.get(0)?;
        let code: String = r.get(1)?;
        let name: String = r.get(2)?;
        let group: String = r.get(3)?;
        let subtype: Option<String> = r.get(4)?;
        let mut normal_balance: String = r.get(5)?;
        if normal_balance.is_empty() {
            normal_balance = if group == "ASSET" || group == "EXPENSE" {
                "DEBIT".to_string()
            } else {
                "CREDIT".to_string()
            };
        }
        let cash_flow_category: String = r.get(6)?;
        let is_cash: bool = r.get::<_, i32>(7)? != 0;
        let is_active: bool = r.get::<_, i32>(8)? != 0;

        Ok((
            json!({
                "id": id,
                "code": code,
                "name": name,
                "account_group": group,
                "account_subtype": subtype,
                "normal_balance": normal_balance,
                "cash_flow_category": cash_flow_category,
                "is_cash_account": is_cash,
                "is_active": is_active,
            }),
            Account {
                id,
                code,
                name,
                group,
                subtype,
                normal_balance,
                cash_flow_category,
                is_cash_account: is_cash,
                is_active,
            },
        ))
    })?;

    for item in acc_rows {
        let (val, typed) = item?;
        accounts.push(val);
        typed_accounts.push(typed);
    }

    let status_clause = if include_drafts {
        "e.status IN ('POSTED', 'DRAFT')"
    } else {
        "e.status = 'POSTED'"
    };

    let query_sql = format!(
        "SELECT e.id, e.voucher_no, e.entry_date, e.description, e.source, e.status, e.reversal_of_id,
                EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = e.id) AS reversed,
                l.account_id, l.line_no, l.debit, l.credit, l.memo, a.code, a.name AS account_name
         FROM journal_entries e
         JOIN journal_lines l ON l.journal_entry_id = e.id
         JOIN accounts a ON a.id = l.account_id
         WHERE e.company_id = ?1 AND {} AND e.entry_date <= ?2
         ORDER BY e.entry_date, e.id, l.line_no",
        status_clause
    );

    let mut j_stmt = conn.prepare(&query_sql)?;
    let mut entries_map: HashMap<i64, (Entry, usize)> = HashMap::new();
    let mut ordered_ids = Vec::new();

    let rows = j_stmt.query_map(params![company_id, to], |r| {
        let entry_id: i64 = r.get(0)?;
        let voucher_no: String = r.get(1)?;
        let entry_date: String = domain::date_text(&r.get::<_, String>(2)?);
        let description: String = r.get(3)?;
        let source: String = r.get(4)?;
        let status: String = r.get(5)?;
        let reversal_of_id: Option<i64> = r.get(6)?;
        let reversed: bool = r.get::<_, i64>(7)? != 0;

        let account_id: i64 = r.get(8)?;
        let line_no: i32 = r.get(9)?;
        let debit: f64 = domain::round_money(r.get(10)?);
        let credit: f64 = domain::round_money(r.get(11)?);
        let memo: Option<String> = r.get(12)?;
        let code: Option<String> = r.get(13)?;
        let account_name: Option<String> = r.get(14)?;

        let line = Line {
            account_id,
            line_no,
            debit,
            credit,
            memo,
            code,
            account_name,
        };

        Ok((
            entry_id,
            voucher_no,
            entry_date,
            description,
            source,
            status,
            reversal_of_id,
            reversed,
            line,
        ))
    })?;

    for item in rows {
        let (
            e_id,
            voucher_no,
            entry_date,
            description,
            source,
            status,
            reversal_of_id,
            reversed,
            line,
        ) = item?;

        if let Some((entry, _)) = entries_map.get_mut(&e_id) {
            entry.lines.push(line);
        } else {
            let idx = ordered_ids.len();
            ordered_ids.push(e_id);
            entries_map.insert(
                e_id,
                (
                    Entry {
                        id: e_id,
                        voucher_no,
                        entry_date,
                        description,
                        source,
                        status,
                        reversal_of_id,
                        reversed,
                        lines: vec![line],
                    },
                    idx,
                ),
            );
        }
    }

    let mut all_entries = Vec::with_capacity(ordered_ids.len());
    for id in ordered_ids {
        if let Some((mut entry, _)) = entries_map.remove(&id) {
            entry.lines.sort_by_key(|l| l.line_no);
            all_entries.push(entry);
        }
    }

    let period_entries: Vec<Entry> = all_entries
        .iter()
        .filter(|e| e.entry_date.as_str() >= from)
        .cloned()
        .collect();

    Ok(ReportContext {
        company,
        accounts,
        typed_accounts,
        all_entries,
        period_entries,
    })
}

pub fn default_range(q: &ReportQuery) -> (String, String) {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let from = q.from.clone().unwrap_or_else(|| {
        if today.len() >= 8 {
            format!("{}01", &today[..8])
        } else {
            "2026-01-01".to_string()
        }
    });
    let to = q.to.clone().unwrap_or(today);
    (from, to)
}

pub async fn get_report(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Query(query): Query<ReportQuery>,
) -> Result<Json<Value>, AppError> {
    let (from, to) = default_range(&query);
    if from > to {
        return Err(AppError::bad_request("Rentang tanggal tidak valid."));
    }

    let conn = state.db.lock();
    let include_drafts = kind == "journal";
    let ctx = get_report_context(&conn, state.config.company_id, &from, &to, include_drafts)?;

    let all_lines = domain::flatten(&ctx.all_entries);
    let period_lines = domain::flatten(&ctx.period_entries);

    let data = match kind.as_str() {
        "journal" => {
            let posted_entries: Vec<Entry> = ctx
                .period_entries
                .iter()
                .filter(|e| e.status == "POSTED")
                .cloned()
                .collect();
            build_journal_report_data(&ctx.period_entries, &posted_entries)
        }
        "trial-balance" => {
            let tb = domain::build_trial_balance(&ctx.typed_accounts, &all_lines);
            serde_json::to_value(tb).unwrap()
        }
        "income-statement" => {
            let is = domain::build_income_statement(&ctx.typed_accounts, &period_lines);
            serde_json::to_value(is).unwrap()
        }
        "balance-sheet" => {
            let bs = domain::build_balance_sheet(&ctx.typed_accounts, &all_lines);
            serde_json::to_value(bs).unwrap()
        }
        "equity-changes" => {
            let before_lines: Vec<AmountedLine> = all_lines
                .iter()
                .filter(|l| l.entry_date.as_str() < from.as_str())
                .cloned()
                .collect();
            let ec = domain::build_equity_changes(&ctx.typed_accounts, &before_lines, &period_lines);
            serde_json::to_value(ec).unwrap()
        }
        "cash-flow" => {
            let cf = domain::build_cash_flow_direct(&ctx.typed_accounts, &ctx.period_entries);
            serde_json::to_value(cf).unwrap()
        }
        "ledger" => {
            let account_id = query.account_id.ok_or_else(|| {
                AppError::bad_request("Pilih akun untuk buku besar.")
            })?;
            build_ledger_data(&ctx, account_id, &from, &all_lines, &period_lines)?
        }
        "dashboard" => build_dashboard_data(&ctx, &period_lines, &all_lines),
        _ => return Err(AppError::not_found("Jenis laporan tidak ditemukan.")),
    };

    Ok(Json(json!({
        "company": ctx.company,
        "period": { "from": from, "to": to },
        "data": data,
    })))
}

fn build_journal_report_data(all_period: &[Entry], posted_entries: &[Entry]) -> Value {
    let mut debits: HashMap<String, (String, f64)> = HashMap::new();
    let mut credits: HashMap<String, (String, f64)> = HashMap::new();
    let mut total_debit = 0.0;
    let mut total_credit = 0.0;

    for entry in posted_entries {
        for line in &entry.lines {
            let code = line.code.clone().unwrap_or_default();
            let name = line.account_name.clone().unwrap_or_default();

            if line.debit > 0.0 {
                let item = debits.entry(code.clone()).or_insert((name.clone(), 0.0));
                item.1 = domain::round_money(item.1 + line.debit);
                total_debit = domain::round_money(total_debit + line.debit);
            }
            if line.credit > 0.0 {
                let item = credits.entry(code).or_insert((name, 0.0));
                item.1 = domain::round_money(item.1 + line.credit);
                total_credit = domain::round_money(total_credit + line.credit);
            }
        }
    }

    let mut debits_list = Vec::new();
    for (code, (name, amount)) in debits {
        debits_list.push(json!({ "code": code, "name": name, "amount": amount }));
    }
    debits_list.sort_by(|a, b| a["code"].as_str().cmp(&b["code"].as_str()));

    let mut credits_list = Vec::new();
    for (code, (name, amount)) in credits {
        credits_list.push(json!({ "code": code, "name": name, "amount": amount }));
    }
    credits_list.sort_by(|a, b| a["code"].as_str().cmp(&b["code"].as_str()));

    json!({
        "entries": all_period,
        "recap": {
            "debits": debits_list,
            "credits": credits_list,
            "totalDebit": total_debit,
            "totalCredit": total_credit,
            "isBalanced": (total_debit - total_credit).abs() < domain::MONEY_EPSILON
        }
    })
}

fn build_ledger_data(
    ctx: &ReportContext,
    account_id: i64,
    from: &str,
    all_lines: &[AmountedLine],
    period_lines: &[AmountedLine],
) -> Result<Value, AppError> {
    let target_account = ctx
        .typed_accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| AppError::bad_request("Pilih akun untuk buku besar."))?;

    let target_row = ctx
        .accounts
        .iter()
        .find(|a| a["id"].as_i64() == Some(account_id))
        .unwrap();

    let before: Vec<AmountedLine> = all_lines
        .iter()
        .filter(|l| l.account_id == account_id && l.entry_date.as_str() < from)
        .cloned()
        .collect();

    let initial_balance = domain::account_balance(
        target_account,
        &domain::calculate_account_balances(&ctx.typed_accounts, &before),
    );

    let mut running = initial_balance;
    let mut rows = Vec::new();

    for line in period_lines {
        if line.account_id != account_id {
            continue;
        }

        if target_account.normal_balance == "DEBIT" {
            running = domain::round_money(running + line.debit - line.credit);
        } else {
            running = domain::round_money(running + line.credit - line.debit);
        }

        rows.push(json!({
            "account_id": line.account_id,
            "line_no": line.line_no,
            "debit": line.debit,
            "credit": line.credit,
            "memo": line.memo,
            "code": line.code,
            "account_name": line.account_name,
            "source": line.source,
            "entry_date": line.entry_date,
            "voucher_no": line.voucher_no,
            "description": line.description,
            "balance": running
        }));
    }

    Ok(json!({
        "account": target_row,
        "opening": initial_balance,
        "rows": rows,
        "closing": running
    }))
}

fn build_dashboard_data(
    ctx: &ReportContext,
    period_lines: &[AmountedLine],
    all_lines: &[AmountedLine],
) -> Value {
    let income = domain::build_income_statement(&ctx.typed_accounts, period_lines);
    let balance = domain::build_balance_sheet(&ctx.typed_accounts, all_lines);

    let account_subtypes: HashMap<i64, String> = ctx
        .typed_accounts
        .iter()
        .map(|a| (a.id, a.subtype.clone().unwrap_or_default()))
        .collect();

    let total_of = |rows: &[domain::StatementRow], wanted: &[&str]| -> f64 {
        let mut total = 0.0;
        for row in rows {
            if let Some(subtype) = account_subtypes.get(&row.account_id) {
                if wanted.contains(&subtype.as_str()) {
                    total = domain::round_money(total + row.amount);
                }
            }
        }
        total
    };

    json!({
        "cashBank": total_of(&balance.assets.rows, &["CASH", "BANK"]),
        "receivables": total_of(&balance.assets.rows, &["RECEIVABLE"]),
        "payables": total_of(&balance.liabilities.rows, &["PAYABLE"]),
        "revenue": income.revenue_total,
        "expenses": income.expense_total,
        "netIncome": income.net_income
    })
}

pub async fn close_period(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let mut conn = state.db.lock();
    let tx = conn.transaction()?;

    let (period_name, start_date, end_date, status): (String, String, String, String) = tx
        .query_row(
            "SELECT name, start_date, end_date, status FROM accounting_periods WHERE id = ?1 AND company_id = ?2",
            params![id, state.config.company_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| AppError::not_found("Periode tidak ditemukan."))?;

    if status != "OPEN" {
        return Err(AppError::bad_request("Periode sudah ditutup."));
    }

    let ctx = get_report_context(&tx, state.config.company_id, &start_date, &end_date, false)?;
    let period_lines = domain::flatten(&ctx.period_entries);

    let closing_lines = domain::make_closing_lines(&ctx.typed_accounts, &period_lines)?;
    let mut closing_entry_id: Option<i64> = None;

    if !closing_lines.is_empty() {
        let voucher_no = format!("TUTUP-{}", end_date.replace('-', ""));
        let desc = format!("Jurnal penutup periode {}", period_name);

        let created = write_entry(
            &tx,
            state.config.company_id,
            state.operator_id,
            WriteEntryParams {
                user_id: state.operator_id,
                voucher_no,
                entry_date: end_date.clone(),
                description: desc,
                source: "CLOSING".to_string(),
                status: "POSTED".to_string(),
                lines: closing_lines,
                import_batch_id: None,
                reversal_of_id: None,
            },
        )?;
        closing_entry_id = Some(created);
    }

    tx.execute(
        "UPDATE accounting_periods SET status = 'CLOSED', closed_at = datetime('now', 'localtime'), closed_by = ?1 WHERE id = ?2",
        params![state.operator_id, id],
    )?;

    tx.execute(
        "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
         VALUES (?1, ?2, 'ACCOUNTING_PERIOD', ?3, 'CLOSED', ?4)",
        params![
            state.config.company_id,
            state.operator_id,
            id,
            json!({ "closingEntryId": closing_entry_id }).to_string()
        ],
    )?;

    let net_income = domain::build_income_statement(&ctx.typed_accounts, &period_lines).net_income;
    tx.commit()?;

    Ok(Json(json!({
        "ok": true,
        "entryId": closing_entry_id,
        "netIncome": net_income
    })))
}
