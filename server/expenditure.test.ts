// Uji integrasi endpoint Siklus Pengeluaran — menjalankan dengan `bun test server/`.
//
// Pola sama dengan payroll.test.ts: server nyata per test, DB scratch, login peran.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFinovaApp, type FinovaApp } from './app'
import { DEMO_PASSWORD, DEMO_USERS, SESSION_COOKIE } from './auth'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'finova-expenditure-test-'))
const year = new Date().getFullYear()
const juneDate = `${year}-06-15`
let app: FinovaApp
let base = ''
let databaseFile = ''
let databaseSequence = 0
let supplierSequence = 0

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

async function createSupplier(overrides: Record<string, unknown> = {}): Promise<any> {
  supplierSequence += 1
  const response = await api('POST', '/api/expenditure/suppliers', {
    supplier_code: `SPK-${String(supplierSequence).padStart(3, '0')}`,
    name: `Pemasok Uji ${supplierSequence}`,
    category: 'BAHAN_BAKU',
    is_trusted: 1,
    operator_role: 'PEMBELIAN',
    ...overrides
  })
  expect(response.status).toBe(201)
  const list = await api('GET', '/api/expenditure/suppliers')
  return list.payload.suppliers.find((row: any) => row.id === response.payload.id)
}

async function createRequisition(overrides: Record<string, unknown> = {}): Promise<any> {
  const response = await api('POST', '/api/expenditure/requisitions', {
    requisition_date: juneDate,
    department: 'DAPUR',
    requested_by: 'Chef Dapur',
    reason: 'Stok bahan kafe menipis',
    items: [{ description: 'Biji kopi Arabika 1 kg', qty: 2, unit_price: 220_000 }],
    ...overrides
  })
  expect(response.status).toBe(201)
  return response.payload
}

async function createPo(requisitionId: number, supplierId: number, overrides: Record<string, unknown> = {}): Promise<any> {
  const response = await api('POST', '/api/expenditure/orders', {
    order_date: juneDate,
    requisition_id: requisitionId,
    supplier_id: supplierId,
    items: [{ description: 'Biji kopi Arabika 1 kg', qty: 2, unit_price: 220_000 }],
    operator_role: 'PEMBELIAN',
    ...overrides
  })
  expect(response.status).toBe(201)
  return response.payload
}

/** Alur penuh sampai barang diterima (PO siap dicatat utangnya). */
async function prepareReceivedPo(overrides: {
  supplier?: Record<string, unknown>
  items?: unknown[]
} = {}): Promise<{ orderId: number; poNo: string; total: number }> {
  const supplier = await createSupplier(overrides.supplier)
  const requisition = await createRequisition()
  await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
    decision: 'APPROVED', operator_role: 'SDM_MANAGER'
  })
  const created = await createPo(requisition.id, supplier.id, overrides.items ? { items: overrides.items } : {})
  await api('POST', `/api/expenditure/orders/${created.id}/send`, { operator_role: 'PEMBELIAN' })
  await api('POST', `/api/expenditure/orders/${created.id}/receipt`, {
    accepted_total: created.total,
    condition_note: 'Kondisi baik',
    operator_role: 'GUDANG'
  })
  return { orderId: created.id, poNo: created.order_no, total: created.total }
}

function orderRow(orderId: number): any {
  return app.db.connection.query('SELECT * FROM purchase_orders WHERE id = ?').get(orderId)
}

