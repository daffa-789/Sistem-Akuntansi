// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { LoginView } from './LoginView.jsx'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('LoginView', () => {
  it('mengisi akun demo dan mengirim kredensial ke endpoint login', async () => {
    const user = { id: 3, name: 'Bagian SDM', email: 'sdm@finova.local', role: 'SDM' }
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ user })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onLogin = vi.fn()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(React.createElement(LoginView, { onLogin })) })
    const accountButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Bagian SDM'))
    expect(accountButton).toBeTruthy()
    await act(async () => {
      accountButton!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
    const password = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(password.value).toBe('finova2026')

    const submit = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Masuk')) as HTMLButtonElement
    await act(async () => { submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })

    expect(onLogin).toHaveBeenCalledWith(user)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/login')
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'sdm@finova.local',
      password: 'finova2026'
    })
    act(() => root.unmount())
  })
})
