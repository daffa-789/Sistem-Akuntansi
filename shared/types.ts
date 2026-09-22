// Tipe Data Domain Bersama (Shared Types) untuk Finova Akuntansi

export type AccountGroup = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
export type NormalBalance = 'DEBIT' | 'CREDIT'
export type CashFlowCategory = 'OPERATING' | 'INVESTING' | 'FINANCING' | 'NON_CASH'
export type JournalStatus = 'DRAFT' | 'POSTED' | 'REVERSED'
export type JournalSource = 'MANUAL' | 'IMPORT' | 'CLOSING' | 'REVERSAL'
export type PeriodStatus = 'OPEN' | 'CLOSED'
export type UserRole = 'ADMIN' | 'STAFF' | 'ACCOUNTANT' | 'VIEWER' | string

export interface Company {
  id: number
  name: string
  address?: string | null
  phone?: string | null
  email?: string | null
  currency: string
  fiscal_year_start: number
  created_at?: string
  updated_at?: string
}

export interface User {
  id: number
  company_id: number
  name: string
  email: string
  // Kolom tidak dipakai: aplikasi berjalan tanpa login. Baris ini tetap ada karena
  // journal_entries.created_by NOT NULL REFERENCES users(id).
  password_hash?: string
  role: UserRole
  is_active: number | boolean
  created_at?: string
  updated_at?: string
}

export interface Account {
  id: number
  company_id: number
  code: string
  name: string
  account_group: AccountGroup
  account_subtype?: string | null
  normal_balance: NormalBalance
  cash_flow_category?: CashFlowCategory | string | null
  is_cash_account: number | boolean
  is_active: number | boolean
  created_at?: string
  updated_at?: string
}

export interface AccountingPeriod {
  id: number
  company_id: number
  name: string
  start_date: string
  end_date: string
  status: PeriodStatus
  closed_at?: string | null
  closed_by?: number | null
  created_at?: string
}

export interface JournalLine {
  id?: number
  journal_entry_id?: number
  account_id?: number
  accountId?: number
  line_no?: number
  memo?: string | null
  debit: number
  credit: number
  code?: string
  account_code?: string
  accountCode?: string
  account_name?: string
  accountName?: string
  account_group?: AccountGroup
  line_desc?: string
}

export interface JournalEntry {
  id: number
  company_id: number
  period_id: number
  voucher_no: string
  entry_date: string
  description: string
  source: JournalSource
  status: JournalStatus
  import_batch_id?: number | null
  reversal_of_id?: number | null
  created_by: number
  posted_by?: number | null
  posted_at?: string | null
  created_at?: string
  updated_at?: string
  creator_name?: string
  poster_name?: string
  lines?: JournalLine[]
  debit_total?: number
  credit_total?: number
}

export interface JournalTemplate {
  id: number
  company_id: number
  name: string
  description: string
  lines_json: string
  created_by: number
  created_at?: string
}

export interface AuditLog {
  id: number
  company_id: number
  user_id?: number | null
  user_name?: string | null
  entity_type: string
  entity_id?: number | null
  action: string
  details_json?: string | null
  created_at: string
}

export interface ImportBatch {
  id: number
  company_id: number
  uploaded_by: number
  original_filename: string
  content_hash: string
  status: string
  total_rows: number
  valid_entries: number
  payload_json?: string | null
  errors_json?: string | null
  posted_at?: string | null
  created_at: string
}

// Financial Report Types
export interface TrialBalanceRow {
  accountId: number
  code: string
  name: string
  group: AccountGroup
  debit: number
  credit: number
  signedBalance: number
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[]
  totals: {
    debit: number
    credit: number
  }
  isBalanced: boolean
}

export interface FinancialStatementItem {
  code: string
  name: string
  amount: number
}

export interface IncomeStatementData {
  revenues: FinancialStatementItem[]
  expenses: FinancialStatementItem[]
  totalRevenue: number
  totalExpense: number
  netIncome: number
}

export interface BalanceSheetData {
  assets: FinancialStatementItem[]
  liabilities: FinancialStatementItem[]
  equities: FinancialStatementItem[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  isBalanced: boolean
}

export interface CashFlowLine {
  description: string
  amount: number
}

export interface CashFlowData {
  operating: CashFlowLine[]
  investing: CashFlowLine[]
  financing: CashFlowLine[]
  netOperating: number
  netInvesting: number
  netFinancing: number
  netChange: number
  beginningCash: number
  endingCash: number
}

export interface EquityChangesData {
  beginningEquity: number
  netIncome: number
  drawings: number
  endingEquity: number
  items: FinancialStatementItem[]
}

export interface LedgerEntry {
  date: string
  voucherNo: string
  description: string
  debit: number
  credit: number
  balance: number
}

export interface LedgerReport {
  account: Account
  entries: LedgerEntry[]
  startingBalance: number
  endingBalance: number
}
