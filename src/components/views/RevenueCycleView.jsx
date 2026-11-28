import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  Landmark,
  Pencil,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
  XCircle
} from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { ErrorNotice } from '../ui/ErrorNotice.jsx'
import { money } from '../../utils/formatters.js'
import { request } from '../../api.js'
import { CycleEmpty, CycleMetric, CycleStatus, todayISO } from './CyclePrimitives.jsx'

// Susunan tab mengikuti BAB V.pptx bagian B (Siklus Pendapatan).
const VIEWS = [
  ['summary', 'Ringkasan', BookOpen],
  ['master', 'Menu & Pelanggan', UtensilsCrossed],
  ['orders', 'Pesanan', ClipboardList],
  ['invoices', 'Faktur & Piutang', FileText],
  ['receipts', 'Kas Masuk', Banknote],
  ['journal', 'Jurnal', Landmark],
  ['controls', 'Pengendalian', ShieldCheck]
]
export const REVENUE_VIEWS = VIEWS


const MENU_CATEGORIES = [
  ['MINUMAN', 'Minuman'],
  ['MAKANAN', 'Makanan'],
  ['DESSERT', 'Dessert'],
  ['PAKET_EVENT', 'Paket Event'],
  ['MERCH', 'Merchandise']
]
const ORDER_TYPES = [
  ['DINE_IN', 'Makan di tempat'],
  ['TAKE_AWAY', 'Bawa pulang'],
  ['CATERING', 'Catering'],
  ['EVENT', 'Paket event']
]
const CUSTOMER_TYPES = [
  ['TUNAI', 'Tunai'],
  ['MEMBER', 'Member'],
  ['KORPORAT', 'Korporat']
]

// Slide 9 BAB V: empat aktivitas siklus pendapatan.
const ACTIVITY_STEPS = [
  ['Penerimaan pesanan pelanggan', 'Pesanan diterima, informasi pelanggan diperiksa, harga ditentukan, dan ketersediaan menu diperiksa.', 'PENJUALAN'],
  ['Pengiriman barang atau pemberian jasa', 'Bagian gudang/pelayanan menyiapkan dan menyajikan pesanan sesuai pesanan penjualan yang disetujui.', 'GUDANG'],
  ['Penagihan pelanggan', 'Faktur penjualan dibuat dan transaksi dicatat. Penjualan kredit menimbulkan piutang; penjualan tunai langsung menerima kas.', 'AKUNTANSI'],
  ['Penerimaan kas', 'Bagian keuangan menerima pembayaran, memverifikasi jumlahnya, dan memastikan kas disetor ke rekening kafe.', 'KEUANGAN']
]

// Slide 8: tujuan siklus pendapatan.
const REVENUE_GOALS = [
  'Pesanan pelanggan diproses secara tepat.',
  'Menu dan layanan diberikan kepada pelanggan yang benar.',
  'Penjualan dan piutang dicatat secara akurat.',
  'Penerimaan kas dicatat dan disetorkan ke bank.',
  'Risiko kesalahan penjualan, penipuan, dan piutang tidak tertagih ditekan.'
]

// Slide 10: dokumen siklus pendapatan.
const REVENUE_DOCUMENTS = [
  ['Pesanan penjualan (sales order)', 'Nomor SO otomatis per bulan beserta menu, jumlah, dan harga.'],
  ['Dokumen penyajian / surat jalan', 'Waktu penyajian dan catatan pelayanan tersimpan pada pesanan.'],
  ['Faktur penjualan', 'Nomor FJ otomatis; penjualan tunai langsung terbayar, kredit menunggu pelunasan.'],
  ['Bukti penerimaan kas', 'Nomor BKM otomatis untuk setiap penerimaan, termasuk pembayaran tunai.'],
  ['Bukti setoran bank', 'Kas di tangan disetor lewat aksi Setor Bank dengan nomor referensi.'],
  ['Kartu piutang pelanggan', 'Daftar faktur dan sisa piutang per pelanggan pada tab Faktur & Piutang.']
]

// Slide 11: pemisahan tugas siklus pendapatan.
const CONTROL_DUTIES = [
  ['Penjualan', 'Menerima pesanan, mengelola menu dan pelanggan, membatalkan pesanan.'],
  ['Gudang / Pelayanan', 'Mengonfirmasi kesiapan dan mencatat penyajian pesanan.'],
  ['Manajer', 'Menyetujui penjualan kredit sebelum faktur dibuat.'],
  ['Penagihan (Akuntansi)', 'Membuat faktur penjualan dan merekonsiliasi penerimaan kas.'],
  ['Penerimaan kas (Keuangan)', 'Menerima pembayaran dan menyetorkan kas ke rekening bank.']
]

function monthLabel(period) {
  const date = new Date(String(period || '') + '-15T12:00:00')
  return Number.isNaN(date.getTime())
    ? period || '—'
    : new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
}

