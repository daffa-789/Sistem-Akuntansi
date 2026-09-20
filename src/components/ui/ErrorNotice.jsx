import { AlertTriangle } from 'lucide-react'

export function ErrorNotice({ error }) {
  if (!error) return null

  return (
    <div className="error-box" role="alert" aria-live="assertive">
      <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} aria-hidden="true" />
      <span>{error}</span>
    </div>
  )
}
