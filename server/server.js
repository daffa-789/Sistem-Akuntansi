import crypto from 'node:crypto'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import * as XLSX from 'xlsx'
import { pool, withTransaction } from './db.js'
import {
  amount, assertBalancedLines, accountBalance, calculateAccountBalances,
  buildTrialBalance, buildIncomeStatement, buildBalanceSheet, buildEquityChanges,
  buildCashFlowDirect, makeClosingLines
} from './accounting.js'

dotenv.config()
const app = express()
const port = Number(process.env.PORT || 5000)
const jwtSecret = process.env.JWT_SECRET || 'development-secret-change-me'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000', credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

const fail = (status, message) => Object.assign(new Error(message), { status })
const asDate = (value) => String(value).slice(0, 10)
const jsonValue = (value) => typeof value === 'string' ? JSON.parse(value) : value
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, isActive: Boolean(user.is_active) })

function signUser(user) {
  return jwt.sign({ sub: user.id, companyId: user.company_id, role: user.role, name: user.name }, jwtSecret, { expiresIn: '8h' })
}

function setAuthCookie(res, user) {
  res.cookie('finova_token', signUser(user), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000
  })
}

async function ensureBootstrap() {
  const [companies] = await pool.query('SELECT id FROM companies WHERE id = 1')
  if (!companies.length) await pool.query("INSERT INTO companies (id, name, currency) VALUES (1, 'Perusahaan Anda', 'IDR')")
  const [users] = await pool.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1")
  if (!users.length) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin123!', 12)
    await pool.query('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (1, ?, ?, ?, \'ADMIN\')', [
      process.env.ADMIN_NAME || 'Administrator', (process.env.ADMIN_EMAIL || 'admin@finova.local').toLowerCase(), hash
    ])
  }
  const year = new Date().getFullYear()
  for (let month = 1; month <= 12; month += 1) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`
    const end = new Date(year, month, 0).toISOString().slice(0, 10)
    await pool.query('INSERT IGNORE INTO accounting_periods (company_id, name, start_date, end_date) VALUES (1, ?, ?, ?)', [`${String(month).padStart(2, '0')}/${year}`, start, end])
  }
}

async function authenticate(req, _res, next) {
  try {
    const token = req.cookies.finova_token || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) throw fail(401, 'Silakan masuk terlebih dahulu.')
    const claims = jwt.verify(token, jwtSecret)
    const [rows] = await pool.query('SELECT id, company_id, name, email, role, is_active FROM users WHERE id = ?', [claims.sub])
    if (!rows[0] || !rows[0].is_active) throw fail(401, 'Sesi tidak lagi aktif.')
    req.user = rows[0]
    next()
  } catch (error) { next(error.status ? error : fail(401, 'Sesi tidak valid atau sudah berakhir.')) }
}

const adminOnly = (req, _res, next) => req.user.role === 'ADMIN' ? next() : next(fail(403, 'Fitur ini hanya dapat diakses admin.'))

async function audit(connection, companyId, userId, entityType, entityId, action, details = null) {
  await connection.query('INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json) VALUES (?, ?, ?, ?, ?, ?)', [
    companyId, userId || null, entityType, entityId || null, action, details ? JSON.stringify(details) : null
  ])
}

async function getOpenPeriod(connection, companyId, date) {
  const [periods] = await connection.query('SELECT * FROM accounting_periods WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1 FOR UPDATE', [companyId, date])
  if (!periods[0]) throw fail(422, 'Tanggal transaksi belum memiliki periode akuntansi.')
  if (periods[0].status !== 'OPEN') throw fail(422, 'Periode transaksi telah ditutup dan dikunci.')
  return periods[0]
}

async function getAccountsForLines(connection, companyId, lines) {
  const ids = [...new Set(lines.map((line) => Number(line.account_id ?? line.accountId)).filter(Boolean))]
  if (!ids.length) throw fail(422, 'Akun jurnal tidak valid.')
  const [accounts] = await connection.query(`SELECT * FROM accounts WHERE company_id = ? AND id IN (${ids.map(() => '?').join(',')})`, [companyId, ...ids])
  if (accounts.length !== ids.length || accounts.some((account) => !account.is_active)) throw fail(422, 'Satu atau beberapa akun tidak aktif atau tidak ditemukan.')
  return accounts
}

async function writeEntry(connection, { companyId, userId, voucherNo, entryDate, description, source = 'MANUAL', lines, status = 'DRAFT', importBatchId = null, reversalOfId = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) throw fail(422, 'Tanggal jurnal tidak valid.')
  const normalized = assertBalancedLines(lines)
  const period = await getOpenPeriod(connection, companyId, entryDate)
  await getAccountsForLines(connection, companyId, normalized)
  const [result] = await connection.query(
    `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, import_batch_id, reversal_of_id, created_by, posted_by, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, period.id, voucherNo, entryDate, description, source, status, importBatchId, reversalOfId, userId, status === 'POSTED' ? userId : null, status === 'POSTED' ? new Date() : null]
  )
  for (const [index, line] of normalized.entries()) {
    await connection.query('INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)', [
      result.insertId, Number(line.account_id ?? line.accountId), index + 1, line.memo || null, line.debit, line.credit
    ])
  }
  await audit(connection, companyId, userId, 'JOURNAL_ENTRY', result.insertId, status === 'POSTED' ? 'POSTED' : 'CREATED', { source, voucherNo })
  return result.insertId
}

