// Membersihkan hasil build dan cache yang selalu bisa dibuat ulang, sehingga folder
// proyek tetap ringan. Tidak pernah menyentuh database (folder database/ & AppData).
//
//   node scripts/clean.mjs            -> ringkas cache + biner + installer
//   node scripts/clean.mjs --modules  -> juga hapus node_modules (perlu `npm install` lagi)
import fs from 'node:fs'
import path from 'node:path'

const targets = [
  'bin',
  'build/bin',
  'node_modules/.vite',
  'internal/web/dist/assets',
  'coverage',
  'dist-server'
]
const alsoModules = process.argv.includes('--modules')
if (alsoModules) targets.push('node_modules')

const sizeOf = (target) => {
  let total = 0
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch { /* abaikan */ }
      }
    }
  }
  return total
}

let freed = 0
for (const target of targets) {
  if (!fs.existsSync(target)) continue
  const bytes = sizeOf(target)
  fs.rmSync(target, { recursive: true, force: true })
  freed += bytes
  console.log(`dihapus: ${target.padEnd(28)} ${(bytes / 1048576).toFixed(1)} MiB`)
}

// Penanda folder embed harus tetap ada supaya `go build` tidak gagal.
fs.mkdirSync('internal/web/dist', { recursive: true })
const marker = path.join('internal/web/dist', '.gitkeep')
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, '# Placeholder agar `go build` berhasil sebelum frontend dibangun.\n')
}

console.log(`\nTotal dibebaskan: ${(freed / 1048576).toFixed(1)} MiB`)
if (alsoModules) console.log('node_modules dihapus: jalankan `npm install` sebelum membangun frontend.')
else console.log('node_modules dipertahankan (diperlukan untuk membangun frontend).')
