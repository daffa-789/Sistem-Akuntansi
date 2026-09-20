import { AccountGroup } from '../../shared/types.js'

export const today = (): string => new Date().toISOString().slice(0, 10)

export const firstDay = (): string => `${today().slice(0, 8)}01`

export const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
})

export const money = (value: number | string | null | undefined): string => rupiah.format(Number(value || 0))

export const number = (value: number | string | null | undefined): string =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value || 0))

export const dateLabel = (value: unknown): string =>
  value
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(
        new Date(`${String(value).slice(0, 10)}T00:00:00`)
      )
    : '—'

export const apiPath = (path: string, values: Record<string, any> = {}): string => {
  const params = new URLSearchParams(
    Object.entries(values).filter(
      ([, value]) => value !== '' && value !== undefined && value !== null
    )
  ).toString()
  return params ? `${path}?${params}` : path
}

export const formatNum = (v: number | string | null | undefined): string => {
  const s = String(v ?? '').replace(/[^0-9]/g, '')
  if (!s) return ''
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export const parseNum = (v: number | string | null | undefined): number => Number(String(v ?? '').replace(/\./g, '')) || 0

export const GL: Record<AccountGroup, string> = {
  ASSET: 'Aktiva (Aset)',
  LIABILITY: 'Liabilitas (Utang)',
  EQUITY: 'Ekuitas (Modal)',
  REVENUE: 'Pendapatan',
  EXPENSE: 'Beban'
}
