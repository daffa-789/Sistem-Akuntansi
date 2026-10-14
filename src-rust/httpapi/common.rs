use crate::config::Config;
use crate::db::Db;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: Db,
    pub operator_id: i64,
}

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
}

impl AppError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = Json(json!({ "message": self.message }));
        (self.status, body).into_response()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(sqlite_err, Some(msg)) = &err {
            if sqlite_err.code == rusqlite::ErrorCode::ConstraintViolation
                || msg.contains("UNIQUE constraint failed")
            {
                return AppError::conflict(
                    "Data duplikat: kode akun, nomor bukti, atau berkas impor sudah digunakan.",
                );
            }
        }
        AppError::internal(format!("Kesalahan database: {}", err))
    }
}

impl From<String> for AppError {
    fn from(msg: String) -> Self {
        AppError::bad_request(msg)
    }
}

impl From<&str> for AppError {
    fn from(msg: &str) -> Self {
        AppError::bad_request(msg)
    }
}
