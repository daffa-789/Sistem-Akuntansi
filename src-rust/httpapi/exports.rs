use super::common::{AppError, AppState};
use super::reports::{default_range, get_report_context, ReportQuery};
use crate::domain::{self, AmountedLine};
use crate::export::{
    self, AccountRow, AccountsData, JournalData, JournalRow, LedgerData, LedgerRow, Recap,
    RecapItem, Signers, TrialBalanceData, TrialBalanceRow,
};
use axum::{
    body::Body,
    extract::{Query, State},
    http::header,
    response::Response,
};
use rusqlite::params;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub struct ExportFilterQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(rename = "accountId")]
    pub account_id: Option<i64>,
    pub status: Option<String>,
    pub q: Option<String>,
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub maker: Option<String>,
    pub checker: Option<String>,
    pub approver: Option<String>,
}

const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_MIME: &str = "application/pdf";

fn make_download(filename: &str, content_type: &str, payload: Vec<u8>) -> Result<Response, AppError> {
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from(payload))
        .map_err(|e| AppError::internal(e.to_string()))
}

fn sanitize_filename(prefix: &str, suffix: &str) -> String {
    let clean = prefix.replace(['/', '\\', '"', '\r', '\n'], "-");
    format!("{}{}", clean, suffix)
}

fn build_journal_export_data(
    state: &AppState,
    query: &ExportFilterQuery,
    as_pdf: bool,
) -> Result<(JournalData, String), AppError> {
    let rq = ReportQuery {
        from: query.from.clone(),
        to: query.to.clone(),
        account_id: query.account_id,
    };
    let (from, to) = default_range(&rq);
    if from > to {
        return Err(AppError::bad_request("Rentang tanggal tidak valid."));
    }

    let conn = state.db.lock();
    let ctx = get_report_context(&conn, state.config.company_id, &from, &to, true)?;

    let status_filter = query.status.as_deref().unwrap_or("ALL").to_uppercase();
    let search_filter = query.q.as_deref().unwrap_or("").trim().to_lowercase();
    let account_id_filter = query.account_id.unwrap_or(0);

    let mut filtered_entries = Vec::new();
    for entry in &ctx.period_entries {
        if status_filter != "ALL" && !status_filter.is_empty() && entry.status != status_filter {
            continue;
        }
        if account_id_filter != 0 && !entry.lines.iter().any(|l| l.account_id == account_id_filter) {
            continue;
        }
        if !search_filter.is_empty() {
            let mut matched = entry.voucher_no.to_lowercase().contains(&search_filter)
                || entry.description.to_lowercase().contains(&search_filter);

            if !matched {
                for l in &entry.lines {
                    if l.code.as_deref().unwrap_or("").to_lowercase().contains(&search_filter)
                        || l.account_name.as_deref().unwrap_or("").to_lowercase().contains(&search_filter)
                        || l.memo.as_deref().unwrap_or("").to_lowercase().contains(&search_filter)
                    {
                        matched = true;
                        break;
                    }
                }
            }
            if !matched {
                continue;
            }
        }
        filtered_entries.push(entry.clone());
    }

    let sort_key = query.sort.as_deref().unwrap_or("date");
    let sort_dir = query.dir.as_deref().unwrap_or("desc");
    let is_desc = sort_dir == "desc";

    filtered_entries.sort_by(|a, b| {
        let ord = match sort_key {
            "voucher" => a.voucher_no.cmp(&b.voucher_no),
            "debit" => {
                let da: f64 = a.lines.iter().map(|l| l.debit).sum();
                let db: f64 = b.lines.iter().map(|l| l.debit).sum();
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            }
            "credit" => {
                let ca: f64 = a.lines.iter().map(|l| l.credit).sum();
                let cb: f64 = b.lines.iter().map(|l| l.credit).sum();
                ca.partial_cmp(&cb).unwrap_or(std::cmp::Ordering::Equal)
            }
            _ => a.entry_date.cmp(&b.entry_date).then_with(|| a.id.cmp(&b.id)),
        };
        if is_desc {
            ord.reverse()
        } else {
            ord
        }
    });

    let marker = if as_pdf { "     » " } else { "     ↳ " };

    let mut rows = Vec::new();
    let mut total_debit = 0.0;
    let mut total_credit = 0.0;

    for (entry_idx, entry) in filtered_entries.iter().enumerate() {
        let line_count = entry.lines.len();
        for (line_idx, line) in entry.lines.iter().enumerate() {
            let raw_acc = line.account_name.as_deref().unwrap_or("");
            let account_text = if line.credit > 0.0 {
                format!("{}{}", marker, raw_acc)
            } else {
                raw_acc.to_string()
            };

            let row = JournalRow {
                show_head: line_idx == 0,
                date: if line_idx == 0 { entry.entry_date.clone() } else { String::new() },
                voucher: if line_idx == 0 { entry.voucher_no.clone() } else { String::new() },
                account: account_text,
                ref_code: line.code.clone().unwrap_or_default(),
                debit: line.debit,
                credit: line.credit,
                is_credit: line.credit > 0.0,
                alternate: entry_idx % 2 == 1,
                line_memo: line.memo.clone().unwrap_or_default(),
                end_memo: if line_idx == line_count - 1 { entry.description.clone() } else { String::new() },
            };
            rows.push(row);
        }
    }

    // Recap dari entri POSTED
    let posted_entries: Vec<&domain::Entry> = filtered_entries
        .iter()
        .filter(|e| e.status == "POSTED")
        .collect();

    let mut recap_debits: HashMap<String, (String, f64)> = HashMap::new();
    let mut recap_credits: HashMap<String, (String, f64)> = HashMap::new();
    let mut recap_total_debit = 0.0;
    let mut recap_total_credit = 0.0;

    for entry in posted_entries {
        for line in &entry.lines {
            let code = line.code.clone().unwrap_or_default();
            let name = line.account_name.clone().unwrap_or_default();

            if line.debit > 0.0 {
                let item = recap_debits.entry(code.clone()).or_insert((name.clone(), 0.0));
                item.1 = domain::round_money(item.1 + line.debit);
                recap_total_debit = domain::round_money(recap_total_debit + line.debit);
                total_debit = domain::round_money(total_debit + line.debit);
            }
            if line.credit > 0.0 {
                let item = recap_credits.entry(code).or_insert((name, 0.0));
                item.1 = domain::round_money(item.1 + line.credit);
                recap_total_credit = domain::round_money(recap_total_credit + line.credit);
                total_credit = domain::round_money(total_credit + line.credit);
            }
        }
    }

    let mut debits_list = Vec::new();
    for (code, (name, amount)) in recap_debits {
        debits_list.push(RecapItem { code, name, amount });
    }
    debits_list.sort_by(|a, b| a.code.cmp(&b.code));

    let mut credits_list = Vec::new();
    for (code, (name, amount)) in recap_credits {
        credits_list.push(RecapItem { code, name, amount });
    }
    credits_list.sort_by(|a, b| a.code.cmp(&b.code));

    let recap = Recap {
        debits: debits_list,
        credits: credits_list,
        total_debit: recap_total_debit,
        total_credit: recap_total_credit,
        is_balanced: (recap_total_debit - recap_total_credit).abs() < domain::MONEY_EPSILON,
    };

    let signers = Signers {
        maker: query.maker.clone().unwrap_or_default(),
        checker: query.checker.clone().unwrap_or_default(),
        approver: query.approver.clone().unwrap_or_default(),
    }
    .with_defaults();

    let company_name = ctx.company["name"].as_str().unwrap_or("PT Finova Akuntansi Indonesia").to_string();
    let filename = format!("Finova_Jurnal_Umum_{}_sd_{}", from, to);

    Ok((
        JournalData {
            company: company_name,
            from,
            to,
            entries: rows,
            total_debit,
            total_credit,
            recap,
            signers,
            printed_on: chrono::Local::now().format("%Y-%m-%d").to_string(),
        },
        filename,
    ))
}

