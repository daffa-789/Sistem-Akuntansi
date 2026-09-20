import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import dotenv from 'dotenv'

dotenv.config()

const dbFile = process.env.DATABASE_FILE || path.resolve('database/finova.sqlite')
const dbDir = path.dirname(dbFile)

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

export const db: Database.Database = new Database(dbFile)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export function initDatabase(): void {
  const schemaPath = path.resolve('database/schema.sqlite.sql')
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8')
    db.exec(schemaSql)
  }
}

// Inisialisasi otomatis jika tabel belum ada
initDatabase()

function cleanSql(sql: string): string {
  return sql
    .replace(/\bFOR\s+UPDATE\b/gi, '')
    .replace(/\bNOW\(\)/gi, "datetime('now', 'localtime')")
    .replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO')
}

function normalizeParam(val: unknown): unknown {
  if (typeof val === 'boolean') return val ? 1 : 0
  if (val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  return val
}

export interface QueryResultInfo {
  insertId: number
  affectedRows: number
}

function executeQuery(targetDb: Database.Database, sql: string, params: unknown[] = []): [any] {
  const cleaned = cleanSql(sql).trim()
  const boundParams = params.map(normalizeParam)

  const isSelect = /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(cleaned)
  if (isSelect) {
    const stmt = targetDb.prepare(cleaned)
    const rows = stmt.all(...boundParams)
    return [rows]
  }

  const stmt = targetDb.prepare(cleaned)
  const info = stmt.run(...boundParams)
  return [{
    insertId: Number(info.lastInsertRowid),
    affectedRows: info.changes
  }]
}

export const pool = {
  async query<T = any>(sql: string, params: unknown[] = []): Promise<[T]> {
    return executeQuery(db, sql, params) as [T]
  }
}

export interface DbConnection {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<[T]>
  release: () => void
}

export async function withTransaction<T>(callback: (connection: DbConnection) => Promise<T>): Promise<T> {
  db.prepare('BEGIN IMMEDIATE').run()
  try {
    const connection: DbConnection = {
      query: <R = any>(sql: string, params: unknown[] = []): Promise<[R]> =>
        Promise.resolve(executeQuery(db, sql, params) as [R]),
      release: () => {}
    }
    const result = await callback(connection)
    db.prepare('COMMIT').run()
    return result
  } catch (error) {
    try {
      db.prepare('ROLLBACK').run()
    } catch {
      // rollback error ignore if already rolled back
    }
    throw error
  }
}