async function fetchEntry(connection, companyId, id) {
  const [entries] = await connection.query('SELECT e.*, u.name AS created_by_name FROM journal_entries e JOIN users u ON u.id = e.created_by WHERE e.id = ? AND e.company_id = ?', [id, companyId])
  if (!entries[0]) throw fail(404, 'Jurnal tidak ditemukan.')
  const [lines] = await connection.query(`SELECT l.*, a.code, a.name AS account_name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = ? ORDER BY l.line_no`, [id])
  return { ...entries[0], lines }
}

function defaultRange(query) {
  const today = new Date().toISOString().slice(0, 10)
  return { from: query.from || `${today.slice(0, 8)}01`, to: query.to || today }
}

function rowsToEntries(rows) {
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.entry_id)) map.set(row.entry_id, {
      id: row.entry_id, voucher_no: row.voucher_no, entry_date: asDate(row.entry_date), description: row.description, source: row.source, lines: []
    })
    map.get(row.entry_id).lines.push({ account_id: row.account_id, debit: amount(row.debit), credit: amount(row.credit), memo: row.memo, code: row.code, account_name: row.account_name })
  }
  return [...map.values()]
}

async function reportContext(connection, companyId, from, to) {
  const [companyResult, accountsResult, rowsResult] = await Promise.all([
    connection.query('SELECT * FROM companies WHERE id = ?', [companyId]),
    connection.query('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [companyId]),
    connection.query(`SELECT e.id entry_id, e.voucher_no, e.entry_date, e.description, e.source, l.account_id, l.debit, l.credit, l.memo, a.code, a.name account_name
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

function flatten(entries) { return entries.flatMap((entry) => entry.lines.map((line) => ({ ...line, source: entry.source, entry_date: entry.entry_date, voucher_no: entry.voucher_no, description: entry.description }))) }

function periodDateFromExcel(value) {
  if (value instanceof Date && !Number.isNaN(value)) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  const text = String(value || '').trim()
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`
  const id = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (id) return `${id[3]}-${String(id[2]).padStart(2, '0')}-${String(id[1]).padStart(2, '0')}`
  return null
}

function excelAmount(value) {
  if (typeof value === 'number') return amount(value)
  const raw = String(value || '').replace(/[Rp\s]/gi, '')
  if (!raw) return 0
  const normalized = raw.includes(',') && raw.includes('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.')
  return amount(Number(normalized))
}

async function parseImport(buffer, connection, companyId) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = book.Sheets[book.SheetNames[0]]
  if (!sheet) throw fail(422, 'Workbook tidak memiliki sheet.')
  const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true })
  if (!sourceRows.length) throw fail(422, 'Sheet Excel tidak memiliki transaksi.')
  const [accounts] = await connection.query('SELECT id, code, name, is_active FROM accounts WHERE company_id = ?', [companyId])
  const accountByCode = new Map(accounts.map((account) => [String(account.code), account]))
  const grouped = new Map()
  const errors = []
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
    entry.lines.push({ account_id: accountByCode.get(code).id, debit, credit })
    entry.rowLines.push(line)
  })
  for (const entry of grouped.values()) {
    try { assertBalancedLines(entry.lines) } catch (error) { errors.push({ line: entry.rowLines.join(', '), message: `${entry.voucherNo}: ${error.message}` }) }
    try { await getOpenPeriod(connection, companyId, entry.entryDate) } catch (error) { errors.push({ line: entry.rowLines.join(', '), message: `${entry.voucherNo}: ${error.message}` }) }
  }
  const vouchers = [...grouped.keys()]
  if (vouchers.length) {
    const [duplicates] = await connection.query(`SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no IN (${vouchers.map(() => '?').join(',')})`, [companyId, ...vouchers])
    for (const duplicate of duplicates) errors.push({ line: '', message: `NoBukti ${duplicate.voucher_no} sudah pernah digunakan.` })
  }
  return { totalRows: sourceRows.length, entries: [...grouped.values()].map(({ rowLines, ...entry }) => entry), errors }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'finova-api' }))

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const [users] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email])
    const user = users[0]
    if (!user || !user.is_active || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) throw fail(401, 'Email atau kata sandi salah.')
    setAuthCookie(res, user)
    res.json({ user: publicUser(user) })
  } catch (error) { next(error) }
})

