import React, { useEffect, useState } from 'react'
import { formatNum, parseNum } from '../../utils/formatters.js'

export interface AmountInputProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  title?: string
  inputRef?: React.Ref<HTMLInputElement>
  onSideTransfer?: (side: 'DEBIT' | 'KREDIT') => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

const STEP = 1
const STEP_BIG = 1000
const STEP_HUGE = 100000

export function AmountInput({
  value,
  onChange,
  ariaLabel,
  id,
  disabled = false,
  invalid = false,
  placeholder = '0',
  title,
  inputRef,
  onSideTransfer,
  onKeyDown
}: AmountInputProps): React.JSX.Element {
  const [text, setText] = useState<string>(() => formatNum(value))
  const [focused, setFocused] = useState<boolean>(false)

  useEffect(() => {
    if (!focused) setText(formatNum(value))
  }, [value, focused])

  function commit(next: string): void {
    setText(next)
    // Teks lokal boleh mengandung pemisah; nilai yang dikirim ke parent selalu angka murni
    // supaya '1.500' tidak terbaca sebagai 1,5 saat dinominalkan.
    const parsed = parseNum(next)
    onChange(next.trim() === '' ? '' : String(parsed))
  }

  return (
    <input
      id={id}
      ref={inputRef}
      className="input amount-input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      title={title}
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        setFocused(true)
        e.currentTarget.select()
      }}
      onBlur={() => {
        setFocused(false)
        setText(formatNum(value))
      }}
      onChange={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const delta = (e.altKey ? STEP_HUGE : e.shiftKey ? STEP_BIG : STEP) * (e.key === 'ArrowUp' ? 1 : -1)
          const next = Math.max(0, parseNum(text) + delta)
          commit(String(next))
          return
        }
        if (onSideTransfer && (e.key === 'D' || e.key === 'K') && e.shiftKey) {
          e.preventDefault()
          onSideTransfer(e.key === 'D' ? 'DEBIT' : 'KREDIT')
          return
        }
        onKeyDown?.(e)
      }}
    />
  )
}
