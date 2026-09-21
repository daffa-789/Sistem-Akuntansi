import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import ExcelJS from 'exceljs'
import { pool, withTransaction, DbConnection, QueryResultInfo } from './db.js'
import {
  amount, assertBalancedLines, accountBalance, calculateAccountBalances,
  buildTrialBalance, buildIncomeStatement, buildBalanceSheet, buildEquityChanges,
  buildCashFlowDirect, makeClosingLines
} from './accounting.js'
import {
  Account,
  Company,
  AccountingPeriod,
  JournalEntry,
  JournalLine,
  PublicUser,
  AuthClaims
} from '../shared/types.js'

dotenv.config()

export interface AuthenticatedUser {
  id: number
  company_id: number
  name: string
  email: string
  role: string
  is_active: number | boolean
}

declare global {
  namespace Express {
    interface Request {
      user: AuthenticatedUser
    }
  }
}

export interface AppError extends Error {
  status?: number
  code?: string
}

const app = express()
const port = Number(process.env.PORT || 5000)
const jwtSecret = process.env.JWT_SECRET || 'development-secret-change-me'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000', credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

const fail = (status: number, message: string): AppError => Object.assign(new Error(message), { status })
const asDate = (value: unknown): string => String(value).slice(0, 10)
const jsonValue = <T = unknown>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) : (value as T)
const publicUser = (user: AuthenticatedUser | { id: number; name: string; email: string; role: string; is_active: unknown }): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: Boolean(user.is_active)
})

function signUser(user: AuthenticatedUser): string {
  const claims: AuthClaims = { sub: user.id, companyId: user.company_id, role: user.role, name: user.name }
  return jwt.sign(claims, jwtSecret, { expiresIn: '8h' })
}

function setAuthCookie(res: Response, user: AuthenticatedUser): void {
  res.cookie('finova_token', signUser(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  })
}

async function ensureBootstrap(): Promise<void> {
  const [companies] = await pool.query<Company[]>('SELECT id FROM companies WHERE id = 1')
  if (!companies.length) await pool.query("INSERT INTO companies (id, name, currency) VALUES (1, 'PT Finova Akuntansi Indonesia', 'IDR')")
  const [users] = await pool.query<{ id: number }[]>('SELECT id FROM users WHERE role = \'ADMIN\' LIMIT 1')
  let adminId = users[0]?.id
  if (!users.length) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin123!', 12)
    const [res] = await pool.query<QueryResultInfo>('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (1, ?, ?, ?, \'ADMIN\')', [
      process.env.ADMIN_NAME || 'Administrator', (process.env.ADMIN_EMAIL || 'admin@finova.local').toLowerCase(), hash
    ])
    adminId = res.insertId
  }
  const year = new Date().getFullYear()
  for (let month = 1; month <= 12; month += 1) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end = new Date(year, month, 0).toISOString().slice(0, 10)
    await pool.query('INSERT OR IGNORE INTO accounting_periods (company_id, name, start_date, end_date) VALUES (1, ?, ?, ?)', [`${String(month).padStart(2, '0')}/${year}`, start, end])
  }
}

async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies.finova_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (token) {
      try {
        const claims = jwt.verify(token, jwtSecret) as unknown as AuthClaims
        const [rows] = await pool.query<AuthenticatedUser[]>('SELECT id, company_id, name, email, role, is_active FROM users WHERE id = ?', [claims.sub])
        if (rows[0] && rows[0].is_active) {
          req.user = rows[0]
          return next()
        }
      } catch {}
    }
    return next(fail(401, 'Silakan masuk terlebih dahulu.'))
  } catch (_err) {
    return next(fail(401, 'Silakan masuk terlebih dahulu.'))
  }
}

const adminOnly = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.user.role === 'ADMIN') {
    next()
  } else {
    next(fail(403, 'Fitur ini hanya dapat diakses admin.'))
  }
}

async function audit(
  connection: DbConnection | typeof pool,
  companyId: number,
  userId: number | null | undefined,
  entityType: string,
  entityId: number | null | undefined,
  action: string,
  details: unknown = null
): Promise<void> {
  await connection.query('INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json) VALUES (?, ?, ?, ?, ?, ?)', [
    companyId, userId || null, entityType, entityId || null, action, details ? JSON.stringify(details) : null
  ])
}

async function getOpenPeriod(connection: DbConnection, companyId: number, date: string): Promise<AccountingPeriod> {
  const [periods] = await connection.query<AccountingPeriod[]>('SELECT * FROM accounting_periods WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1 FOR UPDATE', [companyId, date])
  if (!periods[0]) throw fail(422, 'Tanggal transaksi belum memiliki periode akuntansi.')
  if (periods[0].status !== 'OPEN') throw fail(422, 'Periode transaksi telah ditutup dan dikunci.')
  return periods[0]
}

