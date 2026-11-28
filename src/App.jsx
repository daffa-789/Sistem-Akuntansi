import React, { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import { LoginView } from './components/LoginView.jsx'
import { PayrollCycleView } from './components/views/PayrollCycleView.jsx'
import { RevenueCycleView } from './components/views/RevenueCycleView.jsx'
import { ExpenditureCycleView } from './components/views/ExpenditureCycleView.jsx'
import { PageLoading } from './components/ui/PageLoading.jsx'
import { ErrorNotice } from './components/ui/ErrorNotice.jsx'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'

function Workspace({ user, onLogout }) {
  const [toast, setToast] = useState(null)
  const [page, setPage] = useState('payroll')
  // Tab aktif disimpan per modul: sidebar dan tab dalam halaman tetap sinkron.
  const [viewsByPage, setViewsByPage] = useState({
    payroll: 'summary',
    revenue: 'summary',
    expenditure: 'summary'
  })
  const companyState = useLoad(() => request('/company'), [])

  const notify = useCallback((message, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  const navigate = useCallback((nextPage, nextView) => {
    setPage(nextPage)
    if (nextView) {
      setViewsByPage((current) => ({ ...current, [nextPage]: nextView }))
    }
  }, [])

  const handleViewChange = useCallback(
    (nextView) => navigate(page, nextView),
    [navigate, page]
  )

  if (companyState.loading) {
    return <PageLoading message="Menyiapkan data akuntansi…" />
  }

  const activeView = viewsByPage[page] || 'summary'

  return (
    <AppShell
      user={user}
      onLogout={onLogout}
      page={page}
      view={activeView}
      onNavigate={navigate}
    >
      {companyState.error ? (
        <ErrorNotice error={companyState.error} />
      ) : page === 'revenue' ? (
        <RevenueCycleView notify={notify} user={user} view={activeView} onViewChange={handleViewChange} />
      ) : page === 'expenditure' ? (
        <ExpenditureCycleView notify={notify} user={user} view={activeView} onViewChange={handleViewChange} />
      ) : (
        <PayrollCycleView notify={notify} user={user} view={activeView} onViewChange={handleViewChange} />
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
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    request('/api/auth/me')
      .then((payload) => { if (alive) setUser(payload.user || null) })
      .catch(() => { if (alive) setUser(null) })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [])

  const logout = useCallback(async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' })
    } catch {
      /* sesi lokal tetap dibersihkan pada sisi klien */
    }
    setUser(null)
  }, [])

  if (checking) return <PageLoading message="Memeriksa sesi pengguna…" />
  if (!user) return <LoginView onLogin={setUser} />
  return <Workspace user={user} onLogout={logout} />
}
