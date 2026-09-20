import React, { ReactNode } from 'react'
import {
  BookOpen, FileBarChart, Landmark, LayoutDashboard, LogOut,
  Moon, PenLine, ReceiptText, Search, Sun, LucideIcon
} from 'lucide-react'
import { Company, PublicUser } from '../../../shared/types.js'

export type NavRoute = 'dashboard' | 'journals' | 'journal-report' | 'ledger' | 'trial-balance' | 'accounts'

export const NAV_ITEMS: [NavRoute, string, LucideIcon][] = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['journals', 'Catat Jurnal', PenLine],
  ['journal-report', 'Laporan Jurnal', ReceiptText],
  ['ledger', 'Buku Besar', BookOpen],
  ['trial-balance', 'Neraca Saldo', FileBarChart],
  ['accounts', 'Bagan Akun (CoA)', Landmark]
]

export interface AppShellProps {
  user: PublicUser
  company?: Company | null
  route: string
  setRoute: (route: string) => void
  onLogout: () => void
  dark: boolean
  setDark: (dark: boolean) => void
  onSearch: () => void
  children: ReactNode
}

export function AppShell({
  user,
  company,
  route,
  setRoute,
  onLogout,
  dark,
  setDark,
  onSearch,
  children
}: AppShellProps): React.JSX.Element {
  const currentItem = NAV_ITEMS.find(([k]) => k === route) || NAV_ITEMS[0]

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Menu Aplikasi">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Landmark />
          </span>
          Finova
        </div>
        <div className="company-label">{company?.name || 'PT Finova Akuntansi Indonesia'}</div>
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
        <div className="sidebar-bottom">
          Sistem Akuntansi Terpadu.
          <br />
          Pencatatan standar, audit jejak lengkap, &amp; bebas database eksternal.
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Sistem Akuntansi
            <strong>{currentItem[1]}</strong>
          </div>
          <div className="profile-chip">
            <button
              type="button"
              className="icon-button"
              title="Cari Akun (Ctrl+K)"
              aria-label="Cari Akun (Pintasan Ctrl+K)"
              onClick={onSearch}
            >
              <Search size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              title={dark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
              aria-label={dark ? 'Mode terang' : 'Mode gelap'}
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <div className="avatar" aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="profile-name">{user.name}</div>
              <div className="profile-role">
                {user.role === 'ADMIN' ? 'Administrator' : 'Staf Keuangan'}
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              title="Keluar dari sesi"
              aria-label="Keluar dari sesi"
              onClick={onLogout}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
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
