// Audit dependensi: temukan paket di package.json yang tidak pernah diimpor kode
// proyek (src/, scripts/, shared/, config). Berguna supaya tree node_modules
// tetap ramping seperti pola proyek Libray Game.
//
//   node scripts/audit-deps.mjs            -> daftar paket tak terpakai
//   node scripts/audit-deps.mjs --sizes    -> sertakan ukuran folder node_modules
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }

// File konfigurasi ini MEMANG menyebut nama paket tanpa impor; catat sebagai pemakaian.
// package.json sengaja dikecualikan: di sanalah daftar dependensi berada, kalau ikut
// dipindai maka setiap paket otomatis dianggap "dipakai".
const configFiles = ['vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json', 'index.html']

// Perkakas yang dipakai lewat CLI/konfigurasi sehingga wajar tidak diimpor kode.
const tooling = new Set([
  'typescript', 'vite', 'vitest', 'tsx', 'tailwindcss', 'autoprefixer', 'postcss',
  '@vitejs/plugin-react', 'jsdom', 'concurrently', 'dotenv',
  '@types/node', '@types/react', '@types/react-dom'
])
const skipDirs = new Set(['node_modules', '.git', 'dist', 'bin', 'coverage', 'database', 'internal', '.agents', '.zcode'])

const scanned = []
walk('.', 0)
function walk(dir, depth) {
  if (depth > 3) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, depth + 1)
    } else if (/\.(ts|tsx|js|mjs|cjs|css|html)$/.test(entry.name)) {
      scanned.push(full)
    }
  }
}
for (const config of configFiles) {
  if (fs.existsSync(config) && !scanned.includes(config)) scanned.push(config)
}

const sources = scanned.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }))
const isConfigOnly = (file) => configFiles.includes(file)

const unused = []
const used = []
for (const name of Object.keys(allDeps)) {
  const patterns = [
    new RegExp(`from\\s+['"]${escapeRe(name)}(/[^'"]*)?['"]`),
    new RegExp(`require\\(['"]${escapeRe(name)}(/[^'"]*)?['"]\\)`),
    new RegExp(`import\\(['"]${escapeRe(name)}(/[^'"]*)?['"]\\)`),
    new RegExp(`['"]${escapeRe(name)}['"]`),
    new RegExp(`\\b${escapeRe(name)}/`),
    new RegExp(`<${escapeRe(name)}\\b`)
  ]
  const hits = sources.filter((source) => patterns.some((pattern) => pattern.test(source.text)))
  if (hits.length === 0) {
    unused.push(name)
  } else {
    const onlyConfig = hits.every((hit) => isConfigOnly(hit.file))
    used.push({ name, onlyConfig, files: hits.map((hit) => hit.file).slice(0, 3) })
  }
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

const MB = 1024 * 1024
const dirSize = (target) => {
  let total = 0
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return '?'
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) stack.push(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch {
          /* abaikan berkas yang sedang berpindah */
        }
      }
    }
  }
  return (total / MB).toFixed(1)
}

console.log(`Berkas dipindai : ${sources.length}`)
const referenced = used.map((item) => item.name)
console.log(`Dipakai kode    : ${referenced.filter((name) => !tooling.has(name)).length} paket`)

const removable = unused.filter((name) => !tooling.has(name))
const perkakas = Object.keys(allDeps).filter((name) => tooling.has(name))
if (removable.length) {
  console.log('\nTIDAK dipakai kode dan bukan perkakas -> kandidat hapus:')
  for (const name of removable) {
    const where = pkg.dependencies?.[name] ? 'dependencies' : 'devDependencies'
    const size = fs.existsSync(path.join('node_modules', name)) ? `${dirSize(path.join('node_modules', name))} MiB` : 'tidak terpasang'
    console.log(`  - ${name} (${where}, ${size})`)
  }
} else {
  console.log('\nTidak ada paket menganggur di luar perkakas build.')
}

// Perkakas tetap dibutuhkan walau tidak diimpor; hanya dilaporkan kalau hilang dari disk.
const missingTools = perkakas.filter((name) => !fs.existsSync(path.join('node_modules', name)))
if (missingTools.length) {
  console.log('\nPerkakas terdaftar tapi tidak terpasang:', missingTools.join(', '))
}

const configOnly = used.filter((item) => item.onlyConfig && !tooling.has(item.name))
if (configOnly.length) {
  console.log('\nHanya disebut di berkas konfigurasi:')
  for (const item of configOnly) console.log(`  - ${item.name} -> ${item.files.join(', ')}`)
}

if (process.argv.includes('--sizes')) {
  console.log(`\nTotal node_modules: ${dirSize('node_modules')} MiB`)
  const roots = []
  for (const entry of fs.readdirSync('node_modules', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join('node_modules', entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) roots.push(`node_modules/${entry.name}/${scoped.name}`)
      }
    } else roots.push(`node_modules/${entry.name}`)
  }
  const sized = roots.map((folder) => ({ folder, size: parseFloat(dirSize(folder)) || 0 }))
    .sort((a, b) => b.size - a.size).slice(0, 12)
  console.log('12 paket terbesar:')
  for (const item of sized) console.log(`  ${item.size.toFixed(1).padStart(6)} MiB  ${item.folder}`)
}