async function getAccountsForLines(connection: DbConnection, companyId: number, lines: (JournalLine | { account_id?: number; accountId?: number })[]): Promise<Account[]> {
  const ids = [...new Set(lines.map((line) => Number(line.account_id ?? (line as any).accountId)).filter(Boolean))]
  if (!ids.length) throw fail(422, 'Akun jurnal tidak valid.')
  const [accounts] = await connection.query<Account[]>(`SELECT * FROM accounts WHERE company_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [companyId, ...ids])
  if (accounts.length !== ids.length || accounts.some((account) => !account.is_active)) throw fail(422, 'Satu atau beberapa akun tidak aktif atau tidak ditemukan.')
  return accounts
}

export interface WriteEntryParams {
  companyId: number
  userId: number
  voucherNo: string
  entryDate: string
  description: string
  source?: string
  lines: JournalLine[]
  status?: string
  importBatchId?: number | null
  reversalOfId?: number | null
}

async function writeEntry(
  connection: DbConnection,
  { companyId, userId, voucherNo, entryDate, description, source = 'MANUAL', lines, status = 'DRAFT', importBatchId = null, reversalOfId = null }: WriteEntryParams
): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) throw fail(422, 'Tanggal jurnal tidak valid.')
  const normalized = assertBalancedLines(lines)
  const period = await getOpenPeriod(connection, companyId, entryDate)
  await getAccountsForLines(connection, companyId, normalized)
  const [result] = await connection.query<QueryResultInfo>(
    `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, import_batch_id, reversal_of_id, created_by, posted_by, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, period.id, voucherNo, entryDate, description, source, status, importBatchId, reversalOfId, userId, status === 'POSTED' ? userId : null, status === 'POSTED' ? new Date() : null]
  )
  const insertId = result.insertId
  for (const [index, line] of normalized.entries()) {
    await connection.query('INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)', [
      insertId, Number(line.account_id ?? (line as any).accountId), index + 1, line.memo || null, line.debit, line.credit
    ])
  }
  await audit(connection, companyId, userId, 'JOURNAL_ENTRY', insertId, status === 'POSTED' ? 'POSTED' : 'CREATED', { source, voucherNo })
  return insertId
}

async function fetchEntry(connection: DbConnection | typeof pool, companyId: number, id: string | number): Promise<JournalEntry & { lines: JournalLine[] }> {
  const [entries] = await connection.query<JournalEntry[]>('SELECT e.*, u.name AS created_by_name FROM journal_entries e JOIN users u ON u.id = e.created_by WHERE e.id = ? AND e.company_id = ?', [id, companyId])
  if (!entries[0]) throw fail(404, 'Jurnal tidak ditemukan.')
  const [lines] = await connection.query<JournalLine[]>(`SELECT l.*, a.code, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = ? ORDER BY l.line_no`, [id])
  return { ...entries[0], lines }
}

function defaultRange(query: Record<string, any>): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  return { from: query.from || `${today.slice(0, 8)}01`, to: query.to || today }
}

function rowsToEntries(rows: any[]): (JournalEntry & { lines: JournalLine[] })[] {
  const map = new Map<number, any>()
  for (const row of rows) {
    if (!map.has(row.entry_id)) {
      map.set(row.entry_id, {
        id: row.entry_id,
        voucher_no: row.voucher_no,
        entry_date: asDate(row.entry_date),
        description: row.description,
        source: row.source,
        lines: []
      })
    }
    map.get(row.entry_id).lines.push({
      account_id: row.account_id,
      debit: amount(row.debit),
      credit: amount(row.credit),
      memo: row.memo,
      code: row.code,
      account_name: row.account_name
    })
  }
  return [...map.values()]
}

async function reportContext(connection: DbConnection | typeof pool, companyId: number, from: string, to: string) {
  const [companyResult, accountsResult, rowsResult] = await Promise.all([
    connection.query<Company[]>('SELECT * FROM companies WHERE id = ?', [companyId]),
    connection.query<Account[]>('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [companyId]),
    connection.query<any[]>(`SELECT e.id entry_id, e.voucher_no, e.entry_date, e.description, e.source, l.account_id, l.debit, l.credit, l.memo, a.code, a.name account_name
      FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id JOIN accounts a ON a.id = l.account_id
      WHERE e.company_id = ? AND e.status = 'POSTED' AND e.entry_date <= ? ORDER BY e.entry_date, e.id, l.line_no`, [companyId, to])
  ])
  const companyRows = companyResult[0]
  const accounts = accountsResult[0]
  const allRows = rowsResult[0]
  const allEntries = rowsToEntries(allRows)
  const periodEntries = allEntries.filter((entry) => entry.entry_date >= from)
  return { company: companyRows[0], accounts, allEntries, periodEntries }
}

function flatten(entries: (JournalEntry & { lines: JournalLine[] })[]): (JournalLine & { source?: string; entry_date?: string; voucher_no?: string; description?: string })[] {
  return entries.flatMap((entry) =>
    entry.lines.map((line) => ({
      ...line,
      source: entry.source,
      entry_date: entry.entry_date,
      voucher_no: entry.voucher_no,
      description: entry.description
    }))
  )
}

function periodDateFromExcel(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  }
  const text = String(value || '').trim()
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
  const id = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (id) return `${id[3]}-${String(id[2]).padStart(2, '0')}-${String(id[1]).padStart(2, '0')}`
  return null
}

