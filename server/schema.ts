// Skema database SQLite untuk modul Penggajian dan SDM.
// Ditulis sebagai string TypeScript supaya ikut tertanam ke biner `bun build --compile`.
// Skema lama dibiarkan aman; tabel modul yang dihapus tidak lagi digunakan.

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NULL,
  phone TEXT NULL,
  email TEXT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  fiscal_year_start INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_group TEXT NOT NULL,
  account_subtype TEXT NULL,
  normal_balance TEXT NOT NULL,
  cash_flow_category TEXT NOT NULL DEFAULT 'OPERATING',
  is_cash_account INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  closed_at TEXT NULL,
  closed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, start_date, end_date)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES accounting_periods(id),
  voucher_no TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  reversal_of_id INTEGER REFERENCES journal_entries(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  posted_by INTEGER REFERENCES users(id),
  posted_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, voucher_no)
);

CREATE INDEX IF NOT EXISTS idx_entries_period_date ON journal_entries(company_id, entry_date, status);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  line_no INTEGER NOT NULL,
  memo TEXT NULL,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  UNIQUE(journal_entry_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_lines(account_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NULL,
  action TEXT NOT NULL,
  details_json TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_audit_company_created ON audit_logs(company_id, created_at);

-- Bisnis demonstrasi: kafe maid "Maid Caffe Finova" (tema modul SIA).
INSERT OR IGNORE INTO companies (id, name, currency) VALUES (1, 'Maid Caffe Finova', 'IDR');

INSERT OR IGNORE INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account) VALUES
  (1, '1110', 'Kas di Bank', 'ASSET', 'BANK', 'DEBIT', 'OPERATING', 1),
  (1, '2110', 'Utang Gaji', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2130', 'Utang BPJS', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2140', 'Utang PPh 21', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2150', 'Utang Potongan Lain', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '5200', 'Beban Gaji & Upah', 'EXPENSE', 'SALARY', 'DEBIT', 'OPERATING', 0),
  -- Akun siklus pendapatan & pengeluaran (BAB V bagian B dan C).
  (1, '1120', 'Kas di Tangan', 'ASSET', 'CASH', 'DEBIT', 'OPERATING', 1),
  (1, '1130', 'Piutang Usaha', 'ASSET', 'RECEIVABLE', 'DEBIT', 'OPERATING', 0),
  (1, '2120', 'Utang Usaha', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '4100', 'Pendapatan Menu & Layanan', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT', 'OPERATING', 0),
  (1, '5100', 'Beban Bahan & Bahan Habis Pakai', 'EXPENSE', 'MATERIAL', 'DEBIT', 'OPERATING', 0),
  (1, '5300', 'Beban Utilitas & Operasional', 'EXPENSE', 'OPERATING', 'DEBIT', 'OPERATING', 0),
  (1, '5400', 'Beban Kostum & Perlengkapan', 'EXPENSE', 'OPERATING', 'DEBIT', 'OPERATING', 0),
  (1, '5500', 'Beban Jasa & Operasional Lain', 'EXPENSE', 'OPERATING', 'DEBIT', 'OPERATING', 0);

CREATE TABLE IF NOT EXISTS payroll_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_code TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'PKWTT',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  join_date TEXT NOT NULL,
  exit_date TEXT NULL,
  ptkp_status TEXT NOT NULL DEFAULT 'TK0',
  npwp TEXT NULL,
  bank_name TEXT NULL,
  bank_account TEXT NULL,
  basic_salary REAL NOT NULL DEFAULT 0,
  fixed_allowance REAL NOT NULL DEFAULT 0,
  jkk_risk_class INTEGER NOT NULL DEFAULT 1,
  family_members INTEGER NOT NULL DEFAULT 0,
  is_expatriate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, employee_code)
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  pay_date TEXT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT NULL,
  paid_by INTEGER REFERENCES users(id),
  paid_at TEXT NULL,
  accrual_journal_id INTEGER REFERENCES journal_entries(id),
  payment_journal_id INTEGER REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, period)
);

