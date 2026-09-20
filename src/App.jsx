import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import { OnboardingWalkthrough } from './components/layout/OnboardingWalkthrough.jsx'
import { LoginView } from './components/views/LoginView.jsx'
import { DashboardView } from './components/views/DashboardView.jsx'
import { JournalsView } from './components/views/JournalsView.jsx'
import { JournalReportView } from './components/views/JournalReportView.jsx'
import { LedgerView } from './components/views/LedgerView.jsx'
import { TrialBalanceView } from './components/views/TrialBalanceView.jsx'
import { AccountsView } from './components/views/AccountsView.jsx'
import { GlobalSearchModal } from './components/modals/GlobalSearchModal.jsx'
import { PageLoading } from './components/ui/PageLoading.jsx'
import { ErrorNotice } from './components/ui/ErrorNotice.jsx'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'

function Workspace({ user, onLogout }) {
  const [route, setRoute] = useState('journal-report')
  const [toast, setToast] = useState(null)
  const [dark, setDark] = useState(() => localStorage.getItem('finova_dark') === '1')
  const [searchOpen, setSearchOpen] = useState(false)
  const [showOnboard, setShowOnboard] = useState(() => !localStorage.getItem('finova_onboarded'))

  const companyState = useLoad(() => request('/company'), [])
  const accountsState = useLoad(() => request('/accounts'), [])

  const notify = useCallback((message, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('dark', dark)
    localStorage.setItem('finova_dark', dark ? '1' : '0')
  }, [dark])

  useEffect(() => {
    function handleKeyDown(e) {
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

  let pageContent = null
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

export default function App() {
  const [session, setSession] = useState({ loading: true, user: null })

  useEffect(() => {
    request('/auth/me')
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