function worksheetCellValue(cell: any): any {
  const value = cell?.value
  if (value && typeof value === 'object' && 'result' in value) return value.result ?? ''
  if (value && typeof value === 'object' && Array.isArray(value.richText)) return value.richText.map((part: any) => part.text).join('')
  return value ?? ''
}

function excelAmount(value: unknown): number {
  if (typeof value === 'number') return amount(value)
  const raw = String(value || '').replace(/[Rp\s]/gi, '')
  if (!raw) return 0
  const normalized = raw.includes(',') && raw.includes('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.')
  return amount(Number(normalized))
}

async function parseImport(buffer: Buffer, connection: DbConnection | typeof pool, companyId: number) {
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(buffer as any)
  const sheet = book.worksheets[0]
  if (!sheet) throw fail(422, 'Workbook tidak memiliki sheet.')
  const headers = new Map<string, number>()
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => headers.set(String(worksheetCellValue(cell)).trim(), column))
  const sourceRows: Record<string, any>[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const rowData: Record<string, any> = {}
    for (const [header, column] of headers) rowData[header] = worksheetCellValue(row.getCell(column))
    if (Object.values(rowData).some((value) => String(value).trim() !== '')) sourceRows.push(rowData)
  })
  if (!sourceRows.length) throw fail(422, 'Sheet Excel tidak memiliki transaksi.')
  const [accounts] = await connection.query<Account[]>('SELECT id, code, name, is_active FROM accounts WHERE company_id = ?', [companyId])
  const accountByCode = new Map(accounts.map((account) => [String(account.code), account]))
  const grouped = new Map<string, any>()
  const errors: { line: number | string; message: string }[] = []
  sourceRows.forEach((row, index) => {
    const line = index + 2
    const voucher = String(row.NoBukti ?? row['No Bukti'] ?? '').trim()
    const entryDate = periodDateFromExcel(row.Tanggal)
    const code = String(row.KodeAkun ?? row['Kode Akun'] ?? '').trim()
    const debit = excelAmount(row.Debit)
    const credit = excelAmount(row.Kredit)
    if (!voucher) errors.push({ line, message: 'NoBukti wajib diisi.' })
    if (!entryDate) errors.push({ line, message: 'Tanggal harus memakai format YYYY-MM-DD atau DD/MM/YYYY.' })
    if (!code || !accountByCode.get(code)?.is_active) errors.push({ line, message: `Kode akun ${code || '(kosong)'} tidak aktif atau tidak ditemukan.` })
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0) || debit < 0 || credit < 0) errors.push({ line, message: 'Isi tepat salah satu nominal Debit atau Kredit.' })
    if (!voucher || !entryDate || !accountByCode.get(code) || ((debit > 0 && credit > 0) || (debit === 0 && credit === 0))) return
    if (!grouped.has(voucher)) grouped.set(voucher, { voucherNo: voucher, entryDate, description: String(row.Keterangan || `Impor ${voucher}`).trim(), lines: [], rowLines: [] })
    const entry = grouped.get(voucher)
    if (entry.entryDate !== entryDate) errors.push({ line, message: `NoBukti ${voucher} memiliki tanggal yang berbeda.` })
    entry.lines.push({ account_id: accountByCode.get(code)!.id, debit, credit })
    entry.rowLines.push(line)
  })
  for (const entry of grouped.values()) {
    try { assertBalancedLines(entry.lines) } catch (error: any) { errors.push({ line: entry.rowLines.join(', '), message: `${entry.voucherNo}: ${error.message}` }) }
    try { await getOpenPeriod(connection as DbConnection, companyId, entry.entryDate) } catch (error: any) { errors.push({ line: entry.rowLines.join(', '), message: `${entry.voucherNo}: ${error.message}` }) }
  }
  const vouchers = [...grouped.keys()]
  if (vouchers.length) {
    const [duplicates] = await connection.query<{ voucher_no: string }[]>(`SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no IN (${vouchers.map(() => '?').join(',')})`, [companyId, ...vouchers])
    for (const duplicate of duplicates) errors.push({ line: '', message: `NoBukti ${duplicate.voucher_no} sudah pernah digunakan.` })
  }
  return { totalRows: sourceRows.length, entries: [...grouped.values()].map(({ rowLines, ...entry }) => entry), errors }
}

