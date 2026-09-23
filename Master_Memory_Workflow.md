---
type: memory
kind: project
name: "master-sistem-akuntansi"
description: "Memory terpusat Finova — aplikasi akuntansi: satu biner Go (net/http + SQLite modernc) dengan React/TS di-embed, mode desktop jendela WebView2, NSIS installer"
scope: project
project: "Sistem Akuntansi (Finova)"
status: active
updated: 2026-09-23
tags: ["memory/project", "project/Sistem Akuntansi"]
---

# Master Memory Workflow — Finova (Sistem Akuntansi)

> Memory terpusat proyek ini, disusun 23 September 2026. Menggabungkan `README.md` proyek
> (diarsipkan verbatim di bawah) dan **`Master_Memory_Workflow.md` versi memori Qoder**
> (8 keputusan kanonik 21–23 Sep 2026 — juga diarsipkan verbatim). Bagian ini ringkasannya;
> kalau ada perbedaan detail, arsip verbatim + bagian R4 di bawah yang berlaku.

**Lokasi:** `C:\Users\Daffa\Desktop\Folder Space AI\Folder Space Semester 7\Sistem Akuntansi`
**Nama produk:** *Finova — Sistem Akuntansi & Pembukuan Web Terpadu Indonesia*
(`package.json`: `finova-akuntansi`, productName `Finova`, v1.0.0 · Go module `finova`, go 1.27.1)
**Status:** aktif, ter-git (11 commit; terakhir 2026-09-23 `feat(ui): sistem desain token dan mode gelap yang benar`).
`README.md` proyek **sangat akurat** — semua klaimnya terverifikasi cocok dengan kode.

## R1. Angka Kunci

| Aspek | Nilai |
|---|---|
| Go | ±7.574 LOC (cmd+internal+tools, 29 berkas `.go`) |
| Frontend | ±5.970 LOC TS/TSX (42 berkas `src`) |
| Skema SQL | 190 baris, **10 tabel**, 36 akun COA seed |
| Biner | `finova.exe` **18.266.624 B (17,4 MiB)** |
| Installer | NSIS 5,6 MiB (LZMA 31,6%) → `build\bin\Finova-Setup-1.0.0-amd64.exe` |
| Dependensi runtime FE | hanya 4: react, react-dom, lucide-react, recharts |
| `node_modules` | ±185 MB (~200 paket top-level) — **dipertahankan atas keputusan user** |
| Port | **tidak ada port tetap** — server bind `127.0.0.1:0` dan OS yang memilih; Vite juga port acak |

## R2. Bentuk Arsitektur (keputusan paling penting)

**Satu biner server Go** — API `net/http` + `http.ServeMux` berpola (Go 1.22+, tanpa framework web)
**plus aset React yang di-embed** (`//go:embed all:dist` dari `internal/web/dist`) dengan fallback SPA.

**Aplikasi jendela, bukan tab peramban** (berubah 2026-09-23): `finova -app` membuka satu jendela
Win32 ber-WebView2 dari `internal/desktop`. Shell-nya **bukan Wails dan bukan Electron** — hanya
binding COM `github.com/wailsapp/go-webview2` (murni-Go, tanpa CGO) + ±330 baris Win32 tulisan tangan.
Server tetap HTTP di `127.0.0.1`, hanya port-nya acak; frontend memanggil `/api` relatif seperti biasa,
sehingga tidak ada satu baris pun kode React/API yang berubah untuk mode desktop ini.

## R3. Aturan Keras (dari 8 keputusan kanonik — jangan dilanggar)

1. **Jangan pasang framework/CLI Wails.** Keputusan 2026-09-22 ("cukup server Go") dan 2026-09-23
   ("fokus desktop, jangan bergantung localhost") bertemu di titik ini: pakai **binding COM-nya saja**
   (`github.com/wailsapp/go-webview2`, murni-Go, `WebView2Loader.dll` sudah ter-embed di biner) dan
   tulis sendiri jendela Win32-nya. Jangan buat `wails.json`, jangan `wails build`, jangan `cmd/desktop`.
   "Desktop" = `bin/finova.exe -app` → satu jendela WebView2. **Perlu dicatat:** aturan lama yang
   melarang shell desktop apa pun sudah dicabut 2026-09-23 atas permintaan user.
2. **Finova tidak memakai port tetap** — bind `127.0.0.1:0`, OS yang memilih. Yang tinggal di sekitar:
   **3000 & 5000** = Express proyek Skripsi (`/api/health` membalas `"databaseMessage":"Database MySQL
   XAMPP..."`), **5173/5174** = Vite proyek AI VTUBER. Milik Finova:
   `{"ok":true,"service":"finova-api","runtime":"go"}`. **JANGAN pernah `Stop-Process` penghuni port
   apa pun** — `scripts/dev.mjs` lama melakukan itu pada 3000/5199 dan sudah dihapus. Sebelum debug
   "404/data salah", curl `/api/health` dan pastikan `"service":"finova-api"`. Vite hanya bind `::1` →
   akses lewat `http://localhost:<port>`, bukan `127.0.0.1`.
3. **Build selalu** `-trimpath -ldflags "-s -w"` (hemat ±28%) + versi via `-X main.version=`.
   Installer NSIS 3.12 di `C:\Program Files (x86)\NSIS\makensis.exe` (**di luar PATH**), skrip
   `scripts/make-installer.mjs`, `.nsi` di `build/windows/installer/finova.nsi`. Pasang
   **per-pengguna** ke `%LOCALAPPDATA%\Programs\Finova` (`RequestExecutionLevel user`, tanpa UAC);
   data di `%APPDATA%\Finova`. Jangan perkenalkan runtime Node; jangan taruh data di folder instalasi.
4. **`internal/config`:** pakai `database/` di repo bila `go.mod` ada (mode dev), jika tidak `%APPDATA%\Finova`.
5. **Jangan usul** hapus `node_modules` atau commit artefak build (`bin/`, `internal/web/dist/*`
   di-gitignore, hanya `.gitkeep`) — user memilih biarkan pada 2026-09-23. Konsekuensinya: clone +
   `go build` tanpa `npm install` menghasilkan biner ber-UI kosong.
6. **Pemutar musik:** audio YouTube **hanya via penyematan IFrame resmi**. Mengunduh/menyimpan audio
   YouTube ke disk **tidak boleh dibuat** (hak cipta + ToS). Audio impor user hidup di IndexedDB
   (`finova-music`, store `meta` + `audio`). Bila diminta "unduh lagu/ekspor MP3 dari link YouTube":
   tolak bagian unduhnya, tawarkan jalur sah.
7. **Ukuran biner sudah diaudit** — tiga opsi pemangkasan (UPX, lepas recharts, gzip aset web)
   **ditolak user 2026-09-23**. Kalau topik ini muncul lagi: tunjukkan tabel R1, jangan audit ulang.
   Breakdown: Go runtime ±1,2 MiB · `net/http`+TLS/HTTP2 ±5,6 · `modernc.org/sqlite` ±5,0 ·
   `excelize` ±3,1 · fpdf+app+aset web+`.syso` ±2,7.
