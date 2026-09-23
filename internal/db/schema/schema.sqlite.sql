-- Skema Database SQLite untuk Finova Akuntansi
-- Tidak membutuhkan MySQL/phpMyAdmin. Berjalan lokal dan otomatis.

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

-- Inisialisasi Perusahaan Default
INSERT OR IGNORE INTO companies (id, name, currency) VALUES (1, 'PT Finova Akuntansi Indonesia', 'IDR');

-- Inisialisasi Bagan Akun Standar Indonesia (Chart of Accounts Edukatif Lengkap)
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

-- ===== Pemutar musik =====
-- Hanya menautkan video YouTube RESMI (tidak menyimpan audio). Berkas audio lokal
-- milik pengguna disimpan di peramban (IndexedDB), bukan di basis data pembukuan ini.
CREATE TABLE IF NOT EXISTS music_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NULL,
  youtube_id TEXT NOT NULL,
  thumbnail_url TEXT NULL,
  added_by INTEGER REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE(company_id, youtube_id)
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_position ON music_tracks(company_id, position, id);