pub async fn export_journal_xlsx(
    State(state): State<AppState>,
    Query(query): Query<ExportFilterQuery>,
) -> Result<Response, AppError> {
    let (data, filename) = build_journal_export_data(&state, &query, false)?;
    let book = export::xlsx::journal_workbook(&data).map_err(|e| AppError::internal(e.to_string()))?;
    make_download(&sanitize_filename(&filename, ".xlsx"), XLSX_MIME, book)
}

pub async fn export_journal_pdf(
    State(state): State<AppState>,
    Query(query): Query<ExportFilterQuery>,
) -> Result<Response, AppError> {
    let (data, filename) = build_journal_export_data(&state, &query, true)?;
    let pdf = export::pdf::journal_pdf(&data).map_err(|e| AppError::internal(e.to_string()))?;
    make_download(&sanitize_filename(&filename, ".pdf"), PDF_MIME, pdf)
}

pub async fn export_ledger_xlsx(
    State(state): State<AppState>,
    Query(query): Query<ExportFilterQuery>,
) -> Result<Response, AppError> {
    let account_id = query
        .account_id
        .ok_or_else(|| AppError::bad_request("Pilih akun untuk buku besar."))?;

    let rq = ReportQuery {
        from: query.from.clone(),
        to: query.to.clone(),
        account_id: Some(account_id),
    };
    let (from, to) = default_range(&rq);

    let conn = state.db.lock();
    let ctx = get_report_context(&conn, state.config.company_id, &from, &to, false)?;

    let target_account = ctx
        .typed_accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| AppError::bad_request("Pilih akun untuk buku besar."))?;

    let all_lines = domain::flatten(&ctx.all_entries);
    let period_lines = domain::flatten(&ctx.period_entries);

    let before_lines: Vec<AmountedLine> = all_lines
        .iter()
        .filter(|l| l.account_id == account_id && l.entry_date.as_str() < from.as_str())
        .cloned()
        .collect();

    let initial_balance = domain::account_balance(
        target_account,
        &domain::calculate_account_balances(&ctx.typed_accounts, &before_lines),
    );

    let mut running = initial_balance;
    let mut rows = Vec::new();

    for line in &period_lines {
        if line.account_id != account_id {
            continue;
        }

        if target_account.normal_balance == "DEBIT" {
            running = domain::round_money(running + line.debit - line.credit);
        } else {
            running = domain::round_money(running + line.credit - line.debit);
        }

        let desc = if !line.description.is_empty() {
            line.description.clone()
        } else {
            line.memo.clone().unwrap_or_default()
        };

        rows.push(LedgerRow {
            date: line.entry_date.clone(),
            voucher: line.voucher_no.clone(),
            description: desc,
            debit: line.debit,
            credit: line.credit,
            balance: running,
        });
    }

    let company_name = ctx.company["name"].as_str().unwrap_or("PT Finova Akuntansi Indonesia").to_string();
    let account_label = format!("{} - {}", target_account.code, target_account.name);
    let filename = format!("Finova_Buku_Besar_{}_{}", target_account.code, from);

    let data = LedgerData {
        company: company_name,
        account_label,
        normal_balance: target_account.normal_balance.clone(),
        from,
        to,
        opening: initial_balance,
        rows,
        closing: running,
    };

    let book = export::xlsx::ledger_workbook(&data).map_err(|e| AppError::internal(e.to_string()))?;
    make_download(&sanitize_filename(&filename, ".xlsx"), XLSX_MIME, book)
}