function dateText(value) {
  if (!value) return '—'
  const date = new Date(String(value).slice(0, 10) + 'T12:00:00')
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function orderBadge(status) {
  if (status === 'DIFAKTURKAN') return <CycleStatus status="paid" label="Difakturkan" />
  if (status === 'DISAJIKAN') return <CycleStatus status="progress" label="Disajikan" />
  if (status === 'DITERIMA') return <CycleStatus status="hold" label="Diterima" />
  if (status === 'DIBATALKAN') return <CycleStatus status="overdue" label="Dibatalkan" />
  return <CycleStatus status="planned" label="Draft" />
}

function invoiceBadge(status) {
  if (status === 'PAID') return <CycleStatus status="paid" label="Lunas" />
  return <CycleStatus status="open" label="Belum dibayar" />
}

function depositBadge(status) {
  if (status === 'DEPOSITED') return <CycleStatus status="complete" label="Disetor" />
  return <CycleStatus status="hold" label="Belum disetor" />
}

function controlBadge(status, label) {
  if (status === 'OK') return <span className="cycle-control-badge is-ok"><CheckCircle2 size={12} /> {label || 'Sesuai'}</span>
  if (status === 'MISMATCH') return <span className="cycle-control-badge is-mismatch"><XCircle size={12} /> {label || 'Selisih'}</span>
  return <span className="cycle-control-badge is-pending">{label || 'Belum diperiksa'}</span>
}

function emptyCustomer() {
  return {
    id: null,
    customer_code: '',
    name: '',
    customer_type: 'TUNAI',
    phone: '',
    address: '',
    credit_limit: 0,
    is_active: 1
  }
}

function emptyMenu() {
  return { id: null, item_code: '', name: '', category: 'MINUMAN', unit_price: 0, is_active: 1 }
}

function emptyOrderItem() {
  return { menu_item_id: '', description: '', qty: 1, unit_price: 0 }
}

function emptyOrder() {
  return {
    order_date: todayISO(),
    customer_id: '',
    order_type: 'DINE_IN',
    payment_type: 'TUNAI',
    notes: '',
    items: [emptyOrderItem()]
  }
}

async function fetchRevenueJournals() {
  const response = await request('/api/revenue/journals')
  return Array.isArray(response?.journals) ? response.journals : []
}

function DetailRow({ label, note = '', value }) {
  return (
    <div className="cycle-breakdown-row">
      <span>{label}</span>
      <span>{note}</span>
      <strong>{money(value)}</strong>
    </div>
  )
}

function JournalList({ entries, limit }) {
  const shown = limit ? entries.slice(0, limit) : entries
  return (
    <div className="cycle-journal-list">
      {shown.map((entry) => {
        const lines = entry.lines || []
        const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
        return (
          <article className="cycle-journal-entry" key={entry.id || entry.voucher_no}>
            <div className="cycle-journal-head">
              <div>
                <strong>{entry.description || 'Jurnal siklus pendapatan'}</strong>
                <small>{entry.voucher_no} <i>·</i> {dateText(entry.entry_date)}</small>
              </div>
              <b>{money(debit)}</b>
            </div>
            <div className="cycle-journal-lines">
              {lines.map((line, index) => (
                <div key={`${entry.id || entry.voucher_no}-${index}`}>
                  <span>
                    <em>{Number(line.debit || 0) > 0 ? 'Debit' : 'Kredit'}</em>
                    {line.account_name || line.account_code || '—'}
                  </span>
                  <strong>{money(Number(line.debit || 0) || Number(line.credit || 0))}</strong>
                </div>
              ))}
              {!lines.length && <div><span>Tidak ada rincian baris.</span><strong>—</strong></div>}
            </div>
          </article>
        )
      })}
      {!shown.length && <CycleEmpty>Belum ada jurnal pendapatan yang diposting.</CycleEmpty>}
    </div>
  )
}

// Fungsi default harus stabil: efek periodik bergantung pada prop ini.
const NOOP = () => {}

export function RevenueCycleView({ notify = NOOP, user = null, view: controlledView, onViewChange = null }) {
  const [internalView, setInternalView] = useState('summary')
  // Tab bisa dikendalikan dari sidebar (AppShell); tanpa prop, tetap mandiri.
  const view = controlledView ?? internalView
  const setView = (next) => {
    setInternalView(next)
    onViewChange?.(next)
  }
  const [customers, setCustomers] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [orders, setOrders] = useState([])
  const [invoices, setInvoices] = useState([])
  const [receipts, setReceipts] = useState([])
  const [journals, setJournals] = useState([])
  const [controls, setControls] = useState([])
  const [controlSuggested, setControlSuggested] = useState({ depositedTotal: 0, outstandingTotal: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [customerModal, setCustomerModal] = useState(null)
  const [menuModal, setMenuModal] = useState(null)
  const [orderModal, setOrderModal] = useState(null)
  const [invoiceModal, setInvoiceModal] = useState(null)
  const [receiptModal, setReceiptModal] = useState(null)
  const [depositModal, setDepositModal] = useState(null)
  const [controlDraft, setControlDraft] = useState({ period: todayISO().slice(0, 7), bank_total: '', note: '' })
  const [query, setQuery] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [customerResult, menuResult, orderResult, invoiceResult, receiptResult, journalResult] =
      await Promise.allSettled([
        request('/api/revenue/customers'),
        request('/api/revenue/menu-items'),
        request('/api/revenue/orders'),
        request('/api/revenue/invoices'),
        request('/api/revenue/receipts'),
        fetchRevenueJournals()
      ])
    const failures = []
    if (customerResult.status === 'fulfilled') setCustomers(customerResult.value?.customers || [])
    else failures.push(`Data pelanggan: ${customerResult.reason?.message || 'gagal dimuat.'}`)
    if (menuResult.status === 'fulfilled') setMenuItems(menuResult.value?.menu_items || [])
    else failures.push(`Data menu: ${menuResult.reason?.message || 'gagal dimuat.'}`)
    if (orderResult.status === 'fulfilled') setOrders(orderResult.value?.orders || [])
    else failures.push(`Data pesanan: ${orderResult.reason?.message || 'gagal dimuat.'} Pastikan server Finova sudah berjalan.`)
    if (invoiceResult.status === 'fulfilled') setInvoices(invoiceResult.value?.invoices || [])
    else failures.push(`Data faktur: ${invoiceResult.reason?.message || 'gagal dimuat.'}`)
    if (receiptResult.status === 'fulfilled') setReceipts(receiptResult.value?.receipts || [])
    else failures.push(`Data penerimaan kas: ${receiptResult.reason?.message || 'gagal dimuat.'}`)
    if (journalResult.status === 'fulfilled') setJournals(journalResult.value || [])
    setLoadError(failures.join(' '))
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const month = todayISO().slice(0, 7)

  const refreshControls = useCallback(async (period) => {
    try {
      const result = await request(`/api/revenue/controls?period=${period}`)
      setControls(result?.checks || [])
      setControlSuggested({
        depositedTotal: Number(result?.suggested?.depositedTotal || 0),
        outstandingTotal: Number(result?.suggested?.outstandingTotal || 0)
      })
      const check = (result?.checks || []).find((item) => item.kind === 'CASH_RECONCILIATION')
      setControlDraft({
        period,
        bank_total: check ? String(check.actual_value) : '',
        note: check?.note || ''
      })
    } catch (err) {
      notify(err.message || 'Gagal memuat pengendalian.', true)
    }
  }, [notify])

  useEffect(() => {
    if (view === 'controls') refreshControls(controlDraft.period || month)
  }, [view, controlDraft.period, month, refreshControls])

  // Ringkasan angka bulan ini.
  const monthRevenue = invoices
    .filter((invoice) => String(invoice.invoice_date || '').slice(0, 7) === month)
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
  const outstandingTotal = invoices
    .filter((invoice) => invoice.status === 'OPEN')
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0) - Number(invoice.paid || 0), 0)
  const activeOrders = orders.filter((order) => !['DIFAKTURKAN', 'DIBATALKAN'].includes(order.status))
  const undepositedTotal = receipts
    .filter((receipt) => receipt.deposit_status !== 'DEPOSITED')
    .reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0)
  const pendingCreditOrders = orders.filter(
    (order) => order.payment_type === 'KREDIT' && order.status === 'DISAJIKAN' && !order.credit_approved_at
  )
  const openInvoices = invoices.filter((invoice) => invoice.status === 'OPEN')

  const filteredCustomers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return customers.filter((customer) => !needle || [
      customer.customer_code,
      customer.name,
      customer.phone
    ].some((value) => String(value || '').toLocaleLowerCase('id').includes(needle)))
  }, [customers, query])

  const filteredMenu = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return menuItems.filter((item) => !needle || [
      item.item_code,
      item.name,
      item.category
    ].some((value) => String(value || '').toLocaleLowerCase('id').includes(needle)))
  }, [menuItems, query])

  function refresh() {
    return loadAll()
  }

  function patchModal(setter) {
    return (key, value) => setter((current) => ({ ...current, [key]: value }))
  }

  /** Handler input teks standar: setField(setter, 'key'). */
  function setField(setter, key) {
    return (event) => setter((current) => ({ ...current, [key]: event.target.value }))
  }

  /** Handler untuk modal berbentuk { ..., draft }: perbarui field di dalam draft. */
  function setDraftField(setter, key) {
    return (event) => setter((current) => ({ ...current, draft: { ...current.draft, [key]: event.target.value } }))
  }

  async function saveCustomer(event) {
    event.preventDefault()
    const draft = customerModal
    if (!draft.customer_code.trim() || !draft.name.trim()) {
      notify('Kode dan nama pelanggan wajib diisi.', true)
      return
    }
    setBusy(true)
    try {
      const payload = {
        customer_code: draft.customer_code.trim().toUpperCase(),
        name: draft.name.trim(),
        customer_type: draft.customer_type,
        phone: draft.phone,
        address: draft.address,
        credit_limit: Number(draft.credit_limit || 0),
        is_active: Number(draft.is_active) === 1 ? 1 : 0
      }
      await request(draft.id ? `/api/revenue/customers/${draft.id}` : '/api/revenue/customers', {
        method: draft.id ? 'PUT' : 'POST',
        body: payload
      })
      notify(draft.id ? 'Data pelanggan diperbarui.' : 'Pelanggan baru berhasil ditambahkan.')
      setCustomerModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan pelanggan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveMenu(event) {
    event.preventDefault()
    const draft = menuModal
    if (!draft.item_code.trim() || !draft.name.trim()) {
      notify('Kode dan nama menu wajib diisi.', true)
      return
    }
    setBusy(true)
    try {
      const payload = {
        item_code: draft.item_code.trim().toUpperCase(),
        name: draft.name.trim(),
        category: draft.category,
        unit_price: Number(draft.unit_price || 0),
        is_active: Number(draft.is_active) === 1 ? 1 : 0
      }
      await request(draft.id ? `/api/revenue/menu-items/${draft.id}` : '/api/revenue/menu-items', {
        method: draft.id ? 'PUT' : 'POST',
        body: payload
      })
      notify(draft.id ? 'Menu diperbarui.' : 'Menu baru berhasil ditambahkan.')
      setMenuModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan menu.', true)
    } finally {
      setBusy(false)
    }
  }

  function patchOrderItem(index, key, value) {
    setOrderModal((current) => {
      const items = current.items.map((item, position) => {
        if (position !== index) return item
        const next = { ...item, [key]: value }
        if (key === 'menu_item_id' && value) {
          const menu = menuItems.find((entry) => entry.id === Number(value))
          if (menu) {
            next.description = menu.name
            next.unit_price = Number(menu.unit_price)
          }
        }
        return next
      })
      return { ...current, items }
    })
  }

  function addOrderItem() {
    setOrderModal((current) => ({ ...current, items: [...current.items, emptyOrderItem()] }))
  }

  function removeOrderItem(index) {
    setOrderModal((current) => ({
      ...current,
      items: current.items.filter((_, position) => position !== index)
    }))
  }

  const orderDraftTotal = orderModal
    ? orderModal.items.reduce(
        (sum, item) => sum + Number(item.qty || 0) * Number(item.unit_price || 0),
        0
      )
    : 0

  async function saveOrder(event) {
    event.preventDefault()
    const draft = orderModal
    if (!draft.order_date) {
      notify('Tanggal pesanan wajib diisi.', true)
      return
    }
    if (!draft.customer_id) {
      notify('Pilih pelanggan terlebih dahulu.', true)
      return
    }
    const items = draft.items
      .map((item) => ({
        menu_item_id: item.menu_item_id ? Number(item.menu_item_id) : null,
        description: item.description,
        qty: Number(item.qty || 0),
        unit_price: Number(item.unit_price || 0)
      }))
      .filter((item) => item.description.trim() && item.qty > 0)
    if (!items.length) {
      notify('Isi sedikitnya satu item pesanan.', true)
      return
    }
    setBusy(true)
    try {
      const result = await request('/api/revenue/orders', {
        method: 'POST',
        body: {
          order_date: draft.order_date,
          customer_id: Number(draft.customer_id),
          order_type: draft.order_type,
          payment_type: draft.payment_type,
          notes: draft.notes,
          items
        }
      })
      notify(`Pesanan ${result.order_no} dicatat. Total ${money(result.total)}.`)
      setOrderModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan pesanan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function orderAction(orderId, path, message, body) {
    setBusy(true)
    try {
      await request(`/api/revenue/orders/${orderId}/${path}`, { method: 'POST', body: body || {} })
      notify(message)
      setInvoiceModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function createInvoice(event) {
    event.preventDefault()
    if (!invoiceModal) return
    const draft = invoiceModal.draft
    if (!draft.invoice_date) {
      notify('Tanggal faktur wajib diisi.', true)
      return
    }
    await orderAction(
      invoiceModal.order.id,
      'invoice',
      `Faktur untuk pesanan ${invoiceModal.order.order_no} berhasil dibuat.`,
      {
        invoice_date: draft.invoice_date,
        due_date: draft.due_date,
        method: draft.method
      }
    )
  }

  async function saveReceipt(event) {
    event.preventDefault()
    if (!receiptModal) return
    const draft = receiptModal.draft
    const amount = Number(draft.amount || 0)
    if (amount <= 0) {
      notify('Jumlah penerimaan harus lebih dari nol.', true)
      return
    }
    setBusy(true)
    try {
      const result = await request('/api/revenue/receipts', {
        method: 'POST',
        body: {
          invoice_id: receiptModal.invoice.id,
          amount,
          method: draft.method,
          receipt_date: draft.receipt_date
        }
      })
      notify(`Bukti penerimaan ${result.receipt_no} dicatat. Jurnal kas dibuat otomatis.`)
      setReceiptModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal mencatat penerimaan kas.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveDeposit(event) {
    event.preventDefault()
    if (!depositModal) return
    setBusy(true)
    try {
      await request(`/api/revenue/receipts/${depositModal.receipt.id}/deposit`, {
        method: 'POST',
        body: { reference_no: depositModal.draft.reference_no }
      })
      notify('Setoran bank dicatat. Jurnal transfer kas ke bank dibuat.')
      setDepositModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal mencatat setoran bank.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveControl(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await request('/api/revenue/controls', {
        method: 'POST',
        body: {
          period: controlDraft.period,
          kind: 'CASH_RECONCILIATION',
          bank_total: Number(controlDraft.bank_total || 0),
          note: controlDraft.note
        }
      })
      if (result.status === 'OK') {
        notify('Rekonsiliasi penerimaan kas dan rekening bank sesuai.')
      } else {
        notify(`Rekonsiliasi menyatakan selisih ${money(result.difference)}. Periksa setoran dan rekening koran.`, true)
      }
      await refreshControls(controlDraft.period)
    } catch (err) {
      notify(err.message || 'Gagal menyimpan rekonsiliasi.', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="cycle-page-label">
        <span>{VIEWS.find(([key]) => key === view)?.[1]}</span>
        <span>{customers.length} pelanggan <i>·</i> {menuItems.length} menu <i>·</i> {activeOrders.length} pesanan aktif <i>·</i> {monthLabel(month)}</span>
        <span className="cycle-inline-actions">
          <Button small variant="secondary" onClick={() => setMenuModal(emptyMenu())}><UtensilsCrossed size={14} /> Tambah menu</Button>
          <Button small onClick={() => setOrderModal(emptyOrder())}><Plus size={14} /> Pesanan baru</Button>
        </span>
      </div>

      <ErrorNotice error={loadError} />
      {loading && <CycleEmpty>Memuat data siklus pendapatan dari server…</CycleEmpty>}

      {!loading && view === 'summary' && <>
        <div className="cycle-metrics">
          <CycleMetric label="Pendapatan bulan ini" value={monthRevenue} note={`Faktur ${monthLabel(month)}`} Icon={Banknote} tone="is-amber" />
          <CycleMetric label="Piutang belum tertagih" value={outstandingTotal} note={`${openInvoices.length} faktur terbuka`} Icon={FileText} tone="is-blue" />
          <CycleMetric label="Pesanan aktif" value={activeOrders.length} format="number" note={`${orders.length} pesanan tercatat`} Icon={ShoppingBag} />
          <CycleMetric label="Kas belum disetor" value={undepositedTotal} note="Kas di tangan menunggu setoran bank" Icon={Landmark} tone="is-red" />
        </div>

        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Empat aktivitas siklus pendapatan</h2><p>Alur dari pesanan pelanggan sampai penerimaan kas.</p></div><ClipboardList size={18} /></div>
            {ACTIVITY_STEPS.map(([title, note, role], index) => (
              <div className="cycle-check-row" key={title}>
                <span className="cycle-check-mark">{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{title}</strong><small>{note}</small></span>
                <span className="cycle-role-tag">{role}</span>
              </div>
            ))}
          </section>

          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Tujuan & dokumen siklus</h2><p>Tujuan siklus dan dokumen yang dibentuk otomatis dari transaksi.</p></div><BookOpen size={18} /></div>
            <ul className="cycle-goal-list">
              {REVENUE_GOALS.map((goal) => <li key={goal}>{goal}</li>)}
            </ul>
            <div className="cycle-formula"><strong>Penjualan Tunai = Kas Masuk Langsung</strong></div>
            <div className="cycle-formula"><small>Penjualan Kredit = Piutang Usaha sampai pelunasan</small></div>
            <ul className="cycle-goal-list" style={{ marginTop: 10 }}>
              {REVENUE_DOCUMENTS.map(([label, note]) => <li key={label}><strong>{label}</strong> — {note}</li>)}
            </ul>
          </section>
        </div>

        <section className="panel panel-tight cycle-recent" style={{ marginTop: 16 }}>
          <div className="cycle-table-heading"><div><h2>Pesanan terbaru</h2><p>Alur pesanan kafe maid: ditagih setelah disajikan.</p></div><Button small variant="ghost" onClick={() => setView('orders')}>Lihat semua</Button></div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Nomor</th><th>Pelanggan</th><th>Jenis</th><th>Pembayaran</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {orders.slice(0, 5).map((order) => (
                <tr key={order.id}>
                  <td><strong className="cycle-id">{order.order_no}</strong><small>{dateText(order.order_date)}</small></td>
                  <td className="cycle-party"><strong>{order.customer_name}</strong><small>{order.customer_type}</small></td>
                  <td>{ORDER_TYPES.find(([key]) => key === order.order_type)?.[1] || order.order_type}</td>
                  <td>{order.payment_type === 'KREDIT' ? 'Kredit' : 'Tunai'}</td>
                  <td className="num">{money(order.total)}</td>
                  <td>{orderBadge(order.status)}</td>
                </tr>
              ))}
              {!orders.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada pesanan. Catat pesanan pelanggan pertama untuk memulai.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section className="panel cycle-card" style={{ marginTop: 16 }}>
          <div className="cycle-card-heading"><div><h2>Jurnal pendapatan terbaru</h2><p>Jurnal faktur, penerimaan kas, dan setoran bank yang dibuat otomatis.</p></div><FileText size={18} /></div>
          <JournalList entries={journals} limit={3} />
        </section>
      </>}

      {!loading && view === 'master' && <>
        <section className="panel panel-tight cycle-table-panel" style={{ marginBottom: 16 }}>
          <div className="cycle-table-heading">
            <div><h2>Data menu kafe maid</h2><p>Harga jual menjadi dasar harga pesanan dan pendapatan.</p></div>
            <Button small onClick={() => setMenuModal(emptyMenu())}><Plus size={15} /> Tambah menu</Button>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Kode</th><th>Nama menu</th><th>Kategori</th><th className="num">Harga jual</th><th>Status</th><th /></tr></thead>
            <tbody>
              {filteredMenu.map((item) => (
                <tr key={item.id}>
                  <td><strong className="cycle-id">{item.item_code}</strong></td>
                  <td className="cycle-party"><strong>{item.name}</strong></td>
                  <td>{MENU_CATEGORIES.find(([key]) => key === item.category)?.[1] || item.category}</td>
                  <td className="num">{money(item.unit_price)}</td>
                  <td><CycleStatus status={Number(item.is_active) === 1 ? 'paid' : 'overdue'} label={Number(item.is_active) === 1 ? 'Aktif' : 'Nonaktif'} /></td>
                  <td className="cycle-action-cell">
                    <Button small variant="ghost" onClick={() => setMenuModal({ ...emptyMenu(), ...item })} aria-label={`Ubah ${item.name}`}><Pencil size={13} /> Ubah</Button>
                  </td>
                </tr>
              ))}
              {!filteredMenu.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada menu. Tambahkan menu kafe maid untuk memulai.</td></tr>}
            </tbody>
          </table></div>
        </section>

        <section className="panel panel-tight cycle-table-panel">
          <div className="cycle-table-heading">
            <div><h2>Data pelanggan</h2><p>Pelanggan member dan korporat dapat diberi limit kredit.</p></div>
            <label className="cycle-search"><span className="sr-only">Cari pelanggan atau menu</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pelanggan atau menu" /></label>
            <Button small onClick={() => setCustomerModal(emptyCustomer())}><Plus size={15} /> Tambah pelanggan</Button>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Kode</th><th>Nama</th><th>Tipe</th><th>Kontak</th><th className="num">Limit kredit</th><th>Status</th><th /></tr></thead>
            <tbody>
              {filteredCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td><strong className="cycle-id">{customer.customer_code}</strong></td>
                  <td className="cycle-party"><strong>{customer.name}</strong><small>{customer.address || 'Alamat belum diisi'}</small></td>
                  <td>{CUSTOMER_TYPES.find(([key]) => key === customer.customer_type)?.[1] || customer.customer_type}</td>
                  <td>{customer.phone || '—'}</td>
                  <td className="num">{Number(customer.credit_limit) > 0 ? money(customer.credit_limit) : '—'}</td>
                  <td><CycleStatus status={Number(customer.is_active) === 1 ? 'paid' : 'overdue'} label={Number(customer.is_active) === 1 ? 'Aktif' : 'Nonaktif'} /></td>
                  <td className="cycle-action-cell">
                    <Button small variant="ghost" onClick={() => setCustomerModal({ ...emptyCustomer(), ...customer })} aria-label={`Ubah ${customer.name}`}><Pencil size={13} /> Ubah</Button>
                  </td>
                </tr>
              ))}
              {!filteredCustomers.length && <tr><td className="cycle-empty" colSpan={7}>Belum ada pelanggan. Tambahkan member atau pelanggan korporat.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </>}

      {!loading && view === 'orders' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading">
          <div><h2>Pesanan penjualan</h2><p>Alur: dicatat → dikonfirmasi penjualan → disajikan gudang → difakturkan akuntansi.</p></div>
          <Button small onClick={() => setOrderModal(emptyOrder())}><Plus size={15} /> Pesanan baru</Button>
        </div>
        {pendingCreditOrders.length > 0 && <div className="cycle-form-hint" style={{ color: '#8a5a2b' }}>{pendingCreditOrders.length} pesanan kredit menunggu persetujuan manajer sebelum dapat difakturkan.</div>}
        <div className="cycle-table-wrap"><table className="cycle-table">
          <thead><tr><th>Nomor</th><th>Pelanggan</th><th>Jenis</th><th>Pembayaran</th><th className="num">Total</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td><strong className="cycle-id">{order.order_no}</strong><small>{dateText(order.order_date)}</small></td>
                <td className="cycle-party"><strong>{order.customer_name}</strong><small>{order.customer_type}{order.payment_type === 'KREDIT' ? (order.credit_approved_at ? ' · kredit disetujui' : ' · kredit menunggu') : ''}</small></td>
                <td>{ORDER_TYPES.find(([key]) => key === order.order_type)?.[1] || order.order_type}</td>
                <td>{order.payment_type === 'KREDIT' ? 'Kredit' : 'Tunai'}</td>
                <td className="num">{money(order.total)}</td>
                <td>{orderBadge(order.status)}</td>
                <td className="cycle-action-cell">
                  {order.status === 'DRAFT' && <>
                    <Button small disabled={busy} onClick={() => orderAction(order.id, 'confirm', `Pesanan ${order.order_no} dikonfirmasi bagian penjualan.`)}>Konfirmasi</Button>
                    <Button small variant="secondary" disabled={busy} onClick={() => { if (window.confirm(`Batalkan pesanan ${order.order_no}?`)) orderAction(order.id, 'cancel', 'Pesanan dibatalkan.') }}>Batalkan</Button>
                  </>}
                  {order.status === 'DITERIMA' && <Button small disabled={busy} onClick={() => orderAction(order.id, 'serve', `Pesanan ${order.order_no} dicatat sudah disajikan.`)}>Catat disajikan</Button>}
                  {order.status === 'DISAJIKAN' && order.payment_type === 'KREDIT' && !order.credit_approved_at && (
                    <Button small disabled={busy} title="Persetujuan manajer (peran SDM_MANAGER)" onClick={() => orderAction(order.id, 'approve-credit', `Kredit pesanan ${order.order_no} disetujui manajer.`)}>Setujui kredit</Button>
                  )}
                  {order.status === 'DISAJIKAN' && (
                    <Button small variant="secondary" disabled={busy || (order.payment_type === 'KREDIT' && !order.credit_approved_at)} onClick={() => setInvoiceModal({ order, draft: { invoice_date: todayISO(), due_date: '', method: 'BANK' } })}><FileText size={13} /> Buat faktur</Button>
                  )}
                  {['DIFAKTURKAN', 'DIBATALKAN'].includes(order.status) && <span className="muted">Selesai</span>}
                </td>
              </tr>
            ))}
            {!orders.length && <tr><td className="cycle-empty" colSpan={7}>Belum ada pesanan penjualan. Catat pesanan pertama kafe maid.</td></tr>}
          </tbody>
        </table></div>
      </section>}

      {!loading && view === 'invoices' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading">
          <div><h2>Faktur penjualan & kartu piutang</h2><p>Penjualan kredit menimbulkan piutang usaha; tunai langsung lunas.</p></div>
        </div>
        <div className="cycle-table-wrap"><table className="cycle-table">
          <thead><tr><th>Faktur</th><th>Pelanggan</th><th>Pesanan</th><th>Pembayaran</th><th className="num">Nilai</th><th className="num">Dibayar</th><th className="num">Sisa</th><th>Jatuh tempo</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td><strong className="cycle-id">{invoice.invoice_no}</strong><small>{dateText(invoice.invoice_date)}</small></td>
                <td className="cycle-party"><strong>{invoice.customer_name}</strong><small>{invoice.customer_type}</small></td>
                <td>{invoice.order_no}</td>
                <td>{invoice.payment_type === 'KREDIT' ? 'Kredit' : 'Tunai'}</td>
                <td className="num">{money(invoice.amount)}</td>
                <td className="num">{money(invoice.paid)}</td>
                <td className="num">{money(Number(invoice.amount) - Number(invoice.paid))}</td>
                <td>{dateText(invoice.due_date)}</td>
                <td>{invoiceBadge(invoice.status)}</td>
              </tr>
            ))}
            {!invoices.length && <tr><td className="cycle-empty" colSpan={9}>Belum ada faktur penjualan. Faktur dibuat dari pesanan yang sudah disajikan.</td></tr>}
          </tbody>
        </table></div>
        {openInvoices.length > 0 && <div className="cycle-footnote"><FileText size={14} /><span>Total piutang berjalan {money(outstandingTotal)} dari {openInvoices.length} faktur terbuka. Lakukan penagihan dan catat penerimaan kas pada tab Kas Masuk.</span></div>}
      </section>}

      {!loading && view === 'receipts' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading">
          <div><h2>Penerimaan kas & setoran bank</h2><p>Bukti penerimaan kas (BKM) dibuat oleh keuangan; kas di tangan disetor ke bank.</p></div>
          <Button small disabled={!openInvoices.length} onClick={() => setReceiptModal({ invoice: openInvoices[0], draft: { amount: '', method: 'BANK', receipt_date: todayISO() } })}><Plus size={15} /> Penerimaan kas</Button>
        </div>
        <div className="cycle-table-wrap"><table className="cycle-table">
          <thead><tr><th>Bukti</th><th>Faktur</th><th className="num">Jumlah</th><th>Metode</th><th>Setoran</th><th>Referensi</th><th>Tanggal</th></tr></thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td><strong className="cycle-id">{receipt.receipt_no}</strong></td>
                <td>{receipt.invoice_no}</td>
                <td className="num">{money(receipt.amount)}</td>
                <td>{receipt.method === 'KAS' ? 'Kas di tangan' : 'Transfer/QRIS'}</td>
                <td>
                  {depositBadge(receipt.deposit_status)}
                  {receipt.method === 'KAS' && receipt.deposit_status !== 'DEPOSITED' && (
                    <span className="cycle-inline-actions"><Button small variant="secondary" disabled={busy} onClick={() => setDepositModal({ receipt, draft: { reference_no: '' } })}>Setor bank</Button></span>
                  )}
                </td>
                <td>{receipt.deposit_reference || '—'}</td>
                <td>{dateText(receipt.receipt_date)}</td>
              </tr>
            ))}
            {!receipts.length && <tr><td className="cycle-empty" colSpan={7}>Belum ada penerimaan kas. Catat pelunasan faktur kredit dari bagian keuangan.</td></tr>}
          </tbody>
        </table></div>
      </section>}

      {!loading && view === 'journal' && <>
        <section className="panel cycle-card">
          <div className="cycle-card-heading"><div><h2>Jurnal siklus pendapatan</h2><p>Faktur kredit: debit Piutang; penjualan tunai: debit Kas; setoran: transfer Kas di Tangan ke Bank.</p></div><Landmark size={18} /></div>
          <JournalList entries={journals} />
        </section>
      </>}

      {!loading && view === 'controls' && <>
        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Pemisahan tugas</h2><p>Penjualan, gudang, penagihan, dan penerimaan kas dipisah.</p></div><ShieldCheck size={18} /></div>
            {CONTROL_DUTIES.map(([role, note], index) => (
              <div className="cycle-check-row" key={role}>
                <span className="cycle-check-mark">{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{role}</strong><small>{note}</small></span>
              </div>
            ))}
            <p className="cycle-form-hint">Peran diperiksa dari sesi login: penjualan (PENJUALAN), penyajian (GUDANG), persetujuan kredit (SDM_MANAGER), faktur (AKUNTANSI), kas (KEUANGAN).</p>
          </section>

          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Persetujuan penjualan kredit</h2><p>Faktur kredit hanya dibuat setelah manajer menyetujui dan limit mencukupi.</p></div><CheckCircle2 size={18} /></div>
            {pendingCreditOrders.length ? pendingCreditOrders.map((order) => (
              <div className="cycle-check-row" key={order.id}>
                <span className="cycle-check-mark">KR</span>
                <span><strong>{order.order_no} — {order.customer_name}</strong><small>Total {money(order.total)} · menunggu persetujuan manajer</small></span>
                <span className="cycle-inline-actions"><Button small disabled={busy} onClick={() => orderAction(order.id, 'approve-credit', `Kredit pesanan ${order.order_no} disetujui.`)}>Setujui</Button></span>
              </div>
            )) : <CycleEmpty>Semua pesanan kredit sudah diputuskan.</CycleEmpty>}
            <div className="cycle-formula" style={{ marginTop: 10 }}><small>Sisa limit = limit kredit pelanggan − piutang berjalan. Sistem menolak faktur kredit yang melebihi sisa limit.</small></div>
          </section>
        </div>

        <section className="panel cycle-card" style={{ marginTop: 16 }}>
          <div className="cycle-card-heading"><div><h2>Rekonsiliasi penerimaan kas dengan rekening bank</h2><p>Penerimaan kas direkonsiliasi dengan rekening bank perusahaan.</p></div><Landmark size={18} /></div>
          <div style={{ marginBottom: 10 }}>{controlBadge(controls.find((check) => check.kind === 'CASH_RECONCILIATION')?.status)}</div>
          <div className="cycle-breakdown">
            <div>
              <DetailRow label="Kas sudah disetor ke bank" note={`Bukti BKM ${monthLabel(controlDraft.period || month)}`} value={controlSuggested.depositedTotal} />
              <DetailRow label="Piutang belum tertagih" note="Seluruh faktur OPEN" value={controlSuggested.outstandingTotal} />
            </div>
            <div>
              <DetailRow label="Selisih" note="Rekening koran − setoran" value={Number(controlDraft.bank_total || 0) - controlSuggested.depositedTotal} />
            </div>
          </div>
          <form className="cycle-form" onSubmit={saveControl}>
            <div className="cycle-form-grid">
              <label className="cycle-field"><span>Periode rekonsiliasi</span><input className="input" type="month" value={controlDraft.period} onChange={(event) => setControlDraft({ ...controlDraft, period: event.target.value })} /></label>
              <label className="cycle-field"><span>Mutasi masuk rekening koran (Rp)</span><input className="input" type="number" min="0" step="0.01" disabled={busy} value={controlDraft.bank_total} onChange={(event) => setControlDraft({ ...controlDraft, bank_total: event.target.value })} /></label>
              <div className="cycle-field"><span>Petugas (dari sesi login)</span><input className="input" value={`${user?.name || '—'} · ${user?.role || '—'}`} readOnly disabled /></div>
              <label className="cycle-field cycle-field-wide"><span>Catatan rekonsiliasi</span><input className="input" disabled={busy} value={controlDraft.note} onChange={(event) => setControlDraft({ ...controlDraft, note: event.target.value })} placeholder="Nomor rekening koran / tanggal rekonsiliasi" /></label>
            </div>
            <Button type="submit" small disabled={busy} style={{ marginTop: 10 }}>Simpan rekonsiliasi</Button>
          </form>
        </section>

        <section className="panel panel-tight cycle-table-panel" style={{ marginTop: 16 }}>
          <div className="cycle-table-heading"><div><h2>Pemeriksaan terbaru</h2><p>Status rekonsiliasi kas terakhir per periode.</p></div></div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Periode</th><th>Pemeriksaan</th><th className="num">Harapan</th><th className="num">Aktual</th><th className="num">Selisih</th><th>Status</th><th>Petugas</th><th>Waktu</th></tr></thead>
            <tbody>
              {controls.map((check) => (
                <tr key={check.id}>
                  <td><strong className="cycle-id">{monthLabel(check.period)}</strong></td>
                  <td>Rekonsiliasi kas-bank</td>
                  <td className="num">{money(check.expected_value)}</td>
                  <td className="num">{money(check.actual_value)}</td>
                  <td className="num">{money(check.difference)}</td>
                  <td>{controlBadge(check.status)}</td>
                  <td>{check.operator_role || '—'}</td>
                  <td>{dateText(check.checked_at)}</td>
                </tr>
              ))}
              {!controls.length && <tr><td className="cycle-empty" colSpan={8}>Belum ada pemeriksaan rekonsiliasi kas.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </>}


      {customerModal && <Modal
        title={customerModal.id ? 'Ubah pelanggan' : 'Tambah pelanggan'}
        onClose={() => setCustomerModal(null)}
        maxWidth="680px"
        footer={<><Button variant="secondary" onClick={() => setCustomerModal(null)}>Batal</Button><Button type="submit" form="revenue-customer-form"><Plus size={15} /> Simpan pelanggan</Button></>}
      >
        <form id="revenue-customer-form" className="cycle-form" onSubmit={saveCustomer}>
          <p className="cycle-form-intro">Member kafe maid dan pelanggan korporat dapat diberi limit kredit untuk penjualan kredit.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Kode pelanggan</span><input className="input" required maxLength={30} value={customerModal.customer_code} onChange={setField(setCustomerModal, 'customer_code')} placeholder="MBR-001" /></label>
            <label className="cycle-field"><span>Nama pelanggan</span><input className="input" required maxLength={100} value={customerModal.name} onChange={setField(setCustomerModal, 'name')} placeholder="Member Mochi" /></label>
            <label className="cycle-field"><span>Tipe pelanggan</span><select className="input" value={customerModal.customer_type} onChange={setField(setCustomerModal, 'customer_type')}>{CUSTOMER_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="cycle-field"><span>Telepon</span><input className="input" value={customerModal.phone} onChange={setField(setCustomerModal, 'phone')} placeholder="0812-…" /></label>
            <label className="cycle-field"><span>Limit kredit (Rp)</span><input className="input" type="number" min="0" step="1000" value={customerModal.credit_limit} onChange={setField(setCustomerModal, 'credit_limit')} /><small>Pelanggan tunai selalu tanpa limit kredit.</small></label>
            <label className="cycle-field"><span>Status</span><select className="input" value={customerModal.is_active} onChange={(event) => patchModal(setCustomerModal)('is_active', Number(event.target.value))}><option value={1}>Aktif</option><option value={0}>Nonaktif</option></select></label>
            <label className="cycle-field cycle-field-wide"><span>Alamat</span><textarea className="input" rows="2" value={customerModal.address} onChange={setField(setCustomerModal, 'address')} /></label>
          </div>
        </form>
      </Modal>}

      {menuModal && <Modal
        title={menuModal.id ? 'Ubah menu' : 'Tambah menu'}
        onClose={() => setMenuModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setMenuModal(null)}>Batal</Button><Button type="submit" form="revenue-menu-form"><Plus size={15} /> Simpan menu</Button></>}
      >
        <form id="revenue-menu-form" className="cycle-form" onSubmit={saveMenu}>
          <p className="cycle-form-intro">Menu kafe maid: minuman, makanan, dessert, paket event, atau merchandise.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Kode menu</span><input className="input" required maxLength={30} value={menuModal.item_code} onChange={setField(setMenuModal, 'item_code')} placeholder="MN-001" /></label>
            <label className="cycle-field"><span>Nama menu</span><input className="input" required maxLength={100} value={menuModal.name} onChange={setField(setMenuModal, 'name')} placeholder="Omurice Melody" /></label>
            <label className="cycle-field"><span>Kategori</span><select className="input" value={menuModal.category} onChange={setField(setMenuModal, 'category')}>{MENU_CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="cycle-field"><span>Harga jual (Rp)</span><input className="input" type="number" min="0" step="500" value={menuModal.unit_price} onChange={setField(setMenuModal, 'unit_price')} /></label>
            <label className="cycle-field"><span>Status</span><select className="input" value={menuModal.is_active} onChange={(event) => patchModal(setMenuModal)('is_active', Number(event.target.value))}><option value={1}>Aktif</option><option value={0}>Nonaktif</option></select></label>
          </div>
        </form>
      </Modal>}

      {orderModal && <Modal
        title="Pesanan penjualan baru"
        onClose={() => setOrderModal(null)}
        maxWidth="820px"
        footer={<><Button variant="secondary" onClick={() => setOrderModal(null)}>Batal</Button><Button type="submit" form="revenue-order-form"><Plus size={15} /> Simpan pesanan</Button></>}
      >
        <form id="revenue-order-form" className="cycle-form" onSubmit={saveOrder}>
          <p className="cycle-form-intro">Pesanan dicatat sebagai draft, lalu dikonfirmasi bagian penjualan dan disajikan sebelum difakturkan.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Tanggal pesanan</span><input className="input" type="date" required value={orderModal.order_date} onChange={setField(setOrderModal, 'order_date')} /></label>
            <label className="cycle-field"><span>Pelanggan</span><select className="input" required value={orderModal.customer_id} onChange={setField(setOrderModal, 'customer_id')}><option value="">— pilih pelanggan —</option>{customers.filter((customer) => Number(customer.is_active) === 1).map((customer) => <option key={customer.id} value={customer.id}>{customer.name} ({customer.customer_type})</option>)}</select></label>
            <label className="cycle-field"><span>Jenis pesanan</span><select className="input" value={orderModal.order_type} onChange={setField(setOrderModal, 'order_type')}>{ORDER_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="cycle-field"><span>Pembayaran</span><select className="input" value={orderModal.payment_type} onChange={setField(setOrderModal, 'payment_type')}><option value="TUNAI">Tunai</option><option value="KREDIT">Kredit (butuh persetujuan manajer)</option></select></label>
            <label className="cycle-field cycle-field-wide"><span>Catatan</span><input className="input" value={orderModal.notes} onChange={setField(setOrderModal, 'notes')} placeholder="Misalnya: dekasi ulang tahun member, set boneka chibi" /></label>
          </div>
          <div className="cycle-table-heading" style={{ marginTop: 12 }}><div><h2>Item pesanan</h2><p>Pilih menu untuk mengisi nama dan harga otomatis.</p></div><Button small variant="secondary" onClick={addOrderItem}><Plus size={13} /> Tambah baris</Button></div>
          <div className="cycle-form-grid">
            {orderModal.items.map((item, index) => (
              <div className="cycle-field cycle-field-wide" key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8 }}>
                <select className="input" aria-label="Menu" value={item.menu_item_id} onChange={(event) => patchOrderItem(index, 'menu_item_id', event.target.value)}>
                  <option value="">— menu / item manual —</option>
                  {menuItems.filter((entry) => Number(entry.is_active) === 1).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} — {money(entry.unit_price)}</option>)}
                </select>
                <input className="input" aria-label="Deskripsi" placeholder="Deskripsi item" value={item.description} onChange={(event) => patchOrderItem(index, 'description', event.target.value)} />
                <input className="input" aria-label="Jumlah" type="number" min="1" step="1" value={item.qty} onChange={(event) => patchOrderItem(index, 'qty', event.target.value)} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" aria-label="Harga satuan" type="number" min="0" step="500" value={item.unit_price} onChange={(event) => patchOrderItem(index, 'unit_price', event.target.value)} />
                  {orderModal.items.length > 1 && <Button small variant="ghost" aria-label="Hapus baris" onClick={() => removeOrderItem(index)}><Trash2 size={13} /></Button>}
                </div>
              </div>
            ))}
          </div>
          <div className="cycle-form-total"><span>Total pesanan<small>Hitungan sementara sebelum disimpan</small></span><strong>{money(orderDraftTotal)}</strong></div>
        </form>
      </Modal>}

      {invoiceModal && <Modal
        title={`Buat faktur — ${invoiceModal.order.order_no}`}
        onClose={() => setInvoiceModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setInvoiceModal(null)}>Batal</Button><Button type="submit" form="revenue-invoice-form"><Plus size={15} /> Simpan faktur</Button></>}
      >
        <form id="revenue-invoice-form" className="cycle-form" onSubmit={createInvoice}>
          <p className="cycle-form-intro">
            {invoiceModal.order.payment_type === 'KREDIT'
              ? 'Faktur kredit membentuk piutang usaha. Pastikan persetujuan manajer sudah diberikan.'
              : 'Faktur tunai langsung terbayar: bukti penerimaan kas dan jurnal kas dibuat otomatis.'}
          </p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Tanggal faktur</span><input className="input" type="date" required value={invoiceModal.draft.invoice_date} onChange={setDraftField(setInvoiceModal, 'invoice_date')} /></label>
            {invoiceModal.order.payment_type === 'KREDIT' ? (
              <label className="cycle-field"><span>Jatuh tempo</span><input className="input" type="date" value={invoiceModal.draft.due_date} onChange={setDraftField(setInvoiceModal, 'due_date')} /><small>Kosongkan untuk +14 hari otomatis.</small></label>
            ) : (
              <label className="cycle-field"><span>Kas diterima lewat</span><select className="input" value={invoiceModal.draft.method} onChange={setDraftField(setInvoiceModal, 'method')}><option value="BANK">Transfer / QRIS (Kas di Bank)</option><option value="KAS">Kas di tangan</option></select></label>
            )}
            <div className="cycle-field cycle-field-wide"><span>Total faktur</span><input className="input" value={money(invoiceModal.order.total)} readOnly disabled /></div>
          </div>
        </form>
      </Modal>}

      {receiptModal && <Modal
        title={`Penerimaan kas — faktur ${receiptModal.invoice.invoice_no}`}
        onClose={() => setReceiptModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setReceiptModal(null)}>Batal</Button><Button type="submit" form="revenue-receipt-form"><Plus size={15} /> Simpan penerimaan</Button></>}
      >
        <form id="revenue-receipt-form" className="cycle-form" onSubmit={saveReceipt}>
          <p className="cycle-form-intro">Penerimaan kas dilakukan bagian keuangan. Sisa faktur {money(Number(receiptModal.invoice.amount) - Number(receiptModal.invoice.paid))}.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Faktur</span><select className="input" value={receiptModal.invoice.id} onChange={(event) => {
              const invoice = openInvoices.find((entry) => entry.id === Number(event.target.value))
              if (invoice) setReceiptModal({ invoice, draft: { ...receiptModal.draft, amount: String(Number(invoice.amount) - Number(invoice.paid)) } })
            }}>{openInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoice_no} — {invoice.customer_name} (sisa {money(Number(invoice.amount) - Number(invoice.paid))})</option>)}</select></label>
            <label className="cycle-field"><span>Tanggal penerimaan</span><input className="input" type="date" required value={receiptModal.draft.receipt_date} onChange={setDraftField(setReceiptModal, 'receipt_date')} /></label>
            <label className="cycle-field"><span>Jumlah diterima (Rp)</span><input className="input" type="number" min="1" step="0.01" required value={receiptModal.draft.amount} onChange={setDraftField(setReceiptModal, 'amount')} /></label>
            <label className="cycle-field"><span>Masuk ke</span><select className="input" value={receiptModal.draft.method} onChange={setDraftField(setReceiptModal, 'method')}><option value="BANK">Transfer / QRIS (langsung bank)</option><option value="KAS">Kas di tangan (perlu setoran)</option></select></label>
          </div>
        </form>
      </Modal>}

      {depositModal && <Modal
        title={`Setor bank — ${depositModal.receipt.receipt_no}`}
        onClose={() => setDepositModal(null)}
        maxWidth="480px"
        footer={<><Button variant="secondary" onClick={() => setDepositModal(null)}>Batal</Button><Button type="submit" form="revenue-deposit-form"><Plus size={15} /> Catat setoran</Button></>}
      >
        <form id="revenue-deposit-form" className="cycle-form" onSubmit={saveDeposit}>
          <p className="cycle-form-intro">Setoran mencatat jurnal transfer Kas di Tangan ke Kas di Bank dan menjadi bukti setoran bank.</p>
          <div className="cycle-form-grid">
            <div className="cycle-field"><span>Jumlah disetor</span><input className="input" value={money(depositModal.receipt.amount)} readOnly disabled /></div>
            <label className="cycle-field"><span>Nomor bukti setoran</span><input className="input" value={depositModal.draft.reference_no} onChange={setDraftField(setDepositModal, 'reference_no')} placeholder="STP-2026-001" /></label>
          </div>
        </form>
      </Modal>}
    </>
  )
}
