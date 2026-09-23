// Membuat installer Windows: build frontend -> build biner ramping -> makensis.
//
//   node scripts/make-installer.mjs [--skip-client]
//
// Hasil: build/bin/Finova-Setup-<versi>-amd64.exe
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = process.env.FINOVA_VERSION || pkg.version || '0.0.0'
const skipClient = process.argv.includes('--skip-client')

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, shell: false })
  if (result.error) fail(`Gagal menjalankan ${command}: ${result.error.message}`)
  if (result.status !== 0) fail(`Perintah gagal (kode ${result.status}): ${command} ${args.join(' ')}`)
  return result
}

if (process.platform !== 'win32') {
  fail('Pembuat installer ini khusus Windows (NSIS). Di sistem lain gunakan `npm run build` lalu jalankan binernya.')
}

// NSIS biasanya tidak ada di PATH; cek lokasi pemasangan standarnya.
const candidates = [
  process.env.MAKENSIS,
  'makensis',
  'C:\\Program Files (x86)\\NSIS\\makensis.exe',
  'C:\\Program Files\\NSIS\\makensis.exe'
].filter(Boolean)

let makensis = null
for (const candidate of candidates) {
  const probe = spawnSync(candidate, ['/VERSION'], { encoding: 'utf8', windowsHide: true })
  if (!probe.error && probe.status === 0) {
    makensis = candidate
    console.log(`NSIS ditemukan: ${candidate} (v${probe.stdout.trim()})`)
    break
  }
}
if (!makensis) {
  fail('NSIS (makensis.exe) tidak ditemukan. Pasang dari https://nsis.sourceforge.io/Download atau atur MAKENSIS.')
}

// Hindari pemanggilan npm.cmd (Node menolak spawn berkas .cmd tanpa shell): jalankan
// langkah build langsung lewat node.
if (!skipClient) {
  run(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'])
  run(process.execPath, ['scripts/keep-dist.mjs'])
}
run(process.execPath, ['scripts/build-go.mjs'])

const exe = path.join('bin', 'finova.exe')
if (!fs.existsSync(exe)) fail(`Biner ${exe} tidak ditemukan.`)

const script = path.join('build', 'windows', 'installer', 'finova.nsi')
const srcExe = path.relative(path.dirname(script), exe)
// makensis tidak membuat folder tujuan sendiri.
fs.mkdirSync(path.join('build', 'bin'), { recursive: true })

// makensis dipanggil dengan define agar versi hanya perlu ditulis satu kali.
const args = [
  `/DAppVersion=${version}`,
  `/DSrcExe=${srcExe}`,
  script
]
const result = spawnSync(makensis, args, { stdio: 'inherit', windowsHide: true })
if (result.status !== 0) fail('Pembuatan installer gagal.')

const installer = path.join('build', 'bin', `Finova-Setup-${version}-amd64.exe`)
if (!fs.existsSync(installer)) fail(`Installer tidak dihasilkan di ${installer}`)
const mb = (fs.statSync(installer).size / 1024 / 1024).toFixed(1)
console.log(`\nInstaller siap: ${installer} (${mb} MiB)`)
console.log('Pasang dengan menjalankan berkas tersebut, atau senyap: Finova-Setup-...exe /S')
