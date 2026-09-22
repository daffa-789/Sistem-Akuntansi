// Menjalankan biner produksi. Bila biner belum ada, otomatis build lebih dulu
// sehingga `npm start` selalu berhasil di mesin baru.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const outName = process.platform === 'win32' ? 'finova.exe' : 'finova'
const outPath = path.join('bin', outName)

if (!fs.existsSync(outPath)) {
  console.log('Biner belum ada, membangun dulu...')
  const built = spawnSync('node', ['scripts/build-go.mjs'], { stdio: 'inherit', windowsHide: true })
  if (built.status !== 0) process.exit(built.status ?? 1)
}

const child = spawn(outPath, process.argv.slice(2), { stdio: 'inherit', windowsHide: true })
child.on('error', (error) => {
  console.error(`Gagal menjalankan ${outPath}: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 0
})
