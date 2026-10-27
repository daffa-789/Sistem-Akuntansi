import React, { useState } from 'react'
import {
  BookOpenCheck, CircleDollarSign, FileBarChart, PackageCheck,
  ShoppingCart, Users
} from 'lucide-react'

export const NAV_ITEMS = [
  ['revenue', 'Pendapatan', CircleDollarSign],
  ['expenditure', 'Pengeluaran', ShoppingCart],
  ['production', 'Produksi', PackageCheck],
  ['payroll', 'Penggajian / SDM', Users],
  ['reporting', 'Buku Besar & Pelaporan', BookOpenCheck]
]

export function AppShell({
  company,
  route,
  setRoute,
  children
}) {
  const currentItem = NAV_ITEMS.find(([k]) => k === route) || NAV_ITEMS[0]

  const [signers, setSigners] = useState(() => {
    try {
      const raw = localStorage.getItem('finova_signers')
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      maker: 'Staf Keuangan',
      checker: 'Auditor / Penguji',
      approver: 'Pimpinan / Direktur'
    }
  })

  function updateSigner(field, value) {
    setSigners((prev) => {
      const next = { ...prev, [field]: value }
      localStorage.setItem('finova_signers', JSON.stringify(next))
      return next
    })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menu Aplikasi">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src="/favicon.png" alt="" />
          </span>
          <span className="brand-copy"><strong>Finova</strong><small>Sistem akuntansi</small></span>
        </div>
        <div className="company-label">{company?.name || 'PT Finova Akuntansi Indonesia'}</div>
        <div className="nav-section-label">SIKLUS UTAMA SIA</div>
        <nav className="nav-list" aria-label="Navigasi Utama">
          {NAV_ITEMS.map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              className={`nav-item ${route === k ? 'active' : ''}`}
              onClick={() => setRoute(k)}
              aria-current={route === k ? 'page' : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <details className="sidebar-bottom sidebar-signers">
          <summary>Penandatangan laporan</summary>
          <div className="sidebar-signers-fields">
            <div>
              <label>Dibuat oleh</label>
              <input
                type="text"
                value={signers.maker}
                onChange={(e) => updateSigner('maker', e.target.value)}
                placeholder="Staf Keuangan"
              />
            </div>

            <div>
              <label>Diperiksa oleh</label>
              <input
                type="text"
                value={signers.checker}
                onChange={(e) => updateSigner('checker', e.target.value)}
                placeholder="Auditor / Penguji"
              />
            </div>

            <div>
              <label>Disetujui oleh</label>
              <input
                type="text"
                value={signers.approver}
                onChange={(e) => updateSigner('approver', e.target.value)}
                placeholder="Pimpinan / Direktur"
              />
            </div>
          </div>
        </details>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Sistem Akuntansi
            <strong>{currentItem[1]}</strong>
          </div>
        </header>

        <div className="content">{children}</div>

        <nav className="mobile-nav" aria-label="Navigasi Seluler">
          {NAV_ITEMS.map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              className={`nav-item ${route === k ? 'active' : ''}`}
              title={label}
              aria-label={label}
              aria-current={route === k ? 'page' : undefined}
              onClick={() => setRoute(k)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </main>
    </div>
  )
}
