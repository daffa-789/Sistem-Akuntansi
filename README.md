# 🧮 Finova — Sistem Akuntansi

**Sistem Akuntansi Web Terpadu Indonesia** — aplikasi desktop native dengan backend **Rust (Axum + SQLite)** dan frontend **React 18 + Vite + TypeScript** yang tertanam (embedded) langsung di dalam biner.

![Rust](https://img.shields.io/badge/Rust-2021-dca338?logo=rust&logoColor=white)
![Axum](https://img.shields.io/badge/Axum-0.8-orange)
![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178c6?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-38bdf8?logo=tailwindcss&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003b57?logo=sqlite&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20native-0078d6?logo=windows&logoColor=white)

## ✨ Fitur

- 📊 **Bagan Akun (Chart of Accounts)** — akun dengan kode, grup, saldo normal, dan kategori arus kas.
- 🗓️ **Periode Akuntansi** — pembuatan periode dan penutupan periode (close period).
- 📒 **Jurnal Umum** — buat, edit, posting, flag, dan **reverse jurnal**; nomor voucher dibuat otomatis.
- 🧾 **Template Jurnal** — simpan template jurnal berulang dan impor template dari Excel.
- 🔍 **Audit Trail** — riwayat audit per jurnal (siapa mengubah apa, kapan).
- 📈 **Laporan** — neraca saldo (trial balance), buku besar, laporan jurnal, dan laporan keuangan.
- 📤 **Ekspor & Impor** — ekspor **XLSX** (native, via `rust_xlsxwriter`) dan **PDF** (via `printpdf`); impor data dari Excel (`calamine`).
- 🖥️ **Desktop Native Windows** — jendela aplikasi via `tao` + `wry`, frontend tertanam di biner (`rust-embed`), plus skrip pembuat installer.
- 🔒 **Aman secara default** — server hanya bind ke `127.0.0.1`, port dipilih dinamis oleh OS agar tidak bentrok dengan aplikasi lain.
- 🧪 **Teruji** — unit test Rust (`cargo test`) dan test UI (`vitest`).

## 🏗️ Arsitektur

```
┌──────────────────────────────────────────────┐
│  Finova (satu biner Windows)                 │
│                                              │
│  ┌────────────┐   HTTP    ┌───────────────┐  │
│  │ React 18   │ ────────► │ Axum 0.8      │  │
│  │ (embedded) │  :port    │ (Rust native) │  │
│  └────────────┘           └──────┬────────┘  │
│                                  ▼           │
│                          ┌───────────────┐   │
│                          │ SQLite        │   │
│                          │ (rusqlite)    │   │
│                          └───────────────┘   │
└──────────────────────────────────────────────┘
```

Frontend React dibuild dengan Vite (TailwindCSS + Recharts + SheetJS), lalu hasil build ditanamkan ke dalam biner Rust. Saat dijalankan, Axum membuka port lokal acak di `127.0.0.1` dan menampilkan UI di jendela desktop (`wry`).

## 📁 Struktur Proyek

```
Sistem-Akuntansi/
├── src-rust/               # Backend Rust (server + domain + desktop)
│   ├── main.rs             # Entry point
│   ├── config.rs           # Konfigurasi (port, DB, static dir)
│   ├── db/                 # Skema & koneksi SQLite
│   ├── domain/             # Model akuntansi (Account, Entry, Line, ...)
│   ├── desktop/            # Jendela native (tao + wry) & ikon
│   ├── export/             # Ekspor XLSX & PDF
│   └── httpapi/            # REST API Axum (accounts, journals, reports, ...)
├── src/                    # Frontend React 18 + Vite
│   ├── components/         # Layout, modals, views, ui, widgets
│   ├── backend/            # Accounting engine & layanan
│   ├── hooks/ services/ utils/
│   └── App.jsx / App.tsx
├── shared/                 # Tipe bersama TS ↔ Rust
├── scripts/                # Dev/build/installer helpers (.mjs)
├── Cargo.toml              # Manifest Rust
├── package.json            # Manifest Node (frontend + tooling)
└── vite.config.ts
```

## 🚀 Quick Start

### Prasyarat

- **Node.js** ≥ 20 dan npm
- **Rust** stable (toolchain terbaru)
- **Windows** (fitur desktop native memakai Win32 API)

### Menjalankan (mode pengembangan)

```bash
npm install
npm run dev            # menjalankan Vite dev server + cargo run sekaligus
```

Atau jalankan terpisah:

```bash
npm run dev:frontend   # Vite di port dev
npm run dev:server     # cargo run -- -no-browser
```

### Build & Installer

```bash
npm run build          # build frontend + build Rust (release, LTO)
npm run installer      # membuat installer Windows
```

### Testing

```bash
npm test               # cargo test + vitest run
npm run typecheck       # tsc --noEmit
```

## ⚙️ Konfigurasi

Konfigurasi lewat file `.env` (lihat `.env.example`):

| Variabel | Keterangan |
| --- | --- |
| `PORT` | Kosongkan agar OS memilih port bebas (disarankan). |
| `VITE_PORT` | Port Vite dev server. |
| `CLIENT_ORIGIN` | Hanya perlu saat dev bila frontend memanggil API lintas asal. |
| `DATABASE_FILE` | Lokasi file SQLite (default `./database/finova.sqlite`). |
| `OPERATOR_NAME` | Nama operator (untuk audit trail). |
| `COMPANY_NAME` | Nama perusahaan. |
| `STATIC_DIR` | Folder aset frontend; kosongkan untuk memakai aset tertanam di biner. |

## 📜 Skrip NPM

| Skrip | Fungsi |
| --- | --- |
| `npm run dev` | Dev: Vite + Rust server |
| `npm run build` | Build frontend + server (release) |
| `npm run installer` | Buat installer Windows |
| `npm run db:init` | Inisialisasi database |
| `npm test` | Semua test (Rust + UI) |
| `npm run typecheck` | Cek tipe TypeScript |
| `npm run deps:audit` | Audit ukuran dependensi |

## 🔌 REST API (ringkas)

Server Axum mengekspos endpoint seperti:

- `GET/PUT /company` — data perusahaan
- `GET/POST /accounts`, `PUT /accounts/{id}` — bagan akun
- `GET/POST /periods`, `POST /periods/{id}/close` — periode
- `GET /journals/next-voucher` — nomor voucher berikutnya
- `POST /journals`, `PUT/DELETE /journals/{id}` — jurnal
- `POST /journals/{id}/post` · `/reverse` — posting & reverse
- `GET /journals/{id}/audit` — audit trail
- `GET /templates`, `POST /templates`, `DELETE /templates/{id}` — template jurnal
- `POST /imports/template`, `/imports/preview`, `/imports/confirm` — impor Excel
- `/exports/...` — ekspor jurnal/buku besar/neraca saldo (XLSX & PDF)
- `GET /health` — health check

---

Dibuat dengan ☕ dan Rust oleh **daffa-789**.
