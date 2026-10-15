import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { GL } from '../../utils/formatters.js'
import { pushEscapeOwner } from './Modal.jsx'

const GROUP_ORDER = {
  DEBIT: ['ASSET', 'EXPENSE', 'LIABILITY', 'EQUITY', 'REVENUE'],
  KREDIT: ['REVENUE', 'LIABILITY', 'EQUITY', 'ASSET', 'EXPENSE'],
  NETRAL: ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
}

const GROUP_RANK = (order) =>
  order.reduce((acc, group, index) => ({ ...acc, [group]: index }), {})

function rankMatch(account, needle) {
  const code = account.code.toLowerCase()
  const name = account.name.toLowerCase()
  if (code.startsWith(needle)) return 0
  if (code.includes(needle)) return 1
  if (name.split(/[^a-z0-9]+/).some((word) => word.startsWith(needle))) return 2
  if (name.includes(needle)) return 3
  return -1
}

export function AccountPicker({
  accounts = [],
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
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [flipUp, setFlipUp] = useState(false)
  const rootRef = useRef(null)
  const localInputRef = useRef(null)
  const listRef = useRef(null)
  const listId = useId()
  const escapeId = useId()

  const attachRef = (node) => {
    localInputRef.current = node
    if (typeof inputRef === 'function') inputRef(node)
    else if (inputRef && typeof inputRef === 'object') inputRef.current = node
  }

  const selected = useMemo(() => accounts.find((a) => String(a.id) === String(value)), [accounts, value])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const groupRank = GROUP_RANK(GROUP_ORDER[side] || GROUP_ORDER.NETRAL)
    const scored = accounts
      .map((account) => ({ account, score: needle ? rankMatch(account, needle) : 0 }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => {
        if (needle && a.score !== b.score) return a.score - b.score
        const byGroup = (groupRank[a.account.account_group] ?? 99) - (groupRank[b.account.account_group] ?? 99)
        if (byGroup !== 0) return byGroup
        return a.account.code.localeCompare(b.account.code, 'id')
      })
    const list = []
    let lastGroup = null
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
    () => rows.reduce((acc, row, index) => (row.kind === 'account' ? [...acc, index] : acc), []),
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
    function handleOutside(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const item = listRef.current.children[active]
    item?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(accountId) {
    onChange(accountId)
    onPick?.()
    onSelected?.()
    setQuery('')
    setOpen(false)
  }

  function move(step) {
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
                {GL[row.group] || row.group}
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
