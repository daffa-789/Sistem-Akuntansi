import React, { useMemo, useState } from 'react'
import {
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Undo2,
  Upload,
  X
} from 'lucide-react'
import { Button } from '../ui/Button.js'
import { Badge } from '../ui/Badge.js'
import { PageLoading } from '../ui/PageLoading.js'
import { Empty } from '../ui/Empty.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { JournalModal } from '../modals/JournalModal.js'
import { ExcelImportModal } from '../modals/ExcelImportModal.js'
import { ReverseJournalModal } from '../modals/ReverseJournalModal.js'
import { AuditLogModal } from '../modals/AuditLogModal.js'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { apiPath, dateLabel, firstDay, money, today, SOURCE_LABEL } from '../../utils/formatters.js'
import { exportJournalFile, type Query } from '../../services/downloads.js'
import { Account, Company } from '../../../shared/types.js'

// Kontrak rekapitulasi (dihitung dari laporan register, ditampilkan dan diekspor).
export interface RecapAccountItem {
  code: string
  name: string
  amount: number
}

export interface JournalRecap {
  debits: RecapAccountItem[]
  credits: RecapAccountItem[]
  totalDebit: number
  totalCredit: number
  isBalanced?: boolean
}

export interface RegisterFilters {
  from: string
  to: string
  status: 'ALL' | 'POSTED' | 'DRAFT'
  account: string
  search: string
  sortKey: 'date' | 'voucher' | 'debit' | 'credit'
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const defaultRegisterFilters = (): RegisterFilters => ({
  from: firstDay(),
  to: today(),
  status: 'ALL',
  account: '',
  search: '',
  sortKey: 'date',
  sortDir: 'desc',
  page: 1,
  pageSize: 50
})

export interface JournalsViewProps {
  accounts?: Account[]
  company?: Company | null
  notify: (msg: string, isError?: boolean) => void
  filters: RegisterFilters
  onFilters: (next: RegisterFilters) => void
}

export interface ReportLine {
  account_id: number
  code: string
  account_name: string
  debit: number
  credit: number
  memo?: string
}

export interface ReportEntry {
  id: number
  entry_date: string
  voucher_no: string
  description: string
  status?: string
  source?: string
  reversed?: boolean
  reversal_of_id?: number | null
  lines: ReportLine[]
}

export interface JournalReportData {
  entries: ReportEntry[]
  recap: JournalRecap
}

const isPosted = (entry: ReportEntry): boolean => (entry.status || 'POSTED') === 'POSTED'

export function JournalsView({ accounts = [], company, notify, filters, onFilters }: JournalsViewProps): React.JSX.Element {
  const [showRecap, setShowRecap] = useState<boolean>(false)
  const [modal, setModal] = useState<ReportEntry | 'new' | null>(null)
  const [reverseTarget, setReverseTarget] = useState<ReportEntry | null>(null)
  const [auditTarget, setAuditTarget] = useState<number | null>(null)
  const [showImport, setShowImport] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)

  const range = { from: filters.from, to: filters.to }

  function patch(next: Partial<RegisterFilters>): void {
    onFilters({ ...filters, ...next, page: next.page ?? 1 })
  }

  // Load report data which includes full lines, vouchers, status, and recap
  const { data, loading, error, reload } = useLoad<{ data: JournalReportData | ReportEntry[] }>(
    () => request(apiPath('/reports/journal', range)),
    [filters.from, filters.to]
  )

  const reportData = data?.data
  const allEntries = useMemo<ReportEntry[]>(() => {
    if (!reportData) return []
    return Array.isArray(reportData) ? reportData : reportData.entries || []
  }, [reportData])

  function setQuickRange(type: 'today' | 'this-month' | 'last-month' | 'this-year'): void {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    if (type === 'today') patch({ from: today(), to: today() })
    else if (type === 'this-month') patch({ from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: today() })
    else if (type === 'last-month')
      patch({ from: new Date(y, m - 1, 1).toISOString().slice(0, 10), to: new Date(y, m, 0).toISOString().slice(0, 10) })
    else patch({ from: `${y}-01-01`, to: today() })
  }

