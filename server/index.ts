// Titik masuk CLI Finova — port dari src-rust/main.rs.
//
// Perintah & flag identik dengan versi Rust:
//   finova [serve|db:init|db:clean|version|help] [-port N] [-db path] [-static dir]
//        [-app] [-browser] [-no-browser] [-url URL]
//
//   bun run server/index.ts            (mode pengembangan, server saja)
//   bun run start                      (web produksi: server + peramban)
//
// Finova sekarang berjalan sebagai aplikasi web: -app dan -browser sama-sama
// membuka alamat lokal di peramban sistem.
import path from 'node:path'
import { loadConfig, type Config } from './config'
import { Db } from './db'
import { readLock, removeLock, serverAlive, writeLock } from './instance'
import { createFinovaApp } from './app'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  try {
    await run(args)
  } catch (err) {
    console.error(`Finova: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

interface LaunchOptions {
  window: boolean
  browser: boolean
  url: string
}

async function run(args: string[]): Promise<void> {
  let command = 'serve'
  const restArgs: string[] = []

  // Sama seperti Rust: hanya argumen PERTAMA yang mungkin menjadi nama
  // perintah; nilai flag (seperti path setelah -db) tidak pernah diperlakukan
  // sebagai perintah walau tidak diawali tanda '-'.
  args.forEach((arg, index) => {
    if (index === 0 && !arg.startsWith('-')) {
      command = arg
    } else {
      restArgs.push(arg)
    }
  })

  const cfg = loadConfig()
  const mode = { app: false, browser: false, noBrowser: false }
  let targetUrl = ''

  let i = 0
  while (i < restArgs.length) {
    const arg = restArgs[i]
    switch (arg) {
      case '-port':
      case '--port':
        if (i + 1 < restArgs.length) {
          i += 1
          const parsed = Number(restArgs[i])
          if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) cfg.port = parsed
        }
        break
      case '-db':
      case '--db':
        if (i + 1 < restArgs.length) {
          i += 1
          cfg.databaseFile = restArgs[i]
        }
        break
      case '-static':
      case '--static':
        if (i + 1 < restArgs.length) {
          i += 1
          cfg.staticDir = restArgs[i]
        }
        break
      case '-app':
      case '--app':
        mode.app = true
        break
      case '-browser':
      case '--browser':
        mode.browser = true
        break
      case '-no-browser':
      case '--no-browser':
        mode.noBrowser = true
        break
      case '-url':
      case '--url':
        if (i + 1 < restArgs.length) {
          i += 1
          targetUrl = restArgs[i]
        }
        break
      case '-v':
      case '--version':
      case 'version':
        command = 'version'
        break
      case '-h':
      case '--help':
      case 'help':
        command = 'help'
        break
      default:
        break
    }
    i += 1
  }

  switch (command) {
    case 'serve':
    case 'server': {
      const launch = resolveLaunch(mode, targetUrl)
      await serve(cfg, launch)
      break
    }
    case 'db:init': {
      const database = Db.open(cfg.databaseFile)
      database.bootstrap(cfg.companyId, cfg.companyName, cfg.operatorName)
      console.log(`Database lokal Finova (${cfg.databaseFile}) siap digunakan.`)
      console.log('Tidak memerlukan XAMPP atau phpMyAdmin. Berjalan otomatis.')
      break
    }
    case 'db:clean': {
      const database = Db.open(cfg.databaseFile)
      database.bootstrap(cfg.companyId, cfg.companyName, cfg.operatorName)
      const { before, after } = database.clean(cfg.companyId)
      console.log('=== STATUS DATABASE SEBELUM PEMBERSIHAN ===')
      console.log(`  - Jurnal: ${before.journal_entries}`)
      console.log(`  - Baris Jurnal: ${before.journal_lines}`)
      console.log(`  - Log Audit: ${before.audit_logs}`)
      console.log(`  - Batch Impor: ${before.import_batches}`)
      console.log('')
      console.log('=== STATUS DATABASE SETELAH PEMBERSIHAN ===')
      console.log(`  - Jurnal: ${after.journal_entries}`)
      console.log(`  - Baris Jurnal: ${after.journal_lines}`)
      console.log(`  - Log Audit: ${after.audit_logs}`)
      console.log(`  - Batch Impor: ${after.import_batches}`)
      console.log('')
      console.log(
        'Data transaksi dibersihkan. Bagan akun, periode, dan pengaturan perusahaan dipertahankan.'
      )
      break
    }
    case 'version': {
      console.log(`finova ${cfg.version} ${osName()}/${archName()} (Bun)`)
      break
    }
    case 'help': {
      printHelp()
      break
    }
    default:
      throw new Error(`Perintah "${command}" tidak dikenal, jalankan \`finova help\``)
  }
}

