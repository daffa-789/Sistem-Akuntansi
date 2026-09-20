export function Button({
  children,
  variant = 'primary',
  small = false,
  type = 'button',
  disabled = false,
  className = '',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`button ${variant} ${small ? 'small' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}
