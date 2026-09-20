import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import Database from 'better-sqlite3'

dotenv.config()

const dbFile = process.env.DATABASE_FILE || path.resolve('database/finova.sqlite')
const dbDir = path.dirname(dbFile)

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

try {
  const db: Database.Database = new Database(dbFile)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schemaPath = path.resolve('database/schema.sqlite.sql')
  const schemaSql = fs.readFileSync(schemaPath, 'utf8')
  db.exec(schemaSql)
  db.close()

  console.log(`Database lokal Finova (${dbFile}) siap digunakan.`)
  console.log(`Tidak memerlukan XAMPP atau phpMyAdmin. Berjalan otomatis.`)
} catch (error: any) {
  console.error(`Inisialisasi database lokal gagal: ${error.message}`)
  process.exitCode = 1
}