app.get('/api/health', (_req: Request, res: Response) => res.json({ ok: true, service: 'finova-api' }))

app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const [users] = await pool.query<(AuthenticatedUser & { password_hash: string })[]>('SELECT * FROM users WHERE email = ? LIMIT 1', [email])
    const user = users[0]
    if (!user || !user.is_active || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) throw fail(401, 'Email atau kata sandi salah.')
    setAuthCookie(res, user)
    res.json({ user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('finova_token')
  res.status(204).end()
})

app.get('/api/auth/me', authenticate, (req: Request, res: Response) => res.json({ user: publicUser(req.user) }))

app.get('/api/company', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.query<Company[]>('SELECT * FROM companies WHERE id = ?', [req.user.company_id])
    res.json({ company: rows[0] })
  } catch (error) { next(error) }
})

app.put('/api/company', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, address = null, phone = null, email = null, fiscalYearStart = 1 } = req.body
    if (!String(name || '').trim()) throw fail(422, 'Nama perusahaan wajib diisi.')
    await pool.query('UPDATE companies SET name = ?, address = ?, phone = ?, email = ?, fiscal_year_start = ? WHERE id = ?', [name.trim(), address, phone, email, fiscalYearStart, req.user.company_id])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/users', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.query<AuthenticatedUser[]>('SELECT id, name, email, role, is_active, created_at FROM users WHERE company_id = ? ORDER BY role, name', [req.user.company_id])
    res.json({ users: rows.map(publicUser) })
  } catch (error) { next(error) }
})

app.post('/api/users', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role = 'STAFF' } = req.body
    if (!name || !email || String(password || '').length < 8 || !['ADMIN', 'STAFF'].includes(role)) throw fail(422, 'Nama, email, kata sandi minimal 8 karakter, dan peran valid wajib diisi.')
    const hash = await bcrypt.hash(password, 12)
    const [result] = await pool.query<QueryResultInfo>('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [req.user.company_id, name.trim(), email.trim().toLowerCase(), hash, role])
    const insertId = result.insertId
    await audit(pool, req.user.company_id, req.user.id, 'USER', insertId, 'CREATED')
    res.status(201).json({ id: insertId })
  } catch (error) { next(error) }
})

app.patch('/api/users/:id', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { isActive, role } = req.body
    const targetId = Number(req.params.id)
    if (targetId === req.user.id && isActive === false) throw fail(422, 'Anda tidak dapat menonaktifkan akun sendiri.')
    if (role !== undefined && !['ADMIN', 'STAFF'].includes(role)) throw fail(422, 'Peran pengguna tidak valid.')
    const changes: string[] = []
    const values: unknown[] = []
    if (typeof isActive === 'boolean') { changes.push('is_active = ?'); values.push(isActive) }
    if (role !== undefined) { changes.push('role = ?'); values.push(role) }
    if (!changes.length) throw fail(422, 'Tidak ada perubahan pengguna.')
    values.push(targetId, req.user.company_id)
    const [result] = await pool.query<QueryResultInfo>(`UPDATE users SET ${changes.join(', ')} WHERE id = ? AND company_id = ?`, values)
    if (!result.affectedRows) throw fail(404, 'Pengguna tidak ditemukan.')
    await audit(pool, req.user.company_id, req.user.id, 'USER', targetId, 'UPDATED', { isActive, role })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/accounts', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [accounts] = await pool.query<Account[]>('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [req.user.company_id])
    res.json({ accounts })
  } catch (error) { next(error) }
})

app.post('/api/accounts', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, accountGroup, accountSubtype = null, normalBalance, cashFlowCategory = 'OPERATING', isCashAccount = false } = req.body
    if (!code || !name || !['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(accountGroup) || !['DEBIT', 'CREDIT'].includes(normalBalance)) throw fail(422, 'Data akun tidak lengkap atau tidak valid.')
    const [result] = await pool.query<QueryResultInfo>('INSERT INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.user.company_id, code, name, accountGroup, accountSubtype, normalBalance, cashFlowCategory, isCashAccount])
    const insertId = result.insertId
    await audit(pool, req.user.company_id, req.user.id, 'ACCOUNT', insertId, 'CREATED')
    res.status(201).json({ id: insertId })
  } catch (error) { next(error) }
})

app.put('/api/accounts/:id', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, accountSubtype = null, cashFlowCategory = 'OPERATING', isCashAccount = false, isActive = true } = req.body
    const targetId = Number(req.params.id)
    const [result] = await pool.query<QueryResultInfo>('UPDATE accounts SET name = ?, account_subtype = ?, cash_flow_category = ?, is_cash_account = ?, is_active = ? WHERE id = ? AND company_id = ?', [name, accountSubtype, cashFlowCategory, isCashAccount, isActive, targetId, req.user.company_id])
    if (!result.affectedRows) throw fail(404, 'Akun tidak ditemukan.')
    await audit(pool, req.user.company_id, req.user.id, 'ACCOUNT', targetId, 'UPDATED')
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/periods', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [periods] = await pool.query<AccountingPeriod[]>('SELECT * FROM accounting_periods WHERE company_id = ? ORDER BY start_date DESC', [req.user.company_id])
    res.json({ periods })
  } catch (error) { next(error) }
})

