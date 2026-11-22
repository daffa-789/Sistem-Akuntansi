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
    expect(names).toContain('import_batches')
    expect(names).toContain('journal_templates')
    expect(names).toContain('music_tracks')
  })

  it('menyemai 36 akun standar dan 12 periode', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const accounts = db.connection.query('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }
    const periods = db.connection
      .query('SELECT COUNT(*) AS c FROM accounting_periods')
      .get() as { c: number }
    expect(accounts.c).toBe(36)
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
    expect(users.length).toBe(1)
    expect(users[0].name).toBe('Operator Uji')
    expect(users[0].role).toBe('ADMIN')

    // Pemanggilan kedua tidak menggandakan apa pun.
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    const usersAgain = db.connection.query('SELECT COUNT(*) AS c FROM users').get() as { c: number }
    const accountsAgain = db.connection.query('SELECT COUNT(*) AS c FROM accounts').get() as {
      c: number
    }
    expect(usersAgain.c).toBe(1)
    expect(accountsAgain.c).toBe(36)
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
  it('membersihkan transaksi tapi mempertahankan akun & periode', () => {
    const db = Db.open(dbFile)
    db.bootstrap(1, 'PT Uji', 'Operator Uji')
    db.connection.run(
      `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, created_by)
       VALUES (1, 1, 'JRN-TEST-1', '2026-10-01', 'Uji', 'MANUAL', 'POSTED', 1)`
    )
    db.audit(1, 1, 'JOURNAL_ENTRY', 1, 'CREATED', { uji: true })

    const { before, after } = db.clean(1)
    expect(before.journal_entries).toBe(1)
    expect(before.audit_logs).toBe(1)
    expect(after.journal_entries).toBe(0)
    expect(after.audit_logs).toBe(0)

    const accounts = db.connection.query('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }
    const periods = db.connection
      .query('SELECT COUNT(*) AS c FROM accounting_periods')
      .get() as { c: number }
    expect(accounts.c).toBe(36)
    expect(periods.c).toBe(12)
  })
})