app.post('/api/auth/logout', (_req, res) => { res.clearCookie('finova_token'); res.status(204).end() })
app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }))

app.get('/api/company', authenticate, async (req, res, next) => {
  try { const [rows] = await pool.query('SELECT * FROM companies WHERE id = ?', [req.user.company_id]); res.json({ company: rows[0] }) } catch (error) { next(error) }
})
app.put('/api/company', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { name, address = null, phone = null, email = null, fiscalYearStart = 1 } = req.body
    if (!String(name || '').trim()) throw fail(422, 'Nama perusahaan wajib diisi.')
    await pool.query('UPDATE companies SET name = ?, address = ?, phone = ?, email = ?, fiscal_year_start = ? WHERE id = ?', [name.trim(), address, phone, email, fiscalYearStart, req.user.company_id])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/users', authenticate, adminOnly, async (req, res, next) => {
  try { const [rows] = await pool.query('SELECT id, name, email, role, is_active, created_at FROM users WHERE company_id = ? ORDER BY role, name', [req.user.company_id]); res.json({ users: rows.map(publicUser) }) } catch (error) { next(error) }
})
app.post('/api/users', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { name, email, password, role = 'STAFF' } = req.body
    if (!name || !email || String(password || '').length < 8 || !['ADMIN', 'STAFF'].includes(role)) throw fail(422, 'Nama, email, kata sandi minimal 8 karakter, dan peran valid wajib diisi.')
    const hash = await bcrypt.hash(password, 12)
    const [result] = await pool.query('INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [req.user.company_id, name.trim(), email.trim().toLowerCase(), hash, role])
    await audit(pool, req.user.company_id, req.user.id, 'USER', result.insertId, 'CREATED')
    res.status(201).json({ id: result.insertId })
  } catch (error) { next(error) }
})
app.patch('/api/users/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { isActive, role } = req.body
    const targetId = Number(req.params.id)
    if (targetId === req.user.id && isActive === false) throw fail(422, 'Anda tidak dapat menonaktifkan akun sendiri.')
    if (role !== undefined && !['ADMIN', 'STAFF'].includes(role)) throw fail(422, 'Peran pengguna tidak valid.')
    const changes = []
    const values = []
    if (typeof isActive === 'boolean') { changes.push('is_active = ?'); values.push(isActive) }
    if (role !== undefined) { changes.push('role = ?'); values.push(role) }
    if (!changes.length) throw fail(422, 'Tidak ada perubahan pengguna.')
    values.push(targetId, req.user.company_id)
    const [result] = await pool.query(`UPDATE users SET ${changes.join(', ')} WHERE id = ? AND company_id = ?`, values)
    if (!result.affectedRows) throw fail(404, 'Pengguna tidak ditemukan.')
    await audit(pool, req.user.company_id, req.user.id, 'USER', targetId, 'UPDATED', { isActive, role })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/accounts', authenticate, async (req, res, next) => {
  try { const [accounts] = await pool.query('SELECT * FROM accounts WHERE company_id = ? ORDER BY code', [req.user.company_id]); res.json({ accounts }) } catch (error) { next(error) }
})
app.post('/api/accounts', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { code, name, accountGroup, accountSubtype = null, normalBalance, cashFlowCategory = 'OPERATING', isCashAccount = false } = req.body
    if (!code || !name || !['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(accountGroup) || !['DEBIT', 'CREDIT'].includes(normalBalance)) throw fail(422, 'Data akun tidak lengkap atau tidak valid.')
    const [result] = await pool.query('INSERT INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [req.user.company_id, code, name, accountGroup, accountSubtype, normalBalance, cashFlowCategory, isCashAccount])
    await audit(pool, req.user.company_id, req.user.id, 'ACCOUNT', result.insertId, 'CREATED')
    res.status(201).json({ id: result.insertId })
  } catch (error) { next(error) }
})
app.put('/api/accounts/:id', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { name, accountSubtype = null, cashFlowCategory = 'OPERATING', isCashAccount = false, isActive = true } = req.body
    const [result] = await pool.query('UPDATE accounts SET name = ?, account_subtype = ?, cash_flow_category = ?, is_cash_account = ?, is_active = ? WHERE id = ? AND company_id = ?', [name, accountSubtype, cashFlowCategory, isCashAccount, isActive, req.params.id, req.user.company_id])
    if (!result.affectedRows) throw fail(404, 'Akun tidak ditemukan.')
    await audit(pool, req.user.company_id, req.user.id, 'ACCOUNT', req.params.id, 'UPDATED')
    res.json({ ok: true })
  } catch (error) { next(error) }
})

