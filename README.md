# Finova — Sistem Penggajian & SDM

Finova adalah aplikasi **penggajian dan SDM** berjalan di peramban dengan backend **Bun** (`bun:sqlite` dan HTTP bawaan) serta frontend **React 18 + Vite** dalam JavaScript/JSX. Server tetap menggunakan TypeScript untuk validasi domain dan kontrak API.

## Cakupan

Aplikasi hanya menyediakan workspace **Penggajian / SDM**. Modul pendapatan, pengeluaran, produksi, laporan akuntansi, jurnal umum, template, impor, ekspor, dan musik sudah tidak tersedia.

Infrastruktur akuntansi yang tetap ada hanya penopang penggajian: data perusahaan, enam akun gaji, periode akuntansi, jurnal akrual/pembayaran, validasi debit–kredit, dan audit trail. Modul-modul tersebut tidak dibuka sebagai workspace atau API pengelolaan akuntansi umum.

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

## Arsitektur

```
Peramban ──HTTP──> server Bun (server/app.ts)
                      ├── API payroll dan data pendukung
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
bun run test         # 57 test server + 10 test UI
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
| `bun run db:clean` | Hapus periode gaji, hasil hitung, dokumen, kontrol, jurnal tertaut, dan audit payroll; pertahankan karyawan, perusahaan, enam akun, serta periode akuntansi. |
| `bun run clean` | Bersihkan hasil build dan cache. |

## REST API

### Data pendukung

- `GET /api/health` — health check.
- `GET/PUT /api/company` — data perusahaan.
- `GET /api/accounts` — enam akun yang dipakai jurnal penggajian.
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

Endpoint non-penggajian lama, seperti `/api/journals`, `/api/reports`, `/api/imports`, `/api/exports`, dan `/api/music`, mengembalikan 404.

## Catatan

Data disimpan lokal di SQLite; tidak memerlukan XAMPP, phpMyAdmin, atau layanan database terpisah. Validasi peran payroll mendukung pengendalian internal, tetapi bukan pengganti autentikasi karena aplikasi berjalan tanpa login. Aplikasi desktop lama tidak diperlukan lagi dan dapat dihapus melalui Pengaturan > Aplikasi.