app.post('/api/periods', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, startDate, endDate } = req.body
    if (!name || !startDate || !endDate || startDate > endDate) throw fail(422, 'Nama dan rentang tanggal periode tidak valid.')
    const [result] = await pool.query<QueryResultInfo>('INSERT INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?, ?, ?, ?)', [req.user.company_id, name, startDate, endDate])
    const insertId = result.insertId
    res.status(201).json({ id: insertId })
  } catch (error) { next(error) }
})

app.get('/api/journals', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = defaultRange(req.query)
    const status = req.query.status || null
    const params: unknown[] = [req.user.company_id, from, to]
    let sql = `SELECT e.*, u.name AS creator_name, SUM(l.debit) AS total_debit FROM journal_entries e JOIN users u ON u.id = e.created_by JOIN journal_lines l ON l.journal_entry_id = e.id WHERE e.company_id = ? AND e.entry_date BETWEEN ? AND ?`
    if (status) { sql += ' AND e.status = ?'; params.push(status) }
    sql += ' GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC'
    const [entries] = await pool.query<any[]>(sql, params)
    res.json({ entries })
  } catch (error) { next(error) }
})

app.get('/api/journals/next-voucher', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ym = new Date().toISOString().slice(0, 7).replace('-', '')
    const prefix = `JRN-${ym}-`
    const [rows] = await pool.query<{ voucher_no: string }[]>('SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no LIKE ? ORDER BY id DESC LIMIT 1', [req.user.company_id, `${prefix}%`])
    let seq = 1
    if (rows[0]) {
      const m = rows[0].voucher_no.match(/-(\d+)$/)
      if (m) seq = Number(m[1]) + 1
    }
    res.json({ voucherNo: `${prefix}${String(seq).padStart(3, '0')}` })
  } catch (error) { next(error) }
})

app.get('/api/journals/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    res.json({ entry: await fetchEntry(pool, req.user.company_id, id) })
  } catch (error) { next(error) }
})

app.get('/api/journals/:id/audit', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const [logs] = await pool.query<any[]>('SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.company_id = ? AND a.entity_type = ? AND a.entity_id = ? ORDER BY a.created_at DESC', [req.user.company_id, 'JOURNAL_ENTRY', id])
    const actionLabels: Record<string, string> = { CREATED: 'Jurnal dibuat', POSTED: 'Jurnal diposting', UPDATED: 'Jurnal diubah', REVERSED: 'Jurnal dibalikkan' }
    res.json({ logs: logs.map((l: any) => ({ ...l, action_label: actionLabels[l.action] || l.action })) })
  } catch (error) { next(error) }
})

app.post('/api/journals', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { voucherNo, entryDate, description, lines, status = 'DRAFT' } = req.body
    if (!description || !entryDate || !['DRAFT', 'POSTED'].includes(status)) throw fail(422, 'Tanggal, keterangan, dan status jurnal tidak valid.')
    let finalVoucher = voucherNo
    if (!finalVoucher) {
      const ym = entryDate.slice(0, 7).replace('-', '')
      const prefix = `JRN-${ym}-`
      const [rows] = await pool.query<{ voucher_no: string }[]>('SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no LIKE ? ORDER BY id DESC LIMIT 1', [req.user.company_id, `${prefix}%`])
      let seq = 1
      if (rows[0]) {
        const m = rows[0].voucher_no.match(/-(\d+)$/)
        if (m) seq = Number(m[1]) + 1
      }
      finalVoucher = `${prefix}${String(seq).padStart(3, '0')}`
    }
    const id = await withTransaction((connection) => writeEntry(connection, { companyId: req.user.company_id, userId: req.user.id, voucherNo: finalVoucher, entryDate, description, lines, status }))
    res.status(201).json({ id, voucherNo: finalVoucher })
  } catch (error) { next(error) }
})

