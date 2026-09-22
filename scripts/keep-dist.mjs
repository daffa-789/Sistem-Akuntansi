// Vite mengosongkan folder outDir setiap build, termasuk berkas penanda yang
// dibutuhkan `go:embed` agar biner Go tetap dapat dibangun sebelum ada frontend.
// Skrip ini menulis ulang penanda tersebut setelah build selesai.
import fs from 'node:fs'
import path from 'node:path'

const marker = path.resolve('internal/web/dist/.gitkeep')
fs.mkdirSync(path.dirname(marker), { recursive: true })
fs.writeFileSync(
  marker,
  '# Placeholder agar `go build` berhasil sebelum frontend dibangun.\n' +
    '# Isi folder ini dihasilkan oleh `npm run build:client` (Vite).\n'
)
console.log('Penanda internal/web/dist/.gitkeep dipulihkan.')
