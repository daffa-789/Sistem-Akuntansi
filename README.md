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
- **Export Engine (sisi klien)**: ExcelJS (`.xlsx`) & jsPDF / html2canvas (`.pdf`)

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
│   ├── httpapi/            # Rute /api/*, CORS, pemetaan galat, layanan jurnal/periode/impor/laporan
│   ├── web/                # go:embed hasil build frontend + penyimpan berkas SPA (fallback index.html)
│   └── xlsx/               # Pembuat templat & parser berkas Excel impor (excelize)
├── scripts/                # Alat bantu npm
│   ├── dev.ts              # Menjalankan Go API + Vite HMR bersamaan
│   ├── build-go.mjs        # `go build` dengan nama biner per sistem operasi
│   ├── start.mjs           # Menjalankan biner produksi (build bila belum ada)
│   └── keep-dist.mjs       # Memulihkan penanda internal/web/dist/.gitkeep setelah build
├── shared/
│   └── types.ts            # Tipe domain frontend (cermin kunci JSON dari Go)
├── src/                    # Frontend React 18 + TSX
│   ├── components/
│   │   ├── layout/         # AppShell, OnboardingWalkthrough
│   │   ├── modals/         # JournalModal, ReverseJournalModal, TemplateModal, AuditLog, dsb.
│   │   ├── ui/             # Reusable UI (Button, Modal, Badge, AccountPicker, AmountInput, ...)
│   │   └── views/          # Dashboard, Accounts, Journals, Ledger, TrialBalance
│   ├── hooks/              # Custom hooks (useLoad)
│   ├── services/           # excelExporter (ExcelJS sisi klien)
│   ├── utils/              # formatters & validators
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
| `npm start` | Jalankan biner produksi (dibangun otomatis bila belum ada) |
| `npm run test:go` | `go test ./...` — unit akuntansi, lapisan DB, integrasi HTTP |
| `npm run test:ui` | `vitest run` — tes komponen/utilitas frontend |
| `npm test` | Seluruh tes Go + frontend |
| `npm run vet` | `go vet ./...` |
| `npm run typecheck` | Pemeriksaan tipe TypeScript (`tsc --noEmit`) |
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
