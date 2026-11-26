// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './api.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API client path normalization', () => {
  it('menambahkan prefix /api tepat sekali', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    await request('/api/payroll/periods')
    await request('/payroll/periods')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/payroll/periods',
      '/api/payroll/periods'
    ])
  })

  it('menolak mode lokal ketika server Bun tidak terhubung', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(request('/api/payroll/periods')).rejects.toThrow('Server Finova belum terhubung')
  })
})
