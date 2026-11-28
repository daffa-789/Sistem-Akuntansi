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
  const companyState = useLoad(() => request('/company'), [])

  const notify = useCallback((message, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  if (companyState.loading) {
    return <PageLoading message="Menyiapkan data akuntansi…" />
  }

  return (
    <AppShell
      company={companyState.data?.company}
      user={user}
      onLogout={onLogout}
      page={page}
      onPageChange={setPage}
    >
      {companyState.error ? (
        <ErrorNotice error={companyState.error} />
      ) : page === 'revenue' ? (
        <RevenueCycleView notify={notify} user={user} />
      ) : page === 'expenditure' ? (
        <ExpenditureCycleView notify={notify} user={user} />
      ) : (
        <PayrollCycleView notify={notify} user={user} />
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
