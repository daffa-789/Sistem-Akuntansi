# Finova — Sistem Akuntansi Web Terpadu Indonesia

Finova adalah aplikasi akuntansi **web** dengan backend **Bun** (`bun:sqlite`, HTTP bawaan) dan frontend **React 18 + Vite + TypeScript**. Antarmuka dibuka di peramban; tidak ada shell desktop, ikon tray, atau installer Windows.

## Fitur

- Bagan akun, periode akuntansi, dan penutupan periode.
- Jurnal umum: buat, edit, posting, flag, reverse, dan nomor voucher otomatis.
- Template jurnal serta impor data dari Excel.
- Audit trail per jurnal.
- Laporan: buku besar, neraca saldo, jurnal, laba rugi, neraca, arus kas, dan perubahan ekuitas.
- Ekspor XLSX dan PDF tanpa dependensi berat tambahan.
- Server hanya bind ke `127.0.0.1` dengan port acak, kecuali `PORT` ditentukan.

## Arsitektur

```
Peramban  ──HTTP──>  server Bun (server/app.ts)
                       ├── API REST (/api/...)
                       ├── bun:sqlite (database/finova.sqlite)
                       └── aset SPA (internal/web/dist)
```

`server/app.ts` adalah satu-satunya definisi rute, dipakai baik oleh `bun run dev` maupun `bun start`. Saat produksi, server menyajikan berkas hasil `vite build` dan fallback ke `index.html` untuk rute frontend.

## Prasyarat

- **Bun** 1.4 atau lebih baru (`bun --version`).
- **Node.js** 20 atau lebih baru untuk skrip bantu `.mjs` (`node --version`).

## Menjalankan

```bash
bun install
bun run dev          # server Bun + Vite dev server (HMR)
```

Buka alamat `http://localhost:<port>` yang dicetak di terminal.

Mode produksi (web):

```bash
bun run build        # build frontend + kompilasi bin/finova.exe
bun start            # server + buka otomatis di peramban
bun run start -- -no-browser   # server saja
```

Tanpa `bin/finova.exe`, `bun start` otomatis menjalankan `server/index.ts` dari sumber dengan Bun.

## Testing

```bash
bun run test         # 46 test server (Bun) + 28 test UI (Vitest)
bun run test:server  # hanya server
bun run test:ui      # hanya UI
bun run typecheck    # TypeScript
```

## Konfigurasi

Lewat variabel lingkungan atau berkas `.env`:

| Variabel | Keterangan |
| --- | --- |
| `PORT` | Kosongkan agar sistem memilih port bebas (disarankan). |
| `VITE_PORT` | Port Vite saat pengembangan; kosong = otomatis. |
| `CLIENT_ORIGIN` | Diperlukan hanya bila frontend memanggil API lintas asal. |
| `DATABASE_FILE` | Lokasi berkas SQLite (bawaan `database/finova.sqlite`). |
| `OPERATOR_NAME` | Nama operator untuk audit trail. |
| `COMPANY_NAME` | Nama perusahaan. |
| `STATIC_DIR` | Folder aset frontend; kosong = pakai `internal/web/dist`. |

## Skrip utama

| Skrip | Fungsi |
| --- | --- |
| `bun run dev` | Server Bun + Vite untuk pengembangan. |
| `bun run build:client` | Build frontend ke `internal/web/dist`. |
| `bun run build:server` | Kompilasi server ke `bin/finova.exe`. |
| `bun run build` | Keduanya. |
| `bun start` | Jalankan aplikasi web. |
| `bun run db:init` | Inisialisasi database lokal. |
| `bun run db:clean` | Bersihkan transaksi, pertahankan akun dan periode. |
| `bun run clean` | Bersihkan hasil build dan cache. |

## REST API (ringkas)

- `GET /api/health` — health check.
- `GET/PUT /api/company` — data perusahaan.
- `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/{id}` — bagan akun.
- `GET/POST /api/periods`, `POST /api/periods/{id}/close` — periode.
- `GET /api/journals/next-voucher`, `GET/POST /api/journals`, `PUT/DELETE /api/journals/{id}` — jurnal.
- `POST /api/journals/{id}/post`, `POST /api/journals/{id}/reverse` — posting dan reverse.
- `GET /api/journals/{id}/audit` — audit trail.
- `GET/POST /api/templates`, `DELETE /api/templates/{id}` — template jurnal.
- `POST /api/imports/template`, `/api/imports/preview`, `/api/imports/confirm` — impor Excel.
- `/api/exports/...` — ekspor XLSX dan PDF.
- `/api/music/...` — pemutar musik lokal/YouTube.

## Catatan

Data disimpan lokal di SQLite; tidak memerlukan XAMPP, phpMyAdmin, atau layanan database terpisah. Aplikasi yang sudah terpasang sebagai desktop dari versi sebelumnya tidak lagi diperlukan dan bisa dihapus melalui Pengaturan > Aplikasi.
