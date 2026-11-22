// Menjalankan Finova di peramban. Bila biner hasil kompilasi belum ada, server
// tetap dijalankan langsung dari sumber memakai Bun, sehingga `bun start`
// selalu berhasil di mesin baru.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const isWindows = process.platform === 'win32'
const bunBin = isWindows ? 'bun.exe' : 'bun'
const outName = isWindows ? 'finova.exe' : 'finova'
const outPath = path.join('bin', outName)
const serverEntry = path.resolve('server', 'index.ts')

// Tanpa argumen = server web dibuka di peramban sistem. Sertakan -no-browser
// bila tidak ingin peramban dibuka otomatis.
const args = process.argv.slice(2)
if (!args.length) args.push('-browser')

let child
if (fs.existsSync(outPath)) {
  child = spawn(outPath, args, { stdio: 'inherit', windowsHide: true })
} else {
  if (!fs.existsSync(serverEntry)) {
    console.error(`${serverEntry} tidak ditemukan: jalankan dari folder proyek Finova.`)
    process.exit(1)
  }
  console.log('Biner bin/ belum ada, menjalankan server dari sumber dengan Bun...')
  console.log('(untuk biner mandiri: npm run build:server)')
  child = spawn(bunBin, ['run', serverEntry, ...args], { stdio: 'inherit', windowsHide: true })
}

child.on('error', (error) => {
  console.error(`Gagal menjalankan server: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code) => {
  process.exitCode = code ?? 0
})

// Teruskan Ctrl+C ke proses anak supaya server bisa menutup database dengan rapi.
process.on('SIGINT', () => {
  if (!child.killed) child.kill(isWindows ? undefined : 'SIGTERM')
})
process.on('SIGTERM', () => {
  if (!child.killed) child.kill('SIGTERM')
})
