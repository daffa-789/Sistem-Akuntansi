import React, { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, Banknote, CalendarDays,
  CheckCircle2, CircleDollarSign, Clock3, Download, FileText, Plus,
  ReceiptText, Search, WalletCards
} from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { money } from '../../utils/formatters.js'

const STORAGE_KEY = 'finova_revenue_cycle_demo_v1'
const COMPANY_NAME = 'PT Arunika Persenjataan (Fiktif)'
const SEED_INVOICES = [
  { id: 'INV-2026-001', invoiceDate: '2026-08-05', dueDate: '2026-09-04', customer: 'PT Pilar Pertahanan (Fiktif)', product: 'Perlengkapan pertahanan A-01 (dummy)', quantity: 2, unitPrice: 10000000, terms: 'CREDIT', deliveryStatus: 'DELIVERED', validationStatus: 'VERIFIED', payments: [{ date: '2026-08-25', method: 'Transfer bank', amount: 20000000 }] },
  { id: 'INV-2026-002', invoiceDate: '2026-08-19', dueDate: '2026-09-18', customer: 'CV Aruna Sarana (Fiktif)', product: 'Komponen pendukung B-02 (dummy)', quantity: 3, unitPrice: 5000000, terms: 'CREDIT', deliveryStatus: 'DELIVERED', validationStatus: 'VERIFIED', payments: [{ date: '2026-09-02', method: 'Transfer bank', amount: 10000000 }] },
  { id: 'INV-2026-003', invoiceDate: '2026-09-03', dueDate: '2026-10-03', customer: 'PT Cakrawala Logistik (Fiktif)', product: 'Perlengkapan pertahanan C-03 (dummy)', quantity: 4, unitPrice: 12500000, terms: 'CREDIT', deliveryStatus: 'DELIVERED', validationStatus: 'VERIFIED', payments: [{ date: '2026-09-22', method: 'Transfer bank', amount: 50000000 }] },
  { id: 'INV-2026-004', invoiceDate: '2026-09-11', dueDate: '2026-10-30', customer: 'PT Bina Mitra Nusantara (Fiktif)', product: 'Komponen pendukung D-04 (dummy)', quantity: 2, unitPrice: 8500000, terms: 'CREDIT', deliveryStatus: 'DELIVERED', validationStatus: 'VERIFIED', payments: [{ date: '2026-09-29', method: 'Transfer bank', amount: 7000000 }] },
  { id: 'INV-2026-005', invoiceDate: '2026-09-18', dueDate: '2026-10-18', customer: 'PT Garda Perkasa Distribusi (Fiktif)', product: 'Paket latihan E-05 (dummy)', quantity: 1, unitPrice: 32000000, terms: 'CREDIT', deliveryStatus: 'DELIVERED', validationStatus: 'VERIFIED', payments: [] },
  { id: 'INV-2026-006', invoiceDate: '2026-09-25', dueDate: '2026-09-25', customer: 'PT Nusantara Mitra Niaga (Fiktif)', product: 'Perlengkapan latihan F-06 (dummy)', quantity: 5, unitPrice: 3200000, terms: 'CASH', deliveryStatus: 'DELIVERED', validationStatus: 'VERIFIED', payments: [{ date: '2026-09-25', method: 'Transfer bank', amount: 16000000 }] }
]

const VIEWS = [
  ['summary', 'Ringkasan'],
  ['sales', 'Faktur penjualan'],
  ['receivables', 'Piutang'],
  ['journal', 'Jurnal simulasi']
]

function cloneSeed() {
  return SEED_INVOICES.map((invoice) => ({ ...invoice, payments: invoice.payments.map((payment) => ({ ...payment })) }))
}

function loadInvoices() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // Kembalikan data awal jika penyimpanan browser tidak dapat dibaca.
  }
  return cloneSeed()
}

function localDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

function addDays(dateText, days) {
  const date = new Date(dateText + 'T12:00:00')
  date.setDate(date.getDate() + days)
  return localDate(date)
}

