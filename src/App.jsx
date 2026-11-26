import React, { useCallback, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import { PayrollCycleView } from './components/views/PayrollCycleView.jsx'
import { PageLoading } from './components/ui/PageLoading.jsx'
import { ErrorNotice } from './components/ui/ErrorNotice.jsx'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'

function Workspace() {
  const [toast, setToast] = useState(null)
  const companyState = useLoad(() => request('/company'), [])

  const notify = useCallback((message, isError = false) => {
    setToast({ message, error: isError })
    window.setTimeout(() => setToast(null), 4000)
  }, [])

  if (companyState.loading) {
    return <PageLoading message="Menyiapkan data penggajian…" />
  }

  return (
    <AppShell company={companyState.data?.company}>
      {companyState.error ? (
        <ErrorNotice error={companyState.error} />
      ) : (
        <PayrollCycleView notify={notify} />
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
