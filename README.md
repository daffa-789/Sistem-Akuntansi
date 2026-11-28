# Finova — Sistem Akuntansi Maid Caffe (Penggajian, Pendapatan & Pengeluaran)

Finova adalah aplikasi **sistem akuntansi** untuk bisnis demonstrasi kafe maid **Maid Caffe Finova**, berjalan di peramban dengan backend **Bun** (`bun:sqlite` dan HTTP bawaan) serta frontend **React 18 + Vite** dalam JavaScript/JSX. Server tetap menggunakan TypeScript untuk validasi domain dan kontrak API. Isi modul mengikuti BAB V *Siklus Utama dalam Sistem Informasi Akuntansi*: siklus penggajian/SDM (bagian E), siklus pendapatan (bagian B), dan siklus pengeluaran (bagian C).

## Cakupan

Tiga workspace sesuai siklus BAB V.pptx:

1. **Penggajian / SDM** — data karyawan, kehadiran, hitung gaji, pembayaran, dokumen, jurnal, dan pengendalian internal.
2. **Siklus Pendapatan** — pesanan penjualan menu kafe maid, penyajian, faktur (tunai/kredit dengan piutang), penerimaan kas, setoran bank, jurnal, dan pengendalian.
3. **Siklus Pengeluaran** — permintaan pembelian, persetujuan manajer, PO kepada pemasok (bahan kopi, kostum maid, utilitas), penerimaan barang, faktur pemasok dengan pencocokan tiga arah, pembayaran, jurnal, dan pengendalian.

Modul produksi, laporan akuntansi umum, jurnal umum bebas, template, impor, ekspor, dan musik tetap tidak tersedia. Modul baru mulai **kosong** (tanpa data demo) — menu, pelanggan, dan pemasok diketik lewat UI.

Infrastruktur akuntansi bersama: data perusahaan, 14 akun (gaji, kas/bank, piutang, utang usaha, pendapatan, beban), periode akuntansi, jurnal debit–kredit seimbang, dan audit trail.

## Fitur penggajian

- Data induk karyawan, termasuk status kerja, tanggal masuk/keluar, ekspatriat, PTKP, dan rekening penerima.
- Perubahan data karyawan melalui permintaan dan persetujuan berbasis peran; nonaktifasi memerlukan tanggal keluar yang sudah diterapkan.
- Periode gaji dengan status `DRAFT → APPROVED → PAID`.
- Input kehadiran dan lembur harian, prorata masa kerja, serta penanda hasil hitung basi.
- Gaji pokok, tunjangan, potongan absensi, lembur 1,5x/2x, THR prorata, BPJS, dan PPh 21 TER/Pasal 17 dengan nilai YTD.
- Perhitungan ulang yang menyimpan versi hasil baru tanpa menghapus riwayat.
- Delapan dokumen penggajian per periode.
- Jurnal akrual dan pembayaran gaji yang seimbang.
- Verifikasi daftar penerima dan rekonsiliasi gaji–akuntansi–bank sebelum pembayaran.
- Slip gaji dan tampilan jurnal dalam workspace penggajian.
- Audit trail aktivitas payroll.

## Fitur siklus pendapatan

- Data menu kafe maid (minuman, makanan, dessert, paket event, merchandise) dan pelanggan (tunai, member, korporat dengan limit kredit).
- Pesanan penjualan `SO-…` dengan status `DRAFT → DITERIMA → DISAJIKAN → DIFAKTURKAN` (atau `DIBATALKAN`), sesuai empat aktivitas BAB V bagian B.
- Pemisahan tugas lewat akun login: penjualan (konfirmasi), gudang (penyajian), akuntansi (faktur), keuangan (kas).
- Persetujuan penjualan kredit oleh manajer dengan pengecekan limit kredit terhadap piutang berjalan.
- Faktur penjualan `FJ-…`: tunai langsung membentuk bukti penerimaan kas dan jurnal kas; kredit membentuk piutang (jurnal debit Piutang Usaha 1130 / kredit Pendapatan 4100).
- Bukti penerimaan kas `BKM-…` untuk pelunasan piutang dan setoran bank dari Kas di Tangan 1120 ke Kas di Bank 1110.
- Rekonsiliasi penerimaan kas dengan rekening bank per bulan.
- Audit trail seluruh aktivitas pendapatan.

## Fitur siklus pengeluaran

