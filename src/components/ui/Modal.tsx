import React, { ReactNode, useCallback, useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

export interface ModalProps {
  title: ReactNode
  children: ReactNode
  onClose?: () => void
  footer?: ReactNode
  maxWidth?: string
  dirty?: boolean
  closeMessage?: string
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([type=hidden]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])'

// Modal bertingkat (form jurnal yang membuka Riwayat Audit di atasnya) tidak boleh sama-sama
// merespons satu tombol Esc, jika tidak mengetik panjang akan hilang saat menutup riwayat.
const openStack: string[] = []

// Komponen di dalam modal (mis. popup pencarian akun) mengambil alih Esc selama terbuka,
// supaya satu tekanan Esc menutup popup lebih dulu, bukan seluruh form.
export function pushEscapeOwner(id: string): () => void {
  openStack.push(id)
  return (): void => {
    const index = openStack.indexOf(id)
    if (index >= 0) openStack.splice(index, 1)
  }
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  maxWidth = '880px',
  dirty = false,
  closeMessage = 'Buang perubahan yang belum disimpan?'
}: ModalProps): React.JSX.Element {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  const attemptClose = useCallback((): void => {
    if (dirty && !window.confirm(closeMessage)) return
    onClose?.()
  }, [dirty, closeMessage, onClose])

  useEffect(() => {
    const id = titleId
    openStack.push(id)
    const previouslyFocused = document.activeElement as HTMLElement | null

    const visibleFocusables = (): HTMLElement[] =>
      dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
        : []

    const focusables = visibleFocusables()
    ;(focusables.find((el) => el.hasAttribute('data-autofocus')) || focusables[0] || dialogRef.current)?.focus()

    function handleKeyDown(e: KeyboardEvent) {
      if (openStack[openStack.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        attemptClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = visibleFocusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      const index = openStack.indexOf(id)
      if (index >= 0) openStack.splice(index, 1)
      previouslyFocused?.focus?.()
    }
  }, [titleId, attemptClose])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) attemptClose()
      }}
    >
      <div
        className="modal"
        style={{ maxWidth }}
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={attemptClose}
            aria-label="Tutup jendela"
            title="Tutup (Esc)"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