8. **Operator tunggal tanpa login.** Baris `users` tetap ada karena FK `NOT NULL` pada
   `created_by`/`uploaded_by`; nama operator dari `OPERATOR_NAME`.

## R4. Verifikasi UI Tanpa Merusak Data Demo

`database/finova.sqlite` di-gitignore **tapi hidup** (bootstrap menulis tiap start; isinya jurnal demo).

```bash
# salin ke folder gores, jalankan di port gores
PORT=5277 DATABASE_FILE=./tmp-tampil/finova.sqlite ./bin/finova.exe -no-browser
# sesudah selesai: hapus berkas + -shm + -wal. JANGAN bunuh proses port 5000.
```
- UI biner berasal dari `internal/web/dist` (go:embed) → **`npm run build` dulu**, `vite dev` saja tidak cukup.
- `window.confirm` asli **memblokir kanal CDP** (timeout, tab tidak pulih) → uji dialog lewat
  vitest `@vitest-environment jsdom` (contoh: `src/components/modals/JournalModal.test.tsx`), dan
  stub `Element.prototype.scrollIntoView` di jsdom.
- Setelah uji tulis: cek `audit_logs` dari baris nyasar.

## R5. Verifikasi Visual Nyata (Playwright)

- Peramban dalam-aplikasi (MCP `browser-use`) bisa melaporkan `innerWidth/innerHeight = 0` → `vh`
  runtuh, media-query aktif, `getBoundingClientRect` 0×0. **Itu bukan bukti layout rusak** — style
  terhitung tetap valid, geometri & screenshot tidak.
- Playwright 1.61.1 **global** (`%AppData%\npm\node_modules`, Chromium di `ms-playwright/chromium-1228`),
  bukan dependensi proyek:
  `NODE_PATH="C:/Users/Daffa/AppData/Roaming/npm/node_modules" node skrip.mjs` (taruh skrip di folder sementara).
- Kirim fungsi asli ke `page.evaluate(fn)` — **jangan string** (regex `\s`/`\d` rusak di template literal).
- Bukti cetak: `page.emulateMedia({media:'print'})` + `getComputedStyle`, `page.pdf()`.
- **Aturan:** setiap ubah CSS/layout → server port gores + DB salinan + probe Playwright,
  lihat sendiri gambarnya sebelum melaporkan selesai.

## R6. Fakta Teknis

- **Stack:** Go murni `net/http` · SQLite **`modernc.org/sqlite`** (murni-Go, tanpa CGO, WAL aktif) ·
  `xuri/excelize/v2` (indirect `go-pdf/fpdf` untuk PDF) · React 18 + TSX strict + Tailwind
  (tema **Glassmorphism** light/dark) + Vite · kontrak data bersama di `shared/types.ts`.
- **Struktur:** `cmd/finova` (main + `.syso` + manifest) · `internal/{config,db(+schema),desktop,domain,export,httpapi,web(+dist),xlsx}` ·
  `scripts/*.mjs` (+ `uji-installer.ps1`) · `tools/genicon` · `shared/types.ts` ·
  `src/{components/{layout,modals,ui,views,widgets},hooks,services,utils}` · `database/` · `build/windows`.
- **Perintah:** dev `npm install` → `go mod download` → `npm run dev` (Go bind port acak, port-nya
  dibaca dari stdout lalu diwarisi Vite sebagai `VITE_API_PORT`; Vite juga port acak) ·
  desktop `npm run build` → `npm start` (= `bin/finova.exe -app`) · `npm run installer` · lain:
  `dev:frontend`, `dev:server`, `build:client`, `build:server`, `icon`, `test`, `test:go`, `test:ui`,
  `vet`, `typecheck`, `deps:audit`, `clean`, `db:init`, `db:clean`.
  Biner: `-app` (jendela), `-browser` (buka di peramban — jalur debug), `-no-browser` (server saja,
  dipakai alur uji port gores), `-port`, `-db <path>`, `-static`, `-url <alamat>` (mis. URL Vite),
  `-devtools`; subperintah `db:init`, `db:clean`, `version`, `help`.
- **Jendela desktop (`internal/desktop/window_windows.go`)** — tiga jebakan yang sudah dibayar mahal,
  jangan ditebak ulang:
  - `hCursor` pada `WNDCLASSEXW` wajib HANDLE hasil `LoadCursorW`; mengisi `MAKEINTRESOURCE(IDC_ARROW)`
    ditolak `RegisterClassExW` dengan `ERROR_INVALID_PARAMETER` tanpa penjelasan.
  - `x/y = CW_USEDEFAULT` pada `CreateWindowExW` membuat **lebar/tinggi diabaikan** (Windows memilih
    ukuran sendiri). Ukuran dihitung eksplisit dari work area + DPI (`centeredBounds`).
  - `LazyProc.Call` selalu mengembalikan `Errno`, termasuk `Errno(0)` "berhasil" sebagai interface
    bukan-nil — cek **nilai kembali** API-nya, jangan `err != nil`, kalau tidak mau muncul pesan
    absurd "gagal: The operation completed successfully."
  Runtime WebView2 sudah ada di mesin user (v153, HKLM). Profil browser ditanam di
  `<folder data>/webview2` (`Config.WebViewUserData`). Ikon jendela diambil dari biner sendiri lewat
  `ExtractIconExW`, taskbar diidentifikasi via `SetCurrentProcessExplicitAppUserModelID`.
- **10 tabel:** `companies, users, accounts, accounting_periods, import_batches, journal_entries,
  journal_lines, audit_logs, journal_templates, music_tracks`. Seed: 1 perusahaan
  (`PT Finova Akuntansi Indonesia`) + **36 akun COA** kode 4 digit (`INSERT OR IGNORE INTO accounts`).
- **Endpoint (`internal/httpapi/server.go`, otoritatif):** `GET /api/health` · `GET|PUT /api/company` ·
  `GET|POST /api/accounts`, `PUT /api/accounts/{id}` · `GET|POST /api/periods`,
  `POST /api/periods/{id}/close` · `GET /api/journals/next-voucher`, `POST /api/journals`,
  `GET|PUT|DELETE /api/journals/{id}`, `POST /api/journals/{id}/post|reverse`, `GET /api/journals/{id}/audit` ·
  `GET /api/imports/template`, `POST /api/imports/preview`, `POST /api/imports/{id}/confirm` ·
  `GET /api/reports/{kind}` · `GET /api/exports/{journal.xlsx|journal.pdf|ledger.xlsx|trial-balance.xlsx|accounts.xlsx}` ·
  `GET|POST /api/templates`, `DELETE /api/templates/{id}` · `GET|POST /api/tracks`,
  `PUT /api/tracks/order`, `DELETE /api/tracks/{id}` · `GET /api` + `/` (statis/SPA).
  String `/api/auth/*` **hanya** muncul di `*_test.go` — bukan rute nyata (konsisten "tanpa login").
