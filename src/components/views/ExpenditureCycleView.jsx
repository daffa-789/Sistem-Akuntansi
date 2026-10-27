import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Banknote, CalendarDays, Clock3, Download, FileText, Plus, Search, ShoppingCart, WalletCards } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { money } from '../../../src/utils/formatters.js'
import { CycleEmpty, CycleIntro, CycleJournal, CycleMetric, CycleStatus, CycleTabs, todayISO } from './CyclePrimitives.jsx'

const STORAGE_KEY = 'finova_expenditure_cycle_demo_v1'
const VIEWS = [['summary', 'Ringkasan'], ['bills', 'Tagihan pemasok'], ['payables', 'Utang usaha'], ['journal', 'Jurnal simulasi']]
const SEED = [
  { id: 'BILL-2026-001', billDate: '2026-08-04', dueDate: '2026-09-03', supplier: 'PT Pilar Komponen (Fiktif)', description: 'Bahan baku produksi', category: 'Persediaan bahan', amount: 32000000, payments: [{ date: '2026-08-30', method: 'Transfer bank', amount: 32000000 }] },
  { id: 'BILL-2026-002', billDate: '2026-08-15', dueDate: '2026-09-14', supplier: 'CV Aruna Sarana (Fiktif)', description: 'Komponen pendukung produksi', category: 'Persediaan bahan', amount: 12000000, payments: [{ date: '2026-09-05', method: 'Transfer bank', amount: 7000000 }] },
  { id: 'BILL-2026-003', billDate: '2026-09-01', dueDate: '2026-09-30', supplier: 'PT Cakrawala Logistik (Fiktif)', description: 'Bahan pendukung produksi', category: 'Persediaan bahan', amount: 20000000, payments: [] },
  { id: 'BILL-2026-004', billDate: '2026-09-12', dueDate: '2026-10-12', supplier: 'PT Bina Mitra Nusantara (Fiktif)', description: 'Pemeliharaan fasilitas produksi', category: 'Overhead produksi', amount: 8000000, payments: [{ date: '2026-09-28', method: 'Transfer bank', amount: 8000000 }] },
  { id: 'BILL-2026-005', billDate: '2026-09-20', dueDate: '2026-10-20', supplier: 'PT Garda Layanan (Fiktif)', description: 'Layanan pelatihan keselamatan', category: 'Beban operasional', amount: 9000000, payments: [] },
  { id: 'BILL-2026-006', billDate: '2026-10-01', dueDate: '2026-10-31', supplier: 'CV Nusantara Niaga (Fiktif)', description: 'Bahan untuk periode berikutnya', category: 'Persediaan bahan', amount: 3000000, payments: [] }
]

