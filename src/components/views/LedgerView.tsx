import React, { useState } from 'react'
import { Download, Printer, RefreshCw } from 'lucide-react'
import { Button } from '../ui/Button.js'
import { PageLoading } from '../ui/PageLoading.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { apiPath, dateLabel, firstDay, money, today, GL } from '../../utils/formatters.js'
import { exportLedgerToExcel } from '../../services/excelExporter.js'
import { Account, Company } from '../../../shared/types.js'

export interface LedgerViewProps {
  accounts?: Account[]
  company?: Company | null
  notify: (msg: string, isError?: boolean) => void
}

export interface LedgerData {
  account: Account
  opening: number
  closing: number
  rows: {
    entry_date: string
    voucher_no: string
    description?: string
    memo?: string
    debit: number
    credit: number
    balance: number
  }[]
}

export function LedgerView({ accounts = [], company, notify }: LedgerViewProps): React.JSX.Element {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const [selectedAccountId, setSelectedAccountId] = useState<string>(() =>
    accounts[0]?.id ? String(accounts[0].id) : ''
  )
  const [exporting, setExporting] = useState<boolean>(false)

  const currentAccount = accounts.find((a) => String(a.id) === String(selectedAccountId))

  const { data, loading, error, reload } = useLoad<{ data: LedgerData }>(() => {
    if (!selectedAccountId) return null as any
    return request(apiPath('/reports/ledger', { accountId: selectedAccountId, ...range }))
  }, [selectedAccountId, range.from, range.to])

  const ledgerData = data?.data

  async function handleExportExcel() {
    if (!currentAccount || !ledgerData) return
    setExporting(true)
    try {
      await exportLedgerToExcel({
        company,
        account: currentAccount,
        rows: ledgerData.rows || [],
        initialBalance: ledgerData.opening || 0,
        range
      })
      notify(`Buku Besar ${currentAccount.code} berhasil diekspor ke Excel (.xlsx).`)
    } catch (err: any) {
      notify(`Gagal ekspor Excel: ${err.message}`, true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="toolbar no-print">
        <div>
          <h1 className="page-title">Buku Besar (General Ledger)</h1>
          <p className="page-copy">
            Mutasi debit/kredit per akun dengan perhitungan saldo berjalan otomatis (4-kolom).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" small onClick={() => window.print()}>
            <Printer size={15} /> Cetak Buku Besar
          </Button>
          <Button
            variant="secondary"
            small
            disabled={exporting || !ledgerData}
            onClick={handleExportExcel}
          >
            <Download size={15} /> {exporting ? 'Mengekspor…' : 'Ekspor Excel'}
          </Button>
        </div>
      </div>

      <div className="panel no-print" style={{ marginBottom: 20 }}>
        <div className="filter-row">
          <div className="field" style={{ minWidth: 260 }}>
            <label htmlFor="ledger-account">PILIH AKUN BUKU BESAR</label>
            <select
              id="ledger-account"
              className="select"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name} ({a.normal_balance === 'DEBIT' ? 'D' : 'K'})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ledger-from">DARI TANGGAL</label>
            <input
              id="ledger-from"
              className="input"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="ledger-to">SAMPAI TANGGAL</label>
            <input
              id="ledger-to"
              className="input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <Button variant="secondary" small onClick={reload} aria-label="Muat ulang data buku besar">
            <RefreshCw size={14} aria-hidden="true" /> Muat Ulang
          </Button>
        </div>
      </div>

      <ErrorNotice error={error} />

      {currentAccount && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14,
            marginBottom: 20
          }}
        >
          <div className="stat-card" style={{ padding: 14 }}>
            <div className="stat-label">KODE &amp; NAMA AKUN</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
              {currentAccount.code} — {currentAccount.name}
            </div>
          </div>
          <div className="stat-card" style={{ padding: 14 }}>
            <div className="stat-label">KELOMPOK &amp; SALDO NORMAL</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>
              {GL[currentAccount.account_group] || currentAccount.account_group} (
              {currentAccount.normal_balance})
            </div>
          </div>
          <div className="stat-card" style={{ padding: 14 }}>
            <div className="stat-label">SALDO AWAL PERIODE</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4, color: '#0f172a' }}>
              {ledgerData ? money(ledgerData.opening) : '-'}
            </div>
          </div>
          <div
            className="stat-card"
            style={{ padding: 14, background: '#f0fdf4', borderColor: '#bbf7d0' }}
          >
            <div className="stat-label" style={{ color: '#166534' }}>
              SALDO AKHIR PERIODE
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4, color: '#15803d' }}>
              {ledgerData ? money(ledgerData.closing) : '-'}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <PageLoading message="Menghitung saldo buku besar…" />
      ) : (
        <section className="panel panel-tight" aria-label="Tabel Buku Besar">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '14%' }}>
                    Tanggal
                  </th>
                  <th scope="col" style={{ width: '16%' }}>
                    No. Bukti / Ref
                  </th>
                  <th scope="col" style={{ width: '38%' }}>
                    Keterangan Transaksi
                  </th>
                  <th scope="col" style={{ width: '16%', textAlign: 'right' }}>
                    Debit (Rp)
                  </th>
                  <th scope="col" style={{ width: '16%', textAlign: 'right' }}>
                    Kredit (Rp)
                  </th>
                  <th scope="col" style={{ width: '18%', textAlign: 'right' }}>
                    Saldo Berjalan (Rp)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: '#f8fafc', fontStyle: 'italic' }}>
                  <td>{dateLabel(range.from)}</td>
                  <td>-</td>
                  <td>Saldo Awal Periode</td>
                  <td className="number">-</td>
                  <td className="number">-</td>
                  <td className="number">
                    <strong>{ledgerData ? money(ledgerData.opening) : money(0)}</strong>
                  </td>
                </tr>
                {ledgerData?.rows?.map((r, i) => (
                  <tr key={i}>
                    <td>{dateLabel(r.entry_date)}</td>
                    <td>
                      <strong>{r.voucher_no}</strong>
                    </td>
                    <td>{r.memo || r.description}</td>
                    <td className="number">{r.debit > 0 ? money(r.debit) : '-'}</td>
                    <td className="number">{r.credit > 0 ? money(r.credit) : '-'}</td>
                    <td className="number" style={{ fontWeight: 700 }}>
                      {money(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="accounting-double-line">
                  <td colSpan={5} style={{ padding: '12px 14px' }}>
                    <strong>SALDO AKHIR BUKU BESAR PER {dateLabel(range.to)}</strong>
                  </td>
                  <td className="number" style={{ fontSize: 14 }}>
                    {ledgerData ? money(ledgerData.closing) : money(0)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {!ledgerData?.rows?.length && (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b' }}>
                Tidak ada transaksi mutasi pada akun ini selama periode {dateLabel(range.from)} s.d.{' '}
                {dateLabel(range.to)}.
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
