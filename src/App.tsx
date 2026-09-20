import React, { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell.js'
import { OnboardingWalkthrough } from './components/layout/OnboardingWalkthrough.js'
import { LoginView } from './components/views/LoginView.js'
import { DashboardView } from './components/views/DashboardView.js'
import { JournalsView } from './components/views/JournalsView.js'
import { JournalReportView } from './components/views/JournalReportView.js'
import { LedgerView } from './components/views/LedgerView.js'
import { TrialBalanceView } from './components/views/TrialBalanceView.js'
import { AccountsView } from './components/views/AccountsView.js'
import { GlobalSearchModal } from './components/modals/GlobalSearchModal.js'
import { PageLoading } from './components/ui/PageLoading.js'
import { ErrorNotice } from './components/ui/ErrorNotice.js'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'
import { Account, Company, PublicUser } from '../shared/types.js'

export interface WorkspaceProps {
  user: PublicUser
  onLogout: () => void
}

export interface ToastState {
  message: string
  error: boolean
}

function Workspace({ user, onLogout }: WorkspaceProps): React.JSX.Element {
  const [route, setRoute] = useState<string>('journal-report')
  const [toast, setToast] = useState<ToastState | null>(null)
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem('finova_dark') === '1')
  const [searchOpen, setSearchOpen] = useState<boolean>(false)
  const [showOnboard, setShowOnboard] = useState<boolean>(() => !localStorage.getItem('finova_onboarded'))

  const companyState = useLoad<{ company: Company }>(() => request('/company'), [])
  const accountsState = useLoad<{ accounts: Account[] }>(() => request('/accounts'), [])

  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('dark', dark)
    localStorage.setItem('finova_dark', dark ? '1' : '0')
  }, [dark])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
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
      pageContent = <JournalsView accounts={accounts} notify={notify} />
      break
    case 'journal-report':
      pageContent = <JournalReportView accounts={accounts} company={company} notify={notify} />
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
      pageContent = <JournalReportView accounts={accounts} company={company} notify={notify} />
  }

  return (
    <AppShell
      user={user}
      company={company}
      route={route}
      setRoute={setRoute}
      onLogout={onLogout}
      dark={dark}
      setDark={setDark}
      onSearch={() => setSearchOpen(true)}
    >
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

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        accounts={accounts}
        setRoute={setRoute}
      />

      {showOnboard && (
        <OnboardingWalkthrough
          done={() => {
            setShowOnboard(false)
            localStorage.setItem('finova_onboarded', '1')
          }}
        />
      )}
    </AppShell>
  )
}

export default function App(): React.JSX.Element {
  const [session, setSession] = useState<{ loading: boolean; user: PublicUser | null }>({
    loading: true,
    user: null
  })

  useEffect(() => {
    request<{ user: PublicUser }>('/auth/me')
      .then((d) => setSession({ loading: false, user: d.user }))
      .catch(() => setSession({ loading: false, user: null }))
  }, [])

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST' })
    } finally {
      setSession({ loading: false, user: null })
    }
  }

  if (session.loading) {
    return <PageLoading message="Menghubungkan ke sesi akuntansi…" />
  }

  return session.user ? (
    <Workspace user={session.user} onLogout={logout} />
  ) : (
    <LoginView onLogin={(u) => setSession({ loading: false, user: u })} />
  )
}
