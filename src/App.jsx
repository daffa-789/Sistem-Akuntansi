import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {
  BookOpen, Building2, CalendarDays, ChevronDown, CircleDollarSign, ClipboardList,
  Download, FileBarChart, FileSpreadsheet, FolderCog, Landmark, LayoutDashboard,
  LogOut, Menu, PenLine, Plus, ReceiptText, RefreshCw, Send, Settings, ShieldCheck,
  Upload, UserCog, Users as UsersIcon, WalletCards, X, CheckCircle2, AlertTriangle, ArrowUpRight,
  FileText, RotateCcw, LockKeyhole, Search, Moon, Sun, Printer, Layers, Copy, History, HelpCircle
} from 'lucide-react'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ExcelJS from 'exceljs'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { download, request } from './api.js'

const today = () => new Date().toISOString().slice(0, 10)
const firstDay = () => `${today().slice(0, 8)}01`
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
const money = (value) => rupiah.format(Number(value || 0))
const number = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value || 0))
const dateLabel = (value) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)) : '\u2014'
const apiPath = (path, values = {}) => `${path}?${new URLSearchParams(Object.entries(values).filter(([, value]) => value !== '' && value !== undefined && value !== null)).toString()}`
const formatNum = (v) => { const s = String(v).replace(/[^0-9]/g, ''); if (!s) return ''; return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.') }
const parseNum = (v) => Number(String(v).replace(/\./g, '')) || 0
const GL = { ASSET: 'Aktiva', LIABILITY: 'Liabilitas', EQUITY: 'Ekuitas', REVENUE: 'Pendapatan', EXPENSE: 'Beban' }

const nav = [
  ['dashboard', 'Dashboard', LayoutDashboard], ['journals', 'Jurnal', ReceiptText], ['imports', 'Impor Excel', Upload],
  ['reports', 'Laporan', FileBarChart], ['accounts', 'Daftar Akun', BookOpen], ['periods', 'Periode', CalendarDays],
  ['users', 'Pengguna', UsersIcon], ['settings', 'Pengaturan', Settings]
]

function useLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  const reload = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }))
    try { setState({ loading: false, data: await loader(), error: '' }) }
    catch (e) { setState({ loading: false, data: null, error: e.message }) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}

function PageLoading() { return <div className="loading"><div><div className="spinner" /><div>Memuat data\u2026</div></div></div> }
function Empty({ children = 'Belum ada data. Mulai tambahkan untuk melihat hasilnya di sini.' }) { return <div className="empty"><FileText /><div>{children}</div></div> }
function Badge({ status }) {
  const v = String(status || '').toUpperCase()
  const c = v === 'POSTED' || v === 'OPEN' || v === 'ADMIN' ? 'green' : v === 'DRAFT' ? 'amber' : v === 'CLOSED' || v === 'VOID' ? 'slate' : 'red'
  const t = ({ POSTED: 'Terposting', DRAFT: 'Draft', OPEN: 'Terbuka', CLOSED: 'Terkunci', ADMIN: 'Admin', STAFF: 'Staf' })[v] || status
  return <span className={`badge ${c}`}>{t}</span>
}
function Button({ children, variant = 'primary', small = false, ...p }) { return <button className={`button ${variant} ${small ? 'small' : ''}`} {...p}>{children}</button> }
function Modal({ title, children, onClose, footer }) { return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose}><X /></button></div><div className="modal-body">{children}</div>{footer && <div className="modal-foot">{footer}</div>}</div></div> }
function ErrorNotice({ error }) { return error ? <div className="error-box"><AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />{error}</div> : null }
function FieldWarning({ message }) { return message ? <div className="field-warning">{message}</div> : null }

function validateJournal(form) {
  const errors = {}
  if (!form.entryDate) errors.entryDate = 'Tanggal transaksi wajib diisi.'
  if (!form.description.trim()) errors.description = 'Keterangan transaksi wajib diisi agar mudah dilacak.'
  const filled = form.lines.filter(l => l.account_id && (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0))
  if (filled.length < 2) errors.lines = 'Minimal 2 baris dengan akun dan nominal terisi untuk membentuk jurnal berpasangan.'
  const lineErrors = form.lines.map((l, i) => {
    const e = {}
    if (!l.account_id && (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)) e.account = `Pilih akun terlebih dahulu.`
    if (l.account_id && Number(l.debit || 0) === 0 && Number(l.credit || 0) === 0) e.amount = `Isi nominal debit atau kredit.`
    if (Number(l.debit || 0) > 0 && Number(l.credit || 0) > 0) e.both = `Hanya isi salah satu, debit atau kredit.`
    return Object.keys(e).length ? e : null
  })
  return { valid: !Object.keys(errors).length && lineErrors.every(e => !e), errors, lineErrors }
}

function GlobalSearch({ open, onClose, accounts, setRoute }) {
  const [q, setQ] = useState('')
  const ref = useRef(null)
  useEffect(() => { if (open) { setQ(''); setTimeout(() => ref.current?.focus(), 50) } }, [open])
  const results = useMemo(() => {
    if (q.trim().length < 2) return []
    const s = q.toLowerCase()
    return accounts.filter(a => a.code.toLowerCase().includes(s) || a.name.toLowerCase().includes(s)).slice(0, 10).map(a => ({ label: `${a.code} \u2014 ${a.name}`, group: GL[a.account_group] || a.account_group }))
  }, [q, accounts])
  if (!open) return null
  return <div className="modal-backdrop search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="search-modal">
      <div className="search-header"><Search size={18} /><input ref={ref} className="search-input" placeholder="Cari akun... (ketik minimal 2 huruf)" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose() }} /></div>
      <div className="search-results">{results.map((r, i) => <button key={i} className="search-item" onClick={() => { setRoute('accounts'); onClose() }}><span className="search-type">{r.group}</span><span>{r.label}</span></button>)}{q.trim().length >= 2 && !results.length && <div className="search-empty">Tidak ditemukan hasil untuk "{q}"</div>}{q.trim().length < 2 && <div className="search-empty">Ketik minimal 2 huruf untuk mencari.</div>}</div>
    </div>
  </div>
}

