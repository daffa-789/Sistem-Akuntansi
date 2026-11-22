// Konfigurasi Finova — port dari src-rust/config.rs.
//
// Aturan pencarian nilai (sama persis dengan Rust):
//   1. Variabel lingkungan nyata menang.
//   2. Kalau kosong/tidak ada, nilai dari berkas .env di folder kerja.
//   3. Kalau tetap kosong, bawaan yang sama dengan versi Rust dipakai.
import fs from 'node:fs'
import path from 'node:path'

export interface Config {
  /** 0 = biarkan sistem operasi memilih port bebas. */
  port: number
  databaseFile: string
  clientOrigin: string
  companyName: string
  operatorName: string
  staticDir: string | null
  companyId: number
  version: string
}

const FALLBACK_DATABASE_NAME = 'finova.sqlite'

export function loadConfig(): Config {
  const envVars = readDotenv('.env')

  const getVar = (key: string): string | null => {
    const fromProcess = process.env[key]
    if (fromProcess !== undefined && fromProcess.trim() !== '') return fromProcess
    const fromFile = envVars[key]
    if (fromFile !== undefined && fromFile.trim() !== '') return fromFile
    return null
  }

  const portRaw = getVar('PORT')
  const port = portRaw && /^\d+$/.test(portRaw.trim()) ? Number(portRaw.trim()) : 0

  const explicitDb = getVar('DATABASE_FILE')
  const databaseFile = resolveDatabaseFile(explicitDb)

  return {
    port,
    databaseFile,
    clientOrigin: getVar('CLIENT_ORIGIN') ?? '',
    companyName: getVar('COMPANY_NAME') ?? 'PT Finova Akuntansi Indonesia',
    operatorName: getVar('OPERATOR_NAME') ?? 'Operator',
    staticDir: getVar('STATIC_DIR'),
    companyId: 1,
    version: readVersion()
  }
}

function resolveDatabaseFile(explicit: string | null): string {
  if (explicit && explicit.trim() !== '') return explicit.trim()

  const local = path.join('database', FALLBACK_DATABASE_NAME)
  // Versi Rust memakai "Cargo.toml ada di cwd" sebagai penanda mode repo.
  // Setelah migrasi, penandanya package.json — makna yang sama.
  if (fs.existsSync('package.json')) return local

  const base = process.env.LOCALAPPDATA || process.env.APPDATA
  if (base) {
    const appDir = path.join(base, 'Finova')
    try {
      fs.mkdirSync(appDir, { recursive: true })
      return path.join(appDir, FALLBACK_DATABASE_NAME)
    } catch {
      /* abaikan, jatuh ke folder lokal */
    }
  }
  return local
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version.trim() !== '') return pkg.version
  } catch {
    /* diabaikan */
  }
  return '1.0.0'
}

// Parser .env mini — port dari read_dotenv di Rust: komentar #, awalan
// "export " opsional, tanda kutip tunggal/ganda dibuang.
function readDotenv(file: string): Record<string, string> {
  const values: Record<string, string> = {}
  let text: string
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
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

/** Folder tempat database & berkas data (musik) berada. */
export function dataDirOf(databaseFile: string): string {
  const parent = path.dirname(databaseFile)
  return parent === '' ? '.' : parent
}

/** Folder WebView2 profil (versi Bun tidak lagi memakai WebView2, disimpan untuk kompatibilitas). */
export function webviewUserDataDir(databaseFile: string): string {
  return path.resolve(dataDirOf(databaseFile), 'webview2')
}
