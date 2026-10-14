pub mod xlsx;
pub mod pdf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signers {
    pub maker: String,
    pub checker: String,
    pub approver: String,
}

impl Default for Signers {
    fn default() -> Self {
        Self {
            maker: "Staf Akuntansi".to_string(),
            checker: "Supervisor".to_string(),
            approver: "Pimpinan".to_string(),
        }
    }
}

impl Signers {
    pub fn with_defaults(self) -> Self {
        Self {
            maker: if self.maker.trim().is_empty() { "Staf Akuntansi".to_string() } else { self.maker },
            checker: if self.checker.trim().is_empty() { "Supervisor".to_string() } else { self.checker },
            approver: if self.approver.trim().is_empty() { "Pimpinan".to_string() } else { self.approver },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecapItem {
    pub code: String,
    pub name: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Recap {
    pub debits: Vec<RecapItem>,
    pub credits: Vec<RecapItem>,
    pub total_debit: f64,
    pub total_credit: f64,
    pub is_balanced: bool,
}

impl Recap {
    pub fn is_empty(&self) -> bool {
        self.debits.is_empty() && self.credits.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalRow {
    pub show_head: bool,
    pub date: String,
    pub voucher: String,
    pub account: String,
    pub ref_code: String,
    pub debit: f64,
    pub credit: f64,
    pub is_credit: bool,
    pub alternate: bool,
    pub line_memo: String,
    pub end_memo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalData {
    pub company: String,
    pub from: String,
    pub to: String,
    pub entries: Vec<JournalRow>,
    pub total_debit: f64,
    pub total_credit: f64,
    pub recap: Recap,
    pub signers: Signers,
    pub printed_on: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerRow {
    pub date: String,
    pub voucher: String,
    pub description: String,
    pub debit: f64,
    pub credit: f64,
    pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerData {
    pub company: String,
    pub account_label: String,
    pub normal_balance: String,
    pub from: String,
    pub to: String,
    pub opening: f64,
    pub rows: Vec<LedgerRow>,
    pub closing: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceRow {
    pub code: String,
    pub name: String,
    pub group: String,
    pub debit: f64,
    pub credit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrialBalanceData {
    pub company: String,
    pub as_of: String,
    pub rows: Vec<TrialBalanceRow>,
    pub total_debit: f64,
    pub total_credit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRow {
    pub code: String,
    pub name: String,
    pub group: String,
    pub subtype: String,
    pub normal_balance: String,
    pub cash_flow: String,
    pub cash_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountsData {
    pub company: String,
    pub rows: Vec<AccountRow>,
}

pub fn format_idr(value: f64) -> String {
    if value == 0.0 {
        return "-".to_string();
    }
    let is_neg = value < 0.0;
    let abs_val = value.abs();
    let int_part = abs_val.trunc() as i64;
    let frac_part = (abs_val.fract() * 100.0).round() as i64;

    let s = int_part.to_string();
    let mut with_dots = String::new();
    let len = s.len();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            with_dots.push('.');
        }
        with_dots.push(ch);
    }

    let formatted = if frac_part > 0 {
        format!("{},{:02}", with_dots, frac_part)
    } else {
        with_dots
    };

    if is_neg {
        format!("-{}", formatted)
    } else {
        formatted
    }
}