function OnboardingWalkthrough({ done }) {
  const [step, setStep] = useState(0)
  const steps = [
    { title: 'Navigasi Sidebar', text: 'Gunakan menu di sisi kiri untuk berpindah antar halaman seperti Dashboard, Jurnal, Laporan, dan lainnya.' },
    { title: 'Catat Jurnal Baru', text: 'Klik tombol "Jurnal baru" di halaman Jurnal untuk mulai mencatat transaksi keuangan perusahaan Anda.' },
    { title: 'Lihat Laporan Otomatis', text: 'Semua jurnal yang sudah diposting otomatis tersaji dalam 7 jenis laporan keuangan siap pakai.' },
    { title: 'Kelola Daftar Akun', text: 'Tambahkan dan atur chart of accounts perusahaan Anda di halaman Daftar Akun.' },
    { title: 'Anda Siap!', text: 'Finova siap membantu pembukuan Anda. Panduan ini bisa diulang kapan saja dari ikon bantuan.' }
  ]
  const s = steps[step]
  return <div className="onboard-overlay"><div className="onboard-card"><h3>{s.title}</h3><p>{s.text}</p><div className="onboard-footer"><span className="muted">{step + 1} / {steps.length}</span><div style={{ display: 'flex', gap: 8 }}><Button variant="secondary" small onClick={done}>Lewati</Button><Button small onClick={() => step < steps.length - 1 ? setStep(step + 1) : done()}>{step < steps.length - 1 ? 'Berikutnya' : 'Mulai'}</Button></div></div></div></div>
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@finova.local')
  const [password, setPassword] = useState('Admin123!')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { onLogin((await request('/auth/login', { method: 'POST', body: { email, password } })).user) }
    catch (r) { setError(r.message) } finally { setBusy(false) }
  }
  return <div className="login-page">
    <section className="login-aside"><div><div className="brand" style={{ padding: 0 }}><span className="brand-mark"><Landmark /></span>Finova</div><h1>Keuangan rapi, keputusan lebih pasti.</h1><p>Sistem akuntansi perusahaan yang mengubah setiap transaksi menjadi laporan keuangan siap baca.</p><div className="feature-list"><div className="feature"><CheckCircle2 /> Jurnal berpasangan dan periode terkunci</div><div className="feature"><CheckCircle2 /> Impor Excel dengan validasi otomatis</div><div className="feature"><CheckCircle2 /> Laporan real-time dan siap diekspor</div></div></div><small>FINOVA \u00b7 SISTEM AKUNTANSI INDONESIA</small></section>
    <main className="login-form-wrap"><form className="login-card" onSubmit={submit}><div className="brand" style={{ padding: 0, color: '#0b5a39' }}><span className="brand-mark"><Landmark /></span>Finova</div><h2>Selamat datang</h2><p>Masuk untuk melanjutkan pencatatan keuangan perusahaan Anda.</p><div className="login-form"><div className="field"><label>EMAIL</label><input className="input" value={email} onChange={e => setEmail(e.target.value)} type="email" required placeholder="nama@email.com" /></div><div className="field"><label>KATA SANDI</label><input className="input" value={password} onChange={e => setPassword(e.target.value)} type="password" required placeholder="Masukkan kata sandi" /></div><ErrorNotice error={error} /><Button disabled={busy}>{busy ? 'Memproses\u2026' : <><LogOut /> Masuk ke Finova</>}</Button></div><div className="demo-note"><strong>Akun awal:</strong><br />admin@finova.local / Admin123!<br />Ubah lewat variabel lingkungan sebelum dipakai di produksi.</div></form></main>
  </div>
}

function AppShell({ user, company, route, setRoute, onLogout, dark, setDark, onSearch, children }) {
  const item = nav.find(([k]) => k === route) || nav[0]
  const menus = nav.filter(([k]) => user.role === 'ADMIN' || !['imports', 'accounts', 'periods', 'users', 'settings'].includes(k))
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Landmark /></span>Finova</div><div className="company-label">{company?.name || 'Perusahaan Anda'}</div><div className="nav-list">{menus.map(([k, label, Icon]) => <button key={k} className={`nav-item ${route === k ? 'active' : ''}`} onClick={() => setRoute(k)}><Icon /><span>{label}</span></button>)}</div><div className="sidebar-bottom">Pembukuan lebih tenang.<br />Data tersimpan dengan jejak audit.</div></aside>
    <main className="main"><header className="topbar"><div className="breadcrumb">Sistem Akuntansi<strong>{item[1]}</strong></div><div className="profile-chip"><button className="icon-button" title="Cari (Ctrl+K)" onClick={onSearch}><Search size={16} /></button><button className="icon-button" title={dark ? 'Mode terang' : 'Mode gelap'} onClick={() => setDark(!dark)}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><div className="profile-name">{user.name}</div><div className="profile-role">{user.role === 'ADMIN' ? 'Administrator' : 'Staf Keuangan'}</div></div><button className="icon-button" title="Keluar" onClick={onLogout}><LogOut size={16} /></button></div></header><div className="content">{children}</div><nav className="mobile-nav">{menus.slice(0, 5).map(([k, label, Icon]) => <button key={k} className={`nav-item ${route === k ? 'active' : ''}`} title={label} onClick={() => setRoute(k)}><Icon /><span>{label}</span></button>)}</nav></main>
  </div>
}

function Dashboard() {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const { data, loading, error, reload } = useLoad(() => request(apiPath('/reports/dashboard', range)), [range.from, range.to])
  if (loading) return <PageLoading />
  const v = data?.data
  const stats = v ? [['Kas & Bank', v.cashBank, WalletCards], ['Piutang', v.receivables, ArrowUpRight], ['Utang Usaha', v.payables, ReceiptText], ['Pendapatan', v.revenue, CircleDollarSign], ['Laba Bersih', v.netIncome, Landmark]] : []
  const chart = v ? [{ name: 'Pendapatan', value: v.revenue }, { name: 'Beban', value: v.expenses }, { name: 'Laba', value: v.netIncome }] : []
  return <><div className="toolbar"><div><h1 className="page-title">Ringkasan keuangan</h1><p className="page-copy">Pantau posisi dan kinerja perusahaan dalam satu tempat.</p></div><div className="filter-row"><div className="field"><label>DARI</label><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div><div className="field"><label>SAMPAI</label><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div><Button variant="secondary" small onClick={reload}><RefreshCw /> Segarkan</Button></div></div><ErrorNotice error={error} />
    <div className="stats">{stats.map(([l, val, Icon]) => <article className="stat-card" key={l}><div className="stat-label">{l}</div><div className={`stat-value ${l === 'Laba Bersih' && val < 0 ? 'bad' : ''}`}>{money(val)}</div><div className="stat-icon"><Icon /></div></article>)}</div>
    {v && <div className="grid-two"><section className="panel"><h3 className="panel-title">Kinerja periode ini</h3><p className="panel-subtitle">Perbandingan pendapatan, beban, dan laba bersih.</p><div style={{ height: 270 }}><ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} /><YAxis tickFormatter={val => `${Math.round(val / 1000000)} jt`} tickLine={false} axisLine={false} /><Tooltip formatter={val => money(val)} /><Bar dataKey="value" fill="#168b55" radius={[7, 7, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="panel"><h3 className="panel-title">Perhatian akuntansi</h3><p className="panel-subtitle">Kontrol sederhana untuk pembukuan yang sehat.</p><div className="report-line"><span>Periode aktif</span><strong>{dateLabel(range.from)} \u2014 {dateLabel(range.to)}</strong></div><div className="report-line"><span>Status pembukuan</span><Badge status="OPEN" /></div><div className="report-line"><span>Saldo kas dan bank</span><strong>{money(v.cashBank)}</strong></div><div className="report-line"><span>Posisi laba</span><strong className={v.netIncome < 0 ? 'bad' : 'good'}>{v.netIncome >= 0 ? 'Surplus' : 'Defisit'}</strong></div><div className="report-line total"><span>Total beban</span><strong>{money(v.expenses)}</strong></div></section></div>}
  </>
}

function AuditLogModal({ journalId, onClose }) {
  const { data, loading } = useLoad(() => request(`/journals/${journalId}/audit`), [journalId])
  return <Modal title="Riwayat perubahan jurnal" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Tutup</Button>}>
    {loading ? <PageLoading /> : <div className="table-wrap"><table className="table"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Detail</th></tr></thead><tbody>{data?.logs?.map((l, i) => <tr key={i}><td>{dateLabel(l.created_at)}</td><td>{l.user_name || 'Sistem'}</td><td><Badge status={l.action === 'POSTED' ? 'POSTED' : l.action === 'CREATED' ? 'DRAFT' : 'OPEN'} />{l.action_label}</td><td className="muted">{l.details_json ? JSON.stringify(l.details_json).slice(0, 80) : '-'}</td></tr>)}{!data?.logs?.length && <Empty>Belum ada riwayat.</Empty>}</tbody></table></div>}
  </Modal>
}