  // Filter diambil dari state yang diangkat ke App, sehingga berpindah layar tidak
  // menghapus hasil kerja penyusun jurnal.
  const filteredEntries = useMemo(() => {
    let list = allEntries
    if (filters.status !== 'ALL') list = list.filter((e) => (e.status || 'POSTED') === filters.status)
    if (filters.account) {
      list = list.filter((e) => e.lines.some((l) => String(l.account_id) === String(filters.account)))
    }
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase()
      list = list.filter(
        (e) =>
          e.voucher_no.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.lines.some(
            (l) =>
              l.code.toLowerCase().includes(q) ||
              l.account_name.toLowerCase().includes(q) ||
              (l.memo && l.memo.toLowerCase().includes(q))
          )
      )
    }
    return list
  }, [allEntries, filters.status, filters.account, filters.search])

  // Draft belum masuk buku besar, jadi tidak boleh ikut menghitung total/rekap yang tercetak.
  const postedEntries = useMemo(() => filteredEntries.filter(isPosted), [filteredEntries])
  const draftCount = filteredEntries.length - postedEntries.length

  // Akun kas/bank dikenali dari bendera is_cash_account, bukan awalan kode yang rapuh
  // (kode 1200 adalah Piutang Usaha, bukan kas).
  const cashCodes = useMemo(() => new Set(accounts.filter((a) => Boolean(a.is_cash_account)).map((a) => a.code)), [accounts])

  const totals = useMemo(() => {
    let debit = 0
    let credit = 0
    let cashIn = 0
    let cashOut = 0

    for (const e of postedEntries) {
      for (const l of e.lines) {
        const d = Number(l.debit || 0)
        const c = Number(l.credit || 0)
        debit += d
        credit += c

        if (cashCodes.has(l.code)) {
          cashIn += d
          cashOut += c
        }
      }
    }

    return {
      debit,
      credit,
      count: filteredEntries.length,
      cashIn,
      cashOut,
      netCash: cashIn - cashOut,
      isBalanced: Math.abs(debit - credit) < 0.005
    }
  }, [postedEntries, filteredEntries.length, cashCodes])

  const liveRecap = useMemo<JournalRecap>(() => {
    const debitMap = new Map<string, { code: string; name: string; amount: number }>()
    const creditMap = new Map<string, { code: string; name: string; amount: number }>()
    let totD = 0
    let totC = 0

    for (const e of postedEntries) {
      for (const l of e.lines) {
        if (Number(l.debit || 0) > 0) {
          const cur = debitMap.get(l.code) || { code: l.code, name: l.account_name, amount: 0 }
          cur.amount += Number(l.debit)
          debitMap.set(l.code, cur)
          totD += Number(l.debit)
        }
        if (Number(l.credit || 0) > 0) {
          const cur = creditMap.get(l.code) || { code: l.code, name: l.account_name, amount: 0 }
          cur.amount += Number(l.credit)
          creditMap.set(l.code, cur)
          totC += Number(l.credit)
        }
      }
    }

    return {
      debits: [...debitMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
      credits: [...creditMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
      totalDebit: totD,
      totalCredit: totC
    }
  }, [postedEntries])

  const sortedEntries = useMemo(() => {
    const dir = filters.sortDir === 'asc' ? 1 : -1
    const sideTotal = (e: ReportEntry, field: 'debit' | 'credit') => e.lines.reduce((s, l) => s + Number(l[field] || 0), 0)
    return [...filteredEntries].sort((a, b) => {
      if (filters.sortKey === 'voucher') return a.voucher_no.localeCompare(b.voucher_no) * dir
      if (filters.sortKey === 'debit') return (sideTotal(a, 'debit') - sideTotal(b, 'debit')) * dir
      if (filters.sortKey === 'credit') return (sideTotal(a, 'credit') - sideTotal(b, 'credit')) * dir
      return (a.entry_date.localeCompare(b.entry_date) || a.id - b.id) * dir
    })
  }, [filteredEntries, filters.sortKey, filters.sortDir])

  const pageCount = Math.max(1, Math.ceil(sortedEntries.length / filters.pageSize))
  const currentPage = Math.min(filters.page, pageCount)
  const pagedEntries = sortedEntries.slice((currentPage - 1) * filters.pageSize, currentPage * filters.pageSize)

  function toggleSort(key: RegisterFilters['sortKey']): void {
    if (filters.sortKey === key) patch({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })
    else patch({ sortKey: key, sortDir: key === 'date' ? 'desc' : 'asc' })
  }

  function sortHeader(label: string, key: RegisterFilters['sortKey'], style?: React.CSSProperties, className?: string) {
    const isCurrent = filters.sortKey === key
    return (
      <th
        scope="col"
        className={className}
        style={style}
        aria-sort={isCurrent ? (filters.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className="th-sort" onClick={() => toggleSort(key)} title={`Urutkan berdasarkan ${label}`}>
          {label}
          <ArrowUpDown size={11} aria-hidden="true" style={{ opacity: isCurrent ? 1 : 0.3 }} />
        </button>
      </th>
    )
  }

  async function edit(id: number | string) {
    try {
      const res = await request<{ entry: ReportEntry }>(`/journals/${id}`)
      setModal(res.entry)
    } catch (r: any) {
      notify(r.message || 'Gagal mengambil jurnal.', true)
    }
  }

  async function deleteJournal(id: number | string, vn: string) {
    if (!window.confirm(`Hapus draft ${vn}? Draft belum masuk buku besar, jadi penghapusan tidak meninggalkan mutasi akun.`)) {
      return
    }
    try {
      await request(`/journals/${id}`, { method: 'DELETE' })
      notify(`Draft ${vn} berhasil dihapus.`)
      reload()
    } catch (r: any) {
      notify(r.message || 'Gagal menghapus jurnal.', true)
    }
  }

  async function postDraft(id: number | string, vn: string) {
    try {
      await request(`/journals/${id}/post`, { method: 'POST' })
      notify(`Jurnal ${vn} berhasil diposting ke buku besar.`)
      reload()
    } catch (r: any) {
      notify(r.message || 'Gagal memposting jurnal.', true)
    }
  }

  // Berkas dibuat di server Go; parameter filter diteruskan agar isi berkas
  // sama dengan yang sedang dilihat pada register.
  function exportQuery(): Query {
    return {
      status: filters.status,
      accountId: filters.account || '',
      q: filters.search.trim(),
      sort: filters.sortKey,
      dir: filters.sortDir
    }
  }

  async function handleExportExcel() {
    setExporting(true)
    try {
      await exportJournalFile(range, 'xlsx', exportQuery())
      notify('Buku Jurnal Umum & Rekapitulasi berhasil diekspor ke Excel (.xlsx).')
    } catch (err: any) {
      notify(`Gagal ekspor Excel: ${err.message}`, true)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportPDF() {
    try {
      await exportJournalFile(range, 'pdf', exportQuery())
      notify('Buku Jurnal Umum berhasil diekspor ke PDF.')
    } catch (err: any) {
      notify(`Gagal ekspor PDF: ${err.message}`, true)
    }
  }

  return (
    <>
      {/* 1. Page Header & Primary Actions */}
      <div className="toolbar">
        <div>
          <h1 className="page-title">Jurnal Umum (General Journal)</h1>
          <p className="page-copy">
            Pusat pencatatan transaksi terpadu, buku jurnal berformat SAK/Excel, dan rekapitulasi akun.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="secondary" small onClick={() => setShowImport(true)}>
            <Upload size={15} /> Impor Excel
          </Button>
          <Button variant="secondary" small onClick={() => setShowRecap(!showRecap)}>
            <BarChart3 size={15} /> {showRecap ? 'Tutup Rekap' : 'Rekapitulasi'}
          </Button>
          <Button variant="secondary" small disabled={exporting} onClick={handleExportExcel}>
            <FileSpreadsheet size={15} /> {exporting ? 'Mengekspor…' : 'Ekspor Excel'}
          </Button>
          <Button variant="secondary" small onClick={handleExportPDF}>
            <FileText size={15} /> Ekspor PDF
          </Button>
          <Button onClick={() => setModal('new')}>
            <Plus size={16} /> Catat Transaksi Baru
          </Button>
        </div>
      </div>

      {/* 2. Key Accounting Summary Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 16
        }}
      >
        <div className="panel" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>TOTAL TRANSAKSI</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
            {totals.count} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>Jurnal</span>
          </div>
          <div style={{ fontSize: 11, color: totals.isBalanced ? '#16a34a' : '#e11d48', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={12} /> Status: {totals.isBalanced ? 'Seimbang (Balanced)' : 'Periksa Selisih'}
          </div>
          {draftCount > 0 && (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
              {draftCount} draft tidak dihitung dalam total &amp; rekapitulasi
            </div>
          )}
        </div>

        <div className="panel" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d' }}>TOTAL DEBIT</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#15803d', marginTop: 4 }}>
            {money(totals.debit)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Akumulasi sisi Debit</div>
        </div>

        <div className="panel" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1' }}>TOTAL KREDIT</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0369a1', marginTop: 4 }}>
            {money(totals.credit)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Akumulasi sisi Kredit</div>
        </div>

        <div className="panel" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>MUTASI KAS & BANK</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
            +{money(totals.cashIn)}
          </div>
          <div style={{ fontSize: 11, color: '#e11d48', marginTop: 1 }}>
            -{money(totals.cashOut)} (Net: {money(totals.netCash)})
          </div>
        </div>
      </div>

      {/* 3. Comprehensive Filter & Search Bar */}
      <div className="panel" style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginRight: 4 }}>
            Pilih Periode:
          </span>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
            onClick={() => setQuickRange('today')}
          >
            Hari Ini
          </button>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
            onClick={() => setQuickRange('this-month')}
          >
            Bulan Ini
          </button>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
            onClick={() => setQuickRange('last-month')}
          >
            Bulan Lalu
          </button>
          <button
            type="button"
            className="button button-secondary"
            style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
            onClick={() => setQuickRange('this-year')}
          >
            Tahun Ini
          </button>
        </div>

        <div className="filter-row" style={{ alignItems: 'flex-end', gap: 10 }}>
          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="journals-from">DARI TANGGAL</label>
            <input
              id="journals-from"
              className="input"
              type="date"
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
            />
          </div>

          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="journals-to">SAMPAI TANGGAL</label>
            <input
              id="journals-to"
              className="input"
              type="date"
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
            />
          </div>

          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="journals-account">FILTER AKUN</label>
            <select
              id="journals-account"
              className="select"
              value={filters.account}
              onChange={(e) => patch({ account: e.target.value })}
            >
              <option value="">Semua Akun</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 120 }}>
            <label htmlFor="journals-status">STATUS</label>
            <select
              id="journals-status"
              className="select"
              value={filters.status}
              onChange={(e) => patch({ status: e.target.value as RegisterFilters['status'] })}
            >
              <option value="ALL">Semua Status</option>
              <option value="POSTED">Terposting</option>
              <option value="DRAFT">Draft</option>
            </select>
          </div>

          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="journals-search">PENCARIAN CEPAT</label>
            <div style={{ position: 'relative' }}>
              <input
                id="journals-search"
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="Cari no. bukti, keterangan, akun, memo…"
                value={filters.search}
                onChange={(e) => patch({ search: e.target.value })}
              />
              <Search
                size={15}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
              />
              {filters.search && (
                <button
                  type="button"
                  aria-label="Kosongkan pencarian"
                  onClick={() => patch({ search: '' })}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8'
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <Button variant="secondary" small onClick={reload} aria-label="Muat ulang daftar jurnal">
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </div>

      {/* 4. Rekapitulasi Jurnal (Collapsible Section, fully responsive & never clipped) */}
      {showRecap && (
        <section className="panel" style={{ marginBottom: 16, background: '#f8fafc', border: '1px solid #cbd5e1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 800, margin: 0, color: '#1e293b' }}>
                📊 REKAPITULASI JURNAL UMUM
              </h2>
              <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
                Ringkasan total per akun Debit vs Kredit sebelum diposting ke Buku Besar.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => setShowRecap(false)}
            >
              <X size={14} /> Tutup Rekap
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {/* Sisi Debit */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#ecfdf5', padding: '8px 12px', fontWeight: 700, fontSize: 12, color: '#065f46', borderBottom: '1px solid #d1fae5' }}>
                AKUN SISI DEBIT
              </div>
              <div style={{ overflowX: 'auto', width: '100%' }}>
                <table style={{ width: '100%', minWidth: 0, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fafcfb', borderBottom: '1px solid #edf0f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '20%' }}>Kode</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '45%' }}>Nama Akun</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '35%' }}>Jumlah (Rp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveRecap.debits.map((d) => (
                      <tr key={d.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px' }}><strong>{d.code}</strong></td>
                        <td style={{ padding: '8px 10px' }}>{d.name}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#15803d', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {money(d.amount)}
                        </td>
                      </tr>
                    ))}
                    {!liveRecap.debits.length && (
                      <tr>
                        <td colSpan={3} style={{ padding: '12px 10px', textAlign: 'center', color: '#94a3b8' }}>
                          Tidak ada transaksi debit
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td colSpan={2} style={{ padding: '8px 10px' }}>TOTAL DEBIT</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#15803d', fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {money(liveRecap.totalDebit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Sisi Kredit */}
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#f0f9ff', padding: '8px 12px', fontWeight: 700, fontSize: 12, color: '#0369a1', borderBottom: '1px solid #e0f2fe' }}>
                AKUN SISI KREDIT
              </div>
              <div style={{ overflowX: 'auto', width: '100%' }}>
                <table style={{ width: '100%', minWidth: 0, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#fafcfb', borderBottom: '1px solid #edf0f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '20%' }}>Kode</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', width: '45%' }}>Nama Akun</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right', width: '35%' }}>Jumlah (Rp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveRecap.credits.map((c) => (
                      <tr key={c.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px' }}><strong>{c.code}</strong></td>
                        <td style={{ padding: '8px 10px' }}>{c.name}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#0369a1', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {money(c.amount)}
                        </td>
                      </tr>
                    ))}
                    {!liveRecap.credits.length && (
                      <tr>
                        <td colSpan={3} style={{ padding: '12px 10px', textAlign: 'center', color: '#94a3b8' }}>
                          Tidak ada transaksi kredit
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td colSpan={2} style={{ padding: '8px 10px' }}>TOTAL KREDIT</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#0369a1', fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {money(liveRecap.totalCredit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}

      <ErrorNotice error={error} />

      {/* 5. Main Excel/SAK Classic General Journal Table */}
      {loading ? (
        <PageLoading message="Memuat buku jurnal transaksi…" />
      ) : (
        <section className="panel panel-tight" aria-label="Buku Jurnal Umum">
          <div className="table-wrap">
            <table className="table journal-sheet-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  {sortHeader('Tanggal', 'date', { width: 100 })}
                  {sortHeader('No. Bukti', 'voucher', { width: 140 })}
                  <th scope="col">Keterangan Akun &amp; Transaksi</th>
                  <th scope="col" style={{ width: 60, textAlign: 'center' }}>Ref</th>
                  {sortHeader('Debit (Rp)', 'debit', { width: 140 }, 'number')}
                  {sortHeader('Kredit (Rp)', 'credit', { width: 140 }, 'number')}
                  <th scope="col" style={{ width: 100, textAlign: 'center' }}>Status</th>
                  <th scope="col" style={{ width: 130, textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {pagedEntries.map((e) => {
                  const isDraft = (e.status || 'POSTED') === 'DRAFT'
                  return (
                    <React.Fragment key={e.id}>
                      {e.lines.map((l, lineIdx) => {
                        const isFirstLine = lineIdx === 0
                        const isCredit = Number(l.credit || 0) > 0

                        return (
                          <tr
                            key={`${e.id}-${lineIdx}`}
                            style={{
                              borderTop: isFirstLine ? '1px solid #cbd5e1' : 'none',
                              background: isDraft ? '#fffbeb' : undefined
                            }}
                          >
                            {/* Tanggal (tampil di baris pertama transaksi) */}
                            <td>{isFirstLine ? dateLabel(e.entry_date) : ''}</td>

                            {/* No. Bukti + sumber transaksi */}
                            <td>
                              {isFirstLine ? (
                                <div>
                                  <strong style={{ color: '#0f172a' }}>{e.voucher_no}</strong>
                                  {e.source && e.source !== 'MANUAL' && (
                                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                                      {SOURCE_LABEL[e.source] || e.source}
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </td>

                            {/* Nama Akun & Memo */}
                            <td style={{ paddingLeft: isCredit ? 32 : 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {isCredit && (
                                  <span style={{ color: '#0284c7', fontWeight: 700, fontSize: 13 }}>↳</span>
                                )}
                                <span
                                  style={{
                                    fontWeight: isCredit ? 500 : 700,
                                    color: isCredit ? '#0369a1' : '#0f172a'
                                  }}
                                >
                                  {l.account_name}
                                </span>
                              </div>

                              {/* Memo per baris */}
                              {l.memo && l.memo !== e.description && (
                                <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 2, paddingLeft: isCredit ? 18 : 0 }}>
                                  ({l.memo})
                                </div>
                              )}

                              {/* Keterangan umum transaksi (di bawah baris terakhir) */}
                              {lineIdx === e.lines.length - 1 && e.description && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: '#475569',
                                    fontStyle: 'italic',
                                    marginTop: 4,
                                    paddingLeft: 8,
                                    borderLeft: '2px solid #cbd5e1'
                                  }}
                                >
                                  Ket: {e.description}
                                </div>
                              )}
                            </td>

                            {/* Ref (Kode Akun) */}
                            <td style={{ textAlign: 'center', color: '#64748b', fontSize: 12 }}>
                              {l.code}
                            </td>

                            {/* Nominal Debit */}
                            <td className="number" style={{ fontWeight: 600, color: '#15803d' }}>
                              {Number(l.debit) > 0 ? money(l.debit) : ''}
                            </td>

                            {/* Nominal Kredit */}
                            <td className="number" style={{ fontWeight: 600, color: '#0369a1' }}>
                              {Number(l.credit) > 0 ? money(l.credit) : ''}
                            </td>

                            {/* Status */}
                            <td style={{ textAlign: 'center' }}>
                              {isFirstLine ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                                  <Badge status={e.status || 'POSTED'} />
                                  {e.reversed && (
                                    <span title="Sudah dibalik oleh jurnal pembalik">
                                      <Badge status="REVERSED" />
                                    </span>
                                  )}
                                </div>
                              ) : null}
                            </td>

                            {/* Aksi: draft boleh diubah/dihapus, terposting dikoreksi dengan pembalik */}
                            <td style={{ textAlign: 'center' }}>
                              {isFirstLine ? (
                                <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                                  {isDraft ? (
                                    <>
                                      <button
                                        type="button"
                                        className="icon-button"
                                        title={`Ubah draft ${e.voucher_no}`}
                                        aria-label={`Ubah draft ${e.voucher_no}`}
                                        onClick={() => edit(e.id)}
                                      >
                                        <Edit size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-button"
                                        style={{ color: '#16a34a' }}
                                        title={`Posting ${e.voucher_no} ke buku besar`}
                                        aria-label={`Posting ${e.voucher_no}`}
                                        onClick={() => postDraft(e.id, e.voucher_no)}
                                      >
                                        <Send size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-button"
                                        style={{ color: '#e11d48' }}
                                        title={`Hapus draft ${e.voucher_no}`}
                                        aria-label={`Hapus draft ${e.voucher_no}`}
                                        onClick={() => deleteJournal(e.id, e.voucher_no)}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        className="icon-button"
                                        title={`Lihat transaksi ${e.voucher_no}`}
                                        aria-label={`Lihat transaksi ${e.voucher_no}`}
                                        onClick={() => edit(e.id)}
                                      >
                                        <Eye size={14} />
                                      </button>
                                      {!e.reversed && (
                                        <button
                                          type="button"
                                          className="icon-button"
                                          style={{ color: '#b45309' }}
                                          title={`Buat jurnal pembalik untuk ${e.voucher_no}`}
                                          aria-label={`Jurnal pembalik ${e.voucher_no}`}
                                          onClick={() => setReverseTarget(e)}
                                        >
                                          <Undo2 size={14} />
                                        </button>
                                      )}
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    className="icon-button"
                                    title={`Riwayat audit ${e.voucher_no}`}
                                    aria-label={`Riwayat audit ${e.voucher_no}`}
                                    onClick={() => setAuditTarget(e.id)}
                                  >
                                    <History size={14} />
                                  </button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </tbody>

              {/* Baris Total Garis Ganda Standar Akuntansi */}
              <tfoot>
                <tr
                  style={{
                    borderTop: '2px solid #0f172a',
                    borderBottom: '4px double #0f172a',
                    background: '#f8fafc',
                    fontWeight: 800,
                    fontSize: 14
                  }}
                >
                  <td colSpan={2} style={{ textAlign: 'center' }}>TOTAL JURNAL UMUM</td>
                  <td>
                    {totals.isBalanced ? (
                      <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 700 }}>
                        ✓ SEIMBANG (BALANCED)
                      </span>
                    ) : (
                      <span style={{ color: '#e11d48', fontSize: 12, fontWeight: 700 }}>
                        ⚠️ TIDAK SEIMBANG!
                      </span>
                    )}
                  </td>
                  <td />
                  <td className="number" style={{ color: '#15803d' }}>{money(totals.debit)}</td>
                  <td className="number" style={{ color: '#0369a1' }}>{money(totals.credit)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>

            {!filteredEntries.length && (
              <Empty>
                Tidak ada transaksi pada periode atau kriteria filter ini. Klik &quot;Catat Transaksi Baru&quot; untuk memulai.
              </Empty>
            )}
          </div>

          {sortedEntries.length > filters.pageSize && (
            <div className="pager no-print">
              <label htmlFor="journals-page-size">Tampilkan</label>
              <select
                id="journals-page-size"
                className="select"
                value={filters.pageSize}
                onChange={(e) => patch({ pageSize: Number(e.target.value) })}
              >
                {[25, 50, 100, 500].map((n) => (
                  <option key={n} value={n}>
                    {n} transaksi
                  </option>
                ))}
              </select>
              <span>
                Halaman {currentPage} dari {pageCount} &middot; {sortedEntries.length} transaksi
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  variant="secondary"
                  small
                  disabled={currentPage <= 1}
                  aria-label="Halaman sebelumnya"
                  onClick={() => patch({ page: currentPage - 1 })}
                >
                  <ChevronLeft size={14} /> Sebelumnya
                </Button>
                <Button
                  variant="secondary"
                  small
                  disabled={currentPage >= pageCount}
                  aria-label="Halaman berikutnya"
                  onClick={() => patch({ page: currentPage + 1 })}
                >
                  Berikutnya <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Modals */}
      {modal !== null && (
        <JournalModal
          accounts={accounts}
          entry={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            reload()
          }}
          notify={notify}
        />
      )}

      {reverseTarget && (
        <ReverseJournalModal
          entry={reverseTarget}
          onClose={() => setReverseTarget(null)}
          onReversed={() => {
            setReverseTarget(null)
            reload()
          }}
          notify={notify}
        />
      )}

      {auditTarget !== null && <AuditLogModal journalId={auditTarget} onClose={() => setAuditTarget(null)} />}

      {showImport && (
        <ExcelImportModal
          onClose={() => setShowImport(false)}
          notify={notify}
          onImported={reload}
        />
      )}
    </>
  )
}
