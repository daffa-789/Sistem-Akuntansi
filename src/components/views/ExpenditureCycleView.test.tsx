// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ExpenditureCycleView } from './ExpenditureCycleView.jsx'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let suppliers: any[]
let requisitions: any[]
let orders: any[]
let goodsReceipts: any[]
let bills: any[]
let payments: any[]
let journals: any[]
let controlsState: any[]
let posts: Array<{ url: string; body: any }>

const supplier = {
  id: 1,
  supplier_code: 'SPK-001',
  name: 'Roastery Kopi Nusantara',
  category: 'BAHAN_BAKU',
  phone: '0813-0001',
  address: 'Bandung',
  is_trusted: 1,
  is_active: 1
}

const requisition = {
  id: 1,
  requisition_no: 'PR-202611-001',
  requisition_date: '2026-11-15',
  department: 'DAPUR',
  requested_by: 'Chef Dapur',
  reason: 'Stok biji kopi menipis',
  status: 'APPROVED',
  estimated_total: 440_000,
  items: [{ description: 'Biji kopi Arabika 1 kg', qty: 2, est_price: 220_000, est_total: 440_000 }]
}

const sentPo = {
  id: 1,
  order_no: 'PO-202611-001',
  order_date: '2026-11-16',
  requisition_id: 1,
  requisition_no: 'PR-202611-001',
  supplier_id: 1,
  supplier_name: 'Roastery Kopi Nusantara',
  supplier_category: 'BAHAN_BAKU',
  is_trusted: 1,
  status: 'DIKIRIM',
  total: 440_000,
  notes: null,
  items: [{ description: 'Biji kopi Arabika 1 kg', qty: 2, unit_price: 220_000, line_total: 440_000 }]
}

function payloadFor(url: string): any {
  if (url === '/api/company') return { company: { id: 1, name: 'Maid Caffe Finova' } }
  if (url === '/api/expenditure/suppliers') return { suppliers }
  if (url === '/api/expenditure/requisitions') return { requisitions }
  if (url === '/api/expenditure/orders') return { orders }
  if (url === '/api/expenditure/receipts') return { receipts: goodsReceipts }
  if (url === '/api/expenditure/bills') return { bills }
  if (url === '/api/expenditure/payments') return { payments }
  if (url === '/api/expenditure/journals') return { journals }
  if (url.startsWith('/api/expenditure/controls')) {
    return {
      period: '2026-11',
      checks: controlsState,
      suggested: { payableTotal: 440_000, untrustedSuppliers: suppliers.filter((s) => !Number(s.is_trusted)).length }
    }
  }
  return {}
}

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

function flush(): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

function tab(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('[role="tab"]'))
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Tab "${label}" tidak ditemukan`)
  return button as HTMLButtonElement
}

function button(label: string): HTMLButtonElement {
  const candidate = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === label)
  if (!candidate) throw new Error(`Tombol "${label}" tidak ditemukan`)
  return candidate as HTMLButtonElement
}

async function openTab(label: string): Promise<void> {
  await act(async () => {
    tab(label).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function click(label: string): Promise<void> {
  const target = button(label)
  if (target.disabled) throw new Error(`Tombol "${label}" nonaktif`)
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function setField(label: string, value: string): Promise<void> {
  const fieldLabel = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.querySelector('span')?.textContent?.trim() === label)
  const field = fieldLabel?.querySelector('input, select, textarea') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  if (!field) throw new Error(`Field "${label}" tidak ditemukan`)
  await act(async () => {
    const prototype = field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
    const eventName = field instanceof HTMLSelectElement ? 'change' : 'input'
    field.dispatchEvent(new window.Event(eventName, { bubbles: true }))
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

async function setAriaField(label: string, value: string): Promise<void> {
  const field = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null
  if (!field) throw new Error(`Field aria-label "${label}" tidak ditemukan`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

/** Kirim form modal: tombol submit berada di footer (asosiasi `form=` tidak reliabel di jsdom). */
async function submitForm(formId: string): Promise<void> {
  const form = container.querySelector(`#${formId}`) as HTMLFormElement | null
  if (!form) throw new Error(`Form "${formId}" tidak ditemukan`)
  await act(async () => {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  })
  await flush()
}

