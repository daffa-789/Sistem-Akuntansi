export function FieldWarning({ message }) {
  if (!message) return null

  return (
    <div className="field-warning" role="alert">
      {message}
    </div>
  )
}
