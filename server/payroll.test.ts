import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFinovaApp, type FinovaApp } from './app'
import { DEMO_PASSWORD, DEMO_USERS, SESSION_COOKIE } from './auth'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-payroll-test-'))
const year = new Date().getFullYear()
const junePeriod = `${year}-06`
let app: FinovaApp
let base = ''
let databaseFile = ''
let databaseSequence = 0
let employeeSequence = 0

interface ApiResult {
  status: number
  payload: any
}

interface PayrollOptions {
  period?: string
  employee?: Record<string, unknown>
  input?: Record<string, unknown>
}

let sessionCookie = ''

async function rawApi(method: string, route: string, body?: unknown): Promise<ApiResult> {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(sessionCookie ? { Cookie: sessionCookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, payload: await response.json() }
}

/**
 * Field peran di body test adalah "pemeran" permintaan — server mengabaikannya
 * dan membaca peran dari sesi. Harness ini memastikan pengguna yang tepat yang
 * login sebelum eksekusi, lalu kembali ke admin setelahnya.
 */
async function loginAs(role: string): Promise<void> {
  const demo = DEMO_USERS.find((user) => user.role === role || user.email === role)
  const email = demo?.email ?? role
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD })
  })
  if (response.status !== 200) throw new Error(`Gagal login sebagai ${role}: ${await response.text()}`)
  const cookie = response.headers.get('set-cookie') || ''
  const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookie)?.[1]
  if (!token) throw new Error(`Cookie sesi tidak diterima untuk ${role}`)
  sessionCookie = `${SESSION_COOKIE}=${token}`
}

function roleHint(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const role = record.operator_role ?? record.requested_by_role
  return typeof role === 'string' && role ? role : null
}

async function api(method: string, route: string, body?: unknown): Promise<ApiResult> {
  const hint = roleHint(body)
  if (hint) await loginAs(hint)
  try {
    return await rawApi(method, route, body)
  } finally {
    if (hint) await loginAs('ADMIN')
  }
}

function lastDayOf(period: string): string {
  const [periodYear, month] = period.split('-').map(Number)
  const day = new Date(Date.UTC(periodYear, month, 0)).getUTCDate()
  return `${period}-${String(day).padStart(2, '0')}`
}

function expectBadRequest(result: ApiResult, message: string): void {
  expect(result.status).toBe(422)
  expect(result.payload.message).toContain(message)
}

async function createEmployee(overrides: Record<string, unknown> = {}): Promise<number> {
  employeeSequence += 1
  const response = await api('POST', '/api/payroll/employees', {
    employee_code: `PG-${String(employeeSequence).padStart(3, '0')}`,
    name: `Karyawan Uji ${employeeSequence}`,
    department: 'Administrasi',
    position: 'Staf',
    employment_type: 'PKWTT',
    status: 'ACTIVE',
    join_date: `${year}-01-01`,
    ptkp_status: 'TK0',
    basic_salary: 10_000_000,
    fixed_allowance: 0,
    jkk_risk_class: 1,
    family_members: 0,
    bank_name: 'BRI',
    bank_account: '1234567890',
    ...overrides
  })
  expect(response.status).toBe(201)
  return response.payload.id
}

async function createPeriod(period = junePeriod, payDate = lastDayOf(period)): Promise<number> {
  const response = await api('POST', '/api/payroll/periods', { period, pay_date: payDate })
  expect(response.status).toBe(201)
  return response.payload.id
}

async function putInput(
  periodId: number,
  employeeId: number,
  overrides: Record<string, unknown> = {}
): Promise<void> {
  const response = await api('PUT', `/api/payroll/periods/${periodId}/inputs/${employeeId}`, {
    absent_days: 0,
    overtime_hours: 0,
    overtime_days: 1,
    holiday_overtime_hours: 0,
    thr_amount: 0,
    other_allowance: 0,
    other_deduction: 0,
    ...overrides
  })
  expect(response.status).toBe(200)
  expect(response.payload.ok).toBe(true)
}

async function runPayroll(periodId: number): Promise<any> {
  const response = await api('POST', `/api/payroll/periods/${periodId}/run`)
  expect(response.status).toBe(200)
  expect(response.payload.ok).toBe(true)
  return response.payload
}

async function preparePayroll(options: PayrollOptions = {}): Promise<{ employeeId: number; periodId: number }> {
  const employeeId = await createEmployee(options.employee)
  const periodId = await createPeriod(options.period)
  await putInput(periodId, employeeId, options.input)
  await runPayroll(periodId)
  return { employeeId, periodId }
}

async function approvePeriod(periodId: number, operatorRole = 'ADMIN'): Promise<ApiResult> {
  return api('POST', `/api/payroll/periods/${periodId}/approve`, { operator_role: operatorRole })
}

async function addOkControls(periodId: number): Promise<any> {
  const controls = await api('GET', `/api/payroll/periods/${periodId}/controls`)
  expect(controls.status).toBe(200)

  const verification = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
    kind: 'PAYEE_VERIFICATION',
    verified_count: controls.payload.suggested.payeeCount,
    operator_role: 'SDM'
  })
  expect(verification.status).toBe(200)
  expect(verification.payload.status).toBe('OK')

  const reconciliation = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
    kind: 'RECONCILIATION',
    bank_total: controls.payload.suggested.netTotal,
    operator_role: 'AKUNTANSI'
  })
  expect(reconciliation.status).toBe(200)
  expect(reconciliation.payload.status).toBe('OK')
  return controls.payload.suggested
}

function periodRow(periodId: number): any {
  return app.db.connection
    .query('SELECT * FROM payroll_periods WHERE id = ?')
    .get(periodId)
}

