// Skema database SQLite untuk Finova.
//
// Salinan persis dari src-rust/db/schema.sqlite.sql versi terakhir sebelum
// migrasi ke Bun (2026-10-19). Ditulis sebagai string TypeScript (bukan berkas
// .sql) supaya ikut tertanam otomatis ke biner `bun build --compile` tanpa
// perlu resolver aset runtime.
//
// Catatan: skema ini hanya dijalankan sekali saat bootstrap. Kalau nanti
// butuh migrasi bertahap untuk basis data yang sudah berjalan, tambahkan
// penanda versi di sini JANGAN ubang pernyataan CREATE yang sudah ada.

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

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

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  original_filename TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREVIEW',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_entries INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NULL,
  errors_json TEXT NULL,
  posted_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, content_hash)
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
  import_batch_id INTEGER REFERENCES import_batches(id),
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

CREATE TABLE IF NOT EXISTS journal_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

INSERT OR IGNORE INTO companies (id, name, currency) VALUES (1, 'PT Finova Akuntansi Indonesia', 'IDR');

INSERT OR IGNORE INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account) VALUES
  (1, '1100', 'Kas', 'ASSET', 'CASH', 'DEBIT', 'OPERATING', 1),
  (1, '1110', 'Kas di Bank', 'ASSET', 'BANK', 'DEBIT', 'OPERATING', 1),
  (1, '1200', 'Piutang Usaha', 'ASSET', 'RECEIVABLE', 'DEBIT', 'OPERATING', 0),
  (1, '1210', 'Cadangan Kerugian Piutang', 'ASSET', 'CONTRA_ASSET', 'CREDIT', 'OPERATING', 0),
  (1, '1300', 'Perlengkapan Kantor', 'ASSET', 'SUPPLIES', 'DEBIT', 'OPERATING', 0),
  (1, '1400', 'Asuransi Dibayar Dimuka', 'ASSET', 'PREPAID', 'DEBIT', 'OPERATING', 0),
  (1, '1410', 'Sewa Dibayar Dimuka', 'ASSET', 'PREPAID', 'DEBIT', 'OPERATING', 0),
  (1, '1420', 'Persediaan Barang Dagang', 'ASSET', 'INVENTORY', 'DEBIT', 'OPERATING', 0),
  (1, '1500', 'Peralatan Kantor', 'ASSET', 'FIXED_ASSET', 'DEBIT', 'INVESTING', 0),
  (1, '1510', 'Akumulasi Penyusutan Peralatan', 'ASSET', 'CONTRA_ASSET', 'CREDIT', 'INVESTING', 0),
  (1, '1600', 'Kendaraan Operasional', 'ASSET', 'FIXED_ASSET', 'DEBIT', 'INVESTING', 0),
  (1, '1610', 'Akumulasi Penyusutan Kendaraan', 'ASSET', 'CONTRA_ASSET', 'CREDIT', 'INVESTING', 0),
  (1, '1700', 'Gedung Kantor', 'ASSET', 'FIXED_ASSET', 'DEBIT', 'INVESTING', 0),
  (1, '1710', 'Akumulasi Penyusutan Gedung', 'ASSET', 'CONTRA_ASSET', 'CREDIT', 'INVESTING', 0),
  (1, '1800', 'Tanah', 'ASSET', 'FIXED_ASSET', 'DEBIT', 'INVESTING', 0),
  (1, '2100', 'Utang Usaha', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2110', 'Utang Gaji', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2120', 'Pendapatan Diterima Dimuka', 'LIABILITY', 'UNEARNED_REVENUE', 'CREDIT', 'OPERATING', 0),
  (1, '2130', 'Utang BPJS', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2140', 'Utang PPh 21', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2150', 'Utang Potongan Lain', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', 0),
  (1, '2200', 'Utang Bank', 'LIABILITY', 'LOAN', 'CREDIT', 'FINANCING', 0),
  (1, '3100', 'Modal Pemilik', 'EQUITY', 'OWNER_CAPITAL', 'CREDIT', 'FINANCING', 0),
  (1, '3200', 'Prive Pemilik', 'EQUITY', 'DRAWINGS', 'DEBIT', 'FINANCING', 0),
  (1, '3300', 'Ikhtisar Laba Rugi', 'EQUITY', 'SUMMARY', 'CREDIT', 'OPERATING', 0),
  (1, '3400', 'Laba Ditahan', 'EQUITY', 'RETAINED_EARNINGS', 'CREDIT', 'OPERATING', 0),
  (1, '4100', 'Pendapatan Jasa', 'REVENUE', 'SERVICE_REVENUE', 'CREDIT', 'OPERATING', 0),
  (1, '4200', 'Penjualan Barang Dagang', 'REVENUE', 'SALES_REVENUE', 'CREDIT', 'OPERATING', 0),
  (1, '4300', 'Pendapatan Lain-lain', 'REVENUE', 'OTHER_REVENUE', 'CREDIT', 'OPERATING', 0),
  (1, '5100', 'Beban Pokok Penjualan (HPP)', 'EXPENSE', 'COGS', 'DEBIT', 'OPERATING', 0),
  (1, '5200', 'Beban Gaji & Upah', 'EXPENSE', 'SALARY', 'DEBIT', 'OPERATING', 0),
  (1, '5300', 'Beban Sewa Kantor', 'EXPENSE', 'RENT', 'DEBIT', 'OPERATING', 0),
  (1, '5400', 'Beban Listrik, Air & Internet', 'EXPENSE', 'UTILITY', 'DEBIT', 'OPERATING', 0),
  (1, '5500', 'Beban Perlengkapan', 'EXPENSE', 'SUPPLIES_EXPENSE', 'DEBIT', 'OPERATING', 0),
  (1, '5600', 'Beban Penyusutan Peralatan', 'EXPENSE', 'DEPRECIATION', 'DEBIT', 'OPERATING', 0),
  (1, '5610', 'Beban Penyusutan Kendaraan', 'EXPENSE', 'DEPRECIATION', 'DEBIT', 'OPERATING', 0),
  (1, '5700', 'Beban Asuransi', 'EXPENSE', 'INSURANCE', 'DEBIT', 'OPERATING', 0),
  (1, '5800', 'Beban Iklan & Promosi', 'EXPENSE', 'MARKETING', 'DEBIT', 'OPERATING', 0),
  (1, '5900', 'Beban Operasional Lain-lain', 'EXPENSE', 'OTHER_EXPENSE', 'DEBIT', 'OPERATING', 0);

CREATE TABLE IF NOT EXISTS music_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'YOUTUBE',
  title TEXT NOT NULL,
  artist TEXT NULL,
  youtube_id TEXT NULL,
  thumbnail_url TEXT NULL,
  file_name TEXT NULL,
  file_bytes INTEGER NOT NULL DEFAULT 0,
  duration REAL NULL,
  added_by INTEGER REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_position ON music_tracks(company_id, position, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_music_tracks_youtube
  ON music_tracks(company_id, youtube_id) WHERE youtube_id IS NOT NULL;

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
`
