import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileText,
  Landmark,
  PackageCheck,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  XCircle
} from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { ErrorNotice } from '../ui/ErrorNotice.jsx'
import { money } from '../../utils/formatters.js'
import { request } from '../../api.js'
import { CycleEmpty, CycleMetric, CycleStatus, todayISO } from './CyclePrimitives.jsx'

// Susunan tab mengikuti BAB V.pptx bagian C (Siklus Pengeluaran).
const VIEWS = [
  ['summary', 'Ringkasan', BookOpen],
  ['suppliers', 'Pemasok', Truck],
  ['requests', 'Permintaan & PO', ClipboardList],
  ['receipts', 'Penerimaan Barang', PackageCheck],
  ['bills', 'Utang & Pembayaran', Banknote],
  ['journal', 'Jurnal', Landmark],
  ['controls', 'Pengendalian', ShieldCheck]
]
export const EXPENDITURE_VIEWS = VIEWS


const SUPPLIER_CATEGORIES = [
  ['BAHAN_BAKU', 'Bahan baku'],
  ['KOSTUM', 'Kostum & perlengkapan'],
  ['UTILITY', 'Utilitas'],
  ['JASA', 'Jasa']
]
const REQUISITION_DEPARTMENTS = [
  ['DAPUR', 'Dapur'],
  ['KAFE', 'Kafe'],
  ['KOSTUM', 'Kostum'],
  ['UMUM', 'Umum']
]

// Bagian C BAB V: lima aktivitas siklus pengeluaran.
const ACTIVITY_STEPS = [
  ['Permintaan pembelian', 'Bagian yang membutuhkan (dapur, kafe, kostum) mengajukan permintaan pembelian kepada pengadaan.', 'SEMUA BAGIAN'],
  ['Pemilihan pemasok dan pemesanan', 'Bagian pembelian membandingkan harga, kualitas, dan ketentuan, lalu menerbitkan pesanan pembelian.', 'PEMBELIAN'],
  ['Penerimaan barang atau jasa', 'Bagian gudang memeriksa jumlah dan kondisi barang, lalu membuat laporan penerimaan barang.', 'GUDANG'],
  ['Pencatatan faktur dan utang', 'Akuntansi mencocokkan PO, laporan penerimaan, dan faktur pemasok sebelum mencatat utang usaha.', 'AKUNTANSI'],
  ['Pembayaran kepada pemasok', 'Keuangan membayar tagihan yang telah diverifikasi dan mencatat pengurangan kas dan utang.', 'KEUANGAN']
]

// Bagian C BAB V: tujuan siklus pengeluaran.
const EXPENDITURE_GOALS = [
  'Barang dan jasa yang dibeli sesuai kebutuhan kafe maid.',
  'Barang diperoleh dengan harga dan kualitas yang sesuai.',
  'Setiap pembelian mendapat persetujuan manajer.',
  'Utang usaha dan pembayaran dicatat secara akurat.',
  'Kas kafe digunakan secara tepat.',
  'Pembayaran ganda atau atas barang yang tidak diterima dihindari.'
]

// Bagian C BAB V: dokumen siklus pengeluaran.
const EXPENDITURE_DOCUMENTS = [
  ['Surat permintaan pembelian', 'Nomor PR otomatis beserta estimasi harga per item.'],
  ['Pesanan pembelian (PO)', 'Nomor PO otomatis kepada pemasok terpilih.'],
  ['Laporan penerimaan barang', 'Nomor LPB otomatis; jumlah diterima dan kondisi barang.'],
  ['Faktur pemasok', 'Nomor faktur pemasok dicatat pada kartu utang FP.'],
  ['Bukti kas keluar', 'Nomor BKK otomatis untuk setiap pembayaran pemasok.'],
  ['Bukti transfer / pembayaran', 'Nomor referensi transfer tersimpan pada pembayaran.'],
  ['Catatan utang usaha', 'Daftar faktur dan sisa utang per pemasok pada tab Utang & Pembayaran.']
]

// Pengendalian internal siklus pengeluaran (bagian C BAB V).
const CONTROL_DUTIES = [
  ['Persetujuan pembelian', 'Permintaan pembelian disetujui manajer sebelum dipesan.'],
  ['Pemasok terpercaya', 'Pembelian memilih pemasok yang dapat dipercaya; sistem menandai pemasok non-terpercaya.'],
  ['Pemeriksaan barang', 'Gudang memeriksa jumlah dan kondisi barang sebelum PO diselesaikan.'],
  ['Pencocokan dokumen', 'Faktur pemasok wajib cocok dengan PO dan laporan penerimaan (three-way match).'],
  ['Pembatasan akses kas', 'Pembayaran hanya oleh keuangan dengan faktur yang sudah MATCHED.'],
  ['Rekonsiliasi utang', 'Catatan utang direkonsiliasi dengan laporan pemasok.']
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

function requisitionBadge(status) {
  if (status === 'APPROVED') return <CycleStatus status="complete" label="Disetujui" />
  if (status === 'REJECTED') return <CycleStatus status="overdue" label="Ditolak" />
  return <CycleStatus status="planned" label="Menunggu" />
}

function poBadge(status) {
  if (status === 'SELESAI') return <CycleStatus status="complete" label="Diterima" />
  if (status === 'DIKIRIM') return <CycleStatus status="progress" label="Dikirim" />
  if (status === 'DIBATALKAN') return <CycleStatus status="overdue" label="Dibatalkan" />
  return <CycleStatus status="planned" label="Draft" />
}

function matchBadge(status) {
  if (status === 'MATCHED') return <span className="cycle-control-badge is-ok"><CheckCircle2 size={12} /> Cocok</span>
  if (status === 'MISMATCH') return <span className="cycle-control-badge is-mismatch"><XCircle size={12} /> Selisih</span>
  return <span className="cycle-control-badge is-pending">Menunggu</span>
}

function billBadge(status) {
  if (status === 'PAID') return <CycleStatus status="paid" label="Lunas" />
  return <CycleStatus status="open" label="Belum dibayar" />
}

function controlBadge(status, label) {
  if (status === 'OK') return <span className="cycle-control-badge is-ok"><CheckCircle2 size={12} /> {label || 'Sesuai'}</span>
  if (status === 'MISMATCH') return <span className="cycle-control-badge is-mismatch"><XCircle size={12} /> {label || 'Selisih'}</span>
  return <span className="cycle-control-badge is-pending">{label || 'Belum diperiksa'}</span>
}

function trustedBadge(isTrusted) {
  if (Number(isTrusted) === 1) return <span className="cycle-control-badge is-ok"><CheckCircle2 size={12} /> Terpercaya</span>
  return <span className="cycle-control-badge is-pending">Belum terpercaya</span>
}

function emptySupplier() {
  return { id: null, supplier_code: '', name: '', category: 'BAHAN_BAKU', phone: '', address: '', is_trusted: 0, is_active: 1 }
}

function emptyRequisitionItem() {
  return { description: '', qty: 1, unit_price: 0 }
}

function emptyRequisition() {
  return {
    requisition_date: todayISO(),
    department: 'DAPUR',
    requested_by: '',
    reason: '',
    items: [emptyRequisitionItem()]
  }
}

function emptyPo() {
  return {
    order_date: todayISO(),
    requisition_id: '',
    supplier_id: '',
    notes: '',
    items: [emptyRequisitionItem()]
  }
}

async function fetchExpenditureJournals() {
  const response = await request('/api/expenditure/journals')
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
                <strong>{entry.description || 'Jurnal siklus pengeluaran'}</strong>
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
      {!shown.length && <CycleEmpty>Belum ada jurnal pengeluaran yang diposting.</CycleEmpty>}
    </div>
  )
}

