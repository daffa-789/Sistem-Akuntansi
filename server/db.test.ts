import { describe, it, expect } from 'vitest'
import { pool, withTransaction, QueryResultInfo } from './db.js'

describe('SQLite Database Layer', () => {
  it('should query accounts from sqlite', async () => {
    const [accounts] = await pool.query<Array<{ code: string }>>('SELECT * FROM accounts WHERE company_id = 1')
    expect(accounts.length).toBeGreaterThan(10)
    expect(accounts.some(a => a.code === '1100')).toBe(true)
  })

  it('should normalize boolean and handle transactions', async () => {
    const result = await withTransaction(async (conn) => {
      const [res] = await conn.query<QueryResultInfo>(
        "INSERT INTO audit_logs (company_id, entity_type, action, details_json) VALUES (1, 'TEST', 'TEST_ACTION', ?)",
        [JSON.stringify({ ok: true })]
      )
      return (res as unknown as QueryResultInfo).insertId
    })

    expect(result).toBeGreaterThan(0)
    const [rows] = await pool.query<any>('SELECT * FROM audit_logs WHERE id = ?', [result])
    expect(rows.length).toBe(1)
    expect(rows[0].action).toBe('TEST_ACTION')
  })

  it('should rollback transaction on error', async () => {
    let errCaught = false
    try {
      await withTransaction(async (conn) => {
        await conn.query("INSERT INTO audit_logs (company_id, entity_type, action) VALUES (1, 'FAIL_TEST', 'ROLLBACK_ME')")
        throw new Error('Forced error for rollback test')
      })
    } catch {
      errCaught = true
    }
    expect(errCaught).toBe(true)

    const [rows] = await pool.query<any>("SELECT * FROM audit_logs WHERE action = 'ROLLBACK_ME'")
    expect(rows.length).toBe(0)
  })
})
