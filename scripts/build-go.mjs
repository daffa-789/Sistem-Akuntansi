// Membangun biner server Go yang sudah dirampingkan:
//   -trimpath                       -> jalur sumber tidak tertanam (reproducible + lebih kecil)
//   -ldflags "-s -w"                -> buang tabel simbol & DWARF  (hemat ±28%)
//   -ldflags "-X main.version=..."  -> versi dari package.json, tampil di `finova version`
// Ikon + manifest Windows ikut tertanam otomatis bila cmd/finova/resource_windows_amd64.syso
// ada; skrip ini membuatnya bila perkakas `rsrc` tersedia.
//
//   node scripts/build-go.mjs [--target=windows|host]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = process.env.FINOVA_VERSION || pkg.version || '0.0.0'

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

const iconPath = path.join('build', 'windows', 'icon.ico')
const sysoPath = path.join('cmd', 'finova', 'resource_windows_amd64.syso')

// Ikon dibuat dari kode (tools/genicon) supaya tidak ada aset biner yang perlu diunduh.
if (isWindows && !fs.existsSync(iconPath)) {
  run('go', ['run', './tools/genicon'], { soft: true })
}
if (isWindows && fs.existsSync(iconPath) && !fs.existsSync(sysoPath)) {
  const built = run('go', ['run', 'github.com/akavel/rsrc@latest',
    '-ico', iconPath,
    '-manifest', path.join('cmd', 'finova', 'finova.exe.manifest'),
    '-arch', 'amd64',
    '-o', sysoPath
  ], { soft: true })
  if (!built) console.log('Catatan: ikon exe dilewati (rsrc tidak dapat dijalankan).')
}

const ldflags = `-s -w -X main.version=${version}`
const args = ['build', '-trimpath', '-ldflags', ldflags, '-o', outPath, './cmd/finova']
if (!run('go', args)) process.exit(1)

const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1)
console.log(`Selesai: ${outPath} (${sizeMb} MiB, versi ${version}, frontend tertanam di dalamnya).`)
