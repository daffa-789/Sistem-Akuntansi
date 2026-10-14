#![windows_subsystem = "windows"]

mod config;
mod db;
mod desktop;
mod domain;
mod export;
mod httpapi;

use config::Config;
use db::Db;
use httpapi::common::AppState;
use std::env;
use std::fs::{self, OpenOptions};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process;

fn main() {
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }

    let args: Vec<String> = env::args().skip(1).collect();
    if let Err(err) = run(args) {
        eprintln!("Finova: {}", err);
        process::exit(1);
    }
}

fn run(args: Vec<String>) -> Result<(), Box<dyn std::error::Error>> {
    let mut command = "serve".to_string();
    let mut rest_args = Vec::new();

    let mut iter = args.into_iter();
    if let Some(first) = iter.next() {
        if !first.starts_with('-') {
            command = first;
            rest_args.extend(iter);
        } else {
            rest_args.push(first);
            rest_args.extend(iter);
        }
    }

    let mut cfg = Config::load();
    let mut app_mode = false;
    let mut browser = false;
    let mut no_browser = false;
    let mut target_url = String::new();
    let mut devtools = false;

    let mut i = 0;
    while i < rest_args.len() {
        let arg = &rest_args[i];
        match arg.as_str() {
            "-port" | "--port" => {
                if i + 1 < rest_args.len() {
                    i += 1;
                    if let Ok(p) = rest_args[i].parse::<u16>() {
                        cfg.port = p;
                    }
                }
            }
            "-db" | "--db" => {
                if i + 1 < rest_args.len() {
                    i += 1;
                    cfg.database_file = PathBuf::from(&rest_args[i]);
                }
            }
            "-static" | "--static" => {
                if i + 1 < rest_args.len() {
                    i += 1;
                    cfg.static_dir = Some(PathBuf::from(&rest_args[i]));
                }
            }
            "-app" | "--app" => {
                app_mode = true;
            }
            "-browser" | "--browser" => {
                browser = true;
            }
            "-no-browser" | "--no-browser" => {
                no_browser = true;
            }
            "-url" | "--url" => {
                if i + 1 < rest_args.len() {
                    i += 1;
                    target_url = rest_args[i].clone();
                }
            }
            "-devtools" | "--devtools" => {
                devtools = true;
            }
            "-v" | "--version" | "version" => {
                command = "version".to_string();
            }
            "-h" | "--help" | "help" => {
                command = "help".to_string();
            }
            _ => {}
        }
        i += 1;
    }

    cfg.app_mode = app_mode;

    match command.as_str() {
        "serve" | "server" => {
            let launch_mode = resolve_launch(app_mode, browser, no_browser, target_url, devtools);
            serve(cfg, launch_mode)
        }
        "db:init" => init_database(cfg),
        "db:clean" => clean_database(cfg),
        "version" => {
            println!(
                "finova {} {}/{} (Rust Native)",
                cfg.version,
                env::consts::OS,
                env::consts::ARCH
            );
            Ok(())
        }
        "help" => {
            print_help();
            Ok(())
        }
        _ => Err(format!(
            "Perintah \"{}\" tidak dikenal, jalankan `finova help`",
            command
        )
        .into()),
    }
}

struct LaunchOptions {
    window: bool,
    browser: bool,
    url: String,
    devtools: bool,
}

fn resolve_launch(
    app_mode: bool,
    browser: bool,
    no_open: bool,
    url: String,
    devtools: bool,
) -> LaunchOptions {
    let mut mode = LaunchOptions {
        window: false,
        browser: false,
        url,
        devtools,
    };
    if no_open {
        return mode;
    }
    if browser {
        mode.browser = true;
    } else if app_mode {
        mode.window = true;
    }
    mode
}

