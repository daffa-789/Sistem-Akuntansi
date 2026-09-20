import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { GL } from '../../utils/formatters.js'
import { Account } from '../../../shared/types.js'

export interface GlobalSearchModalProps {
  open: boolean
  onClose?: () => void
  accounts?: Account[]
  setRoute: (route: string) => void
}

export function GlobalSearchModal({ open, onClose, accounts = [], setRoute }: GlobalSearchModalProps): React.JSX.Element | null {
  const [q, setQ] = useState<string>('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setTimeout(() => ref.current?.focus(), 50)
    }
  }, [open])

  const results = useMemo(() => {
    if (q.trim().length < 2) return []
    const s = q.toLowerCase()
    return accounts
      .filter((a) => a.code.toLowerCase().includes(s) || a.name.toLowerCase().includes(s))
      .slice(0, 10)
      .map((a) => ({
        code: a.code,
        label: `${a.code} — ${a.name}`,
        group: GL[a.account_group] || a.account_group
      }))
  }, [q, accounts])

  if (!open) return null

  return (
    <div
      className="modal-backdrop search-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Pencarian Cepat Akun"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div className="search-modal">
        <div className="search-header">
          <Search size={18} aria-hidden="true" />
          <input
            ref={ref}
            className="search-input"
            placeholder="Cari akun... (ketik minimal 2 huruf, misal: Kas, Utang, Beban)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose?.()
            }}
            aria-label="Cari akun berdasarkan kode atau nama"
          />
        </div>
        <div className="search-results">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              className="search-item"
              onClick={() => {
                setRoute('accounts')
                onClose?.()
              }}
            >
              <span className="search-type">{r.group}</span>
              <span>{r.label}</span>
            </button>
          ))}
          {q.trim().length >= 2 && !results.length && (
            <div className="search-empty">Tidak ditemukan akun dengan kata kunci &quot;{q}&quot;</div>
          )}
          {q.trim().length < 2 && (
            <div className="search-empty">Ketik minimal 2 huruf untuk mulai mencari.</div>
          )}
        </div>
      </div>
    </div>
  )
}
