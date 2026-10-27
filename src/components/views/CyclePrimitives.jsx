import React from 'react'
import { CheckCircle2, Clock3, FileText } from 'lucide-react'
import { money } from '../../../src/utils/formatters.js'

const dateLabel = (value) => {
  if (!value) return '—'
  const date = new Date(value + 'T12:00:00')
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function CycleIntro({ number, title, description, actions, companyName = 'PT Arunika Persenjataan (Fiktif)' }) {
  return (
    <header className="cycle-intro">
      <div className="cycle-intro-copy">
        <div className="cycle-kicker"><span>SIKLUS {number}</span><i />{companyName}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-copy">{description}</p>
      </div>
      {actions && <div className="cycle-actions">{actions}</div>}
    </header>
  )
}

export function CycleTabs({ value, items, onChange, label = 'Bagian siklus' }) {
  return (
    <nav className="cycle-tabs" role="tablist" aria-label={label}>
      {items.map(([key, title, Icon]) => (
        <button
          type="button"
          role="tab"
          aria-selected={value === key}
          className={value === key ? 'is-active' : ''}
          key={key}
          onClick={() => onChange(key)}
        >
          {Icon && <Icon size={15} aria-hidden="true" />}
          <span>{title}</span>
        </button>
      ))}
    </nav>
  )
}

export function CycleMetric({ label, value, note, Icon, tone = '' }) {
  return (
    <article className={'cycle-metric ' + tone}>
      <div className="cycle-metric-top"><span>{label}</span>{Icon && <span className="cycle-metric-icon"><Icon size={17} aria-hidden="true" /></span>}</div>
      <strong>{typeof value === 'number' ? money(value) : value}</strong>
      <small>{note}</small>
    </article>
  )
}

export function CycleStatus({ status, label }) {
  const labels = {
    paid: 'Lunas',
    partial: 'Sebagian',
    open: 'Belum dibayar',
    overdue: 'Terlambat',
    hold: 'Menunggu proses',
    planned: 'Direncanakan',
    progress: 'Dalam proses',
    complete: 'Selesai'
  }
  return <span className={'cycle-status cycle-status-' + status}>{label || labels[status] || status}</span>
}

export function CycleJournal({ entries, explanation = 'Pratinjau ini tidak diposting ke jurnal resmi atau buku besar.' }) {
  const total = (entries || []).reduce((sum, row) => sum + Number(row.amount || 0), 0)
  return (
    <section className="panel cycle-card cycle-journal">
      <div className="cycle-card-heading">
        <div><h2>Jurnal simulasi</h2><p>Contoh alur debit dan kredit dari data latihan.</p></div>
        <span className="cycle-simulation-tag">BELUM DIPOSTING</span>
      </div>
      <div className="cycle-journal-note"><FileText size={16} aria-hidden="true" /><span>{explanation}</span><span className="cycle-balanced"><CheckCircle2 size={14} aria-hidden="true" /> Seimbang</span></div>
      <div className="cycle-journal-list">
        {(entries || []).map((row, index) => (
          <article className="cycle-journal-entry" key={row.ref + '-' + index}>
            <div className="cycle-journal-head">
              <div><strong>{row.description}</strong><small>{row.ref} <i>·</i> {dateLabel(row.date)}</small></div>
              <b>{money(row.amount)}</b>
            </div>
            <div className="cycle-journal-lines">
              <div><span><em>Debit</em>{row.debitAccount}</span><strong>{money(row.amount)}</strong></div>
              <div><span><em>Kredit</em>{row.creditAccount}</span><strong>{money(row.amount)}</strong></div>
            </div>
          </article>
        ))}
        {!entries?.length && <div className="cycle-empty">Jurnal simulasi muncul setelah ada transaksi.</div>}
      </div>
      <div className="cycle-journal-total"><span>Total debit <b>{money(total)}</b></span><span>Total kredit <b>{money(total)}</b></span></div>
    </section>
  )
}

export function CycleEmpty({ children = 'Belum ada transaksi.' }) {
  return <div className="cycle-empty">{children}</div>
}

export function todayISO() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
}

export function localMoney(value) {
  return money(Number(value || 0))
}

export function DueSoonIcon() {
  return <Clock3 size={15} aria-hidden="true" />
}
