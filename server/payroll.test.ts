import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFinovaApp, type FinovaApp } from './app'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-payroll-test-'))
const dbFile = path.join(scratch, 'payroll.sqlite')
const year = new Date().getFullYear()
const period = `${year}-06`
const payDate = `${year}-06-30`
let app: FinovaApp
let base = ''
let employeeId = 0
let periodId = 0

async function api(method: string, route: string, body?: unknown): Promise<any> {
  const response = await fetch(base + route, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const payload = await response.json()
  return { status: response.status, payload }
}

beforeAll(() => {
  app = createFinovaApp({ databaseFile: dbFile, port: 0 })
  base = `http://127.0.0.1:${app.start()}`
})

afterAll(async () => {
  app.stop()
  await new Promise((resolve) => setTimeout(resolve, 100))
  app.db.connection.close()
  fs.rmSync(scratch, { recursive: true, force: true })
})

describe('API siklus penggajian', () => {
  it('membuat karyawan, periode, dan input kehadiran', async () => {
    const employee = await api('POST', '/api/payroll/employees', {
      employee_code: 'PG-001',
      name: 'Karyawan Uji',
      department: 'Administrasi',
      job_title: 'Staf',
      join_date: `${year}-01-01`,
      ptkp_status: 'TK0',
      basic_salary: 10_000_000,
      fixed_allowance: 0,
      jkk_risk_class: 1,
      bank_name: 'BRI',
      bank_account: '1234567890'
    })
    expect(employee.status).toBe(201)
    employeeId = employee.payload.id

    const created = await api('POST', '/api/payroll/periods', { period, pay_date: payDate })
    expect(created.status).toBe(201)
    periodId = created.payload.id

    const input = await api('PUT', `/api/payroll/periods/${periodId}/inputs/${employeeId}`, {
      absent_days: 0,
      overtime_hours: 0,
      holiday_overtime_hours: 0,
      thr_amount: 0,
      other_allowance: 0,
      other_deduction: 0
    })
    expect(input.payload.ok).toBe(true)
  })

  it('menghitung gaji dengan BPJS dan PPh TER', async () => {
    const run = await api('POST', `/api/payroll/periods/${periodId}/run`)
    expect(run.payload.employees).toBe(1)

    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.payload.lines[0].thr_suggestion).toBe(4_166_666.67)
    const result = lines.payload.lines[0].run
    expect(result.tax_mode).toBe('TER')
    expect(result.gross_cash).toBe(10_000_000)
    expect(result.pph21).toBe(261_350)
    expect(result.net_pay).toBe(9_338_650)
  })

  it('membuat jurnal akrual seimbang saat disetujui', async () => {
    const approved = await api('POST', `/api/payroll/periods/${periodId}/approve`)
    expect(approved.payload.journalId).toBeGreaterThan(0)

    const entry = app.db.connection
      .query(
        `SELECT COALESCE(SUM(debit),0) AS debit, COALESCE(SUM(credit),0) AS credit
         FROM journal_lines WHERE journal_entry_id = ?`
      )
      .get(approved.payload.journalId) as { debit: number; credit: number }
    expect(entry.debit).toBe(entry.credit)
    expect(entry.debit).toBe(11_024_000)

    const journal = app.db.connection
      .query('SELECT source, status FROM journal_entries WHERE id = ?')
      .get(approved.payload.journalId) as { source: string; status: string }
    expect(journal.source).toBe('PAYROLL')
    expect(journal.status).toBe('POSTED')
  })

  it('mencatat jurnal pembayaran saat periode dibayar', async () => {
    const paid = await api('POST', `/api/payroll/periods/${periodId}/pay`)
    expect(paid.payload.journalId).toBeGreaterThan(0)

    const entry = app.db.connection
      .query(
        `SELECT COALESCE(SUM(debit),0) AS debit FROM journal_lines WHERE journal_entry_id = ?`
      )
      .get(paid.payload.journalId) as { debit: number }
    expect(entry.debit).toBe(9_338_650)

    const periods = await api('GET', '/api/payroll/periods')
    expect(periods.payload.periods[0].status).toBe('PAID')
  })

  it('menyediakan daftar jurnal payroll untuk UI', async () => {
    const response = await api('GET', '/api/payroll/journals')
    expect(response.payload.journals.length).toBe(2)
    expect(response.payload.journals.every((entry: any) => entry.source === 'PAYROLL')).toBe(true)
    expect(response.payload.journals[0].lines.length).toBeGreaterThanOrEqual(2)
  })

  it('menolak perhitungan ulang periode yang sudah dibayar', async () => {
    const run = await api('POST', `/api/payroll/periods/${periodId}/run`)
    expect(run.status).toBe(422)
  })

  it('menerapkan perubahan data karyawan hanya setelah disetujui', async () => {
    const submitted = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'basic_salary',
      new_value: 12_000_000,
      reason: 'Kenaikan gaji sesuai SK',
      requested_by_role: 'SDM'
    })
    expect(submitted.status).toBe(201)

    const employees = await api('GET', '/api/payroll/employees')
    expect(employees.payload.employees.find((row: any) => row.id === employeeId).basic_salary).toBe(10_000_000)

    const approved = await api('POST', `/api/payroll/change-requests/${submitted.payload.id}/decide`, {
      decision: 'APPROVED',
      note: 'Disetujui'
    })
    expect(approved.payload.status).toBe('APPROVED')

    const updated = await api('GET', '/api/payroll/employees')
    expect(updated.payload.employees.find((row: any) => row.id === employeeId).basic_salary).toBe(12_000_000)
  })

  it('menolak persetujuan periode ketika masih ada perubahan pending', async () => {
    const created = await api('POST', '/api/payroll/periods', {
      period: `${year}-08`,
      pay_date: `${year}-08-31`
    })
    expect(created.status).toBe(201)
    const submitted = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'position',
      new_value: 'Supervisor',
      reason: 'Mutasi jabatan'
    })
    expect(submitted.status).toBe(201)

    const approve = await api('POST', `/api/payroll/periods/${created.payload.id}/approve`)
    expect(approve.status).toBe(422)
    expect(approve.payload.message).toContain('belum disetujui')

    const rejected = await api('POST', `/api/payroll/change-requests/${submitted.payload.id}/decide`, {
      decision: 'REJECTED',
      note: 'Dokumen pendukung belum lengkap'
    })
    expect(rejected.payload.status).toBe('REJECTED')
  })

  it('menyediakan delapan dokumen PPT serta verifikasi dan rekonsiliasi', async () => {
    const created = await api('POST', '/api/payroll/periods', {
      period: `${year}-09`,
      pay_date: `${year}-09-30`
    })
    const newPeriodId = created.payload.id

    const documents = await api('GET', `/api/payroll/periods/${newPeriodId}/documents`)
    expect(documents.payload.documents.length).toBe(8)
    expect(documents.payload.documents[0].label).toBe('Data induk karyawan')
    expect(documents.payload.documents[7].doc_type).toBe('PAYROLL_JOURNAL')

    const saved = await api('POST', `/api/payroll/periods/${newPeriodId}/documents`, {
      doc_type: 'PAYROLL_REGISTER',
      reference_no: 'DG-09',
      doc_date: `${year}-09-30`,
      title: 'Daftar gaji',
      status: 'VERIFIED'
    })
    expect(saved.status).toBe(201)
    const refreshed = await api('GET', `/api/payroll/periods/${newPeriodId}/documents`)
    expect(refreshed.payload.documents.find((row: any) => row.doc_type === 'PAYROLL_REGISTER').status).toBe('VERIFIED')

    const verification = await api('POST', `/api/payroll/periods/${newPeriodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 1,
      operator_role: 'SDM'
    })
    expect(verification.payload.status).toBe('OK')
    expect(verification.payload.expected).toBe(1)

    const mismatch = await api('POST', `/api/payroll/periods/${newPeriodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 2,
      operator_role: 'SDM'
    })
    expect(mismatch.payload.status).toBe('MISMATCH')
    expect(mismatch.payload.difference).toBe(1)

    const checks = await api('GET', `/api/payroll/periods/${newPeriodId}/controls`)
    expect(checks.payload.checks.length).toBe(1)
    expect(checks.payload.suggested.payeeCount).toBe(1)
  })
})
