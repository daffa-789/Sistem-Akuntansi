// Membangun biner mandiri Finova dengan Bun:
//   bun build --compile --outfile bin/finova.exe server/index.ts
//
// Hasilnya SATU berkas .exe yang memuat runtime Bun + seluruh kode server +
// frontend tertanam (dilayani dari internal/web/dist). Tidak perlu Rust,
// toolchain, atau Node di mesin pengguna.
//
// Catatan ukuran: biner hasil compile memuat runtime Bun, jadi jauh lebih besar
// daripada biner Rust (sekitar 90-100 MB vs ~11 MB). Itu harga yang wajar untuk
// distribusi sekali-klik; alternatif ringan: `bun run build:server:bundle`
// (hanya bundel JS ~beberapa MB, tetapi butuh Bun terpasang untuk dijalankan).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = process.env.FINOVA_VERSION || pkg.version || '1.0.0'

const isWindows = process.platform === 'win32'
const bunBin = isWindows ? 'bun.exe' : 'bun'
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

// Bun wajib ada untuk mengompilasi.
const bunProbe = spawnSync(bunBin, ['--version'], { windowsHide: true })
if (bunProbe.error || bunProbe.status !== 0) {
  console.error('Bun tidak ditemukan di PATH. Pasang dari https://bun.sh terlebih dahulu.')
  process.exit(1)
}

// Pastikan frontend sudah di-build sebelum dikompilasi (server menyajikannya dari disk).
const distHtml = path.join('internal', 'web', 'dist', 'index.html')
if (!fs.existsSync(distHtml)) {
  console.log('[build-server] internal/web/dist belum ada, membangun frontend dulu...')
  if (!run('node', ['scripts/keep-dist.mjs'], { soft: true })) {
    console.error('[build-server] Gagal menyiapkan penanda dist.')
    process.exit(1)
  }
  const built = spawnSync('node', [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    stdio: 'inherit',
    windowsHide: true
  })
  if (built.status !== 0) {
    console.error('[build-server] Gagal build frontend!')
    process.exit(1)
  }
}

console.log(`[build-server] Mengompilasi biner Bun mandiri (v${version})...`)
const compileArgs = [
  'build',
  '--compile',
  '--outfile',
  outPath,
  path.join('server', 'index.ts')
]
if (isWindows) {
  // Mode desktop: tanpa jendela konsol, dengan ikon & metadata seperti biner
  // native Windows pada umumnya.
  const icon = path.resolve('build', 'windows', 'icon.ico')
  if (fs.existsSync(icon)) compileArgs.push(`--windows-icon=${icon}`)
  compileArgs.push('--windows-hide-console')
  compileArgs.push('--windows-title=Finova')
  compileArgs.push('--windows-publisher=Finova')
  compileArgs.push(`--windows-version=${version}.0`)
  compileArgs.push('--windows-description=Finova - Sistem Akuntansi & Pembukuan')
  compileArgs.push('--windows-copyright=Finova')
}
if (!run(bunBin, compileArgs)) {
  console.error('[build-server] Kompilasi Bun gagal.')
  process.exit(1)
}

// Bun otomatis menambahkan .exe di Windows; normalkan nama bila perlu.
const produced = fs.existsSync(outPath)
  ? outPath
  : isWindows && fs.existsSync(`${outPath}.exe`)
    ? `${outPath}.exe`
    : null
if (!produced) {
  console.error(`[build-server] Hasil kompilasi tidak ditemukan di ${outPath}`)
  process.exit(1)
}

const sizeMb = (fs.statSync(produced).size / 1024 / 1024).toFixed(1)
console.log(`\nSelesai: ${produced} (${sizeMb} MiB, versi ${version}, backend Bun + frontend React).`)
console.log('Jalankan langsung: ./bin/finova.exe  (atau `npm start`, yang otomatis memakai binernya)')
