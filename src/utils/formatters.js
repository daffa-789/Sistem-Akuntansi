export const today = () => new Date().toISOString().slice(0, 10)

export const firstDay = () => `${today().slice(0, 8)}01`

export const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
})

export const money = (value) => rupiah.format(Number(value || 0))

export const number = (value) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value || 0))

export const dateLabel = (value) =>
  value
    ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(
        new Date(`${String(value).slice(0, 10)}T00:00:00`)
      )
    : '—'

export const apiPath = (path, values = {}) => {
  const params = new URLSearchParams(
    Object.entries(values).filter(
      ([, value]) => value !== '' && value !== undefined && value !== null
    )
  ).toString()
  return params ? `${path}?${params}` : path
}

export const formatNum = (v) => {
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

export const parseNum = (v) => {
  const raw = String(v ?? '').replace(/[^\d.,-]/g, '')
  if (!raw) return 0
  const comma = raw.lastIndexOf(',')
  const dot = raw.lastIndexOf('.')
  const decimalIndex = Math.max(comma, dot)
  if (decimalIndex < 0) return Number(raw) || 0
  let normalized
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

export const GL = {
  ASSET: 'Aktiva (Aset)',
  LIABILITY: 'Liabilitas (Utang)',
  EQUITY: 'Ekuitas (Modal)',
  REVENUE: 'Pendapatan',
  EXPENSE: 'Beban'
}

export const SOURCE_LABEL = {
  MANUAL: 'Manual',
  IMPORT: 'Impor Excel',
  CLOSING: 'Jurnal Penutup',
  REVERSAL: 'Pembalik'
}