- Data pemasok per kategori (bahan baku, kostum, utilitas, jasa) dengan penanda pemasok terpercaya.
- Surat permintaan pembelian `PR-…` dari bagian dapur/kafe/kostum/umum; persetujuan wajib oleh manajer.
- Pesanan pembelian `PO-…` oleh bagian pembelian; peringatan bila pemasok belum terpercaya.
- Laporan penerimaan barang `LPB-…` oleh gudang (jumlah, kondisi, pemeriksa).
- Faktur pemasok dicatat akuntansi dengan **pencocokan tiga arah** PO = penerimaan = faktur; selisih ditolak sistem.
- Jurnal utang: debit beban sesuai kategori pemasok (5100/5300/5400/5500), kredit Utang Usaha 2120.
- Pembayaran `BKK-…` hanya oleh keuangan pada faktur MATCHED, dengan bukti transfer.
- Rekonsiliasi catatan utang dengan laporan pemasok per bulan.
- Audit trail seluruh aktivitas pengeluaran.

## Arsitektur

```
Peramban ──HTTP──> server Bun (server/app.ts)
                      ├── API payroll, pendapatan, pengeluaran, dan data pendukung
                      ├── bun:sqlite (database/finova.sqlite)
                      └── aset SPA (internal/web/dist)
```

`server/app.ts` mendefinisikan rute yang dipakai mode pengembangan maupun produksi. Server menyajikan hasil `vite build` dan memakai fallback `index.html` untuk navigasi SPA. Secara bawaan server hanya bind ke `127.0.0.1` dengan port acak.

## Prasyarat

- **Bun** 1.4 atau lebih baru.
- **Node.js** 20 atau lebih baru untuk skrip bantu `.mjs`.

## Menjalankan

```bash
bun install
bun run dev
```

Buka alamat `http://localhost:<port>` yang dicetak terminal.

Mode produksi web:

```bash
bun run build
bun start
bun run start -- -no-browser
```

`bun run build` membangun frontend ke `internal/web/dist` lalu mengompilasi `bin/finova.exe`. Tanpa biner tersebut, `bun start` menjalankan `server/index.ts` langsung dengan Bun.

## Testing

```bash
bun run test         # 113 test server + 27 test UI
bun run test:server  # hanya server
bun run test:ui      # hanya UI
bun run typecheck    # TypeScript server dan definisi frontend
bun run build        # build produksi
```

Test memakai database sementara dan tidak menyentuh `database/finova.sqlite`.

## Konfigurasi

Variabel lingkungan atau `.env`:

| Variabel | Keterangan |
| --- | --- |
| `PORT` | Kosongkan agar server memilih port bebas. |
| `VITE_PORT` | Port Vite saat pengembangan; kosong = otomatis. |
| `CLIENT_ORIGIN` | Diperlukan hanya untuk API lintas asal. |
| `DATABASE_FILE` | Lokasi SQLite; bawaan `database/finova.sqlite`. |
| `OPERATOR_NAME` | Nama operator untuk audit trail. |
| `COMPANY_NAME` | Nama perusahaan. |
| `STATIC_DIR` | Folder aset frontend; kosong = `internal/web/dist`. |

## Skrip utama

| Skrip | Fungsi |
| --- | --- |
| `bun run dev` | Server Bun dan Vite untuk pengembangan. |
| `bun run build:client` | Build frontend ke `internal/web/dist`. |
| `bun run build:server` | Kompilasi server ke `bin/finova.exe`. |
| `bun run build` | Build frontend dan server. |
| `bun start` | Jalankan aplikasi web. |
| `bun run db:init` | Inisialisasi database lokal. |
| `bun run db:clean` | Hapus transaksi payroll, pendapatan, pengeluaran, jurnal tertaut, dan audit; pertahankan karyawan, pelanggan, menu, pemasok, perusahaan, akun, serta periode akuntansi. |
| `bun run clean` | Bersihkan hasil build dan cache. |

## REST API

### Data pendukung

- `GET /api/health` — health check.
- `GET/PUT /api/company` — data perusahaan.
- `GET /api/accounts` — 14 akun: penggajian, kas/bank, piutang, utang usaha, pendapatan, dan beban.
- `GET/POST /api/periods` — periode akuntansi pendukung posting jurnal.

### Karyawan dan SDM