fn serve(cfg: Config, mode: LaunchOptions) -> Result<(), Box<dyn std::error::Error>> {
    if cfg.app_mode {
        let _ = redirect_log_to_file(&cfg);
        desktop::hide_console();
    }

    if mode.window && desktop::focus_existing(desktop::WINDOW_TITLE) {
        println!("Finova sudah terbuka — jendela yang ada diangkat.");
        return Ok(());
    }

    let database = Db::open(&cfg.database_file)?;
    database.bootstrap(cfg.company_id, &cfg.company_name, &cfg.operator_name)?;

    let state = AppState {
        config: cfg.clone(),
        db: database,
        operator_id: 1,
    };

    let router = httpapi::create_router(state);

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    let (target_address, _real_port) = rt.block_on(async {
        let bind_addr = SocketAddr::from(([127, 0, 0, 1], cfg.port));
        let listener = tokio::net::TcpListener::bind(bind_addr).await?;
        let local_addr = listener.local_addr()?;
        let real_port = local_addr.port();

        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[Finova] server error: {}", e);
            }
        });

        Ok::<(String, u16), Box<dyn std::error::Error>>((
            format!("http://127.0.0.1:{}", real_port),
            real_port,
        ))
    })?;

    let target = if !mode.url.is_empty() {
        mode.url
    } else {
        target_address
    };

    println!(
        "Finova {} — bootstrap siap (database {}).",
        cfg.version,
        cfg.database_file.display()
    );
    println!("Finova siap di {}", target);

    if mode.window {
        desktop::run_window(&target, cfg.webview_user_data(), mode.devtools)?;
        return Ok(());
    }

    if mode.browser {
        desktop::open_browser(&target);
    }

    // Wait for Ctrl+C
    rt.block_on(async {
        tokio::signal::ctrl_c().await.ok();
    });

    Ok(())
}

fn redirect_log_to_file(cfg: &Config) -> std::io::Result<()> {
    let data_dir = cfg.data_dir();
    fs::create_dir_all(&data_dir)?;
    let _ = OpenOptions::new()
        .create(true)
        .append(true)
        .open(cfg.log_file())?;
    Ok(())
}

fn init_database(cfg: Config) -> Result<(), Box<dyn std::error::Error>> {
    let database = Db::open(&cfg.database_file)?;
    database.bootstrap(cfg.company_id, &cfg.company_name, &cfg.operator_name)?;
    println!(
        "Database lokal Finova ({}) siap digunakan.",
        cfg.database_file.display()
    );
    println!("Tidak memerlukan XAMPP atau phpMyAdmin. Berjalan otomatis.");
    Ok(())
}

fn clean_database(cfg: Config) -> Result<(), Box<dyn std::error::Error>> {
    let database = Db::open(&cfg.database_file)?;
    database.bootstrap(cfg.company_id, &cfg.company_name, &cfg.operator_name)?;

    let (before, after) = database.clean(cfg.company_id)?;

    println!("=== STATUS DATABASE SEBELUM PEMBERSIHAN ===");
    println!("  - Jurnal: {}", before.journal_entries);
    println!("  - Baris Jurnal: {}", before.journal_lines);
    println!("  - Log Audit: {}", before.audit_logs);
    println!("  - Batch Impor: {}", before.import_batches);

    println!("\n=== STATUS DATABASE SETELAH PEMBERSIHAN ===");
    println!("  - Jurnal: {}", after.journal_entries);
    println!("  - Baris Jurnal: {}", after.journal_lines);
    println!("  - Log Audit: {}", after.audit_logs);
    println!("  - Batch Impor: {}", after.import_batches);

    println!("\nData transaksi dibersihkan. Bagan akun, periode, dan pengaturan perusahaan dipertahankan.");
    Ok(())
}

fn print_help() {
    println!("Finova — Sistem Akuntansi & Pembukuan Web Terpadu Indonesia");
    println!();
    println!("Penggunaan:");
    println!("  finova                 mode pengembangan: server saja, alamat dicetak di konsol");
    println!("  finova -app            aplikasi desktop: satu jendela native WebView2");
    println!("  finova -browser        server + buka di peramban web");
    println!("  finova -no-browser     server saja, tanpa membuka jendela");
    println!("  finova db:init         inisialisasi database lokal");
    println!("  finova db:clean        bersihkan data transaksi, pertahankan akun & periode");
    println!("  finova version         tampilkan versi aplikasi");
    println!();
    println!("Pilihan (Flags):");
    println!("  -port <port>           tentukan port HTTP (bawaan: 0 = otomatis)");
    println!("  -db <path>             lokasi berkas SQLite");
    println!("  -static <folder>       folder aset frontend eksternal");
    println!("  -url <url>             alamat kustom yang dituju jendela desktop");
    println!("  -devtools              aktifkan perkakas pengembang di jendela");
}
