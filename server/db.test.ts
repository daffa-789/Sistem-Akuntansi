// Uji lapisan database — menjalankan dengan `bun test server/`.
import { afterAll, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Db } from './db'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-db-test-'))
const dbFile = path.join(tmpDir, 'finova.sqlite')

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    /* abaikan */
  }
})

describe('Db.bootstrap', () => {
  it('membuat skema lengkap', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const tables = db.connection
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('companies')
    expect(names).toContain('accounts')
    expect(names).toContain('journal_entries')
    expect(names).toContain('journal_lines')
    expect(names).toContain('accounting_periods')
    expect(names).toContain('audit_logs')
    expect(names).toContain('payroll_employees')
    expect(names).toContain('payroll_periods')
    expect(names).toContain('payroll_runs')
    expect(names).toContain('payroll_documents')
    expect(names).not.toContain('import_batches')
    expect(names).not.toContain('journal_templates')
    expect(names).not.toContain('music_tracks')
  })

  it('menyemai enam akun penggajian dan 12 periode', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const accounts = db.connection.query('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }
    const periods = db.connection
      .query('SELECT COUNT(*) AS c FROM accounting_periods')
      .get() as { c: number }
    expect(accounts.c).toBe(6)
    expect(periods.c).toBe(12)
  })

  it('menyemai operator default dan idempoten saat diulang', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const users = db.connection.query('SELECT id, name, role FROM users').all() as {
      id: number
      name: string
      role: string
    }[]
    expect(users.length).toBe(6)
    expect(users.some((user) => user.role === 'ADMIN')).toBe(true)
    expect(users.some((user) => user.role === 'SDM')).toBe(true)
    expect(users.some((user) => user.role === 'PENGGAJIAN')).toBe(true)
    expect(users.some((user) => user.role === 'KEUANGAN')).toBe(true)
    expect(users.some((user) => user.role === 'AKUNTANSI')).toBe(true)
    expect(users.some((user) => user.role === 'SDM_MANAGER')).toBe(true)

    // Pemanggilan kedua tidak menggandakan apa pun.
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const usersAgain = db.connection.query('SELECT COUNT(*) AS c FROM users').get() as { c: number }
    const accountsAgain = db.connection.query('SELECT COUNT(*) AS c FROM accounts').get() as {
      c: number
    }
    expect(usersAgain.c).toBe(6)
    expect(accountsAgain.c).toBe(6)
  })
  it('menambahkan kolom lembur harian pada database lama tanpa menghapus data', () => {
    const legacyFile = path.join(tmpDir, 'legacy-payroll.sqlite')
    const legacy = Db.open(legacyFile)
    legacy.bootstrap(1, 'PT Uji', 'Operator Uji')
    legacy.connection.run('ALTER TABLE payroll_inputs DROP COLUMN overtime_days')
    legacy.connection.close()

    const migrated = Db.open(legacyFile)
    migrated.bootstrap(1, 'PT Uji', 'Operator Uji')
    const columns = migrated.connection
      .query('PRAGMA table_info(payroll_inputs)')
      .all() as Array<{ name: string }>
    const migrations = migrated.connection
      .query('SELECT version FROM schema_migrations WHERE version = 1')
      .get()
    expect(columns.some((column) => column.name === 'overtime_days')).toBe(true)
    expect(migrations).not.toBeNull()
    migrated.connection.close()
  })
})

describe('Db.withTransaction', () => {
  it('melakukan rollback saat ada galat', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    expect(() =>
      db.withTransaction(() => {
        db.connection.run("INSERT INTO companies (id, name) VALUES (99, 'Sementara')")
        throw new Error('sengaja gagal')
      })
    ).toThrow('sengaja gagal')
    const company = db.connection.query('SELECT id FROM companies WHERE id = 99').get()
    expect(company).toBeNull()
  })
})

describe('Db.clean', () => {
  it('membersihkan gaji beserta jurnal tertaut tanpa menghapus data induk', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const journal = db.connection.run(
      `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, created_by)
       VALUES (1, 1, 'PAY-TEST-1', '2026-10-01', 'Uji', 'PAYROLL', 'POSTED', 1)`
    )
    db.connection.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, line_no, debit, credit)
       VALUES (?, 1, 1, 100000, 0), (?, 2, 2, 0, 100000)`,
      [Number(journal.lastInsertRowid), Number(journal.lastInsertRowid)]
    )
    db.connection.run(
      `INSERT INTO payroll_periods (company_id, period, accrual_journal_id)
       VALUES (1, '2026-10', ?)`,
      [Number(journal.lastInsertRowid)]
    )
    db.connection.run(
      `INSERT INTO payroll_employees (company_id, employee_code, name, join_date, basic_salary)
       VALUES (1, 'EMP-TEST', 'Karyawan Uji', '2026-01-01', 5000000)`
    )
    db.audit(1, 1, 'JOURNAL_ENTRY', Number(journal.lastInsertRowid), 'CREATED', { uji: true })

    const { before, after } = db.clean(1)
    expect(before.payroll_periods).toBe(1)
    expect(before.journal_entries).toBe(1)
    expect(before.journal_lines).toBe(2)
    expect(after.payroll_periods).toBe(0)
    expect(after.journal_entries).toBe(0)
    expect(after.journal_lines).toBe(0)
    expect(after.audit_logs).toBe(0)

    const accounts = db.connection.query('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }
    const employees = db.connection.query('SELECT COUNT(*) AS c FROM payroll_employees').get() as {
      c: number
    }
    const periods = db.connection
      .query('SELECT COUNT(*) AS c FROM accounting_periods')
      .get() as { c: number }
    expect(accounts.c).toBe(6)
    expect(employees.c).toBe(1)
    expect(periods.c).toBe(12)
  })
})
