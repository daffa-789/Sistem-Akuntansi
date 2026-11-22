// Domain akuntansi Finova — port dari src-rust/domain/mod.rs.
//
// Semua rumus (pembulatan, toleransi, urutan penjumlahan) dipertahankan sama
// supaya angka yang muncul di laporan identik dengan versi Rust. Rust dan JS
// sama-sama memakai IEEE-754 double, sehingga (a + b) * c dan seterusnya
// menghasilkan bit yang sama untuk operasi yang sama urutan.
import { AppError } from './errors'

export const MONEY_EPSILON = 0.005
const NUMBER_EPSILON = 2.220446049250313e-16

/** Setara js_round di Rust: membulatkan ke atas pada tepat 0,5. */
function jsRound(value: number): number {
  return Math.floor(value + 0.5)
}

/** Pembulatan uang ke 2 desimal dengan kompensasi galat floating point. */
export function roundMoney(value: number): number {
  return jsRound((value + NUMBER_EPSILON) * 100) / 100
}

function formatMoney(value: number): string {
  return String(value)
}

export interface Account {
  id: number
  code: string
  name: string
  group: string
  subtype: string | null
  normal_balance: string
  cash_flow_category: string
  is_cash_account: boolean
  is_active: boolean
}

export interface Line {
  account_id: number
  line_no: number
  debit: number
  credit: number
  memo: string | null
  code?: string | null
  account_name?: string | null
}

export interface Entry {
  id: number
  voucher_no: string
  entry_date: string
  description: string
  source: string
  status: string
  reversal_of_id: number | null
  reversed: boolean
  lines: Line[]
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

export interface LineInput {
  account_id?: number | null
  accountId?: number | null
  debit?: unknown
  credit?: unknown
  memo?: string | null
  code?: string | null
}

export function parseF64(val: unknown): number {
  if (typeof val === 'number') return roundMoney(val)
  if (typeof val === 'string') {
    const clean = val.trim().replace(/,/g, '')
    const parsed = Number(clean)
    return roundMoney(Number.isNaN(parsed) ? 0 : parsed)
  }
  return 0
}

function lineAccountId(item: LineInput): number {
  if (item.account_id !== undefined && item.account_id !== null) return Number(item.account_id)
  if (item.accountId !== undefined && item.accountId !== null) return Number(item.accountId)
  return 0
}

/** Baris jurnal mentua dari request → tervalidasi & bernomor. */
export function normalizeAndAssert(items: LineInput[]): AmountedLine[] {
  if (items.length < 2) {
    throw AppError.badRequest('Jurnal harus memiliki sedikitnya dua baris.')
  }

  const normalized: AmountedLine[] = []
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const accountId = lineAccountId(item)
    if (accountId === 0) {
      throw AppError.badRequest(`Baris ${index + 1}: akun wajib dipilih.`)
    }

    const debit = roundMoney(parseF64(item.debit))
    const credit = roundMoney(parseF64(item.credit))

    if (
      debit < 0 ||
      credit < 0 ||
      (debit > 0 && credit > 0) ||
      (debit === 0 && credit === 0)
    ) {
      throw AppError.badRequest(
        `Baris ${index + 1}: isi tepat salah satu kolom debit atau kredit.`
      )
    }

    normalized.push({
      account_id: accountId,
      line_no: index + 1,
      debit,
      credit,
      memo: item.memo ?? null,
      code: item.code ?? null,
      account_name: null,
      source: '',
      entry_date: '',
      voucher_no: '',
      description: ''
    })
  }

  return assertBalanced(normalized)
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
      `Jurnal tidak seimbang: debit ${formatMoney(debit)} dan kredit ${formatMoney(credit)}.`
    )
  }

  return lines
}

interface Total {
  debit: number
  credit: number
}

function emptyTotal(): Total {
  return { debit: 0, credit: 0 }
}

export function calculateAccountBalances(
  accounts: Account[],
  lines: AmountedLine[]
): Map<number, Total> {
  const balances = new Map<number, Total>()
  for (const account of accounts) {
    balances.set(account.id, emptyTotal())
  }
  for (const line of lines) {
    let entry = balances.get(line.account_id)
    if (!entry) {
      entry = emptyTotal()
      balances.set(line.account_id, entry)
    }
    entry.debit = roundMoney(entry.debit + line.debit)
    entry.credit = roundMoney(entry.credit + line.credit)
  }
  return balances
}

export function accountBalance(account: Account, balances: Map<number, Total>): number {
  const values = balances.get(account.id) ?? emptyTotal()
  const debit = roundMoney(values.debit)
  const credit = roundMoney(values.credit)
  if (account.normal_balance === 'DEBIT') {
    return roundMoney(debit - credit)
  }
  return roundMoney(credit - debit)
}

export interface TrialBalanceRow {
  accountId: number
  code: string
  name: string
  group: string
  debit: number
  credit: number
  signedBalance: number
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[]
  totals: Total
  isBalanced: boolean
}

