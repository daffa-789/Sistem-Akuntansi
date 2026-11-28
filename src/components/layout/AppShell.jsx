import React from 'react'
import { LogOut, ShoppingBag, ShoppingCart, Users } from 'lucide-react'

// Halaman aplikasi: modul SDM (penggajian) dan dua siklus utama SIA
// sesuai BAB V.pptx bagian B (pendapatan) dan C (pengeluaran).
const NAV_SECTIONS = [
  {
    label: 'MODUL SDM',
    items: [['payroll', 'Penggajian / SDM', Users]]
  },
  {
    label: 'MODUL SIA',
    items: [
      ['revenue', 'Siklus Pendapatan', ShoppingBag],
      ['expenditure', 'Siklus Pengeluaran', ShoppingCart]
    ]
  }
]

const PAGE_TITLES = {
  payroll: 'Penggajian / SDM',
  revenue: 'Siklus Pendapatan',
  expenditure: 'Siklus Pengeluaran'
}

export function AppShell({ company, user, onLogout, page = 'payroll', onPageChange = () => {}, children }) {
  const activeTitle = PAGE_TITLES[page] || 'Penggajian / SDM'
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menu Aplikasi">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src="/favicon.png" alt="" />
          </span>
          <span className="brand-copy"><strong>Finova</strong><small>Sistem akuntansi</small></span>
        </div>
        <div className="company-label">{company?.name || 'Perusahaan'}</div>
        {NAV_SECTIONS.map((section) => (
          <React.Fragment key={section.label}>
            <div className="nav-section-label">{section.label}</div>
            <div className="nav-list">
              {section.items.map(([key, label, Icon]) => (
                <button
                  type="button"
                  key={key}
                  className={`nav-item ${page === key ? 'active' : ''}`}
                  aria-current={page === key ? 'page' : undefined}
                  onClick={() => onPageChange(key)}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </React.Fragment>
        ))}
        {user && <div className="user-panel">
          <span className="user-panel-name">{user.name}</span>
          <span className="user-panel-role">{user.role}</span>
          <button type="button" className="user-logout" onClick={onLogout} title="Keluar">
            <LogOut size={14} aria-hidden="true" /> Keluar
          </button>
        </div>}
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Sistem Akuntansi
            <strong>{activeTitle}</strong>
          </div>
        </header>

        <div className="content">{children}</div>
      </main>
    </div>
  )
}
