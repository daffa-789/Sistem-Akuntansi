import React from 'react'
import { Users } from 'lucide-react'

export function AppShell({ company, children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menu Aplikasi">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src="/favicon.png" alt="" />
          </span>
          <span className="brand-copy"><strong>Finova</strong><small>Sistem penggajian</small></span>
        </div>
        <div className="company-label">{company?.name || 'Perusahaan'}</div>
        <div className="nav-section-label">MODUL SDM</div>
        <div className="nav-list">
          <div className="nav-item active" aria-current="page">
            <Users aria-hidden="true" />
            <span>Penggajian / SDM</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Sistem Penggajian
            <strong>Penggajian / SDM</strong>
          </div>
        </header>

        <div className="content">{children}</div>
      </main>
    </div>
  )
}
