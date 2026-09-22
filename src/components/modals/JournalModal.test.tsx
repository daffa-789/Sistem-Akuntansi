// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react'
import { JournalModal } from './JournalModal.js'
import { Account } from '../../../shared/types.js'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
// jsdom tidak mengimplementasi scrollIntoView; komponen memanggilnya saat menyorot opsi.
Element.prototype.scrollIntoView = function (): void {}

const accounts: Account[] = [
  { id: 1, company_id: 1, code: '1100', name: 'Kas', account_group: 'ASSET', normal_balance: 'DEBIT', is_cash_account: 1, is_active: 1 },
  { id: 2, company_id: 1, code: '4100', name: 'Pendapatan Jasa', account_group: 'REVENUE', normal_balance: 'CREDIT', is_cash_account: 0, is_active: 1 },
  { id: 3, company_id: 1, code: '5200', name: 'Beban Gaji & Upah', account_group: 'EXPENSE', normal_balance: 'DEBIT', is_cash_account: 0, is_active: 1 },
  { id: 4, company_id: 1, code: '2100', name: 'Utang Usaha', account_group: 'LIABILITY', normal_balance: 'CREDIT', is_cash_account: 0, is_active: 1 }
]

let container: HTMLDivElement
let root: Root
let onClose: () => void
let notify: (msg: string, isError?: boolean) => void
let fetchMock: ReturnType<typeof vi.fn>

function type(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}

function press(target: Element | Window, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

function openModal(): void {
  act(() => {
    root.render(
      React.createElement(JournalModal, {
        accounts,
        entry: null,
        onClose,
        notify,
        onSaved: () => {}
      })
    )
  })
}

function switchButton(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent!.includes(label))
  if (!button) throw new Error(`Tombol "${label}" tidak ditemukan`)
  return button as HTMLButtonElement
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  onClose = vi.fn()
  notify = vi.fn()
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ voucherNo: 'JRN-202609-001' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  openModal()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const accountInputs = (): HTMLInputElement[] =>
  Array.from(container.querySelectorAll('input[aria-label^="Pilih akun"]')) as HTMLInputElement[]

describe('modal input jurnal dengan keyboard', () => {
  it('Enter memilih akun yang disorot tanpa mengirim ke server', async () => {
    const debit = document.getElementById('quick-debit-account') as HTMLInputElement
    await act(async () => {
      type(debit, '11')
    })
    expect(container.querySelectorAll('.combo-option').length).toBeGreaterThan(0)

    await act(async () => {
      press(debit, 'Enter')
    })

    expect(debit.value).toContain('1100')
    expect(debit.closest('.combo-wrap')!.querySelector('.combo-list')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/journals', expect.anything())
  })

  it('Enter pada baris grid menambah baris baru saat baris terakhir ditinggalkan', async () => {
    await act(async () => {
      switchButton('Ganti ke Mode Multi-Baris').click()
    })
    expect(accountInputs()).toHaveLength(2)

    const lastAccount = accountInputs()[1]
    await act(async () => {
      press(lastAccount, 'Enter')
    })
    expect(accountInputs()).toHaveLength(3)

    const newLast = accountInputs()[2]
    await act(async () => {
      press(newLast, 'Enter')
    })
    expect(accountInputs()).toHaveLength(4)
  })

  it('Shift+Enter menaikkan fokus satu baris tanpa menambah baris', async () => {
    await act(async () => {
      switchButton('Ganti ke Mode Multi-Baris').click()
    })
    await act(async () => {
      press(accountInputs()[1], 'Enter')
    })
    const count = accountInputs().length
    await act(async () => {
      press(accountInputs()[count - 1], 'Enter', { shiftKey: true })
    })
    expect(accountInputs()).toHaveLength(count)
  })

  it('Mode Cepat menolak jurnal majemuk sehingga baris yang diketik tidak hilang', async () => {
    await act(async () => {
      switchButton('Ganti ke Mode Multi-Baris').click()
    })
    await act(async () => {
      switchButton('+1 Baris').click()
      switchButton('+1 Baris').click()
    })

    for (const code of ['1100', '4100', '5200']) {
      const input = accountInputs().find((i) => !i.value) as HTMLInputElement
      await act(async () => {
        type(input, code)
      })
      const option = input.closest('.combo-wrap')!.querySelector('.combo-option') as HTMLElement
      await act(async () => {
        option.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      })
    }

    expect(accountInputs().map((i) => i.value).filter(Boolean)).toHaveLength(3)

    // Lebih dari dua baris tidak muat di Mode Cepat, jadi tombolnya dikunci —
    // bukan diperbolehkan lalu menimpa baris yang sudah diketik.
    const toQuick = switchButton('Ganti ke Mode Cepat')
    expect(toQuick.disabled).toBe(true)
    await act(async () => {
      toQuick.click()
    })

    expect(accountInputs().map((i) => i.value).filter(Boolean)).toHaveLength(3)
  })

  it('Esc meminta konfirmasi ketika ada ketikan yang belum disimpan', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const description = document.getElementById('journal-desc') as HTMLInputElement
    await act(async () => {
      type(description, 'Pembayaran gaji minggu pertama')
    })

    await act(async () => {
      press(window, 'Escape')
    })

    expect(confirmSpy).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(container.querySelector('.modal')).not.toBeNull()

    confirmSpy.mockReturnValue(true)
    await act(async () => {
      press(window, 'Escape')
    })
    expect(onClose).toHaveBeenCalled()
  })
})