pub async fn export_trial_balance_xlsx(
    State(state): State<AppState>,
    Query(query): Query<ExportFilterQuery>,
) -> Result<Response, AppError> {
    let rq = ReportQuery {
        from: query.from.clone(),
        to: query.to.clone(),
        account_id: None,
    };
    let (_, to) = default_range(&rq);

    let conn = state.db.lock();
    let ctx = get_report_context(&conn, state.config.company_id, "1970-01-01", &to, false)?;
    let all_lines = domain::flatten(&ctx.all_entries);

    let tb = domain::build_trial_balance(&ctx.typed_accounts, &all_lines);

    let rows: Vec<TrialBalanceRow> = tb
        .rows
        .iter()
        .map(|r| TrialBalanceRow {
            code: r.code.clone(),
            name: r.name.clone(),
            group: r.group.clone(),
            debit: r.debit,
            credit: r.credit,
        })
        .collect();

    let company_name = ctx.company["name"].as_str().unwrap_or("PT Finova Akuntansi Indonesia").to_string();
    let data = TrialBalanceData {
        company: company_name,
        as_of: to.clone(),
        rows,
        total_debit: tb.totals.debit,
        total_credit: tb.totals.credit,
    };

    let filename = format!("Finova_Neraca_Saldo_{}", to);
    let book = export::xlsx::trial_balance_workbook(&data).map_err(|e| AppError::internal(e.to_string()))?;
    make_download(&sanitize_filename(&filename, ".xlsx"), XLSX_MIME, book)
}

pub async fn export_accounts_xlsx(State(state): State<AppState>) -> Result<Response, AppError> {
    let conn = state.db.lock();
    let company_name: String = conn
        .query_row(
            "SELECT name FROM companies WHERE id = ?1",
            params![state.config.company_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "PT Finova Akuntansi Indonesia".to_string());

    let mut stmt = conn.prepare(
        "SELECT code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account
         FROM accounts WHERE company_id = ?1 ORDER BY code",
    )?;

    let rows = stmt
        .query_map(params![state.config.company_id], |r| {
            let is_cash: bool = r.get::<_, i32>(6)? != 0;
            Ok(AccountRow {
                code: r.get(0)?,
                name: r.get(1)?,
                group: r.get(2)?,
                subtype: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                normal_balance: r.get(4)?,
                cash_flow: r.get(5)?,
                cash_label: if is_cash { "Ya (Kas/Bank)".to_string() } else { "Tidak".to_string() },
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let data = AccountsData {
        company: company_name,
        rows,
    };

    let filename = format!("Finova_Bagan_Akun_{}", chrono::Local::now().format("%Y-%m-%d"));
    let book = export::xlsx::accounts_workbook(&data).map_err(|e| AppError::internal(e.to_string()))?;
    make_download(&sanitize_filename(&filename, ".xlsx"), XLSX_MIME, book)
}
