// Uji integrasi endpoint Siklus Pendapatan — menjalankan dengan `bun test server/`.
//
// Pola sama dengan payroll.test.ts: server nyata per test, DB scratch, login peran.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFinovaApp, type FinovaApp } from './app'
import { DEMO_PASSWORD, DEMO_USERS, SESSION_COOKIE } from './auth'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-revenue-test-'))
const year = new Date().getFullYear()
const juneDate = `${year}-06-15`
let app: FinovaApp
let base = ''
let databaseFile = ''
let databaseSequence = 0
let customerSequence = 0
let menuSequence = 0

interface ApiResult {
  status: number
  payload: any
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

/** Field peran di body adalah pemeran test; server membaca peran dari sesi. */
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

function expectBadRequest(result: ApiResult, message: string): void {
  expect(result.status).toBe(422)
  expect(result.payload.message).toContain(message)
}

async function createCustomer(overrides: Record<string, unknown> = {}): Promise<any> {
  customerSequence += 1
  const response = await api('POST', '/api/revenue/customers', {
    customer_code: `MBR-${String(customerSequence).padStart(3, '0')}`,
    name: `Pelanggan Uji ${customerSequence}`,
    customer_type: 'TUNAI',
    phone: '0812-0000',
    address: 'Bandung',
    credit_limit: 0,
    operator_role: 'PENJUALAN',
    ...overrides
  })
  expect(response.status).toBe(201)
  const list = await api('GET', '/api/revenue/customers')
  return list.payload.customers.find((row: any) => row.id === response.payload.id)
}

async function createMenu(overrides: Record<string, unknown> = {}): Promise<any> {
  menuSequence += 1
  const response = await api('POST', '/api/revenue/menu-items', {
    item_code: `MN-${String(menuSequence).padStart(3, '0')}`,
    name: `Menu Uji ${menuSequence}`,
    category: 'MAKANAN',
    unit_price: 45_000,
    operator_role: 'PENJUALAN',
    ...overrides
  })
  expect(response.status).toBe(201)
  const list = await api('GET', '/api/revenue/menu-items')
  return list.payload.menu_items.find((row: any) => row.id === response.payload.id)
}

async function createOrder(overrides: Record<string, unknown> = {}): Promise<any> {
  const response = await api('POST', '/api/revenue/orders', {
    order_date: juneDate,
    order_type: 'DINE_IN',
    payment_type: 'TUNAI',
    items: [{ description: 'Omurice Melody', qty: 2, unit_price: 45_000 }],
    ...overrides
  })
  expect(response.status).toBe(201)
  return response.payload
}

/** Alur penuh sampai pesanan disajikan (siap difakturkan). */
async function prepareServedOrder(overrides: Record<string, unknown> = {}): Promise<{ orderId: number; total: number }> {
  const customer = overrides.customer_id
    ? { id: overrides.customer_id }
    : await createCustomer()
  const created = await createOrder({ ...overrides, customer_id: customer.id })
  await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
  await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG', served_note: 'Disajikan' })
  return { orderId: created.id, total: created.total }
}

function orderRow(orderId: number): any {
  return app.db.connection.query('SELECT * FROM revenue_orders WHERE id = ?').get(orderId)
}

function journalLines(voucherNo: string): any[] {
  return app.db.connection
    .query(
      `SELECT l.*, a.code AS account_code FROM journal_lines l
       JOIN journal_entries e ON e.id = l.journal_entry_id
       JOIN accounts a ON a.id = l.account_id
       WHERE e.voucher_no = ? ORDER BY l.line_no`
    )
    .all(voucherNo) as any[]
}

beforeEach(async () => {
  databaseSequence += 1
  databaseFile = path.join(scratch, `revenue-${databaseSequence}.sqlite`)
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

describe('data induk siklus pendapatan', () => {
  it('menyemai akun siklus pendapatan dan perusahaan kafe maid', () => {
    const company = app.db.connection.query('SELECT name FROM companies WHERE id = 1').get() as { name: string }
    expect(company.name).toBe('Maid Caffe Finova')
    const accountCodes = (app.db.connection.query('SELECT code FROM accounts ORDER BY code').all() as any[])
      .map((row) => row.code)
    for (const code of ['1120', '1130', '2120', '4100', '5100', '5300', '5400', '5500']) {
      expect(accountCodes).toContain(code)
    }
  })

  it('pelanggan tunai dipaksa tanpa limit kredit', async () => {
    const customer = await createCustomer({ customer_type: 'TUNAI', credit_limit: 5_000_000 })
    expect(Number(customer.credit_limit)).toBe(0)
  })

  it('menolak data pelanggan tanpa kode atau dengan tipe tidak dikenal', async () => {
    const missing = await api('POST', '/api/revenue/customers', { name: 'Tanpa Kode', operator_role: 'PENJUALAN' })
    expectBadRequest(missing, 'Kode pelanggan wajib diisi.')
    const badType = await api('POST', '/api/revenue/customers', {
      customer_code: 'X-1', name: 'Tipe Aneh', customer_type: 'VITUAL', operator_role: 'PENJUALAN'
    })
    expectBadRequest(badType, 'Tipe pelanggan tidak dikenal.')
  })

  it('hanya penjualan atau admin yang boleh mengelola menu', async () => {
    const asKeuangan = await api('POST', '/api/revenue/menu-items', {
      item_code: 'MN-DENIED', name: 'Menu Terlarang', unit_price: 10_000, operator_role: 'KEUANGAN'
    })
    expectBadRequest(asKeuangan, 'Data menu dikelola oleh bagian penjualan.')
    const asPenjualan = await api('POST', '/api/revenue/menu-items', {
      item_code: 'MN-OK', name: 'Parfait Momo', category: 'DESSERT', unit_price: 38_000, operator_role: 'PENJUALAN'
    })
    expect(asPenjualan.status).toBe(201)
  })
})

describe('alur pesanan sampai faktur tunai', () => {
  it('pesanan dibuat draft lalu dikonfirmasi, disajikan, dan difakturkan', async () => {
    const customer = await createCustomer()
    const menu = await createMenu({ unit_price: 28_000 })
    const created = await createOrder({
      customer_id: customer.id,
      items: [{ menu_item_id: menu.id, description: menu.name, qty: 3, unit_price: menu.unit_price }]
    })
    expect(created.total).toBe(84_000)
    expect(created.order_no).toMatch(/^SO-\d{6}-001$/)

    const beforeConfirm = await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG' })
    expectBadRequest(beforeConfirm, 'harus dikonfirmasi bagian penjualan sebelum disajikan')

    await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
    await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG' })
    expect(orderRow(created.id).status).toBe('DISAJIKAN')

    const invoiced = await api('POST', `/api/revenue/orders/${created.id}/invoice`, {
      method: 'KAS', operator_role: 'AKUNTANSI'
    })
    expect(invoiced.status).toBe(201)
    expect(invoiced.payload.invoice_no).toMatch(/^FJ-\d{6}-001$/)
    expect(orderRow(created.id).status).toBe('DIFAKTURKAN')

    // Jurnal tunai: debit Kas di Tangan, kredit Pendapatan.
    const lines = journalLines(`REV-${year}-06-001`)
    expect(lines).toHaveLength(2)
    expect(lines[0].account_code).toBe('1120')
    expect(lines[0].debit).toBe(84_000)
    expect(lines[1].account_code).toBe('4100')
    expect(lines[1].credit).toBe(84_000)

    // Bukti penerimaan kas tunai otomatis, belum disetor.
    const receipts = await api('GET', '/api/revenue/receipts')
    expect(receipts.payload.receipts).toHaveLength(1)
    expect(receipts.payload.receipts[0].method).toBe('KAS')
    expect(receipts.payload.receipts[0].deposit_status).toBe('NOT_DEPOSITED')
    const invoiceRow = app.db.connection
      .query('SELECT * FROM revenue_invoices WHERE id = ?')
      .get(invoiced.payload.id) as any
    expect(invoiceRow.status).toBe('PAID')
  })

  it('menolak memfakturkan pesanan yang belum disajikan', async () => {
    const customer = await createCustomer()
    const created = await createOrder({ customer_id: customer.id })
    await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
    const invoiced = await api('POST', `/api/revenue/orders/${created.id}/invoice`, { operator_role: 'AKUNTANSI' })
    expectBadRequest(invoiced, 'Faktur hanya dibuat untuk pesanan yang sudah disajikan')
  })

  it('pemisahan tugas: gudang tidak boleh mengonfirmasi pesanan', async () => {
    const customer = await createCustomer()
    const created = await createOrder({ customer_id: customer.id })
    const result = await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'GUDANG' })
    expectBadRequest(result, 'Penerimaan pesanan pelanggan dilakukan bagian penjualan.')
  })
})

describe('alur penjualan kredit dengan piutang', () => {
  async function prepareCreditCustomer(): Promise<any> {
    return createCustomer({
      customer_type: 'KORPORAT',
      name: 'PT Sinar Katering',
      credit_limit: 1_000_000
    })
  }

  it('kredit tanpa persetujuan manajer ditolak; dengan persetujuan jurnal piutang', async () => {
    const customer = await prepareCreditCustomer()
    const menu = await createMenu({ name: 'Paket Katering Event', category: 'PAKET_EVENT', unit_price: 750_000 })
    const created = await createOrder({
      customer_id: customer.id,
      payment_type: 'KREDIT',
      order_type: 'CATERING',
      items: [{ menu_item_id: menu.id, description: menu.name, qty: 1, unit_price: menu.unit_price }]
    })
    await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
    await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG' })

    const withoutApproval = await api('POST', `/api/revenue/orders/${created.id}/invoice`, { operator_role: 'AKUNTANSI' })
    expectBadRequest(withoutApproval, 'Penjualan kredit belum disetujui manajer')

    const wrongRole = await api('POST', `/api/revenue/orders/${created.id}/approve-credit`, {
      operator_role: 'AKUNTANSI'
    })
    expectBadRequest(wrongRole, 'Persetujuan penjualan kredit harus dilakukan manajer')

    const approved = await api('POST', `/api/revenue/orders/${created.id}/approve-credit`, {
      operator_role: 'SDM_MANAGER', note: 'Limit tersedia'
    })
    expect(approved.status).toBe(200)

    const invoiced = await api('POST', `/api/revenue/orders/${created.id}/invoice`, { operator_role: 'AKUNTANSI' })
    expect(invoiced.status).toBe(201)

    const lines = journalLines(`REV-${year}-06-001`)
    expect(lines[0].account_code).toBe('1130')
    expect(lines[0].debit).toBe(750_000)
    expect(lines[1].account_code).toBe('4100')

    const invoiceRow = app.db.connection
      .query('SELECT * FROM revenue_invoices WHERE id = ?')
      .get(invoiced.payload.id) as any
    expect(invoiceRow.status).toBe('OPEN')
    expect(invoiceRow.due_date).toBe(addDaysJst(invoiceRow.invoice_date, 14))
  })

  it('penerimaan kas melunasi piutang dan setoran membuat jurnal bank', async () => {
    const customer = await prepareCreditCustomer()
    const created = await prepareCreditFlow(customer.id)
    const invoices = await api('GET', '/api/revenue/invoices')
    const invoice = invoices.payload.invoices.find((row: any) => row.order_id === created)
    expect(invoice).toBeTruthy()

    const receipt = await api('POST', '/api/revenue/receipts', {
      invoice_id: invoice.id,
      amount: invoice.amount,
      method: 'KAS',
      operator_role: 'KEUANGAN'
    })
    expect(receipt.status).toBe(201)
    const invoiceRow = app.db.connection
      .query('SELECT status, paid FROM revenue_invoices WHERE id = ?')
      .get(invoice.id) as any
    expect(invoiceRow.status).toBe('PAID')
    expect(invoiceRow.paid).toBe(invoice.amount)

    const receipts = await api('GET', '/api/revenue/receipts')
    const cashReceipt = receipts.payload.receipts[0]
    expect(cashReceipt.deposit_status).toBe('NOT_DEPOSITED')

    const deposit = await api('POST', `/api/revenue/receipts/${cashReceipt.id}/deposit`, {
      reference_no: 'SETOR-001', operator_role: 'KEUANGAN'
    })
    expect(deposit.status).toBe(200)
    const depositLines = (app.db.connection
      .query(
        `SELECT a.code AS code, l.debit, l.credit FROM journal_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         JOIN accounts a ON a.id = l.account_id
         WHERE e.id = ? ORDER BY l.line_no`
      )
      .all(deposit.payload.journalId)) as any[]
    expect(depositLines[0].code).toBe('1110')
    expect(depositLines[1].code).toBe('1120')
  })

  it('penerimaan melebihi sisa faktur ditolak', async () => {
    const customer = await prepareCreditCustomer()
    const orderId = await prepareCreditFlow(customer.id)
    const invoices = await api('GET', '/api/revenue/invoices')
    const invoice = invoices.payload.invoices.find((row: any) => row.order_id === orderId)
    const rejected = await api('POST', '/api/revenue/receipts', {
      invoice_id: invoice.id,
      amount: invoice.amount + 1,
      method: 'BANK',
      operator_role: 'KEUANGAN'
    })
    expectBadRequest(rejected, 'melebihi sisa faktur')
  })

  it('pesanan kredit melebihi limit ditolak saat persetujuan', async () => {
    const customer = await prepareCreditCustomer()
    const created = await createOrder({
      customer_id: customer.id,
      payment_type: 'KREDIT',
      order_type: 'EVENT',
      items: [{ description: 'Paket birthday party besar', qty: 2, unit_price: 750_000 }]
    })
    await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
    await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG' })
    const approved = await api('POST', `/api/revenue/orders/${created.id}/approve-credit`, {
      operator_role: 'SDM_MANAGER'
    })
    expectBadRequest(approved, 'Limit kredit pelanggan tidak mencukupi')
  })

  async function prepareCreditFlow(customerId: number): Promise<number> {
    const created = await createOrder({
      customer_id: customerId,
      payment_type: 'KREDIT',
      order_type: 'CATERING',
      items: [{ description: 'Paket katering uji', qty: 1, unit_price: 750_000 }]
    })
    await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
    await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG' })
    await api('POST', `/api/revenue/orders/${created.id}/approve-credit`, { operator_role: 'SDM_MANAGER' })
    await api('POST', `/api/revenue/orders/${created.id}/invoice`, { operator_role: 'AKUNTANSI' })
    return created.id
  }
})

describe('jurnal dan pengendalian siklus pendapatan', () => {
  it('daftar jurnal hanya memuat sumber REVENUE', async () => {
    const customer = await createCustomer()
    const created = await createOrder({ customer_id: customer.id })
    await api('POST', `/api/revenue/orders/${created.id}/confirm`, { operator_role: 'PENJUALAN' })
    await api('POST', `/api/revenue/orders/${created.id}/serve`, { operator_role: 'GUDANG' })
    await api('POST', `/api/revenue/orders/${created.id}/invoice`, { operator_role: 'AKUNTANSI' })

    const journals = await api('GET', '/api/revenue/journals')
    expect(journals.payload.journals).toHaveLength(1)
    expect(journals.payload.journals[0].source).toBe('REVENUE')
    expect(journals.payload.journals[0].voucher_no).toMatch(/^REV-\d{4}-\d{2}-001$/)
    expect(journals.payload.journals[0].lines).toHaveLength(2)
  })

  it('rekonsiliasi kas: OK saat sesuai, MISMATCH saat selisih', async () => {
    const period = `${year}-06`
    const empty = await api('GET', `/api/revenue/controls?period=${period}`)
    expect(empty.payload.suggested.depositedTotal).toBe(0)

    const first = await api('POST', '/api/revenue/controls', {
      period, kind: 'CASH_RECONCILIATION', bank_total: 250_000, operator_role: 'KEUANGAN'
    })
    expect(first.payload.status).toBe('MISMATCH')
    expect(first.payload.difference).toBe(250_000)

    const wrongRole = await api('POST', '/api/revenue/controls', {
      period, kind: 'CASH_RECONCILIATION', bank_total: 0, operator_role: 'PENJUALAN'
    })
    expectBadRequest(wrongRole, 'Rekonsiliasi kas dilakukan akuntansi atau keuangan')

    const second = await api('POST', '/api/revenue/controls', {
      period, kind: 'CASH_RECONCILIATION', bank_total: 0, operator_role: 'AKUNTANSI'
    })
    expect(second.payload.status).toBe('OK')
  })
})

/** Penanggalan +14 hari sesuai implementasi route (tanpa efek zona waktu). */
function addDaysJst(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}