function TemplateModal({ accounts, templates, onUse, onClose }) {
  return <Modal title="Pilih template jurnal" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Tutup</Button>}>
    {!templates.length ? <Empty>Belum ada template. Simpan dari jurnal yang sudah ada.</Empty> : <div style={{ display: 'grid', gap: 10 }}>{templates.map(t => <div key={t.id} className="panel" style={{ padding: 16, cursor: 'pointer' }} onClick={() => onUse(t)}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><strong>{t.name}</strong><p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>{t.description || `${t.lines.length} baris`}</p></div><Button small>Pakai</Button></div></div>)}</div>}
  </Modal>
}

function SaveTemplateModal({ form, onClose, notify, onSaved }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() {
    setBusy(true); setError('')
    const lines = form.lines.filter(l => l.account_id).map(l => ({ account_id: Number(l.account_id), debit: Number(l.debit || 0), credit: Number(l.credit || 0), memo: l.memo }))
    try { await request('/templates', { method: 'POST', body: { name, description: desc, lines } }); notify(`Template "${name}" berhasil disimpan.`); onSaved(); onClose() }
    catch (r) { setError(r.message) } finally { setBusy(false) }
  }
  return <Modal title="Simpan sebagai template" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy || !name.trim()} onClick={save}>Simpan template</Button></>}>
    <div className="field"><label>NAMA TEMPLATE</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Contoh: Jurnal gaji bulanan" /></div>
    <div className="field" style={{ marginTop: 12 }}><label>KETERANGAN</label><input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Deskripsi singkat template ini" />
    </div><ErrorNotice error={error} />
  </Modal>
}

function JournalModal({ accounts, entry, onClose, onSaved, notify }) {
  const emptyLine = () => ({ account_id: '', debit: '', credit: '', memo: '' })
  const [form, setForm] = useState(() => ({ voucherNo: entry?.voucher_no || '', entryDate: entry?.entry_date?.slice(0, 10) || today(), description: entry?.description || '', lines: entry?.lines?.map(l => ({ account_id: String(l.account_id), debit: l.debit || '', credit: l.credit || '', memo: l.memo || '' })) || [emptyLine(), emptyLine()] }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const templatesState = useLoad(() => request('/templates'), [])
  const templates = templatesState.data?.templates || []

  useEffect(() => { if (!entry) { request('/journals/next-voucher').then(d => setForm(f => ({ ...f, voucherNo: d.voucherNo }))).catch(() => {}) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => ({ debit: form.lines.reduce((s, l) => s + Number(l.debit || 0), 0), credit: form.lines.reduce((s, l) => s + Number(l.credit || 0), 0) }), [form.lines])
  const validation = useMemo(() => validateJournal(form), [form])
  const balanced = Math.abs(totals.debit - totals.credit) < 0.001
  const canSave = validation.valid && balanced && !busy

  function changeLine(i, f, v) { const ls = [...form.lines]; ls[i] = { ...ls[i], [f]: v }; if (f === 'debit' && Number(v) > 0) ls[i].credit = ''; if (f === 'credit' && Number(v) > 0) ls[i].debit = ''; setForm({ ...form, lines: ls }) }
  function addLines(n) { setForm({ ...form, lines: [...form.lines, ...Array(n).fill(null).map(emptyLine)] }) }

  async function save(target) {
    setBusy(true); setError('')
    const cleanLines = form.lines.filter(l => l.account_id || Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
    const body = { ...form, lines: cleanLines.map(l => ({ ...l, account_id: Number(l.account_id), debit: Number(l.debit || 0), credit: Number(l.credit || 0) })) }
    try {
      if (entry) { await request(`/journals/${entry.id}`, { method: 'PUT', body }); if (target === 'POSTED') await request(`/journals/${entry.id}/post`, { method: 'POST' }) }
      else await request('/journals', { method: 'POST', body: { ...body, status: target } })
      notify(`Jurnal ${form.voucherNo || '(baru)'} berhasil ${target === 'POSTED' ? 'diposting' : 'disimpan sebagai draft'}.`)
      onSaved()
    } catch (r) { setError(r.message) } finally { setBusy(false) }
  }

  useEffect(() => {
    function hk(e) {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); if (canSave) save('POSTED') }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (canSave) save('DRAFT') }
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', hk)
    return () => document.removeEventListener('keydown', hk)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  return <Modal title={entry ? `Ubah jurnal ${entry.voucher_no}` : 'Jurnal baru'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button variant="secondary" disabled={!canSave} onClick={() => save('DRAFT')}><Copy /> Simpan Draft</Button><Button disabled={!canSave} onClick={() => save('POSTED')}><Send /> Posting Jurnal</Button></>}>
{!entry && <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}><Button variant="secondary" small onClick={() => setShowTemplates(true)}><Layers /> Pakai Template</Button><Button variant="secondary" small onClick={() => setShowSaveTemplate(true)}><Copy /> Simpan Template</Button></div>}
    {entry && <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}><Button variant="secondary" small onClick={() => setShowAudit(true)}><History /> Lihat riwayat perubahan</Button></div>}
    <div className="grid-equal"><div className="field"><label>NOMOR BUKTI</label><input className="input" placeholder="Otomatis, contoh: JRN-202609-001" value={form.voucherNo} onChange={e => setForm({ ...form, voucherNo: e.target.value })} /></div><div className="field"><label>TANGGAL TRANSAKSI</label><input className="input" type="date" value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} /><FieldWarning message={validation.errors.entryDate} /></div></div>
    <div className="field" style={{ marginTop: 15 }}><label>KETERANGAN</label><input className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Contoh: Pembayaran biaya sewa kantor bulan September 2026" /><FieldWarning message={validation.errors.description} /></div>
    <FieldWarning message={validation.errors.lines} />
    <div style={{ marginTop: 19 }} className="journal-lines">
      <div className="journal-grid header"><span>AKUN</span><span>DEBIT (Rp)</span><span>KREDIT (Rp)</span><span /></div>
      {form.lines.map((line, i) => {
        const le = validation.lineErrors?.[i]
        return <div className={`journal-grid ${Number(line.debit || 0) > 0 ? 'line-debit' : Number(line.credit || 0) > 0 ? 'line-credit' : ''}`} key={i}>
          <select className="select" value={line.account_id} onChange={e => changeLine(i, 'account_id', e.target.value)}>
            <option value="">Pilih akun...</option>
            {Object.entries(GL).map(([g, label]) => { const ga = accounts.filter(a => a.is_active && a.account_group === g); if (!ga.length) return null; return <optgroup key={g} label={label}>{ga.map(a => <option key={a.id} value={a.id}>{a.code} \u2014 {a.name}</option>)}</optgroup> })}
          </select>
          <input className="input" type="text" value={formatNum(line.debit)} onChange={e => changeLine(i, 'debit', parseNum(e.target.value))} placeholder="0" />
          <input className="input" type="text" value={formatNum(line.credit)} onChange={e => changeLine(i, 'credit', parseNum(e.target.value))} placeholder="0" />
          <button className="icon-button" type="button" disabled={form.lines.length <= 2} onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}><X /></button>
          {(le?.account || le?.amount || le?.both) && <div className="field-warning" style={{ gridColumn: '1/-1' }}>{le?.account || le?.amount || le?.both}</div>}
        </div>
      })}
    </div>
    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}><Button variant="secondary" small onClick={() => addLines(1)}><Plus /> Tambah baris</Button><Button variant="secondary" small onClick={() => addLines(5)}><Layers /> +5 Baris</Button><Button variant="secondary" small onClick={() => addLines(10)}><Layers /> +10 Baris</Button></div>
    <div className="journal-summary">
      <span>Total Debit: <strong className={balanced ? 'good' : 'bad'}>{money(totals.debit)}</strong></span>
      <span>Total Kredit: <strong className={balanced ? 'good' : 'bad'}>{money(totals.credit)}</strong></span>
      <span>Selisih: <strong className={balanced ? 'good' : 'bad'}>{money(Math.abs(totals.debit - totals.credit))}</strong></span>
      {balanced ? <span className="badge green">Seimbang</span> : <span className="badge red">Belum seimbang</span>}
    </div>
    <ErrorNotice error={error} />
    <div className="shortcut-hint">Ctrl+Enter = Posting | Ctrl+S = Draft | Esc = Tutup</div>
    {showTemplates && <TemplateModal accounts={accounts} templates={templates} onUse={useTemplate} onClose={() => setShowTemplates(false)} />}
    {showSaveTemplate && <SaveTemplateModal form={form} onClose={() => setShowSaveTemplate(false)} notify={notify} onSaved={() => templatesState.reload()} />}
    {showAudit && entry && <AuditLogModal journalId={entry.id} onClose={() => setShowAudit(false)} />}
  </Modal>
}

