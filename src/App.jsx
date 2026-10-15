import React, { useCallback, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import { DashboardView } from './components/views/DashboardView.jsx'
import { JournalsView, defaultRegisterFilters } from './components/views/JournalsView.jsx'
import { LedgerView } from './components/views/LedgerView.jsx'
import { TrialBalanceView } from './components/views/TrialBalanceView.jsx'
import { AccountsView } from './components/views/AccountsView.jsx'
import { MusicPlayer } from './components/widgets/MusicPlayer.jsx'
import { PageLoading } from './components/ui/PageLoading.jsx'
import { ErrorNotice } from './components/ui/ErrorNotice.jsx'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'

function Workspace() {
  const [route, setRoute] = useState('journals')
  const [toast, setToast] = useState(null)
  // Filter register dijaga di sini agar berpindah layar tidak menghapus hasil kerja.
  const [registerFilters, setRegisterFilters] = useState(() => defaultRegisterFilters())

  const companyState = useLoad(() => request('/company'), [])
  const accountsState = useLoad(() => request('/accounts'), [])

  const notify = useCallback((message, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  if (companyState.loading || accountsState.loading) {
    return <PageLoading message="Menyiapkan data pembukuan…" />
  }

  const company = companyState.data?.company
  const accounts = accountsState.data?.accounts || []

  let pageContent = null
  switch (route) {
    case 'dashboard':
      pageContent = <DashboardView />
      break
    case 'journals':
    case 'journal-report':
      pageContent = (
        <JournalsView
          accounts={accounts}
          company={company}
          notify={notify}
          filters={registerFilters}
          onFilters={setRegisterFilters}
        />
      )
      break
    case 'ledger':
      pageContent = <LedgerView accounts={accounts} company={company} notify={notify} />
      break
    case 'trial-balance':
      pageContent = <TrialBalanceView company={company} notify={notify} />
      break
    case 'accounts':
      pageContent = <AccountsView accounts={accounts} company={company} notify={notify} />
      break
    default:
      pageContent = (
        <JournalsView
          accounts={accounts}
          company={company}
          notify={notify}
          filters={registerFilters}
          onFilters={setRegisterFilters}
        />
      )
  }

  return (
    <AppShell
      company={company}
      route={route}
      setRoute={setRoute}
    >
      <MusicPlayer notify={notify} />

      {companyState.error || accountsState.error ? (
        <ErrorNotice error={companyState.error || accountsState.error} />
      ) : (
        pageContent
      )}

      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </AppShell>
  )
}

export default function App() {
  return <Workspace />
}
