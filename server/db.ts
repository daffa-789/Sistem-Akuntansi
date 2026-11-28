// Lapisan database Finova — port dari src-rust/db/mod.rs (rusqlite → bun:sqlite).
//
// bun:sqlite adalah driver SQLite bawaan Bun, jadi tidak ada dependensi npm
// tambahan dan berkas .sqlite yang sudah ada tetap terbaca penuh.
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_SQL } from './schema'
import { DEMO_PASSWORD, DEMO_USERS, hashPassword } from './auth'

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

      // Bisnis demonstrasi kini kafe maid (tema modul SIA). Nama bawaan lama
      // diperbarui; nama yang sudah diedit pengguna tidak ditimpa.
      this.db.run(
        `UPDATE companies SET name = 'Maid Caffe Finova', updated_at = datetime('now','localtime')
         WHERE id = ? AND name IN ('PT Finova Penggajian Indonesia', 'PT Finova Akuntansi Indonesia')`,
        [companyId]
      )

      // Pengguna bawaan yang lama tidak bisa login; aktifkan kembali dengan
      // sandi demo yang sama dengan akun-akun peran di bawah.
      const legacyUser = this.db
        .query('SELECT id, password_hash FROM users WHERE company_id = ? ORDER BY id LIMIT 1')
        .get(companyId) as { id: number; password_hash: string } | null
      if (legacyUser?.password_hash === LOGIN_DISABLED_HASH) {
        this.db.run(
          `UPDATE users SET name = ?, password_hash = ?, role = 'ADMIN', is_active = 1 WHERE id = ?`,
          [operatorName, hashPassword(DEMO_PASSWORD), legacyUser.id]
        )
      }

      // Setiap peran dalam pemisahan tugas BAB V.pptx punya akun sendiri.
      for (const demo of DEMO_USERS) {
        const exists = this.db.query('SELECT id FROM users WHERE email = ?').get(demo.email)
        if (!exists) {
          this.db.run(
            `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [companyId, demo.name, demo.email, hashPassword(DEMO_PASSWORD), demo.role]
          )
        }
        this.db.run(
          'UPDATE users SET role = ?, is_active = 1 WHERE company_id = ? AND email = ?',
          [demo.role, companyId, demo.email]
        )
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
    const addColumn = (table: string, name: string, definition: string): void => {
      const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!columns.some((column) => column.name === name)) {
        this.db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
      }
    }
    addColumn('payroll_inputs', 'overtime_days', 'INTEGER NOT NULL DEFAULT 1')
    addColumn('payroll_inputs', 'late_minutes', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('payroll_documents', 'file_name', 'TEXT NULL')
    addColumn('payroll_documents', 'file_original', 'TEXT NULL')
    addColumn('payroll_documents', 'file_size', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('payroll_documents', 'mime_type', 'TEXT NULL')
    addColumn('payroll_documents', 'uploaded_at', 'TEXT NULL')
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
      // Data transaksi siklus pendapatan dan pengeluaran juga dibersihkan.
      this.db.run('DELETE FROM revenue_control_checks WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM revenue_receipts WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM revenue_invoices WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM revenue_order_items WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM revenue_orders WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM revenue_menu_items WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM revenue_customers WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM expenditure_control_checks WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_payments WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_bills WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_goods_receipts WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_order_items WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_orders WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_requisition_items WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_requisitions WHERE company_id = ?', [companyId])
      this.db.run('DELETE FROM purchase_suppliers WHERE company_id = ?', [companyId])
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