function formatDate(dateText) {
  if (!dateText) return '—'
  const date = new Date(dateText + 'T12:00:00')
  if (Number.isNaN(date.getTime())) return dateText
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function invoiceTotal(invoice) {
  return Number(invoice.quantity || 0) * Number(invoice.unitPrice || 0)
}

function amountCollected(invoice) {
  return (invoice.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
}

function isRecognized(invoice) {
  return invoice.deliveryStatus === 'DELIVERED' && invoice.validationStatus === 'VERIFIED'
}

function outstandingAmount(invoice) {
  return isRecognized(invoice) ? Math.max(0, invoiceTotal(invoice) - amountCollected(invoice)) : 0
}

function invoiceStatus(invoice) {
  if (!isRecognized(invoice)) {
    return { key: 'held', label: invoice.deliveryStatus !== 'DELIVERED' ? 'Menunggu pengiriman' : 'Menunggu validasi' }
  }
  const balance = outstandingAmount(invoice)
  if (balance <= 0) return { key: 'paid', label: 'Lunas' }
  if (invoice.dueDate < localDate()) return { key: 'late', label: 'Terlambat' }
  if (amountCollected(invoice) > 0) return { key: 'partial', label: 'Dibayar sebagian' }
  return { key: 'open', label: 'Belum dibayar' }
}

function invoiceNumber(invoices, dateText) {
  const year = dateText.slice(0, 4)
  const numbers = invoices
    .filter((invoice) => String(invoice.id).startsWith('INV-' + year + '-'))
    .map((invoice) => Number(String(invoice.id).split('-').at(-1)) || 0)
  return 'INV-' + year + '-' + String(Math.max(0, ...numbers) + 1).padStart(3, '0')
}

function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""') + '"'
}

function downloadCsv(invoices) {
  const header = ['No Faktur', 'Tanggal', 'Jatuh Tempo', 'Pelanggan', 'Produk', 'Jumlah', 'Harga Satuan', 'Total Faktur', 'Kas Diterima', 'Piutang', 'Status']
  const rows = invoices.map((invoice) => [
    invoice.id, invoice.invoiceDate, invoice.dueDate, invoice.customer, invoice.product,
    invoice.quantity, invoice.unitPrice, invoiceTotal(invoice), amountCollected(invoice),
    outstandingAmount(invoice), invoiceStatus(invoice).label
  ])
  const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'finova-siklus-pendapatan-demo.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function StatCard({ label, value, note, Icon, tone = '' }) {
  return (
    <article className={'stat-card rev-stat ' + tone}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{money(value)}</div>
      <div className="rev-stat-note">{note}</div>
      <div className="stat-icon" aria-hidden="true"><Icon /></div>
    </article>
  )
}

function Status({ invoice }) {
  const status = invoiceStatus(invoice)
  return <span className={'rev-status rev-status-' + status.key}>{status.label}</span>
}

function InvoiceTable({ invoices, onReceive, compact = false }) {
  return (
    <div className="table-wrap rev-table-wrap">
      <table className="rev-table">
        <thead>
          <tr>
            <th>Faktur</th>
            <th>Pelanggan & barang</th>
            <th className="rev-number">Nilai</th>
            {!compact && <th className="rev-number">Diterima</th>}
            <th className="rev-number">Piutang</th>
            <th>Status</th>
            {!compact && <th aria-label="Tindakan" />}
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const balance = outstandingAmount(invoice)
            return (
              <tr key={invoice.id}>
                <td><strong className="rev-invoice-id">{invoice.id}</strong><small>{formatDate(invoice.invoiceDate)}</small></td>
                <td className="rev-party"><strong>{invoice.customer}</strong><small>{invoice.product}</small></td>
                <td className="rev-number">{money(invoiceTotal(invoice))}</td>
                {!compact && <td className="rev-number">{money(amountCollected(invoice))}</td>}
                <td className="rev-number">{money(balance)}</td>
                <td><Status invoice={invoice} /></td>
                {!compact && <td className="rev-actions-cell">{balance > 0 && <Button small variant="secondary" onClick={() => onReceive(invoice.id)}>Terima bayar</Button>}</td>}
              </tr>
            )
          })}
          {!invoices.length && <tr><td className="rev-empty" colSpan={compact ? 5 : 7}>Tidak ada transaksi yang cocok.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function JournalPreview({ invoices }) {
  const entries = []
  for (const invoice of invoices.filter(isRecognized)) {
    const total = invoiceTotal(invoice)
    const cashSale = invoice.terms === 'CASH'
    entries.push({
      date: invoice.invoiceDate,
      ref: invoice.id,
      description: 'Pengakuan penjualan — ' + invoice.customer,
      debitAccount: cashSale ? 'Kas di Bank' : 'Piutang Usaha',
      creditAccount: 'Penjualan Barang Dagang',
      amount: total
    })
    if (!cashSale) {
      for (const payment of invoice.payments || []) {
        entries.push({
          date: payment.date,
          ref: invoice.id,
          description: 'Penerimaan pembayaran pelanggan',
          debitAccount: payment.method === 'Kas' ? 'Kas' : 'Kas di Bank',
          creditAccount: 'Piutang Usaha',
          amount: Number(payment.amount || 0)
        })
      }
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref))
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0)

  return (
    <>
      <div className="rev-journal-note">
        <span className="rev-note-icon"><FileText size={17} aria-hidden="true" /></span>
        <span><strong>Jurnal simulasi</strong> — contoh ini tidak diposting ke buku besar Finova.</span>
        <span className="rev-balanced"><CheckCircle2 size={15} aria-hidden="true" /> Seimbang</span>
      </div>
      <div className="rev-journal-list">
        {entries.map((entry, index) => (
          <article className="rev-journal-entry" key={entry.ref + '-' + entry.date + '-' + index}>
            <div className="rev-journal-head">
              <div><strong>{entry.description}</strong><span>{entry.ref} <i>·</i> {formatDate(entry.date)}</span></div>
              <span className="rev-entry-amount">{money(entry.amount)}</span>
            </div>
            <div className="rev-journal-lines">
              <div><span><b>Debit</b>{entry.debitAccount}</span><strong>{money(entry.amount)}</strong></div>
              <div><span className="rev-indented"><b>Kredit</b>{entry.creditAccount}</span><strong>{money(entry.amount)}</strong></div>
            </div>
          </article>
        ))}
        {!entries.length && <div className="rev-empty-panel">Jurnal simulasi akan muncul setelah ada transaksi terkirim dan tervalidasi.</div>}
      </div>
      <div className="rev-journal-total"><span>Total debit <strong>{money(total)}</strong></span><span>Total kredit <strong>{money(total)}</strong></span></div>
    </>
  )
}

