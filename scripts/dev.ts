import { spawn, execSync, ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import dotenv from 'dotenv'

// Mode pengembangan: backend Go (`go run ./cmd/finova`) + Vite dev server (HMR).
// Ganti scripts/dev.ts versi Node: tidak ada lagi `tsx watch server/server.ts`.
dotenv.config()

const isWindows = process.platform === 'win32'
const port = Number(process.env.PORT || 5000)
const vitePort = Number(process.env.VITE_PORT || 3000)
const vite = path.resolve('node_modules', 'vite', 'bin', 'vite.js')
const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs')

// Bersihkan port Vite dan API bila ada proses zombie dari sesi sebelumnya.
try {
  if (isWindows) {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${vitePort},${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -ne $PID) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"`,
      { stdio: 'ignore' }
    )
  }
} catch {
  // abaikan jika tidak ada proses
}

if (!fs.existsSync('go.mod')) {
  console.error('go.mod tidak ditemukan: jalankan dari folder proyek Finova.')
  process.exit(1)
}

console.log(`[dev] Go API       -> http://localhost:${port}`)
console.log(`[dev] Vite frontend -> http://localhost:${vitePort}`)

const goBin = isWindows ? 'go.exe' : 'go'
const processes: ChildProcess[] = [
  spawn(goBin, ['run', './cmd/finova'], { stdio: 'inherit', windowsHide: true, env: process.env }),
  spawn(process.execPath, [tsxCli, vite], { stdio: 'inherit', windowsHide: true })
]

let stopping = false
function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of processes) {
    if (!child.killed) child.kill(isWindows ? undefined : 'SIGTERM')
  }
  process.exitCode = exitCode
}

for (const child of processes) {
  child.on('error', (error) => {
    console.error(`Gagal memulai proses development: ${error.message}`)
    console.error('Pastikan Go sudah terpasang: https://go.dev/dl/ (cek dengan `go version`).')
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