app.put('/api/journals/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { voucherNo, entryDate, description, lines } = req.body
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    await withTransaction(async (connection) => {
      const entry = await fetchEntry(connection, req.user.company_id, id)
      if (entry.status !== 'DRAFT') throw fail(422, 'Hanya jurnal draft yang dapat diubah.')
      const normalized = assertBalancedLines(lines)
      const period = await getOpenPeriod(connection, req.user.company_id, entryDate)
      await getAccountsForLines(connection, req.user.company_id, normalized)
      await connection.query('UPDATE journal_entries SET voucher_no = ?, entry_date = ?, period_id = ?, description = ? WHERE id = ?', [voucherNo, entryDate, period.id, description, entry.id])
      await connection.query('DELETE FROM journal_lines WHERE journal_entry_id = ?', [entry.id])
      for (const [index, line] of normalized.entries()) {
        await connection.query('INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)', [
          entry.id, line.account_id ?? (line as any).accountId, index + 1, line.memo || null, line.debit, line.credit
        ])
      }
      await audit(connection, req.user.company_id, req.user.id, 'JOURNAL_ENTRY', entry.id, 'UPDATED')
    })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.post('/api/journals/:id/post', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    await withTransaction(async (connection) => {
      const entry = await fetchEntry(connection, req.user.company_id, id)
      if (entry.status !== 'DRAFT') throw fail(422, 'Jurnal ini sudah diposting.')
      await getOpenPeriod(connection, req.user.company_id, asDate(entry.entry_date))
      assertBalancedLines(entry.lines)
      await connection.query("UPDATE journal_entries SET status = 'POSTED', posted_by = ?, posted_at = datetime('now', 'localtime') WHERE id = ?", [req.user.id, entry.id])
      await audit(connection, req.user.company_id, req.user.id, 'JOURNAL_ENTRY', entry.id, 'POSTED')
    })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.delete('/api/journals/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    await withTransaction(async (connection) => {
      const entry = await fetchEntry(connection, req.user.company_id, id)
      await connection.query('DELETE FROM journal_lines WHERE journal_entry_id = ?', [entry.id])
      await connection.query('DELETE FROM journal_entries WHERE id = ?', [entry.id])
      await audit(connection, req.user.company_id, req.user.id, 'JOURNAL_ENTRY', entry.id, 'DELETED')
    })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.post('/api/journals/:id/reverse', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entryDate = req.body.entryDate
    const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const id = await withTransaction(async (connection) => {
      const original = await fetchEntry(connection, req.user.company_id, idParam)
      if (original.status !== 'POSTED') throw fail(422, 'Hanya jurnal terposting yang dapat dibalik.')
      return writeEntry(connection, {
        companyId: req.user.company_id,
        userId: req.user.id,
        voucherNo: req.body.voucherNo || `REV-${original.voucher_no}`,
        entryDate,
        description: `Pembalik: ${original.description}`,
        source: 'REVERSAL',
        status: 'POSTED',
        reversalOfId: original.id,
        lines: original.lines.map((line) => ({ account_id: line.account_id, debit: line.credit, credit: line.debit, memo: line.memo }))
      })
    })
    res.status(201).json({ id })
  } catch (error) { next(error) }
})

app.get('/api/imports/template', authenticate, adminOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Jurnal')
    sheet.columns = [
      { header: 'Tanggal', key: 'Tanggal', width: 15 },
      { header: 'NoBukti', key: 'NoBukti', width: 18 },
      { header: 'Keterangan', key: 'Keterangan', width: 32 },
      { header: 'KodeAkun', key: 'KodeAkun', width: 14 },
      { header: 'Debit', key: 'Debit', width: 16 },
      { header: 'Kredit', key: 'Kredit', width: 16 }
    ]
    sheet.addRows([
      { Tanggal: '2026-01-01', NoBukti: 'JRN-001', Keterangan: 'Setoran modal awal', KodeAkun: '1100', Debit: 10000000, Kredit: 0 },
      { Tanggal: '2026-01-01', NoBukti: 'JRN-001', Keterangan: 'Setoran modal awal', KodeAkun: '3100', Debit: 0, Kredit: 10000000 }
    ])
    sheet.getRow(1).font = { bold: true }
    const bytes = await workbook.xlsx.writeBuffer()
    res.setHeader('Content-Disposition', 'attachment; filename=template-jurnal-finova.xlsx')
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(bytes))
  } catch (error) { next(error) }
})

app.post('/api/imports/preview', authenticate, adminOnly, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw fail(422, 'Pilih berkas Excel terlebih dahulu.')
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex')
    const parsed = await parseImport(req.file.buffer, pool, req.user.company_id)
    const status = parsed.errors.length ? 'REJECTED' : 'PREVIEW'
    const [result] = await pool.query<QueryResultInfo>(
      'INSERT INTO import_batches (company_id, uploaded_by, original_filename, content_hash, status, total_rows, valid_entries, payload_json, errors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.company_id, req.user.id, req.file.originalname, hash, status, parsed.totalRows, parsed.entries.length, JSON.stringify(parsed.entries), JSON.stringify(parsed.errors)]
    )
    const insertId = result.insertId
    await audit(pool, req.user.company_id, req.user.id, 'IMPORT_BATCH', insertId, status === 'PREVIEW' ? 'PREVIEWED' : 'REJECTED', { totalRows: parsed.totalRows, errors: parsed.errors.length })
    res.json({
      batchId: insertId,
      valid: !parsed.errors.length,
      totalRows: parsed.totalRows,
      entries: parsed.entries.map((entry: any) => ({ voucherNo: entry.voucherNo, entryDate: entry.entryDate, description: entry.description, lineCount: entry.lines.length })),
      errors: parsed.errors
    })
  } catch (error) { next(error) }
})