- **Fitur:** siklus akuntansi lengkap (Jurnal Umum → Buku Besar → Neraca Saldo → Laporan Keuangan),
  format jurnal SAK (debit rata kiri, kredit menjorok `↳`, garis ganda), rekapitulasi, auto-balance,
  13 template transaksi, panduan ALERE, ekspor xlsx/pdf server-side, pemutar musik (embed YouTube +
  impor audio). Pintasan: Ctrl+K, Esc, Alt+P / Alt+←→ / Alt+M; grid jurnal Enter / Ctrl+Enter / Ctrl+S /
  Ctrl+D / Shift+D / K.

## R7. Aturan Memory Proyek Ini

Berkas ini **satu-satunya memory terpusat** proyek. Memory Qoder scope proyek ini
(`.qoder/projects/C--Users-Daffa-Desktop-Sistem-Akuntansi/memory/`) sudah dipindahkan isinya ke sini
dan hanya boleh dipertahankan sebagai index tipis yang menunjuk ke berkas ini.

---

## Peta Dokumen Proyek

Berkas ini adalah **satu-satunya memory terpusat** untuk proyek `Sistem Akuntansi`.
Perubahan berarti dicatat di sini lewat commit `docs(memory): catat …`.

### Diserap ke arsip di bawah (file aslinya dihapus)
- `Sistem Akuntansi` root: `README.md` → **file aslinya dihapus**
- memori Qoder: `qoder-store/Master_Memory_Workflow.md` → arsip saja, **berkas aslinya tidak disentuh**

### Dibiarkan (bukan memory)
- store Qoder: memory/Master_Memory_Workflow.md (berkas aslinya tidak dihapus — jadi penunjuk)

---

## Arsip Dokumen Sumber (verbatim)

Isi setiap sumber dipertahankan apa adanya; separator hanya menandai batas antar dokumen.
Diarsipkan saat konsolidasi memory 2026-09-23 (generator satu-kali pakai, sudah dihapus)

<!-- ARCHIVE-BEGIN -->
<details>
<summary>README.md · 331 baris · disalin verbatim</summary>

<!-- BEGIN SOURCE: README.md -->

# Finova — Sistem Akuntansi & Pembukuan Web Terpadu Indonesia

Finova adalah aplikasi sistem informasi akuntansi berbasis web (**backend Go + frontend React/TypeScript**) yang dirancang khusus agar rapi, interaktif, dan mudah digunakan—baik untuk operasional pembukuan UMKM/bisnis maupun untuk siswa dan mahasiswa akuntansi yang sedang mempelajari siklus akuntansi lengkap (*Jurnal Umum -> Buku Besar -> Neraca Saldo -> Laporan Keuangan*).

Server API ditulis ulang dalam **Go murni** (`net/http` + driver SQLite tanpa CGO) dan frontend React hasil build **ditanam ke dalam biner** lewat `go:embed`. Hasilnya: **satu berkas `finova.exe`** yang menjalankan seluruh aplikasi — tanpa Node.js saat berjalan, tanpa Electron, dan tanpa basis data MySQL/XAMPP. Data tersimpan di berkas lokal `database/finova.sqlite` dan siap dipakai secara instan begitu aplikasi dijalankan.

---

## 🛠️ Tech Stack & Arsitektur