CREATE TABLE IF NOT EXISTS payroll_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES payroll_employees(id),
  absent_days REAL NOT NULL DEFAULT 0,
  overtime_hours REAL NOT NULL DEFAULT 0,
  holiday_overtime_hours REAL NOT NULL DEFAULT 0,
  thr_amount REAL NOT NULL DEFAULT 0,
  other_allowance REAL NOT NULL DEFAULT 0,
  other_deduction REAL NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(period_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES payroll_employees(id),
  version INTEGER NOT NULL DEFAULT 1,
  tax_mode TEXT NOT NULL DEFAULT 'TER',
  tax_category TEXT NOT NULL DEFAULT 'A',
  gross_cash REAL NOT NULL DEFAULT 0,
  overtime_pay REAL NOT NULL DEFAULT 0,
  thr_amount REAL NOT NULL DEFAULT 0,
  other_allowance REAL NOT NULL DEFAULT 0,
  bpjs_kesehatan_employee REAL NOT NULL DEFAULT 0,
  bpjs_kesehatan_employer REAL NOT NULL DEFAULT 0,
  jht_employee REAL NOT NULL DEFAULT 0,
  jht_employer REAL NOT NULL DEFAULT 0,
  jp_employee REAL NOT NULL DEFAULT 0,
  jp_employer REAL NOT NULL DEFAULT 0,
  jkk_employer REAL NOT NULL DEFAULT 0,
  jkm_employer REAL NOT NULL DEFAULT 0,
  tax_bruto REAL NOT NULL DEFAULT 0,
  pph21 REAL NOT NULL DEFAULT 0,
  other_deduction REAL NOT NULL DEFAULT 0,
  net_pay REAL NOT NULL DEFAULT 0,
  employer_contribution REAL NOT NULL DEFAULT 0,
  employer_cost REAL NOT NULL DEFAULT 0,
  calculation_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(period_id, employee_id, version)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(company_id, period_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_inputs_period ON payroll_inputs(company_id, period_id);

-- Bagian E BAB V.pptx: aktivitas a (perubahan data disetujui), dokumen
-- (slide 28), dan pengendalian internal (slide 30).
CREATE TABLE IF NOT EXISTS payroll_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_by_role TEXT NOT NULL DEFAULT 'SDM',
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT NULL,
  decision_note TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_payroll_change_requests_status
  ON payroll_change_requests(company_id, status);

CREATE TABLE IF NOT EXISTS payroll_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  reference_no TEXT NOT NULL DEFAULT '',
  doc_date TEXT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  note TEXT NULL,
  file_name TEXT NULL,
  file_original TEXT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NULL,
  uploaded_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, period_id, doc_type)
);

CREATE TABLE IF NOT EXISTS payroll_control_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expected_value REAL NOT NULL DEFAULT 0,
  actual_value REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DONE',
  operator_id INTEGER REFERENCES users(id),
  operator_role TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  note TEXT NULL,
  UNIQUE(company_id, period_id, kind)
);

-- ============================================================
-- Bagian B BAB V.pptx: Siklus Pendapatan (Revenue Cycle).
-- Alur: pesanan penjualan -> penyajian -> faktur (tunai/kredit)
--       -> penerimaan kas -> setoran bank.
-- ============================================================

CREATE TABLE IF NOT EXISTS revenue_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_code TEXT NOT NULL,
  name TEXT NOT NULL,
  customer_type TEXT NOT NULL DEFAULT 'TUNAI',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  credit_limit REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, customer_code)
);

CREATE TABLE IF NOT EXISTS revenue_menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'MINUMAN',
  unit_price REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, item_code)
);

CREATE TABLE IF NOT EXISTS revenue_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_no TEXT NOT NULL,
  order_date TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES revenue_customers(id),
  order_type TEXT NOT NULL DEFAULT 'DINE_IN',
  payment_type TEXT NOT NULL DEFAULT 'TUNAI',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  served_at TEXT NULL,
  served_note TEXT NULL,
  credit_approved_by INTEGER REFERENCES users(id),
  credit_approved_at TEXT NULL,
  credit_approval_note TEXT NULL,
  notes TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, order_no)
);

