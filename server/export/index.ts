// Tipe data ekspor — port dari src-rust/export/mod.rs.
export interface Signers {
  maker: string
  checker: string
  approver: string
}

export interface RecapItem {
  code: string
  name: string
  amount: number
}

export interface Recap {
  debits: RecapItem[]
  credits: RecapItem[]
  total_debit: number
  total_credit: number
  is_balanced: boolean
}

export function recapIsEmpty(recap: Recap): boolean {
  return recap.debits.length === 0 && recap.credits.length === 0
}

export function signersWithDefaults(signers: Signers): Signers {
  return {
    maker: signers.maker.trim() === '' ? 'Staf Akuntansi' : signers.maker,
    checker: signers.checker.trim() === '' ? 'Supervisor' : signers.checker,
    approver: signers.approver.trim() === '' ? 'Pimpinan' : signers.approver
  }
}

export interface JournalRow {
  show_head: boolean
  date: string
  voucher: string
  account: string
  ref_code: string
  debit: number
  credit: number
  is_credit: boolean
  alternate: boolean
  line_memo: string
  end_memo: string
}

export interface JournalData {
  company: string
  from: string
  to: string
  entries: JournalRow[]
  total_debit: number
  total_credit: number
  recap: Recap
  signers: Signers
  printed_on: string
}

export interface LedgerRow {
  date: string
  voucher: string
  description: string
  debit: number
  credit: number
  balance: number
}

export interface LedgerData {
  company: string
  account_label: string
  normal_balance: string
  from: string
  to: string
  opening: number
  rows: LedgerRow[]
  closing: number
}

export interface TrialBalanceRow {
  code: string
  name: string
  group: string
  debit: number
  credit: number
}

export interface TrialBalanceData {
  company: string
  as_of: string
  rows: TrialBalanceRow[]
  total_debit: number
  total_credit: number
}

export interface AccountRow {
  code: string
  name: string
  group: string
  subtype: string
  normal_balance: string
  cash_flow: string
  cash_label: string
}

export interface AccountsData {
  company: string
  rows: AccountRow[]
}
