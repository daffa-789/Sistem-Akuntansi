import { spawn, execSync } from 'node:child_process'
import path from 'node:path'

const isWindows = process.platform === 'win32'
const node = process.execPath
const vite = path.resolve('node_modules', 'vite', 'bin', 'vite.js')

// Bersihkan port 3000 dan 5000 jika ada proses zombie yang tertinggal
try {
  if (isWindows) {
    execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000, 5000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -ne $PID) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"', { stdio: 'ignore' })
  }
} catch {
  // abaikan jika tidak ada proses
}

const processes = [
  spawn(node, ['--watch', 'server/server.js'], { stdio: 'inherit', windowsHide: true }),
  spawn(node, [vite], { stdio: 'inherit', windowsHide: true })
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
  child.on('error', (error) => { console.error(`Gagal memulai proses development: ${error.message}`); stop(1) })
  child.on('exit', (code, signal) => {
    if (!stopping && code && code !== 0) {
      console.error(`Proses development berhenti (${signal || `kode ${code}`}).`)
      stop(code)
    }
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
