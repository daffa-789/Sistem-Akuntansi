# Finova — Sistem Akuntansi & Pembukuan Web Terpadu Indonesia

Finova adalah aplikasi sistem informasi akuntansi berbasis web (**Full-Stack TypeScript & React**) yang dirancang khusus agar rapi, interaktif, dan mudah digunakan—baik untuk operasional pembukuan UMKM/bisnis maupun untuk siswa dan mahasiswa akuntansi yang sedang mempelajari siklus akuntansi lengkap (*Jurnal Umum -> Buku Besar -> Neraca Saldo -> Laporan Keuangan*).

Aplikasi ini menggunakan **database lokal SQLite mandiri (`better-sqlite3`)**, sehingga **tidak membutuhkan server MySQL, XAMPP, atau phpMyAdmin**. Seluruh data tersimpan otomatis di dalam file lokal `database/finova.sqlite` dan siap dipakai secara instan begitu aplikasi dijalankan.

---

## 🛠️ Tech Stack & Arsitektur

- **Frontend**: [React 18](https://react.dev/) + **TSX** (Strict TypeScript)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + Custom Glassmorphism Theme (Light & Dark Mode)
- **Build Tool**: [Vite](https://vitejs.dev/) + `@vitejs/plugin-react`
- **Backend Runtime**: [Node.js](https://nodejs.org/) + [Express](https://expressjs.com/) via [tsx](https://github.com/privatenumber/tsx) (Zero-build TypeScript execution)
- **Database**: SQLite 3 via `better-sqlite3` dengan mode Write-Ahead Logging (WAL) berkinerja tinggi
- **Shared Types**: `shared/types.ts` sebagai *single source of truth* kontrak data (Frontend & Backend)
- **Testing**: [Vitest](https://vitest.dev/) untuk pengujian unit logika akuntansi dan database layer
- **Export Engine**: ExcelJS (`.xlsx`) & jsPDF / html2canvas (`.pdf`)

---

## ✨ Kemampuan & Fitur Utama

### 1. Database Lokal Mandiri (Zero-Setup)
- Berbasis npm package `better-sqlite3` dengan mode Write-Ahead Logging (WAL) yang super cepat dan aman.
- **Auto-bootstrap**: Otomatis membuat tabel, Bagan Akun Indonesia lengkap (36 akun standar), periode akuntansi, akun administrator, template transaksi, dan data jurnal awal saat pertama kali dijalankan.
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
- **Otentikasi & Keamanan**: Dukungan login multi-peran (Admin & Staf Keuangan) dengan cookie aman dan sesi JWT.

---

## 📁 Struktur Proyek

```text
Sistem-Akuntansi/
├── database/               # Schema SQL dan file database SQLite lokal
│   ├── finova.sqlite       # Database lokal aktif (WAL mode)
│   └── schema.sqlite.sql   # DDL skema database relasional
├── scripts/                # Otomasi TypeScript (dijalankan via tsx)
│   ├── dev.ts              # Launcher simultan frontend Vite + backend API
│   ├── init-db.ts          # Skrip inisialisasi & seeder database lokal
│   └── clean-database.ts   # Skrip pembersihan data transaksi / reset
├── server/                 # Backend Node.js + Express (TypeScript)
│   ├── accounting.ts       # Logika kalkulasi akuntansi & validasi ALERE
│   ├── accounting.test.ts  # Unit test logika akuntansi
│   ├── db.ts               # SQLite connection pool & transaction manager
│   ├── db.test.ts          # Unit test SQLite layer
│   └── server.ts           # REST API endpoints & otentikasi JWT
├── shared/                 # Shared domain types (Frontend & Backend)
│   └── types.ts            # Tipe Akun, Jurnal, Laporan, User, Periode
├── src/                    # Frontend React 18 + TSX
│   ├── components/
│   │   ├── layout/         # AppShell, OnboardingWalkthrough
│   │   ├── modals/         # JournalModal, TemplateModal, AuditLog, dsb.
│   │   ├── ui/             # Reusable UI (Button, Modal, Badge, Empty, dsb.)
│   │   └── views/          # Dashboard, Accounts, Journals, Ledger, TrialBalance, Login
│   ├── hooks/              # Custom hooks (useLoad)
│   ├── services/           # excelExporter (ExcelJS)
│   ├── utils/              # formatters & validators
│   ├── api.ts              # Strongly-typed HTTP client
│   ├── App.tsx             # Root layout & view switcher
│   ├── main.tsx            # React DOM mounting
│   └── vite-env.d.ts       # Ambient Vite types
├── index.html              # HTML entry point (mengarah ke /src/main.tsx)
├── tsconfig.json           # Konfigurasi TypeScript compiler (strict: true)
├── vite.config.ts          # Konfigurasi Vite & path alias (@/* & @shared/*)
├── tailwind.config.js      # Konfigurasi Tailwind CSS
└── package.json            # Script & dependensi proyek
```

---

## 🌐 Cara Menjalankan Aplikasi Web

### Prasyarat
- [Node.js](https://nodejs.org/) versi 18 atau lebih baru.
- npm (bawaan dari Node.js).

### 🚀 1. Mode Pengembangan (Development)
Untuk menjalankan frontend (Vite) dan backend (Express API) secara bersamaan:

```bash
# 1. Pasang dependensi
npm install

# 2. Jalankan server pengembangan
npm run dev
```

Aplikasi akan otomatis berjalan di:
- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:5000](http://localhost:5000)

Buka peramban (*web browser*) Anda ke **`http://localhost:3000`**.

---

### 📦 2. Mode Produksi (Production Build & Run)
Untuk mengompilasi bundel statis dan menjalankan server produksi mandiri:

```bash
# 1. Kompilasi frontend dan backend
npm run build

# 2. Jalankan server produksi
npm start
```

Aplikasi siap diakses di [http://localhost:5000](http://localhost:5000).

---

## 🔑 Akun Masuk Bawaan (Default Login)

Saat pertama kali membuka website, gunakan akun administrator bawaan berikut:
- **Email**: `admin@finova.local`
- **Kata Sandi**: `Admin123!`

---

## 💻 Daftar Perintah npm

| Perintah | Deskripsi |
| --- | --- |
| `npm run dev` | Menjalankan Frontend Vite (`:3000`) & Backend API (`:5000`) simultan |
| `npm run dev:frontend` | Menjalankan hanya server frontend Vite |
| `npm run dev:server` | Menjalankan backend Express dengan auto-reload via `tsx watch` |
| `npm run build` | Mengompilasi bundle produksi frontend (`dist/`) dan server (`dist-server/`) |
| `npm start` | Menjalankan aplikasi web produksi dari bundle server |
| `npm run preview` | Melakukan pratinjau hasil build client Vite |
| `npm run typecheck` | Menjalankan pemeriksaan tipe TypeScript seluruh proyek (`tsc --noEmit`) |
| `npm test` | Menjalankan seluruh unit test (Vitest) untuk logika akuntansi & database |
| `npm run db:init` | Menginisialisasi ulang database SQLite lokal dengan data standar |
| `npm run db:clean` | Mengosongkan data transaksi dan mereset ke saldo awal |

---

## ⌨️ Pintasan Keyboard Global

| Shortcut | Fungsi |
| --- | --- |
| `Ctrl+K` | Pencarian global akun dan menu cepat |
| `Esc` | Menutup jendela dialog / modal aktif |