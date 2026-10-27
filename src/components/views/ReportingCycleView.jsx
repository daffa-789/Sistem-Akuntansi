import React, { useState } from 'react'
import { BookOpen, Download, FileBarChart, FileText, Landmark, ReceiptText } from 'lucide-react'
import { DashboardView } from './DashboardView.jsx'
import { JournalsView, defaultRegisterFilters } from './JournalsView.jsx'
import { LedgerView } from './LedgerView.jsx'
import { TrialBalanceView } from './TrialBalanceView.jsx'
import { AccountsView } from './AccountsView.jsx'
import { CycleTabs } from './CyclePrimitives.jsx'

const SAMPLE_FILE = '/outputs/20261027-sia-five-cycles/Contoh_Data_Dummy_SIA_Arunika.xlsx'
const VIEWS = [
  ['summary', 'Ringkasan', FileBarChart],
  ['journals', 'Jurnal umum', BookOpen],
  ['ledger', 'Buku besar', ReceiptText],
  ['trial-balance', 'Neraca saldo', FileText],
  ['accounts', 'Bagan akun', Landmark]
]

export function ReportingCycleView({ accounts = [], company, notify }) {
  const [view, setView] = useState('summary')
  const [registerFilters, setRegisterFilters] = useState(() => defaultRegisterFilters())

  return (
    <>
      <section className="report-cycle-banner">
        <div className="report-cycle-heading">
          <div className="cycle-kicker"><span>SIKLUS 05</span><i />Buku besar dan laporan keuangan</div>
          <h1>Buku Besar &amp; Pelaporan</h1>
          <p>Satukan transaksi yang sudah dibukukan, tinjau saldo, dan siapkan laporan.</p>
        </div>
        <a className="button secondary report-sample-button" href={SAMPLE_FILE} download>
          <Download size={15} aria-hidden="true" /> Unduh Excel contoh
        </a>
      </section>
      <CycleTabs value={view} items={VIEWS} onChange={setView} label="Subbagian buku besar dan pelaporan" />
      <div className="report-cycle-source"><span className="report-source-dot" />Laporan di bawah membaca data pembukuan aplikasi. Data dummy Excel adalah contoh terpisah.</div>
      {view === 'summary' && <DashboardView />}
      {view === 'journals' && <JournalsView accounts={accounts} company={company} notify={notify} filters={registerFilters} onFilters={setRegisterFilters} />}
      {view === 'ledger' && <LedgerView accounts={accounts} company={company} notify={notify} />}
      {view === 'trial-balance' && <TrialBalanceView company={company} notify={notify} />}
      {view === 'accounts' && <AccountsView accounts={accounts} company={company} notify={notify} />}
    </>
  )
}
