export function Badge({ status }) {
  const v = String(status || '').toUpperCase()
  const c =
    v === 'POSTED' || v === 'OPEN' || v === 'ADMIN'
      ? 'green'
      : v === 'DRAFT'
      ? 'amber'
      : v === 'CLOSED' || v === 'VOID'
      ? 'slate'
      : 'red'

  const labelMap = {
    POSTED: 'Terposting',
    DRAFT: 'Draft',
    OPEN: 'Terbuka',
    CLOSED: 'Terkunci',
    ADMIN: 'Admin',
    STAFF: 'Staf'
  }

  const text = labelMap[v] || status

  return (
    <span className={`badge ${c}`} aria-label={`Status: ${text}`}>
      {text}
    </span>
  )
}
