use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub const SCHEMA_SQL: &str = include_str!("schema.sqlite.sql");
pub const LOGIN_DISABLED_HASH: &str = "!!login-dinonaktifkan!!";

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TableCounts {
    pub journal_entries: i64,
    pub journal_lines: i64,
    pub audit_logs: i64,
    pub import_batches: i64,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap()
    }

    pub fn bootstrap(&self, company_id: i64, company_name: &str, operator_name: &str) -> Result<()> {
        let conn = self.lock();

        // Split schema into individual SQL statements
        let clean_sql = SCHEMA_SQL
            .lines()
            .filter(|line| !line.trim_start().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");

        for stmt in clean_sql.split(';') {
            let s = stmt.trim();
            if !s.is_empty() {
                conn.execute(s, [])?;
            }
        }

        // Pastikan Perusahaan Default
        conn.execute(
            "INSERT OR IGNORE INTO companies (id, name, currency) VALUES (?1, ?2, 'IDR')",
            params![company_id, company_name],
        )?;

        // Pastikan Operator Default
        let existing_user: Option<i64> = conn
            .query_row(
                "SELECT id FROM users WHERE company_id = ?1 ORDER BY id LIMIT 1",
                params![company_id],
                |row| row.get(0),
            )
            .optional()?;

        match existing_user {
            None => {
                conn.execute(
                    "INSERT INTO users (company_id, name, email, password_hash, role, is_active)
                     VALUES (?1, ?2, 'operator@finova.local', ?3, 'ADMIN', 1)",
                    params![company_id, operator_name, LOGIN_DISABLED_HASH],
                )?;
            }
            Some(uid) => {
                conn.execute(
                    "UPDATE users SET name = ?1, role = 'ADMIN', is_active = 1 WHERE id = ?2",
                    params![operator_name, uid],
                )?;
            }
        }

        // Pastikan 12 Periode Berjalan
        let year = chrono::Local::now().format("%Y").to_string().parse::<i32>().unwrap_or(2026);
        for month in 1..=12 {
            let start = format!("{:04}-{:02}-01", year, month);
            let end = last_day_of_month(year, month);
            let name = format!("{:02}/{:04}", month, year);
            conn.execute(
                "INSERT OR IGNORE INTO accounting_periods (company_id, name, start_date, end_date)
                 VALUES (?1, ?2, ?3, ?4)",
                params![company_id, name, start, end],
            )?;
        }

        Ok(())
    }

    pub fn clean(&self, company_id: i64) -> Result<(TableCounts, TableCounts)> {
        let conn = self.lock();
        let get_counts = |c: &Connection| -> Result<TableCounts> {
            let j_entries: i64 = c.query_row(
                "SELECT COUNT(*) FROM journal_entries WHERE company_id = ?1",
                params![company_id],
                |r| r.get(0),
            )?;
            let j_lines: i64 = c.query_row(
                "SELECT COUNT(*) FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?1)",
                params![company_id],
                |r| r.get(0),
            )?;
            let a_logs: i64 = c.query_row(
                "SELECT COUNT(*) FROM audit_logs WHERE company_id = ?1",
                params![company_id],
                |r| r.get(0),
            )?;
            let i_batches: i64 = c.query_row(
                "SELECT COUNT(*) FROM import_batches WHERE company_id = ?1",
                params![company_id],
                |r| r.get(0),
            )?;
            Ok(TableCounts {
                journal_entries: j_entries,
                journal_lines: j_lines,
                audit_logs: a_logs,
                import_batches: i_batches,
            })
        };

        let before = get_counts(&conn)?;

        conn.execute("DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?1)", params![company_id])?;
        conn.execute("DELETE FROM journal_entries WHERE company_id = ?1", params![company_id])?;
        conn.execute("DELETE FROM audit_logs WHERE company_id = ?1", params![company_id])?;
        conn.execute("DELETE FROM import_batches WHERE company_id = ?1", params![company_id])?;

        let after = get_counts(&conn)?;
        Ok((before, after))
    }

    pub fn audit(
        &self,
        company_id: i64,
        user_id: i64,
        entity_type: &str,
        entity_id: Option<i64>,
        action: &str,
        details: Option<&serde_json::Value>,
    ) -> Result<()> {
        let conn = self.lock();
        let details_json = details.map(|d| d.to_string());
        conn.execute(
            "INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![company_id, user_id, entity_type, entity_id, action, details_json],
        )?;
        Ok(())
    }
}

fn last_day_of_month(year: i32, month: u32) -> String {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_of_next = chrono::NaiveDate::from_ymd_opt(next_year, next_month, 1).unwrap();
    let last_day = first_of_next.pred_opt().unwrap();
    last_day.format("%Y-%m-%d").to_string()
}
