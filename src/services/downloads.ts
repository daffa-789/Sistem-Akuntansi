import { download } from '../api.js'

// Pembuat nama + parameter berkas ekspor. Berkasnya sendiri kini dihasilkan server Go
// (internal/export), jadi ExcelJS/jsPDF tidak perlu ikut diunduh ke peramban.

export type Query = Record<string, string | number | undefined | null>

export function queryString(values: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export interface Signers {
  maker?: string
  checker?: string
  approver?: string
}

// readSigners membaca nama penanda tangan yang disimpan pengguna di peramban.
export function readSigners(): Signers {
  try {
    const raw = localStorage.getItem('finova_signers')
    if (raw) {
      const parsed = JSON.parse(raw)
      return { maker: parsed.maker, checker: parsed.checker, approver: parsed.approver }
    }
  } catch {
    // storage tidak tersedia atau isinya rusak: pakai bawaan server
  }
  return {}
}

// Tipe alias (bukan interface) agar bisa dilewatkan langsung ke queryString().
export type Range = { from: string; to: string }

export async function exportJournalFile(range: Range, format: 'xlsx' | 'pdf', extra: Query = {}): Promise<void> {
  const query = queryString({ ...range, ...extra, ...readSigners() })
  const name = `Finova_Jurnal_Umum_${range.from}_sd_${range.to}.${format}`
  await download(`/exports/journal.${format}${query}`, name)
}

export async function exportLedgerFile(range: Range, accountId: string | number, accountCode: string): Promise<void> {
  const query = queryString({ ...range, accountId })
  await download(`/exports/ledger.xlsx${query}`, `Finova_Buku_Besar_${accountCode}_${range.from}.xlsx`)
}

export async function exportTrialBalanceFile(range: Range): Promise<void> {
  await download(`/exports/trial-balance.xlsx${queryString(range)}`, `Finova_Neraca_Saldo_${range.to}.xlsx`)
}

export async function exportAccountsFile(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  await download('/exports/accounts.xlsx', `Finova_Bagan_Akun_${today}.xlsx`)
}
