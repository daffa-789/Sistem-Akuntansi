import React, { useMemo, useState } from 'react'
import { Download, FileText, Printer, RefreshCw } from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Button } from '../ui/Button.js'
import { PageLoading } from '../ui/PageLoading.js'
import { Empty } from '../ui/Empty.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { apiPath, dateLabel, firstDay, money, today } from '../../utils/formatters.js'
import { exportJournalToExcel, JournalRecap } from '../../services/excelExporter.js'
import { Account, Company } from '../../../shared/types.js'

export interface JournalReportViewProps {
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
  lines: ReportLine[]
}

export interface JournalReportData {
  entries: ReportEntry[]
  recap: JournalRecap
}

export function JournalReportView({ accounts = [], company, notify }: JournalReportViewProps): React.JSX.Element {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const [accountFilter, setAccountFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [exporting, setExporting] = useState<boolean>(false)

  const { data, loading, error, reload } = useLoad<{ data: JournalReportData | ReportEntry[] }>(
    () => request(apiPath('/reports/journal', range)),
    [range.from, range.to]
  )

  const setQuickRange = (type: 'this-month' | 'last-month' | 'this-year') => {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth()
    if (type === 'this-month') {
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

  const reportData = data?.data
  const allEntries = useMemo<ReportEntry[]>(() => {
    if (!reportData) return []
    return Array.isArray(reportData) ? reportData : reportData.entries || []
  }, [reportData])

  const filteredEntries = useMemo(() => {
    let list = allEntries
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
  }, [allEntries, accountFilter, searchQuery])

  const totals = useMemo(() => {
    let debit = 0
    let credit = 0
    for (const e of filteredEntries) {
      for (const l of e.lines) {
        debit += Number(l.debit || 0)
        credit += Number(l.credit || 0)
      }
    }
    return { debit, credit, isBalanced: Math.abs(debit - credit) < 0.005 }
  }, [filteredEntries])

  const recap = useMemo<JournalRecap>(() => {
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

  async function handleExportExcel() {
    setExporting(true)
    try {
      await exportJournalToExcel({
        company,
        entries: filteredEntries as any,
        range,
        totals,
        recap
      })
      notify('Laporan Jurnal Umum & Rekapitulasi berhasil diekspor ke Excel (.xlsx).')
    } catch (err: any) {
      notify(`Gagal ekspor Excel: ${err.message}`, true)
    } finally {
      setExporting(false)
    }
  }

  async function handleExportPDF() {
    try {
      const doc = new jsPDF()
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
        didParseCell: (dataCell) => {
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
        const maxLen = Math.max(recap.debits.length, recap.credits.length)
        for (let i = 0; i < maxLen; i++) {
          const d = recap.debits[i]
          const c = recap.credits[i]
          recapBody.push([
            d ? `${d.code} - ${d.name}` : '',
            d ? money(d.amount) : '',
            c ? `${c.code} - ${c.name}` : '',
            c ? money(c.amount) : ''
          ])
        }
        recapBody.push([
          'TOTAL DEBIT',
          money(recap.totalDebit),
          'TOTAL KREDIT',
          money(recap.totalCredit)
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

      doc.save(`Finova_Jurnal_Umum_${range.from}_sd_${range.to}.pdf`)
      notify('Laporan Jurnal Umum berhasil diekspor ke PDF.')
    } catch (err: any) {
      notify(`Gagal ekspor PDF: ${err.message}`, true)
    }
  }

  return (
    <>
      <div className="toolbar no-print">
        <div>
          <h1 className="page-title">Laporan Jurnal Umum</h1>
          <p className="page-copy">
            Buku Jurnal Umum resmi berstandar akuntansi dengan indentasi kredit &amp; rekapitulasi.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" small onClick={() => window.print()}>
            <Printer size={15} /> Cetak Dokumen
          </Button>
          <Button variant="secondary" small disabled={exporting} onClick={handleExportExcel}>
            <Download size={15} /> {exporting ? 'Mengekspor…' : 'Ekspor Excel'}
          </Button>
          <Button variant="secondary" small onClick={handleExportPDF}>
            <FileText size={15} /> Ekspor PDF
          </Button>
        </div>
      </div>

      <div className="panel no-print" style={{ marginBottom: 20 }}>
        <div className="filter-row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="report-from">DARI TANGGAL</label>
            <input
              id="report-from"
              className="input"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="report-to">SAMPAI TANGGAL</label>
            <input
              id="report-to"
              className="input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="report-account">FILTER AKUN</label>
            <select
              id="report-account"
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
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="report-search">CARI TRANSAKSI</label>
            <input
              id="report-search"
              className="input"
              placeholder="No bukti atau uraian..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="secondary" small onClick={reload} aria-label="Segarkan laporan">
            <RefreshCw size={14} aria-hidden="true" /> Segarkan
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>PINTASAN PERIODE:</span>
          <button type="button" className="button secondary small" onClick={() => setQuickRange('this-month')}>
            Bulan Ini
          </button>
          <button type="button" className="button secondary small" onClick={() => setQuickRange('last-month')}>
            Bulan Lalu
          </button>
          <button type="button" className="button secondary small" onClick={() => setQuickRange('this-year')}>
            Tahun Ini
          </button>
        </div>
      </div>

      <ErrorNotice error={error} />

      {loading ? (
        <PageLoading message="Menyusun buku jurnal umum…" />
      ) : (
        <section className="panel" style={{ padding: 28 }} aria-label="Buku Jurnal Umum">
          {/* Kop Resmi Laporan Akuntansi */}
          <div
            className="report-heading"
            style={{ borderBottom: '2px solid #0f172a', paddingBottom: 16, marginBottom: 20 }}
          >
            <h2 style={{ margin: '0 0 4px', fontSize: 20, letterSpacing: 0.5 }}>
              {company?.name || 'PT FINOVA AKUNTANSI INDONESIA'}
            </h2>
            <h3
              style={{
                margin: '0 0 4px',
                fontSize: 16,
                color: '#047857',
                letterSpacing: 1,
                textTransform: 'uppercase'
              }}
            >
              JURNAL UMUM (GENERAL JOURNAL)
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
              Periode: <strong>{dateLabel(range.from)} s.d. {dateLabel(range.to)}</strong> | Satuan:{' '}
              <strong>Rupiah (IDR)</strong>
            </p>
          </div>

          <div className="table-wrap">
            <table className="table" style={{ border: '1px solid #cbd5e1' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th scope="col" style={{ width: '12%', borderRight: '1px solid #e2e8f0' }}>
                    Tanggal
                  </th>
                  <th scope="col" style={{ width: '15%', borderRight: '1px solid #e2e8f0' }}>
                    No. Bukti
                  </th>
                  <th scope="col" style={{ width: '43%', borderRight: '1px solid #e2e8f0' }}>
                    Nama Akun &amp; Keterangan
                  </th>
                  <th scope="col" style={{ width: '8%', textAlign: 'center', borderRight: '1px solid #e2e8f0' }}>
                    Ref
                  </th>
                  <th scope="col" style={{ width: '11%', textAlign: 'right', borderRight: '1px solid #e2e8f0' }}>
                    Debit (Rp)
                  </th>
                  <th scope="col" style={{ width: '11%', textAlign: 'right' }}>
                    Kredit (Rp)
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((e) => {
                  return e.lines.map((l, idx) => {
                    const isFirst = idx === 0
                    const isCredit = Number(l.credit || 0) > 0
                    const isLastLine = idx === e.lines.length - 1
                    return (
                      <tr
                        key={`${e.id}-${l.account_id}-${idx}`}
                        style={{
                          borderBottom: isLastLine ? '2px solid #cbd5e1' : '1px dashed #e2e8f0'
                        }}
                      >
                        <td
                          style={{
                            borderRight: '1px solid #e2e8f0',
                            color: '#334155',
                            fontWeight: isFirst ? 600 : 400
                          }}
                        >
                          {isFirst ? e.entry_date : ''}
                        </td>
                        <td style={{ borderRight: '1px solid #e2e8f0', color: '#0f172a' }}>
                          {isFirst ? <strong>{e.voucher_no}</strong> : ''}
                        </td>
                        <td style={{ borderRight: '1px solid #e2e8f0' }}>
                          <div
                            className={
                              isCredit
                                ? 'journal-credit-indent journal-credit-text'
                                : 'journal-debit-text'
                            }
                          >
                            {l.account_name}
                          </div>
                          {isFirst && e.description && (
                            <span className="journal-memo-text">({e.description})</span>
                          )}
                          {l.memo && l.memo !== e.description && (
                            <span className="journal-memo-text" style={{ color: '#0284c7' }}>
                              Catatan: {l.memo}
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            textAlign: 'center',
                            borderRight: '1px solid #e2e8f0',
                            color: '#64748b',
                            fontSize: 12
                          }}
                        >
                          {l.code}
                        </td>
                        <td
                          className="number"
                          style={{
                            borderRight: '1px solid #e2e8f0',
                            fontWeight: isCredit ? 400 : 600,
                            color: isCredit ? '#94a3b8' : '#0f172a'
                          }}
                        >
                          {Number(l.debit) > 0 ? money(l.debit) : '-'}
                        </td>
                        <td
                          className="number"
                          style={{
                            fontWeight: isCredit ? 600 : 400,
                            color: isCredit ? '#0369a1' : '#94a3b8'
                          }}
                        >
                          {Number(l.credit) > 0 ? money(l.credit) : '-'}
                        </td>
                      </tr>
                    )
                  })
                })}
              </tbody>
              <tfoot>
                <tr className="accounting-double-line">
                  <td colSpan={3} style={{ padding: '14px 16px', fontSize: 14 }}>
                    <strong>JUMLAH TOTAL JURNAL UMUM</strong>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {totals.isBalanced ? (
                      <span style={{ color: '#16a34a', fontWeight: 700 }} title="Seimbang">
                        ✓
                      </span>
                    ) : (
                      <span style={{ color: '#dc2626', fontWeight: 700 }} title="Tidak Seimbang">
                        ⚠️
                      </span>
                    )}
                  </td>
                  <td className="number" style={{ fontSize: 14, color: '#065f46' }}>
                    {money(totals.debit)}
                  </td>
                  <td className="number" style={{ fontSize: 14, color: '#065f46' }}>
                    {money(totals.credit)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {!filteredEntries.length && (
              <Empty>Tidak ada transaksi terposting pada filter periode ini.</Empty>
            )}
          </div>

          {/* Bagian Rekapitulasi Jurnal Umum */}
          {filteredEntries.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                  flexWrap: 'wrap',
                  gap: 8
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    fontSize: 14,
                    color: '#0f172a',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}
                >
                  Tabel Rekapitulasi Jurnal Umum
                </h4>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Digunakan untuk ringkasan sebelum posting ke Buku Besar
                </span>
              </div>
              <div className="recap-grid">
                <div className="recap-box">
                  <div className="recap-title recap-debit-title">
                    <span>Sisi Debit</span>
                    <span>Total: {money(recap.totalDebit)}</span>
                  </div>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th scope="col">Kode</th>
                        <th scope="col">Nama Akun</th>
                        <th scope="col" className="number">
                          Jumlah (Rp)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recap.debits.map((d) => (
                        <tr key={d.code}>
                          <td>
                            <strong>{d.code}</strong>
                          </td>
                          <td>{d.name}</td>
                          <td className="number">{money(d.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="recap-box">
                  <div className="recap-title recap-credit-title">
                    <span>Sisi Kredit</span>
                    <span>Total: {money(recap.totalCredit)}</span>
                  </div>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th scope="col">Kode</th>
                        <th scope="col">Nama Akun</th>
                        <th scope="col" className="number">
                          Jumlah (Rp)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recap.credits.map((c) => (
                        <tr key={c.code}>
                          <td>
                            <strong>{c.code}</strong>
                          </td>
                          <td>{c.name}</td>
                          <td className="number">{money(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Kolom Lembar Pengesahan Tanda Tangan Cetak Resmi */}
          <div className="print-signatures">
            <div className="sig-col">
              <div>Dibuat Oleh:</div>
              <div className="sig-space" />
              <div className="sig-line">( Staf Keuangan / Siswa )</div>
              <div className="sig-title">Tanggal: {dateLabel(today())}</div>
            </div>
            <div className="sig-col">
              <div>Diperiksa Oleh:</div>
              <div className="sig-space" />
              <div className="sig-line">( Guru / Dosen / Auditor )</div>
              <div className="sig-title">Tanggal: ......................</div>
            </div>
            <div className="sig-col">
              <div>Disetujui Oleh:</div>
              <div className="sig-space" />
              <div className="sig-line">( Pimpinan Perusahaan )</div>
              <div className="sig-title">Tanggal: ......................</div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
