import React, { useCallback, useState } from 'react'
import { AppShell } from './components/layout/AppShell.jsx'
import { RevenueCycleView } from './components/views/RevenueCycleView.jsx'
import { ExpenditureCycleView } from './components/views/ExpenditureCycleView.jsx'
import { ProductionCycleView } from './components/views/ProductionCycleView.jsx'
import { PayrollCycleView } from './components/views/PayrollCycleView.jsx'
import { ReportingCycleView } from './components/views/ReportingCycleView.jsx'
import { MusicPlayer } from './components/widgets/MusicPlayer.jsx'
import { PageLoading } from './components/ui/PageLoading.jsx'
import { ErrorNotice } from './components/ui/ErrorNotice.jsx'
import { useLoad } from './hooks/useLoad.js'
import { request } from './api.js'

function Workspace() {
  const [route, setRoute] = useState('revenue')
  const [toast, setToast] = useState(null)

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
    case 'revenue':
      pageContent = <RevenueCycleView notify={notify} />
      break
    case 'expenditure':
      pageContent = <ExpenditureCycleView notify={notify} />
      break
    case 'production':
      pageContent = <ProductionCycleView notify={notify} />
      break
    case 'payroll':
      pageContent = <PayrollCycleView notify={notify} />
      break
    case 'reporting':
      pageContent = <ReportingCycleView accounts={accounts} company={company} notify={notify} />
      break
    default:
      pageContent = <RevenueCycleView notify={notify} />
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