function billRow(billId: number): any {
  return app.db.connection.query('SELECT * FROM purchase_bills WHERE id = ?').get(billId)
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
  databaseFile = path.join(scratch, `expenditure-${databaseSequence}.sqlite`)
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

describe('data pemasok', () => {
  it('pemasok dibuat oleh pembelian dengan penanda terpercaya', async () => {
    const supplier = await createSupplier({ category: 'KOSTUM', name: 'Atelier Maid Uji', is_trusted: 1 })
    expect(supplier.category).toBe('KOSTUM')
    expect(Number(supplier.is_trusted)).toBe(1)
  })

  it('hanya pembelian atau admin yang boleh mengelola pemasok', async () => {
    const denied = await api('POST', '/api/expenditure/suppliers', {
      supplier_code: 'SPK-DENIED', name: 'Pemasok Terlarang', operator_role: 'GUDANG'
    })
    expectBadRequest(denied, 'Data pemasok dikelola oleh bagian pembelian.')
  })
})

describe('permintaan pembelian dan persetujuan', () => {
  it('permintaan diajukan bebas lalu disetujui manajer', async () => {
    const requisition = await createRequisition({ department: 'KOSTUM' })
    expect(requisition.requisition_no).toMatch(/^PR-\d{6}-001$/)
    const list = await api('GET', '/api/expenditure/requisitions')
    const row = list.payload.requisitions.find((item: any) => item.id === requisition.id)
    expect(row.status).toBe('DRAFT')
    expect(row.estimated_total).toBe(440_000)
    expect(row.items).toHaveLength(1)

    const denied = await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', operator_role: 'PEMBELIAN'
    })
    expectBadRequest(denied, 'Persetujuan pembelian harus dilakukan manajer')

    const approved = await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', note: 'Sesuai anggaran', operator_role: 'SDM_MANAGER'
    })
    expect(approved.payload.status).toBe('APPROVED')
  })

  it('keputusan harus APPROVED atau REJECTED dan tidak bisa diulang', async () => {
    const requisition = await createRequisition()
    const bad = await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'MAYBE', operator_role: 'SDM_MANAGER'
    })
    expectBadRequest(bad, 'Keputusan harus APPROVED atau REJECTED.')
    await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'REJECTED', operator_role: 'SDM_MANAGER'
    })
    const again = await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', operator_role: 'SDM_MANAGER'
    })
    expectBadRequest(again, 'Permintaan pembelian sudah diputuskan')
  })
})

describe('pesanan pembelian dan penerimaan barang', () => {
  it('PO ditolak bila permintaan belum disetujui; peringatan pemasok tak terpercaya', async () => {
    const supplier = await createSupplier({ is_trusted: 0, name: 'Roastery Baru' })
    const requisition = await createRequisition()
    const beforeApprove = await api('POST', '/api/expenditure/orders', {
      order_date: juneDate,
      requisition_id: requisition.id,
      supplier_id: supplier.id,
      items: [{ description: 'Biji kopi', qty: 1, unit_price: 220_000 }],
      operator_role: 'PEMBELIAN'
    })
    expectBadRequest(beforeApprove, 'Permintaan pembelian belum disetujui manajer')

    await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', operator_role: 'SDM_MANAGER'
    })
    const created = await createPo(requisition.id, supplier.id)
    expect(created.order_no).toMatch(/^PO-\d{6}-001$/)
    expect(Array.isArray(created.warnings)).toBe(true)
    expect(created.warnings.join(' ')).toContain('belum ditandai terpercaya')
  })

  it('PO yang belum dikirim tidak bisa diterima barangnya; penerimaan menyimpan LPB', async () => {
    const supplier = await createSupplier()
    const requisition = await createRequisition()
    await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', operator_role: 'SDM_MANAGER'
    })
    const created = await createPo(requisition.id, supplier.id)
    const early = await api('POST', `/api/expenditure/orders/${created.id}/receipt`, {
      accepted_total: created.total, operator_role: 'GUDANG'
    })
    expectBadRequest(early, 'Laporan penerimaan barang hanya untuk PO yang sudah dikirim')

    await api('POST', `/api/expenditure/orders/${created.id}/send`, { operator_role: 'PEMBELIAN' })
    expect(orderRow(created.id).status).toBe('DIKIRIM')

    const received = await api('POST', `/api/expenditure/orders/${created.id}/receipt`, {
      accepted_total: created.total,
      condition_note: 'Segar dan lengkap',
      operator_role: 'GUDANG'
    })
    expect(received.status).toBe(201)
    expect(received.payload.receipt_no).toMatch(/^LPB-\d{6}-001$/)
    expect(orderRow(created.id).status).toBe('SELESAI')

    const receipts = await api('GET', '/api/expenditure/receipts')
    expect(receipts.payload.receipts[0].condition_note).toBe('Segar dan lengkap')
  })

  it('gudang tidak boleh membuat atau mengirim PO', async () => {
    const supplier = await createSupplier()
    const requisition = await createRequisition()
    await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', operator_role: 'SDM_MANAGER'
    })
    const denied = await api('POST', '/api/expenditure/orders', {
      order_date: juneDate,
      requisition_id: requisition.id,
      supplier_id: supplier.id,
      items: [{ description: 'Biji kopi', qty: 1, unit_price: 220_000 }],
      operator_role: 'GUDANG'
    })
    expectBadRequest(denied, 'Pesanan pembelian dibuat oleh bagian pembelian.')
  })
})