- `GET/POST /api/payroll/employees` — data induk karyawan.
- `PUT/DELETE /api/payroll/employees/:id` — ditolak; perubahan harus melalui change request.
- `GET/POST /api/payroll/change-requests` — daftar dan pengajuan perubahan.
- `POST /api/payroll/change-requests/:id/decide` — persetujuan atau penolakan perubahan.
- `GET /api/payroll/parameters` — parameter perhitungan yang ditampilkan aplikasi.

### Siklus penggajian

- `GET/POST /api/payroll/periods` — daftar dan pembuatan periode gaji.
- `GET/PUT /api/payroll/periods/:id/inputs/:employeeId` — input kehadiran dan lembur.
- `GET /api/payroll/periods/:id/lines` — hasil hitung terbaru dan penanda basi per karyawan.
- `POST /api/payroll/periods/:id/run` — hitung gaji; perhitungan ulang membuat versi baru.
- `POST /api/payroll/periods/:id/approve` — validasi hasil terbaru lalu posting jurnal akrual.
- `POST /api/payroll/periods/:id/pay` — posting jurnal pembayaran setelah kedua kontrol OK.
- `GET /api/payroll/journals` — daftar jurnal payroll untuk workspace.
- `GET/POST /api/payroll/periods/:id/documents` — delapan dokumen payroll.
- `DELETE /api/payroll/documents/:id` — hapus dokumen payroll.
- `GET/POST /api/payroll/periods/:id/controls` — verifikasi penerima dan rekonsiliasi.

### Siklus pendapatan

- `GET/POST/PUT /api/revenue/customers` — data pelanggan dan limit kredit.
- `GET/POST/PUT /api/revenue/menu-items` — data menu kafe maid.
- `GET/POST /api/revenue/orders` — pesanan penjualan dengan item menu.
- `POST /api/revenue/orders/:id/confirm` — konfirmasi pesanan (penjualan).
- `POST /api/revenue/orders/:id/serve` — catat penyajian (gudang).
- `POST /api/revenue/orders/:id/approve-credit` — persetujuan penjualan kredit (manajer).
- `POST /api/revenue/orders/:id/invoice` — buat faktur; tunai langsung terbayar, kredit membentuk piutang.
- `POST /api/revenue/orders/:id/cancel` — batalkan pesanan sebelum disajikan.
- `GET /api/revenue/invoices` — faktur dan kartu piutang.
- `GET/POST /api/revenue/receipts` — bukti penerimaan kas.
- `POST /api/revenue/receipts/:id/deposit` — setoran bank dari kas di tangan.
- `GET /api/revenue/journals` — jurnal sumber REVENUE.
- `GET/POST /api/revenue/controls` — rekonsiliasi penerimaan kas dengan rekening bank.

### Siklus pengeluaran

- `GET/POST/PUT /api/expenditure/suppliers` — data pemasok dan penanda terpercaya.
- `GET/POST /api/expenditure/requisitions` — surat permintaan pembelian.
- `POST /api/expenditure/requisitions/:id/decide` — persetujuan permintaan (manajer).
- `GET/POST /api/expenditure/orders` — pesanan pembelian dari permintaan disetujui.
- `POST /api/expenditure/orders/:id/send` — terbitkan PO kepada pemasok.
- `POST /api/expenditure/orders/:id/receipt` — laporan penerimaan barang (gudang).
- `POST /api/expenditure/orders/:id/cancel` — batalkan PO sebelum barang diterima.
- `GET /api/expenditure/receipts` — daftar laporan penerimaan barang.
- `GET/POST /api/expenditure/bills` — catat faktur pemasok dengan pencocokan tiga arah.
- `GET/POST /api/expenditure/payments` — pembayaran pemasok (keuangan) dengan bukti kas keluar.
- `GET /api/expenditure/journals` — jurnal sumber EXPENDITURE.
- `GET/POST /api/expenditure/controls` — rekonsiliasi utang dengan laporan pemasok.

Endpoint non-modul lama, seperti `/api/journals`, `/api/reports`, `/api/imports`, `/api/exports`, dan `/api/music`, mengembalikan 404.

## Catatan

Data disimpan lokal di SQLite; tidak memerlukan XAMPP, phpMyAdmin, atau layanan database terpisah. Setiap peran pemisahan tugas (SDM, penggajian, akuntansi, keuangan, manajer, penjualan, gudang, pembelian) memiliki akun demo sendiri dengan sandi bersama `finova2026`; kewenangan diperiksa dari sesi login. Aplikasi desktop lama tidak diperlukan lagi dan dapat dihapus melalui Pengaturan > Aplikasi.