CREATE INDEX IF NOT EXISTS idx_revenue_orders_customer ON revenue_orders(company_id, customer_id, status);

CREATE TABLE IF NOT EXISTS revenue_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES revenue_orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES revenue_menu_items(id),
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  UNIQUE(order_id, description)
);

CREATE TABLE IF NOT EXISTS revenue_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_no TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES revenue_orders(id),
  customer_id INTEGER NOT NULL REFERENCES revenue_customers(id),
  amount REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  due_date TEXT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  accrual_journal_id INTEGER REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, invoice_no)
);

CREATE INDEX IF NOT EXISTS idx_revenue_invoices_customer ON revenue_invoices(company_id, customer_id, status);

CREATE TABLE IF NOT EXISTS revenue_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL,
  receipt_date TEXT NOT NULL,
  invoice_id INTEGER NOT NULL REFERENCES revenue_invoices(id),
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'BANK',
  deposit_status TEXT NOT NULL DEFAULT 'NOT_DEPOSITED',
  deposited_at TEXT NULL,
  deposit_reference TEXT NULL,
  payment_journal_id INTEGER REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, receipt_no)
);

CREATE TABLE IF NOT EXISTS revenue_control_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  kind TEXT NOT NULL,
  expected_value REAL NOT NULL DEFAULT 0,
  actual_value REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DONE',
  operator_id INTEGER REFERENCES users(id),
  operator_role TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  note TEXT NULL,
  UNIQUE(company_id, period, kind)
);

-- ============================================================
-- Bagian C BAB V.pptx: Siklus Pengeluaran (Expenditure Cycle).
-- Alur: permintaan pembelian -> pesanan pembelian -> penerimaan
--       barang -> faktur pemasok (three-way match) -> pembayaran.
-- ============================================================

CREATE TABLE IF NOT EXISTS purchase_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'BAHAN_BAKU',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  is_trusted INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, supplier_code)
);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requisition_no TEXT NOT NULL,
  requisition_date TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'DAPUR',
  requested_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT NULL,
  decision_note TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, requisition_no)
);

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requisition_id INTEGER NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  est_price REAL NOT NULL DEFAULT 0,
  est_total REAL NOT NULL DEFAULT 0,
  UNIQUE(requisition_id, description)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_no TEXT NOT NULL,
  order_date TEXT NOT NULL,
  requisition_id INTEGER NOT NULL REFERENCES purchase_requisitions(id),
  supplier_id INTEGER NOT NULL REFERENCES purchase_suppliers(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  total REAL NOT NULL DEFAULT 0,
  notes TEXT NULL,
  sent_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, order_no)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  UNIQUE(order_id, description)
);

CREATE TABLE IF NOT EXISTS purchase_goods_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL,
  receipt_date TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  accepted_total REAL NOT NULL DEFAULT 0,
  condition_note TEXT NULL,
  checked_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, receipt_no)
);

CREATE TABLE IF NOT EXISTS purchase_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bill_no TEXT NOT NULL,
  bill_date TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  supplier_id INTEGER NOT NULL REFERENCES purchase_suppliers(id),
  supplier_invoice_no TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'PENDING',
  status TEXT NOT NULL DEFAULT 'OPEN',
  ap_journal_id INTEGER REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, bill_no)
);

CREATE TABLE IF NOT EXISTS purchase_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payment_no TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  bill_id INTEGER NOT NULL REFERENCES purchase_bills(id),
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'BANK',
  reference_no TEXT NOT NULL DEFAULT '',
  payment_journal_id INTEGER REFERENCES journal_entries(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, payment_no)
);

CREATE TABLE IF NOT EXISTS expenditure_control_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  kind TEXT NOT NULL,
  expected_value REAL NOT NULL DEFAULT 0,
  actual_value REAL NOT NULL DEFAULT 0,
  difference REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DONE',
  operator_id INTEGER REFERENCES users(id),
  operator_role TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  note TEXT NULL,
  UNIQUE(company_id, period, kind)
);
`