app.get('/api/periods', authenticate, async (req, res, next) => {
  try { const [periods] = await pool.query('SELECT * FROM accounting_periods WHERE company_id = ? ORDER BY start_date DESC', [req.user.company_id]); res.json({ periods }) } catch (error) { next(error) }
})
app.post('/api/periods', authenticate, adminOnly, async (req, res, next) => {
  try {
    const { name, startDate, endDate } = req.body
    if (!name || !startDate || !endDate || startDate > endDate) throw fail(422, 'Nama dan rentang tanggal periode tidak valid.')
    const [result] = await pool.query('INSERT INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?, ?, ?, ?)', [req.user.company_id, name, startDate, endDate])
    res.status(201).json({ id: result.insertId })
  } catch (error) { next(error) }
})

app.get('/api/journals', authenticate, async (req, res, next) => {
  try {
    const { from, to } = defaultRange(req.query)
    const status = req.query.status || null
    const params = [req.user.company_id, from, to]
    let sql = `SELECT e.*, u.name AS creator_name, SUM(l.debit) AS total_debit FROM journal_entries e JOIN users u ON u.id = e.created_by JOIN journal_lines l ON l.journal_entry_id = e.id WHERE e.company_id = ? AND e.entry_date BETWEEN ? AND ?`
    if (status) { sql += ' AND e.status = ?'; params.push(status) }
    sql += ' GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC'
    const [entries] = await pool.query(sql, params)
    res.json({ entries })
  } catch (error) { next(error) }
})
app.get('/api/journals/:id', authenticate, async (req, res, next) => { try { res.json({ entry: await fetchEntry(pool, req.user.company_id, req.params.id) }) } catch (error) { next(error) } })
app.post('/api/journals', authenticate, async (req, res, next) => {
  try {
    const { voucherNo, entryDate, description, lines, status = 'DRAFT' } = req.body
    if (!description || !entryDate || !['DRAFT', 'POSTED'].includes(status)) throw fail(422, 'Tanggal, keterangan, dan status jurnal tidak valid.')
    const id = await withTransaction((connection) => writeEntry(connection, { companyId: req.user.company_id, userId: req.user.id, voucherNo: voucherNo || `JRN-${Date.now()}`, entryDate, description, lines, status }))
    res.status(201).json({ id })
  } catch (error) { next(error) }
})
app.put('/api/journals/:id', authenticate, async (req, res, next) => {
  try {
    const { voucherNo, entryDate, description, lines } = req.body
    await withTransaction(async (connection) => {
      const entry = await fetchEntry(connection, req.user.company_id, req.params.id)
      if (entry.status !== 'DRAFT') throw fail(422, 'Hanya jurnal draft yang dapat diubah.')
      const normalized = assertBalancedLines(lines)
      const period = await getOpenPeriod(connection, req.user.company_id, entryDate)
      await getAccountsForLines(connection, req.user.company_id, normalized)
      await connection.query('UPDATE journal_entries SET voucher_no = ?, entry_date = ?, period_id = ?, description = ? WHERE id = ?', [voucherNo, entryDate, period.id, description, entry.id])
      await connection.query('DELETE FROM journal_lines WHERE journal_entry_id = ?', [entry.id])
      for (const [index, line] of normalized.entries()) await connection.query('INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)', [entry.id, line.account_id ?? line.accountId, index + 1, line.memo || null, line.debit, line.credit])
      await audit(connection, req.user.company_id, req.user.id, 'JOURNAL_ENTRY', entry.id, 'UPDATED')
    })
    res.json({ ok: true })
  } catch (error) { next(error) }
})
app.post('/api/journals/:id/post', authenticate, async (req, res, next) => {
  try {
    await withTransaction(async (connection) => {
      const entry = await fetchEntry(connection, req.user.company_id, req.params.id)
      if (entry.status !== 'DRAFT') throw fail(422, 'Jurnal ini sudah diposting.')
      await getOpenPeriod(connection, req.user.company_id, asDate(entry.entry_date))
      assertBalancedLines(entry.lines)
      await connection.query("UPDATE journal_entries SET status = 'POSTED', posted_by = ?, posted_at = NOW() WHERE id = ?", [req.user.id, entry.id])
      await audit(connection, req.user.company_id, req.user.id, 'JOURNAL_ENTRY', entry.id, 'POSTED')
    })
    res.json({ ok: true })
  } catch (error) { next(error) }
})
app.post('/api/journals/:id/reverse', authenticate, async (req, res, next) => {
  try {
    const entryDate = req.body.entryDate
    const id = await withTransaction(async (connection) => {
      const original = await fetchEntry(connection, req.user.company_id, req.params.id)
      if (original.status !== 'POSTED') throw fail(422, 'Hanya jurnal terposting yang dapat dibalik.')
      return writeEntry(connection, {
        companyId: req.user.company_id, userId: req.user.id, voucherNo: req.body.voucherNo || `REV-${original.voucher_no}`, entryDate,
        description: `Pembalik: ${original.description}`, source: 'REVERSAL', status: 'POSTED', reversalOfId: original.id,
        lines: original.lines.map((line) => ({ account_id: line.account_id, debit: line.credit, credit: line.debit, memo: line.memo }))
      })
    })
    res.status(201).json({ id })
  } catch (error) { next(error) }
})

