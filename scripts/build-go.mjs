// Membangun biner server Go dengan nama berkas yang benar per sistem operasi
// (bin/finova.exe di Windows, bin/finova di Linux/macOS).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const outName = process.platform === 'win32' ? 'finova.exe' : 'finova'
const outPath = path.join('bin', outName)
fs.mkdirSync('bin', { recursive: true })

const args = ['build', '-o', outPath, './cmd/finova']
console.log(`go ${args.join(' ')}`)
const result = spawnSync('go', args, { stdio: 'inherit', windowsHide: true })
if (result.status !== 0) {
  console.error('Build Go gagal. Pastikan Go terpasang (`go version`) dan modul terunduh (`go mod download`).')
  process.exit(result.status ?? 1)
}
const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1)
console.log(`Selesai: ${outPath} (${sizeMb} MB, frontend sudah tertanam di dalamnya).`)
