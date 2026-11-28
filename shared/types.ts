// Tipe Data Domain Bersama (Shared Types) untuk Finova Akuntansi

export type AccountGroup = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
export type NormalBalance = 'DEBIT' | 'CREDIT'
export type CashFlowCategory = 'OPERATING' | 'INVESTING' | 'FINANCING' | 'NON_CASH'
export type JournalStatus = 'DRAFT' | 'POSTED' | 'REVERSED'
export type JournalSource = 'MANUAL' | 'IMPORT' | 'CLOSING' | 'REVERSAL' | 'PAYROLL' | 'REVENUE' | 'EXPENDITURE'
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

// ===== Siklus Pendapatan (BAB V bagian B) =====

export type CustomerType = 'TUNAI' | 'MEMBER' | 'KORPORAT'
export type MenuCategory = 'MINUMAN' | 'MAKANAN' | 'DESSERT' | 'PAKET_EVENT' | 'MERCH'
export type OrderType = 'DINE_IN' | 'TAKE_AWAY' | 'CATERING' | 'EVENT'
export type OrderPaymentType = 'TUNAI' | 'KREDIT'
/** DRAFT -> DITERIMA -> DISAJIKAN -> DIFAKTURKAN (atau DIBATALKAN). */
export type OrderStatus = 'DRAFT' | 'DITERIMA' | 'DISAJIKAN' | 'DIFAKTURKAN' | 'DIBATALKAN'
export type ReceiptMethod = 'KAS' | 'BANK'
export type DepositStatus = 'NOT_DEPOSITED' | 'DEPOSITED'

export interface RevenueCustomer {
  id: number
  company_id: number
  customer_code: string
  name: string
  customer_type: CustomerType
  phone: string
  address: string
  credit_limit: number
  is_active: number | boolean
  created_at?: string
  updated_at?: string
}

export interface RevenueMenuItem {
  id: number
  company_id: number
  item_code: string
  name: string
  category: MenuCategory
  unit_price: number
  is_active: number | boolean
  created_at?: string
  updated_at?: string
}

export interface RevenueOrderItem {
  id?: number
  order_id?: number
  menu_item_id?: number | null
  description: string
  qty: number
  unit_price: number
  line_total: number
}

export interface RevenueOrder {
  id: number
  company_id: number
  order_no: string
  order_date: string
  customer_id: number
  customer_name?: string
  order_type: OrderType
  payment_type: OrderPaymentType
  status: OrderStatus
  served_at?: string | null
  served_note?: string | null
  credit_approved_by?: number | null
  credit_approved_at?: string | null
  credit_approval_note?: string | null
  notes?: string | null
  total?: number
  items?: RevenueOrderItem[]
  created_at?: string
  updated_at?: string
}

export interface RevenueInvoice {
  id: number
  company_id: number
  invoice_no: string
  invoice_date: string
  order_id: number
  order_no?: string
  customer_id: number
  customer_name?: string
  customer_type?: CustomerType
  payment_type?: OrderPaymentType
  amount: number
  paid: number
  due_date?: string | null
  status: 'OPEN' | 'PAID'
  accrual_journal_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface RevenueReceipt {
  id: number
  company_id: number
  receipt_no: string
  receipt_date: string
  invoice_id: number
  invoice_no?: string
  amount: number
  method: ReceiptMethod
  deposit_status: DepositStatus
  deposited_at?: string | null
  deposit_reference?: string | null
  payment_journal_id?: number | null
  created_at?: string
}

// ===== Siklus Pengeluaran (BAB V bagian C) =====

export type SupplierCategory = 'BAHAN_BAKU' | 'KOSTUM' | 'UTILITY' | 'JASA'
/** DRAFT -> DIKIRIM -> SELESAI (atau DIBATALKAN). */
export type PurchaseOrderStatus = 'DRAFT' | 'DIKIRIM' | 'SELESAI' | 'DIBATALKAN'
export type BillMatchStatus = 'PENDING' | 'MATCHED' | 'MISMATCH'

export interface PurchaseSupplier {
  id: number
  company_id: number
  supplier_code: string
  name: string
  category: SupplierCategory
  phone: string
  address: string
  is_trusted: number | boolean
  is_active: number | boolean
  created_at?: string
  updated_at?: string
}

export interface PurchaseRequisitionItem {
  id?: number
  requisition_id?: number
  description: string
  qty: number
  est_price: number
  est_total: number
}

export interface PurchaseRequisition {
  id: number
  company_id: number
  requisition_no: string
  requisition_date: string
  department: string
  requested_by: string
  reason: string
  status: 'DRAFT' | 'APPROVED' | 'REJECTED'
  approved_by?: number | null
  approved_at?: string | null
  decision_note?: string | null
  estimated_total?: number
  items?: PurchaseRequisitionItem[]
  created_at?: string
  updated_at?: string
}

export interface PurchaseOrderItem {
  id?: number
  order_id?: number
  description: string
  qty: number
  unit_price: number
  line_total: number
}

export interface PurchaseOrder {
  id: number
  company_id: number
  order_no: string
  order_date: string
  requisition_id: number
  requisition_no?: string
  supplier_id: number
  supplier_name?: string
  supplier_category?: SupplierCategory
  status: PurchaseOrderStatus
  total: number
  notes?: string | null
  sent_at?: string | null
  items?: PurchaseOrderItem[]
  created_at?: string
  updated_at?: string
}

export interface PurchaseGoodsReceipt {
  id: number
  company_id: number
  receipt_no: string
  receipt_date: string
  order_id: number
  order_no?: string
  accepted_total: number
  condition_note?: string | null
  checked_by: string
  created_at?: string
}

export interface PurchaseBill {
  id: number
  company_id: number
  bill_no: string
  bill_date: string
  order_id: number
  order_no?: string
  supplier_id: number
  supplier_name?: string
  supplier_invoice_no: string
  amount: number
  paid: number
  match_status: BillMatchStatus
  status: 'OPEN' | 'PAID'
  ap_journal_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface PurchasePayment {
  id: number
  company_id: number
  payment_no: string
  payment_date: string
  bill_id: number
  bill_no?: string
  amount: number
  method: ReceiptMethod
  reference_no: string
  payment_journal_id?: number | null
  created_at?: string
}
