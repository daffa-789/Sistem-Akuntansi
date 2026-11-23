// Endpoint Siklus Penggajian / SDM.
//
// Alur: karyawan -> periode -> input kehadiran/lembur -> hitung -> setujui
// (jurnal akrual) -> bayar (jurnal kas). Semua perubahan dicatat di audit_logs.
import { AppError } from '../errors'
import { assertBalanced, roundMoney, type AmountedLine } from '../domain'
import {
  PTKP_AMOUNT,
  TER_CATEGORY,
  calculatePayroll,
  jpWageCap,
  progressiveTax,
  suggestThrAmount,
  terRate,
  type PtkpStatus,
  type TaxMode
} from '../payroll-domain'
import { localTimestamp } from '../lib/format'
import { intParam, readJson, strField, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>
type Handler = (ctx: Ctx) => Response | Promise<Response>

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Slide 28 BAB V: delapan dokumen siklus penggajian.
export const PAYROLL_DOCUMENT_TYPES = [
  ['EMPLOYEE_MASTER', 'Data induk karyawan', 'Identitas, jabatan, status kepegawaian, gaji, dan data rekening.'],
  ['ATTENDANCE', 'Daftar hadir / catatan waktu kerja', 'Kehadiran, keterlambatan, jam kerja, dan lembur.'],
  ['APPOINTMENT_DECREE', 'SK pengangkatan & perubahan gaji', 'Surat keputusan pengangkatan dan persetujuan perubahan gaji.'],
  ['PAYROLL_REGISTER', 'Daftar gaji', 'Rekap gaji kotor, potongan, dan gaji bersih per periode.'],
  ['PAYSLIP', 'Slip gaji', 'Rincian pendapatan dan potongan tiap karyawan.'],
  ['TRANSFER_PROOF', 'Bukti transfer gaji', 'Bukti pembayaran melalui bank atau metode pembayaran sah lainnya.'],
  ['TAX_ADMIN', 'Dokumen pajak & manfaat karyawan', 'NPWP, PTKP, dan administrasi iuran/manfaat karyawan.'],
  ['PAYROLL_JOURNAL', 'Jurnal penggajian', 'Jurnal akrual beban gaji dan jurnal pembayaran gaji.']
] as const

// Slide 30: perubahan data karyawan dan gaji harus mendapat persetujuan.
const CHANGE_FIELDS = new Set([
  'employee_code', 'name', 'department', 'position', 'employment_type', 'status', 'join_date',
  'exit_date', 'ptkp_status', 'npwp', 'bank_name', 'bank_account', 'basic_salary',
  'fixed_allowance', 'jkk_risk_class', 'family_members', 'is_expatriate'
])
const NUMERIC_CHANGE_FIELDS = new Set(['basic_salary', 'fixed_allowance', 'jkk_risk_class', 'family_members'])
const BOOLEAN_CHANGE_FIELDS = new Set(['is_expatriate'])
const NULLABLE_CHANGE_FIELDS = new Set(['exit_date', 'npwp', 'bank_name', 'bank_account'])

function changeValue(field: string, raw: unknown): unknown {
  if (BOOLEAN_CHANGE_FIELDS.has(field)) return raw === true || raw === 'true' || raw === 1 || raw === '1' ? 1 : 0
  if (NUMERIC_CHANGE_FIELDS.has(field)) {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw AppError.badRequest(`Nilai ${field} harus berupa angka.`)
    return value
  }
  const value = String(raw ?? '').trim()
  if (NULLABLE_CHANGE_FIELDS.has(field) && value === '') return null
  if (field === 'employee_code') return value.toUpperCase()
  return value
}

function numField(body: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = body[key]
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw AppError.badRequest(`Kolom ${key} harus berupa angka.`)
  return value
}

function lastDayOf(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period}-${String(day).padStart(2, '0')}`
}

export function payrollRoutes(state: AppState): Array<[string, string, Handler]> {
  const db = state.db.connection
  const companyId = state.config.companyId
  const operatorId = state.operatorId

  function audit(entityType: string, entityId: number | null, action: string, details: unknown): void {
    state.db.audit(companyId, operatorId, entityType, entityId, action, details)
  }

  function accountId(code: string): number {
    const row = db
      .query('SELECT id FROM accounts WHERE company_id = ? AND code = ?')
      .get(companyId, code) as { id: number } | null
    if (!row) throw AppError.badRequest(`Akun ${code} belum tersedia dalam bagan akun.`)
    return row.id
  }

  function nextVoucher(period: string): string {
    const prefix = `PAY-${period}-`
    const last = db
      .query(
        'SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no LIKE ? ORDER BY id DESC LIMIT 1'
      )
      .get(companyId, `${prefix}%`) as { voucher_no: string } | null
    let sequence = 1
    if (last) {
      const parsed = Number(last.voucher_no.slice(prefix.length))
      if (Number.isInteger(parsed)) sequence = parsed + 1
    }
    return `${prefix}${String(sequence).padStart(3, '0')}`
  }

  function postJournal(
    period: string,
    entryDate: string,
    description: string,
    lines: AmountedLine[]
  ): number {
    if (!DATE_RE.test(entryDate)) throw AppError.badRequest('Tanggal jurnal penggajian tidak valid.')
    const balanced = assertBalanced(lines)
    const accountingPeriod = db
      .query(
        `SELECT id, status FROM accounting_periods
         WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
      )
      .get(companyId, entryDate) as { id: number; status: string } | null
    if (!accountingPeriod) throw AppError.badRequest('Tanggal jurnal belum memiliki periode akuntansi.')
    if (accountingPeriod.status !== 'OPEN') throw AppError.badRequest('Periode akuntansi telah ditutup.')

    const voucherNo = nextVoucher(period)
    const info = db.run(
      `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, created_by, posted_by, posted_at)
       VALUES (?, ?, ?, ?, ?, 'PAYROLL', 'POSTED', ?, ?, ?)`,
      [companyId, accountingPeriod.id, voucherNo, entryDate, description, operatorId, operatorId, localTimestamp()]
    )
    const entryId = Number(info.lastInsertRowid)
    balanced.forEach((line, index) => {
      db.run(
        'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, line.account_id, index + 1, line.memo, line.debit, line.credit]
      )
    })
    audit('JOURNAL_ENTRY', entryId, 'POSTED', { source: 'PAYROLL', voucherNo })
    return entryId
  }

  function periodOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM payroll_periods WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Periode penggajian tidak ditemukan.')
    return row
  }

  function employeeOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM payroll_employees WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Karyawan tidak ditemukan.')
    return row
  }

  function activeEmployeesOf(period: AnyRow): AnyRow[] {
    return db
      .query(
        `SELECT * FROM payroll_employees
         WHERE company_id = ? AND (status = 'ACTIVE' OR exit_date LIKE ?)
         ORDER BY employee_code`
      )
      .all(companyId, `${period.period}%`) as AnyRow[]
  }

  function periodTotals(periodId: number): AnyRow {
    return (db
      .query(
        `SELECT COUNT(*) AS employees,
                COALESCE(SUM(net_pay),0) AS net,
                COALESCE(SUM(employer_cost),0) AS employer_cost
         FROM payroll_runs WHERE period_id = ? AND company_id = ?`
      )
      .get(periodId, companyId) as AnyRow) || { employees: 0, net: 0, employer_cost: 0 }
  }

  // Jumlah gaji bersih yang benar-benar dikreditkan ke akun Bank oleh jurnal
  // pembayaran payroll. Dipakai untuk rekonsiliasi slide 30.
  function paidBankTotal(period: AnyRow): number {
    const row = db
      .query(
        `SELECT COALESCE(SUM(l.credit), 0) AS total
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN accounts a ON a.id = l.account_id
         WHERE e.company_id = ? AND e.source = 'PAYROLL'
           AND e.voucher_no LIKE ? AND e.description LIKE 'Pembayaran gaji%'
           AND a.code = '1110'`
      )
      .get(companyId, `PAY-${period.period}-%`) as { total: number }
    return Number(row.total)
  }

  function validateEmployee(body: Record<string, unknown>, partial = false): void {
    const code = strField(body, 'employee_code')
    const name = strField(body, 'name')
    const joinDate = strField(body, 'join_date')
    const ptkp = strField(body, 'ptkp_status') || 'TK0'
    const risk = numField(body, 'jkk_risk_class', 1)
    const employment = strField(body, 'employment_type') || 'PKWTT'
    const status = strField(body, 'status') || 'ACTIVE'
    const exitDate = strField(body, 'exit_date')
    if (!partial || body.employee_code !== undefined) {
      if (!code) throw AppError.badRequest('Kode karyawan wajib diisi.')
    }
    if (!partial || body.name !== undefined) {
      if (!name) throw AppError.badRequest('Nama karyawan wajib diisi.')
    }
    if (!partial || body.join_date !== undefined) {
      if (!DATE_RE.test(joinDate)) throw AppError.badRequest('Tanggal masuk kerja tidak valid.')
    }
    if (!(ptkp in PTKP_AMOUNT)) throw AppError.badRequest('Status PTKP tidak dikenal.')
    if (!Number.isInteger(risk) || risk < 1 || risk > 5) throw AppError.badRequest('Kelas risiko JKK harus 1 sampai 5.')
    if (!['PKWTT', 'PKWT'].includes(employment)) throw AppError.badRequest('Jenis kontrak tidak dikenal.')
    if (!['ACTIVE', 'INACTIVE'].includes(status)) throw AppError.badRequest('Status karyawan tidak dikenal.')
    if (exitDate && !DATE_RE.test(exitDate)) throw AppError.badRequest('Tanggal keluar kerja tidak valid.')
    if (numField(body, 'basic_salary') < 0 || numField(body, 'fixed_allowance') < 0) {
      throw AppError.badRequest('Gaji pokok dan tunjangan tidak boleh negatif.')
    }
  }

  return [
    ['GET', '/api/payroll/journals', () => {
      const entries = db
        .query(
          `SELECT id, voucher_no, entry_date, description, source, status, posted_at
           FROM journal_entries WHERE company_id = ? AND source = 'PAYROLL'
           ORDER BY entry_date DESC, id DESC`
        )
        .all(companyId) as AnyRow[]
      const lines = db
        .query(
          `SELECT l.journal_entry_id, l.account_id, l.memo, l.debit, l.credit,
                  a.code AS account_code, a.name AS account_name
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.journal_entry_id
           JOIN accounts a ON a.id = l.account_id
           WHERE e.company_id = ? AND e.source = 'PAYROLL'
           ORDER BY l.journal_entry_id, l.line_no`
        )
        .all(companyId) as AnyRow[]
      const byEntry = new Map<number, AnyRow[]>()
      for (const line of lines) {
        const bucket = byEntry.get(line.journal_entry_id) ?? []
        bucket.push(line)
        byEntry.set(line.journal_entry_id, bucket)
      }
      return Response.json({
        journals: entries.map((entry) => ({ ...entry, lines: byEntry.get(entry.id) ?? [] }))
      })
    }],

    ['GET', '/api/payroll/parameters', () => Response.json({
      ptkp: PTKP_AMOUNT,
      terCategory: TER_CATEGORY,
      jkkRates: [0.24, 0.54, 0.89, 1.27, 1.74],
      bpjs: {
        kesehatanCap: 12_000_000,
        jpCap: jpWageCap(new Date().toISOString().slice(0, 7)),
        jhtEmployer: 0.037,
        jhtEmployee: 0.02,
        jpEmployer: 0.02,
        jpEmployee: 0.01,
        jkmEmployer: 0.003,
        kesehatanEmployer: 0.04,
        kesehatanEmployee: 0.01
      },
      terSample: {
        A: [[5_400_000, terRate('A', 5_400_000)], [10_454_000, terRate('A', 10_454_000)]],
        B: [[6_200_000, terRate('B', 6_200_000)]],
        C: [[6_600_000, terRate('C', 6_600_000)]]
      },
      annualTaxExample: progressiveTax(60_000_000),
      thr: { fullMonths: 12, multiplier: 1, prorated: true }
    })],

    ['GET', '/api/payroll/employees', () => {
      const rows = db
        .query('SELECT * FROM payroll_employees WHERE company_id = ? ORDER BY employee_code')
        .all(companyId)
      return Response.json({ employees: rows })
    }],

    ['POST', '/api/payroll/employees', async (ctx) => {
      const body = await readJson(ctx.req)
      validateEmployee(body)
      const info = db.run(
        `INSERT INTO payroll_employees
          (company_id, employee_code, name, department, position, employment_type, status, join_date, exit_date,
           ptkp_status, npwp, bank_name, bank_account, basic_salary, fixed_allowance, jkk_risk_class,
           family_members, is_expatriate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          strField(body, 'employee_code').toUpperCase(),
          strField(body, 'name'),
          strField(body, 'department'),
          strField(body, 'position'),
          strField(body, 'employment_type') || 'PKWTT',
          strField(body, 'status') || 'ACTIVE',
          strField(body, 'join_date'),
          strField(body, 'exit_date') || null,
          strField(body, 'ptkp_status') || 'TK0',
          strField(body, 'npwp') || null,
          strField(body, 'bank_name') || null,
          strField(body, 'bank_account') || null,
          numField(body, 'basic_salary'),
          numField(body, 'fixed_allowance'),
          numField(body, 'jkk_risk_class', 1),
          numField(body, 'family_members'),
          numField(body, 'is_expatriate') ? 1 : 0
        ]
      )
      const id = Number(info.lastInsertRowid)
      audit('PAYROLL_EMPLOYEE', id, 'CREATED', { code: strField(body, 'employee_code') })
      return Response.json({ id }, { status: 201 })
    }],

    ['PUT', '/api/payroll/employees/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      employeeOf(id)
      const body = await readJson(ctx.req)
      validateEmployee(body, true)
      const current = employeeOf(id)
      const value = (key: string, fallback: unknown): unknown =>
        body[key] === undefined ? fallback : body[key]
      db.run(
        `UPDATE payroll_employees SET
           employee_code = ?, name = ?, department = ?, position = ?, employment_type = ?, status = ?,
           join_date = ?, exit_date = ?, ptkp_status = ?, npwp = ?, bank_name = ?, bank_account = ?,
           basic_salary = ?, fixed_allowance = ?, jkk_risk_class = ?, family_members = ?,
           is_expatriate = ?, updated_at = datetime('now','localtime')
         WHERE id = ? AND company_id = ?`,
        [
          String(value('employee_code', current.employee_code)).toUpperCase(),
          value('name', current.name),
          value('department', current.department),
          value('position', current.position),
          value('employment_type', current.employment_type),
          value('status', current.status),
          value('join_date', current.join_date),
          body.exit_date === undefined ? current.exit_date : strField(body, 'exit_date') || null,
          value('ptkp_status', current.ptkp_status),
          body.npwp === undefined ? current.npwp : strField(body, 'npwp') || null,
          body.bank_name === undefined ? current.bank_name : strField(body, 'bank_name') || null,
          body.bank_account === undefined ? current.bank_account : strField(body, 'bank_account') || null,
          value('basic_salary', current.basic_salary),
          value('fixed_allowance', current.fixed_allowance),
          value('jkk_risk_class', current.jkk_risk_class),
          value('family_members', current.family_members),
          body.is_expatriate === undefined ? current.is_expatriate : numField(body, 'is_expatriate') ? 1 : 0,
          id,
          companyId
        ]
      )
      audit('PAYROLL_EMPLOYEE', id, 'UPDATED', { changed: Object.keys(body) })
      return Response.json({ ok: true })
    }],

    ['DELETE', '/api/payroll/employees/:id', (ctx) => {
      const id = intParam(ctx, 'id')
      employeeOf(id)
      db.run(
        `UPDATE payroll_employees SET status = 'INACTIVE', exit_date = date('now','localtime'),
         updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
        [id, companyId]
      )
      audit('PAYROLL_EMPLOYEE', id, 'DEACTIVATED', {})
      return Response.json({ ok: true })
    }],

    ['GET', '/api/payroll/change-requests', () => {
      const rows = db
        .query(
          `SELECT r.*, e.name AS employee_name, e.employee_code
           FROM payroll_change_requests r
           JOIN payroll_employees e ON e.id = r.employee_id
           WHERE r.company_id = ?
           ORDER BY CASE r.status WHEN 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC`
        )
        .all(companyId)
      return Response.json({ requests: rows })
    }],

    ['POST', '/api/payroll/change-requests', async (ctx) => {
      const body = await readJson(ctx.req)
      const employeeId = Number(body.employee_id)
      if (!Number.isInteger(employeeId)) throw AppError.badRequest('Karyawan tidak valid.')
      const employee = employeeOf(employeeId)
      const fieldName = strField(body, 'field_name')
      if (!CHANGE_FIELDS.has(fieldName)) throw AppError.badRequest('Field perubahan tidak dikenal.')
      const reason = strField(body, 'reason')
      if (!reason) throw AppError.badRequest('Alasan perubahan wajib diisi.')
      const value = changeValue(fieldName, body.new_value)
      if (value === null && !NULLABLE_CHANGE_FIELDS.has(fieldName)) {
        throw AppError.badRequest('Nilai baru tidak boleh kosong.')
      }
      const role = strField(body, 'requested_by_role') || 'SDM'
      const info = db.run(
        `INSERT INTO payroll_change_requests
          (company_id, employee_id, field_name, old_value, new_value, reason, requested_by_role)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [companyId, employeeId, fieldName, String(employee[fieldName] ?? ''), String(value ?? ''), reason, role]
      )
      const id = Number(info.lastInsertRowid)
      audit('PAYROLL_CHANGE_REQUEST', id, 'REQUESTED', { employeeId, fieldName, role })
      return Response.json({ id }, { status: 201 })
    }],

    ['POST', '/api/payroll/change-requests/:id/decide', async (ctx) => {
      const id = intParam(ctx, 'id')
      const row = db
        .query('SELECT * FROM payroll_change_requests WHERE id = ? AND company_id = ?')
        .get(id, companyId) as AnyRow | null
      if (!row) throw AppError.notFound('Permintaan perubahan tidak ditemukan.')
      if (row.status !== 'PENDING') throw AppError.badRequest('Permintaan perubahan sudah diputuskan.')
      const body = await readJson(ctx.req)
      const decision = strField(body, 'decision').toUpperCase()
      if (!['APPROVED', 'REJECTED'].includes(decision)) {
        throw AppError.badRequest('Keputusan harus APPROVED atau REJECTED.')
      }
      const note = strField(body, 'note')
      if (decision === 'APPROVED') {
        const field = String(row.field_name)
        if (!CHANGE_FIELDS.has(field)) throw AppError.badRequest('Field perubahan tidak dikenal.')
        const value = changeValue(field, row.new_value)
        validateEmployee({ ...employeeOf(Number(row.employee_id)), [field]: value }, true)
        db.run(
          `UPDATE payroll_employees SET ${field} = ?, updated_at = datetime('now','localtime')
           WHERE id = ? AND company_id = ?`,
          [value, row.employee_id, companyId]
        )
        audit('PAYROLL_EMPLOYEE', Number(row.employee_id), 'UPDATED', { via: 'CHANGE_REQUEST', field, value })
      }
      db.run(
        `UPDATE payroll_change_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?
         WHERE id = ? AND company_id = ?`,
        [decision, operatorId, localTimestamp(), note || null, id, companyId]
      )
      audit('PAYROLL_CHANGE_REQUEST', id, decision, { note })
      return Response.json({ ok: true, status: decision })
    }],

    ['GET', '/api/payroll/periods', () => {
      const rows = db
        .query('SELECT * FROM payroll_periods WHERE company_id = ? ORDER BY period DESC')
        .all(companyId)
      return Response.json({ periods: rows })
    }],

    ['POST', '/api/payroll/periods', async (ctx) => {
      const body = await readJson(ctx.req)
      const period = strField(body, 'period')
      if (!PERIOD_RE.test(period)) throw AppError.badRequest('Periode harus berformat YYYY-MM.')
      const payDate = strField(body, 'pay_date') || lastDayOf(period)
      if (!DATE_RE.test(payDate)) throw AppError.badRequest('Tanggal bayar tidak valid.')
      db.run(
        'INSERT INTO payroll_periods (company_id, period, pay_date) VALUES (?, ?, ?)',
        [companyId, period, payDate]
      )
      const row = db
        .query('SELECT id FROM payroll_periods WHERE company_id = ? AND period = ?')
        .get(companyId, period) as { id: number }
      audit('PAYROLL_PERIOD', row.id, 'CREATED', { period })
      return Response.json({ id: row.id }, { status: 201 })
    }],

    ['GET', '/api/payroll/periods/:id/lines', (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      const employees = db
        .query(
          `SELECT * FROM payroll_employees
           WHERE company_id = ? AND (status = 'ACTIVE' OR exit_date LIKE ?)
           ORDER BY employee_code`,
        )
        .all(companyId, `${period.period}%`) as AnyRow[]
      const lines = employees.map((employee) => {
        const input = db
          .query('SELECT * FROM payroll_inputs WHERE period_id = ? AND employee_id = ?')
          .get(period.id, employee.id) as AnyRow | null
        const run = db
          .query(
            `SELECT * FROM payroll_runs WHERE period_id = ? AND employee_id = ?
             ORDER BY version DESC LIMIT 1`
          )
          .get(period.id, employee.id) as AnyRow | null
        return {
          employee,
          input,
          run,
          thr_suggestion: suggestThrAmount(
            Number(employee.basic_salary) + Number(employee.fixed_allowance),
            String(employee.join_date),
            String(period.pay_date || lastDayOf(period.period))
          )
        }
      })
      return Response.json({ period, lines })
    }],

    ['GET', '/api/payroll/periods/:id/documents', (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      const existing = db
        .query('SELECT * FROM payroll_documents WHERE company_id = ? AND period_id = ?')
        .all(companyId, period.id) as AnyRow[]
      const byType = new Map(existing.map((row) => [String(row.doc_type), row]))
      return Response.json({
        period,
        documents: PAYROLL_DOCUMENT_TYPES.map(([type, label, description], index) => ({
          doc_type: type,
          label,
          description,
          order: index + 1,
          ...(byType.get(type) || {
            id: null, reference_no: '', doc_date: null, title: '', status: 'DRAFT', note: null
          })
        }))
      })
    }],

    ['POST', '/api/payroll/periods/:id/documents', async (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      if (period.status === 'PAID') throw AppError.badRequest('Periode sudah dibayar; dokumen tidak dapat diubah.')
      const body = await readJson(ctx.req)
      const docType = strField(body, 'doc_type')
      const known = PAYROLL_DOCUMENT_TYPES.find(([type]) => type === docType)
      if (!known) throw AppError.badRequest('Jenis dokumen tidak dikenal.')
      const docDate = strField(body, 'doc_date')
      if (docDate && !DATE_RE.test(docDate)) throw AppError.badRequest('Tanggal dokumen tidak valid.')
      const status = strField(body, 'status') || 'DRAFT'
      if (!['DRAFT', 'VERIFIED'].includes(status)) throw AppError.badRequest('Status dokumen tidak dikenal.')
      const info = db.run(
        `INSERT INTO payroll_documents
          (company_id, period_id, doc_type, reference_no, doc_date, title, status, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
         ON CONFLICT(company_id, period_id, doc_type) DO UPDATE SET
           reference_no = excluded.reference_no, doc_date = excluded.doc_date,
           title = excluded.title, status = excluded.status, note = excluded.note,
           updated_at = datetime('now','localtime')`,
        [
          companyId, period.id, docType, strField(body, 'reference_no'), docDate || null,
          strField(body, 'title') || known[1], status, strField(body, 'note') || null
        ]
      )
      audit('PAYROLL_DOCUMENT', period.id, 'UPSERTED', { period: period.period, docType, status })
      return Response.json({ id: Number(info.lastInsertRowid) }, { status: 201 })
    }],

    ['DELETE', '/api/payroll/documents/:id', (ctx) => {
      const id = intParam(ctx, 'id')
      const row = db
        .query('SELECT * FROM payroll_documents WHERE id = ? AND company_id = ?')
        .get(id, companyId) as AnyRow | null
      if (!row) throw AppError.notFound('Dokumen tidak ditemukan.')
      db.run('DELETE FROM payroll_documents WHERE id = ? AND company_id = ?', [id, companyId])
      audit('PAYROLL_DOCUMENT', id, 'DELETED', { docType: row.doc_type })
      return Response.json({ ok: true })
    }],

    ['GET', '/api/payroll/periods/:id/controls', (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      const checks = db
        .query('SELECT * FROM payroll_control_checks WHERE company_id = ? AND period_id = ? ORDER BY kind')
        .all(companyId, period.id) as AnyRow[]
      const totals = periodTotals(period.id)
      return Response.json({
        period,
        checks,
        suggested: {
          payeeCount: activeEmployeesOf(period).length,
          calculatedCount: Number(totals.employees),
          netTotal: roundMoney(Number(totals.net)),
          accountingTotal: roundMoney(paidBankTotal(period))
        }
      })
    }],

    ['POST', '/api/payroll/periods/:id/controls', async (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      const body = await readJson(ctx.req)
      const kind = strField(body, 'kind').toUpperCase()
      if (!['PAYEE_VERIFICATION', 'RECONCILIATION'].includes(kind)) {
        throw AppError.badRequest('Jenis pengendalian tidak dikenal.')
      }
      const totals = periodTotals(period.id)
      const note = strField(body, 'note')
      const role = strField(body, 'operator_role') || 'AKUNTANSI'
      let expected = 0
      let actual = 0
      let difference = 0
      let status = 'DONE'
      if (kind === 'PAYEE_VERIFICATION') {
        expected = activeEmployeesOf(period).length
        actual = numField(body, 'verified_count')
        difference = actual - expected
        status = difference === 0 ? 'OK' : 'MISMATCH'
      } else {
        expected = roundMoney(Number(totals.net))
        actual = roundMoney(numField(body, 'bank_total'))
        difference = roundMoney(actual - expected)
        const accounting = roundMoney(paidBankTotal(period))
        status = Math.abs(difference) < 0.01 && Math.abs(accounting - expected) < 0.01 ? 'OK' : 'MISMATCH'
      }
      db.run(
        `INSERT INTO payroll_control_checks
          (company_id, period_id, kind, expected_value, actual_value, difference, status,
           operator_id, operator_role, checked_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(company_id, period_id, kind) DO UPDATE SET
           expected_value = excluded.expected_value, actual_value = excluded.actual_value,
           difference = excluded.difference, status = excluded.status,
           operator_id = excluded.operator_id, operator_role = excluded.operator_role,
           checked_at = excluded.checked_at, note = excluded.note`,
        [
          companyId, period.id, kind, expected, actual, difference, status,
          operatorId, role, localTimestamp(), note || null
        ]
      )
      audit('PAYROLL_CONTROL', period.id, kind, { status, expected, actual, difference, role })
      return Response.json({ ok: true, status, expected, actual, difference })
    }],

    ['PUT', '/api/payroll/periods/:id/inputs/:employeeId', async (ctx) => {
      const periodId = intParam(ctx, 'id')
      const employeeId = intParam(ctx, 'employeeId')
      const period = periodOf(periodId)
      if (period.status !== 'DRAFT') throw AppError.badRequest('Periode sudah diproses; input tidak dapat diubah.')
      employeeOf(employeeId)
      const body = await readJson(ctx.req)
      const overtime = numField(body, 'overtime_hours')
      const holiday = numField(body, 'holiday_overtime_hours')
      const absent = numField(body, 'absent_days')
      if (overtime < 0 || overtime > 80 || holiday < 0 || holiday > 80 || absent < 0 || absent > 31) {
        throw AppError.badRequest('Jam lembur maksimal 80 jam/minggu-bulan dan absen 0–31 hari.')
      }
      state.db.withTransaction(() => {
        db.run(
          `INSERT INTO payroll_inputs
            (company_id, period_id, employee_id, absent_days, overtime_hours, holiday_overtime_hours,
             thr_amount, other_allowance, other_deduction, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
           ON CONFLICT(period_id, employee_id) DO UPDATE SET
             absent_days = excluded.absent_days,
             overtime_hours = excluded.overtime_hours,
             holiday_overtime_hours = excluded.holiday_overtime_hours,
             thr_amount = excluded.thr_amount,
             other_allowance = excluded.other_allowance,
             other_deduction = excluded.other_deduction,
             notes = excluded.notes,
             updated_at = datetime('now','localtime')`,
          [
            companyId, periodId, employeeId, absent, overtime, holiday,
            numField(body, 'thr_amount'), numField(body, 'other_allowance'), numField(body, 'other_deduction'),
            strField(body, 'notes') || null
          ]
        )
        audit('PAYROLL_INPUT', employeeId, 'UPSERTED', { period: period.period })
      })
      return Response.json({ ok: true })
    }],

    ['POST', '/api/payroll/periods/:id/run', (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      if (period.status !== 'DRAFT') throw AppError.badRequest('Periode sudah diproses dan tidak dapat dihitung ulang.')
      const year = period.period.slice(0, 4)
      const employees = db
        .query(
          `SELECT * FROM payroll_employees
           WHERE company_id = ? AND (status = 'ACTIVE' OR exit_date LIKE ?)
           ORDER BY employee_code`
        )
        .all(companyId, `${period.period}%`) as AnyRow[]

      state.db.withTransaction(() => {
        db.run('DELETE FROM payroll_runs WHERE period_id = ?', [period.id])
        for (const employee of employees) {
          const input = (db
            .query('SELECT * FROM payroll_inputs WHERE period_id = ? AND employee_id = ?')
            .get(period.id, employee.id) as AnyRow | null) ?? {}
          const ytd = (db
            .query(
              `SELECT COALESCE(SUM(r.tax_bruto), 0) AS gross, COALESCE(SUM(r.pph21), 0) AS tax,
                      COALESCE(SUM(r.jht_employee + r.jp_employee), 0) AS pension
               FROM payroll_runs r JOIN payroll_periods p ON p.id = r.period_id
               WHERE r.company_id = ? AND r.employee_id = ? AND p.period LIKE ? AND p.period < ?`
            )
            .get(companyId, employee.id, `${year}-%`, period.period) as AnyRow) || { gross: 0, tax: 0, pension: 0 }

          const exitMonth = employee.exit_date ? String(employee.exit_date).slice(0, 7) : ''
          const taxMode: TaxMode =
            period.period.endsWith('-12') || exitMonth === period.period ? 'ANNUAL' : 'TER'
          const result = calculatePayroll(
            {
              basicSalary: Number(employee.basic_salary),
              fixedAllowance: Number(employee.fixed_allowance),
              ptkpStatus: employee.ptkp_status as PtkpStatus,
              jkkRiskClass: Number(employee.jkk_risk_class),
              familyMembers: Number(employee.family_members),
              isExpatriate: Number(employee.is_expatriate) === 1
            },
            {
              period: period.period,
              absentDays: Number(input.absent_days ?? 0),
              overtimeHours: Number(input.overtime_hours ?? 0),
              holidayOvertimeHours: Number(input.holiday_overtime_hours ?? 0),
              thrAmount: Number(input.thr_amount ?? 0),
              otherAllowance: Number(input.other_allowance ?? 0),
              otherDeduction: Number(input.other_deduction ?? 0),
              taxMode
            },
            { gross: Number(ytd.gross), tax: Number(ytd.tax), pension: Number(ytd.pension) }
          )

          db.run(
            `INSERT INTO payroll_runs
              (company_id, period_id, employee_id, version, tax_mode, tax_category, gross_cash, overtime_pay,
               thr_amount, other_allowance, bpjs_kesehatan_employee, bpjs_kesehatan_employer, jht_employee, jht_employer,
               jp_employee, jp_employer, jkk_employer, jkm_employer, tax_bruto, pph21, other_deduction,
               net_pay, employer_contribution, employer_cost, calculation_json)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              companyId, period.id, employee.id, result.taxMode, result.taxCategory,
              result.grossCash, result.overtimePay, result.thrAmount, result.otherAllowance,
              result.bpjsKesehatanEmployee, result.bpjsKesehatanEmployer,
              result.jhtEmployee, result.jhtEmployer, result.jpEmployee, result.jpEmployer,
              result.jkkEmployer, result.jkmEmployer, result.taxBruto, result.pph21,
              result.otherDeduction, result.netPay, result.employerContribution, result.employerCost,
              JSON.stringify(result.calculation)
            ]
          )
        }
        audit('PAYROLL_PERIOD', period.id, 'CALCULATED', { period: period.period, employees: employees.length })
      })
      return Response.json({ ok: true, employees: employees.length })
    }],

    ['POST', '/api/payroll/periods/:id/approve', (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      if (period.status !== 'DRAFT') throw AppError.badRequest('Periode sudah disetujui atau dibayar.')
      const pending = db
        .query(
          `SELECT COUNT(*) AS total FROM payroll_change_requests r
           JOIN payroll_employees e ON e.id = r.employee_id
           WHERE r.company_id = ? AND r.status = 'PENDING'
             AND (e.status = 'ACTIVE' OR e.exit_date LIKE ?)`
        )
        .get(companyId, `${period.period}%`) as { total: number }
      if (Number(pending.total) > 0) {
        throw AppError.badRequest(
          'Masih ada perubahan data karyawan yang belum disetujui. Selesaikan persetujuan sebelum menyetujui periode.'
        )
      }
      const totals = db
        .query(
          `SELECT COUNT(*) AS employees,
                  COALESCE(SUM(gross_cash),0) AS gross,
                  COALESCE(SUM(net_pay),0) AS net,
                  COALESCE(SUM(pph21),0) AS tax,
                  COALESCE(SUM(bpjs_kesehatan_employee + jht_employee + jp_employee),0) AS bpjs_employee,
                  COALESCE(SUM(employer_contribution),0) AS bpjs_employer,
                  COALESCE(SUM(other_deduction),0) AS other_deduction,
                  COALESCE(SUM(employer_cost),0) AS employer_cost
           FROM payroll_runs WHERE period_id = ? AND company_id = ?`
        )
        .get(period.id, companyId) as AnyRow
      if (!totals.employees) throw AppError.badRequest('Belum ada hasil perhitungan untuk disetujui.')

      const lines: AmountedLine[] = [
        { account_id: accountId('5200'), debit: roundMoney(Number(totals.employer_cost)), credit: 0, memo: 'Beban gaji & upah karyawan' },
        { account_id: accountId('2110'), debit: 0, credit: roundMoney(Number(totals.net)), memo: 'Gaji bersih yang dibayarkan' },
        { account_id: accountId('2130'), debit: 0, credit: roundMoney(Number(totals.bpjs_employee) + Number(totals.bpjs_employer)), memo: 'Iuran BPJS karyawan & pemberi kerja' },
        { account_id: accountId('2140'), debit: 0, credit: roundMoney(Number(totals.tax)), memo: 'PPh 21 yang dipotong' },
        { account_id: accountId('2150'), debit: 0, credit: roundMoney(Number(totals.other_deduction)), memo: 'Potongan lain' }
      ].filter((line) => line.debit > 0 || line.credit > 0)

      let journalId = 0
      state.db.withTransaction(() => {
        journalId = postJournal(
          period.period,
          strField({ pay_date: period.pay_date }, 'pay_date') || lastDayOf(period.period),
          `Akrual gaji karyawan periode ${period.period}`,
          lines
        )
        db.run(
          `UPDATE payroll_periods SET status = 'APPROVED', approved_by = ?, approved_at = ?,
           accrual_journal_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
          [operatorId, localTimestamp(), journalId, period.id, companyId]
        )
        audit('PAYROLL_PERIOD', period.id, 'APPROVED', { period: period.period, journalId, totals })
      })
      return Response.json({ ok: true, journalId })
    }],

    ['POST', '/api/payroll/periods/:id/pay', (ctx) => {
      const period = periodOf(intParam(ctx, 'id'))
      if (period.status !== 'APPROVED') throw AppError.badRequest('Periode belum disetujui.')
      if (!period.pay_date) throw AppError.badRequest('Tanggal bayar belum ditentukan.')
      const net = Number(
        (db
          .query('SELECT COALESCE(SUM(net_pay),0) AS net FROM payroll_runs WHERE period_id = ? AND company_id = ?')
          .get(period.id, companyId) as AnyRow).net
      )
      if (net <= 0) throw AppError.badRequest('Tidak ada gaji bersih untuk dibayar.')

      const lines: AmountedLine[] = [
        { account_id: accountId('2110'), debit: roundMoney(net), credit: 0, memo: 'Pembayaran gaji bersih' },
        { account_id: accountId('1110'), debit: 0, credit: roundMoney(net), memo: 'Transfer gaji karyawan' }
      ]
      let journalId = 0
      state.db.withTransaction(() => {
        journalId = postJournal(period.period, period.pay_date, `Pembayaran gaji periode ${period.period}`, lines)
        db.run(
          `UPDATE payroll_periods SET status = 'PAID', paid_by = ?, paid_at = ?,
           payment_journal_id = ?, updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
          [operatorId, localTimestamp(), journalId, period.id, companyId]
        )
        audit('PAYROLL_PERIOD', period.id, 'PAID', { period: period.period, journalId, net })
      })
      const checks = db
        .query('SELECT kind, status FROM payroll_control_checks WHERE company_id = ? AND period_id = ?')
        .all(companyId, period.id) as AnyRow[]
      const warnings: string[] = []
      if (!checks.some((check) => check.kind === 'PAYEE_VERIFICATION' && check.status === 'OK')) {
        warnings.push('Daftar penerima gaji belum diverifikasi.')
      }
      if (!checks.some((check) => check.kind === 'RECONCILIATION' && check.status === 'OK')) {
        warnings.push('Rekonsiliasi gaji dengan catatan akuntansi dan rekening bank belum dinyatakan sesuai.')
      }
      return Response.json({ ok: true, journalId, warnings })
    }]
  ]
}
