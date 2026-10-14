pub mod accounts;
pub mod common;
pub mod exports;
pub mod imports;
pub mod journals;
pub mod music;
pub mod reports;

use self::common::AppState;
use axum::{
    body::Body,
    extract::State,
    http::{header, Method, Request, Response, StatusCode, Uri},
    routing::{delete, get, post, put},
    Json, Router,
};
use rust_embed::RustEmbed;
use serde_json::{json, Value};
use std::fs;
use tower_http::cors::{Any, CorsLayer};

#[derive(RustEmbed)]
#[folder = "internal/web/dist"]
struct WebAssets;

pub async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "finova-api",
        "runtime": "rust",
        "version": state.config.version,
    }))
}

pub fn create_router(state: AppState) -> Router {
    // CORS: allow loopback and client_origin
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::HeaderName::from_static("x-requested-with"),
        ]);

    let api_router = Router::new()
        .route("/health", get(health))
        .route("/company", get(accounts::get_company).put(accounts::put_company))
        .route("/accounts", get(accounts::get_accounts).post(accounts::post_account))
        .route("/accounts/{id}", put(accounts::put_account))
        .route("/periods", get(accounts::get_periods).post(accounts::post_period))
        .route("/periods/{id}/close", post(reports::close_period))
        .route("/journals/next-voucher", get(journals::next_voucher_handler))
        .route("/journals", post(journals::post_journal))
        .route(
            "/journals/{id}",
            get(journals::get_journal)
                .put(journals::put_journal)
                .delete(journals::delete_journal),
        )
        .route("/journals/{id}/post", post(journals::post_journal_flag))
        .route("/journals/{id}/reverse", post(journals::reverse_journal))
        .route("/journals/{id}/audit", get(journals::journal_audit))
        .route("/imports/template", get(imports::import_template_handler))
        .route("/imports/preview", post(imports::import_preview))
        .route("/imports/{id}/confirm", post(imports::import_confirm))
        .route("/reports/{kind}", get(reports::get_report))
        .route("/exports/journal.xlsx", get(exports::export_journal_xlsx))
        .route("/exports/journal.pdf", get(exports::export_journal_pdf))
        .route("/exports/ledger.xlsx", get(exports::export_ledger_xlsx))
        .route("/exports/trial-balance.xlsx", get(exports::export_trial_balance_xlsx))
        .route("/exports/accounts.xlsx", get(exports::export_accounts_xlsx))
        .route("/templates", get(accounts::get_templates).post(accounts::post_template))
        .route("/templates/{id}", delete(accounts::delete_template))
        .route("/music", get(music::list_tracks))
        .route("/music/youtube", post(music::post_youtube_track))
        .route("/music/local", post(music::post_local_track))
        .route("/music/open-external", post(music::open_external))
        .route("/music/order", put(music::put_track_order))
        .route("/music/{id}/media", get(music::stream_track))
        .route("/music/{id}/refresh", post(music::refresh_track_metadata))
        .route("/music/{id}", delete(music::delete_track));

    Router::new()
        .nest("/api", api_router)
        .fallback(static_spa_handler)
        .layer(cors)
        .with_state(state)
}

async fn static_spa_handler(
    State(state): State<AppState>,
    uri: Uri,
    _req: Request<Body>,
) -> Response<Body> {
    let path = uri.path().trim_start_matches('/');

    // API routes that didn't match get 404 JSON
    if uri.path().starts_with("/api") {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "message": "Endpoint tidak ditemukan." }).to_string()))
            .unwrap();
    }

    // Check external static dir if set
    if let Some(static_dir) = &state.config.static_dir {
        let file_path = static_dir.join(path);
        if file_path.is_file() {
            if let Ok(content) = fs::read(&file_path) {
                let mime = mime_guess::from_path(&file_path).first_or_octet_stream();
                return Response::builder()
                    .header(header::CONTENT_TYPE, mime.to_string())
                    .body(Body::from(content))
                    .unwrap();
            }
        }
        let index_path = static_dir.join("index.html");
        if index_path.is_file() {
            if let Ok(content) = fs::read(&index_path) {
                return Response::builder()
                    .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Body::from(content))
                    .unwrap();
            }
        }
    }

    // Try embedded assets
    if !path.is_empty() {
        if let Some(asset) = WebAssets::get(path) {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.to_string());

            if path.starts_with("assets/") {
                builder = builder.header(header::CACHE_CONTROL, "public, max-age=31536000, immutable");
            }

            return builder.body(Body::from(asset.data.into_owned())).unwrap();
        }
    }

    // SPA fallback: serve index.html
    if let Some(index) = WebAssets::get("index.html") {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(index.data.into_owned()))
            .unwrap()
    } else {
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(
                "<!DOCTYPE html><html><body><h1>Finova API Server (Rust)</h1><p>Frontend belum tertanam. Jalankan <code>npm run build:client</code>.</p></body></html>",
            ))
            .unwrap()
    }
}