function cloneSeed() { return SEED.map((item) => ({ ...item, payments: item.payments.map((payment) => ({ ...payment })) })) }
function loadBills() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return cloneSeed()
}
function totalPaid(item) { return (item.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0) }
function balance(item) { return Math.max(0, Number(item.amount || 0) - totalPaid(item)) }
function statusOf(item) {
  if (balance(item) === 0) return 'paid'
  if (item.dueDate < todayISO()) return 'overdue'
  if (totalPaid(item) > 0) return 'partial'
  return 'open'
}
function newBill() {
  const date = todayISO()
  return { supplier: '', description: '', category: 'Persediaan bahan', billDate: date, dueDate: date, amount: '' }
}
function downloadCsv(bills) {
  const header = ['No Tagihan', 'Tanggal', 'Jatuh Tempo', 'Pemasok', 'Uraian', 'Kategori', 'Nilai', 'Dibayar', 'Utang', 'Status']
  const body = bills.map((item) => [item.id, item.billDate, item.dueDate, item.supplier, item.description, item.category, item.amount, totalPaid(item), balance(item), statusOf(item)])
  const csv = '\uFEFF' + [header, ...body].map((row) => row.map((value) => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = 'finova-siklus-pengeluaran-demo.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

function BillTable({ items, onPay, compact = false }) {
  return (
    <div className="cycle-table-wrap">
      <table className="cycle-table">
        <thead><tr><th>Tagihan</th><th>Pemasok & uraian</th><th>Jatuh tempo</th><th className="num">Nilai</th>{!compact && <th className="num">Dibayar</th>}<th className="num">Utang</th><th>Status</th>{!compact && <th />}</tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td><strong className="cycle-id">{item.id}</strong><small>{item.billDate}</small></td>
              <td className="cycle-party"><strong>{item.supplier}</strong><small>{item.description}</small></td>
              <td>{item.dueDate}</td>
              <td className="num">{money(item.amount)}</td>
              {!compact && <td className="num">{money(totalPaid(item))}</td>}
              <td className="num">{money(balance(item))}</td>
              <td><CycleStatus status={statusOf(item)} /></td>
              {!compact && <td className="cycle-action-cell">{balance(item) > 0 && <Button small variant="secondary" onClick={() => onPay(item.id)}>Bayar</Button>}</td>}
            </tr>
          ))}
          {!items.length && <tr><td className="cycle-empty" colSpan={compact ? 7 : 8}>Tidak ada tagihan yang cocok.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function ExpenditureCycleView({ notify = () => {} }) {
  const [bills, setBills] = useState(loadBills)
  const [view, setView] = useState('summary')
  const [modal, setModal] = useState(null)
  const [draft, setDraft] = useState(newBill)
  const [payment, setPayment] = useState({ billId: '', date: todayISO(), amount: '', method: 'Transfer bank' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bills)) } catch { notify('Data pengeluaran tidak dapat disimpan di browser.', true) }
  }, [bills, notify])

  const summary = useMemo(() => {
    const total = bills.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const paid = bills.reduce((sum, item) => sum + totalPaid(item), 0)
    const outstanding = bills.reduce((sum, item) => sum + balance(item), 0)
    const overdue = bills.filter((item) => balance(item) > 0 && item.dueDate < todayISO()).reduce((sum, item) => sum + balance(item), 0)
    const soon = bills.filter((item) => {
      const days = Math.ceil((new Date(item.dueDate + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 86400000)
      return balance(item) > 0 && days >= 0 && days <= 7
    }).reduce((sum, item) => sum + balance(item), 0)
    const categories = new Map()
    bills.forEach((item) => categories.set(item.category, (categories.get(item.category) || 0) + Number(item.amount || 0)))
    return { total, paid, outstanding, overdue, soon, categories: [...categories.entries()] }
  }, [bills])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return [...bills].sort((a, b) => b.billDate.localeCompare(a.billDate)).filter((item) =>
      !needle || [item.id, item.supplier, item.description].some((value) => value.toLocaleLowerCase('id').includes(needle))
    )
  }, [bills, query])
  const outstanding = useMemo(() => bills.filter((item) => balance(item) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [bills])

  function openPayment(id) {
    const item = bills.find((bill) => bill.id === id) || outstanding[0]
    if (!item) { notify('Semua tagihan sudah lunas.'); return }
    setPayment({ billId: item.id, date: todayISO(), amount: String(balance(item)), method: 'Transfer bank' })
    setModal('payment')
  }
  function saveBill(event) {
    event.preventDefault()
    if (!draft.supplier.trim() || !draft.description.trim() || Number(draft.amount) <= 0 || draft.dueDate < draft.billDate) {
      notify('Periksa pemasok, uraian, nilai, dan tanggal jatuh tempo.', true)
      return
    }
    const year = draft.billDate.slice(0, 4)
    const next = bills.filter((item) => item.id.startsWith('BILL-' + year + '-')).length + 1
    const item = { ...draft, id: 'BILL-' + year + '-' + String(next).padStart(3, '0'), amount: Number(draft.amount), payments: [] }
    setBills((current) => [item, ...current])
    setModal(null)
    setDraft(newBill())
    notify('Tagihan pemasok tersimpan di data demo.')
  }
  function savePayment(event) {
    event.preventDefault()
    const item = bills.find((bill) => bill.id === payment.billId)
    const amount = Number(payment.amount)
    if (!item || amount <= 0 || amount > balance(item) || payment.date < item.billDate) {
      notify('Nominal atau tanggal pembayaran tidak sesuai sisa tagihan.', true)
      return
    }
    setBills((current) => current.map((bill) => bill.id !== item.id ? bill : {
      ...bill,
      payments: [...(bill.payments || []), { date: payment.date, method: payment.method, amount }]
    }))
    setModal(null)
    notify('Pembayaran pemasok tercatat di simulasi.')
  }

  const journalEntries = [
    ...bills.map((item) => ({
      ref: item.id,
      date: item.billDate,
      description: 'Pencatatan tagihan pemasok',
      debitAccount: item.category === 'Persediaan bahan' ? 'Persediaan Bahan Baku' : item.category === 'Overhead produksi' ? 'Beban Overhead Produksi' : 'Beban Layanan',
      creditAccount: 'Utang Usaha',
      amount: Number(item.amount || 0)
    })),
    ...bills.flatMap((item) => (item.payments || []).map((payment, index) => ({
      ref: item.id + '-BAYAR-' + (index + 1),
      date: payment.date,
      description: 'Pembayaran kepada pemasok',
      debitAccount: 'Utang Usaha',
      creditAccount: payment.method === 'Kas' ? 'Kas' : 'Kas di Bank',
      amount: Number(payment.amount || 0)
    })))
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <CycleIntro number="02" title="Siklus Pengeluaran" description="Catat pembelian, tagihan pemasok, dan pembayaran agar saldo utang usaha mudah dipantau." actions={<><Button variant="secondary" onClick={() => downloadCsv(bills)}><Download size={15} /> Ekspor CSV</Button><Button onClick={() => { setDraft(newBill()); setModal('bill') }}><Plus size={15} /> Catat pembelian</Button></>} />
      <CycleTabs value={view} items={VIEWS} onChange={setView} />
      <div className="cycle-page-label"><span>{VIEWS.find(([key]) => key === view)?.[1]}</span><span>{bills.length} tagihan <i>·</i> Data simulasi</span></div>

      {view === 'summary' && <>
        <div className="cycle-metrics">
          <CycleMetric label="Total pembelian" value={summary.total} note="Tagihan pemasok tercatat" Icon={ShoppingCart} />
          <CycleMetric label="Kas dibayarkan" value={summary.paid} note="Pembayaran sebagian dan penuh" Icon={WalletCards} tone="is-blue" />
          <CycleMetric label="Utang usaha" value={summary.outstanding} note={outstanding.length + ' tagihan belum lunas'} Icon={Banknote} tone="is-amber" />
          <CycleMetric label="Lewat jatuh tempo" value={summary.overdue} note={money(summary.soon) + ' segera jatuh tempo'} Icon={AlertTriangle} tone="is-red" />
        </div>
        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Pembelian menurut kelompok</h2><p>Nilai tagihan yang dicatat dalam contoh.</p></div><CalendarDays size={18} aria-hidden="true" /></div>
            <div className="cycle-breakdown">
              {summary.categories.map(([name, amount]) => (
                <div className="cycle-breakdown-row" key={name}><span>{name}</span><div className="cycle-track"><i style={{ width: (summary.total ? amount / summary.total * 100 : 0) + '%' }} /></div><strong>{money(amount)}</strong></div>
              ))}
            </div>
            <div className="cycle-card-foot"><span>Total tagihan</span><strong>{money(summary.total)}</strong></div>
          </section>
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Jadwal pembayaran</h2><p>Urut dari tagihan paling dekat jatuh tempo.</p></div><Clock3 size={18} aria-hidden="true" /></div>
            {outstanding.slice(0, 4).map((item) => (
              <div className="cycle-attention-row" key={item.id}><span className={'cycle-dot ' + (statusOf(item) === 'overdue' ? 'is-red' : 'is-amber')} /><div><strong>{item.supplier}</strong><small>{item.id} · jatuh tempo {item.dueDate}</small></div><b>{money(balance(item))}</b></div>
            ))}
            {!outstanding.length && <CycleEmpty>Tidak ada utang pemasok yang terbuka.</CycleEmpty>}
            <div className="cycle-control-note"><AlertTriangle size={14} /> Periksa dokumen penerimaan sebelum menyetujui pembayaran.</div>
          </section>
        </div>
        <section className="panel panel-tight cycle-recent">
          <div className="cycle-table-heading"><div><h2>Tagihan terbaru</h2><p>Daftar pembelian dan saldo pemasok.</p></div><Button small variant="ghost" onClick={() => setView('bills')}>Lihat semua</Button></div>
          <BillTable items={[...bills].sort((a, b) => b.billDate.localeCompare(a.billDate)).slice(0, 5)} onPay={openPayment} compact />
        </section>
      </>}

      {view === 'bills' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading"><div><h2>Tagihan pemasok</h2><p>Status mengikuti nilai tagihan, pembayaran, dan tanggal jatuh tempo.</p></div><label className="cycle-search"><Search size={15} /><span className="sr-only">Cari tagihan</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pemasok atau nomor tagihan" /></label></div>
        <BillTable items={filtered} onPay={openPayment} />
      </section>}

      {view === 'payables' && <>
        <div className="cycle-aging"><article><span>Saldo utang</span><strong>{money(summary.outstanding)}</strong><small>Sisa tagihan setelah pembayaran</small></article><article className="is-red"><span>Lewat jatuh tempo</span><strong>{money(summary.overdue)}</strong><small>Perlu ditindaklanjuti</small></article><article className="is-amber"><span>Belum jatuh tempo</span><strong>{money(Math.max(0, summary.outstanding - summary.overdue))}</strong><small>Termasuk yang jatuh tempo 7 hari ke depan</small></article></div>
        <section className="panel panel-tight cycle-table-panel"><div className="cycle-table-heading"><div><h2>Umur utang usaha</h2><p>Gunakan tombol Bayar untuk mencatat pelunasan simulasi.</p></div><Button small variant="secondary" onClick={() => openPayment()}><Banknote size={14} /> Catat pembayaran</Button></div><BillTable items={outstanding} onPay={openPayment} /></section>
      </>}
      {view === 'journal' && <CycleJournal entries={journalEntries} explanation="Contoh pembelian dan pembayaran ini tersimpan di browser, terpisah dari buku besar aktif." />}

      <div className="cycle-footnote"><FileText size={14} /><span>Data pengeluaran ini adalah contoh fiktif. Jurnalnya hanya pratinjau dan tidak mengubah database pembukuan.</span></div>

      {modal === 'bill' && <Modal title="Catat tagihan pemasok" onClose={() => setModal(null)} maxWidth="620px" footer={<><Button variant="secondary" onClick={() => setModal(null)}>Batal</Button><Button type="submit" form="cycle-bill-form"><Plus size={15} /> Simpan tagihan</Button></>}>
        <form id="cycle-bill-form" className="cycle-form" onSubmit={saveBill}>
          <p className="cycle-form-intro">Masukkan transaksi pembelian atau jasa dari pemasok fiktif.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field cycle-field-wide"><span>Nama pemasok</span><input className="input" maxLength={100} required value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} placeholder="Contoh: CV Sumber Komponen (Fiktif)" /></label>
            <label className="cycle-field"><span>Tanggal tagihan</span><input className="input" type="date" required value={draft.billDate} onChange={(event) => setDraft({ ...draft, billDate: event.target.value, dueDate: draft.dueDate < event.target.value ? event.target.value : draft.dueDate })} /></label>
            <label className="cycle-field"><span>Jatuh tempo</span><input className="input" type="date" min={draft.billDate} required value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            <label className="cycle-field cycle-field-wide"><span>Uraian</span><input className="input" maxLength={100} required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Bahan, jasa, atau biaya produksi" /></label>
            <label className="cycle-field"><span>Kategori</span><select className="input" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option>Persediaan bahan</option><option>Overhead produksi</option><option>Beban operasional</option></select></label>
            <label className="cycle-field"><span>Nilai tagihan (Rp)</span><input className="input" type="number" min="1" step="1000" required value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
          </div>
          <p className="cycle-form-hint">Tagihan baru masuk ke utang usaha. Pembayaran dicatat terpisah agar saldo sisa dapat dilacak.</p>
        </form>
      </Modal>}
      {modal === 'payment' && <Modal title="Catat pembayaran pemasok" onClose={() => setModal(null)} maxWidth="560px" footer={<><Button variant="secondary" onClick={() => setModal(null)}>Batal</Button><Button type="submit" form="cycle-payment-form"><Banknote size={15} /> Simpan pembayaran</Button></>}>
        <form id="cycle-payment-form" className="cycle-form" onSubmit={savePayment}>
          <p className="cycle-form-intro">Pembayaran mengurangi utang dan kas/bank di pratinjau jurnal.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field cycle-field-wide"><span>Tagihan</span><select className="input" value={payment.billId} required onChange={(event) => { const item = bills.find((row) => row.id === event.target.value); setPayment({ ...payment, billId: event.target.value, amount: item ? String(balance(item)) : '' }) }}>{outstanding.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.supplier} · sisa {money(balance(item))}</option>)}</select></label>
            <label className="cycle-field"><span>Tanggal bayar</span><input className="input" type="date" required value={payment.date} onChange={(event) => setPayment({ ...payment, date: event.target.value })} /></label>
            <label className="cycle-field"><span>Metode</span><select className="input" value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })}><option>Transfer bank</option><option>Kas</option></select></label>
            <label className="cycle-field cycle-field-wide"><span>Nominal (Rp)</span><input className="input" type="number" min="1" step="1000" required value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} /></label>
          </div>
          <p className="cycle-form-hint">Nominal pembayaran tidak boleh melebihi sisa tagihan.</p>
        </form>
      </Modal>}
    </>
  )
}
