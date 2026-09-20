export function PageLoading({ message = 'Memuat data…' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <div>
        <div className="spinner" aria-hidden="true" />
        <div>{message}</div>
      </div>
    </div>
  )
}
