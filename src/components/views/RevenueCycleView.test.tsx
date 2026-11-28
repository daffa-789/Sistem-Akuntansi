// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RevenueCycleView, REVENUE_VIEWS } from './RevenueCycleView.jsx'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let customers: any[]
let menuItems: any[]
let orders: any[]
let invoices: any[]
let receipts: any[]
let journals: any[]
let controlsState: any[]
let posts: Array<{ url: string; body: any }>

const customer = {
  id: 1,
  customer_code: 'MBR-001',
  name: 'Member Mochi',
  customer_type: 'MEMBER',
  phone: '0812-0001',
  address: 'Bandung',
  credit_limit: 0,
  is_active: 1
}

const menuItem = {
  id: 1,
  item_code: 'MN-001',
  name: 'Omurice Melody',
  category: 'MAKANAN',
  unit_price: 45_000,
  is_active: 1
}

const draftOrder = {
  id: 1,
  order_no: 'SO-202611-001',
  order_date: '2026-11-20',
  customer_id: 1,
  customer_name: 'Member Mochi',
  customer_type: 'MEMBER',
  order_type: 'DINE_IN',
  payment_type: 'TUNAI',
  status: 'DRAFT',
  served_at: null,
  credit_approved_at: null,
  total: 90_000
}

const servedOrder = { ...draftOrder, status: 'DISAJIKAN' }

