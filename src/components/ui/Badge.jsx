import React from 'react'

export function Badge({ status }) {
  const v = String(status || '').toUpperCase()
  const c =
    v === 'POSTED' || v === 'OPEN'
      ? 'green'
      : v === 'DRAFT'
      ? 'amber'
      : v === 'CLOSED' || v === 'REVERSED'
      ? 'slate'
      : 'red'

  const labelMap = {
    POSTED: 'Terposting',
    DRAFT: 'Draft',
    OPEN: 'Terbuka',
    CLOSED: 'Terkunci',
    REVERSED: 'Dibalik'
  }

  const text = labelMap[v] || status || ''

  return (
    <span className={`badge ${c}`} aria-label={`Status: ${text}`}>
      {text}
    </span>
  )
}
