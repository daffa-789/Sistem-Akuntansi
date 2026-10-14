use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MONEY_EPSILON: f64 = 0.005;
pub const NUMBER_EPSILON: f64 = 2.220446049250313e-16;

#[inline]
pub fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

#[inline]
pub fn round_money(value: f64) -> f64 {
    js_round((value + NUMBER_EPSILON) * 100.0) / 100.0
}

pub fn format_money(value: f64) -> String {
    format!("{}", value)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub code: String,
    pub name: String,
    pub group: String,
    pub subtype: Option<String>,
    pub normal_balance: String,
    pub cash_flow_category: String,
    pub is_cash_account: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Line {
    pub account_id: i64,
    pub line_no: i32,
    pub debit: f64,
    pub credit: f64,
    pub memo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub voucher_no: String,
    pub entry_date: String,
    pub description: String,
    pub source: String,
    pub status: String,
    pub reversal_of_id: Option<i64>,
    pub reversed: bool,
    pub lines: Vec<Line>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AmountedLine {
    pub account_id: i64,
    pub line_no: i32,
    pub debit: f64,
    pub credit: f64,
    pub memo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub entry_date: String,
    #[serde(default)]
    pub voucher_no: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LineInput {
    pub account_id: Option<i64>,
    #[serde(rename = "accountId")]
    pub account_id_camel: Option<i64>,
    #[serde(default)]
    pub debit: Option<serde_json::Value>,
    #[serde(default)]
    pub credit: Option<serde_json::Value>,
    pub memo: Option<String>,
    pub code: Option<String>,
}

impl LineInput {
    pub fn get_account_id(&self) -> i64 {
        self.account_id.or(self.account_id_camel).unwrap_or(0)
    }

    pub fn get_debit(&self) -> f64 {
        parse_f64(self.debit.as_ref())
    }

    pub fn get_credit(&self) -> f64 {
        parse_f64(self.credit.as_ref())
    }
}

pub fn parse_f64(val: Option<&serde_json::Value>) -> f64 {
    match val {
        Some(serde_json::Value::Number(n)) => round_money(n.as_f64().unwrap_or(0.0)),
        Some(serde_json::Value::String(s)) => {
            let clean = s.trim().replace(',', "");
            round_money(clean.parse::<f64>().unwrap_or(0.0))
        }
        _ => 0.0,
    }
}

pub fn normalize_and_assert(items: &[LineInput]) -> Result<Vec<AmountedLine>, String> {
    if items.len() < 2 {
        return Err("Jurnal harus memiliki sedikitnya dua baris.".to_string());
    }

    let mut normalized = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let account_id = item.get_account_id();
        if account_id == 0 {
            return Err(format!("Baris {}: akun wajib dipilih.", index + 1));
        }

        let debit = round_money(item.get_debit());
        let credit = round_money(item.get_credit());

        if debit < 0.0
            || credit < 0.0
            || (debit > 0.0 && credit > 0.0)
            || (debit == 0.0 && credit == 0.0)
        {
            return Err(format!(
                "Baris {}: isi tepat salah satu kolom debit atau kredit.",
                index + 1
            ));
        }

        normalized.push(AmountedLine {
            account_id,
            line_no: (index + 1) as i32,
            debit,
            credit,
            memo: item.memo.clone(),
            code: item.code.clone(),
            account_name: None,
            source: String::new(),
            entry_date: String::new(),
            voucher_no: String::new(),
            description: String::new(),
        });
    }

    assert_balanced(&normalized)
}

pub fn assert_balanced(lines: &[AmountedLine]) -> Result<Vec<AmountedLine>, String> {
    if lines.len() < 2 {
        return Err("Jurnal harus memiliki sedikitnya dua baris.".to_string());
    }

    let mut debit = 0.0;
    let mut credit = 0.0;

    for (index, line) in lines.iter().enumerate() {
        if line.account_id == 0 {
            return Err(format!("Baris {}: akun wajib dipilih.", index + 1));
        }
        if line.debit < 0.0
            || line.credit < 0.0
            || (line.debit > 0.0 && line.credit > 0.0)
            || (line.debit == 0.0 && line.credit == 0.0)
        {
            return Err(format!(
                "Baris {}: isi tepat salah satu kolom debit atau kredit.",
                index + 1
            ));
        }
        debit = round_money(debit + line.debit);
        credit = round_money(credit + line.credit);
    }

    if (debit - credit).abs() >= MONEY_EPSILON {
        return Err(format!(
            "Jurnal tidak seimbang: debit {} dan kredit {}.",
            format_money(debit),
            format_money(credit)
        ));
    }

    Ok(lines.to_vec())
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Total {
    pub debit: f64,
    pub credit: f64,
}

pub fn calculate_account_balances(
    accounts: &[Account],
    lines: &[AmountedLine],
) -> HashMap<i64, Total> {
    let mut balances: HashMap<i64, Total> = accounts.iter().map(|a| (a.id, Total::default())).collect();

    for line in lines {
        let entry = balances.entry(line.account_id).or_default();
        entry.debit = round_money(entry.debit + line.debit);
        entry.credit = round_money(entry.credit + line.credit);
    }

    balances
}

pub fn account_balance(account: &Account, balances: &HashMap<i64, Total>) -> f64 {
    let values = balances.get(&account.id).copied().unwrap_or_default();
    let debit = round_money(values.debit);
    let credit = round_money(values.credit);

    if account.normal_balance == "DEBIT" {
        round_money(debit - credit)
    } else {
        round_money(credit - debit)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceRow {
    #[serde(rename = "accountId")]
    pub account_id: i64,
    pub code: String,
    pub name: String,
    pub group: String,
    pub debit: f64,
    pub credit: f64,
    #[serde(rename = "signedBalance")]
    pub signed_balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Totals {
    pub debit: f64,
    pub credit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceResult {
    pub rows: Vec<TrialBalanceRow>,
    pub totals: Totals,
    #[serde(rename = "isBalanced")]
    pub is_balanced: bool,
}

pub fn build_trial_balance(accounts: &[Account], lines: &[AmountedLine]) -> TrialBalanceResult {
    let balances = calculate_account_balances(accounts, lines);
    let mut rows = Vec::new();

    for account in accounts {
        if !account.is_active {
            continue;
        }
        let balance = account_balance(account, &balances);
        let normal_debit = account.normal_balance == "DEBIT";

        let mut row = TrialBalanceRow {
            account_id: account.id,
            code: account.code.clone(),
            name: account.name.clone(),
            group: account.group.clone(),
            debit: 0.0,
            credit: 0.0,
            signed_balance: balance,
        };

        if normal_debit {
            row.debit = balance.max(0.0);
            row.credit = (-balance).max(0.0);
        } else {
            row.debit = (-balance).max(0.0);
            row.credit = balance.max(0.0);
        }

        if row.debit != 0.0 || row.credit != 0.0 {
            rows.push(row);
        }
    }

    let mut total_debit = 0.0;
    let mut total_credit = 0.0;
    for row in &rows {
        total_debit = round_money(total_debit + row.debit);
        total_credit = round_money(total_credit + row.credit);
    }

    TrialBalanceResult {
        rows,
        totals: Totals {
            debit: total_debit,
            credit: total_credit,
        },
        is_balanced: (total_debit - total_credit).abs() < MONEY_EPSILON,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatementRow {
    #[serde(rename = "accountId")]
    pub account_id: i64,
    pub code: String,
    pub name: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomeStatement {
    pub revenue: Vec<StatementRow>,
    pub expenses: Vec<StatementRow>,
    #[serde(rename = "revenueTotal")]
    pub revenue_total: f64,
    #[serde(rename = "expenseTotal")]
    pub expense_total: f64,
    #[serde(rename = "netIncome")]
    pub net_income: f64,
}

pub fn build_income_statement(accounts: &[Account], lines: &[AmountedLine]) -> IncomeStatement {
    let operational: Vec<AmountedLine> = lines
        .iter()
        .filter(|l| l.source != "CLOSING")
        .cloned()
        .collect();

    let balances = calculate_account_balances(accounts, &operational);

    let rows_for = |group: &str| -> Vec<StatementRow> {
        let mut rows = Vec::new();
        for account in accounts {
            if !account.is_active || account.group != group {
                continue;
            }
            let value = account_balance(account, &balances).max(0.0);
            if value != 0.0 {
                rows.push(StatementRow {
                    account_id: account.id,
                    code: account.code.clone(),
                    name: account.name.clone(),
                    amount: value,
                });
            }
        }
        rows
    };

    let revenue = rows_for("REVENUE");
    let expenses = rows_for("EXPENSE");
    let revenue_total = sum_rows(&revenue);
    let expense_total = sum_rows(&expenses);

    IncomeStatement {
        revenue,
        expenses,
        revenue_total,
        expense_total,
        net_income: round_money(revenue_total - expense_total),
    }
}

fn sum_rows(rows: &[StatementRow]) -> f64 {
    let mut total = 0.0;
    for r in rows {
        total = round_money(total + r.amount);
    }
    total
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub rows: Vec<StatementRow>,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquitySection {
    pub rows: Vec<StatementRow>,
    pub total: f64,
    #[serde(rename = "unclosedProfit")]
    pub unclosed_profit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BalanceSheet {
    pub assets: Section,
    pub liabilities: Section,
    pub equity: EquitySection,
    pub balanced: bool,
}

pub fn build_balance_sheet(accounts: &[Account], lines: &[AmountedLine]) -> BalanceSheet {
    let balances = calculate_account_balances(accounts, lines);

    let section_for = |group: &str| -> Section {
        let mut rows = Vec::new();
        for account in accounts {
            if !account.is_active || account.group != group {
                continue;
            }
            let mut value = account_balance(account, &balances);
            if group == "EQUITY" && account.subtype.as_deref() == Some("DRAWINGS") {
                value = -value;
            }
            if value != 0.0 {
                rows.push(StatementRow {
                    account_id: account.id,
                    code: account.code.clone(),
                    name: account.name.clone(),
                    amount: value,
                });
            }
        }
        let total = sum_rows(&rows);
        Section { rows, total }
    };

    let assets = section_for("ASSET");
    let liabilities = section_for("LIABILITY");
    let equity = section_for("EQUITY");
    let unclosed = build_income_statement(accounts, lines).net_income;
    let total_equity = round_money(equity.total + unclosed);

    let balanced = (assets.total - liabilities.total - total_equity).abs() < MONEY_EPSILON;

    BalanceSheet {
        assets,
        liabilities,
        equity: EquitySection {
            rows: equity.rows,
            total: total_equity,
            unclosed_profit: unclosed,
        },
        balanced,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquityChanges {
    pub opening: f64,
    pub capital: f64,
    pub drawings: f64,
    #[serde(rename = "netIncome")]
    pub net_income: f64,
    pub closing: f64,
}

pub fn build_equity_changes(
    accounts: &[Account],
    before_lines: &[AmountedLine],
    period_lines: &[AmountedLine],
) -> EquityChanges {
    let before = calculate_account_balances(accounts, before_lines);
    let period = calculate_account_balances(accounts, period_lines);

    let equity_accounts: Vec<&Account> = accounts
        .iter()
        .filter(|a| a.group == "EQUITY" && a.is_active)
        .collect();

    let equity_total = |balances: &HashMap<i64, Total>| -> f64 {
        let mut total = 0.0;
        for account in &equity_accounts {
            let mut value = account_balance(account, balances);
            if account.subtype.as_deref() == Some("DRAWINGS") {
                value = -value;
            }
            total = round_money(total + value);
        }
        total
    };

    let subtotal = |balances: &HashMap<i64, Total>, subtype: &str, negate: bool| -> f64 {
        let mut total = 0.0;
        for account in &equity_accounts {
            if account.subtype.as_deref() != Some(subtype) {
                continue;
            }
            total = round_money(total + account_balance(account, balances));
        }
        if negate {
            round_money(-total)
        } else {
            round_money(total)
        }
    };

    let opening = equity_total(&before);
    let capital = subtotal(&period, "OWNER_CAPITAL", false);
    let drawings = subtotal(&period, "DRAWINGS", true);
    let net_income = build_income_statement(accounts, period_lines).net_income;

    EquityChanges {
        opening,
        capital,
        drawings,
        net_income,
        closing: round_money(opening + capital + drawings + net_income),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CashFlow {
    pub operating: f64,
    pub investing: f64,
    pub financing: f64,
    #[serde(rename = "netChange")]
    pub net_change: f64,
}

pub fn build_cash_flow_direct(accounts: &[Account], entries: &[Entry]) -> CashFlow {
    let by_id: HashMap<i64, &Account> = accounts.iter().map(|a| (a.id, a)).collect();
    let mut groups: HashMap<&'static str, f64> = HashMap::new();
    groups.insert("OPERATING", 0.0);
    groups.insert("INVESTING", 0.0);
    groups.insert("FINANCING", 0.0);

    for entry in entries {
        if entry.source == "CLOSING" {
            continue;
        }

        let mut cash_lines = Vec::new();
        let mut non_cash: Option<&Line> = None;

        for line in &entry.lines {
            if let Some(acct) = by_id.get(&line.account_id) {
                if acct.is_cash_account {
                    cash_lines.push(line);
                } else if non_cash.is_none() {
                    non_cash = Some(line);
                }
            }
        }

        let category: &'static str = if let Some(nc) = non_cash {
            if let Some(acct) = by_id.get(&nc.account_id) {
                match acct.cash_flow_category.as_str() {
                    "INVESTING" => "INVESTING",
                    "FINANCING" => "FINANCING",
                    _ => "OPERATING",
                }
            } else {
                "OPERATING"
            }
        } else {
            "OPERATING"
        };

        for line in cash_lines {
            let current = groups.get(category).copied().unwrap_or(0.0);
            let diff = round_money(line.debit) - round_money(line.credit);
            groups.insert(category, round_money(current + diff));
        }
    }

    let operating = groups.get("OPERATING").copied().unwrap_or(0.0);
    let investing = groups.get("INVESTING").copied().unwrap_or(0.0);
    let financing = groups.get("FINANCING").copied().unwrap_or(0.0);

    CashFlow {
        operating,
        investing,
        financing,
        net_change: round_money(operating + investing + financing),
    }
}

pub fn make_closing_lines(
    accounts: &[Account],
    period_lines: &[AmountedLine],
) -> Result<Vec<AmountedLine>, String> {
    let balances = calculate_account_balances(accounts, period_lines);
    let retained = accounts
        .iter()
        .find(|a| a.subtype.as_deref() == Some("RETAINED_EARNINGS"))
        .ok_or_else(|| "Akun laba ditahan belum tersedia.".to_string())?;

    let mut lines = Vec::new();
    for account in accounts {
        if account.group != "REVENUE" && account.group != "EXPENSE" {
            continue;
        }
        let balance = account_balance(account, &balances);
        if balance.abs() < MONEY_EPSILON {
            continue;
        }
        if account.group == "REVENUE" {
            lines.push(AmountedLine {
                account_id: account.id,
                debit: balance,
                credit: 0.0,
                ..Default::default()
            });
        } else {
            lines.push(AmountedLine {
                account_id: account.id,
                debit: 0.0,
                credit: balance,
                ..Default::default()
            });
        }
    }

    if lines.is_empty() {
        return Ok(Vec::new());
    }

    let mut debit = 0.0;
    let mut credit = 0.0;
    for line in &lines {
        debit = round_money(debit + line.debit);
        credit = round_money(credit + line.credit);
    }

    let diff = round_money(debit - credit);
    if diff > 0.0 {
        lines.push(AmountedLine {
            account_id: retained.id,
            debit: 0.0,
            credit: diff,
            ..Default::default()
        });
    } else if diff < 0.0 {
        lines.push(AmountedLine {
            account_id: retained.id,
            debit: -diff,
            credit: 0.0,
            ..Default::default()
        });
    }

    assert_balanced(&lines)
}

pub fn flatten(entries: &[Entry]) -> Vec<AmountedLine> {
    let mut result = Vec::new();
    for entry in entries {
        for line in &entry.lines {
            result.push(AmountedLine {
                account_id: line.account_id,
                line_no: line.line_no,
                debit: line.debit,
                credit: line.credit,
                memo: line.memo.clone(),
                code: line.code.clone(),
                account_name: line.account_name.clone(),
                source: entry.source.clone(),
                entry_date: entry.entry_date.clone(),
                voucher_no: entry.voucher_no.clone(),
                description: entry.description.clone(),
            });
        }
    }
    result
}

pub fn date_text(value: &str) -> String {
    if value.len() > 10 {
        value[..10].to_string()
    } else {
        value.to_string()
    }
}