export function buildTrialBalance(
  accounts: Account[],
  lines: AmountedLine[]
): TrialBalanceResult {
  const balances = calculateAccountBalances(accounts, lines)
  const rows: TrialBalanceRow[] = []

  for (const account of accounts) {
    if (!account.is_active) continue
    const balance = accountBalance(account, balances)
    const normalDebit = account.normal_balance === 'DEBIT'

    const row: TrialBalanceRow = {
      accountId: account.id,
      code: account.code,
      name: account.name,
      group: account.group,
      debit: 0,
      credit: 0,
      signedBalance: balance
    }

    if (normalDebit) {
      row.debit = Math.max(balance, 0)
      row.credit = Math.max(-balance, 0)
    } else {
      row.debit = Math.max(-balance, 0)
      row.credit = Math.max(balance, 0)
    }

    if (row.debit !== 0 || row.credit !== 0) {
      rows.push(row)
    }
  }

  let totalDebit = 0
  let totalCredit = 0
  for (const row of rows) {
    totalDebit = roundMoney(totalDebit + row.debit)
    totalCredit = roundMoney(totalCredit + row.credit)
  }

  return {
    rows,
    totals: { debit: totalDebit, credit: totalCredit },
    isBalanced: Math.abs(totalDebit - totalCredit) < MONEY_EPSILON
  }
}

export interface StatementRow {
  accountId: number
  code: string
  name: string
  amount: number
}

export interface IncomeStatement {
  revenue: StatementRow[]
  expenses: StatementRow[]
  revenueTotal: number
  expenseTotal: number
  netIncome: number
}

function sumRows(rows: StatementRow[]): number {
  let total = 0
  for (const row of rows) total = roundMoney(total + row.amount)
  return total
}

export function buildIncomeStatement(
  accounts: Account[],
  lines: AmountedLine[]
): IncomeStatement {
  const operational = lines.filter((line) => line.source !== 'CLOSING')
  const balances = calculateAccountBalances(accounts, operational)

  const rowsFor = (group: string): StatementRow[] => {
    const rows: StatementRow[] = []
    for (const account of accounts) {
      if (!account.is_active || account.group !== group) continue
      const value = Math.max(accountBalance(account, balances), 0)
      if (value !== 0) {
        rows.push({
          accountId: account.id,
          code: account.code,
          name: account.name,
          amount: value
        })
      }
    }
    return rows
  }

  const revenue = rowsFor('REVENUE')
  const expenses = rowsFor('EXPENSE')
  const revenueTotal = sumRows(revenue)
  const expenseTotal = sumRows(expenses)

  return {
    revenue,
    expenses,
    revenueTotal,
    expenseTotal,
    netIncome: roundMoney(revenueTotal - expenseTotal)
  }
}

export interface Section {
  rows: StatementRow[]
  total: number
}

export interface EquitySection {
  rows: StatementRow[]
  total: number
  unclosedProfit: number
}

export interface BalanceSheet {
  assets: Section
  liabilities: Section
  equity: EquitySection
  balanced: boolean
}

export function buildBalanceSheet(
  accounts: Account[],
  lines: AmountedLine[]
): BalanceSheet {
  const balances = calculateAccountBalances(accounts, lines)

  const sectionFor = (group: string): Section => {
    const rows: StatementRow[] = []
    for (const account of accounts) {
      if (!account.is_active || account.group !== group) continue
      let value = accountBalance(account, balances)
      if (group === 'EQUITY' && account.subtype === 'DRAWINGS') {
        value = -value
      }
      if (value !== 0) {
        rows.push({
          accountId: account.id,
          code: account.code,
          name: account.name,
          amount: value
        })
      }
    }
    return { rows, total: sumRows(rows) }
  }

  const assets = sectionFor('ASSET')
  const liabilities = sectionFor('LIABILITY')
  const equity = sectionFor('EQUITY')
  const unclosed = buildIncomeStatement(accounts, lines).netIncome
  const totalEquity = roundMoney(equity.total + unclosed)

  return {
    assets,
    liabilities,
    equity: {
      rows: equity.rows,
      total: totalEquity,
      unclosedProfit: unclosed
    },
    balanced: Math.abs(assets.total - liabilities.total - totalEquity) < MONEY_EPSILON
  }
}

export interface EquityChanges {
  opening: number
  capital: number
  drawings: number
  netIncome: number
  closing: number
}

