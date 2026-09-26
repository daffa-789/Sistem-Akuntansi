import React, { useCallback, useState } from 'react'
import { AppShell } from './components/layout/AppShell.js'
import { DashboardView } from './components/views/DashboardView.js'
import { JournalsView, RegisterFilters, defaultRegisterFilters } from './components/views/JournalsView.js'
import { LedgerView } from './components/views/LedgerView.js'
import { TrialBalanceView } from './components/views/TrialBalanceView.js'
import { AccountsView } from './components/views/AccountsView.js'
import { MusicPlayer } from './components/widgets/MusicPlayer.js'
import { PageLoading } from './components/ui/PageLoading.js'
import { ErrorNotice } from './components/ui/ErrorNotice.js'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'
import { Account, Company } from '../shared/types.js'

export interface ToastState {
  message: string
  error: boolean
}

function Workspace(): React.JSX.Element {
  const [route, setRoute] = useState<string>('journals')
  const [toast, setToast] = useState<ToastState | null>(null)
  // Filter register dijaga di sini agar berpindah layar tidak menghapus hasil kerja.
  const [registerFilters, setRegisterFilters] = useState<RegisterFilters>(() => defaultRegisterFilters())

  const companyState = useLoad<{ company: Company }>(() => request('/company'), [])
  const accountsState = useLoad<{ accounts: Account[] }>(() => request('/accounts'), [])

  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  if (companyState.loading || accountsState.loading) {
    return <PageLoading message="Menyiapkan data pembukuan…" />
  }

  const company = companyState.data?.company
  const accounts = accountsState.data?.accounts || []

  let pageContent: React.ReactNode = null
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

export default function App(): React.JSX.Element {
  return <Workspace />
}