function runsOf(periodId: number): any[] {
  return app.db.connection
    .query('SELECT * FROM payroll_runs WHERE period_id = ? ORDER BY employee_id, version')
    .all(periodId) as any[]
}

function latestRun(periodId: number, employeeId: number): any {
  return app.db.connection
    .query('SELECT * FROM payroll_runs WHERE period_id = ? AND employee_id = ? ORDER BY version DESC LIMIT 1')
    .get(periodId, employeeId)
}

function calculationOf(run: any): any {
  return JSON.parse(run.calculation_json)
}

function journalTotals(journalId: number): { debit: number; credit: number } {
  return app.db.connection
    .query(
      `SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
       FROM journal_lines WHERE journal_entry_id = ?`
    )
    .get(journalId) as { debit: number; credit: number }
}

beforeEach(async () => {
  databaseSequence += 1
  employeeSequence = 0
  databaseFile = path.join(scratch, `payroll-${databaseSequence}.sqlite`)
  app = createFinovaApp({ databaseFile, port: 0 })
  base = `http://127.0.0.1:${app.start()}`
  await loginAs('ADMIN')
})

afterEach(() => {
  app.stop()
  app.db.connection.close()
})

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true })
})

describe('API siklus penggajian', () => {
  it('membuat karyawan, periode, dan input kehadiran', async () => {
    const employeeId = await createEmployee()
    const periodId = await createPeriod()
    await putInput(periodId, employeeId)

    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.status).toBe(200)
    expect(lines.payload.period.status).toBe('DRAFT')
    expect(lines.payload.lines).toHaveLength(1)
    expect(lines.payload.lines[0].input.absent_days).toBe(0)
    expect(lines.payload.lines[0].input.overtime_days).toBe(1)
  })

  it('menghitung gaji dengan BPJS dan PPh TER', async () => {
    const { periodId } = await preparePayroll()
    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    const line = lines.payload.lines[0]

    expect(lines.payload.lines[0].thr_suggestion).toBe(4_166_666.67)
    expect(line.stale).toBe(false)
    expect(line.run.version).toBe(1)
    expect(line.run.tax_mode).toBe('TER')
    expect(line.run.tax_category).toBe('A')
    expect(line.run.gross_cash).toBe(10_000_000)
    expect(line.run.pph21).toBe(261_350)
    expect(line.run.net_pay).toBe(9_338_650)
  })

  it('membuat jurnal akrual seimbang saat disetujui', async () => {
    const { periodId } = await preparePayroll()
    const approved = await approvePeriod(periodId)
    expect(approved.status).toBe(200)
    expect(approved.payload.journalId).toBeGreaterThan(0)

    const totals = journalTotals(approved.payload.journalId)
    expect(totals.debit).toBe(totals.credit)
    expect(totals.debit).toBe(11_024_000)

    const journal = app.db.connection
      .query('SELECT source, status FROM journal_entries WHERE id = ?')
      .get(approved.payload.journalId) as { source: string; status: string }
    expect(journal.source).toBe('PAYROLL')
    expect(journal.status).toBe('POSTED')
    expect(periodRow(periodId).status).toBe('APPROVED')
    expect(periodRow(periodId).accrual_journal_id).toBe(approved.payload.journalId)
  })

  it('mencatat jurnal pembayaran setelah kedua kontrol OK', async () => {
    const { periodId } = await preparePayroll()
    const approved = await approvePeriod(periodId)
    expect(approved.status).toBe(200)
    await addOkControls(periodId)

    const paid = await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })
    expect(paid.status).toBe(200)
    expect(paid.payload.journalId).toBeGreaterThan(0)
    expect(journalTotals(paid.payload.journalId).debit).toBe(9_338_650)

    const periods = await api('GET', '/api/payroll/periods')
    expect(periods.payload.periods[0].status).toBe('PAID')
    expect(periods.payload.periods[0].payment_journal_id).toBe(paid.payload.journalId)
  })

  it('menyediakan daftar jurnal payroll untuk UI', async () => {
    const { periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)
    await addOkControls(periodId)
    expect((await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })).status).toBe(200)

    const response = await api('GET', '/api/payroll/journals')
    expect(response.payload.journals).toHaveLength(2)
    expect(response.payload.journals.every((entry: any) => entry.source === 'PAYROLL')).toBe(true)
    expect(response.payload.journals[0].lines.length).toBeGreaterThanOrEqual(2)
  })

  it('menolak perhitungan ulang periode yang sudah dibayar', async () => {
    const { periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)
    await addOkControls(periodId)
    expect((await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })).status).toBe(200)

    const run = await api('POST', `/api/payroll/periods/${periodId}/run`)
    expectBadRequest(run, 'tidak dapat dihitung ulang')
  })

  it('menerapkan perubahan data karyawan hanya setelah disetujui', async () => {
    const employeeId = await createEmployee()
    const submitted = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'basic_salary',
      new_value: 12_000_000,
      reason: 'Kenaikan gaji sesuai SK',
      requested_by_role: 'SDM'
    })
    expect(submitted.status).toBe(201)

    const before = await api('GET', '/api/payroll/employees')
    expect(before.payload.employees.find((row: any) => row.id === employeeId).basic_salary).toBe(10_000_000)

    const approved = await api('POST', `/api/payroll/change-requests/${submitted.payload.id}/decide`, {
      decision: 'APPROVED',
      operator_role: 'SDM_MANAGER',
      note: 'Disetujui'
    })
    expect(approved.status).toBe(200)
    expect(approved.payload.status).toBe('APPROVED')

    const updated = await api('GET', '/api/payroll/employees')
    expect(updated.payload.employees.find((row: any) => row.id === employeeId).basic_salary).toBe(12_000_000)
  })

  it('mengajukan dan menyetujui nonaktif bersama tanggal keluar', async () => {
    const employeeId = await createEmployee()
    const exitDate = `${year}-06-15`
    const requests: ApiResult[] = []
    for (const [field, value] of [
      ['exit_date', exitDate],
      ['status', 'INACTIVE']
    ] as const) {
      requests.push(await api('POST', '/api/payroll/change-requests', {
        employee_id: employeeId,
        field_name: field,
        new_value: value,
        reason: 'Karyawan berhenti bekerja',
        requested_by_role: 'SDM'
      }))
    }
    expect(requests.map((result) => result.status)).toEqual([201, 201])

    expectBadRequest(await api('POST', `/api/payroll/change-requests/${requests[1].payload.id}/decide`, {
      decision: 'APPROVED',
      operator_role: 'SDM_MANAGER'
    }), 'Tanggal keluar kerja wajib diisi')
    const unchanged = await api('GET', '/api/payroll/employees')
    expect(unchanged.payload.employees.find((row: any) => row.id === employeeId)).toMatchObject({
      status: 'ACTIVE',
      exit_date: null
    })

    for (const request of requests) {
      const decision = await api('POST', `/api/payroll/change-requests/${request.payload.id}/decide`, {
        decision: 'APPROVED',
        operator_role: 'SDM_MANAGER'
      })
      expect(decision.status).toBe(200)
    }

    const employees = await api('GET', '/api/payroll/employees')
    expect(employees.payload.employees.find((row: any) => row.id === employeeId)).toMatchObject({
      status: 'INACTIVE',
      exit_date: exitDate
    })
  })

  it('menolak persetujuan periode ketika masih ada perubahan pending', async () => {
    const { employeeId, periodId } = await preparePayroll({ period: `${year}-08` })
    const submitted = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'position',
      new_value: 'Supervisor',
      reason: 'Mutasi jabatan',
      requested_by_role: 'SDM'
    })
    expect(submitted.status).toBe(201)

    const approve = await approvePeriod(periodId)
    expectBadRequest(approve, 'belum disetujui')
    expect(periodRow(periodId).status).toBe('DRAFT')
    expect(periodRow(periodId).accrual_journal_id).toBeNull()

    const rejected = await api('POST', `/api/payroll/change-requests/${submitted.payload.id}/decide`, {
      decision: 'REJECTED',
      operator_role: 'SDM_MANAGER',
      note: 'Dokumen pendukung belum lengkap'
    })
    expect(rejected.payload.status).toBe('REJECTED')
    expect((await approvePeriod(periodId)).status).toBe(200)
  })

  it('menyediakan delapan dokumen dan mengupsert kontrol setelah disetujui', async () => {
    const periodId = await createPeriod(`${year}-09`)
    const documents = await api('GET', `/api/payroll/periods/${periodId}/documents`)
    expect(documents.payload.documents).toHaveLength(8)
    expect(documents.payload.documents[0].label).toBe('Data induk karyawan')
    expect(documents.payload.documents[7].doc_type).toBe('PAYROLL_JOURNAL')

    const saved = await api('POST', `/api/payroll/periods/${periodId}/documents`, {
      doc_type: 'PAYROLL_REGISTER',
      reference_no: 'DG-09',
      doc_date: `${year}-09-30`,
      title: 'Daftar gaji',
      status: 'VERIFIED'
    })
    expect(saved.status).toBe(201)
    const refreshed = await api('GET', `/api/payroll/periods/${periodId}/documents`)
    expect(refreshed.payload.documents.find((row: any) => row.doc_type === 'PAYROLL_REGISTER').status).toBe('VERIFIED')

    const beforeApproval = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 1,
      operator_role: 'SDM'
    })
    expectBadRequest(beforeApproval, 'setelah periode disetujui')
    const emptyChecks = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    expect(emptyChecks.payload.checks).toHaveLength(0)

    const employeeId = await createEmployee()
    await putInput(periodId, employeeId)
    await runPayroll(periodId)
    expect((await approvePeriod(periodId)).status).toBe(200)

    const mismatch = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 2,
      operator_role: 'SDM'
    })
    expect(mismatch.payload.status).toBe('MISMATCH')
    expect(mismatch.payload.difference).toBe(1)

    const verification = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 1,
      operator_role: 'SDM'
    })
    expect(verification.payload.status).toBe('OK')
    expect(verification.payload.expected).toBe(1)

    const reconciliation = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'RECONCILIATION',
      bank_total: 9_338_650,
      operator_role: 'AKUNTANSI'
    })
    expect(reconciliation.payload.status).toBe('OK')

    const checks = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    expect(checks.payload.checks).toHaveLength(2)
    expect(checks.payload.suggested.payeeCount).toBe(1)
    expect(checks.payload.suggested.calculatedCount).toBe(1)
  })

  it('menolak pembayaran tanpa verifikasi penerima dan rekonsiliasi yang OK', async () => {
    const { periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)

    const noControls = await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })
    expectBadRequest(noControls, 'belum diverifikasi')

    const payeeMismatch = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 2,
      operator_role: 'SDM'
    })
    expect(payeeMismatch.payload.status).toBe('MISMATCH')
    const mismatchedPayee = await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })
    expectBadRequest(mismatchedPayee, 'belum diverifikasi')

    const payeeOk = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 1,
      operator_role: 'SDM'
    })
    expect(payeeOk.payload.status).toBe('OK')
    const noReconciliation = await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })
    expectBadRequest(noReconciliation, 'Rekonsiliasi')

    const controls = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    const reconciliationMismatch = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'RECONCILIATION',
      bank_total: controls.payload.suggested.netTotal + 1,
      operator_role: 'AKUNTANSI'
    })
    expect(reconciliationMismatch.payload.status).toBe('MISMATCH')
    const mismatchedReconciliation = await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })
    expectBadRequest(mismatchedReconciliation, 'Rekonsiliasi')

    expect(periodRow(periodId).status).toBe('APPROVED')
    expect(periodRow(periodId).payment_journal_id).toBeNull()
    const journals = app.db.connection
      .query("SELECT COUNT(*) AS total FROM journal_entries WHERE source = 'PAYROLL'")
      .get() as { total: number }
    expect(journals.total).toBe(1)
  })

  it('mere konsiliasi pembayaran dengan kredit akrual utang gaji', async () => {
    const { periodId } = await preparePayroll()
    const approved = await approvePeriod(periodId)
    expect(approved.status).toBe(200)

    const controls = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    const liability = app.db.connection
      .query(
        `SELECT COALESCE(SUM(l.credit), 0) AS total
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
         WHERE l.journal_entry_id = ? AND a.code = '2110'`
      )
      .get(approved.payload.journalId) as { total: number }
    expect(controls.payload.suggested.netTotal).toBe(9_338_650)
    expect(controls.payload.suggested.accountingTotal).toBe(liability.total)
    expect(liability.total).toBe(controls.payload.suggested.netTotal)

    const reconciled = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'RECONCILIATION',
      bank_total: controls.payload.suggested.netTotal,
      operator_role: 'AKUNTANSI'
    })
    expect(reconciled.payload).toMatchObject({
      status: 'OK',
      expected: 9_338_650,
      actual: 9_338_650,
      difference: 0
    })

    const mismatch = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'RECONCILIATION',
      bank_total: controls.payload.suggested.netTotal + 10_000,
      operator_role: 'AKUNTANSI'
    })
    expect(mismatch.payload.status).toBe('MISMATCH')
    expect(mismatch.payload.difference).toBe(10_000)

    const corrected = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'RECONCILIATION',
      bank_total: controls.payload.suggested.netTotal,
      operator_role: 'AKUNTANSI'
    })
    expect(corrected.payload.status).toBe('OK')
    const checks = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    const rows = checks.payload.checks.filter((row: any) => row.kind === 'RECONCILIATION')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('OK')
    expect(periodRow(periodId).payment_journal_id).toBeNull()
  })

  it('menjumlahkan versi run terbaru saat menyetujui dan membayar', async () => {
    const firstEmployeeId = await createEmployee()
    const secondEmployeeId = await createEmployee({ name: 'Karyawan Kedua' })
    const periodId = await createPeriod()
    await putInput(periodId, firstEmployeeId)
    await putInput(periodId, secondEmployeeId)
    await runPayroll(periodId)

    await putInput(periodId, firstEmployeeId, { other_allowance: 1_000_000 })
    await runPayroll(periodId)
    const runs = runsOf(periodId)
    expect(runs).toHaveLength(4)
    expect(runs.map((run) => run.version)).toEqual([1, 2, 1, 2])

    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    const latestNet = lines.payload.lines.reduce((sum: number, line: any) => sum + line.run.net_pay, 0)
    const allRunsNet = runs.reduce((sum, run) => sum + run.net_pay, 0)
    expect(allRunsNet).toBeGreaterThan(latestNet)

    expect((await approvePeriod(periodId)).status).toBe(200)
    const suggested = await addOkControls(periodId)
    expect(suggested.netTotal).toBe(latestNet)
    expect(suggested.accountingTotal).toBe(latestNet)

    const paid = await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })
    expect(paid.status).toBe(200)
    expect(journalTotals(paid.payload.journalId).debit).toBe(latestNet)
  })

  it('membuat versi run baru tanpa menghapus hasil sebelumnya', async () => {
    const { employeeId, periodId } = await preparePayroll()
    const firstRun = latestRun(periodId, employeeId)
    await putInput(periodId, employeeId, { other_allowance: 1_000_000 })
    await runPayroll(periodId)

    const runs = runsOf(periodId)
    expect(runs).toHaveLength(2)
    expect(runs[0].version).toBe(1)
    expect(runs[0].gross_cash).toBe(10_000_000)
    expect(runs[1].version).toBe(2)
    expect(runs[1].gross_cash).toBe(11_000_000)
    expect(runs[1].id).not.toBe(firstRun.id)

    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.payload.lines[0].run.version).toBe(2)
    expect(lines.payload.lines[0].stale).toBe(false)
  })

  it('menandai run basi setelah input berubah sampai dihitung ulang', async () => {
    const { employeeId, periodId } = await preparePayroll()
    const before = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(before.payload.lines[0].stale).toBe(false)

    await putInput(periodId, employeeId, { other_allowance: 500_000 })
    const stale = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(stale.payload.lines[0].stale).toBe(true)
    const rejected = await approvePeriod(periodId)
    expectBadRequest(rejected, 'data terbaru')
    expect(periodRow(periodId).status).toBe('DRAFT')
    expect(periodRow(periodId).accrual_journal_id).toBeNull()

    await runPayroll(periodId)
    const current = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(current.payload.lines[0].stale).toBe(false)
    expect(current.payload.lines[0].run.version).toBe(2)
    expect((await approvePeriod(periodId)).status).toBe(200)
  })

  it('menandai run basi setelah perubahan karyawan disetujui', async () => {
    const { employeeId, periodId } = await preparePayroll()
    const request = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'basic_salary',
      new_value: 12_000_000,
      reason: 'Kenaikan gaji berlaku periode ini',
      requested_by_role: 'SDM'
    })
    expect(request.status).toBe(201)
    const decision = await api('POST', `/api/payroll/change-requests/${request.payload.id}/decide`, {
      decision: 'APPROVED',
      operator_role: 'SDM_MANAGER'
    })
    expect(decision.status).toBe(200)

    const stale = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(stale.payload.lines[0].stale).toBe(true)
    expectBadRequest(await approvePeriod(periodId), 'data terbaru')

    await runPayroll(periodId)
    const current = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(current.payload.lines[0].stale).toBe(false)
    expect(current.payload.lines[0].employee.basic_salary).toBe(12_000_000)
    expect(current.payload.lines[0].run.gross_cash).toBe(12_000_000)
    expect((await approvePeriod(periodId)).status).toBe(200)
  })

  it('mengecualikan karyawan masuk bulan depan dan memprorasi masuk tengah bulan', async () => {
    const fullMonthEmployeeId = await createEmployee()
    const futureEmployeeId = await createEmployee({
      name: 'Karyawan Bulan Depan',
      join_date: `${year}-07-01`
    })
    const midMonthEmployeeId = await createEmployee({
      name: 'Karyawan Tengah Bulan',
      join_date: `${year}-06-16`
    })
    const periodId = await createPeriod()
    await putInput(periodId, fullMonthEmployeeId)
    await putInput(periodId, midMonthEmployeeId)

    const run = await runPayroll(periodId)
    expect(run.employees).toBe(2)
    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.payload.lines.map((line: any) => line.employee.id)).toEqual([
      fullMonthEmployeeId,
      midMonthEmployeeId
    ])

    const midMonth = lines.payload.lines.find((line: any) => line.employee.id === midMonthEmployeeId)
    expect(midMonth.run.gross_cash).toBe(5_000_000)
    expect(calculationOf(midMonth.run)).toMatchObject({
      activeDays: 15,
      calendarDays: 30,
      prorationFactor: 0.5
    })
    expect(midMonth.run.jht_employee).toBe(100_000)
    const futureRuns = app.db.connection
      .query('SELECT COUNT(*) AS total FROM payroll_runs WHERE period_id = ? AND employee_id = ?')
      .get(periodId, futureEmployeeId) as { total: number }
    expect(futureRuns.total).toBe(0)
  })

  it('membatasi hari lembur pada masa kerja aktif karyawan tengah bulan', async () => {
    const employeeId = await createEmployee({ join_date: `${year}-06-16` })
    const periodId = await createPeriod(`${year}-06`)
    const input = {
      absent_days: 0,
      overtime_hours: 1,
      overtime_days: 16,
      holiday_overtime_hours: 0,
      thr_amount: 0,
      other_allowance: 0,
      other_deduction: 0
    }

    expectBadRequest(
      await api('PUT', `/api/payroll/periods/${periodId}/inputs/${employeeId}`, input),
      '1 sampai 15'
    )
    const accepted = await api('PUT', `/api/payroll/periods/${periodId}/inputs/${employeeId}`, {
      ...input,
      overtime_days: 15
    })
    expect(accepted.status).toBe(200)
    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.payload.lines[0].input.overtime_days).toBe(15)
  })

  it('memakai Pasal 17 pada Desember dan menyimpan kategori TER', async () => {
    const employeeId = await createEmployee({ ptkp_status: 'TK2' })
    for (let month = 1; month <= 11; month += 1) {
      const priorPeriodId = await createPeriod(`${year}-${String(month).padStart(2, '0')}`)
      await putInput(priorPeriodId, employeeId)
      await runPayroll(priorPeriodId)
      expect((await approvePeriod(priorPeriodId)).status).toBe(200)
    }

    const periodId = await createPeriod(`${year}-12`)
    await putInput(periodId, employeeId)
    await runPayroll(periodId)
    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    const run = lines.payload.lines[0].run

    expect(run.tax_mode).toBe('ANNUAL')
    expect(run.tax_category).toBe('B')
    expect(run.pph21).toBe(917_490)
    expect(calculationOf(run).terCategory).toBe('B')
    expect(calculationOf(run).ytd).toEqual({
      gross: 114_994_000,
      tax: 1_724_910,
      pension: 3_300_000
    })

    const persisted = app.db.connection
      .query('SELECT tax_mode, tax_category FROM payroll_runs WHERE id = ?')
      .get(run.id) as { tax_mode: string; tax_category: string }
    expect(persisted).toEqual({ tax_mode: 'ANNUAL', tax_category: 'B' })
  })

  it('mengecualikan periode DRAFT dari YTD', async () => {
    const employeeId = await createEmployee()
    const januaryId = await createPeriod(`${year}-01`)
    const februaryId = await createPeriod(`${year}-02`)
    const marchId = await createPeriod(`${year}-03`)
    await putInput(januaryId, employeeId, { other_allowance: 500_000 })
    await putInput(februaryId, employeeId, { other_allowance: 2_000_000 })
    await putInput(marchId, employeeId)

    await runPayroll(januaryId)
    await runPayroll(februaryId)
    const februaryBeforeApproval = latestRun(februaryId, employeeId)
    expect(calculationOf(februaryBeforeApproval).ytd).toEqual({ gross: 0, tax: 0, pension: 0 })

    expect((await approvePeriod(januaryId)).status).toBe(200)
    const january = latestRun(januaryId, employeeId)
    const expectedYtd = {
      gross: january.tax_bruto,
      tax: january.pph21,
      pension: january.jht_employee + january.jp_employee
    }

    await runPayroll(februaryId)
    const februaryAfterApproval = latestRun(februaryId, employeeId)
    expect(calculationOf(februaryAfterApproval).ytd).toEqual(expectedYtd)

    await runPayroll(marchId)
    const march = latestRun(marchId, employeeId)
    expect(calculationOf(march).ytd).toEqual(expectedYtd)
    expect(periodRow(februaryId).status).toBe('DRAFT')
  })

  it('menolak potongan berlebih tanpa meninggalkan run parsial', async () => {
    await createEmployee({ name: 'Karyawan Valid' })
    const excessiveEmployeeId = await createEmployee({
      name: 'Karyawan Potongan Berlebih',
      basic_salary: 3_000_000
    })
    const periodId = await createPeriod()
    await putInput(periodId, excessiveEmployeeId, { other_deduction: 100_000_000 })

    const run = await api('POST', `/api/payroll/periods/${periodId}/run`)
    expectBadRequest(run, 'melebihi gaji kotor')
    expect(runsOf(periodId)).toHaveLength(0)
    expect(periodRow(periodId).status).toBe('DRAFT')
    const calculatedAudit = app.db.connection
      .query(
        `SELECT COUNT(*) AS total FROM audit_logs
         WHERE entity_type = 'PAYROLL_PERIOD' AND entity_id = ? AND action = 'CALCULATED'`
      )
      .get(periodId) as { total: number }
    expect(calculatedAudit.total).toBe(0)
  })

  it('mencegah mutasi langsung karyawan melalui PUT dan DELETE', async () => {
    const employeeId = await createEmployee()
    const updated = await api('PUT', `/api/payroll/employees/${employeeId}`, {
      basic_salary: 12_000_000
    })
    expectBadRequest(updated, 'permintaan perubahan')

    const afterPut = await api('GET', '/api/payroll/employees')
    expect(afterPut.payload.employees).toHaveLength(1)
    expect(afterPut.payload.employees[0].basic_salary).toBe(10_000_000)

    const deleted = await api('DELETE', `/api/payroll/employees/${employeeId}`)
    expectBadRequest(deleted, 'permintaan perubahan status')
    const afterDelete = await api('GET', '/api/payroll/employees')
    expect(afterDelete.payload.employees).toHaveLength(1)
    expect(afterDelete.payload.employees[0].id).toBe(employeeId)
  })

  it('menolak tanggal tidak valid dan jumlah tanggungan di luar rentang', async () => {
    const baseEmployee = {
      employee_code: 'PG-INVALID',
      name: 'Karyawan Tidak Valid',
      join_date: `${year}-01-01`,
      basic_salary: 10_000_000,
      fixed_allowance: 0,
      family_members: 0
    }
    const invalidDates: Array<[Record<string, unknown>, string]> = [
      [{ join_date: `${year}-02-30` }, 'Tanggal masuk kerja tidak valid'],
      [{ join_date: `${year}-06-31` }, 'Tanggal masuk kerja tidak valid'],
      [{ exit_date: `${year}-06-31` }, 'Tanggal keluar kerja tidak valid'],
      [{ join_date: `${year}-06-16`, exit_date: `${year}-06-15` }, 'tidak boleh sebelum tanggal masuk'],
      [{ status: 'INACTIVE' }, 'Tanggal keluar kerja wajib diisi']
    ]
    for (const [overrides, message] of invalidDates) {
      expectBadRequest(await api('POST', '/api/payroll/employees', {
        ...baseEmployee,
        ...overrides
      }), message)
    }

    expectBadRequest(await api('POST', '/api/payroll/periods', {
      period: `${year}-13`,
      pay_date: `${year}-12-31`
    }), 'Periode harus berformat')
    expectBadRequest(await api('POST', '/api/payroll/periods', {
      period: junePeriod,
      pay_date: `${year}-06-31`
    }), 'Tanggal bayar tidak valid')

    for (const familyMembers of [-1, 1.5, 4]) {
      expectBadRequest(await api('POST', '/api/payroll/employees', {
        ...baseEmployee,
        family_members: familyMembers
      }), 'tanggungan keluarga')
    }

    const employees = await api('GET', '/api/payroll/employees')
    const periods = await api('GET', '/api/payroll/periods')
    expect(employees.payload.employees).toHaveLength(0)
    expect(periods.payload.periods).toHaveLength(0)

    const employeeId = await createEmployee()
    const request = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'family_members',
      new_value: 4,
      reason: 'Uji validasi tanggungan',
      requested_by_role: 'SDM'
    })
    expectBadRequest(request, 'tanggungan keluarga')
    const unchanged = await api('GET', '/api/payroll/employees')
    expect(unchanged.payload.employees[0].family_members).toBe(0)
    const requests = await api('GET', '/api/payroll/change-requests')
    expect(requests.payload.requests).toHaveLength(0)
  })

  it('memvalidasi peran permintaan perubahan', async () => {
    const employeeId = await createEmployee()
    const request = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'position',
      new_value: 'Supervisor',
      reason: 'Uji peran',
      requested_by_role: 'AKUNTANSI'
    })
    expectBadRequest(request, 'harus diajukan oleh SDM')
    const requests = await api('GET', '/api/payroll/change-requests')
    expect(requests.payload.requests).toHaveLength(0)
  })

  it('memvalidasi peran kontrol setelah periode disetujui', async () => {
    const { periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)

    const verification = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'PAYEE_VERIFICATION',
      verified_count: 1,
      operator_role: 'AKUNTANSI'
    })
    expectBadRequest(verification, 'SDM atau bagian penggajian')

    const reconciliation = await api('POST', `/api/payroll/periods/${periodId}/controls`, {
      kind: 'RECONCILIATION',
      bank_total: 9_338_650,
      operator_role: 'SDM'
    })
    expectBadRequest(reconciliation, 'akuntansi atau keuangan')
    const checks = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    expect(checks.payload.checks).toHaveLength(0)

    await addOkControls(periodId)
  })

  it('memvalidasi peran persetujuan periode', async () => {
    const { periodId } = await preparePayroll()
    for (const role of ['SDM', 'SDM_MANAGER', 'AKUNTANSI', 'KEUANGAN']) {
      expectBadRequest(await approvePeriod(periodId, role), 'penggajian atau admin')
    }
    expect(periodRow(periodId).status).toBe('DRAFT')
    expect(periodRow(periodId).accrual_journal_id).toBeNull()
    expect((await approvePeriod(periodId, 'PENGGAJIAN')).status).toBe(200)
  })

  it('memvalidasi peran pembayaran gaji', async () => {
    const { periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)
    await addOkControls(periodId)

    for (const role of ['SDM', 'PENGGAJIAN', 'AKUNTANSI']) {
      expectBadRequest(await api('POST', `/api/payroll/periods/${periodId}/pay`, {
        operator_role: role
      }), 'keuangan atau admin')
    }
    expect(periodRow(periodId).status).toBe('APPROVED')
    expect(periodRow(periodId).payment_journal_id).toBeNull()
    expect((await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })).status).toBe(200)
  })

  it('menolak persetujuan jika hasil seluruh karyawan eligible belum lengkap', async () => {
    const employeeId = await createEmployee()
    const periodId = await createPeriod()
    await putInput(periodId, employeeId)
    expectBadRequest(await approvePeriod(periodId), 'belum lengkap')

    await runPayroll(periodId)
    await createEmployee({ name: 'Karyawan Eligible Baru' })
    expectBadRequest(await approvePeriod(periodId), 'belum lengkap')
    expect(periodRow(periodId).status).toBe('DRAFT')

    expect((await runPayroll(periodId)).employees).toBe(2)
    expect((await approvePeriod(periodId)).status).toBe(200)
  })

  it('mengabaikan run historis karyawan yang sudah tidak eligible', async () => {
    const leavingEmployeeId = await createEmployee({ name: 'Karyawan Keluar' })
    const stayingEmployeeId = await createEmployee({ name: 'Karyawan Tetap' })
    const periodId = await createPeriod()
    await putInput(periodId, leavingEmployeeId)
    await putInput(periodId, stayingEmployeeId)
    await runPayroll(periodId)

    for (const [field, value] of [
      ['exit_date', `${year}-05-31`],
      ['status', 'INACTIVE']
    ] as const) {
      const request = await api('POST', '/api/payroll/change-requests', {
        employee_id: leavingEmployeeId,
        field_name: field,
        new_value: value,
        reason: 'Karyawan berhenti sebelum periode gaji',
        requested_by_role: 'SDM'
      })
      expect(request.status).toBe(201)
      expect((await api('POST', `/api/payroll/change-requests/${request.payload.id}/decide`, {
        decision: 'APPROVED',
        operator_role: 'SDM_MANAGER'
      })).status).toBe(200)
    }

    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.payload.lines.map((line: any) => line.employee.id)).toEqual([stayingEmployeeId])
    expect(runsOf(periodId)).toHaveLength(2)
    expect((await approvePeriod(periodId)).status).toBe(200)

    const suggested = await addOkControls(periodId)
    const stayingNet = latestRun(periodId, stayingEmployeeId).net_pay
    expect(suggested.payeeCount).toBe(1)
    expect(suggested.netTotal).toBe(stayingNet)
    expect(suggested.accountingTotal).toBe(stayingNet)
    expect((await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })).status).toBe(200)
  })

  it('menandai run basi setelah nama atau rekening bank berubah', async () => {
    const { employeeId, periodId } = await preparePayroll()
    const changes = [
      ['bank_account', '9876543210'],
      ['name', 'Nama Karyawan Diperbarui']
    ] as const

    for (const [field, value] of changes) {
      const request = await api('POST', '/api/payroll/change-requests', {
        employee_id: employeeId,
        field_name: field,
        new_value: value,
        reason: 'Pembaruan data penerima gaji',
        requested_by_role: 'SDM'
      })
      expect(request.status).toBe(201)
      expect((await api('POST', `/api/payroll/change-requests/${request.payload.id}/decide`, {
        decision: 'APPROVED',
        operator_role: 'SDM_MANAGER'
      })).status).toBe(200)

      const stale = await api('GET', `/api/payroll/periods/${periodId}/lines`)
      expect(stale.payload.lines[0].stale).toBe(true)
      expectBadRequest(await approvePeriod(periodId), 'data terbaru')
      await runPayroll(periodId)
      const current = await api('GET', `/api/payroll/periods/${periodId}/lines`)
      expect(current.payload.lines[0].stale).toBe(false)
    }

    expect(latestRun(periodId, employeeId).version).toBe(3)
    expect((await approvePeriod(periodId)).status).toBe(200)
  })

  it('membatalkan kontrol lama setelah data rekening penerima berubah', async () => {
    const { employeeId, periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)
    await addOkControls(periodId)

    const request = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'bank_name',
      new_value: 'BNI',
      reason: 'Rekening gaji berpindah bank',
      requested_by_role: 'SDM'
    })
    expect(request.status).toBe(201)
    expect((await api('POST', `/api/payroll/change-requests/${request.payload.id}/decide`, {
      decision: 'APPROVED',
      operator_role: 'SDM_MANAGER'
    })).status).toBe(200)

    const controls = await api('GET', `/api/payroll/periods/${periodId}/controls`)
    expect(controls.payload.checks).toHaveLength(0)
    expectBadRequest(await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    }), 'belum diverifikasi')

    await addOkControls(periodId)
    expect((await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })).status).toBe(200)
  })

  it('mengunci perubahan perhitungan selama periode disetujui belum dibayar', async () => {
    const { employeeId, periodId } = await preparePayroll()
    expect((await approvePeriod(periodId)).status).toBe(200)

    for (const [field, value] of [
      ['basic_salary', 12_000_000],
      ['ptkp_status', 'TK1']
    ] as const) {
      const request = await api('POST', '/api/payroll/change-requests', {
        employee_id: employeeId,
        field_name: field,
        new_value: value,
        reason: 'Perubahan berlaku setelah gaji dibayar',
        requested_by_role: 'SDM'
      })
      expectBadRequest(request, 'sudah disetujui dan belum dibayar')
    }
    expect((await api('GET', '/api/payroll/change-requests')).payload.requests).toHaveLength(0)

    await addOkControls(periodId)
    expect((await api('POST', `/api/payroll/periods/${periodId}/pay`, {
      operator_role: 'KEUANGAN'
    })).status).toBe(200)

    const futureChange = await api('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'basic_salary',
      new_value: 12_000_000,
      reason: 'Kenaikan gaji periode berikutnya',
      requested_by_role: 'SDM'
    })
    expect(futureChange.status).toBe(201)
  })

  it('membutuhkan sesi login dan mengambil peran dari pengguna, bukan body', async () => {
    const saved = sessionCookie
    sessionCookie = ''
    expect((await rawApi('GET', '/api/payroll/employees')).status).toBe(401)
    expect((await rawApi('GET', '/api/health')).status).toBe(200)
    sessionCookie = saved

    const wrong = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'sdm@finova.local', password: 'salah' })
    })
    expect(wrong.status).toBe(401)

    const employeeId = await createEmployee()
    await loginAs('KEUANGAN')
    expect((await rawApi('GET', '/api/auth/me')).payload.user.role).toBe('KEUANGAN')
    const rejected = await rawApi('POST', '/api/payroll/change-requests', {
      employee_id: employeeId,
      field_name: 'position',
      new_value: 'Supervisor',
      reason: 'Uji peran dari sesi'
    })
    expectBadRequest(rejected, 'harus diajukan oleh SDM')
    await loginAs('ADMIN')
  })

  it('mengakhiri sesi saat logout', async () => {
    expect((await rawApi('POST', '/api/auth/logout')).status).toBe(200)
    expect((await rawApi('GET', '/api/payroll/employees')).status).toBe(401)
    await loginAs('ADMIN')
    expect((await rawApi('GET', '/api/payroll/employees')).status).toBe(200)
  })

  it('menyimpan, melayani, dan menghapus berkas dokumen penggajian', async () => {
    const periodId = await createPeriod()
    const saved = await api('POST', `/api/payroll/periods/${periodId}/documents`, {
      doc_type: 'PAYSLIP',
      reference_no: 'SLIP-001',
      doc_date: lastDayOf(junePeriod),
      title: 'Slip gaji uji',
      status: 'VERIFIED'
    })
    expect(saved.status).toBe(201)
    const documentId = saved.payload.id

    const form = new FormData()
    form.append('file', new File(['isi slip uji'], 'slip-uji.txt', { type: 'text/plain' }))
    const upload = await fetch(base + `/api/payroll/documents/${documentId}/file`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: form
    })
    expect(upload.status).toBe(200)
    expect((await upload.json()).file.file_original).toBe('slip-uji.txt')

    const download = await fetch(base + `/api/payroll/documents/${documentId}/file`, {
      headers: { Cookie: sessionCookie }
    })
    expect(download.status).toBe(200)
    expect(await download.text()).toBe('isi slip uji')

    const documents = await api('GET', `/api/payroll/periods/${periodId}/documents`)
    const slip = documents.payload.documents.find((item: any) => item.doc_type === 'PAYSLIP')
    expect(slip.file_name).toMatch(/\.txt$/)

    const rejectedForm = new FormData()
    rejectedForm.append('file', new File(['x'], 'berbahaya.exe', { type: 'application/octet-stream' }))
    const rejected = await fetch(base + `/api/payroll/documents/${documentId}/file`, {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: rejectedForm
    })
    expect(rejected.status).toBe(422)

    expect((await api('DELETE', `/api/payroll/documents/${documentId}/file`)).status).toBe(200)
    const after = await api('GET', `/api/payroll/periods/${periodId}/documents`)
    expect(after.payload.documents.find((item: any) => item.doc_type === 'PAYSLIP').file_name).toBeNull()
  })

  it('mencatat keterlambatan tanpa mengubah gaji bersih', async () => {
    const employeeId = await createEmployee()
    const periodId = await createPeriod()
    await putInput(periodId, employeeId)
    await runPayroll(periodId)
    const baseline = Number(latestRun(periodId, employeeId).net_pay)

    await putInput(periodId, employeeId, { late_minutes: 45 })
    await runPayroll(periodId)
    const run = latestRun(periodId, employeeId)
    expect(Number(run.net_pay)).toBe(baseline)
    expect(calculationOf(run).lateMinutes).toBe(45)

    const lines = await api('GET', `/api/payroll/periods/${periodId}/lines`)
    expect(lines.payload.lines[0].input.late_minutes).toBe(45)
    expectBadRequest(
      await api('PUT', `/api/payroll/periods/${periodId}/inputs/${employeeId}`, { late_minutes: 2000 }),
      'Keterlambatan'
    )
  })
})