function Journals({ accounts, notify }) {
  const [range, setRange] = useState({ from: firstDay(), to: today() }); const [modal, setModal] = useState(null)
  const { data, loading, error, reload } = useLoad(() => request(apiPath('/journals', range)), [range.from, range.to])
  async function edit(id) { try { setModal((await request(`/journals/${id}`)).entry) } catch (r) { notify(r.message, true) } }
  async function reverse(id, vn) {
    if (!window.confirm(`Batalkan jurnal ${vn}? Jurnal pembalik akan otomatis dibuat dengan tanggal hari ini.`)) return
    try { await request(`/journals/${id}/reverse`, { method: 'POST', body: { entryDate: today() } }); notify(`Jurnal ${vn} berhasil dibalik.`); reload() }
    catch (r) { notify(r.message, true) }
  }
  return <><div className="toolbar"><div><h1 className="page-title">Jurnal umum</h1><p className="page-copy">Catat transaksi dengan sistem debit dan kredit berpasangan.</p></div><Button onClick={() => setModal({})}><Plus /> Jurnal baru</Button></div><div className="panel" style={{ marginBottom: 20 }}><div className="filter-row"><div className="field"><label>DARI</label><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div><div className="field"><label>SAMPAI</label><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div><Button variant="secondary" small onClick={reload}><RefreshCw /> Muat ulang</Button></div></div><ErrorNotice error={error} />{loading ? <PageLoading /> : <section className="panel panel-tight"><div className="table-wrap"><table className="table"><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th>Sumber</th><th>Status</th><th className="number">Nilai</th><th /></tr></thead><tbody>{data?.entries?.map(e => <tr key={e.id} className={e.status === 'DRAFT' ? 'clickable' : ''} onClick={() => e.status === 'DRAFT' && edit(e.id)}><td>{dateLabel(e.entry_date)}</td><td><strong>{e.voucher_no}</strong></td><td>{e.description}</td><td className="muted">{e.source === 'IMPORT' ? 'Impor Excel' : e.source === 'REVERSAL' ? 'Pembalik' : 'Manual'}</td><td><Badge status={e.status} /></td><td className="number">{money(e.total_debit)}</td><td>{e.status === 'POSTED' && <button className="icon-button" title="Balikkan jurnal" onClick={(ev) => { ev.stopPropagation(); reverse(e.id, e.voucher_no) }}><RotateCcw size={14} /></button>}</td></tr>)}</tbody></table>{!data?.entries?.length && <Empty>Belum ada jurnal pada rentang tanggal ini. Klik "Jurnal baru" untuk mencatat transaksi pertama Anda.</Empty>}</div></section>}{modal !== null && <JournalModal accounts={accounts} entry={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} notify={notify} />}</>
}

function ImportExcel({ notify }) {
  const [file, setFile] = useState(null); const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function previewFile() { if (!file) return; setBusy(true); setError(''); try { const f = new FormData(); f.append('file', file); setPreview(await request('/imports/preview', { method: 'POST', body: f })) } catch (r) { setError(r.message) } finally { setBusy(false) } }
  async function confirm() { setBusy(true); try { const r = await request(`/imports/${preview.batchId}/confirm`, { method: 'POST' }); notify(`${r.posted} jurnal berhasil diposting dari berkas Excel.`); setPreview(null); setFile(null) } catch (r) { setError(r.message) } finally { setBusy(false) } }
  return <><div className="toolbar"><div><h1 className="page-title">Impor jurnal Excel</h1><p className="page-copy">Validasi dulu, lalu posting seluruh transaksi dalam satu proses aman.</p></div><Button variant="secondary" onClick={() => download('/imports/template', 'template-jurnal-finova.xlsx')}><Download /> Unduh Template</Button></div><div className="grid-two"><section className="panel"><h3 className="panel-title">Unggah berkas jurnal</h3><p className="panel-subtitle">Kolom wajib: Tanggal, NoBukti, Keterangan, KodeAkun, Debit, dan Kredit.</p><label className="upload-zone"><Upload /><strong>{file ? file.name : 'Pilih berkas .xlsx'}</strong><span>Ukuran maksimal 10 MB. Satu NoBukti membentuk satu jurnal berpasangan.</span><input type="file" accept=".xlsx,.xls" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setError('') }} /></label><div style={{ marginTop: 15 }}><Button disabled={!file || busy} onClick={previewFile}><FileSpreadsheet /> {busy ? 'Memvalidasi\u2026' : 'Pratinjau & validasi'}</Button></div><ErrorNotice error={error} /></section><section className="panel"><h3 className="panel-title">Proses otomatis</h3><p className="panel-subtitle">Finova melakukan pemeriksaan berikut sebelum transaksi masuk laporan.</p><div className="report-line"><span>Format dan tanggal transaksi</span><CheckCircle2 className="good" size={17} /></div><div className="report-line"><span>Kode akun aktif</span><CheckCircle2 className="good" size={17} /></div><div className="report-line"><span>Keseimbangan debit dan kredit</span><CheckCircle2 className="good" size={17} /></div><div className="report-line"><span>Periode terbuka dan nomor bukti unik</span><CheckCircle2 className="good" size={17} /></div></section></div>{preview && <section className="panel" style={{ marginTop: 20 }}><div className="split-head"><div><h3 className="panel-title">Hasil validasi</h3><p className="panel-subtitle">{preview.totalRows} baris menghasilkan {preview.entries.length} jurnal valid.</p></div>{preview.valid && <Button onClick={confirm}><Send /> Posting {preview.entries.length} jurnal</Button>}</div>{preview.errors?.length ? <div style={{ marginTop: 10 }}>{preview.errors.map((e, i) => <div key={i} className="field-warning">Baris {e.line}: {e.message}</div>)}</div> : null}{!preview.valid && <ErrorNotice error="Beberapa baris tidak valid. Perbaiki berkas Excel Anda lalu unggah ulang." />}</section>}</>
}

