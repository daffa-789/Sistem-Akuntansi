use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_file: PathBuf,
    #[allow(dead_code)]
    pub client_origin: String,
    pub company_name: String,
    pub operator_name: String,
    pub static_dir: Option<PathBuf>,
    pub company_id: i64,
    pub version: String,
    pub app_mode: bool,
}

const FALLBACK_DATABASE_NAME: &str = "finova.sqlite";

impl Config {
    pub fn load() -> Self {
        let env_vars = read_dotenv(".env");

        let get_var = |key: &str| -> Option<String> {
            std::env::var(key)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .or_else(|| env_vars.get(key).cloned().filter(|v| !v.trim().is_empty()))
        };

        let port: u16 = get_var("PORT")
            .and_then(|p| p.trim().parse::<u16>().ok())
            .unwrap_or(0);

        let explicit_db = get_var("DATABASE_FILE");
        let db_file = resolve_database_file(explicit_db.as_deref());

        let client_origin = get_var("CLIENT_ORIGIN").unwrap_or_default();
        let company_name = get_var("COMPANY_NAME")
            .unwrap_or_else(|| "PT Finova Akuntansi Indonesia".to_string());
        let operator_name = get_var("OPERATOR_NAME").unwrap_or_else(|| "Operator".to_string());
        let static_dir = get_var("STATIC_DIR").map(PathBuf::from);

        Self {
            port,
            database_file: db_file,
            client_origin,
            company_name,
            operator_name,
            static_dir,
            company_id: 1,
            version: env!("CARGO_PKG_VERSION").to_string(),
            app_mode: false,
        }
    }

    pub fn data_dir(&self) -> PathBuf {
        self.database_file
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."))
    }

    pub fn log_file(&self) -> PathBuf {
        self.data_dir().join("finova.log")
    }

    pub fn webview_user_data(&self) -> PathBuf {
        let path = self.data_dir().join("webview2");
        if let Ok(abs) = fs::canonicalize(&path) {
            abs
        } else if let Ok(cwd) = std::env::current_dir() {
            cwd.join(path)
        } else {
            path
        }
    }
}

fn resolve_database_file(explicit: Option<&str>) -> PathBuf {
    if let Some(exp) = explicit {
        if !exp.trim().is_empty() {
            return PathBuf::from(exp.trim());
        }
    }

    let local = Path::new("database").join(FALLBACK_DATABASE_NAME);
    if Path::new("Cargo.toml").exists() {
        return local;
    }

    if let Some(dir) = dirs_config() {
        let app_dir = dir.join("Finova");
        if fs::create_dir_all(&app_dir).is_ok() {
            return app_dir.join(FALLBACK_DATABASE_NAME);
        }
    }

    local
}

fn dirs_config() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("APPDATA"))
            .ok()
            .map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config"))
    }
}

fn read_dotenv(path: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return map,
    };

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let clean_line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((key, val)) = clean_line.split_once('=') {
            let key = key.trim().to_string();
            let mut val = val.trim().to_string();
            if (val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\''))
            {
                if val.len() >= 2 {
                    val = val[1..val.len() - 1].to_string();
                }
            }
            map.insert(key, val);
        }
    }

    map
}
