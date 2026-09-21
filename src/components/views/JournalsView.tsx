import React, { useMemo, useState } from 'react'
import {
  BarChart3,
  CheckCircle2,
  Edit,
  FileSpreadsheet,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
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
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { apiPath, dateLabel, firstDay, money, today } from '../../utils/formatters.js'
import { exportJournalToExcel, JournalRecap } from '../../services/excelExporter.js'
import { Account, Company } from '../../../shared/types.js'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface JournalsViewProps {
  accounts?: Account[]
  company?: Company | null
  notify: (msg: string, isError?: boolean) => void
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
  lines: ReportLine[]
}

export interface JournalReportData {
  entries: ReportEntry[]
  recap: JournalRecap
}

export function JournalsView({ accounts = [], company, notify }: JournalsViewProps): React.JSX.Element {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'POSTED' | 'DRAFT'>('ALL')
  const [accountFilter, setAccountFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showRecap, setShowRecap] = useState<boolean>(false)

  const [modal, setModal] = useState<any | null>(null)
  const [showImport, setShowImport] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)

  // Load report data which includes full lines, vouchers, status, and recap
  const { data, loading, error, reload } = useLoad<{ data: JournalReportData | ReportEntry[] }>(
    () => request(apiPath('/reports/journal', range)),
    [range.from, range.to]
  )

  const reportData = data?.data
  const allEntries = useMemo<ReportEntry[]>(() => {
    if (!reportData) return []
    return Array.isArray(reportData) ? reportData : reportData.entries || []
  }, [reportData])

  const setQuickRange = (type: 'today' | 'this-month' | 'last-month' | 'this-year') => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    if (type === 'today') {
      setRange({ from: today(), to: today() })
    } else if (type === 'this-month') {
      setRange({ from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: today() })
    } else if (type === 'last-month') {
      const prevMonthLastDay = new Date(y, m, 0)
      const prevMonthFirstDay = new Date(y, m - 1, 1)
      setRange({
        from: prevMonthFirstDay.toISOString().slice(0, 10),
        to: prevMonthLastDay.toISOString().slice(0, 10)
      })
    } else if (type === 'this-year') {
      setRange({ from: `${y}-01-01`, to: today() })
    }
  }

  // Filter entries based on search, status, and account
  const filteredEntries = useMemo(() => {
    let list = allEntries
    if (statusFilter !== 'ALL') {
      list = list.filter((e) => (e.status || 'POSTED') === statusFilter)
    }
    if (accountFilter) {
      list = list.filter((e) => e.lines.some((l) => String(l.account_id) === String(accountFilter)))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
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
  }, [allEntries, statusFilter, accountFilter, searchQuery])

  // Compute live totals
  const totals = useMemo(() => {
    let debit = 0
    let credit = 0
    let cashIn = 0
    let cashOut = 0

    for (const e of filteredEntries) {
      for (const l of e.lines) {
        const d = Number(l.debit || 0)
        const c = Number(l.credit || 0)
        debit += d
        credit += c

        // Detect cash & bank accounts (starting with 1100, 1110)
        if (l.code.startsWith('110') || l.code.startsWith('111')) {
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
  }, [filteredEntries])

  // Compute live recap for the filtered view
  const liveRecap = useMemo<JournalRecap>(() => {
    const debitMap = new Map<string, { code: string; name: string; amount: number }>()
    const creditMap = new Map<string, { code: string; name: string; amount: number }>()
    let totD = 0
    let totC = 0

    for (const e of filteredEntries) {
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
  }, [filteredEntries])

  async function edit(id: number | string) {
    try {
      const res = await request<{ entry: any }>(`/journals/${id}`)
      setModal(res.entry)
    } catch (r: any) {
      notify(r.message || 'Gagal mengambil jurnal.', true)
    }
  }

  async function deleteJournal(id: number | string, vn: string) {
    if (
      !window.confirm(
        `Hapus transaksi jurnal ${vn}? Tindakan ini akan menghapus data transaksi dan mutasi akun terkait secara permanen.`
      )
    ) {
      return
    }
    try {
      await request(`/journals/${id}`, {
        method: 'DELETE'
      })
      notify(`Jurnal ${vn} berhasil dihapus.`)
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

  async function handleExportExcel() {
    setExporting(true)
    try {
      let signers = { maker: 'Staf Keuangan', checker: 'Auditor / Penguji', approver: 'Pimpinan / Direktur' }
      try {
        const raw = localStorage.getItem('finova_signers')
        if (raw) signers = JSON.parse(raw)
      } catch {}

      await exportJournalToExcel({
        company,
        entries: filteredEntries as any,
        range,
        totals,
        recap: liveRecap,
        signers
      })
      notify('Buku Jurnal Umum & Rekapitulasi berhasil diekspor ke Excel (.xlsx).')
    } catch (err: any) {
      notify(`Gagal ekspor Excel: ${err.message}`, true)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportPDF() {
    try {
      const doc = new jsPDF()

      // Read saved signers
      let signers = { maker: 'Staf Keuangan', checker: 'Auditor / Penguji', approver: 'Pimpinan / Direktur' }
      try {
        const raw = localStorage.getItem('finova_signers')
        if (raw) signers = JSON.parse(raw)
      } catch {}

      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text(company?.name || 'PT Finova Akuntansi Indonesia', 14, 15)
      doc.setFontSize(11)
      doc.text('JURNAL UMUM (GENERAL JOURNAL)', 14, 21)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(
        `Periode: ${dateLabel(range.from)} s.d. ${dateLabel(range.to)} | Dicetak: ${dateLabel(today())}`,
        14,
        26
      )

      const body: any[] = []
      for (const e of filteredEntries) {
        for (const [idx, l] of e.lines.entries()) {
          const isFirst = idx === 0
          const isCredit = Number(l.credit || 0) > 0
          body.push([
            isFirst ? e.entry_date : '',
            isFirst ? e.voucher_no : '',
            (isCredit ? '     ↳ ' : '') +
              `${l.account_name}` +
              (l.memo ? `\n(${l.memo})` : isFirst ? `\n(${e.description})` : ''),
            l.code,
            Number(l.debit) > 0 ? money(l.debit) : '',
            Number(l.credit) > 0 ? money(l.credit) : ''
          ])
        }
      }
      body.push(['', '', 'TOTAL', '', money(totals.debit), money(totals.credit)])

      autoTable(doc, {
        startY: 32,
        head: [['Tanggal', 'No. Bukti', 'Keterangan Akun & Transaksi', 'Ref', 'Debit (Rp)', 'Kredit (Rp)']],
        body,
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [14, 113, 69] },
        columnStyles: {
          0: { cellWidth: 22 },
          1: { cellWidth: 26 },
          2: { cellWidth: 70 },
          3: { cellWidth: 15, halign: 'center' },
          4: { cellWidth: 28, halign: 'right' },
          5: { cellWidth: 28, halign: 'right' }
        },
        didParseCell: (dataCell: any) => {
          if (dataCell.row.index === body.length - 1) {
            dataCell.cell.styles.fontStyle = 'bold'
            dataCell.cell.styles.fillColor = [240, 253, 244]
          }
        }
      })

      const finalY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 150
      if (finalY < 225) {
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text('REKAPITULASI JURNAL UMUM', 14, finalY)
        const recapBody: any[] = []
        const maxLen = Math.max(liveRecap.debits.length, liveRecap.credits.length)
        for (let i = 0; i < maxLen; i++) {
          const d = liveRecap.debits[i]
          const c = liveRecap.credits[i]
          recapBody.push([
            d ? `${d.code} - ${d.name}` : '',
            d ? money(d.amount) : '',
            c ? `${c.code} - ${c.name}` : '',
            c ? money(c.amount) : ''
          ])
        }
        recapBody.push([
          'TOTAL DEBIT',
          money(liveRecap.totalDebit),
          'TOTAL KREDIT',
          money(liveRecap.totalCredit)
        ])
        autoTable(doc, {
          startY: finalY + 4,
          head: [['Akun Debit', 'Jumlah', 'Akun Kredit', 'Jumlah']],
          body: recapBody,
          styles: { fontSize: 7, cellPadding: 2 },
          headStyles: { fillColor: [2, 132, 199] },
          columnStyles: {
            0: { cellWidth: 55 },
            1: { cellWidth: 35, halign: 'right' },
            2: { cellWidth: 55 },
            3: { cellWidth: 35, halign: 'right' }
          }
        })
      }

      // Add signature block at the bottom
      const sigY = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 15 : 220
      if (sigY < 250) {
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text('Dibuat Oleh:', 25, sigY)
        doc.text('Diperiksa Oleh:', 90, sigY)
        doc.text('Disetujui Oleh:', 155, sigY)

        doc.setFont('helvetica', 'normal')
        doc.line(20, sigY + 18, 65, sigY + 18)
        doc.text(signers.maker || 'Staf Keuangan', 25, sigY + 22)

        doc.line(85, sigY + 18, 130, sigY + 18)
        doc.text(signers.checker || 'Auditor / Penguji', 90, sigY + 22)

        doc.line(150, sigY + 18, 195, sigY + 18)
        doc.text(signers.approver || 'Pimpinan / Direktur', 155, sigY + 22)
      }

      doc.save(`Finova_Jurnal_Umum_${range.from}_sd_${range.to}.pdf`)
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
          <Button onClick={() => setModal({})}>
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
          <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={12} /> Status: {totals.isBalanced ? 'Seimbang (Balanced)' : 'Periksa Selisih'}
          </div>
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
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>

          <div className="field" style={{ minWidth: 140 }}>
            <label htmlFor="journals-to">SAMPAI TANGGAL</label>
            <input
              id="journals-to"
              className="input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>

          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="journals-account">FILTER AKUN</label>
            <select
              id="journals-account"
              className="select"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="ALL">Semua Status</option>
              <option value="POSTED">Posted</option>
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Search
                size={15}
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
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
                  <th scope="col" style={{ width: 100 }}>Tanggal</th>
                  <th scope="col" style={{ width: 140 }}>No. Bukti</th>
                  <th scope="col">Keterangan Akun &amp; Transaksi</th>
                  <th scope="col" style={{ width: 60, textAlign: 'center' }}>Ref</th>
                  <th scope="col" className="number" style={{ width: 140 }}>Debit (Rp)</th>
                  <th scope="col" className="number" style={{ width: 140 }}>Kredit (Rp)</th>
                  <th scope="col" style={{ width: 90, textAlign: 'center' }}>Status</th>
                  <th scope="col" style={{ width: 90, textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => {
                  const isDraft = e.status === 'DRAFT'
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

                            {/* No. Bukti */}
                            <td>
                              {isFirstLine ? (
                                <strong style={{ color: '#0f172a' }}>{e.voucher_no}</strong>
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
                              {isFirstLine ? <Badge status={e.status || 'POSTED'} /> : null}
                            </td>

                            {/* Aksi: Edit untuk draft, Hapus untuk semua */}
                            <td style={{ textAlign: 'center' }}>
                              {isFirstLine ? (
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                                  {isDraft && (
                                    <>
                                      <button
                                        type="button"
                                        className="icon-button"
                                        title={`Ubah draft ${e.voucher_no}`}
                                        onClick={() => edit(e.id)}
                                      >
                                        <Edit size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-button"
                                        style={{ color: '#16a34a' }}
                                        title={`Posting langsung ${e.voucher_no}`}
                                        onClick={() => postDraft(e.id, e.voucher_no)}
                                      >
                                        <Send size={14} />
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    className="icon-button"
                                    style={{ color: '#e11d48' }}
                                    title={`Hapus transaksi ${e.voucher_no}`}
                                    onClick={() => deleteJournal(e.id, e.voucher_no)}
                                  >
                                    <Trash2 size={14} />
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
        </section>
      )}

      {/* Modals */}
      {modal !== null && (
        <JournalModal
          accounts={accounts}
          entry={modal.id ? modal : modal.lines ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            reload()
          }}
          notify={notify}
        />
      )}

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