function AccountModal({ account, onClose, onSaved, notify }) {
  const defaults = account || { code: '', name: '', account_group: 'ASSET', account_subtype: '', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: false, is_active: true }
  const [form, setForm] = useState({ ...defaults }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  function setGroup(g) { setForm({ ...form, account_group: g, normal_balance: ['ASSET', 'EXPENSE'].includes(g) ? 'DEBIT' : 'CREDIT' }) }
  async function save() { setBusy(true); setError(''); try { const body = account ? { name: form.name, accountSubtype: form.account_subtype || null, cashFlowCategory: form.cash_flow_category, isCashAccount: form.is_cash_account, isActive: form.is_active } : { code: form.code, name: form.name, accountGroup: form.account_group, accountSubtype: form.account_subtype || null, normalBalance: form.normal_balance, cashFlowCategory: form.cash_flow_category, isCashAccount: form.is_cash_account }; await request(account ? `/accounts/${account.id}` : '/accounts', { method: account ? 'PUT' : 'POST', body }); notify(`Akun ${form.code} berhasil ${account ? 'diperbarui' : 'ditambahkan'}.`); onSaved() } catch (r) { setError(r.message) } finally { setBusy(false) } }
  return <Modal title={account ? `Ubah akun ${account.code}` : 'Tambah akun baru'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy} onClick={save}>Simpan akun</Button></>}><div className="grid-equal"><div className="field"><label>KODE AKUN</label><input className="input" disabled={Boolean(account)} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="Contoh: 1100" /></div><div className="field"><label>KELOMPOK AKUN</label><select className="select" disabled={Boolean(account)} value={form.account_group} onChange={e => setGroup(e.target.value)}>{Object.entries(GL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div><div className="field" style={{ marginTop: 14 }}><label>NAMA AKUN</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contoh: Kas dan Setara Kas" /></div><div className="grid-equal" style={{ marginTop: 14 }}><div className="field"><label>SUBTIPE</label><input className="input" placeholder="Contoh: CASH, BANK, RECEIVABLE" value={form.account_subtype || ''} onChange={e => setForm({ ...form, account_subtype: e.target.value })} /></div><div className="field"><label>KATEGORI ARUS KAS</label><select className="select" value={form.cash_flow_category} onChange={e => setForm({ ...form, cash_flow_category: e.target.value })}>{[{ v: 'OPERATING', l: 'Operasi' }, { v: 'INVESTING', l: 'Investasi' }, { v: 'FINANCING', l: 'Pendanaan' }].map(i => <option key={i.v} value={i.v}>{i.l}</option>)}</select></div></div><div style={{ display: 'flex', gap: 22, marginTop: 18, fontSize: 13 }}><label><input type="checkbox" checked={Boolean(form.is_cash_account)} onChange={e => setForm({ ...form, is_cash_account: e.target.checked })} /> Akun kas/bank</label>{account && <label><input type="checkbox" checked={Boolean(form.is_active)} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> Akun aktif</label>}</div><ErrorNotice error={error} /></Modal>
}

function Accounts({ user, notify }) {
  const { data, loading, error, reload } = useLoad(() => request('/accounts'), [])
  const [modal, setModal] = useState(null)
  return <><div className="toolbar"><div><h1 className="page-title">Daftar Akun (Chart of Accounts)</h1><p className="page-copy">Kelola kode akun sebagai fondasi otomatisasi laporan keuangan Anda.</p></div>{user.role === 'ADMIN' && <Button onClick={() => setModal({})}><Plus /> Tambah akun</Button>}</div><ErrorNotice error={error} />{loading ? <PageLoading /> : <section className="panel panel-tight"><div className="table-wrap"><table className="table"><thead><tr><th>Kode</th><th>Nama akun</th><th>Kelompok</th><th>Saldo normal</th><th>Arus kas</th><th>Status</th></tr></thead><tbody>{data?.accounts?.map(a => <tr key={a.id} className={user.role === 'ADMIN' ? 'clickable' : ''} onClick={() => user.role === 'ADMIN' && setModal(a)}><td><strong>{a.code}</strong></td><td>{a.name}{a.is_cash_account ? <span className="badge green" style={{ marginLeft: 8 }}>KAS/BANK</span> : null}</td><td>{GL[a.account_group] || a.account_group}</td><td>{a.normal_balance === 'DEBIT' ? 'Debit' : 'Kredit'}</td><td>{{ OPERATING: 'Operasi', INVESTING: 'Investasi', FINANCING: 'Pendanaan' }[a.cash_flow_category] || a.cash_flow_category}</td><td><Badge status={a.is_active ? 'OPEN' : 'CLOSED'} /></td></tr>)}</tbody></table>{!data?.accounts?.length && <Empty>Belum ada akun. Tambahkan akun pertama Anda untuk mulai mencatat transaksi.</Empty>}</div></section>}{modal !== null && <AccountModal account={modal.id ? modal : null} onClose={() => setModal(null)} onSaved={() => { setModal(null); reload() }} notify={notify} />}</>
}

function PeriodModal({ onClose, onSaved, notify }) {
  const [form, setForm] = useState({ name: '', startDate: firstDay(), endDate: today() }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function save() { setBusy(true); try { await request('/periods', { method: 'POST', body: form }); notify(`Periode "${form.name}" berhasil ditambahkan.`); onSaved() } catch (r) { setError(r.message) } finally { setBusy(false) } }
  return <Modal title="Tambah periode akuntansi" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy} onClick={save}>Simpan periode</Button></>}><div className="field"><label>NAMA PERIODE</label><input className="input" placeholder="Contoh: September 2026" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div><div className="grid-equal" style={{ marginTop: 14 }}><div className="field"><label>TANGGAL MULAI</label><input className="input" type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div><div className="field"><label>TANGGAL SELESAI</label><input className="input" type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div></div><ErrorNotice error={error} /></Modal>
}

function Periods({ notify }) {
  const { data, loading, error, reload } = useLoad(() => request('/periods'), []); const [showForm, setShowForm] = useState(false); const [closing, setClosing] = useState(null)
  async function close(p) {
    if (!window.confirm(`Tutup dan kunci periode ${p.name}?\n\nSetelah ditutup:\n- Jurnal terposting tidak dapat diubah lagi\n- Jurnal penutup otomatis dibuat\n- Laba/rugi periode dikunci permanen`)) return
    setClosing(p.id); try { const r = await request(`/periods/${p.id}/close`, { method: 'POST' }); notify(`Periode ${p.name} berhasil ditutup. Laba bersih: ${money(r.netIncome)}.`); reload() } catch (reason) { notify(reason.message, true) } finally { setClosing(null) }
  }
  return <><div className="toolbar"><div><h1 className="page-title">Periode akuntansi</h1><p className="page-copy">Tutup bulan setelah laporan ditinjau untuk mengunci pembukuan secara permanen.</p></div><Button onClick={() => setShowForm(true)}><Plus /> Tambah periode</Button></div><ErrorNotice error={error} />{loading ? <PageLoading /> : <section className="panel panel-tight"><div className="table-wrap"><table className="table"><thead><tr><th>Periode</th><th>Mulai</th><th>Selesai</th><th>Status</th><th /></tr></thead><tbody>{data?.periods?.map(p => <tr key={p.id}><td><strong>{p.name}</strong></td><td>{dateLabel(p.start_date)}</td><td>{dateLabel(p.end_date)}</td><td><Badge status={p.status} /></td><td className="number">{p.status === 'OPEN' && <Button small variant="secondary" disabled={closing === p.id} onClick={() => close(p)}><LockKeyhole /> Tutup buku</Button>}</td></tr>)}</tbody></table>{!data?.periods?.length && <Empty>Belum ada periode. Tambahkan periode pertama untuk mulai mencatat transaksi.</Empty>}</div></section>}{showForm && <PeriodModal onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload() }} notify={notify} />}</>
}

