import {
  Account,
  AccountGroup,
  JournalLine,
  JournalEntry,
  TrialBalanceResult,
  TrialBalanceRow
} from '../shared/types.js'

export const MONEY_EPSILON = 0.005

export const roundMoney = (value: number | string | null | undefined): number =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100

export const amount = (value: number | string | null | undefined): number => roundMoney(value || 0)

export function assertBalancedLines<T extends { debit?: number | string; credit?: number | string; account_id?: number; accountId?: number; account_code?: string; accountCode?: string; memo?: string | null; line_no?: number }>(lines: T[]): (T & { debit: number; credit: number })[] {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error('Jurnal harus memiliki sedikitnya dua baris.')
  const normalized = lines.map((line, index) => {
    const debit = amount(line.debit)
    const credit = amount(line.credit)
    if (!line.account_id && !line.accountId && !line.account_code && !line.accountCode) throw new Error(`Baris ${index + 1}: akun wajib dipilih.`)
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error(`Baris ${index + 1}: isi tepat salah satu kolom debit atau kredit.`)
    }
    return { ...line, debit, credit }
  })
  const debit = amount(normalized.reduce((total, line) => total + line.debit, 0))
  const credit = amount(normalized.reduce((total, line) => total + line.credit, 0))
  if (Math.abs(debit - credit) >= MONEY_EPSILON) throw new Error(`Jurnal tidak seimbang: debit ${debit} dan kredit ${credit}.`)
  return normalized
}

export interface AccountTotal {
  debit: number
  credit: number
}

export function calculateAccountBalances(accounts: Account[], lines: (JournalLine | { debit?: number; credit?: number; account_id?: number; accountId?: number })[]): Map<string, AccountTotal> {
  const balances = new Map<string, AccountTotal>(accounts.map((account) => [String(account.id), { debit: 0, credit: 0 }]))
  for (const line of lines) {
    const key = String(line.account_id ?? line.accountId)
    const current = balances.get(key) || { debit: 0, credit: 0 }
    current.debit = amount(current.debit + amount(line.debit))
    current.credit = amount(current.credit + amount(line.credit))
    balances.set(key, current)
  }
  return balances
}

export function accountBalance(account: Account, totals: Map<string, AccountTotal>): number {
  const values = totals.get(String(account.id)) || { debit: 0, credit: 0 }
  const debit = amount(values.debit)
  const credit = amount(values.credit)
  const normal = account.normal_balance || (['ASSET', 'EXPENSE'].includes(account.account_group) ? 'DEBIT' : 'CREDIT')
  return normal === 'DEBIT' ? amount(debit - credit) : amount(credit - debit)
}

export function buildTrialBalance(accounts: Account[], lines: JournalLine[]): TrialBalanceResult {
  const totals = calculateAccountBalances(accounts, lines)
  const rows: TrialBalanceRow[] = accounts
    .filter((account) => Boolean(account.is_active))
    .map((account) => {
      const balance = accountBalance(account, totals)
      const normalDebit = account.normal_balance === 'DEBIT'
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        group: account.account_group,
        debit: normalDebit ? Math.max(balance, 0) : Math.max(-balance, 0),
        credit: normalDebit ? Math.max(-balance, 0) : Math.max(balance, 0),
        signedBalance: balance
      }
    })
    .filter((row) => row.debit || row.credit)

  const debit = amount(rows.reduce((sum, row) => sum + row.debit, 0))
  const credit = amount(rows.reduce((sum, row) => sum + row.credit, 0))

  return {
    rows,
    totals: {
      debit,
      credit
    },
    isBalanced: Math.abs(debit - credit) < MONEY_EPSILON
  }
}

export interface IncomeStatementRow {
  accountId: number
  code: string
  name: string
  amount: number
}

export interface IncomeStatementReport {
  revenue: IncomeStatementRow[]
  expenses: IncomeStatementRow[]
  revenueTotal: number
  expenseTotal: number
  netIncome: number
}

export function buildIncomeStatement(accounts: Account[], lines: (JournalLine & { source?: string })[]): IncomeStatementReport {
  const operationalLines = lines.filter((line) => line.source !== 'CLOSING')
  const totals = calculateAccountBalances(accounts, operationalLines)
  const makeRows = (group: AccountGroup): IncomeStatementRow[] =>
    accounts
      .filter((account) => Boolean(account.is_active) && account.account_group === group)
      .map((account) => ({
        accountId: account.id,
        code: account.code,
        name: account.name,
        amount: Math.max(0, accountBalance(account, totals))
      }))
      .filter((row) => row.amount !== 0)

  const revenue = makeRows('REVENUE')
  const expenses = makeRows('EXPENSE')
  const revenueTotal = amount(revenue.reduce((sum, row) => sum + row.amount, 0))
  const expenseTotal = amount(expenses.reduce((sum, row) => sum + row.amount, 0))
  return { revenue, expenses, revenueTotal, expenseTotal, netIncome: amount(revenueTotal - expenseTotal) }
}

export interface BalanceSheetSection {
  rows: { accountId: number; code: string; name: string; amount: number }[]
  total: number
}