function payloadFor(url: string): any {
  if (url === '/api/company') return { company: { id: 1, name: 'Maid Caffe Finova' } }
  if (url === '/api/revenue/customers') return { customers }
  if (url === '/api/revenue/menu-items') return { menu_items: menuItems }
  if (url === '/api/revenue/orders') return { orders }
  if (url === '/api/revenue/invoices') return { invoices }
  if (url === '/api/revenue/receipts') return { receipts }
  if (url === '/api/revenue/journals') return { journals }
  if (url.startsWith('/api/revenue/controls')) {
    return {
      period: '2026-11',
      checks: controlsState,
      suggested: { depositedTotal: 500_000, outstandingTotal: 750_000 }
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

function button(label: string): HTMLButtonElement {
  const candidate = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === label)
  if (!candidate) throw new Error(`Tombol "${label}" tidak ditemukan`)
  return candidate as HTMLButtonElement
}

/** Navigasi antar bagian kini lewat sidebar; test me-render ulang dengan view terkontrol. */
async function openTab(label: string): Promise<void> {
  const entry = REVENUE_VIEWS.find(([, title]) => title === label)
  if (!entry) throw new Error(`Bagian "${label}" tidak ditemukan`)
  await act(async () => {
    root.render(React.createElement(RevenueCycleView, { view: entry[0] }))
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
  const field = fieldLabel?.querySelector('input, select, textarea') as HTMLInputElement | HTMLSelectElement | null
  if (!field) throw new Error(`Field "${label}" tidak ditemukan`)
  await act(async () => {
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
    // React memasangkan onChange <select> ke event change, input teks ke input.
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

function lastPost(urlSuffix: string): { url: string; body: any } {
  const found = [...posts].reverse().find((post) => post.url.endsWith(urlSuffix))
  if (!found) throw new Error(`Tidak ada POST ke ${urlSuffix}`)
  return found
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

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  customers = [{ ...customer }]
  menuItems = [{ ...menuItem }]
  orders = [{ ...draftOrder }]
  invoices = []
  receipts = []
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
      if (url.endsWith('/api/revenue/customers')) {
        customers = [...customers, { id: 2, is_active: 1, ...body }]
        return { ok: true, status: 201, json: async () => ({ id: 2 }) }
      }
      if (url.endsWith('/api/revenue/menu-items')) {
        menuItems = [...menuItems, { id: 2, is_active: 1, ...body }]
        return { ok: true, status: 201, json: async () => ({ id: 2 }) }
      }
      if (url.endsWith('/api/revenue/orders')) {
        orders = [{ ...draftOrder, id: 99, order_no: 'SO-202611-002', total: body.items.reduce((s: number, i: any) => s + i.qty * i.unit_price, 0) }, ...orders]
        return { ok: true, status: 201, json: async () => ({ id: 99, order_no: 'SO-202611-002', total: 90_000 }) }
      }
      if (url.endsWith('/confirm')) {
        orders = orders.map((order) => (order.status === 'DRAFT' ? { ...order, status: 'DITERIMA' } : order))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      if (url.endsWith('/serve')) {
        orders = orders.map((order) => (order.status === 'DITERIMA' ? { ...order, status: 'DISAJIKAN' } : order))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      if (url.endsWith('/approve-credit')) {
        orders = orders.map((order) => ({ ...order, credit_approved_at: '2026-11-20 10:00:00' }))
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      if (url.endsWith('/invoice')) {
        orders = orders.map((order) => ({ ...order, status: 'DIFAKTURKAN' }))
        invoices = [...invoices, { id: 5, invoice_no: 'FJ-202611-001', invoice_date: '2026-11-20', order_id: 1, order_no: 'SO-202611-001', customer_id: 1, customer_name: 'Member Mochi', customer_type: 'MEMBER', payment_type: 'TUNAI', amount: 90_000, paid: 90_000, due_date: null, status: 'PAID' }]
        return { ok: true, status: 201, json: async () => ({ ok: true, id: 5, invoice_no: 'FJ-202611-001', journalId: 3 }) }
      }
      if (url.endsWith('/api/revenue/receipts')) {
        receipts = [...receipts, { id: 7, receipt_no: 'BKM-202611-001', receipt_date: '2026-11-21', invoice_id: body.invoice_id, invoice_no: 'FJ-202611-001', amount: body.amount, method: body.method, deposit_status: body.method === 'BANK' ? 'DEPOSITED' : 'NOT_DEPOSITED', deposit_reference: null }]
        return { ok: true, status: 201, json: async () => ({ ok: true, id: 7, receipt_no: 'BKM-202611-001', journalId: 4 }) }
      }
      if (url.endsWith('/deposit')) {
        receipts = receipts.map((receipt) => ({ ...receipt, deposit_status: 'DEPOSITED', deposit_reference: body.reference_no }))
        return { ok: true, status: 200, json: async () => ({ ok: true, journalId: 5 }) }
      }
      if (url.endsWith('/api/revenue/controls')) {
        const expected = 500_000
        const actual = body.bank_total
        const difference = actual - expected
        const status = difference === 0 ? 'OK' : 'MISMATCH'
        controlsState = [{ kind: 'CASH_RECONCILIATION', period: body.period, expected_value: expected, actual_value: actual, difference, status, operator_role: 'KEUANGAN', checked_at: '2026-11-26 10:00:00', note: body.note }]
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

// Konfirmasi/penyajian tidak mengirim body; tandai order id via URL.
// Mock di atas membaca body.__orderId bila ada — cukup per baris URL.
describe('RevenueCycleView sesuai BAB V.pptx', () => {
  it('menampilkan tujuh tab, empat aktivitas, dan nama kafe maid', async () => {
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()

    expect(REVENUE_VIEWS).toHaveLength(7)
    expect(container.textContent).toContain('Empat aktivitas siklus pendapatan')
    expect(container.textContent).toContain('Penerimaan pesanan pelanggan')
    expect(container.textContent).toContain('Penerimaan kas')
    expect(container.textContent).toContain('Penjualan Tunai = Kas Masuk Langsung')
    expect(container.querySelectorAll('.cycle-metric').length).toBe(4)
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/') && !String(url).startsWith('/api/api/'))).toBe(true)
  })

  it('menambah pelanggan member lewat modal dan memuat ulang data', async () => {
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Menu & Pelanggan')
    await click('Tambah pelanggan')
    await setField('Kode pelanggan', 'MBR-002')
    await setField('Nama pelanggan', 'Member Uji')
    await setField('Tipe pelanggan', 'MEMBER')
    await setField('Limit kredit (Rp)', '1000000')
    await submitForm('revenue-customer-form')

    const post = lastPost('/api/revenue/customers')
    expect(post.body.customer_code).toBe('MBR-002')
    expect(post.body.credit_limit).toBe(1_000_000)
    expect(container.textContent).toContain('Member Uji')
  })

  it('mencatat pesanan penjualan dengan item menu dan total otomatis', async () => {
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await click('Pesanan baru')
    await setField('Tanggal pesanan', '2026-11-22')
    await setField('Pelanggan', '1')
    await setAriaField('Deskripsi', 'Parfait Momo')
    await setAriaField('Jumlah', '2')
    await setAriaField('Harga satuan', '38000')
    await submitForm('revenue-order-form')

    const post = lastPost('/api/revenue/orders')
    expect(post.body.order_date).toBe('2026-11-22')
    expect(post.body.customer_id).toBe(1)
    expect(post.body.items[0].description).toBe('Parfait Momo')
    expect(post.body.items[0].qty).toBe(2)
    expect(container.textContent).toContain('SO-202611-002')
  })

  it('alur pesanan: konfirmasi penjualan lalu catat penyajian gudang', async () => {
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Pesanan')
    await click('Konfirmasi')
    await click('Catat disajikan')

    expect(lastPost('/confirm').url).toContain('/api/revenue/orders/1/confirm')
    expect(lastPost('/serve').url).toContain('/api/revenue/orders/1/serve')
    expect(container.textContent).toContain('Disajikan')
  })

  it('membuat faktur tunai dari pesanan yang sudah disajikan', async () => {
    orders = [{ ...servedOrder }]
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Pesanan')
    await click('Buat faktur')
    await submitForm('revenue-invoice-form')

    const post = lastPost('/invoice')
    expect(post.body.method).toBe('BANK')
    await openTab('Faktur & Piutang')
    expect(container.textContent).toContain('FJ-202611-001')
    expect(container.textContent).toContain('Lunas')
  })

  it('menampilkan kartu piutang dengan sisa faktur terbuka', async () => {
    invoices = [{
      id: 5, invoice_no: 'FJ-202611-002', invoice_date: '2026-11-20', order_id: 2, order_no: 'SO-202611-002',
      customer_id: 1, customer_name: 'PT Sinar Katering', customer_type: 'KORPORAT', payment_type: 'KREDIT',
      amount: 750_000, paid: 0, due_date: '2026-12-04', status: 'OPEN'
    }]
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Faktur & Piutang')

    expect(container.textContent).toContain('kartu piutang')
    expect(container.textContent).toContain('Belum dibayar')
    expect(container.textContent).toContain('Des 2026')
    expect(container.textContent).toContain('750.000')
  })

  it('penerimaan kas dari keuangan lalu setoran bank', async () => {
    invoices = [{
      id: 5, invoice_no: 'FJ-202611-002', invoice_date: '2026-11-20', order_id: 2, order_no: 'SO-202611-002',
      customer_id: 1, customer_name: 'PT Sinar Katering', customer_type: 'KORPORAT', payment_type: 'KREDIT',
      amount: 750_000, paid: 0, due_date: '2026-12-04', status: 'OPEN'
    }]
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Kas Masuk')
    await click('Penerimaan kas')
    await setField('Jumlah diterima (Rp)', '750000')
    await setField('Masuk ke', 'KAS')
    await submitForm('revenue-receipt-form')

    const receiptPost = lastPost('/api/revenue/receipts')
    expect(receiptPost.body.amount).toBe(750_000)
    expect(receiptPost.body.method).toBe('KAS')
    expect(container.textContent).toContain('BKM-202611-001')

    await click('Setor bank')
    await setField('Nomor bukti setoran', 'STP-001')
    await submitForm('revenue-deposit-form')
    expect(lastPost('/deposit').body.reference_no).toBe('STP-001')
    expect(container.textContent).toContain('Disetor')
  })

  it('jurnal kosong menampilkan pesan belum diposting', async () => {
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Jurnal')
    expect(container.textContent).toContain('Belum ada jurnal pendapatan yang diposting.')
  })

  it('pengendalian: pemisahan tugas, rekonsiliasi kas mismatch, dan daftar persetujuan kredit', async () => {
    orders = [{ ...servedOrder, payment_type: 'KREDIT', credit_approved_at: null }]
    await act(async () => { root.render(React.createElement(RevenueCycleView)) })
    await flush()
    await openTab('Pengendalian')

    expect(container.textContent).toContain('Pemisahan tugas')
    expect(container.textContent).toContain('Persetujuan penjualan kredit')
    expect(container.textContent).toContain('menunggu persetujuan manajer')
    expect(container.textContent).toContain('Rekonsiliasi penerimaan kas dengan rekening bank')
    expect(container.textContent).toContain('Kas sudah disetor ke bank')

    await setField('Mutasi masuk rekening koran (Rp)', '400000')
    await click('Simpan rekonsiliasi')
    const post = lastPost('/api/revenue/controls')
    expect(post.body.bank_total).toBe(400_000)
    expect(container.textContent).toContain('Selisih')
  })
})
