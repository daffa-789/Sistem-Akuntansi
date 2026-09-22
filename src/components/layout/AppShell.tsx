import React, { ReactNode } from 'react'
import {
  BookOpen, FileBarChart, Landmark, LayoutDashboard,
  Moon, PenLine, ReceiptText, Search, Sun, LucideIcon
} from 'lucide-react'
import { Company } from '../../../shared/types.js'

export type NavRoute = 'dashboard' | 'journals' | 'ledger' | 'trial-balance' | 'accounts'

export const NAV_ITEMS: [NavRoute, string, LucideIcon][] = [
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['journals', 'Jurnal Umum', BookOpen],
  ['ledger', 'Buku Besar', ReceiptText],
  ['trial-balance', 'Neraca Saldo', FileBarChart],
  ['accounts', 'Bagan Akun (CoA)', Landmark]
]

export interface AppShellProps {
  company?: Company | null
  route: string
  setRoute: (route: string) => void
  dark: boolean
  setDark: (dark: boolean) => void
  onSearch: () => void
  children: ReactNode
}

export function AppShell({
  company,
  route,
  setRoute,
  dark,
  setDark,
  onSearch,
  children
}: AppShellProps): React.JSX.Element {
  const currentItem = NAV_ITEMS.find(([k]) => k === route) || NAV_ITEMS[0]

  const [signers, setSigners] = React.useState<{ maker: string; checker: string; approver: string }>(() => {
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

  function updateSigner(field: 'maker' | 'checker' | 'approver', value: string) {
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
        <div className="sidebar-bottom" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.15)', marginTop: 20, paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Pengesahan Dokumen
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
            <div>
              <label style={{ display: 'block', color: '#bbf7d0', fontSize: 10, fontWeight: 600, marginBottom: 2 }}>
                DIBUAT OLEH:
              </label>
              <input
                type="text"
                value={signers.maker}
                onChange={(e) => updateSigner('maker', e.target.value)}
                placeholder="Staf Keuangan"
                style={{
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#ffffff',
                  fontSize: 11
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#bbf7d0', fontSize: 10, fontWeight: 600, marginBottom: 2 }}>
                DIPERIKSA OLEH:
              </label>
              <input
                type="text"
                value={signers.checker}
                onChange={(e) => updateSigner('checker', e.target.value)}
                placeholder="Auditor / Penguji"
                style={{
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#ffffff',
                  fontSize: 11
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#bbf7d0', fontSize: 10, fontWeight: 600, marginBottom: 2 }}>
                DISETUJUI OLEH:
              </label>
              <input
                type="text"
                value={signers.approver}
                onChange={(e) => updateSigner('approver', e.target.value)}
                placeholder="Pimpinan / Direktur"
                style={{
                  width: '100%',
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  color: '#ffffff',
                  fontSize: 11
                }}
              />
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Sistem Akuntansi
            <strong>{currentItem[1]}</strong>
          </div>
          <div className="topbar-actions">
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
