import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Account, AccountGroup } from '../../../shared/types.js'
import { GL } from '../../utils/formatters.js'
import { pushEscapeOwner } from './Modal.js'

export interface AccountPickerProps {
  accounts: Account[]
  value: string
  onChange: (accountId: string) => void
  ariaLabel: string
  id?: string
  placeholder?: string
  side?: 'DEBIT' | 'KREDIT' | 'NETRAL'
  invalid?: boolean
  disabled?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  onPick?: () => void
  onSelected?: () => void
  onEnter?: (up: boolean) => void
}

const GROUP_ORDER: Record<NonNullable<AccountPickerProps['side']>, AccountGroup[]> = {
  DEBIT: ['ASSET', 'EXPENSE', 'LIABILITY', 'EQUITY', 'REVENUE'],
  KREDIT: ['REVENUE', 'LIABILITY', 'EQUITY', 'ASSET', 'EXPENSE'],
  NETRAL: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
}

const GROUP_RANK = (order: AccountGroup[]): Record<string, number> =>
  order.reduce<Record<string, number>>((acc, group, index) => ({ ...acc, [group]: index }), {})

interface PickerRow {
  kind: 'account' | 'group'
  account?: Account
  group?: AccountGroup
}

// Awalan kode adalah ketikan tercepat akuntan (1100 = Kas), jadi ia mengalahkan pencocokan nama.
function rankMatch(account: Account, needle: string): number {
  const code = account.code.toLowerCase()
  const name = account.name.toLowerCase()
  if (code.startsWith(needle)) return 0
  if (code.includes(needle)) return 1
  if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))) return 2
  if (name.includes(needle)) return 3
  return -1
}

export function AccountPicker({
  accounts,
  value,
  onChange,
  ariaLabel,
  id,
  placeholder = 'Ketik kode atau nama akun…',
  side = 'NETRAL',
  invalid = false,
  disabled = false,
  inputRef,
  onPick,
  onSelected,
  onEnter
}: AccountPickerProps): React.JSX.Element {
  const [query, setQuery] = useState<string>('')
  const [open, setOpen] = useState<boolean>(false)
  const [active, setActive] = useState<number>(0)
  const [flipUp, setFlipUp] = useState<boolean>(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const localInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const escapeId = useId()

  const attachRef = (node: HTMLInputElement | null): void => {
    localInputRef.current = node
    if (typeof inputRef === 'function') inputRef(node)
    else if (inputRef && typeof inputRef === 'object') (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node
  }

  const selected = useMemo(() => accounts.find((a) => String(a.id) === String(value)), [accounts, value])

  const rows = useMemo<PickerRow[]>(() => {
    const needle = query.trim().toLowerCase()
    const groupRank = GROUP_RANK(GROUP_ORDER[side])
    const scored = accounts
      .map((account) => ({ account, score: needle ? rankMatch(account, needle) : 0 }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => {
        if (needle && a.score !== b.score) return a.score - b.score
        const byGroup = groupRank[a.account.account_group] - groupRank[b.account.account_group]
        if (byGroup !== 0) return byGroup
        return a.account.code.localeCompare(b.account.code, 'id')
      })
    const list: PickerRow[] = []
    let lastGroup: AccountGroup | null = null
    for (const { account } of scored) {
      if (account.account_group !== lastGroup) {
        list.push({ kind: 'group', group: account.account_group })
        lastGroup = account.account_group
      }
      list.push({ kind: 'account', account })
    }
    return list
  }, [accounts, query, side])

  const selectableIndexes = useMemo(
    () => rows.reduce<number[]>((acc, row, index) => (row.kind === 'account' ? [...acc, index] : acc), []),
    [rows]
  )

  useEffect(() => {
    if (!open) return
    setFlipUp(Boolean(localInputRef.current && window.innerHeight - localInputRef.current.getBoundingClientRect().bottom < 260))
  }, [open])

  useEffect(() => {
    if (open) setActive(selectableIndexes[0] ?? -1)
  }, [open, query, selectableIndexes])

  useEffect(() => {
    if (!open) return
    return pushEscapeOwner(escapeId)
  }, [open, escapeId])

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const item = listRef.current.children[active] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(accountId: string): void {
    onChange(accountId)
    onPick?.()
    onSelected?.()
    setQuery('')
    setOpen(false)
  }

  function move(step: number): void {
    if (!selectableIndexes.length) return
    const position = selectableIndexes.indexOf(active)
    const next = position < 0 ? 0 : (position + step + selectableIndexes.length) % selectableIndexes.length
    setActive(selectableIndexes[next])
  }

  return (
    <div className="combo-wrap" ref={rootRef}>
      <input
        id={id}
        ref={attachRef}
        className="input combo-input"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        value={open ? query : selected ? `${selected.code} — ${selected.name}` : query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          onPick?.()
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) setOpen(true)
            else move(1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setOpen(true)
            else move(-1)
          } else if (e.key === 'Home' && open) {
            e.preventDefault()
            setActive(selectableIndexes[0] ?? -1)
          } else if (e.key === 'End' && open) {
            e.preventDefault()
            setActive(selectableIndexes[selectableIndexes.length - 1] ?? -1)
          } else if (e.key === 'Enter') {
            // Hanya memilih ketika ada ketikan: popup yang baru terbuka karena pindah fokus
            // tidak boleh memilih akun secara acak saat operator menekan Enter.
            const picking = open && query.trim().length > 0
            if (picking) {
              e.preventDefault()
              e.stopPropagation()
              const row = rows[active]
              if (row?.account) pick(String(row.account.id))
            } else if (open) {
              e.preventDefault()
              setOpen(false)
              onEnter?.(e.shiftKey)
            } else if (onEnter) {
              e.preventDefault()
              onEnter(e.shiftKey)
            }
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          } else if (e.key === 'Tab') {
            setOpen(false)
          } else if (e.key === 'Backspace' && !query && value) {
            onChange('')
            onPick?.()
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={`Daftar akun untuk ${ariaLabel}`}
          className={`combo-list ${flipUp ? 'combo-up' : ''}`}
        >
          {rows.map((row, index) =>
            row.kind === 'group' ? (
              <li key={`g-${row.group}`} className="combo-group" role="presentation">
                {GL[row.group as AccountGroup] || row.group}
              </li>
            ) : (
              <li
                key={row.account?.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`combo-option ${index === active ? 'active' : ''} ${String(row.account?.id) === String(value) ? 'chosen' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (row.account) pick(String(row.account.id))
                }}
              >
                <span className="combo-code">{row.account?.code}</span>
                <span className="combo-name">{row.account?.name}</span>
                <span className="combo-side">{row.account?.normal_balance === 'DEBIT' ? 'D' : 'K'}</span>
              </li>
            )
          )}
          {!rows.length && <li className="combo-empty" role="presentation">Tidak ada akun yang cocok dengan &quot;{query}&quot;.</li>}
        </ul>
      )}
    </div>
  )
}