app.get('/api/imports/template', authenticate, adminOnly, (_req, res) => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet([
    { Tanggal: '2026-01-01', NoBukti: 'JRN-001', Keterangan: 'Setoran modal awal', KodeAkun: '1100', Debit: 10000000, Kredit: 0 },
    { Tanggal: '2026-01-01', NoBukti: 'JRN-001', Keterangan: 'Setoran modal awal', KodeAkun: '3100', Debit: 0, Kredit: 10000000 }
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, 'Jurnal')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Disposition', 'attachment; filename=template-jurnal-finova.xlsx')
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(bytes)
})
app.post('/api/imports/preview', authenticate, adminOnly, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw fail(422, 'Pilih berkas Excel terlebih dahulu.')
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex')
    const parsed = await parseImport(req.file.buffer, pool, req.user.company_id)
    const status = parsed.errors.length ? 'REJECTED' : 'PREVIEW'
    const [result] = await pool.query('INSERT INTO import_batches (company_id, uploaded_by, original_filename, content_hash, status, total_rows, valid_entries, payload_json, errors_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      req.user.company_id, req.user.id, req.file.originalname, hash, status, parsed.totalRows, parsed.entries.length, JSON.stringify(parsed.entries), JSON.stringify(parsed.errors)
    ])
    await audit(pool, req.user.company_id, req.user.id, 'IMPORT_BATCH', result.insertId, status === 'PREVIEW' ? 'PREVIEWED' : 'REJECTED', { totalRows: parsed.totalRows, errors: parsed.errors.length })
    res.json({ batchId: result.insertId, valid: !parsed.errors.length, totalRows: parsed.totalRows, entries: parsed.entries.map((entry) => ({ voucherNo: entry.voucherNo, entryDate: entry.entryDate, description: entry.description, lineCount: entry.lines.length })), errors: parsed.errors })
  } catch (error) { next(error) }
})
app.post('/api/imports/:id/confirm', authenticate, adminOnly, async (req, res, next) => {
  try {
    const posted = await withTransaction(async (connection) => {
      const [batches] = await connection.query('SELECT * FROM import_batches WHERE id = ? AND company_id = ? FOR UPDATE', [req.params.id, req.user.company_id])
      const batch = batches[0]
      if (!batch) throw fail(404, 'Batch impor tidak ditemukan.')
      if (batch.status !== 'PREVIEW') throw fail(422, 'Batch ini tidak siap dikonfirmasi.')
      const entries = jsonValue(batch.payload_json) || []
      for (const entry of entries) await writeEntry(connection, { companyId: req.user.company_id, userId: req.user.id, voucherNo: entry.voucherNo, entryDate: entry.entryDate, description: entry.description, source: 'IMPORT', lines: entry.lines, status: 'POSTED', importBatchId: batch.id })
      await connection.query("UPDATE import_batches SET status = 'POSTED', posted_at = NOW() WHERE id = ?", [batch.id])
      await audit(connection, req.user.company_id, req.user.id, 'IMPORT_BATCH', batch.id, 'POSTED', { entries: entries.length })
      return entries.length
    })
    res.json({ ok: true, posted })
  } catch (error) { next(error) }
})