export function buildEquityChanges(
  accounts: Account[],
  beforeLines: AmountedLine[],
  periodLines: AmountedLine[]
): EquityChanges {
  const before = calculateAccountBalances(accounts, beforeLines)
  const period = calculateAccountBalances(accounts, periodLines)

  const equityAccounts = accounts.filter((a) => a.group === 'EQUITY' && a.is_active)

  const equityTotal = (balances: Map<number, Total>): number => {
    let total = 0
    for (const account of equityAccounts) {
      let value = accountBalance(account, balances)
      if (account.subtype === 'DRAWINGS') value = -value
      total = roundMoney(total + value)
    }
    return total
  }

  const subtotal = (
    balances: Map<number, Total>,
    subtype: string,
    negate: boolean
  ): number => {
    let total = 0
    for (const account of equityAccounts) {
      if (account.subtype !== subtype) continue
      total = roundMoney(total + accountBalance(account, balances))
    }
    return negate ? roundMoney(-total) : roundMoney(total)
  }

  const opening = equityTotal(before)
  const capital = subtotal(period, 'OWNER_CAPITAL', false)
  const drawings = subtotal(period, 'DRAWINGS', true)
  const netIncome = buildIncomeStatement(accounts, periodLines).netIncome

  return {
    opening,
    capital,
    drawings,
    netIncome,
    closing: roundMoney(opening + capital + drawings + netIncome)
  }
}

export interface CashFlow {
  operating: number
  investing: number
  financing: number
  netChange: number
}

export function buildCashFlowDirect(accounts: Account[], entries: Entry[]): CashFlow {
  const byId = new Map<number, Account>()
  for (const account of accounts) byId.set(account.id, account)

  const groups: Record<string, number> = {
    OPERATING: 0,
    INVESTING: 0,
    FINANCING: 0
  }

  for (const entry of entries) {
    if (entry.source === 'CLOSING') continue

    const cashLines: Line[] = []
    let nonCash: Line | null = null

    for (const line of entry.lines) {
      const acct = byId.get(line.account_id)
      if (!acct) continue
      if (acct.is_cash_account) {
        cashLines.push(line)
      } else if (nonCash === null) {
        nonCash = line
      }
    }

    let category = 'OPERATING'
    if (nonCash) {
      const acct = byId.get(nonCash.account_id)
      if (acct) {
        if (acct.cash_flow_category === 'INVESTING') category = 'INVESTING'
        else if (acct.cash_flow_category === 'FINANCING') category = 'FINANCING'
      }
    }

    for (const line of cashLines) {
      const current = groups[category] ?? 0
      const diff = roundMoney(line.debit) - roundMoney(line.credit)
      groups[category] = roundMoney(current + diff)
    }
  }

  const operating = groups.OPERATING ?? 0
  const investing = groups.INVESTING ?? 0
  const financing = groups.FINANCING ?? 0

  return {
    operating,
    investing,
    financing,
    netChange: roundMoney(operating + investing + financing)
  }
}

/** Jurnal penutup: tutup semua REVENUE/EXPENSE ke Laba Ditahan. */
export function makeClosingLines(
  accounts: Account[],
  periodLines: AmountedLine[]
): AmountedLine[] {
  const balances = calculateAccountBalances(accounts, periodLines)
  const retained = accounts.find((a) => a.subtype === 'RETAINED_EARNINGS')
  if (!retained) {
    throw AppError.badRequest('Akun laba ditahan belum tersedia.')
  }

  const lines: AmountedLine[] = []
  for (const account of accounts) {
    if (account.group !== 'REVENUE' && account.group !== 'EXPENSE') continue
    const balance = accountBalance(account, balances)
    if (Math.abs(balance) < MONEY_EPSILON) continue
    lines.push({
      account_id: account.id,
      line_no: 0,
      debit: account.group === 'REVENUE' ? balance : 0,
      credit: account.group === 'REVENUE' ? 0 : balance,
      memo: null,
      code: null,
      account_name: null,
      source: '',
      entry_date: '',
      voucher_no: '',
      description: ''
    })
  }

  if (lines.length === 0) return []

  let debit = 0
  let credit = 0
  for (const line of lines) {
    debit = roundMoney(debit + line.debit)
    credit = roundMoney(credit + line.credit)
  }

  const diff = roundMoney(debit - credit)
  if (diff > 0) {
    lines.push({
      account_id: retained.id,
      line_no: 0,
      debit: 0,
      credit: diff,
      memo: null,
      code: null,
      account_name: null,
      source: '',
      entry_date: '',
      voucher_no: '',
      description: ''
    })
  } else if (diff < 0) {
    lines.push({
      account_id: retained.id,
      line_no: 0,
      debit: -diff,
      credit: 0,
      memo: null,
      code: null,
      account_name: null,
      source: '',
      entry_date: '',
      voucher_no: '',
      description: ''
    })
  }

  return assertBalanced(lines)
}

/** Entri + barisnya dirata menjadi satu daftar AmountedLine untuk dihitung. */
export function flatten(entries: Entry[]): AmountedLine[] {
  const result: AmountedLine[] = []
  for (const entry of entries) {
    for (const line of entry.lines) {
      result.push({
        account_id: line.account_id,
        line_no: line.line_no,
        debit: line.debit,
        credit: line.credit,
        memo: line.memo,
        code: line.code ?? null,
        account_name: line.account_name ?? null,
        source: entry.source,
        entry_date: entry.entry_date,
        voucher_no: entry.voucher_no,
        description: entry.description
      })
    }
  }
  return result
}

/** Ambil bagian tanggal (10 karakter pertama) dari teks tanggal berapa pun. */
export function dateText(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value
}