app.post('/api/imports/:id/confirm', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const posted = await withTransaction(async (connection) => {
      const [batches] = await connection.query<any[]>('SELECT * FROM import_batches WHERE id = ? AND company_id = ? FOR UPDATE', [id, req.user.company_id])
      const batch = batches[0]
      if (!batch) throw fail(404, 'Batch impor tidak ditemukan.')
      if (batch.status !== 'PREVIEW') throw fail(422, 'Batch ini tidak siap dikonfirmasi.')
      const entries = jsonValue<any[]>(batch.payload_json) || []
      for (const entry of entries) {
        await writeEntry(connection, {
          companyId: req.user.company_id,
          userId: req.user.id,
          voucherNo: entry.voucherNo,
          entryDate: entry.entryDate,
          description: entry.description,
          source: 'IMPORT',
          lines: entry.lines,
          status: 'POSTED',
          importBatchId: batch.id
        })
      }
      await connection.query("UPDATE import_batches SET status = 'POSTED', posted_at = datetime('now', 'localtime') WHERE id = ?", [batch.id])
      await audit(connection, req.user.company_id, req.user.id, 'IMPORT_BATCH', batch.id, 'POSTED', { entries: entries.length })
      return entries.length
    })
    res.json({ ok: true, posted })
  } catch (error) { next(error) }
})

app.get('/api/reports/:kind', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = defaultRange(req.query)
    if (from > to) throw fail(422, 'Rentang tanggal tidak valid.')
    const context = await reportContext(pool, req.user.company_id, from, to)
    const allLines = flatten(context.allEntries)
    const periodLines = flatten(context.periodEntries)
    let data: any
    switch (req.params.kind) {
      case 'journal': {
        const entries = context.periodEntries
        const debitMap = new Map<string, { code: string; name: string; amount: number }>()
        const creditMap = new Map<string, { code: string; name: string; amount: number }>()
        let totalDebit = 0
        let totalCredit = 0
        for (const e of entries) {
          for (const l of e.lines) {
            if (l.debit > 0) {
              const cur = debitMap.get(l.code || '') || { code: l.code || '', name: l.account_name || '', amount: 0 }
              cur.amount = amount(cur.amount + l.debit)
              debitMap.set(l.code || '', cur)
              totalDebit = amount(totalDebit + l.debit)
            }
            if (l.credit > 0) {
              const cur = creditMap.get(l.code || '') || { code: l.code || '', name: l.account_name || '', amount: 0 }
              cur.amount = amount(cur.amount + l.credit)
              creditMap.set(l.code || '', cur)
              totalCredit = amount(totalCredit + l.credit)
            }
          }
        }
        data = {
          entries,
          recap: {
            debits: [...debitMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
            credits: [...creditMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
            totalDebit,
            totalCredit,
            isBalanced: Math.abs(totalDebit - totalCredit) < 0.005
          }
        }
        break
      }
      case 'trial-balance':
        data = buildTrialBalance(context.accounts, allLines)
        break
      case 'income-statement':
        data = buildIncomeStatement(context.accounts, periodLines)
        break
      case 'balance-sheet':
        data = buildBalanceSheet(context.accounts, allLines)
        break
      case 'equity-changes': {
        const before = context.allEntries.filter((entry) => entry.entry_date < from)
        data = buildEquityChanges(context.accounts, flatten(before), periodLines)
        break
      }
      case 'cash-flow':
        data = buildCashFlowDirect(context.accounts, context.periodEntries as any)
        break
      case 'ledger': {
        const accountId = Number(req.query.accountId)
        const account = context.accounts.find((item) => item.id === accountId)
        if (!account) throw fail(422, 'Pilih akun untuk buku besar.')
        const before = allLines.filter((line) => line.account_id === accountId && (line.entry_date || '') < from)
        const rows = periodLines.filter((line) => line.account_id === accountId)
        let running = accountBalance(account, calculateAccountBalances(context.accounts, before))
        data = {
          account,
          opening: running,
          rows: rows.map((row) => {
            running = amount(running + (account.normal_balance === 'DEBIT' ? row.debit - row.credit : row.credit - row.debit))
            return { ...row, balance: running }
          }),
          closing: running
        }
        break
      }
      case 'dashboard': {
        const income = buildIncomeStatement(context.accounts, periodLines)
        const balance = buildBalanceSheet(context.accounts, allLines)
        const findAsset = (subtypes: string[]) =>
          amount(
            balance.assets.rows
              .filter((row) => subtypes.includes(context.accounts.find((a) => a.id === row.accountId)?.account_subtype || ''))
              .reduce((sum, row) => sum + row.amount, 0)
          )
        data = {
          cashBank: findAsset(['CASH', 'BANK']),
          receivables: findAsset(['RECEIVABLE']),
          payables: balance.liabilities.rows
            .filter((row) => context.accounts.find((a) => a.id === row.accountId)?.account_subtype === 'PAYABLE')
            .reduce((sum, row) => sum + row.amount, 0),
          revenue: income.revenueTotal,
          expenses: income.expenseTotal,
          netIncome: income.netIncome
        }
        break
      }
      default:
        throw fail(404, 'Jenis laporan tidak ditemukan.')
    }
    res.json({ company: context.company, period: { from, to }, data })
  } catch (error) { next(error) }
})