describe('faktur pemasok dengan three-way match', () => {
  it('faktur yang cocok membentuk utang usaha dengan akun beban sesuai kategori', async () => {
    const { orderId, total } = await prepareReceivedPo({ supplier: { name: 'Roastery Nusantara' } })
    const bill = await api('POST', '/api/expenditure/bills', {
      order_id: orderId,
      supplier_invoice_no: 'INV-RST-777',
      operator_role: 'AKUNTANSI'
    })
    expect(bill.status).toBe(201)
    expect(bill.payload.bill_no).toMatch(/^FP-\d{6}-001$/)
    expect(billRow(bill.payload.id).match_status).toBe('MATCHED')
    expect(billRow(bill.payload.id).status).toBe('OPEN')

    const lines = journalLines(`EXP-${year}-06-001`)
    expect(lines).toHaveLength(2)
    expect(lines[0].account_code).toBe('5100')
    expect(lines[0].debit).toBe(total)
    expect(lines[1].account_code).toBe('2120')
    expect(lines[1].credit).toBe(total)
  })

  it('faktur dengan nilai berbeda dari PO ditolak (selisih dilaporkan)', async () => {
    const { orderId, total } = await prepareReceivedPo()
    const mismatch = await api('POST', '/api/expenditure/bills', {
      order_id: orderId,
      amount: total + 34_000,
      operator_role: 'AKUNTANSI'
    })
    expectBadRequest(mismatch, 'Dokumen tidak cocok (three-way match gagal)')
    expect(mismatch.payload.message).toContain('Selisih 34000')
  })

  it('utang tidak dicatat sebelum barang diterima', async () => {
    const supplier = await createSupplier()
    const requisition = await createRequisition()
    await api('POST', `/api/expenditure/requisitions/${requisition.id}/decide`, {
      decision: 'APPROVED', operator_role: 'SDM_MANAGER'
    })
    const created = await createPo(requisition.id, supplier.id)
    await api('POST', `/api/expenditure/orders/${created.id}/send`, { operator_role: 'PEMBELIAN' })
    const bill = await api('POST', '/api/expenditure/bills', { order_id: created.id, operator_role: 'AKUNTANSI' })
    expectBadRequest(bill, 'barangnya sudah diterima')
  })
})

