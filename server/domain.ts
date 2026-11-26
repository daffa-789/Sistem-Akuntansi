import { AppError } from './errors'

export const MONEY_EPSILON = 0.005
const NUMBER_EPSILON = 2.220446049250313e-16

function jsRound(value: number): number {
  return Math.floor(value + 0.5)
}

export function roundMoney(value: number): number {
  return jsRound((value + NUMBER_EPSILON) * 100) / 100
}

export interface AmountedLine {
  account_id: number
  line_no: number
  debit: number
  credit: number
  memo: string | null
  code?: string | null
  account_name?: string | null
  source: string
  entry_date: string
  voucher_no: string
  description: string
}

export function assertBalanced(lines: AmountedLine[]): AmountedLine[] {
  if (lines.length < 2) {
    throw AppError.badRequest('Jurnal harus memiliki sedikitnya dua baris.')
  }

  let debit = 0
  let credit = 0

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (line.account_id === 0) {
      throw AppError.badRequest(`Baris ${index + 1}: akun wajib dipilih.`)
    }
    if (
      line.debit < 0 ||
      line.credit < 0 ||
      (line.debit > 0 && line.credit > 0) ||
      (line.debit === 0 && line.credit === 0)
    ) {
      throw AppError.badRequest(
        `Baris ${index + 1}: isi tepat salah satu kolom debit atau kredit.`
      )
    }
    debit = roundMoney(debit + line.debit)
    credit = roundMoney(credit + line.credit)
  }

  if (Math.abs(debit - credit) >= MONEY_EPSILON) {
    throw AppError.badRequest(
      `Jurnal tidak seimbang: debit ${debit} dan kredit ${credit}.`
    )
  }

  return lines
}