app.get('/api/reports/:kind', authenticate, async (req, res, next) => {
  try {
    const { from, to } = defaultRange(req.query)
    if (from > to) throw fail(422, 'Rentang tanggal tidak valid.')
    const context = await reportContext(pool, req.user.company_id, from, to)
    const allLines = flatten(context.allEntries)
    const periodLines = flatten(context.periodEntries)
    let data
    switch (req.params.kind) {
      case 'journal': data = context.periodEntries; break
      case 'trial-balance': data = buildTrialBalance(context.accounts, allLines); break
      case 'income-statement': data = buildIncomeStatement(context.accounts, periodLines); break
      case 'balance-sheet': data = buildBalanceSheet(context.accounts, allLines); break
      case 'equity-changes': {
        const before = context.allEntries.filter((entry) => entry.entry_date < from)
        data = buildEquityChanges(context.accounts, flatten(before), periodLines)
        break
      }
      case 'cash-flow': data = buildCashFlowDirect(context.accounts, context.periodEntries); break
      case 'ledger': {
        const accountId = Number(req.query.accountId)
        const account = context.accounts.find((item) => item.id === accountId)
        if (!account) throw fail(422, 'Pilih akun untuk buku besar.')
        const before = allLines.filter((line) => line.account_id === accountId && line.entry_date < from)
        const rows = periodLines.filter((line) => line.account_id === accountId)
        let running = accountBalance(account, calculateAccountBalances(context.accounts, before))
        data = { account, opening: running, rows: rows.map((row) => { running = amount(running + (account.normal_balance === 'DEBIT' ? row.debit - row.credit : row.credit - row.debit)); return { ...row, balance: running } }), closing: running }
        break
      }
      case 'dashboard': {
        const income = buildIncomeStatement(context.accounts, periodLines)
        const balance = buildBalanceSheet(context.accounts, allLines)
        const findAsset = (subtypes) => amount(balance.assets.rows.filter((row) => subtypes.includes(context.accounts.find((a) => a.id === row.accountId)?.account_subtype)).reduce((sum, row) => sum + row.amount, 0))
        data = { cashBank: findAsset(['CASH', 'BANK']), receivables: findAsset(['RECEIVABLE']), payables: balance.liabilities.rows.filter((row) => context.accounts.find((a) => a.id === row.accountId)?.account_subtype === 'PAYABLE').reduce((sum, row) => sum + row.amount, 0), revenue: income.revenueTotal, expenses: income.expenseTotal, netIncome: income.netIncome }
        break
      }
      default: throw fail(404, 'Jenis laporan tidak ditemukan.')
    }
    res.json({ company: context.company, period: { from, to }, data })
  } catch (error) { next(error) }
})

