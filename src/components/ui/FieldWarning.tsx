import React from 'react'

export interface FieldWarningProps {
  message?: string | null
}

export function FieldWarning({ message }: FieldWarningProps): React.JSX.Element | null {
  if (!message) return null

  return (
    <div className="field-warning" role="alert">
      {message}
    </div>
  )
}
