CREATE DATABASE IF NOT EXISTS `finova_akuntansi` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `finova_akuntansi`;

CREATE TABLE IF NOT EXISTS companies (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  address TEXT NULL,
  phone VARCHAR(50) NULL,
  email VARCHAR(150) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  fiscal_year_start TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(150) NOT NULL,
  account_group ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
  account_subtype VARCHAR(50) NULL,
  normal_balance ENUM('DEBIT', 'CREDIT') NOT NULL,
  cash_flow_category ENUM('OPERATING', 'INVESTING', 'FINANCING') NOT NULL DEFAULT 'OPERATING',
  is_cash_account BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_account_code_company (company_id, code),
  CONSTRAINT fk_accounts_company FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  closed_at DATETIME NULL,
  closed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_period_company_dates (company_id, start_date, end_date),
  CONSTRAINT fk_period_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_period_closed_by FOREIGN KEY (closed_by) REFERENCES users(id),
  CONSTRAINT chk_period_dates CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  content_hash CHAR(64) NOT NULL,
  status ENUM('PREVIEW', 'POSTED', 'REJECTED') NOT NULL DEFAULT 'PREVIEW',
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  valid_entries INT UNSIGNED NOT NULL DEFAULT 0,
  payload_json JSON NULL,
  errors_json JSON NULL,
  posted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_import_hash_company (company_id, content_hash),
  CONSTRAINT fk_import_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_import_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  period_id BIGINT UNSIGNED NOT NULL,
  voucher_no VARCHAR(80) NOT NULL,
  entry_date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  source ENUM('MANUAL', 'IMPORT', 'CLOSING', 'REVERSAL') NOT NULL DEFAULT 'MANUAL',
  status ENUM('DRAFT', 'POSTED', 'VOID') NOT NULL DEFAULT 'DRAFT',
  import_batch_id BIGINT UNSIGNED NULL,
  reversal_of_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  posted_by BIGINT UNSIGNED NULL,
  posted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_voucher_company (company_id, voucher_no),
  KEY idx_entries_period_date (company_id, entry_date, status),
  CONSTRAINT fk_entry_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_entry_period FOREIGN KEY (period_id) REFERENCES accounting_periods(id),
  CONSTRAINT fk_entry_import FOREIGN KEY (import_batch_id) REFERENCES import_batches(id),
  CONSTRAINT fk_entry_reversal FOREIGN KEY (reversal_of_id) REFERENCES journal_entries(id),
  CONSTRAINT fk_entry_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_entry_poster FOREIGN KEY (posted_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  memo VARCHAR(255) NULL,
  debit DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit DECIMAL(18,2) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_entry_line (journal_entry_id, line_no),
  KEY idx_lines_account (account_id),
  CONSTRAINT fk_lines_entry FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_lines_account FOREIGN KEY (account_id) REFERENCES accounts(id),
  CONSTRAINT chk_lines_amount CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  company_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_company_created (company_id, created_at),
  CONSTRAINT fk_audit_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
);

INSERT INTO companies (id, name, currency)
VALUES (1, 'Perusahaan Anda', 'IDR')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account) VALUES
  (1, '1100', 'Kas', 'ASSET', 'CASH', 'DEBIT', 'OPERATING', TRUE),
  (1, '1110', 'Bank', 'ASSET', 'BANK', 'DEBIT', 'OPERATING', TRUE),
  (1, '1200', 'Piutang Usaha', 'ASSET', 'RECEIVABLE', 'DEBIT', 'OPERATING', FALSE),
  (1, '1300', 'Persediaan Barang', 'ASSET', 'INVENTORY', 'DEBIT', 'OPERATING', FALSE),
  (1, '1500', 'Peralatan', 'ASSET', 'FIXED_ASSET', 'DEBIT', 'INVESTING', FALSE),
  (1, '2100', 'Utang Usaha', 'LIABILITY', 'PAYABLE', 'CREDIT', 'OPERATING', FALSE),
  (1, '2200', 'Utang Bank', 'LIABILITY', 'LOAN', 'CREDIT', 'FINANCING', FALSE),
  (1, '3100', 'Modal Pemilik', 'EQUITY', 'OWNER_CAPITAL', 'CREDIT', 'FINANCING', FALSE),
  (1, '3200', 'Laba Ditahan', 'EQUITY', 'RETAINED_EARNINGS', 'CREDIT', 'OPERATING', FALSE),
  (1, '3300', 'Prive', 'EQUITY', 'DRAWINGS', 'DEBIT', 'FINANCING', FALSE),
  (1, '4100', 'Pendapatan Jasa', 'REVENUE', 'SERVICE_REVENUE', 'CREDIT', 'OPERATING', FALSE),
  (1, '4200', 'Penjualan Barang', 'REVENUE', 'SALES_REVENUE', 'CREDIT', 'OPERATING', FALSE),
  (1, '5100', 'Beban Pokok Penjualan', 'EXPENSE', 'COGS', 'DEBIT', 'OPERATING', FALSE),
  (1, '5200', 'Beban Gaji', 'EXPENSE', 'SALARY', 'DEBIT', 'OPERATING', FALSE),
  (1, '5300', 'Beban Sewa', 'EXPENSE', 'RENT', 'DEBIT', 'OPERATING', FALSE),
  (1, '5400', 'Beban Utilitas', 'EXPENSE', 'UTILITY', 'DEBIT', 'OPERATING', FALSE),
  (1, '5500', 'Beban Lain-lain', 'EXPENSE', 'OTHER_EXPENSE', 'DEBIT', 'OPERATING', FALSE)
ON DUPLICATE KEY UPDATE code = VALUES(code);
