import React, { useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { Button } from '../ui/Button.js'
import { PrintHeader, PrintSignatures } from '../ui/PrintFrame.js'
import { GL } from '../../utils/formatters.js'
import { exportAccountsFile } from '../../services/downloads.js'
import { Account, AccountGroup, Company } from '../../../shared/types.js'

export interface AccountsViewProps {
  accounts?: Account[]
  company?: Company | null
  notify: (msg: string, isError?: boolean) => void
}

export function AccountsView({ accounts = [], company, notify }: AccountsViewProps): React.JSX.Element {
  const [filterGroup, setFilterGroup] = useState<string>('ALL')
  const [search, setSearch] = useState<string>('')
  const [exporting, setExporting] = useState<boolean>(false)

  const filtered = useMemo(() => {
    let list = accounts
    if (filterGroup !== 'ALL') list = list.filter((a) => a.account_group === filterGroup)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
      )
    }
    return list
  }, [accounts, filterGroup, search])

  async function handleExportExcel() {
    setExporting(true)
    try {
      await exportAccountsFile()
      notify('Master Bagan Akun berhasil diekspor ke Excel (.xlsx).')
    } catch (err: any) {
      notify(`Gagal ekspor Excel: ${err.message}`, true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <PrintHeader title='Bagan Akun (Chart of Accounts)' company={company} />
      <div className="toolbar no-print">
        <div>
          <h1 className="page-title">Bagan Akun (Chart of Accounts)</h1>
          <p className="page-copy">
            Struktur akun standar akuntansi Indonesia lengkap dengan panduan saldo normal.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" small onClick={() => window.print()}>
            <Printer size={15} /> Cetak CoA
          </Button>
          <Button variant="secondary" small disabled={exporting} onClick={handleExportExcel}>
            <Download size={15} /> {exporting ? 'Mengekspor…' : 'Ekspor Excel'}
          </Button>
        </div>
      </div>

      <div className="panel no-print" style={{ marginBottom: 20 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center'
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filter Kelompok Akun">
            {[
              ['ALL', 'Semua'],
              ['ASSET', 'Aktiva / Aset'],
              ['LIABILITY', 'Liabilitas'],
              ['EQUITY', 'Ekuitas'],
              ['REVENUE', 'Pendapatan'],
              ['EXPENSE', 'Beban']
            ].map(([g, label]) => (
              <button
                key={g}
                type="button"
                className={`button ${filterGroup === g ? 'primary' : 'secondary'} small`}
                onClick={() => setFilterGroup(g)}
                aria-pressed={filterGroup === g}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ minWidth: 220 }}>
            <input
              id="account-search-input"
              className="input"
              placeholder="Cari kode atau nama akun..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Cari akun berdasarkan kode atau nama"
            />
          </div>
        </div>
      </div>

      <section className="panel panel-tight" aria-label="Daftar Bagan Akun">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Kode</th>
                <th scope="col">Nama Akun</th>
                <th scope="col">Kelompok</th>
                <th scope="col">Subtipe</th>
                <th scope="col">Saldo Normal</th>
                <th scope="col">Arus Kas</th>
                <th scope="col">Kas/Bank</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.code}</strong>
                  </td>
                  <td>{a.name}</td>
                  <td>
                    <span className="badge slate">{GL[a.account_group] || a.account_group}</span>
                  </td>
                  <td className="muted">{a.account_subtype || '-'}</td>
                  <td>
                    <span className={`badge ${a.normal_balance === 'DEBIT' ? 'green' : 'amber'}`}>
                      {a.normal_balance}
                    </span>
                  </td>
                  <td className="muted">{a.cash_flow_category || 'OPERATING'}</td>
                  <td>
                    {a.is_cash_account ? (
                      <span className="badge green">Ya</span>
                    ) : (
                      <span className="muted">Tidak</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <PrintSignatures />
    </>
  )
}
