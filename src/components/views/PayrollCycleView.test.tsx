// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PayrollCycleView } from './PayrollCycleView.jsx'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const employee = {
  id: 1,
  employee_code: 'PG-001',
  name: 'Karyawan Uji',
  department: 'Administrasi',
  position: 'Staf',
  status: 'ACTIVE',
  join_date: '2026-01-01',
  ptkp_status: 'TK0',
  basic_salary: 5_000_000,
  fixed_allowance: 0,
  jkk_risk_class: 1
}

const period = { id: 1, period: '2026-11', pay_date: '2026-11-30', status: 'DRAFT' }

function payloadFor(url: string): any {
  if (url.includes('/employees')) return { employees: [employee] }
  if (url.includes('/change-requests')) return { requests: [] }
  if (url.includes('/parameters')) return { ptkp: { TK0: 0 }, jkkRates: [0.24, 0.54, 0.89, 1.27, 1.74] }
  if (url.includes('/journals')) return { journals: [] }
  if (url.includes('/periods') && url.includes('/documents')) {
    return {
      period,
      documents: Array.from({ length: 8 }, (_, index) => ({
        id: null,
        doc_type: `DOC_${index}`,
        label: `Dokumen ${index + 1}`,
        description: 'Catatan dokumen',
        order: index + 1,
        reference_no: '',
        doc_date: null,
        title: '',
        status: 'DRAFT',
        note: null
      }))
    }
  }
  if (url.includes('/periods') && url.includes('/controls')) {
    return {
      period,
      checks: [],
      suggested: { payeeCount: 1, calculatedCount: 0, netTotal: 0, accountingTotal: 0 }
    }
  }
  if (url.includes('/periods') && url.includes('/lines')) {
    return { period, lines: [{ employee, input: null, run: null, thr_suggestion: 0 }] }
  }
  if (url.includes('/periods')) return { periods: [period] }
  return {}
}

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function tab(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('[role="tab"]'))
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Tab "${label}" tidak ditemukan`)
  return button as HTMLButtonElement
}

async function openTab(label: string): Promise<void> {
  await act(async () => {
    tab(label).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn(async (input: string | URL | Request) => ({
    ok: true,
    status: 200,
    json: async () => payloadFor(String(input))
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('PayrollCycleView sesuai BAB V.pptx', () => {
  it('menampilkan tujuh tab dan lima aktivitas pada ringkasan', async () => {
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()

    expect(container.querySelectorAll('[role="tab"]').length).toBe(7)
    expect(container.textContent).toContain('Lima aktivitas siklus penggajian')
    expect(container.textContent).toContain('Pengelolaan data karyawan')
    expect(container.textContent).toContain('Pencatatan akuntansi')
    expect(container.textContent).toContain('Gaji Bersih = Gaji Bruto − Total Potongan')
  })

  it('menampilkan delapan dokumen pada tab Dokumen', async () => {
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Dokumen')

    expect(container.textContent).toContain('Dokumen periode')
    expect(container.textContent).toContain('Dokumen 1')
    expect(container.textContent).toContain('Dokumen 8')
    expect(container.textContent).toContain('Delapan dokumen')
  })

  it('menampilkan pemisahan tugas dan rekonsiliasi pada tab Pengendalian', async () => {
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Pengendalian')

    expect(container.textContent).toContain('Pemisahan tugas')
    expect(container.textContent).toContain('Verifikasi daftar penerima gaji')
    expect(container.textContent).toContain('Rekonsiliasi gaji, akuntansi, dan rekening bank')
    expect(container.textContent).toContain('Riwayat pemeriksaan')
  })
})