function invoiceDraft() {
  const date = localDate()
  return {
    customer: '',
    product: '',
    invoiceDate: date,
    dueDate: addDays(date, 30),
    quantity: '1',
    unitPrice: '',
    terms: 'CREDIT',
    deliveryStatus: 'DELIVERED',
    validationStatus: 'VERIFIED'
  }
}

export function RevenueCycleView({ notify = () => {} }) {
  const [invoices, setInvoices] = useState(loadInvoices)
  const [view, setView] = useState('summary')
  const [modal, setModal] = useState(null)
  const [sale, setSale] = useState(invoiceDraft)
  const [payment, setPayment] = useState({ invoiceId: '', date: localDate(), method: 'Transfer bank', amount: '' })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices))
    } catch {
      notify('Data tidak dapat disimpan di penyimpanan lokal browser.', true)
    }
  }, [invoices, notify])

  const summary = useMemo(() => {
    const eligible = invoices.filter(isRecognized)
    const revenue = eligible.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)
    const collected = eligible.reduce((sum, invoice) => sum + amountCollected(invoice), 0)
    const receivableTotal = eligible.reduce((sum, invoice) => sum + outstandingAmount(invoice), 0)
    const overdue = eligible
      .filter((invoice) => outstandingAmount(invoice) > 0 && invoice.dueDate < localDate())
      .reduce((sum, invoice) => sum + outstandingAmount(invoice), 0)
    const dueSoon = eligible
      .filter((invoice) => {
        const days = Math.ceil((new Date(invoice.dueDate + 'T12:00:00') - new Date(localDate() + 'T12:00:00')) / 86400000)
        return outstandingAmount(invoice) > 0 && days >= 0 && days <= 7
      })
      .reduce((sum, invoice) => sum + outstandingAmount(invoice), 0)
    const monthly = new Map()
    for (const invoice of eligible) {
      const month = invoice.invoiceDate.slice(0, 7)
      monthly.set(month, (monthly.get(month) || 0) + invoiceTotal(invoice))
    }
    return {
      revenue,
      collected,
      receivables: receivableTotal,
      overdue,
      dueSoon,
      held: invoices.filter((invoice) => !isRecognized(invoice)).length,
      monthly: [...monthly.entries()].sort(([a], [b]) => a.localeCompare(b))
    }
  }, [invoices])

  const filteredInvoices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return [...invoices]
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.id.localeCompare(a.id))
      .filter((invoice) => {
        const matchesText = !needle || [invoice.id, invoice.customer, invoice.product]
          .some((value) => String(value).toLocaleLowerCase('id').includes(needle))
        const matchesStatus = statusFilter === 'ALL' || invoiceStatus(invoice).key === statusFilter
        return matchesText && matchesStatus
      })
  }, [invoices, query, statusFilter])

  const receivables = useMemo(
    () => invoices.filter((invoice) => outstandingAmount(invoice) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [invoices]
  )

  function openPayment(invoiceId = '') {
    const candidate = invoices.find((invoice) => invoice.id === invoiceId && outstandingAmount(invoice) > 0)
      || invoices.find((invoice) => outstandingAmount(invoice) > 0)
    if (!candidate) {
      notify('Tidak ada piutang yang menunggu pembayaran.')
      return
    }
    setPayment({ invoiceId: candidate.id, date: localDate(), method: 'Transfer bank', amount: String(outstandingAmount(candidate)) })
    setModal('payment')
  }

  function saveSale(event) {
    event.preventDefault()
    const quantity = Number(sale.quantity)
    const unitPrice = Number(sale.unitPrice)
    const total = quantity * unitPrice
    const recognized = sale.deliveryStatus === 'DELIVERED' && sale.validationStatus === 'VERIFIED'
    if (!sale.customer.trim() || !sale.product.trim() || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(total) || total <= 0) {
      notify('Lengkapi pelanggan, produk, jumlah, dan harga dengan benar.', true)
      return
    }
    if (sale.terms === 'CREDIT' && sale.dueDate < sale.invoiceDate) {
      notify('Tanggal jatuh tempo tidak boleh mendahului tanggal faktur.', true)
      return
    }
    if (sale.terms === 'CASH' && !recognized) {
      notify('Penjualan tunai baru dapat dicatat setelah pengiriman dan validasi selesai.', true)
      return
    }
    const newInvoice = {
      id: invoiceNumber(invoices, sale.invoiceDate),
      ...sale,
      quantity,
      unitPrice,
      payments: sale.terms === 'CASH'
        ? [{ date: sale.invoiceDate, method: 'Transfer bank', amount: total }]
        : []
    }
    setInvoices((current) => [newInvoice, ...current])
    setModal(null)
    setSale(invoiceDraft())
    notify(newInvoice.id + ' berhasil dicatat' + (recognized ? '.' : ' dan ditahan sampai proses selesai.'))
  }

  function savePayment(event) {
    event.preventDefault()
    const invoice = invoices.find((item) => item.id === payment.invoiceId)
    const amount = Number(payment.amount)
    if (!invoice || payment.date < invoice.invoiceDate || amount <= 0 || amount > outstandingAmount(invoice)) {
      notify('Tanggal pembayaran harus sama dengan atau setelah tanggal faktur, dan nominal tidak boleh melebihi sisa piutang.', true)
      return
    }
    const receipt = { date: payment.date, method: payment.method, amount }
    setInvoices((current) => current.map((item) => (
      item.id === invoice.id ? { ...item, payments: [...(item.payments || []), receipt] } : item
    )))
    setModal(null)
    notify('Pembayaran ' + money(amount) + ' untuk ' + invoice.id + ' dicatat.')
  }

  const pageTitle = VIEWS.find(([key]) => key === view)?.[1] || 'Ringkasan'

  return (
    <>
      <div className="toolbar rev-toolbar">
        <div>
          <div className="eyebrow">SIKLUS PENDAPATAN <span>·</span> DATA SIMULASI</div>
          <h1 className="page-title">Penjualan sampai penerimaan kas</h1>
          <p className="page-copy">Kelola faktur, pantau piutang, dan lihat jurnal yang terbentuk untuk {COMPANY_NAME}.</p>
        </div>
        <div className="rev-toolbar-actions">
          <Button variant="secondary" onClick={() => downloadCsv(invoices)}><Download size={15} aria-hidden="true" /> Ekspor CSV</Button>
          <Button variant="secondary" onClick={() => openPayment()}><Banknote size={15} aria-hidden="true" /> Terima pembayaran</Button>
          <Button onClick={() => { setSale(invoiceDraft()); setModal('sale') }}><Plus size={16} aria-hidden="true" /> Catat penjualan</Button>
        </div>
      </div>

      <div className="rev-simulation-banner" role="note">
        <span className="rev-banner-mark"><BadgeCheck size={17} aria-hidden="true" /></span>
        <span><strong>Perusahaan dan transaksi fiktif.</strong> Validasi hanya simulasi alur internal; data demo tidak masuk ke jurnal resmi atau buku besar Finova.</span>
        <span className="rev-banner-period"><CalendarDays size={14} aria-hidden="true" /> Agustus–September 2026</span>
      </div>

      <div className="rev-tabs" role="tablist" aria-label="Bagian siklus pendapatan">
        {VIEWS.map(([key, label]) => (
          <button type="button" role="tab" aria-selected={view === key} className={view === key ? 'is-active' : ''} key={key} onClick={() => setView(key)}>
            {label}{key === 'receivables' && receivables.length > 0 && <span className="rev-tab-count">{receivables.length}</span>}
          </button>
        ))}
      </div>

      <div className="rev-page-label"><span>{pageTitle}</span><span>{invoices.length} faktur <i>·</i> Seluruh data demo</span></div>

      {view === 'summary' && (
        <>
          <div className="stats rev-stats">
            <StatCard label="Pendapatan tercatat" value={summary.revenue} note="Faktur terkirim & tervalidasi" Icon={CircleDollarSign} />
            <StatCard label="Kas diterima" value={summary.collected} note="Termasuk pelunasan piutang" Icon={WalletCards} tone="rev-stat-cash" />
            <StatCard label="Piutang aktif" value={summary.receivables} note={receivables.length + ' faktur belum lunas'} Icon={ArrowUpRight} tone="rev-stat-receivable" />
            <StatCard label="Lewat jatuh tempo" value={summary.overdue} note={summary.dueSoon ? money(summary.dueSoon) + ' segera jatuh tempo' : 'Tidak ada yang segera jatuh tempo'} Icon={AlertTriangle} tone="rev-stat-alert" />
          </div>

          <div className="grid-two rev-grid">
            <section className="panel rev-panel" aria-labelledby="rev-monthly-title">
              <div className="rev-panel-heading">
                <div><h2 className="panel-title" id="rev-monthly-title">Pendapatan per bulan</h2><p className="panel-subtitle">Diakui setelah barang terkirim dan validasi selesai.</p></div>
                <span className="rev-period-tag">2026</span>
              </div>
              {summary.monthly.length ? (
                <div className="rev-chart" role="img" aria-label="Grafik pendapatan penjualan per bulan">
                  {summary.monthly.map(([month, value]) => {
                    const max = Math.max(...summary.monthly.map((item) => item[1]), 1)
                    const label = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(month + '-15T12:00:00'))
                    return <div className="rev-chart-row" key={month}><span>{label}</span><div className="rev-bar-track"><i style={{ width: Math.max(4, (value / max) * 100) + '%' }} /></div><strong>{money(value)}</strong></div>
                  })}
                </div>
              ) : <div className="rev-empty-panel">Belum ada penjualan yang dapat diakui.</div>}
              <div className="rev-chart-foot"><span><i /> Pendapatan penjualan</span><strong>{money(summary.revenue)}</strong></div>
            </section>

            <section className="panel rev-panel rev-attention" aria-labelledby="rev-attention-title">
              <div className="rev-panel-heading">
                <div><h2 className="panel-title" id="rev-attention-title">Perlu perhatian</h2><p className="panel-subtitle">Daftar yang perlu ditindaklanjuti bagian keuangan.</p></div>
                <span className="rev-attention-icon"><Clock3 size={17} aria-hidden="true" /></span>
              </div>
              <div className="rev-attention-line"><span className="rev-attention-dot late" /><span><strong>Sudah lewat jatuh tempo</strong><small>Tagih pelanggan dengan saldo tertunda.</small></span><b>{money(summary.overdue)}</b></div>
              <div className="rev-attention-line"><span className="rev-attention-dot soon" /><span><strong>Jatuh tempo dalam 7 hari</strong><small>Siapkan pengingat pembayaran berikutnya.</small></span><b>{money(summary.dueSoon)}</b></div>
              {summary.held > 0 && <div className="rev-attention-line"><span className="rev-attention-dot held" /><span><strong>Belum diakui</strong><small>Pengiriman atau validasi masih menunggu.</small></span><b>{summary.held} faktur</b></div>}
              <div className="rev-control-note"><CheckCircle2 size={15} aria-hidden="true" /> Pembayaran piutang tidak dihitung ulang sebagai pendapatan.</div>
            </section>
          </div>

          <section className="panel panel-tight rev-recent">
            <div className="rev-table-heading"><div><h2 className="panel-title">Faktur terbaru</h2><p className="panel-subtitle">Transaksi pendapatan dalam simulasi.</p></div><Button small variant="ghost" onClick={() => setView('sales')}>Lihat semua <ArrowUpRight size={14} aria-hidden="true" /></Button></div>
            <InvoiceTable invoices={[...invoices].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate)).slice(0, 5)} onReceive={openPayment} compact />
          </section>
        </>
      )}

      {view === 'sales' && (
        <section className="panel panel-tight rev-table-panel">
          <div className="rev-table-heading">
            <div><h2 className="panel-title">Daftar faktur</h2><p className="panel-subtitle">Status mengikuti pengiriman, validasi, pembayaran, dan jatuh tempo.</p></div>
            <div className="rev-filters">
              <label className="rev-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Cari faktur</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari faktur atau pelanggan" /></label>
              <label className="sr-only" htmlFor="rev-status-filter">Filter status</label>
              <select id="rev-status-filter" className="input rev-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="ALL">Semua status</option><option value="paid">Lunas</option><option value="partial">Dibayar sebagian</option><option value="open">Belum dibayar</option><option value="late">Terlambat</option><option value="held">Menunggu proses</option>
              </select>
            </div>
          </div>
          <InvoiceTable invoices={filteredInvoices} onReceive={openPayment} />
        </section>
      )}

      {view === 'receivables' && (
        <>
          <div className="rev-aging">
            <article><span>Saldo piutang</span><strong>{money(summary.receivables)}</strong><small>Nilai faktur setelah pembayaran</small></article>
            <article className="late"><span>Lewat jatuh tempo</span><strong>{money(summary.overdue)}</strong><small>Perlu tindak lanjut penagihan</small></article>
            <article className="soon"><span>Belum jatuh tempo</span><strong>{money(Math.max(0, summary.receivables - summary.overdue))}</strong><small>Termasuk yang jatuh tempo 7 hari ke depan</small></article>
          </div>
          <section className="panel panel-tight rev-table-panel">
            <div className="rev-table-heading"><div><h2 className="panel-title">Umur piutang</h2><p className="panel-subtitle">Piutang muncul setelah transaksi terkirim dan tervalidasi.</p></div><Button small variant="secondary" onClick={() => openPayment()}><Banknote size={14} aria-hidden="true" /> Terima pembayaran</Button></div>
            <InvoiceTable invoices={receivables} onReceive={openPayment} />
          </section>
        </>
      )}

      {view === 'journal' && (
        <section className="panel rev-journal-panel">
          <div className="rev-journal-title"><div><h2 className="panel-title">Jurnal dari transaksi pendapatan</h2><p className="panel-subtitle">Debit dan kredit contoh menurut tahap penjualan.</p></div><span className="rev-sim-badge">BELUM DIPOSTING</span></div>
          <JournalPreview invoices={invoices} />
        </section>
      )}

      <div className="rev-accounting-note">
        <span><ReceiptText size={15} aria-hidden="true" /> <strong>Aturan simulasi:</strong> penjualan kredit membentuk Piutang Usaha; pembayaran mengurangi piutang. Penjualan tunai langsung menambah Kas di Bank.</span>
        <span>Belum termasuk pajak, retur, diskon, atau biaya kirim.</span>
      </div>

      {modal === 'sale' && (
        <Modal title="Catat penjualan" onClose={() => setModal(null)} maxWidth="720px" footer={<><Button variant="secondary" onClick={() => setModal(null)}>Batal</Button><Button type="submit" form="rev-sale-form"><Plus size={15} aria-hidden="true" /> Simpan faktur</Button></>}>
          <form id="rev-sale-form" className="rev-form" onSubmit={saveSale}>
            <p className="rev-form-intro">Nomor faktur dibuat otomatis. Nilai dihitung dari jumlah unit × harga satuan.</p>
            <div className="rev-form-grid">
              <label className="rev-field rev-field-wide"><span>Nama pelanggan</span><input className="input" value={sale.customer} onChange={(event) => setSale({ ...sale, customer: event.target.value })} required maxLength={100} placeholder="Contoh: PT Mitra Nusantara (Fiktif)" /></label>
              <label className="rev-field"><span>Tanggal faktur</span><input className="input" type="date" value={sale.invoiceDate} onChange={(event) => setSale({ ...sale, invoiceDate: event.target.value, dueDate: sale.terms === 'CASH' ? event.target.value : sale.dueDate })} required /></label>
              <label className="rev-field"><span>Jatuh tempo</span><input className="input" type="date" value={sale.dueDate} onChange={(event) => setSale({ ...sale, dueDate: event.target.value })} required disabled={sale.terms === 'CASH'} /></label>
              <label className="rev-field rev-field-wide"><span>Produk / jasa (simulasi)</span><input className="input" value={sale.product} onChange={(event) => setSale({ ...sale, product: event.target.value })} required maxLength={100} placeholder="Nama barang atau jasa fiktif" /></label>
              <label className="rev-field"><span>Jumlah unit</span><input className="input" type="number" min="1" step="1" value={sale.quantity} onChange={(event) => setSale({ ...sale, quantity: event.target.value })} required /></label>
              <label className="rev-field"><span>Harga satuan</span><input className="input" type="number" min="1" step="1000" value={sale.unitPrice} onChange={(event) => setSale({ ...sale, unitPrice: event.target.value })} required placeholder="Rupiah" /></label>
              <label className="rev-field"><span>Ketentuan pembayaran</span><select className="input" value={sale.terms} onChange={(event) => { const terms = event.target.value; setSale({ ...sale, terms, dueDate: terms === 'CASH' ? sale.invoiceDate : sale.dueDate }) }}><option value="CREDIT">Kredit</option><option value="CASH">Tunai / transfer</option></select></label>
              <label className="rev-field"><span>Status pengiriman</span><select className="input" value={sale.deliveryStatus} onChange={(event) => setSale({ ...sale, deliveryStatus: event.target.value })}><option value="DELIVERED">Terkirim</option><option value="PENDING">Belum dikirim</option></select></label>
              <label className="rev-field rev-field-wide"><span>Validasi pelanggan (simulasi internal)</span><select className="input" value={sale.validationStatus} onChange={(event) => setSale({ ...sale, validationStatus: event.target.value })}><option value="VERIFIED">Terverifikasi</option><option value="PENDING">Menunggu validasi</option></select></label>
            </div>
            <div className="rev-form-total"><span>Total faktur <small>sebelum pajak</small></span><strong>{money(Math.max(0, Number(sale.quantity) * Number(sale.unitPrice)))}</strong></div>
            <p className="rev-form-hint">Faktur ditahan dari pendapatan dan piutang sampai pengiriman serta validasi selesai. Data tersimpan di browser, terpisah dari buku besar.</p>
          </form>
        </Modal>
      )}

      {modal === 'payment' && (
        <Modal title="Terima pembayaran pelanggan" onClose={() => setModal(null)} maxWidth="560px" footer={<><Button variant="secondary" onClick={() => setModal(null)}>Batal</Button><Button type="submit" form="rev-payment-form"><Banknote size={15} aria-hidden="true" /> Catat pembayaran</Button></>}>
          <form id="rev-payment-form" className="rev-form" onSubmit={savePayment}>
            <p className="rev-form-intro">Pembayaran dicatat sebagai kas masuk dan pengurangan piutang, bukan pendapatan baru.</p>
            <div className="rev-form-grid">
              <label className="rev-field rev-field-wide"><span>Faktur yang dibayar</span><select className="input" value={payment.invoiceId} onChange={(event) => { const selected = invoices.find((invoice) => invoice.id === event.target.value); setPayment({ ...payment, invoiceId: event.target.value, amount: selected ? String(outstandingAmount(selected)) : '' }) }} required>{receivables.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.id} — {invoice.customer} — sisa {money(outstandingAmount(invoice))}</option>)}</select></label>
              <label className="rev-field"><span>Tanggal diterima</span><input className="input" type="date" value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} required /></label>
              <label className="rev-field"><span>Metode</span><select className="input" value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })}><option>Transfer bank</option><option>Kas</option></select></label>
              <label className="rev-field rev-field-wide"><span>Nominal pembayaran</span><input className="input" type="number" min="1" step="1000" max={outstandingAmount(invoices.find((item) => item.id === payment.invoiceId) || {})} value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} required /></label>
            </div>
            <div className="rev-form-hint rev-form-hint-strong">Nominal tidak boleh melebihi sisa piutang faktur.</div>
          </form>
        </Modal>
      )}
    </>
  )
}
