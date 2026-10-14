// Membangun biner native Rust yang sudah di-bundle & dioptimalkan:
//   cargo build --release
// Menghasilkan biner tunggal di bin/finova.exe dengan frontend React tertanam di dalamnya.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = process.env.FINOVA_VERSION || pkg.version || '1.0.0'

const isWindows = process.platform === 'win32'
const outName = isWindows ? 'finova.exe' : 'finova'
const outPath = path.join('bin', outName)
fs.mkdirSync('bin', { recursive: true })

function run(command, args, options = {}) {
  console.log(`${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) {
    console.error(`Gagal menjalankan ${command}: ${result.error.message}`)
    if (options.soft) return false
    process.exit(1)
  }
  if (result.status !== 0) {
    if (options.soft) return false
    process.exit(result.status ?? 1)
  }
  return true
}

// Pastikan frontend sudah di-build sebelum binary rust di-compile
const distHtml = path.join('internal', 'web', 'dist', 'index.html')
if (!fs.existsSync(distHtml)) {
  console.log('[build-rust] internal/web/dist belum ada, membangun frontend dulu...')
  if (!run('npm', ['run', 'build:client'])) {
    console.error('[build-rust] Gagal build frontend!')
    process.exit(1)
  }
}

console.log(`[build-rust] Membangun biner Rust release (v${version})...`)
const cargoArgs = ['build', '--release']
if (!run('cargo', cargoArgs)) {
  console.error('[build-rust] Kompilasi Rust gagal.')
  process.exit(1)
}

const targetBinary = path.join('target', 'release', outName)
if (!fs.existsSync(targetBinary)) {
  console.error(`[build-rust] Hasil kompilasi tidak ditemukan di ${targetBinary}`)
  process.exit(1)
}

fs.copyFileSync(targetBinary, outPath)
const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1)
console.log(`\nSelesai: ${outPath} (${sizeMb} MiB, versi ${version}, backend Rust + frontend React native tertanam).`)
