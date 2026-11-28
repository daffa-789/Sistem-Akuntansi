import React, { useState } from 'react'
import { ChevronDown, LogOut, ShoppingBag, ShoppingCart, Users } from 'lucide-react'
import { PAYROLL_VIEWS } from '../views/PayrollCycleView.jsx'
import { REVENUE_VIEWS } from '../views/RevenueCycleView.jsx'
import { EXPENDITURE_VIEWS } from '../views/ExpenditureCycleView.jsx'

// Modul: tombol induk sidebar yang bisa dibuka (dropdown) menampilkan
// bagian-bagian siklusnya langsung dari BAB V.pptx.
const MODULES = {
  payroll: { title: 'Penggajian / SDM', icon: Users, views: PAYROLL_VIEWS },
  revenue: { title: 'Siklus Pendapatan', icon: ShoppingBag, views: REVENUE_VIEWS },
  expenditure: { title: 'Siklus Pengeluaran', icon: ShoppingCart, views: EXPENDITURE_VIEWS }
}

const NAV_MODULES = ['payroll', 'revenue', 'expenditure']

const PAGE_TITLES = {
  payroll: 'Penggajian / SDM',
  revenue: 'Siklus Pendapatan',
  expenditure: 'Siklus Pengeluaran'
}

export function AppShell({
  user,
  onLogout,
  page = 'payroll',
  view = 'summary',
  onNavigate = () => {},
  children
}) {
  const [expanded, setExpanded] = useState({ payroll: true })

  function toggleModule(moduleKey) {
    if (page !== moduleKey) {
      onNavigate(moduleKey, 'summary')
      setExpanded((current) => ({ ...current, [moduleKey]: true }))
      return
    }
    setExpanded((current) => ({ ...current, [moduleKey]: !current[moduleKey] }))
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menu Aplikasi">
        <div className="brand">
          <span className="brand-copy"><strong>Finova</strong></span>
        </div>
        <div className="sidebar-nav">
          {NAV_MODULES.map((moduleKey) => {
            const module = MODULES[moduleKey]
            const Icon = module.icon
            const isOpen = Boolean(expanded[moduleKey])
            return (
              <div className="nav-list" key={moduleKey}>
                <button
                  type="button"
                  className={`nav-item nav-module ${page === moduleKey ? 'active' : ''}`}
                  aria-current={page === moduleKey ? 'page' : undefined}
                  aria-expanded={isOpen}
                  onClick={() => toggleModule(moduleKey)}
                >
                  <Icon aria-hidden="true" />
                  <span>{module.title}</span>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={`nav-chevron ${isOpen ? 'is-open' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="nav-sub" role="list">
                    {module.views.map(([viewKey, label, ViewIcon]) => (
                      <button
                        type="button"
                        role="listitem"
                        key={viewKey}
                        className={`nav-sub-item ${page === moduleKey && view === viewKey ? 'active' : ''}`}
                        onClick={() => onNavigate(moduleKey, viewKey)}
                      >
                        {ViewIcon && <ViewIcon size={13} aria-hidden="true" />}
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {user && <div className="user-panel">
          <span className="user-panel-name">{user.name}</span>
          <span className="user-panel-role">{user.role}</span>
          <button type="button" className="user-logout" onClick={onLogout} title="Keluar">
            <LogOut size={14} aria-hidden="true" /> Keluar
          </button>
        </div>}
      </aside>

      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  )
}