describe('pembayaran pemasok', () => {
  it('pembayaran melunasi utang dengan jurnal debit utang, kredit bank', async () => {
    const { orderId, total } = await prepareReceivedPo({ supplier: { name: 'Toko Bahan Manis' } })
    const bill = await api('POST', '/api/expenditure/bills', { order_id: orderId, operator_role: 'AKUNTANSI' })

    const denied = await api('POST', '/api/expenditure/payments', {
      bill_id: bill.payload.id, amount: total, method: 'BANK', operator_role: 'PEMBELIAN'
    })
    expectBadRequest(denied, 'Pembayaran kepada pemasok dilakukan bagian keuangan')

    const payment = await api('POST', '/api/expenditure/payments', {
      bill_id: bill.payload.id,
      amount: total,
      method: 'BANK',
      reference_no: 'TRF-20260615-01',
      operator_role: 'KEUANGAN'
    })
    expect(payment.status).toBe(201)
    expect(payment.payload.payment_no).toMatch(/^BKK-\d{6}-001$/)
    expect(billRow(bill.payload.id).status).toBe('PAID')

    const lines = journalLines(`EXP-${year}-06-002`)
    expect(lines[0].account_code).toBe('2120')
    expect(lines[0].debit).toBe(total)
    expect(lines[1].account_code).toBe('1110')
    expect(lines[1].credit).toBe(total)

    const payments = await api('GET', '/api/expenditure/payments')
    expect(payments.payload.payments[0].reference_no).toBe('TRF-20260615-01')
  })

  it('pembayaran ditolak bila faktur belum MATCHED atau jumlah melebihi sisa', async () => {
    const { orderId, total } = await prepareReceivedPo()
    // Utang dibuat, lalu dipaksa MISMATCH lewat DB untuk menguji gerbang status.
    const bill = await api('POST', '/api/expenditure/bills', { order_id: orderId, operator_role: 'AKUNTANSI' })
    app.db.connection.run(
      "UPDATE purchase_bills SET match_status = 'MISMATCH' WHERE id = ?",
      [bill.payload.id]
    )
    const gated = await api('POST', '/api/expenditure/payments', {
      bill_id: bill.payload.id, amount: total, operator_role: 'KEUANGAN'
    })
    expectBadRequest(gated, 'belum lolos pencocokan tiga arah')

    app.db.connection.run(
      "UPDATE purchase_bills SET match_status = 'MATCHED' WHERE id = ?",
      [bill.payload.id]
    )
    const excessive = await api('POST', '/api/expenditure/payments', {
      bill_id: bill.payload.id, amount: total + 10_000, operator_role: 'KEUANGAN'
    })
    expectBadRequest(excessive, 'melebihi sisa utang')
  })
})

describe('jurnal dan pengendalian siklus pengeluaran', () => {
  it('daftar jurnal hanya memuat sumber EXPENDITURE', async () => {
    const { orderId, total } = await prepareReceivedPo()
    await api('POST', '/api/expenditure/bills', { order_id: orderId, operator_role: 'AKUNTANSI' })
    const journals = await api('GET', '/api/expenditure/journals')
    expect(journals.payload.journals).toHaveLength(1)
    expect(journals.payload.journals[0].source).toBe('EXPENDITURE')
    expect(journals.payload.journals[0].voucher_no).toMatch(/^EXP-\d{4}-\d{2}-001$/)
    expect(journals.payload.journals[0].lines[0].debit).toBe(total)
  })

  it('rekonsiliasi utang: expected dari catatan utang OPEN bulan terkait', async () => {
    const period = `${year}-06`
    const { orderId, total } = await prepareReceivedPo()
    await api('POST', '/api/expenditure/bills', { order_id: orderId, operator_role: 'AKUNTANSI' })

    const suggested = await api('GET', `/api/expenditure/controls?period=${period}`)
    expect(suggested.payload.suggested.payableTotal).toBe(total)

    const mismatch = await api('POST', '/api/expenditure/controls', {
      period, kind: 'AP_RECONCILIATION', statement_total: 100_000, operator_role: 'AKUNTANSI'
    })
    expect(mismatch.payload.status).toBe('MISMATCH')
    expect(mismatch.payload.difference).toBe(100_000 - total)

    const ok = await api('POST', '/api/expenditure/controls', {
      period, kind: 'AP_RECONCILIATION', statement_total: total, note: 'Laporan pemasok cocok', operator_role: 'KEUANGAN'
    })
    expect(ok.payload.status).toBe('OK')

    const denied = await api('POST', '/api/expenditure/controls', {
      period, kind: 'AP_RECONCILIATION', statement_total: 0, operator_role: 'GUDANG'
    })
    expectBadRequest(denied, 'Rekonsiliasi utang dilakukan akuntansi atau keuangan')
  })
})
