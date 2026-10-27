import React, { useEffect, useMemo, useState } from 'react'
import { Banknote, CalendarDays, Download, FileText, Plus, Search, Users, WalletCards } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { money } from '../../../src/utils/formatters.js'
import { CycleEmpty, CycleIntro, CycleJournal, CycleMetric, CycleStatus, CycleTabs, todayISO } from './CyclePrimitives.jsx'

const STORAGE_KEY = 'finova_payroll_cycle_demo_v1'
const VIEWS = [['summary', 'Ringkasan'], ['payroll', 'Daftar gaji'], ['employees', 'Karyawan'], ['journal', 'Jurnal simulasi']]
const PEOPLE = [
  { employeeId: 'AR-001', name: 'Raka Wibisana', department: 'Produksi' },
  { employeeId: 'AR-002', name: 'Nadia Prameswari', department: 'Produksi' },
  { employeeId: 'AR-003', name: 'Bima Santosa', department: 'Administrasi' },
  { employeeId: 'AR-004', name: 'Tara Kusumawardani', department: 'Penjualan' }
]
const SEED = ['2026-08', '2026-09'].flatMap((period) => PEOPLE.map((person, index) => {
  const gross = [4500000, 3500000, 5000000, 4000000][index]
  const deduction = [300000, 200000, 300000, 200000][index]
  const paidDate = period === '2026-08' ? '2026-09-01' : '2026-10-01'
  return {
    id: 'PAY-' + period + '-' + person.employeeId,
    period,
    ...person,
    gross,
    deductions: deduction,
    net: gross - deduction,
    paid: true,
    payDate: paidDate
  }
}))
function loadPayroll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return SEED.map((item) => ({ ...item }))
}
function draftSlip() {
  return { period: todayISO().slice(0, 7), employeeId: '', name: '', department: 'Produksi', gross: '', deductions: '0', paid: false, payDate: todayISO() }
}
function downloadCsv(rows) {
  const header = ['ID Slip', 'Periode', 'ID Karyawan', 'Nama (Fiktif)', 'Bagian', 'Gaji Kotor', 'Potongan Simulasi', 'Gaji Bersih', 'Status', 'Tanggal Bayar']
  const body = rows.map((row) => [row.id, row.period, row.employeeId, row.name, row.department, row.gross, row.deductions, row.net, row.paid ? 'Dibayar' : 'Menunggu', row.payDate || ''])
  const csv = '\uFEFF' + [header, ...body].map((row) => row.map((value) => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  link.download = 'finova-siklus-penggajian-demo.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}
function periodLabel(period) {
  const date = new Date(period + '-15T12:00:00')
  return Number.isNaN(date.getTime()) ? period : new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
}

function PayrollTable({ rows, onPay, compact = false }) {
  return (
    <div className="cycle-table-wrap">
      <table className="cycle-table">
        <thead><tr><th>Periode</th><th>Karyawan contoh</th><th>Bagian</th><th className="num">Gaji kotor</th><th className="num">Potongan</th><th className="num">Gaji bersih</th><th>Status</th>{!compact && <th />}</tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.id}><td><strong className="cycle-id">{periodLabel(row.period)}</strong><small>{row.id}</small></td><td className="cycle-party"><strong>{row.name}</strong><small>{row.employeeId}</small></td><td>{row.department}</td><td className="num">{money(row.gross)}</td><td className="num">{money(row.deductions)}</td><td className="num">{money(row.net)}</td><td><CycleStatus status={row.paid ? 'paid' : 'open'} label={row.paid ? 'Dibayar' : 'Menunggu'}></CycleStatus></td>{!compact && <td className="cycle-action-cell">{!row.paid && <Button small variant="secondary" onClick={() => onPay(row.id)}>Tandai dibayar</Button>}</td>}</tr>)}
          {!rows.length && <tr><td className="cycle-empty" colSpan={compact ? 7 : 8}>Belum ada slip gaji.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export function PayrollCycleView({ notify = () => {} }) {
  const [rows, setRows] = useState(loadPayroll)
  const [view, setView] = useState('summary')
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState(draftSlip)
  const [query, setQuery] = useState('')
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)) } catch { notify('Data penggajian tidak dapat disimpan di browser.', true) }
  }, [rows, notify])

  const summary = useMemo(() => {
    const employees = new Set(rows.map((row) => row.employeeId)).size
    return {
      employees,
      gross: rows.reduce((sum, row) => sum + Number(row.gross || 0), 0),
      deductions: rows.reduce((sum, row) => sum + Number(row.deductions || 0), 0),
      netPaid: rows.filter((row) => row.paid).reduce((sum, row) => sum + Number(row.net || 0), 0),
      pending: rows.filter((row) => !row.paid).reduce((sum, row) => sum + Number(row.net || 0), 0),
      periods: new Set(rows.map((row) => row.period)).size
    }
  }, [rows])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return [...rows].sort((a, b) => b.period.localeCompare(a.period) || a.employeeId.localeCompare(b.employeeId)).filter((row) =>
      !needle || [row.id, row.employeeId, row.name, row.department, row.period].some((value) => String(value).toLocaleLowerCase('id').includes(needle))
    )
  }, [rows, query])
  const employees = useMemo(() => {
    const map = new Map()
    rows.forEach((row) => {
      const entry = map.get(row.employeeId) || { ...row, periods: 0, totalGross: 0, totalNet: 0 }
      entry.periods += 1
      entry.totalGross += Number(row.gross || 0)
      entry.totalNet += Number(row.net || 0)
      map.set(row.employeeId, entry)
    })
    return [...map.values()].sort((a, b) => a.employeeId.localeCompare(b.employeeId))
  }, [rows])

  function saveSlip(event) {
    event.preventDefault()
    const gross = Number(draft.gross)
    const deductions = Number(draft.deductions)
    if (!draft.name.trim() || !draft.employeeId.trim() || gross <= 0 || deductions < 0 || deductions > gross) {
      notify('Periksa ID, nama, gaji, dan potongan. Nilai potongan tidak boleh melebihi gaji.', true)
      return
    }
    const id = 'PAY-' + draft.period + '-' + draft.employeeId.trim().toUpperCase()
    if (rows.some((row) => row.id === id)) { notify('Slip gaji untuk karyawan dan periode tersebut sudah ada.', true); return }
    const paid = Boolean(draft.paid)
    setRows((current) => [{
      ...draft,
      id,
      employeeId: draft.employeeId.trim().toUpperCase(),
      name: draft.name.trim(),
      gross,
      deductions,
      net: gross - deductions,
      paid,
      payDate: paid ? draft.payDate : ''
    }, ...current])
    setModalOpen(false)
    setDraft(draftSlip())
    notify('Slip gaji tersimpan di data demo.')
  }
  function markPaid(id) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, paid: true, payDate: todayISO() } : row))
    notify('Status pembayaran diperbarui di simulasi.')
  }

  const productionWages = rows.reduce((sum, row) => sum + (row.department === 'Produksi' ? Number(row.gross || 0) : 0), 0)
  const otherWages = summary.gross - productionWages
  const journalEntries = [
    ...(productionWages ? [{ ref: 'ALOKASI-PRODUKSI', date: todayISO(), description: 'Alokasi gaji langsung ke biaya produksi', debitAccount: 'Barang Dalam Proses', creditAccount: 'Utang Gaji', amount: productionWages }] : []),
    ...(otherWages ? [{ ref: 'ALOKASI-OPERASIONAL', date: todayISO(), description: 'Beban gaji bagian nonproduksi', debitAccount: 'Beban Gaji', creditAccount: 'Utang Gaji', amount: otherWages }] : []),
    ...(summary.netPaid ? [{ ref: 'PEMBAYARAN-GAJI', date: todayISO(), description: 'Pembayaran gaji bersih', debitAccount: 'Utang Gaji', creditAccount: 'Kas di Bank', amount: summary.netPaid }] : []),
    ...(summary.deductions ? [{ ref: 'POTONGAN-GAJI', date: todayISO(), description: 'Pencatatan potongan simulasi', debitAccount: 'Utang Gaji', creditAccount: 'Utang Potongan', amount: summary.deductions }] : [])
  ]

  return (
    <>
      <CycleIntro number="04" title="Siklus Penggajian / SDM" description="Kelola data karyawan contoh, periode gaji, potongan simulasi, dan status pembayaran." actions={<><Button variant="secondary" onClick={() => downloadCsv(rows)}><Download size={15} /> Ekspor CSV</Button><Button onClick={() => { setDraft(draftSlip()); setModalOpen(true) }}><Plus size={15} /> Tambah slip gaji</Button></>} />
      <CycleTabs value={view} items={VIEWS} onChange={setView} />
      <div className="cycle-page-label"><span>{VIEWS.find(([key]) => key === view)?.[1]}</span><span>{summary.employees} karyawan fiktif <i>·</i> Data simulasi</span></div>

      {view === 'summary' && <>
        <div className="cycle-metrics">
          <CycleMetric label="Karyawan contoh" value={summary.employees} note="ID dan nama bersifat fiktif" Icon={Users} />
          <CycleMetric label="Gaji kotor" value={summary.gross} note={summary.periods + ' periode payroll'} Icon={WalletCards} tone="is-blue" />
          <CycleMetric label="Potongan simulasi" value={summary.deductions} note="Tidak menghitung pajak otomatis" Icon={FileText} tone="is-amber" />
          <CycleMetric label="Gaji bersih dibayar" value={summary.netPaid} note={summary.pending ? money(summary.pending) + ' masih menunggu' : 'Seluruh slip contoh dibayar'} Icon={Banknote} tone="is-green" />
        </div>
        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Ringkasan periode</h2><p>Komponen penggajian untuk data contoh.</p></div><CalendarDays size={18} /></div>
            <div className="cycle-period-list">{[...new Set(rows.map((row) => row.period))].sort().map((period) => {
              const group = rows.filter((row) => row.period === period)
              const gross = group.reduce((sum, row) => sum + Number(row.gross || 0), 0)
              const net = group.filter((row) => row.paid).reduce((sum, row) => sum + Number(row.net || 0), 0)
              return <div key={period}><span><strong>{periodLabel(period)}</strong><small>{group.length} slip</small></span><b>{money(gross)}</b><small className="cycle-period-net">Dibayar {money(net)}</small></div>
            })}</div>
          </section>
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Catatan pengendalian</h2><p>Hal yang perlu dilihat sebelum pembayaran gaji.</p></div><FileText size={18} /></div>
            <div className="cycle-check-row"><span className="cycle-check-mark">01</span><span><strong>Periksa data induk</strong><small>Pastikan ID karyawan dan periode tidak ganda.</small></span></div>
            <div className="cycle-check-row"><span className="cycle-check-mark">02</span><span><strong>Telusuri potongan</strong><small>Nilai potongan pada contoh diisi manual.</small></span></div>
            <div className="cycle-check-row"><span className="cycle-check-mark">03</span><span><strong>Catat pembayaran</strong><small>Status dibayar menyimpan tanggal bayar simulasi.</small></span></div>
          </section>
        </div>
        <section className="panel panel-tight cycle-recent"><div className="cycle-table-heading"><div><h2>Slip gaji terbaru</h2><p>Gaji bersih = gaji kotor dikurangi potongan simulasi.</p></div><Button small variant="ghost" onClick={() => setView('payroll')}>Lihat semua</Button></div><PayrollTable rows={filtered.slice(0, 5)} onPay={markPaid} compact /></section>
      </>}
      {view === 'payroll' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading"><div><h2>Daftar gaji</h2><p>Slip gaji contoh dapat ditambah dan statusnya dapat diperbarui.</p></div><label className="cycle-search"><Search size={15} /><span className="sr-only">Cari slip gaji</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari karyawan, periode, atau ID" /></label></div>
        <PayrollTable rows={filtered} onPay={markPaid} />
      </section>}
      {view === 'employees' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading"><div><h2>Daftar karyawan contoh</h2><p>Ringkasan diambil dari slip yang tersimpan.</p></div></div>
        <div className="cycle-table-wrap"><table className="cycle-table"><thead><tr><th>ID karyawan</th><th>Nama (fiktif)</th><th>Bagian</th><th className="num">Periode tercatat</th><th className="num">Gaji kotor tercatat</th><th className="num">Gaji bersih tercatat</th></tr></thead><tbody>{employees.map((row) => <tr key={row.employeeId}><td><strong className="cycle-id">{row.employeeId}</strong></td><td>{row.name}</td><td>{row.department}</td><td className="num">{row.periods}</td><td className="num">{money(row.totalGross)}</td><td className="num">{money(row.totalNet)}</td></tr>)}{!employees.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada karyawan contoh.</td></tr>}</tbody></table></div>
      </section>}
      {view === 'journal' && <CycleJournal entries={journalEntries} explanation="Contoh pengakuan beban, pembayaran bersih, dan potongan. Tidak masuk ke jurnal resmi." />}
      <div className="cycle-footnote"><FileText size={14} /><span>Semua nama, gaji, dan potongan adalah data latihan. Perhitungan pajak dan kepatuhan penggajian tidak disimulasikan.</span></div>

      {modalOpen && <Modal title="Tambah slip gaji" onClose={() => setModalOpen(false)} maxWidth="640px" footer={<><Button variant="secondary" onClick={() => setModalOpen(false)}>Batal</Button><Button type="submit" form="cycle-payroll-form"><Plus size={15} /> Simpan slip</Button></>}>
        <form id="cycle-payroll-form" className="cycle-form" onSubmit={saveSlip}>
          <p className="cycle-form-intro">Slip baru akan tersimpan sebagai data demo lokal.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Periode gaji</span><input className="input" type="month" required value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value })} /></label>
            <label className="cycle-field"><span>ID karyawan</span><input className="input" maxLength={20} required value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })} placeholder="AR-005" /></label>
            <label className="cycle-field cycle-field-wide"><span>Nama karyawan (fiktif)</span><input className="input" maxLength={100} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nama untuk data latihan" /></label>
            <label className="cycle-field"><span>Bagian</span><select className="input" value={draft.department} onChange={(event) => setDraft({ ...draft, department: event.target.value })}><option>Produksi</option><option>Administrasi</option><option>Penjualan</option><option>SDM</option></select></label>
            <label className="cycle-field"><span>Status pembayaran</span><select className="input" value={draft.paid ? 'paid' : 'pending'} onChange={(event) => setDraft({ ...draft, paid: event.target.value === 'paid' })}><option value="pending">Menunggu pembayaran</option><option value="paid">Sudah dibayar</option></select></label>
            <label className="cycle-field"><span>Gaji kotor (Rp)</span><input className="input" type="number" min="1" step="1000" required value={draft.gross} onChange={(event) => setDraft({ ...draft, gross: event.target.value })} /></label>
            <label className="cycle-field"><span>Potongan simulasi (Rp)</span><input className="input" type="number" min="0" step="1000" required value={draft.deductions} onChange={(event) => setDraft({ ...draft, deductions: event.target.value })} /></label>
            {draft.paid && <label className="cycle-field cycle-field-wide"><span>Tanggal bayar</span><input className="input" type="date" required value={draft.payDate} onChange={(event) => setDraft({ ...draft, payDate: event.target.value })} /></label>}
          </div>
          <div className="cycle-form-total"><span>Gaji bersih<small>Gaji kotor dikurangi potongan</small></span><strong>{money(Math.max(0, Number(draft.gross || 0) - Number(draft.deductions || 0)))}</strong></div>
          <p className="cycle-form-hint">Nilai potongan diisi sebagai contoh manual dan tidak mewakili tarif pajak atau aturan resmi.</p>
        </form>
      </Modal>}
    </>
  )
}
