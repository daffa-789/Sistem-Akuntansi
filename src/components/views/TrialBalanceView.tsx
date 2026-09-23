import React, { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Printer, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button.js'
import { PrintHeader, PrintSignatures } from '../ui/PrintFrame.js'
import { PageLoading } from '../ui/PageLoading.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { apiPath, firstDay, money, today, GL } from '../../utils/formatters.js'
import { exportTrialBalanceFile } from '../../services/downloads.js'
import { Company, TrialBalanceResult } from '../../../shared/types.js'

export interface TrialBalanceViewProps {
  company?: Company | null
  notify: (msg: string, isError?: boolean) => void
}

export function TrialBalanceView({ company, notify }: TrialBalanceViewProps): React.JSX.Element {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const [exporting, setExporting] = useState<boolean>(false)

  const { data, loading, error, reload } = useLoad<{ data: TrialBalanceResult }>(
    () => request(apiPath('/reports/trial-balance', range)),
    [range.from, range.to]
  )
  const tb = data?.data

  async function handleExportExcel() {
    if (!tb?.rows) return
    setExporting(true)
    try {
      await exportTrialBalanceFile(range)
      notify(`Neraca Saldo per ${range.to} berhasil diekspor ke Excel (.xlsx).`)
    } catch (err: any) {
      notify(`Gagal ekspor Excel: ${err.message}`, true)
    } finally {
      setExporting(false)
    }
  }

  const isBalanced = Math.abs((tb?.totals?.debit || 0) - (tb?.totals?.credit || 0)) < 0.005

  return (
    <>
      <PrintHeader title='Neraca Saldo (Trial Balance)' company={company} range={range} />
      <div className="toolbar no-print">
        <div>
          <h1 className="page-title">Neraca Saldo (Trial Balance)</h1>
          <p className="page-copy">
            Verifikasi keseimbangan total saldo debit dan kredit seluruh akun sebelum penyesuaian/laporan.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" small onClick={() => window.print()}>
            <Printer size={15} /> Cetak Neraca Saldo
          </Button>
          <Button
            variant="secondary"
            small
            disabled={exporting || !tb?.rows}
            onClick={handleExportExcel}
          >
            <Download size={15} /> {exporting ? 'Mengekspor…' : 'Ekspor Excel'}
          </Button>
        </div>
      </div>

      <div className="panel no-print" style={{ marginBottom: 20 }}>
        <div className="filter-row">
          <div className="field">
            <label htmlFor="tb-to">PERIODE S.D. TANGGAL</label>
            <input
              id="tb-to"
              className="input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <Button variant="secondary" small onClick={reload} aria-label="Muat ulang neraca saldo">
            <RefreshCw size={14} aria-hidden="true" /> Muat Ulang
          </Button>
        </div>
      </div>

      <ErrorNotice error={error} />

      {loading ? (
        <PageLoading message="Menghitung neraca saldo…" />
      ) : (
        <section className="panel panel-tight" aria-label="Tabel Neraca Saldo">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Kode Akun</th>
                  <th scope="col">Nama Akun</th>
                  <th scope="col">Kelompok</th>
                  <th scope="col" className="number">
                    Debit (Rp)
                  </th>
                  <th scope="col" className="number">
                    Kredit (Rp)
                  </th>
                </tr>
              </thead>
              <tbody>
                {tb?.rows?.map((r) => (
                  <tr key={r.accountId}>
                    <td>
                      <strong>{r.code}</strong>
                    </td>
                    <td>{r.name}</td>
                    <td className="muted">{GL[r.group] || r.group}</td>
                    <td className="number">{r.debit > 0 ? money(r.debit) : '-'}</td>
                    <td className="number">{r.credit > 0 ? money(r.credit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="accounting-double-line">
                  <td colSpan={3} style={{ padding: '14px 16px' }}>
                    <strong>TOTAL NERACA SALDO</strong>
                  </td>
                  <td className="number" style={{ fontSize: 14 }}>
                    {money(tb?.totals?.debit)}
                  </td>
                  <td className="number" style={{ fontSize: 14 }}>
                    {money(tb?.totals?.credit)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {isBalanced ? (
              <div className="verdict">
                <CheckCircle2 size={15} /> Neraca Saldo Seimbang (Total Debit = Total Kredit)
              </div>
            ) : (
              <div className="verdict is-off">
                <AlertTriangle size={15} />
                <span>
                  Terdapat selisih neraca saldo:{' '}
                  {money(Math.abs((tb?.totals?.debit || 0) - (tb?.totals?.credit || 0)))}
                </span>
              </div>
            )}
          </div>
        </section>
      )}
      <PrintSignatures />
    </>
  )
}
