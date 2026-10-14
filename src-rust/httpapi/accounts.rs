use super::common::{AppError, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rusqlite::params;
use serde_json::{json, Value};

pub async fn get_company(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare("SELECT * FROM companies WHERE id = ?1")?;
    let company = stmt.query_row(params![state.config.company_id], |row| {
        Ok(json!({
            "id": row.get::<_, i64>("id")?,
            "name": row.get::<_, String>("name")?,
            "address": row.get::<_, Option<String>>("address")?,
            "phone": row.get::<_, Option<String>>("phone")?,
            "email": row.get::<_, Option<String>>("email")?,
            "currency": row.get::<_, String>("currency")?,
            "fiscal_year_start": row.get::<_, i32>("fiscal_year_start")?,
            "created_at": row.get::<_, String>("created_at")?,
            "updated_at": row.get::<_, String>("updated_at")?,
        }))
    })?;

    Ok(Json(json!({ "company": company })))
}

pub async fn put_company(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let name = body["name"].as_str().unwrap_or("").trim();
    if name.is_empty() {
        return Err(AppError::bad_request("Nama perusahaan wajib diisi."));
    }

    let address = body["address"].as_str().filter(|s| !s.trim().is_empty());
    let phone = body["phone"].as_str().filter(|s| !s.trim().is_empty());
    let email = body["email"].as_str().filter(|s| !s.trim().is_empty());
    let fiscal_year_start = body["fiscalYearStart"].as_i64().unwrap_or(1);

    let conn = state.db.lock();
    conn.execute(
        "UPDATE companies SET name = ?1, address = ?2, phone = ?3, email = ?4, fiscal_year_start = ?5, updated_at = datetime('now', 'localtime') WHERE id = ?6",
        params![name, address, phone, email, fiscal_year_start, state.config.company_id],
    )?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn get_accounts(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, company_id, code, name, account_group, account_subtype, normal_balance,
                cash_flow_category, is_cash_account, is_active, created_at, updated_at
         FROM accounts WHERE company_id = ?1 ORDER BY code",
    )?;

    let accounts = stmt
        .query_map(params![state.config.company_id], |row| {
            Ok(json!({
                "id": row.get::<_, i64>("id")?,
                "company_id": row.get::<_, i64>("company_id")?,
                "code": row.get::<_, String>("code")?,
                "name": row.get::<_, String>("name")?,
                "account_group": row.get::<_, String>("account_group")?,
                "account_subtype": row.get::<_, Option<String>>("account_subtype")?,
                "normal_balance": row.get::<_, String>("normal_balance")?,
                "cash_flow_category": row.get::<_, String>("cash_flow_category")?,
                "is_cash_account": row.get::<_, i32>("is_cash_account")? != 0,
                "is_active": row.get::<_, i32>("is_active")? != 0,
                "created_at": row.get::<_, String>("created_at")?,
                "updated_at": row.get::<_, String>("updated_at")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(json!({ "accounts": accounts })))
}

pub async fn post_account(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let code = body["code"].as_str().unwrap_or("").trim();
    let name = body["name"].as_str().unwrap_or("").trim();
    let group = body["accountGroup"].as_str().unwrap_or("").trim();
    let normal_balance = body["normalBalance"].as_str().unwrap_or("").trim();

    let valid_groups = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
    if code.is_empty()
        || name.is_empty()
        || !valid_groups.contains(&group)
        || (normal_balance != "DEBIT" && normal_balance != "CREDIT")
    {
        return Err(AppError::bad_request("Data akun tidak lengkap atau tidak valid."));
    }

    let subtype = body["accountSubtype"].as_str().filter(|s| !s.trim().is_empty());
    let mut cash_flow_category = body["cashFlowCategory"].as_str().unwrap_or("").trim();
    if cash_flow_category.is_empty() {
        cash_flow_category = "OPERATING";
    }
    let is_cash = match &body["isCashAccount"] {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    };

    let id = {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                state.config.company_id,
                code,
                name,
                group,
                subtype,
                normal_balance,
                cash_flow_category,
                if is_cash { 1 } else { 0 }
            ],
        )?;
        conn.last_insert_rowid()
    };

    let _ = state.db.audit(
        state.config.company_id,
        state.operator_id,
        "ACCOUNT",
        Some(id),
        "CREATED",
        None,
    );

    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

pub async fn put_account(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    let name = body["name"].as_str().unwrap_or("").trim();
    if name.is_empty() {
        return Err(AppError::bad_request("Nama akun wajib diisi."));
    }

    let subtype = body["accountSubtype"].as_str().filter(|s| !s.trim().is_empty());
    let mut cash_flow_category = body["cashFlowCategory"].as_str().unwrap_or("").trim();
    if cash_flow_category.is_empty() {
        cash_flow_category = "OPERATING";
    }
    let is_cash = match &body["isCashAccount"] {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    };
    let is_active = match &body["isActive"] {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(1) != 0,
        _ => true,
    };

    let affected = {
        let conn = state.db.lock();
        conn.execute(
            "UPDATE accounts SET name = ?1, account_subtype = ?2, cash_flow_category = ?3, is_cash_account = ?4, is_active = ?5, updated_at = datetime('now', 'localtime')
             WHERE id = ?6 AND company_id = ?7",
            params![
                name,
                subtype,
                cash_flow_category,
                if is_cash { 1 } else { 0 },
                if is_active { 1 } else { 0 },
                id,
                state.config.company_id
            ],
        )?
    };

    if affected == 0 {
        return Err(AppError::not_found("Akun tidak ditemukan."));
    }

    let _ = state.db.audit(
        state.config.company_id,
        state.operator_id,
        "ACCOUNT",
        Some(id),
        "UPDATED",
        None,
    );

    Ok(Json(json!({ "ok": true })))
}

pub async fn get_periods(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, company_id, name, start_date, end_date, status, closed_at, closed_by, created_at
         FROM accounting_periods WHERE company_id = ?1 ORDER BY start_date DESC",
    )?;

    let periods = stmt
        .query_map(params![state.config.company_id], |row| {
            Ok(json!({
                "id": row.get::<_, i64>("id")?,
                "company_id": row.get::<_, i64>("company_id")?,
                "name": row.get::<_, String>("name")?,
                "start_date": row.get::<_, String>("start_date")?,
                "end_date": row.get::<_, String>("end_date")?,
                "status": row.get::<_, String>("status")?,
                "closed_at": row.get::<_, Option<String>>("closed_at")?,
                "closed_by": row.get::<_, Option<i64>>("closed_by")?,
                "created_at": row.get::<_, String>("created_at")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(json!({ "periods": periods })))
}

pub async fn post_period(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let name = body["name"].as_str().unwrap_or("").trim();
    let start_date = body["startDate"].as_str().unwrap_or("").trim();
    let end_date = body["endDate"].as_str().unwrap_or("").trim();

    if name.is_empty() || start_date.is_empty() || end_date.is_empty() || start_date > end_date {
        return Err(AppError::bad_request("Nama dan rentang tanggal periode tidak valid."));
    }

    let id = {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?1, ?2, ?3, ?4)",
            params![state.config.company_id, name, start_date, end_date],
        )?;
        conn.last_insert_rowid()
    };

    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

pub async fn get_templates(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    let mut stmt = conn.prepare(
        "SELECT id, company_id, name, description, lines_json, created_by, created_at
         FROM journal_templates WHERE company_id = ?1 ORDER BY name",
    )?;

    let templates = stmt
        .query_map(params![state.config.company_id], |row| {
            let lines_str: String = row.get("lines_json")?;
            let lines: Value = serde_json::from_str(&lines_str).unwrap_or_else(|_| json!([]));
            Ok(json!({
                "id": row.get::<_, i64>("id")?,
                "company_id": row.get::<_, i64>("company_id")?,
                "name": row.get::<_, String>("name")?,
                "description": row.get::<_, String>("description")?,
                "lines": lines,
                "created_by": row.get::<_, i64>("created_by")?,
                "created_at": row.get::<_, String>("created_at")?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Json(json!({ "templates": templates })))
}

pub async fn post_template(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let name = body["name"].as_str().unwrap_or("").trim();
    let description = body["description"].as_str().unwrap_or("").trim();
    let lines = match body.get("lines") {
        Some(Value::Array(arr)) if !arr.is_empty() => arr,
        _ => return Err(AppError::bad_request("Nama template dan baris jurnal wajib diisi.")),
    };

    if name.is_empty() {
        return Err(AppError::bad_request("Nama template dan baris jurnal wajib diisi."));
    }

    let lines_json = serde_json::to_string(lines).map_err(|e| AppError::internal(e.to_string()))?;

    let id = {
        let conn = state.db.lock();
        conn.execute(
            "INSERT INTO journal_templates (company_id, name, description, lines_json, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![state.config.company_id, name, description, lines_json, state.operator_id],
        )?;
        conn.last_insert_rowid()
    };

    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

pub async fn delete_template(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, AppError> {
    let conn = state.db.lock();
    conn.execute(
        "DELETE FROM journal_templates WHERE id = ?1 AND company_id = ?2",
        params![id, state.config.company_id],
    )?;
    Ok(Json(json!({ "ok": true })))
}
