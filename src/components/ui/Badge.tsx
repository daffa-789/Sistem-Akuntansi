import React from 'react'

export interface BadgeProps {
  status?: string | null
}

export function Badge({ status }: BadgeProps): React.JSX.Element {
  const v = String(status || '').toUpperCase()
  const c =
    v === 'POSTED' || v === 'OPEN'
      ? 'green'
      : v === 'DRAFT'
      ? 'amber'
      : v === 'CLOSED' || v === 'REVERSED'
      ? 'slate'
      : 'red'

  const labelMap: Record<string, string> = {
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
