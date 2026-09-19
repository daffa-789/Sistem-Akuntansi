# Finova — Sistem Akuntansi Otomatis

Finova adalah aplikasi akuntansi single-company berbahasa Indonesia. Transaksi dicatat sebagai jurnal debit-kredit, lalu dipakai langsung untuk membentuk laporan keuangan dan ekspor Excel/PDF.

## Kemampuan utama

- Login berbasis peran **Admin** dan **Staf**.
- Chart of Accounts Indonesia bawaan yang dapat ditambah, diubah, atau dinonaktifkan admin.
- Jurnal manual dengan validasi akun aktif, periode terbuka, minimal dua baris, dan debit = kredit.
- Draft jurnal dapat diubah; jurnal terposting dikoreksi menggunakan jurnal pembalik.
- Impor template Excel dengan pratinjau, validasi, pesan kesalahan per baris, dan posting batch atomik.
- Jurnal umum, buku besar, neraca saldo, laba rugi, neraca posisi keuangan, perubahan modal, dan arus kas langsung.
- Tutup buku bulanan dengan jurnal penutup pendapatan/beban ke laba ditahan dan penguncian periode.
- Unduh laporan aktif sebagai `.xlsx` atau `.pdf`.

## Menjalankan lokal

Prasyarat: Node.js 20+, MySQL 8 / MySQL XAMPP yang aktif.

```powershell
Copy-Item .env.example .env
# Nyalakan MySQL di XAMPP Control Panel terlebih dahulu
npm install
npm run db:init
npm run dev
```

Frontend tersedia di `http://localhost:3000` dan API di `http://localhost:5000`. Setelah API pertama kali berjalan, akun admin dibuat dari nilai `ADMIN_*` pada `.env`:

```text
Email: admin@finova.local
Kata sandi: Admin123!
```

Ganti `JWT_SECRET` dan kredensial admin sebelum lingkungan produksi. Jika database XAMPP berbeda, sesuaikan `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, dan `DB_NAME` pada `.env` terlebih dahulu.

## Format impor Excel

Unduh template dari halaman **Impor Excel**. Sheet pertama membutuhkan kolom berikut:

| Kolom | Keterangan |
| --- | --- |
| `Tanggal` | `YYYY-MM-DD` atau `DD/MM/YYYY` |
| `NoBukti` | Nomor unik; baris dengan nomor sama menjadi satu jurnal |
| `Keterangan` | Uraian jurnal |
| `KodeAkun` | Kode aktif pada Chart of Accounts, mis. `1100` |
| `Debit` | Isi salah satu dari Debit/Kredit |
| `Kredit` | Isi salah satu dari Debit/Kredit |

Sistem menolak akun tidak aktif, periode terkunci, nomor bukti yang sudah ada, serta jurnal yang tidak seimbang. Tidak ada jurnal yang diposting bila satu entri dalam batch tidak lolos validasi.

## Perintah kualitas

```powershell
npm test
npm run build
```

Test mencakup keseimbangan jurnal, neraca saldo, laporan laba rugi/neraca, perubahan modal (termasuk prive), arus kas, dan jurnal penutup. Build memvalidasi seluruh aplikasi React JSX untuk produksi.

## Batas versi pertama

Finova mendukung perusahaan jasa dan dagang tunggal dengan Rupiah dan tahun buku Januari–Desember. PPN, pajak penghasilan, manufaktur, register aset tetap, bank feed, dan pemetaan Excel bebas belum termasuk.
