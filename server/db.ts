// Lapisan database Finova — port dari src-rust/db/mod.rs (rusqlite → bun:sqlite).
//
// bun:sqlite adalah driver SQLite bawaan Bun, jadi tidak ada dependensi npm
// tambahan dan berkas .sqlite yang sudah ada tetap terbaca penuh.
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL } from './schema'

export const LOGIN_DISABLED_HASH = '!!login-dinonaktifkan!!'

export interface TableCounts {
  payroll_periods: number
  payroll_runs: number
  journal_entries: number
  journal_lines: number
  audit_logs: number
}

export class Db {
  private constructor(private readonly db: Database) {}

  static open(databaseFile: string): Db {
    const parent = path.dirname(databaseFile)
    if (parent && parent !== '.') {
      fs.mkdirSync(parent, { recursive: true })
    }
    const db = new Database(databaseFile, { create: true })
    db.run('PRAGMA foreign_keys = ON')
    db.run('PRAGMA journal_mode = WAL')
    db.run('PRAGMA busy_timeout = 5000')
    return new Db(db)
  }

  /** Koneksi mentah untuk pemakaian luar (query langsung). */
  get connection(): Database {
    return this.db
  }

  /** Bungkus satu rangkaian pernyataan dalam satu transaksi. */
  withTransaction<T>(fn: () => T): T {
    this.db.run('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.run('COMMIT')
      return result
    } catch (err) {
      try {
        this.db.run('ROLLBACK')
      } catch {
        /* transaksi sudah tidak aktif */
      }
      throw err
    }
  }

  bootstrap(companyId: number, companyName: string, operatorName: string): void {
    this.withTransaction(() => {
      // Skema dipecah per pernyataan seperti versi Rust: komentar "--"
      // dibuang lebih dulu, lalu dipisah pada titik koma.
      const cleanSql = SCHEMA_SQL.split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
      for (const stmt of cleanSql.split(';')) {
        const s = stmt.trim()
        if (s) this.db.run(s)
      }

      this.migrate()

      this.db.run(
        "INSERT OR IGNORE INTO companies (id, name, currency) VALUES (?, ?, 'IDR')",
        [companyId, companyName]
      )

      const existingUser = this.db
        .query('SELECT id FROM users WHERE company_id = ? ORDER BY id LIMIT 1')
        .get(companyId) as { id: number } | null

      if (!existingUser) {
        this.db.run(
          `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
           VALUES (?, ?, 'operator@finova.local', ?, 'ADMIN', 1)`,
          [companyId, operatorName, LOGIN_DISABLED_HASH]
        )
      } else {
        this.db.run("UPDATE users SET name = ?, role = 'ADMIN', is_active = 1 WHERE id = ?", [
          operatorName,
          existingUser.id
        ])
      }

      // Pastikan 12 periode berjalan untuk tahun ini.
      const year = new Date().getFullYear()
      for (let month = 1; month <= 12; month++) {
        const start = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
        const end = lastDayOfMonth(year, month)
        const name = `${String(month).padStart(2, '0')}/${year}`
        this.db.run(
          'INSERT OR IGNORE INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
          [companyId, name, start, end]
        )
      }
    })
  }

  private migrate(): void {
    const columns = this.db.query('PRAGMA table_info(payroll_inputs)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'overtime_days')) {
      this.db.run(
        'ALTER TABLE payroll_inputs ADD COLUMN overtime_days INTEGER NOT NULL DEFAULT 1'
      )
    }
    this.db.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)')
  }

  clean(companyId: number): { before: TableCounts; after: TableCounts } {
    return this.withTransaction(() => {
      const getCounts = (): TableCounts => {
        const one = (sql: string, params: (number)[]): number =>
          (this.db.query(sql).get(...params) as { c: number } | null)?.c ?? 0
        return {
          payroll_periods: one('SELECT COUNT(*) AS c FROM payroll_periods WHERE company_id = ?', [
            companyId
          ]),
          payroll_runs: one('SELECT COUNT(*) AS c FROM payroll_runs WHERE company_id = ?', [companyId]),
          journal_entries: one('SELECT COUNT(*) AS c FROM journal_entries WHERE company_id = ?', [
            companyId
          ]),
          journal_lines: one(
            'SELECT COUNT(*) AS c FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)',
            [companyId]
          ),
          audit_logs: one('SELECT COUNT(*) AS c FROM audit_logs WHERE company_id = ?', [companyId])
        }
      }

      const before = getCounts()
      this.db.run('DELETE FROM payroll_control_checks WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM payroll_documents WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM payroll_change_requests WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM payroll_runs WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM payroll_inputs WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM payroll_periods WHERE company_id = ?', [companyId])
      this.db.run('UPDATE journal_entries SET reversal_of_id = NULL WHERE company_id = ?', [companyId])
      this.db.run(
        'DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = ?)',
        [companyId]
      )
      this.db.run('DELETE FROM journal_entries WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM audit_logs WHERE company_id = ?', [companyId])
      const after = getCounts()
      return { before, after }
    })
  }

  audit(
    companyId: number,
    userId: number,
    entityType: string,
    entityId: number | null,
    action: string,
    details: unknown
  ): void {
    const detailsJson = details === null || details === undefined ? null : JSON.stringify(details)
    this.db.run(
      `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [companyId, userId, entityType, entityId, action, detailsJson]
    )
  }
}

function lastDayOfMonth(year: number, month: number): string {
  const firstOfNext = new Date(Date.UTC(year, month, 1))
  const last = new Date(firstOfNext.getTime() - 24 * 60 * 60 * 1000)
  return last.toISOString().slice(0, 10)
}