function UserModal({ onClose, onSaved, notify }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function save() { setBusy(true); try { await request('/users', { method: 'POST', body: form }); notify(`Pengguna "${form.name}" berhasil dibuat.`); onSaved() } catch (r) { setError(r.message) } finally { setBusy(false) } }
  return <Modal title="Tambah pengguna baru" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy} onClick={save}>Buat pengguna</Button></>}><div className="field"><label>NAMA LENGKAP</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Contoh: Budi Santoso" /></div><div className="field" style={{ marginTop: 14 }}><label>EMAIL</label><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="budi@perusahaan.com" /></div><div className="grid-equal" style={{ marginTop: 14 }}><div className="field"><label>KATA SANDI AWAL</label><input className="input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Minimal 8 karakter" /></div><div className="field"><label>PERAN</label><select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="STAFF">Staf Keuangan</option><option value="ADMIN">Administrator</option></select></div></div><ErrorNotice error={error} /></Modal>
}

function UsersPage({ notify, currentUser }) {
  const { data, loading, error, reload } = useLoad(() => request('/users'), []); const [modal, setModal] = useState(false)
  async function toggle(item) { try { await request(`/users/${item.id}`, { method: 'PATCH', body: { isActive: !item.isActive } }); notify(`Pengguna ${item.name} berhasil ${item.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`); reload() } catch (r) { notify(r.message, true) } }
  return <><div className="toolbar"><div><h1 className="page-title">Pengguna</h1><p className="page-copy">Atur siapa yang dapat mencatat transaksi dan mengelola pembukuan.</p></div><Button onClick={() => setModal(true)}><Plus /> Tambah pengguna</Button></div><ErrorNotice error={error} />{loading ? <PageLoading /> : <section className="panel panel-tight"><div className="table-wrap"><table className="table"><thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Status</th><th /></tr></thead><tbody>{data?.users?.map(u => <tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.email}</td><td><Badge status={u.role} /></td><td><Badge status={u.isActive ? 'OPEN' : 'CLOSED'} /></td><td className="number">{u.id !== currentUser.id && <Button small variant="secondary" onClick={() => toggle(u)}>{u.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>}</td></tr>)}</tbody></table>{!data?.users?.length && <Empty>Belum ada pengguna lain.</Empty>}</div></section>}{modal && <UserModal onClose={() => setModal(false)} onSaved={() => { setModal(false); reload() }} notify={notify} />}</>
}

function SettingsPage({ company, onUpdated, notify }) {
  const [form, setForm] = useState(() => ({ name: company?.name || '', address: company?.address || '', phone: company?.phone || '', email: company?.email || '', fiscalYearStart: company?.fiscal_year_start || 1 })); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => setForm({ name: company?.name || '', address: company?.address || '', phone: company?.phone || '', email: company?.email || '', fiscalYearStart: company?.fiscal_year_start || 1 }), [company])
  async function save(e) { e.preventDefault(); setBusy(true); try { await request('/company', { method: 'PUT', body: form }); notify('Profil perusahaan berhasil disimpan.'); onUpdated() } catch (r) { setError(r.message) } finally { setBusy(false) } }
  return <><h1 className="page-title">Pengaturan perusahaan</h1><p className="page-copy">Informasi ini akan muncul pada setiap laporan yang diekspor.</p><form className="panel" onSubmit={save} style={{ maxWidth: 760 }}><div className="field"><label>NAMA PERUSAHAAN</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="PT Contoh Makmur" /></div><div className="field" style={{ marginTop: 14 }}><label>ALAMAT LENGKAP</label><textarea className="textarea" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Jl. Sudirman No. 1, Jakarta" /></div><div className="grid-equal" style={{ marginTop: 14 }}><div className="field"><label>TELEPON</label><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="021-1234567" /></div><div className="field"><label>EMAIL</label><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="info@perusahaan.com" /></div></div><div className="field" style={{ marginTop: 14, maxWidth: 230 }}><label>BULAN AWAL TAHUN BUKU</label><select className="select" value={form.fiscalYearStart} onChange={e => setForm({ ...form, fiscalYearStart: Number(e.target.value) })}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(2026, i, 1))}</option>)}</select></div><ErrorNotice error={error} /><div style={{ marginTop: 20 }}><Button disabled={busy}>{busy ? 'Menyimpan\u2026' : 'Simpan pengaturan'}</Button></div></form></>
}

const reportOptions = [
  ['journal', 'Jurnal Umum'], ['ledger', 'Buku Besar'], ['trial-balance', 'Neraca Saldo'], ['income-statement', 'Laba Rugi'], ['balance-sheet', 'Neraca Posisi Keuangan'], ['equity-changes', 'Perubahan Modal'], ['cash-flow', 'Arus Kas']
]

