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

// Menampilkan angka dengan titik ribuan dan koma desimal (konvensi Indonesia).
export const formatNum = (v: number | string | null | undefined): string => {
  const raw = String(v ?? '').trim()
  if (!raw) return ''
  const negative = raw.startsWith('-')
  const digits = raw.replace(/[^0-9.]/g, '')
  const [intPart, ...rest] = digits.split('.')
  const decPart = rest.join('')
  const grouped = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  if (!digits.includes('.')) return `${negative ? '-' : ''}${grouped}`
  return `${negative ? '-' : ''}${grouped},${decPart}`
}

// Mengikuti aturan excelAmount di server: bila koma dan titik sama-sama hadir, yang
// terakhir adalah pemisah desimal. Kelompok tiga digit dianggap ribuan, jadi '1.500'
// tetap 1500; konsekuensinya '12.00' terbaca 12 — tulis '12,00' untuk dua desimal.
export const parseNum = (v: number | string | null | undefined): number => {
  const raw = String(v ?? '').replace(/[^\d.,-]/g, '')
  if (!raw) return 0
  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')
  const decimalIndex = Math.max(comma, dot)
  if (decimalIndex < 0) return Number(raw) || 0
  let normalized: string
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  } else {
    const whole = raw.slice(0, decimalIndex).replace(/[.,]/g, '')
    const fraction = raw.slice(decimalIndex + 1).replace(/[.,]/g, '')
    normalized = fraction.length > 0 && fraction.length % 3 === 0 ? `${whole}${fraction}` : `${whole}.${fraction}`
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

export const GL: Record<AccountGroup, string> = {
  ASSET: 'Aktiva (Aset)',
  LIABILITY: 'Liabilitas (Utang)',
  EQUITY: 'Ekuitas (Modal)',
  REVENUE: 'Pendapatan',
  EXPENSE: 'Beban'
}

export const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  IMPORT: 'Impor Excel',
  CLOSING: 'Jurnal Penutup',
  REVERSAL: 'Pembalik'
}
