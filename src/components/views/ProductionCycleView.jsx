import React, { useEffect, useMemo, useState } from 'react'
import { Boxes, Download, Factory, FileText, PackageCheck, Plus, Search, WalletCards } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { money } from '../../../src/utils/formatters.js'
import { CycleEmpty, CycleIntro, CycleJournal, CycleMetric, CycleStatus, CycleTabs, todayISO } from './CyclePrimitives.jsx'

const STORAGE_KEY = 'finova_production_cycle_demo_v1'
const VIEWS = [['summary', 'Ringkasan'], ['orders', 'Perintah produksi'], ['costing', 'Biaya produksi'], ['journal', 'Jurnal simulasi']]
const SEED = [
  { id: 'PRD-2026-001', date: '2026-08-05', product: 'Perlengkapan pertahanan A-01 (dummy)', quantity: 2, materialCost: 10000000, laborCost: 3000000, overheadCost: 2000000, status: 'complete', invoice: 'INV-2026-001' },
  { id: 'PRD-2026-002', date: '2026-08-18', product: 'Komponen pendukung B-02 (dummy)', quantity: 3, materialCost: 7000000, laborCost: 2000000, overheadCost: 1500000, status: 'complete', invoice: 'INV-2026-002' },
  { id: 'PRD-2026-003', date: '2026-09-02', product: 'Perlengkapan pertahanan C-03 (dummy)', quantity: 4, materialCost: 23000000, laborCost: 5000000, overheadCost: 4000000, status: 'complete', invoice: 'INV-2026-003' },
  { id: 'PRD-2026-004', date: '2026-09-08', product: 'Komponen pendukung D-04 (dummy)', quantity: 2, materialCost: 8000000, laborCost: 2000000, overheadCost: 2000000, status: 'complete', invoice: 'INV-2026-004' },
  { id: 'PRD-2026-005', date: '2026-09-15', product: 'Paket latihan E-05 (dummy)', quantity: 1, materialCost: 11000000, laborCost: 3000000, overheadCost: 3000000, status: 'complete', invoice: 'INV-2026-005' },
  { id: 'PRD-2026-006', date: '2026-09-22', product: 'Perlengkapan latihan F-06 (dummy)', quantity: 5, materialCost: 5000000, laborCost: 1000000, overheadCost: 2000000, status: 'complete', invoice: 'INV-2026-006' }
]
function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return SEED.map((item) => ({ ...item }))
}
function orderCost(item) { return Number(item.materialCost || 0) + Number(item.laborCost || 0) + Number(item.overheadCost || 0) }
function draftOrder() { return { date: todayISO(), product: '', quantity: '1', materialCost: '', laborCost: '', overheadCost: '0', status: 'planned', invoice: '' } }
function statusText(status) { return status === 'complete' ? 'Selesai' : status === 'progress' ? 'Dalam proses' : 'Direncanakan' }
function downloadCsv(orders) {
  const header = ['No Perintah', 'Tanggal', 'Produk', 'Jumlah unit', 'Bahan baku', 'Tenaga kerja langsung', 'Overhead', 'Total biaya', 'Status', 'No faktur terkait']
  const body = orders.map((row) => [row.id, row.date, row.product, row.quantity, row.materialCost, row.laborCost, row.overheadCost, orderCost(row), statusText(row.status), row.invoice])
  const csv = '\uFEFF' + [header, ...body].map((row) => row.map((value) => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = 'finova-siklus-produksi-demo.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

function ProductionTable({ rows, compact = false }) {
  return (
    <div className="cycle-table-wrap">
      <table className="cycle-table">
        <thead><tr><th>Perintah</th><th>Produk contoh</th><th className="num">Unit</th><th className="num">Bahan</th>{!compact && <th className="num">Tenaga kerja</th>}<th className="num">Biaya total</th><th>Status</th>{!compact && <th>Faktur</th>}</tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.id}><td><strong className="cycle-id">{row.id}</strong><small>{row.date}</small></td><td className="cycle-party"><strong>{row.product}</strong><small>Overhead {money(row.overheadCost)}</small></td><td className="num">{Number(row.quantity).toLocaleString('id-ID')}</td><td className="num">{money(row.materialCost)}</td>{!compact && <td className="num">{money(row.laborCost)}</td>}<td className="num">{money(orderCost(row))}</td><td><CycleStatus status={row.status} label={statusText(row.status)} /></td>{!compact && <td>{row.invoice || '—'}</td>}</tr>)}
          {!rows.length && <tr><td colSpan={compact ? 6 : 8} className="cycle-empty">Belum ada perintah produksi.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function ProductionCycleView({ notify = () => {} }) {
  const [orders, setOrders] = useState(loadOrders)
  const [view, setView] = useState('summary')
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState(draftOrder)
  const [query, setQuery] = useState('')
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(orders)) } catch { notify('Data produksi tidak dapat disimpan di browser.', true) }
  }, [orders, notify])

  const summary = useMemo(() => {
    const complete = orders.filter((row) => row.status === 'complete')
    const active = orders.filter((row) => row.status !== 'complete')
    const completedCost = complete.reduce((sum, row) => sum + orderCost(row), 0)
    const wipCost = active.reduce((sum, row) => sum + orderCost(row), 0)
    return {
      totalOrders: orders.length,
      completed: complete.length,
      units: complete.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      cost: completedCost,
      wip: wipCost,
      material: complete.reduce((sum, row) => sum + Number(row.materialCost || 0), 0),
      labor: complete.reduce((sum, row) => sum + Number(row.laborCost || 0), 0),
      overhead: complete.reduce((sum, row) => sum + Number(row.overheadCost || 0), 0)
    }
  }, [orders])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return [...orders].sort((a, b) => b.date.localeCompare(a.date)).filter((row) =>
      !needle || [row.id, row.product, row.invoice].some((value) => String(value || '').toLocaleLowerCase('id').includes(needle))
    )
  }, [orders, query])

  function saveOrder(event) {
    event.preventDefault()
    const quantity = Number(draft.quantity)
    const materialCost = Number(draft.materialCost)
    const laborCost = Number(draft.laborCost)
    const overheadCost = Number(draft.overheadCost)
    if (!draft.product.trim() || quantity <= 0 || materialCost < 0 || laborCost < 0 || overheadCost < 0) {
      notify('Lengkapi produk, jumlah unit, dan biaya dengan nilai yang benar.', true)
      return
    }
    const year = draft.date.slice(0, 4)
    const next = orders.filter((row) => row.id.startsWith('PRD-' + year + '-')).length + 1
    const order = { ...draft, id: 'PRD-' + year + '-' + String(next).padStart(3, '0'), quantity, materialCost, laborCost, overheadCost }
    setOrders((current) => [order, ...current])
    setModalOpen(false)
    setDraft(draftOrder())
    notify('Perintah produksi tersimpan di data demo.')
  }

  const journalEntries = orders.filter((row) => row.status === 'complete').map((row) => ({
    ref: row.id,
    date: row.date,
    description: 'Pemindahan hasil produksi ke barang jadi',
    debitAccount: 'Persediaan Barang Jadi',
    creditAccount: 'Barang Dalam Proses',
    amount: orderCost(row)
  }))

  return (
    <>
      <CycleIntro number="03" title="Siklus Produksi" description="Pantau perintah produksi, pemakaian bahan, tenaga kerja, dan overhead dalam satu alur." actions={<><Button variant="secondary" onClick={() => downloadCsv(orders)}><Download size={15} /> Ekspor CSV</Button><Button onClick={() => { setDraft(draftOrder()); setModalOpen(true) }}><Plus size={15} /> Buat perintah</Button></>} />
      <CycleTabs value={view} items={VIEWS} onChange={setView} />
      <div className="cycle-page-label"><span>{VIEWS.find(([key]) => key === view)?.[1]}</span><span>{summary.totalOrders} perintah <i>·</i> Data simulasi</span></div>

      {view === 'summary' && <>
        <div className="cycle-metrics">
          <CycleMetric label="Perintah selesai" value={summary.completed + ' / ' + summary.totalOrders} note="Batch selesai diproses" Icon={PackageCheck} />
          <CycleMetric label="Unit selesai" value={summary.units} note="Jumlah unit dalam contoh" Icon={Boxes} tone="is-blue" />
          <CycleMetric label="Biaya produksi" value={summary.cost} note="Bahan + tenaga kerja + overhead" Icon={WalletCards} tone="is-amber" />
          <CycleMetric label="Barang dalam proses" value={summary.wip} note="Biaya order yang belum selesai" Icon={Factory} tone="is-purple" />
        </div>
        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Susunan biaya produksi</h2><p>Total untuk batch yang selesai.</p></div><WalletCards size={18} aria-hidden="true" /></div>
            <div className="cycle-breakdown">
              {[
                ['Bahan baku', summary.material],
                ['Tenaga kerja langsung', summary.labor],
                ['Overhead produksi', summary.overhead]
              ].map(([label, value]) => <div className="cycle-breakdown-row" key={label}><span>{label}</span><div className="cycle-track"><i style={{ width: (summary.cost ? value / summary.cost * 100 : 0) + '%' }} /></div><strong>{money(value)}</strong></div>)}
            </div>
            <div className="cycle-card-foot"><span>Total biaya batch selesai</span><strong>{money(summary.cost)}</strong></div>
          </section>
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Alur produksi</h2><p>Dokumen utama yang menghubungkan tahap ini.</p></div><FileText size={18} aria-hidden="true" /></div>
            <div className="cycle-flow"><div><b>01</b><span>Perintah produksi</span></div><i /><div><b>02</b><span>Pencatatan biaya</span></div><i /><div><b>03</b><span>Barang jadi</span></div></div>
            <p className="cycle-control-note">Biaya per batch adalah contoh pembelajaran dan belum memutakhirkan persediaan atau buku besar aktif.</p>
          </section>
        </div>
        <section className="panel panel-tight cycle-recent"><div className="cycle-table-heading"><div><h2>Batch terbaru</h2><p>Hubungan dengan faktur penjualan contoh ditampilkan bila tersedia.</p></div><Button small variant="ghost" onClick={() => setView('orders')}>Lihat semua</Button></div><ProductionTable rows={[...orders].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)} compact /></section>
      </>}

      {view === 'orders' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading"><div><h2>Perintah produksi</h2><p>Catat produk contoh, jumlah, dan status prosesnya.</p></div><label className="cycle-search"><Search size={15} /><span className="sr-only">Cari perintah produksi</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari produk atau nomor perintah" /></label></div>
        <ProductionTable rows={filtered} />
      </section>}

      {view === 'costing' && <>
        <div className="cycle-aging"><article><span>Bahan baku</span><strong>{money(summary.material)}</strong><small>Dialokasikan ke batch selesai</small></article><article className="is-blue"><span>Tenaga kerja langsung</span><strong>{money(summary.labor)}</strong><small>Dari payroll contoh</small></article><article className="is-amber"><span>Overhead produksi</span><strong>{money(summary.overhead)}</strong><small>Biaya pendukung contoh</small></article></div>
        <section className="panel panel-tight cycle-table-panel"><div className="cycle-table-heading"><div><h2>Rincian biaya per batch</h2><p>Harga pokok batch dihitung dari jumlah tiga komponen biaya.</p></div></div><div className="cycle-table-wrap"><table className="cycle-table"><thead><tr><th>Batch & produk</th><th className="num">Bahan baku</th><th className="num">Tenaga kerja</th><th className="num">Overhead</th><th className="num">Jumlah</th><th className="num">Biaya / unit</th></tr></thead><tbody>{orders.map((row) => <tr key={row.id}><td className="cycle-party"><strong>{row.id}</strong><small>{row.product}</small></td><td className="num">{money(row.materialCost)}</td><td className="num">{money(row.laborCost)}</td><td className="num">{money(row.overheadCost)}</td><td className="num">{money(orderCost(row))}</td><td className="num">{money(orderCost(row) / Math.max(1, Number(row.quantity)))}</td></tr>)}{!orders.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada rincian biaya.</td></tr>}</tbody></table></div></section>
      </>}
      {view === 'journal' && <CycleJournal entries={journalEntries} explanation="Perpindahan biaya produksi ke barang jadi hanya ditampilkan sebagai contoh dan tidak diposting." />}
      <div className="cycle-footnote"><FileText size={14} /><span>Nama barang dan biaya bersifat fiktif. Tidak memuat spesifikasi teknis produk atau proses pembuatan senjata.</span></div>

      {modalOpen && <Modal title="Buat perintah produksi" onClose={() => setModalOpen(false)} maxWidth="660px" footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Batal</Button><Button type="submit" form="cycle-production-form"><Plus size={15} /> Simpan perintah</Button></>}>
        <form id="cycle-production-form" className="cycle-form" onSubmit={saveOrder}>
          <p className="cycle-form-intro">Isi estimasi biaya batch contoh untuk menelusuri pemakaian sumber daya.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field cycle-field-wide"><span>Produk / jasa contoh</span><input className="input" required maxLength={100} value={draft.product} onChange={(event) => setDraft({ ...draft, product: event.target.value })} placeholder="Nama produk fiktif" /></label>
            <label className="cycle-field"><span>Tanggal perintah</span><input className="input" type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
            <label className="cycle-field"><span>Jumlah unit</span><input className="input" type="number" min="1" step="1" required value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
            <label className="cycle-field"><span>Bahan baku (Rp)</span><input className="input" type="number" min="0" step="1000" required value={draft.materialCost} onChange={(event) => setDraft({ ...draft, materialCost: event.target.value })} /></label>
            <label className="cycle-field"><span>Tenaga kerja langsung (Rp)</span><input className="input" type="number" min="0" step="1000" required value={draft.laborCost} onChange={(event) => setDraft({ ...draft, laborCost: event.target.value })} /></label>
            <label className="cycle-field"><span>Overhead (Rp)</span><input className="input" type="number" min="0" step="1000" required value={draft.overheadCost} onChange={(event) => setDraft({ ...draft, overheadCost: event.target.value })} /></label>
            <label className="cycle-field"><span>Status</span><select className="input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="planned">Direncanakan</option><option value="progress">Dalam proses</option><option value="complete">Selesai</option></select></label>
            <label className="cycle-field cycle-field-wide"><span>Faktur terkait (opsional)</span><input className="input" maxLength={40} value={draft.invoice} onChange={(event) => setDraft({ ...draft, invoice: event.target.value })} placeholder="Contoh: INV-2026-007" /></label>
          </div>
          <p className="cycle-form-hint">Total biaya adalah bahan baku + tenaga kerja langsung + overhead. Semua angka masih data demo.</p>
        </form>
      </Modal>}
    </>
  )
}
