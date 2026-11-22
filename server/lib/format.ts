// Pemformat tanggal & rupiah — dipakai ekspor xlsx/pdf dan laporan.

/** Setara format_idr di src-rust/export/mod.rs. */
export function formatIdr(value: number): string {
  if (value === 0) return '-'
  const isNeg = value < 0
  const absVal = Math.abs(value)
  const intPart = Math.trunc(absVal)
  const fracPart = Math.round((absVal - intPart) * 100)

  const digits = String(intPart)
  let withDots = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) withDots += '.'
    withDots += digits[i]
  }

  const formatted = fracPart > 0 ? `${withDots},${String(fracPart).padStart(2, '0')}` : withDots
  return isNeg ? `-${formatted}` : formatted
}

/** YYYY-MM-DD hari ini menurut waktu lokal. */
export function todayLocal(): string {
  const now = new Date()
  const y = String(now.getFullYear()).padStart(4, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** YYYYMM bulan ini menurut waktu lokal (dipakai penomoran bukti). */
export function yearMonthLocal(): string {
  const now = new Date()
  const y = String(now.getFullYear()).padStart(4, '0')
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}${m}`
}

/** stempel waktu lokal format SQLite: YYYY-MM-DD HH:MM:SS. */
export function localTimestamp(): string {
  const now = new Date()
  const date = todayLocal()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${date} ${hh}:${mm}:${ss}`
}