function resolveLaunch(
  mode: { app: boolean; browser: boolean; noBrowser: boolean },
  url: string
): LaunchOptions {
  const launch: LaunchOptions = { window: false, browser: false, url }
  if (mode.noBrowser) return launch
  if (mode.browser || mode.app) launch.browser = true
  return launch
}

function dataDirOf(databaseFile: string): string {
  return path.dirname(databaseFile) || '.'
}

async function serve(cfg: Config, mode: LaunchOptions): Promise<void> {
  const dataDir = dataDirOf(cfg.databaseFile)

  // Satu instance: kalau server lain masih hidup, cukup tunjukkan alamatnya.
  const existing = readLock(dataDir)
  if (existing && (await serverAlive(existing.port))) {
    const url = mode.url !== '' ? mode.url : `http://127.0.0.1:${existing.port}`
    console.log(`Finova sudah terbuka: ${url} — buka alamat tersebut di peramban.`)
    return
  }

  const app = createFinovaApp({
    port: cfg.port,
    databaseFile: cfg.databaseFile,
    staticDir: cfg.staticDir,
    version: cfg.version
  })
  const port = app.start()

  const target = mode.url !== '' ? mode.url : `http://127.0.0.1:${port}`
  console.log(`Finova ${cfg.version} — bootstrap siap (database ${cfg.databaseFile}).`)
  console.log(`Finova siap di ${target}`)

  if (mode.browser) {
    openBrowser(target)
  }

  writeLock(dataDir, port)

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nFinova dihentikan.')
      resolve()
    })
    process.on('SIGTERM', () => resolve())
  })

  app.stop()
  removeLock(dataDir)
}

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : process.platform === 'darwin'
          ? ['open', url]
          : ['xdg-open', url]
    Bun.spawn({ cmd, stdout: 'ignore', stderr: 'ignore' })
  } catch {
    /* pengguna bisa membuka alamat manual */
  }
}

function osName(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return process.platform
}

function archName(): string {
  return process.arch === 'x64' ? 'x86_64' : process.arch
}

function printHelp(): void {
  console.log('Finova — Sistem Akuntansi & Pembukuan Web Terpadu Indonesia')
  console.log('')
  console.log('Penggunaan:')
  console.log('  finova                 server lokal + buka di peramban sistem')
  console.log('  finova -browser        server + buka di peramban web')
  console.log('  finova -no-browser     server saja, tidak membuka apa pun')
  console.log('  finova db:init         inisialisasi database lokal')
  console.log('  finova db:clean        bersihkan data transaksi, pertahankan akun & periode')
  console.log('  finova version         tampilkan versi aplikasi')
  console.log('')
  console.log('Pilihan (Flags):')
  console.log('  -port <port>           tentukan port HTTP (bawaan: 0 = otomatis)')
  console.log('  -db <path>             lokasi berkas SQLite')
  console.log('  -static <folder>       folder aset frontend eksternal')
  console.log('  -url <url>             alamat kustom yang dibuka di peramban')
  console.log('')
  console.log('Aplikasi web:')
  console.log('  bun run dev             Vite + server Bun untuk pengembangan')
  console.log('  bun run build && bun start   build aset lalu buka di peramban')
}

void main()
