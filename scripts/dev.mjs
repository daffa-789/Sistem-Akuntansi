// Mode pengembangan: backend Go (`go run ./cmd/finova`) + Vite dev server (HMR).
// Ditulis sebagai JavaScript biasa supaya tidak perlu tsx/dotenv/concurrently
// lagi di node_modules.
//
// Dua aturan yang membuat skrip ini berbeda dari versi lamanya:
//   1. Tidak ada port tetap. Go memintakan port bebas ke sistem, port nyatanya
//      dibaca dari keluarannya lalu diteruskan ke proxy Vite (VITE_API_PORT).
//   2. Tidak ada lagi pembunuhan proses. Versi lama memanggil Stop-Process pada
//      penghuni port 3000/5199 setiap kali `npm run dev` dijalankan — itu
//      mematikan dev server proyek lain di mesin yang sama.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const isWindows = process.platform === 'win32'
// Variabel lingkungan asli selalu menang atas isi .env (sama seperti config.Load di Go).
const dotenvValues = readDotenv('.env')
const env = { ...dotenvValues, ...filteredProcessEnv() }
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
if (!fs.existsSync(vite)) {
  console.error('Vite belum terpasang: jalankan `npm install` lebih dulu.')
  process.exit(1)
}

const children = []
let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill(isWindows ? undefined : 'SIGTERM')
  }
  process.exitCode = exitCode
}

function watch(child, label) {
  children.push(child)
  child.on('error', (error) => {
    console.error(`Gagal memulai ${label}: ${error.message}`)
    console.error('Pastikan Go terpasang: https://go.dev/dl/ (cek dengan `go version`).')
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (!stopping && code && code !== 0) {
      console.error(`${label} berhenti (${signal || `kode ${code}`}).`)
      stop(code)
    } else if (!stopping) {
      stop(0)
    }
  })
}

console.log('[dev] backend Go diminta berjalan lebih dulu supaya port-nya dapat dibaca Vite...')

const goBin = isWindows ? 'go.exe' : 'go'
const goChild = spawn(goBin, ['run', './cmd/finova', '-no-browser'], {
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
  env
})
watch(goChild, 'backend Go')

// Sambil menunggu, keluaran Go tetap ditampilkan apa adanya.
waitForMarker(goChild.stdout, /Finova siap di http:\/\/127\.0\.0\.1:(\d+)/, 240000)
  .then((apiPort) => {
    console.log(`[dev] API Go      -> http://127.0.0.1:${apiPort}`)
    console.log('[dev] memulai Vite (port juga otomatis)...')
    const viteChild = spawn(process.execPath, [vite], {
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
      env: { ...env, VITE_API_PORT: String(apiPort) }
    })
    watch(viteChild, 'Vite')
    return waitForMarker(viteChild.stdout, /Local:\s+http:\/\/localhost:(\d+)/, 120000)
  })
  .then((vitePort) => {
    console.log('')
    console.log(`[dev] buka http://localhost:${vitePort} di peramban (HMR aktif).`)
    console.log(`[dev] aplikasi desktop: npm run build && npm start`)
    console.log('')
  })
  .catch((error) => {
    if (!stopping) console.error(`[dev] ${error.message}`)
    stop(1)
  })

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

// Membaca stream anak sambil menampilkannya, dan resolve saat penanda muncul.
function waitForMarker(stream, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      stream.off('data', onData)
      reject(new Error(`menunggu "${pattern.source}" melebihi ${timeoutMs / 1000}s.`))
    }, timeoutMs)

    function onData(chunk) {
      const text = chunk.toString()
      process.stdout.write(text)
      if (done) return
      buffer = (buffer + text).slice(-4096)
      const match = pattern.exec(buffer)
      if (match) {
        done = true
        clearTimeout(timer)
        stream.off('data', onData)
        resolve(match[1])
      }
    }
    stream.on('data', onData)
    stream.on('end', () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        reject(new Error('proses berhenti sebelum memberi tanda siap.'))
      }
    })
  })
}

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
