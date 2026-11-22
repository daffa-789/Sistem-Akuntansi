// Vite mengosongkan folder outDir setiap build, termasuk berkas penanda.
// Skrip ini menulis ulang penanda tersebut setelah build selesai agar folder
// dist tetap terbaca version control (dan jadi tujuan `bun build --compile`).
import fs from 'node:fs'
import path from 'node:path'

const marker = path.resolve('internal/web/dist/.gitkeep')
fs.mkdirSync(path.dirname(marker), { recursive: true })
fs.writeFileSync(
  marker,
  '# Penanda folder dist. Isinya dihasilkan oleh `npm run build:client` (Vite).\n'
)
console.log('Penanda internal/web/dist/.gitkeep dipulihkan.')
