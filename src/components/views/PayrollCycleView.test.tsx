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
  employment_type: 'PKWTT',
  status: 'ACTIVE',
  join_date: '2026-01-01',
  exit_date: null,
  ptkp_status: 'TK0',
  basic_salary: 5_000_000,
  fixed_allowance: 0,
  jkk_risk_class: 1
}

let currentEmployee: typeof employee
let currentThrSuggestion: number
let pendingExitDate: string | null
const run = {
  id: 1,
  tax_mode: 'TER',
  tax_category: 'A',
  gross_cash: 5_000_000,
  overtime_pay: 0,
  thr_amount: 0,
  other_allowance: 0,
  bpjs_kesehatan_employee: 250_000,
  bpjs_kesehatan_employer: 200_000,
  jht_employee: 100_000,
  jht_employer: 185_000,
  jp_employee: 50_000,
  jp_employer: 100_000,
  jkk_employer: 12_000,
  jkm_employer: 15_000,
  tax_bruto: 5_227_000,
  pph21: 152_790,
  other_deduction: 0,
  net_pay: 4_447_210,
  employer_contribution: 512_000,
  employer_cost: 5_512_000,
  calculation_json: JSON.stringify({
    basic: 5_000_000,
    fixedAllowance: 0,
    wageBasis: 5_000_000,
    proratedWage: 4_500_000,
    prorationFactor: 0.9,
    activeDays: 27,
    calendarDays: 30,
    absenceDeduction: 500_000,
    healthBase: 4_500_000,
    jpBase: 4_500_000,
    jkkRate: 0.0024,
    ptkp: 54_000_000
  })
}

let currentPeriod: any
let currentRun: any
let currentStale: boolean
let controlsState: any[]

function payloadFor(url: string): any {
  if (url === '/api/company') {
    return { company: { id: 1, name: 'PT Nusantara Konsumenindo Tbk' } }
  }
  if (url === '/api/payroll/employees') return { employees: [currentEmployee] }
  if (url === '/api/payroll/change-requests') return { requests: [] }
  if (url === '/api/payroll/parameters') return { ptkp: { TK0: 54_000_000 }, jkkRates: [0.24, 0.54, 0.89, 1.27, 1.74] }
  if (url === '/api/payroll/journals') return { journals: [] }
  if (url.endsWith('/documents')) {
    return {
      period: currentPeriod,
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
  if (url.endsWith('/controls')) {
    return {
      period: currentPeriod,
      checks: controlsState,
      suggested: {
        payeeCount: 1,
        calculatedCount: currentRun ? 1 : 0,
        netTotal: currentRun?.net_pay || 0,
        accountingTotal: currentPeriod.status === 'DRAFT' ? 0 : currentRun?.net_pay || 0
      }
    }
  }
  if (url.endsWith('/lines')) {
    return { period: currentPeriod, lines: [{ employee: currentEmployee, input: null, run: currentRun, stale: currentStale, thr_suggestion: currentThrSuggestion }] }
  }
  if (url === '/api/payroll/periods') return { periods: [currentPeriod] }
  return {}
}

let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>

function flush(): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  })
}