export interface BalanceSheetReport {
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection & { unclosedProfit: number }
  balanced: boolean
}

export function buildBalanceSheet(accounts: Account[], lines: (JournalLine & { source?: string })[]): BalanceSheetReport {
  const totals = calculateAccountBalances(accounts, lines)
  const section = (group: AccountGroup): BalanceSheetSection => {
    const rows = accounts
      .filter((account) => Boolean(account.is_active) && account.account_group === group)
      .map((account) => ({
        accountId: account.id,
        code: account.code,
        name: account.name,
        amount: group === 'EQUITY' && account.account_subtype === 'DRAWINGS' ? -accountBalance(account, totals) : accountBalance(account, totals)
      }))
      .filter((row) => row.amount !== 0)
    return { rows, total: amount(rows.reduce((sum, row) => sum + row.amount, 0)) }
  }
  const assets = section('ASSET')
  const liabilities = section('LIABILITY')
  const equity = section('EQUITY')
  const unclosedProfit = buildIncomeStatement(accounts, lines).netIncome
  const totalEquity = amount(equity.total + unclosedProfit)
  return {
    assets,
    liabilities,
    equity: { ...equity, unclosedProfit, total: totalEquity },
    balanced: Math.abs(assets.total - liabilities.total - totalEquity) < MONEY_EPSILON
  }
}

export interface EquityChangesReport {
  opening: number
  capital: number
  drawings: number
  netIncome: number
  closing: number
}

export function buildEquityChanges(accounts: Account[], beforeLines: (JournalLine & { source?: string })[], periodLines: (JournalLine & { source?: string })[]): EquityChangesReport {
  const before = calculateAccountBalances(accounts, beforeLines)
  const period = calculateAccountBalances(accounts, periodLines)
  const equityAccounts = accounts.filter((account) => account.account_group === 'EQUITY' && Boolean(account.is_active))
  const equityTotal = (totals: Map<string, AccountTotal>): number =>
    amount(equityAccounts.reduce((sum, account) => sum + (account.account_subtype === 'DRAWINGS' ? -accountBalance(account, totals) : accountBalance(account, totals)), 0))
  const opening = equityTotal(before)
  const capital = amount(equityAccounts.filter((account) => account.account_subtype === 'OWNER_CAPITAL').reduce((sum, account) => sum + accountBalance(account, period), 0))
  const drawings = amount(-equityAccounts.filter((account) => account.account_subtype === 'DRAWINGS').reduce((sum, account) => sum + accountBalance(account, period), 0))
  const income = buildIncomeStatement(accounts, periodLines).netIncome
  return { opening, capital, drawings, netIncome: income, closing: amount(opening + capital + drawings + income) }
}

export interface CashFlowReport {
  operating: number
  investing: number
  financing: number
  netChange: number
}

export function buildCashFlowDirect(accounts: Account[], entries: (JournalEntry & { lines: JournalLine[] })[]): CashFlowReport {
  const byId = new Map(accounts.map((account) => [String(account.id), account]))
  const groups: Record<string, number> = { OPERATING: 0, INVESTING: 0, FINANCING: 0 }
  for (const entry of entries.filter((item) => item.source !== 'CLOSING')) {
    const cashLines = entry.lines.filter((line) => byId.get(String(line.account_id ?? line.accountId))?.is_cash_account)
    const nonCash = entry.lines.find((line) => !byId.get(String(line.account_id ?? line.accountId))?.is_cash_account)
    const category = byId.get(String(nonCash?.account_id ?? nonCash?.accountId))?.cash_flow_category || 'OPERATING'
    for (const line of cashLines) {
      groups[category] = amount(groups[category] + amount(line.debit) - amount(line.credit))
    }
  }
  return {
    operating: groups.OPERATING,
    investing: groups.INVESTING,
    financing: groups.FINANCING,
    netChange: amount(groups.OPERATING + groups.INVESTING + groups.FINANCING)
  }
}

export function makeClosingLines(accounts: Account[], periodLines: JournalLine[]): (JournalLine & { debit: number; credit: number })[] {
  const totals = calculateAccountBalances(accounts, periodLines)
  const retained = accounts.find((account) => account.account_subtype === 'RETAINED_EARNINGS')
  if (!retained) throw new Error('Akun laba ditahan belum tersedia.')
  const lines: JournalLine[] = []
  for (const account of accounts.filter((item) => ['REVENUE', 'EXPENSE'].includes(item.account_group))) {
    const balance = accountBalance(account, totals)
    if (Math.abs(balance) < MONEY_EPSILON) continue
    if (account.account_group === 'REVENUE') lines.push({ account_id: account.id, debit: balance, credit: 0 })
    else lines.push({ account_id: account.id, debit: 0, credit: balance })
  }
  const debit = amount(lines.reduce((sum, line) => sum + line.debit, 0))
  const credit = amount(lines.reduce((sum, line) => sum + line.credit, 0))
  const difference = amount(debit - credit)
  if (difference > 0) lines.push({ account_id: retained.id, debit: 0, credit: difference })
  if (difference < 0) lines.push({ account_id: retained.id, debit: -difference, credit: 0 })
  return lines.length ? assertBalancedLines(lines) : []
}