// Fungsi default harus stabil: efek periodik bergantung pada prop ini.
const NOOP = () => {}

export function ExpenditureCycleView({ notify = NOOP, user = null, view: controlledView, onViewChange = null }) {
  const [internalView, setInternalView] = useState('summary')
  // Tab bisa dikendalikan dari sidebar (AppShell); tanpa prop, tetap mandiri.
  const view = controlledView ?? internalView
  const setView = (next) => {
    setInternalView(next)
    onViewChange?.(next)
  }
  const [suppliers, setSuppliers] = useState([])
  const [requisitions, setRequisitions] = useState([])
  const [orders, setOrders] = useState([])
  const [goodsReceipts, setGoodsReceipts] = useState([])
  const [bills, setBills] = useState([])
  const [payments, setPayments] = useState([])
  const [journals, setJournals] = useState([])
  const [controls, setControls] = useState([])
  const [controlSuggested, setControlSuggested] = useState({ payableTotal: 0, untrustedSuppliers: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [supplierModal, setSupplierModal] = useState(null)
  const [requisitionModal, setRequisitionModal] = useState(null)
  const [poModal, setPoModal] = useState(null)
  const [goodsReceiptModal, setGoodsReceiptModal] = useState(null)
  const [billModal, setBillModal] = useState(null)
  const [paymentModal, setPaymentModal] = useState(null)
  const [controlDraft, setControlDraft] = useState({ period: todayISO().slice(0, 7), statement_total: '', note: '' })
  const [query, setQuery] = useState('')

  const month = todayISO().slice(0, 7)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [supplierResult, requisitionResult, orderResult, receiptResult, billResult, paymentResult, journalResult] =
      await Promise.allSettled([
        request('/api/expenditure/suppliers'),
        request('/api/expenditure/requisitions'),
        request('/api/expenditure/orders'),
        request('/api/expenditure/receipts'),
        request('/api/expenditure/bills'),
        request('/api/expenditure/payments'),
        fetchExpenditureJournals()
      ])
    const failures = []
    if (supplierResult.status === 'fulfilled') setSuppliers(supplierResult.value?.suppliers || [])
    else failures.push(`Data pemasok: ${supplierResult.reason?.message || 'gagal dimuat.'} Pastikan server Finova sudah berjalan.`)
    if (requisitionResult.status === 'fulfilled') setRequisitions(requisitionResult.value?.requisitions || [])
    else failures.push(`Data permintaan pembelian: ${requisitionResult.reason?.message || 'gagal dimuat.'}`)
    if (orderResult.status === 'fulfilled') setOrders(orderResult.value?.orders || [])
    else failures.push(`Data pesanan pembelian: ${orderResult.reason?.message || 'gagal dimuat.'}`)
    if (receiptResult.status === 'fulfilled') setGoodsReceipts(receiptResult.value?.receipts || [])
    else failures.push(`Data penerimaan barang: ${receiptResult.reason?.message || 'gagal dimuat.'}`)
    if (billResult.status === 'fulfilled') setBills(billResult.value?.bills || [])
    else failures.push(`Data utang pemasok: ${billResult.reason?.message || 'gagal dimuat.'}`)
    if (paymentResult.status === 'fulfilled') setPayments(paymentResult.value?.payments || [])
    else failures.push(`Data pembayaran pemasok: ${paymentResult.reason?.message || 'gagal dimuat.'}`)
    if (journalResult.status === 'fulfilled') setJournals(journalResult.value || [])
    setLoadError(failures.join(' '))
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const refreshControls = useCallback(async (period) => {
    try {
      const result = await request(`/api/expenditure/controls?period=${period}`)
      setControls(result?.checks || [])
      setControlSuggested({
        payableTotal: Number(result?.suggested?.payableTotal || 0),
        untrustedSuppliers: Number(result?.suggested?.untrustedSuppliers || 0)
      })
      const check = (result?.checks || []).find((item) => item.kind === 'AP_RECONCILIATION')
      setControlDraft({
        period,
        statement_total: check ? String(check.actual_value) : '',
        note: check?.note || ''
      })
    } catch (err) {
      notify(err.message || 'Gagal memuat pengendalian.', true)
    }
  }, [notify])

  useEffect(() => {
    if (view === 'controls') refreshControls(controlDraft.period || month)
  }, [view, controlDraft.period, month, refreshControls])

  // Ringkasan.
  const payableTotal = bills
    .filter((bill) => bill.status === 'OPEN')
    .reduce((sum, bill) => sum + Number(bill.amount || 0) - Number(bill.paid || 0), 0)
  const monthPayments = payments
    .filter((payment) => String(payment.payment_date || '').slice(0, 7) === month)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const openOrders = orders.filter((order) => ['DRAFT', 'DIKIRIM'].includes(order.status))
  const pendingRequisitions = requisitions.filter((requisition) => requisition.status === 'DRAFT')
  const monthReceiptValue = goodsReceipts
    .filter((receipt) => String(receipt.receipt_date || '').slice(0, 7) === month)
    .reduce((sum, receipt) => sum + Number(receipt.accepted_total || 0), 0)
  const openBills = bills.filter((bill) => bill.status === 'OPEN' && bill.match_status === 'MATCHED')
  const untrustedSuppliers = suppliers.filter((supplier) => Number(supplier.is_trusted) !== 1 && Number(supplier.is_active) === 1)

  const approvedRequisitions = requisitions.filter((requisition) => requisition.status === 'APPROVED')
  const sentOrders = orders.filter((order) => order.status === 'DIKIRIM')
  // PO yang barangnya sudah diterima tetapi utangnya belum dicatat.
  const eligibleBillOrders = orders.filter(
    (order) => order.status === 'SELESAI' && !bills.some((bill) => bill.order_id === order.id)
  )

  const filteredSuppliers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return suppliers.filter((supplier) => !needle || [
      supplier.supplier_code,
      supplier.name,
      supplier.category
    ].some((value) => String(value || '').toLocaleLowerCase('id').includes(needle)))
  }, [suppliers, query])

  function refresh() {
    return loadAll()
  }

  function setField(setter, key) {
    return (event) => setter((current) => ({ ...current, [key]: event.target.value }))
  }

  /** Handler untuk modal berbentuk { ..., draft }: perbarui field di dalam draft. */
  function setDraftField(setter, key) {
    return (event) => setter((current) => ({ ...current, draft: { ...current.draft, [key]: event.target.value } }))
  }

  function setNumberField(setter, key) {
    return (event) => setter((current) => ({ ...current, [key]: Number(event.target.value || 0) }))
  }

  function patchRequisitionItem(index, key, value) {
    setRequisitionModal((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, [key]: value } : item))
    }))
  }

  function patchPoItem(index, key, value) {
    setPoModal((current) => ({
      ...current,
      items: current.items.map((item, position) => (position === index ? { ...item, [key]: value } : item))
    }))
  }

  function addRequisitionItem(setter) {
    setter((current) => ({ ...current, items: [...current.items, emptyRequisitionItem()] }))
  }

  function removeRequisitionItem(setter, index) {
    setter((current) => ({ ...current, items: current.items.filter((_, position) => position !== index) }))
  }

  const requisitionDraftTotal = requisitionModal
    ? requisitionModal.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unit_price || 0), 0)
    : 0
  const poDraftTotal = poModal
    ? poModal.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unit_price || 0), 0)
    : 0

  async function saveSupplier(event) {
    event.preventDefault()
    const draft = supplierModal
    if (!draft.supplier_code.trim() || !draft.name.trim()) {
      notify('Kode dan nama pemasok wajib diisi.', true)
      return
    }
    setBusy(true)
    try {
      const payload = {
        supplier_code: draft.supplier_code.trim().toUpperCase(),
        name: draft.name.trim(),
        category: draft.category,
        phone: draft.phone,
        address: draft.address,
        is_trusted: Number(draft.is_trusted) === 1 ? 1 : 0,
        is_active: Number(draft.is_active) === 1 ? 1 : 0
      }
      await request(draft.id ? `/api/expenditure/suppliers/${draft.id}` : '/api/expenditure/suppliers', {
        method: draft.id ? 'PUT' : 'POST',
        body: payload
      })
      notify(draft.id ? 'Data pemasok diperbarui.' : 'Pemasok baru berhasil ditambahkan.')
      setSupplierModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan pemasok.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveRequisition(event) {
    event.preventDefault()
    const draft = requisitionModal
    const items = draft.items
      .map((item) => ({ description: item.description, qty: Number(item.qty || 0), unit_price: Number(item.unit_price || 0) }))
      .filter((item) => item.description.trim() && item.qty > 0)
    if (!items.length) {
      notify('Isi sedikitnya satu item permintaan.', true)
      return
    }
    setBusy(true)
    try {
      const result = await request('/api/expenditure/requisitions', {
        method: 'POST',
        body: {
          requisition_date: draft.requisition_date,
          department: draft.department,
          requested_by: draft.requested_by || user?.name || '',
          reason: draft.reason,
          items
        }
      })
      notify(`Permintaan ${result.requisition_no} diajukan. Menunggu persetujuan manajer.`)
      setRequisitionModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal mengajukan permintaan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function decideRequisition(id, decision) {
    setBusy(true)
    try {
      await request(`/api/expenditure/requisitions/${id}/decide`, {
        method: 'POST',
        body: { decision, note: decision === 'APPROVED' ? 'Disetujui sesuai anggaran kafe.' : 'Ditolak oleh manajer.' }
      })
      notify(decision === 'APPROVED' ? 'Permintaan pembelian disetujui manajer.' : 'Permintaan pembelian ditolak.')
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal memproses persetujuan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function savePo(event) {
    event.preventDefault()
    const draft = poModal
    if (!draft.requisition_id) {
      notify('Pilih permintaan pembelian yang sudah disetujui.', true)
      return
    }
    if (!draft.supplier_id) {
      notify('Pilih pemasok terlebih dahulu.', true)
      return
    }
    const items = draft.items
      .map((item) => ({ description: item.description, qty: Number(item.qty || 0), unit_price: Number(item.unit_price || 0) }))
      .filter((item) => item.description.trim() && item.qty > 0)
    if (!items.length) {
      notify('Isi sedikitnya satu item pesanan pembelian.', true)
      return
    }
    setBusy(true)
    try {
      const result = await request('/api/expenditure/orders', {
        method: 'POST',
        body: {
          order_date: draft.order_date,
          requisition_id: Number(draft.requisition_id),
          supplier_id: Number(draft.supplier_id),
          notes: draft.notes,
          items
        }
      })
      notify(`Pesanan pembelian ${result.order_no} dicatat dengan total ${money(result.total)}.`)
      if (Array.isArray(result?.warnings) && result.warnings.length) {
        notify(result.warnings.join(' '), true)
      }
      setPoModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan pesanan pembelian.', true)
    } finally {
      setBusy(false)
    }
  }

  async function poAction(orderId, path, message) {
    setBusy(true)
    try {
      await request(`/api/expenditure/orders/${orderId}/${path}`, { method: 'POST' })
      notify(message)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveGoodsReceipt(event) {
    event.preventDefault()
    if (!goodsReceiptModal) return
    const draft = goodsReceiptModal.draft
    const accepted = Number(draft.accepted_total || 0)
    if (accepted <= 0) {
      notify('Nilai barang diterima harus lebih dari nol.', true)
      return
    }
    setBusy(true)
    try {
      const result = await request(`/api/expenditure/orders/${goodsReceiptModal.order.id}/receipt`, {
        method: 'POST',
        body: {
          receipt_date: draft.receipt_date,
          accepted_total: accepted,
          condition_note: draft.condition_note,
          checked_by: draft.checked_by
        }
      })
      notify(`Laporan penerimaan ${result.receipt_no} tersimpan. PO siap dicatat utangnya.`)
      setGoodsReceiptModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal mencatat penerimaan barang.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveBill(event) {
    event.preventDefault()
    if (!billModal) return
    const draft = billModal.draft
    setBusy(true)
    try {
      const result = await request('/api/expenditure/bills', {
        method: 'POST',
        body: {
          order_id: billModal.order.id,
          bill_date: draft.bill_date,
          supplier_invoice_no: draft.supplier_invoice_no,
          amount: Number(draft.amount || 0)
        }
      })
      notify(`Utang ${result.bill_no} dicatat. Jurnal beban dan utang usaha dibuat.`)
      setBillModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal mencatat faktur pemasok.', true)
    } finally {
      setBusy(false)
    }
  }

  async function savePayment(event) {
    event.preventDefault()
    if (!paymentModal) return
    const draft = paymentModal.draft
    const amount = Number(draft.amount || 0)
    if (amount <= 0) {
      notify('Jumlah pembayaran harus lebih dari nol.', true)
      return
    }
    setBusy(true)
    try {
      const result = await request('/api/expenditure/payments', {
        method: 'POST',
        body: {
          bill_id: paymentModal.bill.id,
          amount,
          method: draft.method,
          reference_no: draft.reference_no,
          payment_date: draft.payment_date
        }
      })
      notify(`Bukti kas keluar ${result.payment_no} tercatat. Jurnal pembayaran dibuat.`)
      setPaymentModal(null)
      await refresh()
    } catch (err) {
      notify(err.message || 'Gagal mencatat pembayaran pemasok.', true)
    } finally {
      setBusy(false)
    }
  }

  async function saveControl(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await request('/api/expenditure/controls', {
        method: 'POST',
        body: {
          period: controlDraft.period,
          kind: 'AP_RECONCILIATION',
          statement_total: Number(controlDraft.statement_total || 0),
          note: controlDraft.note
        }
      })
      if (result.status === 'OK') {
        notify('Rekonsiliasi catatan utang dan laporan pemasok sesuai.')
      } else {
        notify(`Rekonsiliasi menyatakan selisih ${money(result.difference)}. Cocokkan dengan laporan pemasok.`, true)
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
        <span>{suppliers.length} pemasok <i>·</i> {requisitions.length} permintaan <i>·</i> {openOrders.length} PO aktif <i>·</i> {monthLabel(month)}</span>
        <span className="cycle-inline-actions">
          <Button small variant="secondary" onClick={() => setSupplierModal(emptySupplier())}><Truck size={14} /> Tambah pemasok</Button>
          <Button small onClick={() => setRequisitionModal(emptyRequisition())}><Plus size={14} /> Permintaan pembelian</Button>
        </span>
      </div>

      <ErrorNotice error={loadError} />
      {loading && <CycleEmpty>Memuat data siklus pengeluaran dari server…</CycleEmpty>}

      {!loading && view === 'summary' && <>
        <div className="cycle-metrics">
          <CycleMetric label="Utang usaha belum dibayar" value={payableTotal} note={`${bills.filter((bill) => bill.status === 'OPEN').length} faktur terbuka`} Icon={Banknote} tone="is-red" />
          <CycleMetric label="Pembayaran bulan ini" value={monthPayments} note={`Bukti kas keluar ${monthLabel(month)}`} Icon={Landmark} tone="is-amber" />
          <CycleMetric label="PO aktif" value={openOrders.length} format="number" note={`${orders.length} PO tercatat`} Icon={ClipboardList} />
          <CycleMetric label="Nilai barang diterima" value={monthReceiptValue} note={`Laporan penerimaan ${monthLabel(month)}`} Icon={PackageCheck} tone="is-blue" />
        </div>

        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Lima aktivitas siklus pengeluaran</h2><p>Alur dari permintaan pembelian sampai pembayaran pemasok.</p></div><ClipboardList size={18} /></div>
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
              {EXPENDITURE_GOALS.map((goal) => <li key={goal}>{goal}</li>)}
            </ul>
            <div className="cycle-formula"><strong>Total Biaya Pembelian = Bahan Baku + Perlengkapan + Jasa</strong></div>
            <div className="cycle-formula"><small>Pencocokan tiga arah: PO = laporan penerimaan barang = faktur pemasok</small></div>
            <ul className="cycle-goal-list" style={{ marginTop: 10 }}>
              {EXPENDITURE_DOCUMENTS.map(([label, note]) => <li key={label}><strong>{label}</strong> — {note}</li>)}
            </ul>
          </section>
        </div>

        <section className="panel panel-tight cycle-recent" style={{ marginTop: 16 }}>
          <div className="cycle-table-heading"><div><h2>Pesanan pembelian terbaru</h2><p>PO kepada pemasok kopi, bahan kue, dan kostum maid.</p></div><Button small variant="ghost" onClick={() => setView('requests')}>Lihat semua</Button></div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Nomor</th><th>Pemasok</th><th>Permintaan</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {orders.slice(0, 5).map((order) => (
                <tr key={order.id}>
                  <td><strong className="cycle-id">{order.order_no}</strong><small>{dateText(order.order_date)}</small></td>
                  <td className="cycle-party"><strong>{order.supplier_name}</strong><small>{order.supplier_category}</small></td>
                  <td>{order.requisition_no}</td>
                  <td className="num">{money(order.total)}</td>
                  <td>{poBadge(order.status)}</td>
                </tr>
              ))}
              {!orders.length && <tr><td className="cycle-empty" colSpan={5}>Belum ada pesanan pembelian.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section className="panel cycle-card" style={{ marginTop: 16 }}>
          <div className="cycle-card-heading"><div><h2>Jurnal pengeluaran terbaru</h2><p>Jurnal utang pemasok dan pembayaran yang dibuat otomatis.</p></div><FileText size={18} /></div>
          <JournalList entries={journals} limit={3} />
        </section>
      </>}

      {!loading && view === 'suppliers' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading">
          <div><h2>Data pemasok kafe maid</h2><p>Roastery kopi, toko bahan kue, atelier kostum maid, dan utilitas.</p></div>
          <label className="cycle-search"><span className="sr-only">Cari pemasok</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kode, nama, atau kategori" /></label>
          <Button small onClick={() => setSupplierModal(emptySupplier())}><Plus size={15} /> Tambah pemasok</Button>
        </div>
        {untrustedSuppliers.length > 0 && <div className="cycle-form-hint" style={{ color: '#8a5a2b' }}>{untrustedSuppliers.length} pemasok belum ditandai terpercaya; pengendalian internal menyarankan pemilihan pemasok yang dapat dipercaya.</div>}
        <div className="cycle-table-wrap"><table className="cycle-table">
          <thead><tr><th>Kode</th><th>Nama</th><th>Kategori</th><th>Kontak</th><th>Kepercayaan</th><th>Status</th><th /></tr></thead>
          <tbody>
            {filteredSuppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td><strong className="cycle-id">{supplier.supplier_code}</strong></td>
                <td className="cycle-party"><strong>{supplier.name}</strong><small>{supplier.address || 'Alamat belum diisi'}</small></td>
                <td>{SUPPLIER_CATEGORIES.find(([key]) => key === supplier.category)?.[1] || supplier.category}</td>
                <td>{supplier.phone || '—'}</td>
                <td>{trustedBadge(supplier.is_trusted)}</td>
                <td><CycleStatus status={Number(supplier.is_active) === 1 ? 'paid' : 'overdue'} label={Number(supplier.is_active) === 1 ? 'Aktif' : 'Nonaktif'} /></td>
                <td className="cycle-action-cell">
                  <Button small variant="ghost" onClick={() => setSupplierModal({ ...emptySupplier(), ...supplier })} aria-label={`Ubah ${supplier.name}`}><Pencil size={13} /> Ubah</Button>
                </td>
              </tr>
            ))}
            {!filteredSuppliers.length && <tr><td className="cycle-empty" colSpan={7}>Belum ada pemasok. Tambahkan pemasok bahan dan kostum kafe maid.</td></tr>}
          </tbody>
        </table></div>
      </section>}

      {!loading && view === 'requests' && <>
        <section className="panel panel-tight cycle-table-panel" style={{ marginBottom: 16 }}>
          <div className="cycle-table-heading">
            <div><h2>Surat permintaan pembelian</h2><p>Diajukan bagian yang membutuhkan; disetujui manajer sebelum dipesan.</p></div>
            <Button small onClick={() => setRequisitionModal(emptyRequisition())}><Plus size={15} /> Permintaan baru</Button>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Nomor</th><th>Bagian</th><th>Pengusul</th><th className="num">Estimasi</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {requisitions.map((requisition) => (
                <tr key={requisition.id}>
                  <td><strong className="cycle-id">{requisition.requisition_no}</strong><small>{dateText(requisition.requisition_date)}</small></td>
                  <td className="cycle-party"><strong>{REQUISITION_DEPARTMENTS.find(([key]) => key === requisition.department)?.[1] || requisition.department}</strong><small>{requisition.reason || 'Tanpa alasan'}</small></td>
                  <td>{requisition.requested_by || '—'}</td>
                  <td className="num">{money(requisition.estimated_total)}</td>
                  <td>{requisitionBadge(requisition.status)}</td>
                  <td className="cycle-action-cell">
                    {requisition.status === 'DRAFT' && <>
                      <Button small disabled={busy} title="Persetujuan manajer (peran SDM_MANAGER)" onClick={() => decideRequisition(requisition.id, 'APPROVED')}>Setujui</Button>
                      <Button small variant="secondary" disabled={busy} onClick={() => decideRequisition(requisition.id, 'REJECTED')}>Tolak</Button>
                    </>}
                    {requisition.status !== 'DRAFT' && <span className="muted">{requisition.status === 'APPROVED' ? 'Selesai' : 'Diputuskan'}</span>}
                  </td>
                </tr>
              ))}
              {!requisitions.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada permintaan pembelian.</td></tr>}
            </tbody>
          </table></div>
        </section>

        <section className="panel panel-tight cycle-table-panel">
          <div className="cycle-table-heading">
            <div><h2>Pesanan pembelian (PO)</h2><p>Diterbitkan bagian pembelian dari permintaan yang disetujui.</p></div>
            <Button small disabled={!approvedRequisitions.length} onClick={() => setPoModal(emptyPo())}><Plus size={15} /> Pesanan pembelian</Button>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Nomor</th><th>Pemasok</th><th>Permintaan</th><th className="num">Total</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><strong className="cycle-id">{order.order_no}</strong><small>{dateText(order.order_date)}</small></td>
                  <td className="cycle-party"><strong>{order.supplier_name}</strong><small>{order.supplier_category}{Number(order.is_trusted) !== 1 ? ' · belum terpercaya' : ''}</small></td>
                  <td>{order.requisition_no}</td>
                  <td className="num">{money(order.total)}</td>
                  <td>{poBadge(order.status)}</td>
                  <td className="cycle-action-cell">
                    {order.status === 'DRAFT' && <Button small disabled={busy} onClick={() => poAction(order.id, 'send', `PO ${order.order_no} dikirim ke pemasok.`)}>Kirim ke pemasok</Button>}
                    {order.status === 'DIKIRIM' && <Button small disabled={busy} onClick={() => setGoodsReceiptModal({ order, draft: { receipt_date: todayISO(), accepted_total: String(order.total), condition_note: '', checked_by: user?.name || '' } })}><PackageCheck size={13} /> Catat penerimaan</Button>}
                    {order.status === 'SELESAI' && !bills.some((bill) => bill.order_id === order.id) && (
                      <Button small variant="secondary" disabled={busy} onClick={() => setBillModal({ order, draft: { bill_date: todayISO(), supplier_invoice_no: '', amount: String(order.total) } })}><FileText size={13} /> Catat faktur</Button>
                    )}
                    {['SELESAI', 'DIBATALKAN'].includes(order.status) && bills.some((bill) => bill.order_id === order.id) && <span className="muted">Selesai</span>}
                  </td>
                </tr>
              ))}
              {!orders.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada pesanan pembelian. Buat PO dari permintaan yang sudah disetujui.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </>}

      {!loading && view === 'receipts' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading">
          <div><h2>Laporan penerimaan barang (LPB)</h2><p>Gudang memeriksa jumlah dan kondisi barang sebelum utang dicatat.</p></div>
          <Button small disabled={!sentOrders.length} onClick={() => setGoodsReceiptModal({ order: sentOrders[0], draft: { receipt_date: todayISO(), accepted_total: String(sentOrders[0]?.total || ''), condition_note: '', checked_by: user?.name || '' } })}><Plus size={15} /> Penerimaan barang</Button>
        </div>
        <div className="cycle-table-wrap"><table className="cycle-table">
          <thead><tr><th>Laporan</th><th>PO</th><th className="num">Nilai diterima</th><th>Kondisi barang</th><th>Pemeriksa</th><th>Tanggal</th></tr></thead>
          <tbody>
            {goodsReceipts.map((receipt) => (
              <tr key={receipt.id}>
                <td><strong className="cycle-id">{receipt.receipt_no}</strong></td>
                <td>{receipt.order_no}</td>
                <td className="num">{money(receipt.accepted_total)}</td>
                <td>{receipt.condition_note || '—'}</td>
                <td>{receipt.checked_by || '—'}</td>
                <td>{dateText(receipt.receipt_date)}</td>
              </tr>
            ))}
            {!goodsReceipts.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada laporan penerimaan barang.</td></tr>}
          </tbody>
        </table></div>
      </section>}

      {!loading && view === 'bills' && <>
        <section className="panel panel-tight cycle-table-panel" style={{ marginBottom: 16 }}>
          <div className="cycle-table-heading">
            <div><h2>Faktur pemasok & catatan utang usaha</h2><p>Nilai faktur wajib cocok dengan PO dan laporan penerimaan (three-way match).</p></div>
            <Button small disabled={!eligibleBillOrders.length} onClick={() => setBillModal({ order: eligibleBillOrders[0], draft: { bill_date: todayISO(), supplier_invoice_no: '', amount: String(eligibleBillOrders[0]?.total || '') } })}><Plus size={15} /> Catat faktur</Button>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Utang</th><th>Pemasok</th><th>PO</th><th>Faktur pemasok</th><th className="num">Nilai</th><th className="num">Dibayar</th><th className="num">Sisa</th><th>Pencocokan</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td><strong className="cycle-id">{bill.bill_no}</strong><small>{dateText(bill.bill_date)}</small></td>
                  <td className="cycle-party"><strong>{bill.supplier_name}</strong><small>{bill.supplier_category}</small></td>
                  <td>{bill.order_no}</td>
                  <td>{bill.supplier_invoice_no || '—'}</td>
                  <td className="num">{money(bill.amount)}</td>
                  <td className="num">{money(bill.paid)}</td>
                  <td className="num">{money(Number(bill.amount) - Number(bill.paid))}</td>
                  <td>{matchBadge(bill.match_status)}</td>
                  <td>{billBadge(bill.status)}</td>
                  <td className="cycle-action-cell">
                    {bill.status === 'OPEN' && bill.match_status === 'MATCHED' && (
                      <Button small disabled={busy} title="Pembayaran keuangan (peran KEUANGAN)" onClick={() => setPaymentModal({ bill, draft: { amount: String(Number(bill.amount) - Number(bill.paid)), method: 'BANK', reference_no: '', payment_date: todayISO() } })}><Banknote size={13} /> Bayar</Button>
                    )}
                    {bill.status === 'PAID' && <span className="muted">Lunas</span>}
                  </td>
                </tr>
              ))}
              {!bills.length && <tr><td className="cycle-empty" colSpan={10}>Belum ada utang pemasok. Catat faktur pemasok setelah barang diterima.</td></tr>}
            </tbody>
          </table></div>
          {openBills.length > 0 && <div className="cycle-footnote"><FileText size={14} /><span>Total utang berjalan {money(payableTotal)}. Pembayaran hanya dapat dilakukan pada faktur berstatus Cocok oleh bagian keuangan.</span></div>}
        </section>

        <section className="panel panel-tight cycle-table-panel">
          <div className="cycle-table-heading"><div><h2>Bukti kas keluar (BKK)</h2><p>Pembayaran kepada pemasok oleh bagian keuangan.</p></div></div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Bukti</th><th>Utang</th><th className="num">Jumlah</th><th>Metode</th><th>Referensi</th><th>Tanggal</th></tr></thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td><strong className="cycle-id">{payment.payment_no}</strong></td>
                  <td>{payment.bill_no}</td>
                  <td className="num">{money(payment.amount)}</td>
                  <td>{payment.method === 'KAS' ? 'Kas di tangan' : 'Transfer bank'}</td>
                  <td>{payment.reference_no || '—'}</td>
                  <td>{dateText(payment.payment_date)}</td>
                </tr>
              ))}
              {!payments.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada pembayaran pemasok.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </>}

      {!loading && view === 'journal' && <>
        <section className="panel cycle-card">
          <div className="cycle-card-heading"><div><h2>Jurnal siklus pengeluaran</h2><p>Faktur pemasok: debit Beban, kredit Utang Usaha; pembayaran: debit Utang, kredit Kas/Bank.</p></div><Landmark size={18} /></div>
          <JournalList entries={journals} />
        </section>
      </>}

      {!loading && view === 'controls' && <>
        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Pengendalian internal pengeluaran</h2><p>Persetujuan pembelian, pemasok terpercaya, pemeriksaan barang, pencocokan dokumen, dan pembatasan akses kas.</p></div><ShieldCheck size={18} /></div>
            {CONTROL_DUTIES.map(([role, note], index) => (
              <div className="cycle-check-row" key={role}>
                <span className="cycle-check-mark">{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{role}</strong><small>{note}</small></span>
              </div>
            ))}
            <p className="cycle-form-hint">Peran diperiksa dari sesi login: pengusul (semua), persetujuan (SDM_MANAGER), PO (PEMBELIAN), barang (GUDANG), utang (AKUNTANSI), pembayaran (KEUANGAN).</p>
          </section>

          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Pemasok & pencocokan dokumen</h2><p>Pemilihan pemasok terpercaya dan three-way match PO–LPB–faktur.</p></div><Truck size={18} /></div>
            {untrustedSuppliers.length ? untrustedSuppliers.map((supplier) => (
              <div className="cycle-check-row" key={supplier.id}>
                <span className="cycle-check-mark">!</span>
                <span><strong>{supplier.name}</strong><small>{supplier.supplier_code} · belum ditandai terpercaya</small></span>
                <span className="cycle-inline-actions"><Button small disabled={busy} onClick={async () => {
                  setBusy(true)
                  try {
                    await request(`/api/expenditure/suppliers/${supplier.id}`, {
                      method: 'PUT',
                      body: {
                        supplier_code: supplier.supplier_code,
                        name: supplier.name,
                        category: supplier.category,
                        phone: supplier.phone,
                        address: supplier.address,
                        is_trusted: 1,
                        is_active: Number(supplier.is_active) === 1 ? 1 : 0
                      }
                    })
                    notify(`${supplier.name} ditandai terpercaya.`)
                    await refresh()
                  } catch (err) {
                    notify(err.message || 'Gagal memperbarui pemasok.', true)
                  } finally {
                    setBusy(false)
                  }
                }}>Tandai terpercaya</Button></span>
              </div>
            )) : <CycleEmpty>Semua pemasok aktif sudah ditandai terpercaya.</CycleEmpty>}
            <div className="cycle-formula" style={{ marginTop: 10 }}><small>Sistem menolak mencatat utang bila nilai faktur ≠ nilai PO/laporan penerimaan, dan menolak pembayaran pada faktur yang belum cocok.</small></div>
          </section>
        </div>

        <section className="panel cycle-card" style={{ marginTop: 16 }}>
          <div className="cycle-card-heading"><div><h2>Rekonsiliasi catatan utang dengan laporan pemasok</h2><p>Bagian C BAB V: rekonsiliasi memastikan saldo utang benar.</p></div><Landmark size={18} /></div>
          <div style={{ marginBottom: 10 }}>{controlBadge(controls.find((check) => check.kind === 'AP_RECONCILIATION')?.status)}</div>
          <div className="cycle-breakdown">
            <div>
              <DetailRow label="Catatan utang usaha" note={`Faktur OPEN ${monthLabel(controlDraft.period || month)}`} value={controlSuggested.payableTotal} />
              <DetailRow label="Pemasok belum terpercaya" note="Pengendalian pemilihan pemasok" value={controlSuggested.untrustedSuppliers} />
            </div>
            <div>
              <DetailRow label="Selisih" note="Laporan pemasok − catatan utang" value={Number(controlDraft.statement_total || 0) - controlSuggested.payableTotal} />
            </div>
          </div>
          <form className="cycle-form" onSubmit={saveControl}>
            <div className="cycle-form-grid">
              <label className="cycle-field"><span>Periode rekonsiliasi</span><input className="input" type="month" value={controlDraft.period} onChange={setField(setControlDraft, 'period')} /></label>
              <label className="cycle-field"><span>Saldo menurut laporan pemasok (Rp)</span><input className="input" type="number" min="0" step="0.01" disabled={busy} value={controlDraft.statement_total} onChange={setField(setControlDraft, 'statement_total')} /></label>
              <div className="cycle-field"><span>Petugas (dari sesi login)</span><input className="input" value={`${user?.name || '—'} · ${user?.role || '—'}`} readOnly disabled /></div>
              <label className="cycle-field cycle-field-wide"><span>Catatan rekonsiliasi</span><input className="input" disabled={busy} value={controlDraft.note} onChange={setField(setControlDraft, 'note')} placeholder="Nomor laporan pemasok / tanggal rekonsiliasi" /></label>
            </div>
            <Button type="submit" small disabled={busy} style={{ marginTop: 10 }}>Simpan rekonsiliasi</Button>
          </form>
        </section>

        <section className="panel panel-tight cycle-table-panel" style={{ marginTop: 16 }}>
          <div className="cycle-table-heading"><div><h2>Pemeriksaan terbaru</h2><p>Status rekonsiliasi utang terakhir per periode.</p></div></div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Periode</th><th>Pemeriksaan</th><th className="num">Harapan</th><th className="num">Aktual</th><th className="num">Selisih</th><th>Status</th><th>Petugas</th><th>Waktu</th></tr></thead>
            <tbody>
              {controls.map((check) => (
                <tr key={check.id}>
                  <td><strong className="cycle-id">{monthLabel(check.period)}</strong></td>
                  <td>Rekonsiliasi utang pemasok</td>
                  <td className="num">{money(check.expected_value)}</td>
                  <td className="num">{money(check.actual_value)}</td>
                  <td className="num">{money(check.difference)}</td>
                  <td>{controlBadge(check.status)}</td>
                  <td>{check.operator_role || '—'}</td>
                  <td>{dateText(check.checked_at)}</td>
                </tr>
              ))}
              {!controls.length && <tr><td className="cycle-empty" colSpan={8}>Belum ada pemeriksaan rekonsiliasi utang.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </>}


      {supplierModal && <Modal
        title={supplierModal.id ? 'Ubah pemasok' : 'Tambah pemasok'}
        onClose={() => setSupplierModal(null)}
        maxWidth="680px"
        footer={<><Button variant="secondary" onClick={() => setSupplierModal(null)}>Batal</Button><Button type="submit" form="expenditure-supplier-form"><Plus size={15} /> Simpan pemasok</Button></>}
      >
        <form id="expenditure-supplier-form" className="cycle-form" onSubmit={saveSupplier}>
          <p className="cycle-form-intro">Pemasok kafe maid: roastery kopi, toko bahan kue, atelier kostum maid, listrik/air, dan jasa.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Kode pemasok</span><input className="input" required maxLength={30} value={supplierModal.supplier_code} onChange={setField(setSupplierModal, 'supplier_code')} placeholder="SPK-001" /></label>
            <label className="cycle-field"><span>Nama pemasok</span><input className="input" required maxLength={100} value={supplierModal.name} onChange={setField(setSupplierModal, 'name')} placeholder="Roastery Kopi Nusantara" /></label>
            <label className="cycle-field"><span>Kategori</span><select className="input" value={supplierModal.category} onChange={setField(setSupplierModal, 'category')}>{SUPPLIER_CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="cycle-field"><span>Telepon</span><input className="input" value={supplierModal.phone} onChange={setField(setSupplierModal, 'phone')} /></label>
            <label className="cycle-field"><span>Terpercaya</span><select className="input" value={supplierModal.is_trusted} onChange={(event) => setNumberField(setSupplierModal, 'is_trusted')(event)}><option value={0}>Belum terpercaya</option><option value={1}>Terpercaya</option></select></label>
            <label className="cycle-field"><span>Status</span><select className="input" value={supplierModal.is_active} onChange={(event) => setNumberField(setSupplierModal, 'is_active')(event)}><option value={1}>Aktif</option><option value={0}>Nonaktif</option></select></label>
            <label className="cycle-field cycle-field-wide"><span>Alamat</span><textarea className="input" rows="2" value={supplierModal.address} onChange={setField(setSupplierModal, 'address')} /></label>
          </div>
        </form>
      </Modal>}

      {requisitionModal && <Modal
        title="Surat permintaan pembelian"
        onClose={() => setRequisitionModal(null)}
        maxWidth="760px"
        footer={<><Button variant="secondary" onClick={() => setRequisitionModal(null)}>Batal</Button><Button type="submit" form="expenditure-requisition-form"><Plus size={15} /> Ajukan permintaan</Button></>}
      >
        <form id="expenditure-requisition-form" className="cycle-form" onSubmit={saveRequisition}>
          <p className="cycle-form-intro">Setiap bagian kafe maid boleh mengajukan permintaan; persetujuan dilakukan manajer sebelum PO dibuat.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Tanggal permintaan</span><input className="input" type="date" required value={requisitionModal.requisition_date} onChange={setField(setRequisitionModal, 'requisition_date')} /></label>
            <label className="cycle-field"><span>Bagian pengusul</span><select className="input" value={requisitionModal.department} onChange={setField(setRequisitionModal, 'department')}>{REQUISITION_DEPARTMENTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="cycle-field"><span>Diusulkan oleh</span><input className="input" value={requisitionModal.requested_by} onChange={setField(setRequisitionModal, 'requested_by')} placeholder={user?.name || 'Nama pengusul'} /></label>
            <label className="cycle-field"><span>Alasan / kebutuhan</span><input className="input" value={requisitionModal.reason} onChange={setField(setRequisitionModal, 'reason')} placeholder="Stok biji kopi mingguan habis" /></label>
          </div>
          <div className="cycle-table-heading" style={{ marginTop: 12 }}><div><h2>Item permintaan</h2><p>Estimasi harga boleh nol bila belum diminta penawaran.</p></div><Button small variant="secondary" onClick={() => addRequisitionItem(setRequisitionModal)}><Plus size={13} /> Tambah baris</Button></div>
          <div className="cycle-form-grid">
            {requisitionModal.items.map((item, index) => (
              <div className="cycle-field cycle-field-wide" key={index} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1.5fr auto', gap: 8 }}>
                <input className="input" aria-label="Deskripsi item" placeholder="Biji kopi Arabika 1 kg" value={item.description} onChange={(event) => patchRequisitionItem(index, 'description', event.target.value)} />
                <input className="input" aria-label="Jumlah" type="number" min="1" step="1" value={item.qty} onChange={(event) => patchRequisitionItem(index, 'qty', event.target.value)} />
                <input className="input" aria-label="Estimasi harga" type="number" min="0" step="500" value={item.unit_price} onChange={(event) => patchRequisitionItem(index, 'unit_price', event.target.value)} />
                {requisitionModal.items.length > 1 && <Button small variant="ghost" aria-label="Hapus baris" onClick={() => removeRequisitionItem(setRequisitionModal, index)}><Trash2 size={13} /></Button>}
              </div>
            ))}
          </div>
          <div className="cycle-form-total"><span>Estimasi total<small>Hitungan sementara sebelum diajukan</small></span><strong>{money(requisitionDraftTotal)}</strong></div>
        </form>
      </Modal>}

      {poModal && <Modal
        title="Pesanan pembelian (PO)"
        onClose={() => setPoModal(null)}
        maxWidth="760px"
        footer={<><Button variant="secondary" onClick={() => setPoModal(null)}>Batal</Button><Button type="submit" form="expenditure-po-form"><Plus size={15} /> Simpan PO</Button></>}
      >
        <form id="expenditure-po-form" className="cycle-form" onSubmit={savePo}>
          <p className="cycle-form-intro">PO diterbitkan bagian pembelian dari permintaan yang sudah disetujui manajer.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Tanggal PO</span><input className="input" type="date" required value={poModal.order_date} onChange={setField(setPoModal, 'order_date')} /></label>
            <label className="cycle-field"><span>Permintaan sumber</span><select className="input" required value={poModal.requisition_id} onChange={setField(setPoModal, 'requisition_id')}><option value="">— pilih permintaan disetujui —</option>{approvedRequisitions.map((requisition) => <option key={requisition.id} value={requisition.id}>{requisition.requisition_no} — {requisition.department} ({money(requisition.estimated_total)})</option>)}</select></label>
            <label className="cycle-field"><span>Pemasok</span><select className="input" required value={poModal.supplier_id} onChange={setField(setPoModal, 'supplier_id')}><option value="">— pilih pemasok —</option>{suppliers.filter((supplier) => Number(supplier.is_active) === 1).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{Number(supplier.is_trusted) === 1 ? ' ✓' : ' (belum terpercaya)'}</option>)}</select></label>
            <label className="cycle-field cycle-field-wide"><span>Catatan</span><input className="input" value={poModal.notes} onChange={setField(setPoModal, 'notes')} placeholder="Ketentuan kirim dan tempo pembayaran" /></label>
          </div>
          <div className="cycle-table-heading" style={{ marginTop: 12 }}><div><h2>Item pesanan</h2><p>Nilai PO harus sama dengan laporan penerimaan dan faktur pemasok.</p></div><Button small variant="secondary" onClick={() => addRequisitionItem(setPoModal)}><Plus size={13} /> Tambah baris</Button></div>
          <div className="cycle-form-grid">
            {poModal.items.map((item, index) => (
              <div className="cycle-field cycle-field-wide" key={index} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1.5fr auto', gap: 8 }}>
                <input className="input" aria-label="Deskripsi item" placeholder="Biji kopi Arabika 1 kg" value={item.description} onChange={(event) => patchPoItem(index, 'description', event.target.value)} />
                <input className="input" aria-label="Jumlah" type="number" min="1" step="1" value={item.qty} onChange={(event) => patchPoItem(index, 'qty', event.target.value)} />
                <input className="input" aria-label="Harga satuan" type="number" min="0" step="500" value={item.unit_price} onChange={(event) => patchPoItem(index, 'unit_price', event.target.value)} />
                {poModal.items.length > 1 && <Button small variant="ghost" aria-label="Hapus baris" onClick={() => removeRequisitionItem(setPoModal, index)}><Trash2 size={13} /></Button>}
              </div>
            ))}
          </div>
          <div className="cycle-form-total"><span>Total PO<small>Hitungan sementara sebelum disimpan</small></span><strong>{money(poDraftTotal)}</strong></div>
        </form>
      </Modal>}

      {goodsReceiptModal && <Modal
        title={`Penerimaan barang — ${goodsReceiptModal.order.order_no}`}
        onClose={() => setGoodsReceiptModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setGoodsReceiptModal(null)}>Batal</Button><Button type="submit" form="expenditure-receipt-form"><Plus size={15} /> Simpan laporan</Button></>}
      >
        <form id="expenditure-receipt-form" className="cycle-form" onSubmit={saveGoodsReceipt}>
          <p className="cycle-form-intro">Gudang memeriksa jumlah dan kondisi barang dari {goodsReceiptModal.order.supplier_name}. Nilai yang disetujui dipakai dalam pencocokan tiga arah.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Tanggal terima</span><input className="input" type="date" required value={goodsReceiptModal.draft.receipt_date} onChange={setDraftField(setGoodsReceiptModal, 'receipt_date')} /></label>
            <label className="cycle-field"><span>Nilai barang diterima (Rp)</span><input className="input" type="number" min="1" step="0.01" required value={goodsReceiptModal.draft.accepted_total} onChange={setDraftField(setGoodsReceiptModal, 'accepted_total')} /><small>Nilai PO {money(goodsReceiptModal.order.total)}</small></label>
            <div className="cycle-field"><span>Pemeriksa (dari sesi login)</span><input className="input" value={goodsReceiptModal.draft.checked_by} onChange={setDraftField(setGoodsReceiptModal, 'checked_by')} /></div>
            <label className="cycle-field cycle-field-wide"><span>Kondisi barang</span><textarea className="input" rows="2" value={goodsReceiptModal.draft.condition_note} onChange={setDraftField(setGoodsReceiptModal, 'condition_note')} placeholder="Segar, tidak rusak, jumlah sesuai" /></label>
          </div>
        </form>
      </Modal>}

      {billModal && <Modal
        title="Catat faktur pemasok"
        onClose={() => setBillModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setBillModal(null)}>Batal</Button><Button type="submit" form="expenditure-bill-form"><Plus size={15} /> Simpan utang</Button></>}
      >
        <form id="expenditure-bill-form" className="cycle-form" onSubmit={saveBill}>
          <p className="cycle-form-intro">Pilih PO yang barangnya sudah diterima. Nilai faktur harus sama dengan PO dan laporan penerimaan; selisih ditolak sistem.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Pesanan pembelian</span><select className="input" required value={billModal.order?.id || ''} onChange={(event) => {
              const order = orders.find((entry) => entry.id === Number(event.target.value) && entry.status === 'SELESAI')
              if (order) setBillModal({ order, draft: { ...billModal.draft, amount: String(order.total) } })
            }}>{orders.filter((entry) => entry.status === 'SELESAI' && !bills.some((bill) => bill.order_id === entry.id)).map((entry) => <option key={entry.id} value={entry.id}>{entry.order_no} — {entry.supplier_name} ({money(entry.total)})</option>)}</select></label>
            <label className="cycle-field"><span>Tanggal faktur</span><input className="input" type="date" required value={billModal.draft.bill_date} onChange={setDraftField(setBillModal, 'bill_date')} /></label>
            <label className="cycle-field"><span>Nomor faktur pemasok</span><input className="input" value={billModal.draft.supplier_invoice_no} onChange={setDraftField(setBillModal, 'supplier_invoice_no')} placeholder="INV-PMS-2026-01" /></label>
            <label className="cycle-field"><span>Nilai faktur (Rp)</span><input className="input" type="number" min="1" step="0.01" required value={billModal.draft.amount} onChange={setDraftField(setBillModal, 'amount')} /></label>
          </div>
        </form>
      </Modal>}

      {paymentModal && <Modal
        title={`Pembayaran pemasok — ${paymentModal.bill.bill_no}`}
        onClose={() => setPaymentModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setPaymentModal(null)}>Batal</Button><Button type="submit" form="expenditure-payment-form"><Plus size={15} /> Simpan pembayaran</Button></>}
      >
        <form id="expenditure-payment-form" className="cycle-form" onSubmit={savePayment}>
          <p className="cycle-form-intro">Pembayaran dilakukan bagian keuangan pada faktur yang sudah cocok. Sisa utang {money(Number(paymentModal.bill.amount) - Number(paymentModal.bill.paid))}.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Tanggal pembayaran</span><input className="input" type="date" required value={paymentModal.draft.payment_date} onChange={setDraftField(setPaymentModal, 'payment_date')} /></label>
            <label className="cycle-field"><span>Jumlah dibayar (Rp)</span><input className="input" type="number" min="1" step="0.01" required value={paymentModal.draft.amount} onChange={setDraftField(setPaymentModal, 'amount')} /></label>
            <label className="cycle-field"><span>Sumber kas</span><select className="input" value={paymentModal.draft.method} onChange={setDraftField(setPaymentModal, 'method')}><option value="BANK">Transfer bank</option><option value="KAS">Kas di tangan</option></select></label>
            <label className="cycle-field"><span>Nomor bukti transfer</span><input className="input" value={paymentModal.draft.reference_no} onChange={setDraftField(setPaymentModal, 'reference_no')} placeholder="TRF-2026-0001" /></label>
          </div>
        </form>
      </Modal>}
    </>
  )
}