function reportExportRows(kind, data) {
  if (!data) return { headers: [], rows: [] }
  if (kind === 'journal') return { headers: ['Tanggal', 'No. Bukti', 'Keterangan', 'Akun', 'Debit', 'Kredit'], rows: data.flatMap(e => e.lines.map(l => [e.entry_date, e.voucher_no, e.description, `${l.code} \u2014 ${l.account_name}`, l.debit, l.credit])) }
  if (kind === 'ledger') return { headers: ['Tanggal', 'No. Bukti', 'Keterangan', 'Debit', 'Kredit', 'Saldo'], rows: data.rows.map(l => [l.entry_date, l.voucher_no, l.description, l.debit, l.credit, l.balance]) }
  if (kind === 'trial-balance') return { headers: ['Kode', 'Nama Akun', 'Debit', 'Kredit'], rows: data.rows.map(r => [r.code, r.name, r.debit, r.credit]) }
  if (kind === 'income-statement') return { headers: ['Kelompok', 'Kode', 'Akun', 'Nominal'], rows: [...data.revenue.map(r => ['Pendapatan', r.code, r.name, r.amount]), ...data.expenses.map(r => ['Beban', r.code, r.name, r.amount]), ['Laba Bersih', '', '', data.netIncome]] }
  if (kind === 'balance-sheet') return { headers: ['Kelompok', 'Kode', 'Akun', 'Nominal'], rows: [...data.assets.rows.map(r => ['Aktiva', r.code, r.name, r.amount]), ...data.liabilities.rows.map(r => ['Liabilitas', r.code, r.name, r.amount]), ...data.equity.rows.map(r => ['Ekuitas', r.code, r.name, r.amount]), ['Ekuitas', '', 'Laba periode berjalan', data.equity.unclosedProfit]] }
  if (kind === 'equity-changes') return { headers: ['Keterangan', 'Nominal'], rows: [['Modal awal', data.opening], ['Tambahan modal', data.capital], ['Prive', data.drawings], ['Laba bersih', data.netIncome], ['Modal akhir', data.closing]] }
  return { headers: ['Keterangan', 'Nominal'], rows: [['Arus kas operasi', data.operating], ['Arus kas investasi', data.investing], ['Arus kas pendanaan', data.financing], ['Kenaikan/(penurunan) kas', data.netChange]] }
}

async function exportReport(kind, label, response, type) {
  const { headers, rows } = reportExportRows(kind, response.data)
  const dr = `${response.period.from} s.d. ${response.period.to}`
  if (type === 'xlsx') {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Laporan')
    ws.addRows([[response.company.name], [label], [`Periode: ${dr}`], [], headers, ...rows])
    ws.getRow(1).font = { bold: true, size: 14 }; ws.getRow(2).font = { bold: true }; ws.getRow(5).font = { bold: true }
    ws.columns = headers.map((h, i) => ({ width: Math.min(48, Math.max(h.length + 3, ...rows.map(r => String(r[i] ?? '').length + 2), 15)) }))
    const bytes = await wb.xlsx.writeBuffer(); const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    a.download = `${kind}-${response.period.to}.xlsx`; a.click(); URL.revokeObjectURL(a.href)
  } else {
    const doc = new jsPDF(); doc.setFontSize(16); doc.text(response.company.name, 14, 16); doc.setFontSize(12); doc.text(label, 14, 24); doc.setFontSize(9); doc.text(`Periode: ${dr} \u00b7 Dicetak ${dateLabel(today())}`, 14, 30)
    autoTable(doc, { startY: 36, head: [headers], body: rows.map(r => r.map((v, i) => i >= headers.length - 2 && typeof v === 'number' ? number(v) : String(v ?? ''))), styles: { fontSize: 8 }, headStyles: { fillColor: [14, 113, 69] } })
    doc.save(`${kind}-${response.period.to}.pdf`)
  }
}

function ReportDocument({ kind, report }) {
  const data = report?.data
  if (!data) return <Empty>Pilih jenis laporan dan rentang periode untuk melihat hasilnya.</Empty>
  const Section = ({ title, rows, total, label = 'Total' }) => <><div className="report-section">{title}</div>{rows.map(r => <div className="report-line indent" key={`${title}${r.code}${r.name}`}><span>{r.code ? `${r.code} \u2014 ${r.name}` : r.name}</span><span>{money(r.amount)}</span></div>)}<div className="report-line total"><span>{label}</span><span>{money(total)}</span></div></>
  if (kind === 'journal') return <div className="table-wrap"><table className="table"><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan / Akun</th><th className="number">Debit</th><th className="number">Kredit</th></tr></thead><tbody>{data.flatMap(e => e.lines.map((l, i) => <tr key={`${e.id}-${l.account_id}`}><td>{i === 0 ? dateLabel(e.entry_date) : ''}</td><td>{i === 0 ? e.voucher_no : ''}</td><td>{i === 0 && <span className="muted">{e.description}<br /></span>}<span style={{ paddingLeft: 12 }}>{l.code} \u2014 {l.account_name}</span></td><td className="number">{l.debit ? money(l.debit) : ''}</td><td className="number">{l.credit ? money(l.credit) : ''}</td></tr>))}</tbody></table>{!data.length && <Empty>Belum ada jurnal terposting pada periode ini.</Empty>}</div>
  if (kind === 'ledger') return <><div className="report-line total"><span>Saldo awal \u2014 {data.account.code} {data.account.name}</span><span>{money(data.opening)}</span></div><div className="table-wrap"><table className="table"><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th className="number">Debit</th><th className="number">Kredit</th><th className="number">Saldo</th></tr></thead><tbody>{data.rows.map((r, i) => <tr key={i}><td>{dateLabel(r.entry_date)}</td><td>{r.voucher_no}</td><td>{r.description}</td><td className="number">{r.debit ? money(r.debit) : ''}</td><td className="number">{r.credit ? money(r.credit) : ''}</td><td className="number"><strong>{money(r.balance)}</strong></td></tr>)}<tr className="total-row"><td colSpan="5">Saldo akhir</td><td className="number">{money(data.closing)}</td></tr></tbody></table></div></>
  if (kind === 'trial-balance') return <div className="table-wrap"><table className="table"><thead><tr><th>Kode</th><th>Nama akun</th><th className="number">Debit</th><th className="number">Kredit</th></tr></thead><tbody>{data.rows.map(r => <tr key={r.accountId}><td>{r.code}</td><td>{r.name}</td><td className="number">{r.debit ? money(r.debit) : ''}</td><td className="number">{r.credit ? money(r.credit) : ''}</td></tr>)}<tr className="total-row"><td colSpan="2">Total</td><td className="number">{money(data.totals.debit)}</td><td className="number">{money(data.totals.credit)}</td></tr></tbody></table></div>
  if (kind === 'income-statement') return <><Section title="Pendapatan" rows={data.revenue} total={data.revenueTotal} label="Total pendapatan" /><Section title="Beban" rows={data.expenses} total={data.expenseTotal} label="Total beban" /><div className="report-line grand"><span>Laba bersih periode berjalan</span><span>{money(data.netIncome)}</span></div></>
  if (kind === 'balance-sheet') return <><Section title="Aktiva" rows={data.assets.rows} total={data.assets.total} label="Total aktiva" /><Section title="Liabilitas" rows={data.liabilities.rows} total={data.liabilities.total} label="Total liabilitas" /><Section title="Ekuitas" rows={[...data.equity.rows, { name: 'Laba periode berjalan', amount: data.equity.unclosedProfit }]} total={data.equity.total} label="Total ekuitas" /><div className={`report-line grand ${data.balanced ? '' : 'bad'}`}><span>Liabilitas + Ekuitas</span><span>{money(data.liabilities.total + data.equity.total)}</span></div></>
  if (kind === 'equity-changes') return <><div className="report-line"><span>Modal awal</span><span>{money(data.opening)}</span></div><div className="report-line"><span>Tambahan modal pemilik</span><span>{money(data.capital)}</span></div><div className="report-line"><span>Prive</span><span>{money(data.drawings)}</span></div><div className="report-line"><span>Laba bersih</span><span>{money(data.netIncome)}</span></div><div className="report-line grand"><span>Modal akhir</span><span>{money(data.closing)}</span></div></>
  return <><div className="report-line"><span>Arus kas dari aktivitas operasi</span><span>{money(data.operating)}</span></div><div className="report-line"><span>Arus kas dari aktivitas investasi</span><span>{money(data.investing)}</span></div><div className="report-line"><span>Arus kas dari aktivitas pendanaan</span><span>{money(data.financing)}</span></div><div className="report-line grand"><span>Kenaikan/(penurunan) kas</span><span>{money(data.netChange)}</span></div></>
}

