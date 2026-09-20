import React from 'react'

export interface PageLoadingProps {
  message?: string
}

export function PageLoading({ message = 'Memuat data…' }: PageLoadingProps): React.JSX.Element {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div>
        <div className="spinner" aria-hidden="true" />
        <div>{message}</div>
      </div>
    </div>
  )
}