function lastPost(urlSuffix: string): { url: string; body: any } {
  const found = [...posts].reverse().find((post) => post.url.endsWith(urlSuffix))
  if (!found) throw new Error(`Tidak ada POST ke ${urlSuffix}`)
  return found
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  suppliers = [{ ...supplier }]
  requisitions = [{ ...requisition }]
  orders = [{ ...sentPo }]
  goodsReceipts = []
  bills = []
  payments = []
  journals = []
  controlsState = []
  posts = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {}
    if (method === 'POST') {
      posts.push({ url, body })
      if (url.endsWith('/api/expenditure/suppliers')) {
        suppliers = [...suppliers, { id: 2, is_active: 1, is_trusted: 0, ...body }]
        return { ok: true, status: 201, json: async () => ({ id: 2 }) }
      }
      if (url.endsWith('/api/expenditure/requisitions')) {
        requisitions = [{ ...requisition, id: 9, requisition_no: 'PR-202611-002', status: 'DRAFT' }, ...requisitions]
        return { ok: true, status: 201, json: async () => ({ id: 9, requisition_no: 'PR-202611-002' }) }
      }
      if (url.endsWith('/decide')) {
        requisitions = requisitions.map((row) => ({ ...row, status: row.status === 'DRAFT' ? body.decision : row.status }))
        return { ok: true, status: 200, json: async () => ({ ok: true, status: body.decision }) }
      }
      if (url.endsWith('/api/expenditure/orders')) {
        orders = [{ ...sentPo, id: 9, status: 'DRAFT', order_no: 'PO-202611-002', warnings: [] }, ...orders]
        return { ok: true, status: 201, json: async () => ({ id: 9, order_no: 'PO-202611-002', total: 440_000, warnings: [] }) }
      }
      if (url.endsWith('/send')) {
        orders = orders.map((order) => (order.status === 'DRAFT' ? { ...order, status: 'DIKIRIM' } : order))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      if (url.endsWith('/receipt')) {
        orders = orders.map((order) => ({ ...order, status: order.status === 'DIKIRIM' ? 'SELESAI' : order.status }))
        goodsReceipts = [{ id: 3, receipt_no: 'LPB-202611-001', receipt_date: body.receipt_date, order_id: 1, order_no: 'PO-202611-001', accepted_total: body.accepted_total, condition_note: body.condition_note, checked_by: body.checked_by }]
        return { ok: true, status: 201, json: async () => ({ ok: true, id: 3, receipt_no: 'LPB-202611-001' }) }
      }
      if (url.endsWith('/api/expenditure/bills')) {
        bills = [...bills, { id: 4, bill_no: 'FP-202611-001', bill_date: body.bill_date, order_id: body.order_id, order_no: 'PO-202611-001', supplier_id: 1, supplier_name: 'Roastery Kopi Nusantara', supplier_category: 'BAHAN_BAKU', supplier_invoice_no: body.supplier_invoice_no, amount: body.amount, paid: 0, match_status: 'MATCHED', status: 'OPEN' }]
        return { ok: true, status: 201, json: async () => ({ ok: true, id: 4, bill_no: 'FP-202611-001', journalId: 6 }) }
      }
      if (url.endsWith('/api/expenditure/payments')) {
        payments = [...payments, { id: 8, payment_no: 'BKK-202611-001', payment_date: body.payment_date, bill_id: body.bill_id, bill_no: 'FP-202611-001', amount: body.amount, method: body.method, reference_no: body.reference_no }]
        bills = bills.map((bill) => ({ ...bill, paid: body.amount, status: 'PAID' }))
        return { ok: true, status: 201, json: async () => ({ ok: true, id: 8, payment_no: 'BKK-202611-001', journalId: 7 }) }
      }
      if (url.endsWith('/api/expenditure/controls')) {
        const expected = 440_000
        const actual = body.statement_total
        const difference = actual - expected
        const status = difference === 0 ? 'OK' : 'MISMATCH'
        controlsState = [{ kind: 'AP_RECONCILIATION', period: body.period, expected_value: expected, actual_value: actual, difference, status, operator_role: 'AKUNTANSI', checked_at: '2026-11-26 10:00:00', note: body.note }]
        return { ok: true, status: 200, json: async () => ({ ok: true, status, expected, actual, difference }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    return { ok: true, status: 200, json: async () => payloadFor(url) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ExpenditureCycleView sesuai BAB V.pptx', () => {
  it('menampilkan tujuh tab, lima aktivitas, dan nama kafe maid', async () => {
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()

    expect(container.querySelectorAll('[role="tab"]').length).toBe(7)
    expect(container.textContent).toContain('Lima aktivitas siklus pengeluaran')
    expect(container.textContent).toContain('Permintaan pembelian')
    expect(container.textContent).toContain('Pembayaran kepada pemasok')
    expect(container.textContent).toContain('Total Biaya Pembelian = Bahan Baku + Perlengkapan + Jasa')
    expect(container.textContent).toContain('Maid Caffe Finova')
    expect(container.querySelectorAll('.cycle-metric').length).toBe(4)
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/') && !String(url).startsWith('/api/api/'))).toBe(true)
  })

  it('menambah pemasok roastery lewat modal', async () => {
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()
    await openTab('Pemasok')
    await click('Tambah pemasok')
    await setField('Kode pemasok', 'SPK-002')
    await setField('Nama pemasok', 'Toko Bahan Kue Manis')
    await setField('Kategori', 'BAHAN_BAKU')
    await submitForm('expenditure-supplier-form')

    const post = lastPost('/api/expenditure/suppliers')
    expect(post.body.supplier_code).toBe('SPK-002')
    expect(post.body.name).toBe('Toko Bahan Kue Manis')
    expect(container.textContent).toContain('Toko Bahan Kue Manis')
    expect(container.textContent).toContain('Belum terpercaya')
  })

  it('mengajukan permintaan pembelian dapur dan menyetujuinya sebagai manajer', async () => {
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()
    await openTab('Permintaan & PO')
    await click('Permintaan baru')
    await setField('Tanggal permintaan', '2026-11-18')
    await setField('Bagian pengusul', 'KAFE')
    await setAriaField('Deskripsi item', 'Sirup stroberi')
    await setAriaField('Jumlah', '3')
    await setAriaField('Estimasi harga', '42000')
    await submitForm('expenditure-requisition-form')

    const post = lastPost('/api/expenditure/requisitions')
    expect(post.body.department).toBe('KAFE')
    expect(post.body.items[0].qty).toBe(3)
    expect(container.textContent).toContain('PR-202611-002')

    await click('Setujui')
    expect(lastPost('/decide').body.decision).toBe('APPROVED')
    expect(container.textContent).toContain('Disetujui')
  })

  it('alur PO: dibuat dari permintaan disetujui, dikirim, lalu barang diterima gudang', async () => {
    requisitions = [{ ...requisition, status: 'DRAFT' }]
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()
    await openTab('Permintaan & PO')

    // PO tidak bisa dibuat sebelum permintaan disetujui.
    await click('Setujui')
    await click('Pesanan pembelian')
    await setField('Tanggal PO', '2026-11-19')
    await setField('Permintaan sumber', '1')
    await setField('Pemasok', '1')
    await setAriaField('Deskripsi item', 'Biji kopi Arabika 1 kg')
    await setAriaField('Jumlah', '2')
    await setAriaField('Harga satuan', '220000')
    await submitForm('expenditure-po-form')

    const post = lastPost('/api/expenditure/orders')
    expect(post.body.requisition_id).toBe(1)
    expect(post.body.supplier_id).toBe(1)
    expect(container.textContent).toContain('PO-202611-002')

    await click('Kirim ke pemasok')
    expect(lastPost('/send').url).toContain('/api/expenditure/orders/9/send')

    await click('Catat penerimaan')
    await setField('Nilai barang diterima (Rp)', '440000')
    await setField('Kondisi barang', 'Segar dan lengkap')
    await submitForm('expenditure-receipt-form')

    const receiptPost = lastPost('/receipt')
    expect(receiptPost.body.accepted_total).toBe(440_000)
    await openTab('Penerimaan Barang')
    expect(container.textContent).toContain('LPB-202611-001')
    expect(container.textContent).toContain('Segar dan lengkap')
  })

  it('faktur pemasok cocok lalu dibayar keuangan dengan bukti transfer', async () => {
    orders = [{ ...sentPo, status: 'SELESAI' }]
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()
    await openTab('Utang & Pembayaran')
    await click('Catat faktur')
    await setField('Nomor faktur pemasok', 'INV-RST-777')
    await submitForm('expenditure-bill-form')

    const billPost = lastPost('/api/expenditure/bills')
    expect(billPost.body.supplier_invoice_no).toBe('INV-RST-777')
    expect(billPost.body.amount).toBe(440_000)
    expect(container.textContent).toContain('FP-202611-001')
    expect(container.textContent).toContain('Cocok')

    await click('Bayar')
    await setField('Nomor bukti transfer', 'TRF-2026-0001')
    await submitForm('expenditure-payment-form')

    const paymentPost = lastPost('/api/expenditure/payments')
    expect(paymentPost.body.amount).toBe(440_000)
    expect(paymentPost.body.reference_no).toBe('TRF-2026-0001')
    expect(container.textContent).toContain('BKK-202611-001')
    expect(container.textContent).toContain('Lunas')
  })

  it('jurnal kosong menampilkan pesan belum diposting dan contoh jurnal', async () => {
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()
    await openTab('Jurnal')
    expect(container.textContent).toContain('Belum ada jurnal pengeluaran yang diposting.')
    expect(container.textContent).toContain('Contoh jurnal pada BAB V')
    expect(container.textContent).toContain('Beban Bahan')
    expect(container.textContent).toContain('Utang Usaha')
  })

  it('pengendalian: pemasok belum terpercaya dan rekonsiliasi utang', async () => {
    suppliers = [{ ...supplier, is_trusted: 0 }]
    await act(async () => { root.render(React.createElement(ExpenditureCycleView)) })
    await flush()
    await openTab('Pengendalian')

    expect(container.textContent).toContain('Pengendalian internal pengeluaran')
    expect(container.textContent).toContain('Persetujuan pembelian')
    expect(container.textContent).toContain('belum ditandai terpercaya')
    expect(container.textContent).toContain('Rekonsiliasi catatan utang dengan laporan pemasok')

    await click('Tandai terpercaya')
    expect(container.textContent).toContain('ditandai terpercaya')

    await setField('Saldo menurut laporan pemasok (Rp)', '440000')
    await click('Simpan rekonsiliasi')
    const post = lastPost('/api/expenditure/controls')
    expect(post.body.statement_total).toBe(440_000)
    expect(post.body.kind).toBe('AP_RECONCILIATION')
  })
})