app.post('/api/periods/:id/close', authenticate, adminOnly, async (req, res, next) => {
  try {
    const result = await withTransaction(async (connection) => {
      const [periods] = await connection.query('SELECT * FROM accounting_periods WHERE id = ? AND company_id = ? FOR UPDATE', [req.params.id, req.user.company_id])
      const period = periods[0]
      if (!period) throw fail(404, 'Periode tidak ditemukan.')
      if (period.status !== 'OPEN') throw fail(422, 'Periode sudah ditutup.')
      const context = await reportContext(connection, req.user.company_id, period.start_date, period.end_date)
      const lines = makeClosingLines(context.accounts, flatten(context.periodEntries))
      let entryId = null
      if (lines.length) entryId = await writeEntry(connection, { companyId: req.user.company_id, userId: req.user.id, voucherNo: `TUTUP-${asDate(period.end_date).replaceAll('-', '')}`, entryDate: asDate(period.end_date), description: `Jurnal penutup periode ${period.name}`, source: 'CLOSING', status: 'POSTED', lines })
      await connection.query("UPDATE accounting_periods SET status = 'CLOSED', closed_at = NOW(), closed_by = ? WHERE id = ?", [req.user.id, period.id])
      await audit(connection, req.user.company_id, req.user.id, 'ACCOUNTING_PERIOD', period.id, 'CLOSED', { closingEntryId: entryId })
      return { entryId, netIncome: buildIncomeStatement(context.accounts, flatten(context.periodEntries)).netIncome }
    })
    res.json({ ok: true, ...result })
  } catch (error) { next(error) }
})

app.use((error, _req, res, _next) => {
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Data duplikat: kode, email, nomor bukti, atau berkas impor sudah digunakan.' })
  console.error(error)
  return res.status(error.status || 500).json({ message: error.status ? error.message : 'Terjadi kesalahan pada server.' })
})

ensureBootstrap().then(() => console.log('Bootstrap Finova siap.')).catch((error) => console.error('Bootstrap database tertunda:', error.message))
app.listen(port, () => console.log(`Finova API berjalan di http://localhost:${port}`))
