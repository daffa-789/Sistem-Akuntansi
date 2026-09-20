import React, { ButtonHTMLAttributes } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | string
  small?: boolean
}

export function Button({
  children,
  variant = 'primary',
  small = false,
  type = 'button',
  disabled = false,
  className = '',
  ...props
}: ButtonProps): React.JSX.Element {
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
