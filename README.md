# Finova — Sistem Akuntansi & Pembukuan Indonesia

Finova adalah aplikasi akuntansi berbahasa Indonesia yang dirancang khusus agar rapi, mudah, dan menyenangkan digunakan—baik untuk operasional bisnis maupun untuk siswa dan mahasiswa akuntansi yang sedang mempelajari siklus akuntansi (*Jurnal Umum -> Buku Besar -> Neraca Saldo -> Laporan Keuangan*).

Aplikasi ini menggunakan **database lokal SQLite mandiri (`better-sqlite3`)**, sehingga **tidak membutuhkan server MySQL, XAMPP, atau phpMyAdmin**. Seluruh data tersimpan otomatis di dalam file lokal `database/finova.sqlite` dan siap dipakai secara instan begitu dijalankan.

---

## Kemampuan & Fitur Utama

### 1. Database Lokal Mandiri (Zero-Setup)
- Berbasis npm package `better-sqlite3` dengan mode Write-Ahead Logging (WAL) yang super cepat.
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

### 3. Pencatatan Jurnal Ramah Pelajar Akuntansi
- **Panduan Saldo Normal (ALERE Cheat Sheet)**:
  - Penjelasan interaktif persamaan dasar akuntansi (*Aset = Liabilitas + Ekuitas*) dan aturan penambahan/pengurangan akun (*Aset/Beban di Debit, Liabilitas/Ekuitas/Pendapatan di Kredit*).
- **Indikator Keseimbangan Cerdas (Real-time Balance Indicator)**:
  - Menampilkan selisih nominal secara langsung dan memberi tahu sisi mana yang kurang (misal: *"⚠️ Sisi Kredit kurang Rp 1.500.000"*).
- **Tombol Auto-Balance**:
  - Otomatis menghitung selisih dan mengisinya ke baris akun yang kosong secara instan.
- **13 Template Transaksi Akuntansi Siap Pakai**:
  - Setoran Modal Awal, Beli Perlengkapan Tunai, Beli Peralatan Kredit, Pendapatan Jasa Tunai/Kredit, Pelunasan Piutang, Pembayaran Utang Usaha, Beban Gaji, Beban Sewa, Beban Utilitas, Prive Pemilik, hingga Jurnal Penyesuaian (AJP Pemakaian Perlengkapan & Penyusutan Peralatan).

### 4. Siklus Akuntansi Terintegrasi
- **Buku Besar (General Ledger)**: Menampilkan mutasi per akun dengan perhitungan saldo berjalan otomatis (*running balance*).
- **Neraca Saldo (Trial Balance)**: Memverifikasi keseimbangan debit dan kredit seluruh akun.
- **Bagan Akun (Chart of Accounts)**: Eksplorasi akun berdasarkan kelompok (Aktiva, Liabilitas, Ekuitas, Pendapatan, Beban) dan saldo normalnya.
- **Dashboard Keuangan**: Grafik kinerja pendapatan vs beban serta indikator kas & bank real-time.

---

## Cara Menjalankan Aplikasi

Prasyarat: **Node.js versi 20+** (disarankan Node.js 22 atau 24).

```powershell
# 1. Masuk ke folder proyek
cd "c:\Users\Daffa\Desktop\Sistem Akuntansi"

# 2. Salin variabel lingkungan (jika belum ada .env)
Copy-Item .env.example .env

# 3. Pasang dependensi npm
npm install

# 4. Jalankan aplikasi (Frontend Vite & Backend Server berjalan bersamaan)
npm run dev
```

- Frontend dapat diakses di: `http://localhost:3000`
- API Backend berjalan di: `http://localhost:5000`
- Database tersimpan di: `database/finova.sqlite`

### Akun Awal Sistem
```text
Email      : admin@finova.local
Kata Sandi : Admin123!
```

---

## Perintah Tambahan

```powershell
# Reset / Inisialisasi ulang database lokal jika dibutuhkan
npm run db:init

# Menjalankan unit test logika akuntansi & database
npm test

# Membangun bundle produksi
npm run build
```

---

## Pintasan Keyboard (Shortcuts)

| Shortcut | Fungsi |
| --- | --- |
| `Ctrl+K` | Pencarian global akun cepat |
| `Ctrl+Enter` | Posting jurnal langsung (di dalam modal) |
| `Ctrl+S` | Simpan draft jurnal (di dalam modal) |
| `Esc` | Menutup jendela modal / pop-up |
| `Ctrl+P` | Cetak dokumen / laporan aktif |