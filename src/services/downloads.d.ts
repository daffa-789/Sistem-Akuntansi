// Deklarasi untuk downloads.js (dipakai komponen TSX).
export interface Query {
  [key: string]: string | number | boolean | null | undefined
}

export interface Signers {
  maker: string
  checker: string
  approver: string
}

export interface DateRange {
  from: string
  to: string
}

export function queryString(values: Query): string
export function readSigners(): Signers
export function exportJournalFile(range: DateRange, format?: 'xlsx' | 'pdf', extra?: Query): Promise<void>
export function exportLedgerFile(range: DateRange, accountId?: string | number, accountCode?: string): Promise<void>
export function exportTrialBalanceFile(range: DateRange): Promise<void>
export function exportAccountsFile(): Promise<void>
