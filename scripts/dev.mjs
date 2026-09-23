// Mode pengembangan: backend Go (`go run ./cmd/finova`) + Vite dev server (HMR).
// Ditulis sebagai JavaScript biasa supaya tidak perlu tsx/dotenv/concurrently
// lagi di node_modules.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const isWindows = process.platform === 'win32'
// Variabel lingkungan asli selalu menang atas isi .env (sama seperti config.Load di Go).
const dotenvValues = readDotenv('.env')
const env = { ...dotenvValues, ...filteredProcessEnv() }
const port = Number(env.PORT || 5000)
const vitePort = Number(env.VITE_PORT || 3000)
const vite = path.resolve('node_modules', 'vite', 'bin', 'vite.js')

function filteredProcessEnv() {
  const out = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== '') out[key] = value
  }
  return out
}

if (!fs.existsSync('go.mod')) {
  console.error('go.mod tidak ditemukan: jalankan dari folder proyek Finova.')
  process.exit(1)
}

// Bersihkan port Vite/API bila ada proses Finova yang tertinggal dari sesi sebelumnya.
if (isWindows) {
  const command = `Get-NetTCPConnection -LocalPort ${vitePort},${port} -ErrorAction SilentlyContinue |` +
    ' Select-Object -ExpandProperty OwningProcess -Unique |' +
    ' ForEach-Object { if ($_ -ne $PID) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }'
  spawnSync('powershell', ['-NoProfile', '-Command', command], { stdio: 'ignore' })
}

console.log(`[dev] Go API        -> http://localhost:${port}`)
console.log(`[dev] Vite frontend -> http://localhost:${vitePort}  (proxy /api ke port ${port})`)

const goBin = isWindows ? 'go.exe' : 'go'
const children = [
  spawn(goBin, ['run', './cmd/finova'], { stdio: 'inherit', windowsHide: true, env }),
  spawn(process.execPath, [vite], { stdio: 'inherit', windowsHide: true, env })
]

let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill(isWindows ? undefined : 'SIGTERM')
  }
  process.exitCode = exitCode
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Gagal memulai proses development: ${error.message}`)
    console.error('Pastikan Go terpasang: https://go.dev/dl/ (cek dengan `go version`).')
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (!stopping && code && code !== 0) {
      console.error(`Proses development berhenti (${signal || `kode ${code}`}).`)
      stop(code)
    }
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

// Parser .env mini: KOLOM=nilai, komentar #, tanda kutip opsional.
function readDotenv(file) {
  const values = {}
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return values
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim().replace(/^export\s+/, '')
    let value = line.slice(index + 1).trim()
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}