function tab(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('[role="tab"]'))
    .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Tab "${label}" tidak ditemukan`)
  return button as HTMLButtonElement
}

function button(label: string): HTMLButtonElement {
  const candidate = Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.trim() === label)
  if (!candidate) throw new Error(`Tombol "${label}" tidak ditemukan`)
  return candidate as HTMLButtonElement
}

async function openTab(label: string): Promise<void> {
  await act(async () => {
    tab(label).dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function click(label: string): Promise<void> {
  const target = button(label)
  if (target.disabled) throw new Error(`Tombol "${label}" nonaktif`)
  await act(async () => {
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

async function setField(label: string, value: string, eventName = 'input'): Promise<void> {
  const fieldLabel = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.querySelector('span')?.textContent?.trim() === label)
  const field = fieldLabel?.querySelector('input, select, textarea') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  if (!field) throw new Error(`Field "${label}" tidak ditemukan`)
  await act(async () => {
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value)
    field.dispatchEvent(new window.Event(eventName, { bubbles: true }))
  })
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  currentPeriod = { id: 1, period: '2026-11', pay_date: '2026-11-30', status: 'DRAFT' }
  currentEmployee = { ...employee }
  currentRun = null
  currentStale = false
  currentThrSuggestion = 0
  pendingExitDate = null
  controlsState = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'
    const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : {}
    if (method === 'POST' && url.endsWith('/change-requests')) {
      if (body.field_name === 'exit_date') pendingExitDate = body.new_value
      if (body.field_name === 'status' && body.new_value === 'INACTIVE' && !currentEmployee.exit_date && !pendingExitDate) {
        return { ok: false, status: 422, json: async () => ({ message: 'Tanggal keluar kerja wajib diisi untuk karyawan nonaktif.' }) }
      }
      return { ok: true, status: 201, json: async () => ({ id: 1 }) }
    }
    if (method === 'POST' && url.endsWith('/run')) {
      currentRun = { ...run }
      return { ok: true, status: 200, json: async () => ({ employees: 1 }) }
    }
    if (method === 'POST' && url.endsWith('/approve')) {
      currentPeriod = { ...currentPeriod, status: 'APPROVED' }
      return { ok: true, status: 200, json: async () => ({ journalId: 1 }) }
    }
    if (method === 'POST' && url.endsWith('/controls')) {
      const kind = body.kind
      const expected = kind === 'PAYEE_VERIFICATION' ? 1 : currentRun.net_pay
      const actual = kind === 'PAYEE_VERIFICATION' ? body.verified_count : body.bank_total
      const difference = actual - expected
      const status = difference === 0 ? 'OK' : 'MISMATCH'
      controlsState = [
        ...controlsState.filter((check) => check.kind !== kind),
        { kind, expected_value: expected, actual_value: actual, difference, status, operator_role: 'SDM', checked_at: '2026-11-26 10:00:00' }
      ]
      return { ok: true, status: 200, json: async () => ({ ok: true, status, expected, actual, difference }) }
    }
    if (method === 'POST' && url.endsWith('/pay')) {
      if (!controlsState.every((check) => check.status === 'OK') || controlsState.length < 2) {
        return { ok: false, status: 422, json: async () => ({ message: 'Kontrol pembayaran belum lengkap.' }) }
      }
      currentPeriod = { ...currentPeriod, status: 'PAID' }
      return { ok: true, status: 200, json: async () => ({ ok: true, journalId: 2 }) }
    }
    return { ok: true, status: 200, json: async () => payloadFor(url) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.classList.remove('payroll-print-slip')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PayrollCycleView sesuai BAB V.pptx', () => {
  it('menampilkan tujuh tab, lima aktivitas, dan jumlah karyawan tanpa format rupiah', async () => {
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()

    expect(container.querySelectorAll('[role="tab"]').length).toBe(7)
    expect(container.textContent).toContain('Lima aktivitas siklus penggajian')
    expect(container.textContent).toContain('Pengelolaan data karyawan')
    expect(container.textContent).toContain('Pencatatan akuntansi')
    expect(container.textContent).toContain('Gaji Bersih = Gaji Bruto − Total Potongan')
    expect(container.textContent).toContain('PT Nusantara Konsumenindo Tbk')
    expect(container.querySelector('.cycle-metric strong')?.textContent).toBe('1')
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('/api/') && !String(url).startsWith('/api/api/'))).toBe(true)
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

  it('menampilkan pemisahan tugas dan menonaktifkan kontrol sebelum persetujuan', async () => {
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Pengendalian')

    expect(container.textContent).toContain('Pemisahan tugas')
    expect(container.textContent).toContain('Verifikasi daftar penerima gaji')
    expect(container.textContent).toContain('Rekonsiliasi gaji, akuntansi, dan rekening bank')
    expect(container.textContent).toContain('Utang gaji akrual')
    expect(container.textContent).toContain('Pemeriksaan terbaru')
    expect(container.textContent).toContain('setelah periode disetujui, sebelum pembayaran')
    expect(button('Simpan verifikasi').disabled).toBe(true)
    expect(button('Simpan rekonsiliasi').disabled).toBe(true)
  })

  it('menandai perhitungan basi dan tidak menampilkan kategori TER untuk pajak tahunan', async () => {
    currentRun = { ...run, tax_mode: 'ANNUAL' }
    currentStale = true
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Daftar gaji')

    expect(container.textContent).toContain('Perlu hitung ulang')
    expect(container.textContent).toContain('Pasal 17 · tahunan')
    expect(container.textContent).not.toContain('ANNUAL · A')
  })

  it('menampilkan potongan absen dan aksi cetak slip', async () => {
    currentRun = { ...run }
    const print = vi.fn()
    vi.stubGlobal('print', print)
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Daftar gaji')
    await click('Lihat slip')

    expect(container.textContent).toContain('Potongan absen')
    expect(container.textContent).toContain('27 dari 30 hari')
    expect(container.textContent).toContain('Cetak / simpan PDF')
    await click('Cetak / simpan PDF')
    expect(print).toHaveBeenCalledOnce()
    expect(document.body.classList.contains('payroll-print-slip')).toBe(true)
  })

  it('membatasi absensi dan hari lembur pada hari aktif serta menerima THR prorata desimal', async () => {
    currentPeriod = { ...currentPeriod, period: '2026-06', pay_date: '2026-06-30' }
    currentEmployee.join_date = '2026-06-16'
    currentThrSuggestion = 2_500_000.55
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Daftar gaji')
    await click('Input kehadiran')

    expect(container.textContent).toContain('Absen 0–15 hari')
    const fieldOf = (label: string) => {
      const wrapper = Array.from(container.querySelectorAll('.cycle-field'))
        .find((candidate) => candidate.querySelector('span')?.textContent?.trim() === label)
      return wrapper?.querySelector('input') as HTMLInputElement
    }
    expect(fieldOf('Hari absen').max).toBe('15')
    expect(fieldOf('Jumlah hari lembur biasa').max).toBe('15')
    expect(fieldOf('Keterlambatan (menit)').max).toBe('1440')
    expect(fieldOf('THR / Tunjangan Hari Raya (Rp)').step).toBe('0.01')
    await click('pakai')
    expect(fieldOf('THR / Tunjangan Hari Raya (Rp)').value).toBe('2500000.55')
    await setField('Keterlambatan (menit)', '45')
    expect((container.querySelector('#cycle-input-form') as HTMLFormElement).checkValidity()).toBe(true)
    await click('Simpan input')
    const saved = fetchMock.mock.calls
      .filter(([url, init]) => String(url).includes('/inputs/') && init?.method === 'PUT')
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(saved.at(-1)?.late_minutes).toBe(45)
  })

  it('mengajukan nonaktif melalui perubahan yang disetujui, bukan DELETE langsung', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Data karyawan')
    await click('Ajukan nonaktif')
    await click('Ajukan perubahan')

    const changes = fetchMock.mock.calls
      .filter(([url, init]) => String(url) === '/api/payroll/change-requests' && init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(changes.map((change) => change.field_name)).toEqual(['exit_date', 'status'])
    expect(changes.every((change) => Boolean(change.reason) && !('requested_by_role' in change))).toBe(true)
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/employees/1') && init?.method === 'DELETE')).toBe(false)
  })

  it('menjalankan hitung, setujui, dua kontrol, lalu bayar', async () => {
    await act(async () => { root.render(React.createElement(PayrollCycleView)) })
    await flush()
    await openTab('Periode & absensi')
    await click('Hitung gaji')
    await click('Setujui')

    await openTab('Pengendalian')
    expect(button('Simpan verifikasi').disabled).toBe(false)
    await setField('Jumlah penerima terverifikasi', '1')
    await click('Simpan verifikasi')
    await setField('Saldo/rekap transfer bank (Rp)', String(run.net_pay))
    await click('Simpan rekonsiliasi')

    expect(currentPeriod.status).toBe('APPROVED')
    const controlRequests = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/controls') && init?.method === 'POST')
    expect(controlRequests.map(([, init]) => JSON.parse(String(init?.body)).kind), JSON.stringify(controlsState)).toEqual(['PAYEE_VERIFICATION', 'RECONCILIATION'])
    expect(controlsState).toHaveLength(2)
    expect(controlsState.every((check) => check.status === 'OK')).toBe(true)
    await openTab('Periode & absensi')
    await click('Bayar')
    expect(currentPeriod.status).toBe('PAID')
    const routes = fetchMock.mock.calls.map(([url, init]) => `${init?.method || 'GET'} ${String(url)}`)
    expect(routes).toContain(`POST /api/payroll/periods/1/run`)
    expect(routes).toContain(`POST /api/payroll/periods/1/approve`)
    expect(routes.filter((route) => route === 'POST /api/payroll/periods/1/controls')).toHaveLength(2)
    expect(routes).toContain(`POST /api/payroll/periods/1/pay`)
  })
})