app.post('/api/periods/:id/close', authenticate, adminOnly, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const result = await withTransaction(async (connection) => {
      const [periods] = await connection.query<AccountingPeriod[]>('SELECT * FROM accounting_periods WHERE id = ? AND company_id = ? FOR UPDATE', [id, req.user.company_id])
      const period = periods[0]
      if (!period) throw fail(404, 'Periode tidak ditemukan.')
      if (period.status !== 'OPEN') throw fail(422, 'Periode sudah ditutup.')
      const context = await reportContext(connection, req.user.company_id, period.start_date, period.end_date)
      const lines = makeClosingLines(context.accounts, flatten(context.periodEntries))
      let entryId: number | null = null
      if (lines.length) {
        entryId = await writeEntry(connection, {
          companyId: req.user.company_id,
          userId: req.user.id,
          voucherNo: `TUTUP-${asDate(period.end_date).replaceAll('-', '')}`,
          entryDate: asDate(period.end_date),
          description: `Jurnal penutup periode ${period.name}`,
          source: 'CLOSING',
          status: 'POSTED',
          lines
        })
      }
      await connection.query("UPDATE accounting_periods SET status = 'CLOSED', closed_at = datetime('now', 'localtime'), closed_by = ? WHERE id = ?", [req.user.id, period.id])
      await audit(connection, req.user.company_id, req.user.id, 'ACCOUNTING_PERIOD', period.id, 'CLOSED', { closingEntryId: entryId })
      return { entryId, netIncome: buildIncomeStatement(context.accounts, flatten(context.periodEntries)).netIncome }
    })
    res.json({ ok: true, ...result })
  } catch (error) { next(error) }
})

app.get('/api/templates', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT * FROM journal_templates WHERE company_id = ? ORDER BY name', [req.user.company_id])
    res.json({ templates: rows.map((r: any) => ({ ...r, lines: JSON.parse(r.lines_json || '[]') })) })
  } catch (error) { next(error) }
})

app.post('/api/templates', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, lines } = req.body
    if (!name || !lines?.length) throw fail(422, 'Nama template dan baris jurnal wajib diisi.')
    const [result] = await pool.query<QueryResultInfo>('INSERT INTO journal_templates (company_id, name, description, lines_json, created_by) VALUES (?, ?, ?, ?, ?)', [
      req.user.company_id, name, description || '', JSON.stringify(lines), req.user.id
    ])
    const insertId = result.insertId
    res.status(201).json({ id: insertId })
  } catch (error) { next(error) }
})

app.delete('/api/templates/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    await pool.query('DELETE FROM journal_templates WHERE id = ? AND company_id = ?', [id, req.user.company_id])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => {
  if (
    error.code === 'ER_DUP_ENTRY' ||
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    String(error.message || '').includes('UNIQUE constraint failed')
  ) {
    return res.status(409).json({ message: 'Data duplikat: kode, email, nomor bukti, atau berkas impor sudah digunakan.' })
  }
  const status = error.status || 500
  if (status >= 500) console.error(error)
  const messages: Record<string, string> = {
    'Silakan masuk terlebih dahulu.': 'Anda belum masuk. Silakan login terlebih dahulu.',
    'Sesi tidak lagi aktif.': 'Sesi Anda telah berakhir. Silakan login kembali.',
    'Sesi tidak valid atau sudah berakhir.': 'Sesi tidak valid. Silakan login kembali.',
    'Fitur ini hanya dapat diakses admin.': 'Hanya administrator yang dapat mengakses fitur ini.'
  }
  const msg = messages[error.message] || error.message || 'Terjadi kesalahan pada server. Silakan coba lagi.'
  return res.status(status).json({ message: msg })
})

// Sajikan berkas frontend produksi untuk mode website standalone
const distPath = path.resolve('dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

ensureBootstrap().then(() => console.log('Bootstrap Finova siap.')).catch((error) => console.error('Bootstrap database tertunda:', error.message))
const server = app.listen(port, () => console.log(`Finova API berjalan di http://localhost:${port}`))
server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Finova Server] Port ${port} sudah digunakan oleh instans lain.`)
  } else {
    console.error('[Finova Server Error]', err)
  }
})

export { app, server }