function Reports({ accounts, notify }) {
  const [kind, setKind] = useState('income-statement'); const [range, setRange] = useState({ from: firstDay(), to: today() }); const [accountId, setAccountId] = useState('')
  const query = useMemo(() => ({ ...range, accountId: kind === 'ledger' ? accountId : undefined }), [kind, range, accountId])
  const { data, loading, error, reload } = useLoad(() => kind === 'ledger' && !accountId ? Promise.resolve(null) : request(apiPath(`/reports/${kind}`, query)), [kind, range.from, range.to, accountId])
  const selectedLabel = reportOptions.find(([k]) => k === kind)?.[1]
  async function exportFile(type) { try { if (!data) return; await exportReport(kind, selectedLabel, data, type); notify(`Laporan ${selectedLabel} berhasil diekspor ke format ${type.toUpperCase()}.`) } catch (r) { notify(r.message, true) } }
  return <><div className="toolbar"><div><h1 className="page-title">Laporan keuangan</h1><p className="page-copy">Semua angka dihitung otomatis dari jurnal terposting pada periode yang Anda pilih.</p></div><div style={{ display: 'flex', gap: 8 }}><Button variant="secondary" disabled={!data} onClick={() => window.print()}><Printer /> Cetak</Button><Button variant="secondary" disabled={!data} onClick={() => exportFile('xlsx')}><FileSpreadsheet /> Excel</Button><Button variant="secondary" disabled={!data} onClick={() => exportFile('pdf')}><Download /> PDF</Button></div></div><section className="panel" style={{ marginBottom: 20 }}><div className="filter-row"><div className="field" style={{ minWidth: 220 }}><label>JENIS LAPORAN</label><select className="select" value={kind} onChange={e => setKind(e.target.value)}>{reportOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>{kind === 'ledger' && <div className="field" style={{ minWidth: 220 }}><label>AKUN</label><select className="select" value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">Pilih akun...</option>{Object.entries(GL).map(([g, label]) => { const ga = accounts.filter(a => a.account_group === g); if (!ga.length) return null; return <optgroup key={g} label={label}>{ga.map(a => <option key={a.id} value={a.id}>{a.code} \u2014 {a.name}</option>)}</optgroup> })}</select></div>}<div className="field"><label>DARI</label><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></div><div className="field"><label>SAMPAI</label><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></div><Button small variant="secondary" onClick={reload}><RefreshCw /> Terapkan</Button></div></section><ErrorNotice error={error} />{loading ? <PageLoading /> : <section className="panel panel-tight"><div className="report-heading"><div className="muted">{data?.company?.name || 'Perusahaan Anda'}</div><h2>{selectedLabel}</h2><p>Periode {dateLabel(range.from)} \u2014 {dateLabel(range.to)}</p></div><ReportDocument kind={kind} report={data} /></section>}</>
}

function Workspace({ user, onLogout }) {
  const [route, setRoute] = useState('dashboard'); const [toast, setToast] = useState(null)
  const [dark, setDark] = useState(() => localStorage.getItem('finova_dark') === '1')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showOnboard, setShowOnboard] = useState(() => !localStorage.getItem('finova_onboarded'))
  const companyState = useLoad(() => request('/company'), []); const accountsState = useLoad(() => request('/accounts'), [])
  const notify = useCallback((message, isError = false) => { setToast({ message, error: isError }); window.setTimeout(() => setToast(null), 4000) }, [])
  useEffect(() => { document.body.classList.toggle('dark', dark); localStorage.setItem('finova_dark', dark ? '1' : '0') }, [dark])
  useEffect(() => {
    function hk(e) { if (e.ctrlKey && e.key === 'k') { e.preventDefault(); setSearchOpen(true) } }
    document.addEventListener('keydown', hk)
    return () => document.removeEventListener('keydown', hk)
  }, [])
  if (companyState.loading || accountsState.loading) return <PageLoading />
  const company = companyState.data?.company; const accounts = accountsState.data?.accounts || []
  const page = route === 'dashboard' ? <Dashboard /> : route === 'journals' ? <Journals accounts={accounts} notify={notify} /> : route === 'imports' ? <ImportExcel notify={notify} /> : route === 'reports' ? <Reports accounts={accounts} notify={notify} /> : route === 'accounts' ? <Accounts user={user} notify={notify} /> : route === 'periods' ? <Periods notify={notify} /> : route === 'users' ? <UsersPage currentUser={user} notify={notify} /> : <SettingsPage company={company} notify={notify} onUpdated={companyState.reload} />
  return <AppShell user={user} company={company} route={route} setRoute={setRoute} onLogout={onLogout} dark={dark} setDark={setDark} onSearch={() => setSearchOpen(true)}>
    {companyState.error || accountsState.error ? <ErrorNotice error={companyState.error || accountsState.error} /> : page}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.message}</div>}
    <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} accounts={accounts} setRoute={setRoute} />
    {showOnboard && <OnboardingWalkthrough done={() => { setShowOnboard(false); localStorage.setItem('finova_onboarded', '1') }} />}
  </AppShell>
}

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null })
  useEffect(() => { request('/auth/me').then(d => setSession({ loading: false, user: d.user })).catch(() => setSession({ loading: false, user: null })) }, [])
  async function logout() { try { await request('/auth/logout', { method: 'POST' }) } finally { setSession({ loading: false, user: null }) } }
  if (session.loading) return <PageLoading />
  return session.user ? <Workspace user={session.user} onLogout={logout} /> : <Login onLogin={u => setSession({ loading: false, user: u })} />
}