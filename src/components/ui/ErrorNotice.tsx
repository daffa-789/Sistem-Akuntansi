import React from 'react'
import { AlertTriangle } from 'lucide-react'

export interface ErrorNoticeProps {
  error?: string | null
}

export function ErrorNotice({ error }: ErrorNoticeProps): React.JSX.Element | null {
  if (!error) return null

  return (
    <div className="error-box" role="alert" aria-live="assertive">
      <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} aria-hidden="true" />
      <span>{error}</span>
    </div>
  )
}
