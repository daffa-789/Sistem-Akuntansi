import React from 'react'
import { money } from '../../utils/formatters.js'

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

export function CycleMetric({ label, value, note, Icon, tone = '', format = 'currency' }) {
  return (
    <article className={'cycle-metric ' + tone}>
      <div className="cycle-metric-top"><span>{label}</span>{Icon && <span className="cycle-metric-icon"><Icon size={17} aria-hidden="true" /></span>}</div>
      <strong>{typeof value === 'number' ? (format === 'number' ? new Intl.NumberFormat('id-ID').format(value) : money(value)) : value}</strong>
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

export function CycleEmpty({ children = 'Belum ada transaksi.' }) {
  return <div className="cycle-empty">{children}</div>
}

export function todayISO() {
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
}