- **Backend**: [Go](https://go.dev/) (`net/http` + `http.ServeMux` berpola, Go 1.22+), tanpa framework web pihak ketiga
- **Database**: SQLite 3 lewat driver murni Go [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite) (tanpa CGO/gcc), mode Write-Ahead Logging (WAL)
- **Skema & seed**: `internal/db/schema/schema.sqlite.sql` ditanam ke biner (`go:embed`) dan diterapkan otomatis saat pertama berjalan
- **Excel**: [`excelize`](https://github.com/xuri/excelize) untuk templat impor dan pembacaan berkas unggahan di sisi server
- **Frontend**: [React 18](https://react.dev/) + **TSX** (Strict TypeScript), [Tailwind CSS](https://tailwindcss.com/) dengan tema Glassmorphism (Light & Dark Mode), dibangun oleh [Vite](https://vitejs.dev/)
- **Aset frontend**: hasil build Vite (`internal/web/dist`) di-embed ke biner Go, dilayani dengan fallback SPA untuk rute dalam
- **Shared Types**: `shared/types.ts` sebagai kontrak data frontend; kunci JSON backend mengikuti nama kolom SQLite
- **Testing**: `go test` (unit akuntansi, lapisan database, integrasi HTTP penuh) + [Vitest](https://vitest.dev/) untuk komponen & utilitas frontend
- **Export Engine (sisi server)**: `.xlsx` dibuat `internal/export` memakai excelize, `.pdf` memakai [go-pdf/fpdf](https://github.com/go-pdf/fpdf) — endpoint `/api/exports/*`

---

## ✨ Kemampuan & Fitur Utama

### 1. Database Lokal Mandiri (Zero-Setup)
- Berbasis SQLite lewat driver murni Go `modernc.org/sqlite` dengan mode Write-Ahead Logging (WAL) yang cepat dan aman — tidak perlu C/C++ toolchain.
- **Auto-bootstrap**: saat biner pertama kali dijalankan, skema ditanam dan aplikasi otomatis membuat tabel, Bagan Akun Indonesia lengkap (36 akun standar), periode akuntansi tahun berjalan, baris operator pencatat transaksi, dan templat transaksi.
- Tidak perlu install XAMPP, menyalakan Apache/MySQL, atau membuat database di phpMyAdmin.

### 2. Standar Laporan Jurnal Umum (General Journal)
- **Format Buku Jurnal Klasik Sesuai Standar Akuntansi Indonesia (SAK / SMK & Kampus)**:
  - Akun **Debit** ditulis rata kiri dengan huruf tegas.
  - Akun **Kredit** ditulis **menjorok ke kanan (*indented*)** dengan simbol penunjuk `↳`.
  - Keterangan memo transaksi dicetak miring (*italic*) di bawah nama akun.
  - Kolom **Ref** (Referensi posting kode akun).
  - Baris **Total Jurnal Umum** dengan garis ganda (*double-underline*) khas akuntansi dan indikator status seimbang (*Balanced*).
- **Tabel Rekapitulasi Jurnal Umum**:
  - Menyajikan ringkasan total per akun Debit vs Kredit sebelum diposting ke Buku Besar.
- **Fitur Cetak & Ekspor Resmi**:
  - **Cetak Dokumen**: Layout cetak rapi siap print ke kertas A4 / simpan ke PDF dengan kop nama perusahaan dan lembar tanda tangan pengesahan (Dibuat Oleh Staf, Diperiksa Oleh Dosen/Auditor, Disetujui Oleh Pimpinan).
  - **Ekspor Excel (`.xlsx`)**: Berisi sheet Jurnal Umum lengkap dengan format angka uang serta sheet Rekapitulasi Jurnal.
  - **Ekspor PDF (`.pdf`)**: Layout tabel profesional siap presentasi atau pengumpulan tugas.

### 3. Pencatatan Jurnal Ramah Pengguna
- **Panduan Saldo Normal (ALERE Cheat Sheet)**:
  - Penjelasan interaktif persamaan dasar akuntansi (*Aset = Liabilitas + Ekuitas*) dan aturan penambahan/pengurangan akun (*Aset/Beban di Debit, Liabilitas/Ekuitas/Pendapatan di Kredit*).
- **Indikator Keseimbangan Cerdas (Real-time Balance Indicator)**:
  - Menampilkan selisih nominal secara langsung dan memberi tahu sisi mana yang kurang (misal: *"⚠️ Sisi Kredit kurang Rp 1.500.000"*).
- **Tombol Auto-Balance**:
  - Otomatis menghitung selisih dan mengisinya ke baris akun yang kosong secara instan.
- **13 Template Transaksi Akuntansi Siap Pakai**:
  - Setoran Modal Awal, Beli Perlengkapan Tunai, Beli Peralatan Kredit, Pendapatan Jasa Tunai/Kredit, Pelunasan Piutang, Pembayaran Utang Usaha, Beban Gaji, Beban Sewa, Beban Utilitas, Prive Pemilik, hingga Jurnal Penyesuaian (AJP).

### 4. Siklus Akuntansi Terintegrasi
- **Buku Besar (General Ledger)**: Menampilkan mutasi per akun dengan perhitungan saldo berjalan otomatis (*running balance*).
- **Neraca Saldo (Trial Balance)**: Memverifikasi keseimbangan debit dan kredit seluruh akun.
- **Bagan Akun (Chart of Accounts)**: Eksplorasi akun berdasarkan kelompok (Aktiva, Liabilitas, Ekuitas, Pendapatan, Beban) dan saldo normalnya.
- **Dashboard Keuangan**: Grafik kinerja pendapatan vs beban serta indikator kas & bank real-time.
- **Operator tunggal**: aplikasi lokal tanpa login; setiap transaksi tetap tercatat atas nama operator dan meninggalkan jejak audit lengkap di `audit_logs`.

### 5. Pemutar Musik (Kiri Atas, Minimalis, Bisa Ditutup)
Pemutar musik berupa strip ramping di **kiri atas** area kerja, bukan bar besar di bawah:

- **Piringan minimalis** — lingkaran datar 38 px dengan alur halus; **berputar saat lagu
  jalan** dan **label tengahnya memakai sampul lagu** yang sedang diputar, jadi tampilannya
  ikut berganti tiap lagu. Klik piringan = putar/jeda.
- **Bisa ditutup** — tombol `×` meliput widget menjadi chip piringan kecil di pojok kiri atas
  (atau `⌃` untuk mengecilkan); tombol panah pada chip membukanya kembali. Mode ini tersimpan
  di `localStorage`, jadi tetap sama saat aplikasi dibuka lagi.
- **Sumber lagu**: (a) tempel tautan YouTube — diputar lewat *YouTube IFrame Player API* resmi,
  judul/pemegang hak/sampul diambil otomatis oleh server lewat oEmbed; (b) impor **berkas audio
  milik sendiri** (mp3, m4a, ogg, opus, wav, flac) yang tersimpan di IndexedDB peramban.
- **Kelola berkas dan daftar putar**
  - *Simpan berkas ke komputer* — menyalin ulang berkas audio **milik Anda sendiri** dari
    peramban ke folder unduhan (untuk dipindah ke perangkat lain).
  - *Ekspor .m3u* — daftar putar menjadi berkas teks berisi **tautan** YouTube (bukan audio),
    bisa dibuka di VLC/Winamp.
  - *Hapus lagu* per baris dan *Kosongkan* seluruh daftar (lagu tersimpan + berkas di peramban),
    dengan konfirmasi.
  - Daftar lagu YouTube disimpan di basis data (`music_tracks`) sehingga ikut terbawa saat
    folder data dipindah.
- **Kontrol**: lagu sebelumnya/berikutnya, geser posisi, volume, bisukan, acak, ulang satu lagu,
  dan lanjut otomatis saat lagu selesai. **Pintasan**: `Alt+P`, `Alt+→` / `Alt+←`, `Alt+M`.
- Dock tidak ikut tercetak (`@media print` + kelas `no-print`) dan menghormati
  `prefers-reduced-motion`: bila animasi dimatikan di sistem, piringan berhenti berputar dan
  diganti cincin aksen statis sebagai tanda "sedang diputar".
- Bawaan awal berisi tiga lagu resmi kanal **Lyn - Topic** (distribusi OST Atlus/Sony):
  *Rivers In the Desert*, *Life Will Change*, *Last Surprise*. Saran ini otomatis hilang begitu
  daftar putar Anda berisi lagu sendiri. Sebagian kanal menonaktifkan penyematan — tersedia
  tombol "Buka di YouTube" pada tiap baris.

> **Catatan hak cipta**: aplikasi ini **tidak mengunduh audio dari YouTube**. Pemutaran memakai
> pemutar resmi YouTube, dan penyalinan lagu Atlus ke berkas adalah pelanggaran ketentuan
> YouTube serta hak cipta. Yang bisa disimpan ke komputer hanyalah berkas audio yang Anda
> impor sendiri.

---

## 📁 Struktur Proyek

```text
Sistem-Akuntansi/
├── cmd/
│   └── finova/main.go      # Satu-satunya biner: serve (default), db:init, db:clean, version
├── internal/               # Paket Go (tidak diekspor ke luar modul)
│   ├── config/             # Pembaca berkas .env + variabel lingkungan
│   ├── db/                 # Lapisan SQLite: pragma, Row map, transaksi, pembersihan data
│   │   └── schema/         # schema.sqlite.sql (ditanam ke biner lewat go:embed)
│   ├── domain/             # Aturan pembukuan: validasi jurnal, neraca saldo, laba rugi,
│   │                       # neraca, perubahan modal, arus kas, jurnal penutup
│   ├── export/             # Pembuat berkas laporan .xlsx (excelize) dan .pdf (go-pdf/fpdf)
│   ├── httpapi/            # Rute /api/*, CORS, pemetaan galat, layanan jurnal/periode/impor/laporan
│   ├── web/                # go:embed hasil build frontend + penyimpan berkas SPA (fallback index.html)
│   └── xlsx/               # Pembuat templat & parser berkas Excel impor (excelize)
├── scripts/                # Alat bantu npm
│   ├── dev.mjs             # Menjalankan Go API + Vite HMR bersamaan
│   ├── build-go.mjs        # `go build` ramping (-trimpath -s -w) + ikon per OS
│   ├── make-installer.mjs  # Bangun biner lalu jalankan makensis -> installer .exe
│   ├── start.mjs           # Menjalankan biner produksi (build bila belum ada)
│   ├── keep-dist.mjs       # Memulihkan penanda internal/web/dist/.gitkeep setelah build
│   ├── clean.mjs           # Bersihkan hasil build & cache
│   ├── audit-deps.mjs      # Deteksi paket npm yang tidak terpakai
│   └── uji-installer.ps1   # Uji pasang-jalankan-lepas installer
├── tools/
│   └── genicon/            # Penggambar ikon aplikasi (prosedural, tanpa aset unduhan)
├── build/windows/          # icon.ico hasil genicon + installer/finova.nsi + catatan.txt
│                           # (build/bin/ berisi installer jadi, tidak di-commit)
├── shared/
│   └── types.ts            # Tipe domain frontend (cermin kunci JSON dari Go)
├── src/                    # Frontend React 18 + TSX
│   ├── components/
│   │   ├── layout/         # AppShell, OnboardingWalkthrough
│   │   ├── modals/         # JournalModal, ReverseJournalModal, TemplateModal, AuditLog, dsb.
│   │   ├── ui/             # Reusable UI (Button, Modal, Badge, AccountPicker, AmountInput, ...)
│   │   └── views/          # Dashboard, Accounts, Journals, Ledger, TrialBalance
│   ├── services/           # downloads.ts (unduh berkas dari /api/exports),
│   │                       # localAudio.ts (berkas audio pengguna di IndexedDB)
│   ├── utils/              # formatters, validators, music.ts (parsing & urutan lagu)
│   ├── hooks/              # useLoad, useYouTubePlayer (IFrame API resmi)
│   ├── components/widgets/ # MusicPlayer (piringan berputar + daftar putar)
│   ├── api.ts              # HTTP client bertipe
│   ├── App.tsx             # Root layout & view switcher
│   └── main.tsx            # React DOM mounting
├── database/               # Berkas data lokal (finova.sqlite, WAL) — di-gitignore
├── bin/                    # Biner hasil `npm run build` — di-gitignore
├── index.html              # HTML entry point (mengarah ke /src/main.tsx)
├── go.mod / go.sum         # Modul Go `finova` dan kunci dependensi
├── tsconfig.json           # Konfigurasi TypeScript compiler (strict: true)
├── vite.config.ts          # Build klien ke internal/web/dist + proxy /api ke Go
├── tailwind.config.js      # Konfigurasi Tailwind CSS
└── package.json            # Skrip npm & dependensi frontend
```

---

## 🌐 Cara Menjalankan Aplikasi Web

### Prasyarat
- **Go 1.22 atau lebih baru** (wajib; modul memakai `http.ServeMux` berpola). Unduh di [go.dev/dl](https://go.dev/dl/), cek dengan `go version`. Tidak perlu GCC/CGO karena driver SQLite murni Go.
- **Node.js 18+ dan npm** — hanya untuk membangun frontend React dan menjalankan perkakas pengembangan. Biner hasil build berjalan tanpa Node sama sekali.
- **NSIS 3** (opsional) — hanya bila ingin membuat installer Windows (`npm run installer`).

### 🚀 1. Mode Pengembangan (Development)
Frontend Vite (HMR) + backend Go berjalan bersamaan:

```bash
npm install          # dependensi perkakas frontend
go mod download      # dependensi Go (sekali per mesin/ubah modul)
npm run dev
```

- **Frontend**: [http://localhost:3000](http://localhost:3000) — proxy `/api` otomatis ke port Go
- **Backend API (Go)**: port dari `PORT` di `.env` (bawaan proyek ini `5199`, lihat catatan port di bawah)

### 📦 2. Mode Produksi (Build & Jalankan Satu Biner)

```bash
npm run build        # vite build -> internal/web/dist, lalu go build -> bin/finova.exe
npm start            # jalankan biner produksi (frontend sudah tertanam di dalamnya)
```

Aplikasi siap diakses di alamat yang dicetak konsol, mis. [http://localhost:5199](http://localhost:5199).

Karena seluruh aset ikut tertanam, berkas `bin/finova.exe` dapat disalin ke komputer lain dan
langsung dijalankan — tanpa instalasi Node, tanpa Electron, tanpa MySQL:

```bash
bin\finova.exe                      # jalankan server (perintah default: serve)
bin\finova.exe -port 8080           # ganti port
bin\finova.exe -db D:\data\uji.db   # pakai basis data lain (mis. untuk uji coba)
bin\finova.exe db:init              # terapkan skema lalu keluar
bin\finova.exe db:clean              # kosongkan transaksi, pertahankan bagan akun
bin\finova.exe version              # info versi & arsitektur biner
```

> Port `5000` sering dipakai aplikasi lokal lain (mis. perkakas XAMPP/MySQL). Berkas `.env`
> proyek ini sudah memakai `PORT=5199`. Untuk mengganti sementara:
> `PORT=5199 npm run dev` — proxy Vite ikut menyesuaikan karena membaca nilai `PORT` yang sama.

### 🧩 3. Installer Windows (satu klik pasang, tanpa hak administrator)

```bash
npm run installer
# -> build\bin\Finova-Setup-1.0.0-amd64.exe  (±5,5 MiB)
```

Perkakas yang dipakai: [NSIS 3](https://nsis.sourceforge.io/Download) (`makensis`). Skripnya ada di
`build/windows/installer/finova.nsi`; bila NSIS tidak ada di `PATH`, atur `MAKENSIS=C:\...\makensis.exe`
atau biarkan skrip memakai lokasi pemasangan standar. Ikon aplikasi tidak diunduh dari mana pun —
digambar oleh `tools/genicon` lalu ditanam ke `.exe` lewat berkas `.syso` (`npm run icon` untuk membuatnya ulang).

Perilaku hasil pasang:

| Hal | Perilaku |
| --- | --- |
| Lokasi program | `%LOCALAPPDATA%\Programs\Finova` (per pengguna, tanpa UAC/admin) |
| Lokasi data | `%APPDATA%\Finova\finova.sqlite` + `finova.log` |
| Pintasan | Finova, Finova (dengan konsol), Hentikan Finova, Lepas Finova — plus opsi pintasan Desktop |
| Menjalankan | `finova.exe -app`: tanpa jendela konsol, log ke berkas, peramban terbuka otomatis di `http://localhost:5199` |
| Klik kedua | Tidak menabrak port: instans baru mendeteksi yang sudah jalan, membuka peramban, lalu keluar |
| Melepas | Melalui "Tambah atau hapus program" atau `uninstall.exe`; saat senyap (`/S`) data pembukuan selalu dipertahankan, saat interaktif ditanya dulu |

Cara menentukan letak data: bila `go.mod` ada (mode pengembangan) data tetap di `database/` dalam repo;
kalau tidak (aplikasi terpasang) data pindah ke `%APPDATA%\Finova`. Timpa kapan saja dengan `-db <jalur>`.

Uji pasang-jalankan-lepas secara otomatis:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\uji-installer.ps1
```

### 📏 Jejak disk (terukur di mesin pengembang)

| Komponen | Ukuran |
| --- | --- |
| `bin/finova.exe` (build strip `-s -w`, ikon, frontend tertanam) | 17,4 MiB |
| `Finova-Setup-1.0.0-amd64.exe` (LZMA solid) | 5,5 MiB |
| Terpasang (program + uninstaller) | 17,5 MiB |
| Aset frontend di dalam biner (setelah ekspor pindah ke server) | 0,65 MiB |
| `node_modules` — hanya untuk membangun UI, tidak dipakai saat berjalan | 159,5 MiB |

Build dirampingkan dengan `-trimpath -ldflags "-s -w"` (hemat ±28%: 24,6 → 17,7 MiB sebelum ikon).
Perpindahan pembuatan berkas laporan dari peramban ke server (`internal/export`) memangkas
`node_modules` dari 230,6 → 159,5 MiB (exceljs, jspdf, jspdf-autotable, html2canvas tidak dipakai lagi)
dan aset tertanam dari 2,31 → 0,65 MiB. Perbandingan era sebelumnya: pemasangan Electron lama
menempati **570 MiB** di disk (terukur dari mesin pengembang), dan server Node membutuhkan
`node.exe` (89 MB) saat berjalan.

### 📄 Berkas laporan dibuat server

| Endpoint | Hasil |
| --- | --- |
| `GET /api/exports/journal.xlsx` | Buku Jurnal Umum + Rekapitulasi Jurnal (dua sheet) |
| `GET /api/exports/journal.pdf` | Jurnal A4 portrait + rekapitulasi + lembar pengesahan |
| `GET /api/exports/ledger.xlsx` | Buku besar satu akun dengan saldo berjalan |
| `GET /api/exports/trial-balance.xlsx` | Neraca saldo |
| `GET /api/exports/accounts.xlsx` | Master bagan akun |

Semua menerima `from`, `to`, dan (untuk jurnal) `status`, `accountId`, `q`, `sort`, `dir` — sama dengan
filter yang sedang aktif di layar — serta `maker`, `checker`, `approver` untuk lembar pengesahan.
Nominal ditulis sebagai angka (bukan teks) agar masih bisa dijumlah di Excel, dengan format `#,##0`;
format tanggal dan "Rp" mengikuti konvensi Indonesia seperti tampilan aplikasi.

Untuk membersihkan hasil build dan cache yang selalu bisa dibuat ulang:

```bash
npm run clean            # hapus bin/, build/bin/, cache .vite
npm run clean -- --modules   # juga hapus node_modules (perlu `npm install` lagi)
npm run deps:audit       # daftarkan paket yang tidak terpakai
```

---

## 👤-operator Tunggal (Tanpa Login)

Aplikasi berjalan sebagai aplikasi lokal satu operator: **tidak ada halaman login, tanpa kata sandi, tanpa sesi JWT**. Website langsung terbuka ke Jurnal Umum.

Satu baris tetap disimpan di tabel `users` sebagai pencatat transaksi karena `journal_entries.created_by` dan `import_batches.uploaded_by` adalah foreign key `NOT NULL`. Nama pencatat itu dapat diganti lewat variabel `OPERATOR_NAME` di berkas `.env` dan akan muncul pada kolom pencatat jurnal serta Riwayat Audit.

---

## 💻 Daftar Perintah

| Perintah | Deskripsi |
| --- | --- |
| `npm run dev` | Go API + Frontend Vite (`:3000`) simultan |
| `npm run dev:frontend` | Hanya server pengembangan Vite (HMR) |
| `npm run dev:server` | Hanya backend Go (`go run ./cmd/finova`) |
| `npm run build:client` | Build frontend ke `internal/web/dist` (bahan `go:embed`) |
| `npm run build:server` | `go build` menjadi `bin/finova.exe` |
| `npm run build` | Keduanya: hasil akhirnya satu biner mandiri |
| `npm run installer` | Buat installer Windows NSIS di `build/bin/` |
| `npm run icon` | Gambar ulang ikon aplikasi (`tools/genicon`) |
| `npm start` | Jalankan biner produksi (dibangun otomatis bila belum ada) |
| `npm run test:go` | `go test ./...` — unit akuntansi, lapisan DB, integrasi HTTP |
| `npm run test:ui` | `vitest run` — tes komponen/utilitas frontend |
| `npm test` | Seluruh tes Go + frontend |
| `npm run vet` | `go vet ./...` |
| `npm run typecheck` | Pemeriksaan tipe TypeScript (`tsc --noEmit`) |
| `npm run deps:audit` | Daftarkan paket npm yang tidak terpakai + 12 terbesar |
| `npm run clean` | Hapus hasil build & cache yang bisa dibuat ulang |
| `npm run db:init` | Terapkan skema + seed, lalu keluar |
| `npm run db:clean` | Kosongkan tabel transaksi (bagan akun & periode dipertahankan) |
| `go run ./cmd/finova -db ./tmp/uji.sqlite` | Jalankan pada basis data terpisah untuk uji coba |

> Port `5000` kadang dipakai aplikasi lokal lain. Jika API Finova tidak merespons, jalankan dengan port cadangan:
> `PORT=5199 npm run dev` (proxy Vite ikut menyesuaikan karena membaca `PORT`).

---

## ⌨️ Pintasan Keyboard

| Shortcut | Fungsi |
| --- | --- |
| `Ctrl+K` | Pencarian akun cepat |
| `Esc` | Menutup jendela dialog / modal paling atas |
| `Alt+P` | Putar / jeda musik |
| `Alt+→` / `Alt+←` | Lagu berikutnya / sebelumnya |
| `Alt+M` | Bisukan / nyalakan suara |

### Di dalam form "Catat Transaksi"

| Shortcut | Fungsi |
| --- | --- |
| `Enter` | Simpan & posting (pada field), atau memilih akun yang disorot (saat mengetik kode akun) |
| `Ctrl + Enter` | Simpan & posting dari kolom mana pun |
| `Ctrl + S` | Simpan sebagai draft |
| `Enter` / `Shift+Enter` di grid | Turun / naik satu baris jurnal; baris baru dibuat otomatis di baris terakhir |
| `Ctrl + D` | Duplikasi baris jurnal yang sedang aktif |
| `Shift + D` / `Shift + K` | Pindahkan nominal ke sisi Debit / Kredit |
| `↑` / `↓` | Nominal ±1; `Shift` ±1.000; `Alt` ±100.000 |

<!-- END SOURCE: README.md -->
</details>
<details>
<summary>qoder-store/Master_Memory_Workflow.md · dari memori Qoder, berkas aslinya dipertahankan· 195 baris · disalin verbatim</summary>

<!-- BEGIN SOURCE: qoder-store/Master_Memory_Workflow.md -->

---
name: master-memory-workflow
description: Master memory for the Finova accounting app (Sistem Akuntansi) — Go single-binary architecture decisions, port 5000 conflict, installer conventions, safe UI verification workflow, binary size audit, music player rules, and toolchain decisions with their reasons
metadata:
  type: project
---

# Master Memory — Workflow Sistem Akuntansi (Finova)

Satu berkas ini menggantikan delapan entri memory proyek. Isinya keputusan + alasan + cara pakai,
bukan pola kode yang bisa dibaca ulang dari repo. Bagian yang berlaku untuk semua proyek pengguna
ada di memory tingkat pengguna (`C:\Users\Daffa\.qoder\memory`).

Daftar isi: [Arsitektur](#1-arsitektur-tanpa-cangkang-desktop) · [Port 5000](#2-port-5000-dihuni-aplikasi-lain) ·
[Installer](#3-konvensi-build--installer) · [Verifikasi UI aman](#4-verifikasi-tanpa-menyentuh-db-demo) ·
[Verifikasi visual](#5-verifikasi-visual-nyata-playwright) · [Ukuran biner](#6-audit-ukuran-biner) ·
[Pemutar musik](#7-batas-pemutar-musik) · [Toolchain frontend](#8-keputusan-toolchain-frontend)

---

## 1. Arsitektur: tanpa cangkang desktop

Finova dijalankan sebagai **satu biner server Go** yang melayani API + aset React (embed), bukan
aplikasi jendela desktop. Ditanya pada 2026-09-22 apakah perlu menambah cangkang Wails (CLI
`wails v2.16.0` memang terpasang di `~/go/bin/wails.exe`), pengguna memilih **"Tidak, cukup server Go saja."**

**Why:** tujuan migrasi ke Go adalah menggantikan Electron/Node dengan satu executable mandiri yang
diakses lewat peramban; shell desktop hanya menambah dependensi dan jalur build tanpa kebutuhan nyata.

**How to apply:** jangan menawarkan atau membuat `wails.json`, `cmd/desktop`, atau binding `wails build`
untuk proyek ini kecuali diminta kembali. Untuk kebutuhan "aplikasi desktop", arahkan ke
`bin/finova.exe` + membuka localhost di peramban (biner sudah bisa membuka peramban sendiri).

---

## 2. Port 5000 dihuni aplikasi lain

`http://localhost:5000/api/health` di mesin ini menjawab
`{"status":"ok","database":"connected","databaseMessage":"Database MySQL XAMPP terhubung lancar",...}`
— itu aplikasi Express milik proyek lain, bukan Finova. Milik Finova:
`{"ok":true,"service":"finova-api","runtime":"go"}`. Proses asing itu listen pada IPv6 `::` dan selalu
menang atas koneksi, sementara skrip dev juga sempat mematikan paksa penghuni port.

**Why:** Finova dulu default `PORT=5000` dan `vite.config.ts` menurunkan target proxy `/api` dari `PORT`
yang sama, jadi port yang direbut diam-diam membuat UI bicara ke backend yang salah — hasilnya bahkan
terlihat masuk akal dan memakan waktu debugging saat kerja hapus auth 2026-09-21.

**How to apply:** sejak konversi Go (2026-09-22) `.env`/`.env.example` memakai `PORT=5199`. Sebelum
men-debug "data salah" atau "404 pada route yang ada", curl `/api/health` lewat port Vite dan pastikan
membalas `"service":"finova-api"`. Override sementara: `PORT=5199 npm run dev`. **Jangan pernah**
`Stop-Process` penghuni port 5000 — itu proyek pengguna lain. Vite hanya bind `::1`, jadi pakai
`http://localhost:3000`, bukan `127.0.0.1:3000`.

---

## 3. Konvensi build & installer

Pengguna ingin Finova terasa seperti proyeknya yang lain (`C:\Users\Daffa\Desktop\Libray Game`): tanpa
node_modules saat berjalan, satu berkas kecil, ada installer.

- Build selalu `-trimpath -ldflags "-s -w"` (hemat ±28%) dan versi dari `package.json` lewat
  `-X main.version=...`.
- Installer = **NSIS 3.12** di `C:\Program Files (x86)\NSIS\makensis.exe` (tidak ada di PATH;
  `scripts/make-installer.mjs` mencari lokasi standar ini). Skrip: `build/windows/installer/finova.nsi`.
- Pasang **per pengguna** ke `%LOCALAPPDATA%\Programs\Finova` (`RequestExecutionLevel user`, tanpa UAC);
  data di `%APPDATA%\Finova`. Aturan `internal/config`: pakai `database/` di repo kalau `go.mod` ada
  (mode dev), selain itu `%APPDATA%\Finova`.
- Ikon digambar prosedural oleh `tools/genicon` lalu ditanam via `.syso` (rsrc) — jangan tambah aset
  biner unduhan.
- Artefak build (`bin/`, `build/bin/`) di-gitignore, sama seperti pola Libray Game.

**Why:** pengguna membandingkan ukuran proyeknya dan minta "hapus yang gak perlu agar ringan"; pemasangan
Electron lama menempati 570 MiB dan sudah dihapus dari mesinnya (2026-09-23).

**How to apply:** jangan perkenalkan dependensi runtime Node, jangan menaruh data di folder instalasi,
dan kalau menambah perkakas build ikuti pola `scripts/*.mjs` + entri `package.json`.

---

## 4. Verifikasi tanpa menyentuh DB demo

Basis data demo `database/finova.sqlite` di-gitignore tapi tetap hidup: bootstrap menulis ke sana setiap
aplikasi start, dan isinya adalah data jurnal untuk demo.

**Why:** menguji jalur tulis (buat → posting → balik) langsung ke berkas itu mencemari data demo, dan
jurnal terposting sengaja tidak bisa dihapus lewat UI — entri nyasar jadi permanen.

**How to apply:**
- Salin `database/finova.sqlite` ke folder gores, jalankan
  `PORT=5277 DATABASE_FILE=./tmp-tampil/finova.sqlite ./bin/finova.exe -no-browser`, lalu hapus berkas
  beserta `-shm`/`-wal` dan foldernya setelah selesai. Jangan bunuh proses asing di port 5000 (bagian 2).
- UI yang disajikan biner berasal dari `internal/web/dist` hasil `go:embed`, jadi **`npm run build` dulu**
  sebelum mengukur perubahan frontend; vite dev server saja tidak cukup untuk menguji biner.
- `window.confirm` asli memblokir kanal CDP peramban dalam aplikasi (setiap panggilan timeout, tab tidak
  terpulihkan). Uji perilaku dialog lewat vitest dengan `// @vitest-environment jsdom` — contohnya
  `src/components/modals/JournalModal.test.tsx`. jsdom tidak punya `scrollIntoView`; stub
  `Element.prototype.scrollIntoView` di tes komponen.
- Setelah menguji jalur tulis, cek `audit_logs` dari baris nyasar; bandingkan jumlah baris sebelum/sesudah
  suite sebagai invariant murah.

---

## 5. Verifikasi visual nyata (Playwright)

- **Peramban dalam aplikasi (MCP `browser-use`) bisa melaporkan `innerWidth`/`innerHeight` = 0.** Akibatnya
  satuan `vh` runtuh, `@media (max-width: …)` ikut aktif, dan `getBoundingClientRect()` jadi 0×0 — itu
  *bukan* bukti tata letak rusak. Style terhitung (warna, radius, bayangan, font) tetap valid di sana;
  geometri dan gambar layar tidak.
- **Playwright 1.61.1 terpasang global** di `C:\Users\Daffa\AppData\Roaming\npm\node_modules`, Chromium di
  `~/AppData/Local/ms-playwright/chromium-1228`. Playwright **bukan** dependensi proyek, jadi skrip gores
  dijalankan dengan `NODE_PATH="C:/Users/Daffa/AppData/Roaming/npm/node_modules" node skrip.mjs`; taruh di
  folder sementara dan hapus setelah selesai.
- **Kirim fungsi asli ke `page.evaluate(fn)`**, jangan string fungsi dari template literal: di dalam
  template literal `\s`, `\d`, `\(` kehilangan backslash sehingga regex di halaman rusak. Kalau terpaksa
  pakai string, gandakan setiap backslash.
- Tampilan cetak: `page.emulateMedia({ media: 'print' })` lalu baca `getComputedStyle`, dan `page.pdf()`
  kalau perlu bukti nyata hasil cetak.

**Why:** klaim "tampilan sudah bagus" baru bisa dibuktikan setelah pindah ke Playwright; pengukuran lewat
peramban dalam aplikasi menghasilkan angka menyesatkan.

**How to apply:** setiap mengubah CSS/tata letak dan perlu membuktikan geometri, mode gelap, atau kontras —
server port gores + DB salinan (bagian 4), probe Playwright, lalu **lihat sendiri gambar layarnya** sebelum
melapor selesai.

---

## 6. Audit ukuran biner

`finova.exe` = 18.266.624 B (17,4 MiB), dibongkar lewat probe build diferensial. Kesimpulan: **tidak ada
lemak yang bisa dipangkas tanpa membuang fitur**.

| Bagian | Perkiraan |
|---|---|
| Lantai Go (runtime + stdlib dasar) | ±1,2 MiB |
| `net/http` + TLS/kripto + HTTP/2 | ±5,6 MiB |
| SQLite murni-Go `modernc.org/sqlite` | ±5,0 MiB |
| `excelize` pemakaian gaya penuh (style, merge, freeze, write) | ±3,1 MiB |
| fpdf + kode aplikasi + aset web tertanam (0,7 MiB) + `.syso` | ±2,7 MiB |

Installer NSIS 5,6 MiB = LZMA 31,6% dari biner, hanya membungkus `finova.exe` + `catatan.txt`
(DB demo 1,68 MiB sengaja tidak ikut).

Tiga opsi pemangkasan ditawarkan dan **ditolak pengguna** pada 2026-09-23: UPX (terbesar, tetapi risiko
tanda antivirus/SmartScreen + startup lebih lambat dan installer justru tidak ikut kecil), melepas
recharts dari bundel web, dan menanam aset web dalam bentuk gzip.

**Why:** pengguna mengejar kerampingan ala Libray Game, jadi pertanyaan "bisa dikecilin lagi?" akan muncul
lagi; angka di atas hasil pengukuran nyata, bukan taksiran.

**How to apply:** kalau topik ukuran naik lagi, jangan audit ulang dari nol — tunjukkan tabel ini dan sebut
UPX sudah pernah ditolak. Ukur ulang hanya kalau dependensi berubah atau ada fitur baru yang menambah
bundel web.

---

## 7. Batas pemutar musik

Batas ini ditetapkan pengguna, bukan keputusan teknis:

- **Audio YouTube hanya boleh diputar lewat penyematan IFrame resmi YouTube.** Mengunduh/menyimpan audio
  YouTube ke disk tidak boleh dibuat — itu menyalin lagu berhak cipta (mis. Atlus untuk Persona) dan
  melanggar ketentuan YouTube.
- Berkas audio yang **diimpor pengguna** disimpan di IndexedDB (`finova-music`, store `meta` + `audio`) dan
  boleh disimpan ulang ke komputer atau dihapus olehnya.
- Daftar putar awal diisi tautan kanal resmi (pilihan pengguna), bukan rip/unggah ulang.
- Bentuk UI: pilis ramping kiri atas, piringan berputar dengan label = sampul lagu, bisa dikecilkan dan
  ditutup; pintasan Alt+P / Alt+←→ / Alt+M.

**Why:** pengguna ingin bekerja sambil dengar musik tanpa aplikasi jadi sarana pembajakan, dan ia
menyatakan sendiri bahwa pengunduh audio YouTube tidak boleh saya buat.

**How to apply:** untuk permintaan "unduh lagu" / "simpan audio YouTube" / "ekspor MP3 dari link YouTube",
tolak bagian unduhnya dan tawarkan jalur sah (putar via embed, atau impor berkas miliknya lalu simpan
berkas itu). Jangan ubah perilaku ini tanpa diminta.

---

## 8. Keputusan toolchain frontend

`node_modules` dipertahankan (±185 MB, 200 paket tingkat atas) dan `internal/web/dist/*` tetap
di-gitignore (hanya `.gitkeep` yang ikut commit). Dependensi runtime cuma empat: react, react-dom,
lucide-react, recharts — sisanya perkakas build (vite, vitest, typescript, tailwind, postcss, jsdom, @types).

Konsekuensi: clone baru + `go build` **tanpa** `npm install` menghasilkan biner dengan UI kosong, karena
aset web ditanam lewat `//go:embed all:dist`.

**Why:** ditanya apakah node_modules masih perlu dan setelah diberi tiga pilihan (biarkan / hapus saja /
commit `dist` supaya repo berdiri sendiri ala Libray Game), pengguna memilih **biarkan** (2026-09-23).
Ukurannya tidak menular ke repo, biner, maupun installer — di-gitignore, jadi murni disk folder kerja.

**How to apply:** jangan usulkan hapus node_modules atau commit artefak build lagi kecuali pengguna
mengubah keputusan atau toolchain benar-benar macet. Kalau nanti diminta pola "berdiri sendiri tanpa npm",
itu berarti mengeluarkan `internal/web/dist` dari gitignore dan meng-commit hasil build UI — keputusan
terpisah, bukan pekerjaan sampingan.

<!-- END SOURCE: qoder-store/Master_Memory_Workflow.md -->
</details>
<!-- ARCHIVE-END -->
