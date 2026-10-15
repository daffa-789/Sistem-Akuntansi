// React Accounting Backend Engine (Local & In-Memory with LocalStorage Persistence)
// Finova — Sistem Akuntansi Web Terpadu Indonesia

const STORAGE_KEY = 'finova_accounting_data_v2'
const MUSIC_STORAGE_KEY = 'finova_music_tracks_v2'

export const INITIAL_COMPANY = {
  id: 1,
  name: 'PT Finova Akuntansi Indonesia',
  address: 'Jl. Jenderal Sudirman No. 45, Jakarta Pusat, DKI Jakarta',
  phone: '021-5550192',
  email: 'keuangan@finova.co.id',
  currency: 'IDR',
  fiscal_year_start: 1,
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00'
}

export const INITIAL_ACCOUNTS = [
  { id: 1, company_id: 1, code: '1100', name: 'Kas', account_group: 'ASSET', account_subtype: 'CASH', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 1, is_active: 1 },
  { id: 2, company_id: 1, code: '1110', name: 'Kas di Bank', account_group: 'ASSET', account_subtype: 'BANK', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 1, is_active: 1 },
  { id: 3, company_id: 1, code: '1200', name: 'Piutang Usaha', account_group: 'ASSET', account_subtype: 'RECEIVABLE', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 4, company_id: 1, code: '1210', name: 'Cadangan Kerugian Piutang', account_group: 'ASSET', account_subtype: 'CONTRA_ASSET', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 5, company_id: 1, code: '1300', name: 'Perlengkapan Kantor', account_group: 'ASSET', account_subtype: 'SUPPLIES', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 6, company_id: 1, code: '1400', name: 'Asuransi Dibayar Dimuka', account_group: 'ASSET', account_subtype: 'PREPAID', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 7, company_id: 1, code: '1410', name: 'Sewa Dibayar Dimuka', account_group: 'ASSET', account_subtype: 'PREPAID', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 8, company_id: 1, code: '1420', name: 'Persediaan Barang Dagang', account_group: 'ASSET', account_subtype: 'INVENTORY', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 9, company_id: 1, code: '1500', name: 'Peralatan Kantor', account_group: 'ASSET', account_subtype: 'FIXED_ASSET', normal_balance: 'DEBIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 10, company_id: 1, code: '1510', name: 'Akumulasi Penyusutan Peralatan', account_group: 'ASSET', account_subtype: 'CONTRA_ASSET', normal_balance: 'CREDIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 11, company_id: 1, code: '1600', name: 'Kendaraan Operasional', account_group: 'ASSET', account_subtype: 'FIXED_ASSET', normal_balance: 'DEBIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 12, company_id: 1, code: '1610', name: 'Akumulasi Penyusutan Kendaraan', account_group: 'ASSET', account_subtype: 'CONTRA_ASSET', normal_balance: 'CREDIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 13, company_id: 1, code: '1700', name: 'Gedung Kantor', account_group: 'ASSET', account_subtype: 'FIXED_ASSET', normal_balance: 'DEBIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 14, company_id: 1, code: '1710', name: 'Akumulasi Penyusutan Gedung', account_group: 'ASSET', account_subtype: 'CONTRA_ASSET', normal_balance: 'CREDIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 15, company_id: 1, code: '1800', name: 'Tanah', account_group: 'ASSET', account_subtype: 'FIXED_ASSET', normal_balance: 'DEBIT', cash_flow_category: 'INVESTING', is_cash_account: 0, is_active: 1 },
  { id: 16, company_id: 1, code: '2100', name: 'Utang Usaha', account_group: 'LIABILITY', account_subtype: 'PAYABLE', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 17, company_id: 1, code: '2110', name: 'Utang Gaji', account_group: 'LIABILITY', account_subtype: 'PAYABLE', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 18, company_id: 1, code: '2120', name: 'Pendapatan Diterima Dimuka', account_group: 'LIABILITY', account_subtype: 'UNEARNED_REVENUE', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 19, company_id: 1, code: '2200', name: 'Utang Bank', account_group: 'LIABILITY', account_subtype: 'LOAN', normal_balance: 'CREDIT', cash_flow_category: 'FINANCING', is_cash_account: 0, is_active: 1 },
  { id: 20, company_id: 1, code: '3100', name: 'Modal Pemilik', account_group: 'EQUITY', account_subtype: 'OWNER_CAPITAL', normal_balance: 'CREDIT', cash_flow_category: 'FINANCING', is_cash_account: 0, is_active: 1 },
  { id: 21, company_id: 1, code: '3200', name: 'Prive Pemilik', account_group: 'EQUITY', account_subtype: 'DRAWINGS', normal_balance: 'DEBIT', cash_flow_category: 'FINANCING', is_cash_account: 0, is_active: 1 },
  { id: 22, company_id: 1, code: '3300', name: 'Ikhtisar Laba Rugi', account_group: 'EQUITY', account_subtype: 'SUMMARY', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 23, company_id: 1, code: '3400', name: 'Laba Ditahan', account_group: 'EQUITY', account_subtype: 'RETAINED_EARNINGS', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 24, company_id: 1, code: '4100', name: 'Pendapatan Jasa', account_group: 'REVENUE', account_subtype: 'SERVICE_REVENUE', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 25, company_id: 1, code: '4200', name: 'Penjualan Barang Dagang', account_group: 'REVENUE', account_subtype: 'SALES_REVENUE', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 26, company_id: 1, code: '4300', name: 'Pendapatan Lain-lain', account_group: 'REVENUE', account_subtype: 'OTHER_REVENUE', normal_balance: 'CREDIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 27, company_id: 1, code: '5100', name: 'Beban Pokok Penjualan (HPP)', account_group: 'EXPENSE', account_subtype: 'COGS', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 28, company_id: 1, code: '5200', name: 'Beban Gaji & Upah', account_group: 'EXPENSE', account_subtype: 'SALARY', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 29, company_id: 1, code: '5300', name: 'Beban Sewa Kantor', account_group: 'EXPENSE', account_subtype: 'RENT', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 30, company_id: 1, code: '5400', name: 'Beban Listrik, Air & Internet', account_group: 'EXPENSE', account_subtype: 'UTILITY', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 31, company_id: 1, code: '5500', name: 'Beban Perlengkapan', account_group: 'EXPENSE', account_subtype: 'SUPPLIES_EXPENSE', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 32, company_id: 1, code: '5600', name: 'Beban Penyusutan Peralatan', account_group: 'EXPENSE', account_subtype: 'DEPRECIATION', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 33, company_id: 1, code: '5610', name: 'Beban Penyusutan Kendaraan', account_group: 'EXPENSE', account_subtype: 'DEPRECIATION', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 34, company_id: 1, code: '5700', name: 'Beban Asuransi', account_group: 'EXPENSE', account_subtype: 'INSURANCE', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 35, company_id: 1, code: '5800', name: 'Beban Iklan & Promosi', account_group: 'EXPENSE', account_subtype: 'MARKETING', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 },
  { id: 36, company_id: 1, code: '5900', name: 'Beban Operasional Lain-lain', account_group: 'EXPENSE', account_subtype: 'OTHER_EXPENSE', normal_balance: 'DEBIT', cash_flow_category: 'OPERATING', is_cash_account: 0, is_active: 1 }
]

export const INITIAL_PERIODS = [
  { id: 1, company_id: 1, name: 'Periode Berjalan 2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'OPEN', created_at: '2026-01-01 00:00:00' }
]

export const INITIAL_TEMPLATES = [
  {
    id: 1,
    name: 'Setoran Modal Pemilik',
    description: 'Setoran modal tunai oleh pemilik ke kas perusahaan',
    lines: [
      { account_id: 1, code: '1100', account_name: 'Kas', debit: 0, credit: 0, memo: 'Penerimaan modal tunai' },
      { account_id: 20, code: '3100', account_name: 'Modal Pemilik', debit: 0, credit: 0, memo: 'Penyetoran modal pemilik' }
    ]
  },
  {
    id: 2,
    name: 'Pembayaran Beban Gaji Karyawan',
    description: 'Pembayaran rutin gaji staf via rekening bank',
    lines: [
      { account_id: 28, code: '5200', account_name: 'Beban Gaji & Upah', debit: 0, credit: 0, memo: 'Beban gaji staf' },
      { account_id: 2, code: '1110', account_name: 'Kas di Bank', debit: 0, credit: 0, memo: 'Pembayaran transfer bank' }
    ]
  },
  {
    id: 3,
    name: 'Penerimaan Pendapatan Jasa Tunai',
    description: 'Penerimaan kas langsung atas penyelesaian jasa klien',
    lines: [
      { account_id: 1, code: '1100', account_name: 'Kas', debit: 0, credit: 0, memo: 'Penerimaan pendapatan jasa tunai' },
      { account_id: 24, code: '4100', account_name: 'Pendapatan Jasa', debit: 0, credit: 0, memo: 'Jasa konsultasi/akuntansi' }
    ]
  },
  {
    id: 4,
    name: 'Pembelian Perlengkapan Kantor Tunai',
    description: 'Pembelian alat tulis dan perlengkapan operasional kantor',
    lines: [
      { account_id: 5, code: '1300', account_name: 'Perlengkapan Kantor', debit: 0, credit: 0, memo: 'Beli ATK dan perlengkapan' },
      { account_id: 1, code: '1100', account_name: 'Kas', debit: 0, credit: 0, memo: 'Kas keluar operasional' }
    ]
  }
]

export const INITIAL_JOURNAL_ENTRIES = [
  {
    id: 1,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0001',
    entry_date: '2026-10-01',
    description: 'Penyetoran modal awal tunai dan transfer ke bank oleh pemilik usaha',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-01 08:30:00',
    created_at: '2026-10-01 08:30:00',
    updated_at: '2026-10-01 08:30:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 1, journal_entry_id: 1, account_id: 1, line_no: 1, code: '1100', account_name: 'Kas', debit: 25000000, credit: 0, memo: 'Kas operasional awal' },
      { id: 2, journal_entry_id: 1, account_id: 2, line_no: 2, code: '1110', account_name: 'Kas di Bank', debit: 125000000, credit: 0, memo: 'Setoran modal ke rekening giro bank' },
      { id: 3, journal_entry_id: 1, account_id: 20, line_no: 3, code: '3100', account_name: 'Modal Pemilik', debit: 0, credit: 150000000, memo: 'Modal disetor pendirian usaha' }
    ]
  },
  {
    id: 2,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0002',
    entry_date: '2026-10-03',
    description: 'Pembayaran sewa ruang kantor untuk 1 tahun ke depan via bank',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-03 10:15:00',
    created_at: '2026-10-03 10:15:00',
    updated_at: '2026-10-03 10:15:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 4, journal_entry_id: 2, account_id: 7, line_no: 1, code: '1410', account_name: 'Sewa Dibayar Dimuka', debit: 24000000, credit: 0, memo: 'Sewa kantor 12 bulan' },
      { id: 5, journal_entry_id: 2, account_id: 2, line_no: 2, code: '1110', account_name: 'Kas di Bank', debit: 0, credit: 24000000, memo: 'Transfer sewa kantor' }
    ]
  },
  {
    id: 3,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0003',
    entry_date: '2026-10-05',
    description: 'Pembelian peralatan komputer dan meja kantor secara kredit dari CV Mitra Sukses',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-05 14:00:00',
    created_at: '2026-10-05 14:00:00',
    updated_at: '2026-10-05 14:00:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 6, journal_entry_id: 3, account_id: 9, line_no: 1, code: '1500', account_name: 'Peralatan Kantor', debit: 18500000, credit: 0, memo: '3 unit PC & meja kerja' },
      { id: 7, journal_entry_id: 3, account_id: 16, line_no: 2, code: '2100', account_name: 'Utang Usaha', debit: 0, credit: 18500000, memo: 'Faktur CV Mitra Sukses tempo 30 hari' }
    ]
  },
  {
    id: 4,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0004',
    entry_date: '2026-10-08',
    description: 'Pembelian perlengkapan kantor (ATK, map, toner) tunai dari kas kecil',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-08 11:20:00',
    created_at: '2026-10-08 11:20:00',
    updated_at: '2026-10-08 11:20:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 8, journal_entry_id: 4, account_id: 5, line_no: 1, code: '1300', account_name: 'Perlengkapan Kantor', debit: 2750000, credit: 0, memo: 'Pembelian perlengkapan ATK' },
      { id: 9, journal_entry_id: 4, account_id: 1, line_no: 2, code: '1100', account_name: 'Kas', debit: 0, credit: 2750000, memo: 'Kas keluar nota pembelian' }
    ]
  },
  {
    id: 5,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0005',
    entry_date: '2026-10-10',
    description: 'Penerimaan pendapatan jasa implementasi sistem akuntansi klien PT Nusantara Sejahtera',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-10 16:45:00',
    created_at: '2026-10-10 16:45:00',
    updated_at: '2026-10-10 16:45:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 10, journal_entry_id: 5, account_id: 2, line_no: 1, code: '1110', account_name: 'Kas di Bank', debit: 38500000, credit: 0, memo: 'Transfer pembayaran jasa implementasi' },
      { id: 11, journal_entry_id: 5, account_id: 24, line_no: 2, code: '4100', account_name: 'Pendapatan Jasa', debit: 0, credit: 38500000, memo: 'Pendapatan proyek PT Nusantara Sejahtera' }
    ]
  },
  {
    id: 6,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0006',
    entry_date: '2026-10-12',
    description: 'Penerbitan tagihan jasa konsultasi keuangan kepada CV Bintang Abadi (Piutang)',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-12 13:00:00',
    created_at: '2026-10-12 13:00:00',
    updated_at: '2026-10-12 13:00:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 12, journal_entry_id: 6, account_id: 3, line_no: 1, code: '1200', account_name: 'Piutang Usaha', debit: 15000000, credit: 0, memo: 'Invoice #INV-2026-001 tempo 14 hari' },
      { id: 13, journal_entry_id: 6, account_id: 24, line_no: 2, code: '4100', account_name: 'Pendapatan Jasa', debit: 0, credit: 15000000, memo: 'Pendapatan konsultasi pajak & akuntansi' }
    ]
  },
  {
    id: 7,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0007',
    entry_date: '2026-10-14',
    description: 'Pembayaran sebagian utang usaha kepada CV Mitra Sukses via transfer bank',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-14 09:30:00',
    created_at: '2026-10-14 09:30:00',
    updated_at: '2026-10-14 09:30:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 14, journal_entry_id: 7, account_id: 16, line_no: 1, code: '2100', account_name: 'Utang Usaha', debit: 10000000, credit: 0, memo: 'Pelunasan termin 1 utang peralatan' },
      { id: 15, journal_entry_id: 7, account_id: 2, line_no: 2, code: '1110', account_name: 'Kas di Bank', debit: 0, credit: 10000000, memo: 'Transfer via bank' }
    ]
  },
  {
    id: 8,
    company_id: 1,
    period_id: 1,
    voucher_no: 'JV-202610-0008',
    entry_date: '2026-10-15',
    description: 'Pembayaran beban listrik, air PDAM dan langganan internet kantor bulan berjalan',
    source: 'MANUAL',
    status: 'POSTED',
    created_by: 1,
    posted_by: 1,
    posted_at: '2026-10-15 15:00:00',
    created_at: '2026-10-15 15:00:00',
    updated_at: '2026-10-15 15:00:00',
    creator_name: 'Staf Keuangan',
    poster_name: 'Pimpinan Finova',
    lines: [
      { id: 16, journal_entry_id: 8, account_id: 30, line_no: 1, code: '5400', account_name: 'Beban Listrik, Air & Internet', debit: 2350000, credit: 0, memo: 'Beban utilitas operasional kantor' },
      { id: 17, journal_entry_id: 8, account_id: 1, line_no: 2, code: '1100', account_name: 'Kas', debit: 0, credit: 2350000, memo: 'Pembayaran tunai via kas' }
    ]
  }
]

export const INITIAL_AUDIT_LOGS = [
  { id: 1, company_id: 1, user_id: 1, entity_type: 'JOURNAL', entity_id: 1, action: 'CREATE', details_json: JSON.stringify({ voucher_no: 'JV-202610-0001', total: 150000000 }), created_at: '2026-10-01 08:30:00' },
  { id: 2, company_id: 1, user_id: 1, entity_type: 'JOURNAL', entity_id: 1, action: 'POST', details_json: JSON.stringify({ voucher_no: 'JV-202610-0001', status: 'POSTED' }), created_at: '2026-10-01 08:30:00' },
  { id: 3, company_id: 1, user_id: 1, entity_type: 'JOURNAL', entity_id: 5, action: 'CREATE', details_json: JSON.stringify({ voucher_no: 'JV-202610-0005', total: 38500000 }), created_at: '2026-10-10 16:45:00' },
  { id: 4, company_id: 1, user_id: 1, entity_type: 'JOURNAL', entity_id: 5, action: 'POST', details_json: JSON.stringify({ voucher_no: 'JV-202610-0005', status: 'POSTED' }), created_at: '2026-10-10 16:45:00' }
]

export const INITIAL_MUSIC_TRACKS = [
  {
    id: 1,
    company_id: 1,
    kind: 'YOUTUBE',
    title: 'Lofi Hip Hop Radio - Beats to Relax/Study to',
    artist: 'Lofi Girl',
    youtube_id: 'jfKfPfyJRdk',
    thumbnail_url: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg',
    position: 0,
    created_at: '2026-10-01 10:00:00'
  },
  {
    id: 2,
    company_id: 1,
    kind: 'YOUTUBE',
    title: 'Peaceful Piano Music for Focus & Coding',
    artist: 'Relaxing Music',
    youtube_id: '4xDzrJKXOOY',
    thumbnail_url: 'https://img.youtube.com/vi/4xDzrJKXOOY/hqdefault.jpg',
    position: 1,
    created_at: '2026-10-01 10:05:00'
  }
]

class AccountingEngine {
  constructor() {
    this.state = this.loadState()
  }

  loadState() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && parsed.company && Array.isArray(parsed.accounts) && Array.isArray(parsed.journals)) {
            return parsed
          }
        }
      }
    } catch (err) {
      console.warn('Gagal membaca data dari localStorage, menggunakan seed data default:', err)
    }

    const defaultState = {
      company: { ...INITIAL_COMPANY },
      accounts: JSON.parse(JSON.stringify(INITIAL_ACCOUNTS)),
      periods: JSON.parse(JSON.stringify(INITIAL_PERIODS)),
      templates: JSON.parse(JSON.stringify(INITIAL_TEMPLATES)),
      journals: JSON.parse(JSON.stringify(INITIAL_JOURNAL_ENTRIES)),
      auditLogs: JSON.parse(JSON.stringify(INITIAL_AUDIT_LOGS)),
      musicTracks: JSON.parse(JSON.stringify(INITIAL_MUSIC_TRACKS)),
      importBatches: [],
      nextJournalId: 9,
      nextAccountId: 37,
      nextTemplateId: 5,
      nextAuditId: 5,
      nextMusicId: 3,
      nextBatchId: 1
    }
    this.saveState(defaultState)
    return defaultState
  }

  saveState(stateToSave) {
    const s = stateToSave || this.state
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
      }
    } catch (err) {
      console.error('Gagal menyimpan data ke localStorage:', err)
    }
  }

  resetToDefault() {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY)
      window.localStorage.removeItem(MUSIC_STORAGE_KEY)
    }
    this.state = this.loadState()
    return { ok: true, message: 'Basis data berhasil dikembalikan ke pengaturan awal (seed data).' }
  }

  round(val) {
    const n = Number(val) || 0
    return Math.round((n + Number.EPSILON) * 100) / 100
  }

  // Company
  getCompany() {
    return { company: this.state.company }
  }

  updateCompany(patch) {
    this.state.company = {
      ...this.state.company,
      ...patch,
      updated_at: new Date().toISOString()
    }
    this.saveState()
    return { ok: true, company: this.state.company }
  }

  // Accounts
  getAccounts() {
    return { accounts: [...this.state.accounts].sort((a, b) => a.code.localeCompare(b.code)) }
  }

  createAccount(payload) {
    if (!payload.code || !payload.name || !payload.account_group) {
      throw new Error('Kode, nama akun, dan kelompok akun wajib diisi.')
    }
    const exists = this.state.accounts.some((a) => a.code === payload.code.trim())
    if (exists) {
      throw new Error(`Akun dengan kode ${payload.code} sudah terdaftar.`)
    }
    const id = this.state.nextAccountId++
    const normal_balance = payload.normal_balance || (
      payload.account_group === 'ASSET' || payload.account_group === 'EXPENSE' ? 'DEBIT' : 'CREDIT'
    )
    const newAccount = {
      id,
      company_id: 1,
      code: payload.code.trim(),
      name: payload.name.trim(),
      account_group: payload.account_group,
      account_subtype: payload.account_subtype || null,
      normal_balance,
      cash_flow_category: payload.cash_flow_category || 'OPERATING',
      is_cash_account: payload.is_cash_account ? 1 : 0,
      is_active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    this.state.accounts.push(newAccount)
    this.saveState()
    return { ok: true, account: newAccount }
  }

  updateAccount(id, payload) {
    const acc = this.state.accounts.find((a) => String(a.id) === String(id))
    if (!acc) throw new Error('Akun tidak ditemukan.')
    if (payload.name) acc.name = payload.name.trim()
    if (payload.account_subtype !== undefined) acc.account_subtype = payload.account_subtype
    if (payload.cash_flow_category !== undefined) acc.cash_flow_category = payload.cash_flow_category
    if (payload.is_cash_account !== undefined) acc.is_cash_account = payload.is_cash_account ? 1 : 0
    if (payload.is_active !== undefined) acc.is_active = payload.is_active ? 1 : 0
    acc.updated_at = new Date().toISOString()
    this.saveState()
    return { ok: true, account: acc }
  }

  // Periods
  getPeriods() {
    return { periods: this.state.periods }
  }

  createPeriod(payload) {
    if (!payload.name || !payload.start_date || !payload.end_date) {
      throw new Error('Nama periode dan rentang tanggal wajib diisi.')
    }
    const newPeriod = {
      id: this.state.periods.length + 1,
      company_id: 1,
      name: payload.name,
      start_date: payload.start_date,
      end_date: payload.end_date,
      status: 'OPEN',
      created_at: new Date().toISOString()
    }
    this.state.periods.push(newPeriod)
    this.saveState()
    return { ok: true, period: newPeriod }
  }

  closePeriod(periodId) {
    const period = this.state.periods.find((p) => String(p.id) === String(periodId))
    if (!period) throw new Error('Periode akuntansi tidak ditemukan.')
    if (period.status === 'CLOSED') throw new Error('Periode ini sudah ditutup sebelumnya.')

    // Lakukan proses tutup buku otomatis (Closing Entries):
    // 1. Menutup semua saldo pendapatan (debit akun pendapatan, kredit Ikhtisar Laba Rugi)
    // 2. Menutup semua saldo beban (kredit akun beban, debit Ikhtisar Laba Rugi)
    // 3. Menutup selisih Ikhtisar Laba Rugi ke Modal Pemilik / Laba Ditahan
    const periodEntries = this.state.journals.filter(
      (j) => j.status === 'POSTED' && j.entry_date >= period.start_date && j.entry_date <= period.end_date
    )

    const revenueMap = new Map()
    const expenseMap = new Map()
    let totalRevenue = 0
    let totalExpense = 0

    const accountMap = new Map(this.state.accounts.map((a) => [a.id, a]))
    const summaryAccount = this.state.accounts.find((a) => a.code === '3300') || this.state.accounts.find((a) => a.account_group === 'EQUITY')
    const retainedEarningsAccount = this.state.accounts.find((a) => a.code === '3400') || this.state.accounts.find((a) => a.code === '3100')

    for (const entry of periodEntries) {
      for (const line of entry.lines) {
        const acc = accountMap.get(line.account_id)
        if (!acc) continue
        const netMutation = (line.credit || 0) - (line.debit || 0)
        if (acc.account_group === 'REVENUE') {
          const prev = revenueMap.get(acc.id) || 0
          revenueMap.set(acc.id, this.round(prev + netMutation))
          totalRevenue = this.round(totalRevenue + netMutation)
        } else if (acc.account_group === 'EXPENSE') {
          const expenseMutation = (line.debit || 0) - (line.credit || 0)
          const prev = expenseMap.get(acc.id) || 0
          expenseMap.set(acc.id, this.round(prev + expenseMutation))
          totalExpense = this.round(totalExpense + expenseMutation)
        }
      }
    }

    const netIncome = this.round(totalRevenue - totalExpense)
    const closingLines = []
    let lineNo = 1

    // Tutup Pendapatan
    for (const [accId, amt] of revenueMap.entries()) {
      if (amt > 0) {
        const acc = accountMap.get(accId)
        closingLines.push({
          account_id: accId,
          line_no: lineNo++,
          code: acc.code,
          account_name: acc.name,
          debit: amt,
          credit: 0,
          memo: 'Penutupan akun pendapatan ke Ikhtisar Laba Rugi'
        })
      }
    }

    // Tutup Beban
    for (const [accId, amt] of expenseMap.entries()) {
      if (amt > 0) {
        const acc = accountMap.get(accId)
        closingLines.push({
          account_id: accId,
          line_no: lineNo++,
          code: acc.code,
          account_name: acc.name,
          debit: 0,
          credit: amt,
          memo: 'Penutupan akun beban ke Ikhtisar Laba Rugi'
        })
      }
    }

    // Selisih Laba Bersih ke Laba Ditahan / Modal
    if (netIncome > 0) {
      closingLines.push({
        account_id: summaryAccount.id,
        line_no: lineNo++,
        code: summaryAccount.code,
        account_name: summaryAccount.name,
        debit: netIncome,
        credit: 0,
        memo: 'Pemindahan laba bersih ke Laba Ditahan'
      })
      closingLines.push({
        account_id: retainedEarningsAccount.id,
        line_no: lineNo++,
        code: retainedEarningsAccount.code,
        account_name: retainedEarningsAccount.name,
        debit: 0,
        credit: netIncome,
        memo: 'Pengakuan laba bersih tahun berjalan'
      })
    } else if (netIncome < 0) {
      const absLoss = Math.abs(netIncome)
      closingLines.push({
        account_id: retainedEarningsAccount.id,
        line_no: lineNo++,
        code: retainedEarningsAccount.code,
        account_name: retainedEarningsAccount.name,
        debit: absLoss,
        credit: 0,
        memo: 'Pengakuan rugi bersih tahun berjalan'
      })
      closingLines.push({
        account_id: summaryAccount.id,
        line_no: lineNo++,
        code: summaryAccount.code,
        account_name: summaryAccount.name,
        debit: 0,
        credit: absLoss,
        memo: 'Pemindahan rugi bersih dari Ikhtisar Laba Rugi'
      })
    }

    if (closingLines.length >= 2) {
      const closingVoucher = this.getNextVoucherSync()
      const closingEntry = {
        id: this.state.nextJournalId++,
        company_id: 1,
        period_id: period.id,
        voucher_no: closingVoucher,
        entry_date: period.end_date,
        description: `Jurnal Penutup Periode: ${period.name}`,
        source: 'CLOSING',
        status: 'POSTED',
        created_by: 1,
        posted_by: 1,
        posted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        creator_name: 'Sistem Akuntansi Finova',
        poster_name: 'Sistem Akuntansi Finova',
        lines: closingLines.map((l, idx) => ({ ...l, id: idx + 1, journal_entry_id: this.state.nextJournalId }))
      }
      this.state.journals.push(closingEntry)
    }

    period.status = 'CLOSED'
    period.closed_at = new Date().toISOString()
    this.saveState()
    return { ok: true, message: `Periode ${period.name} berhasil ditutup dan jurnal penutup telah dibuat.` }
  }

  // Voucher generator
  getNextVoucherSync() {
    const now = new Date()
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const prefix = `JV-${ym}-`
    const monthJournals = this.state.journals.filter((j) => j.voucher_no && j.voucher_no.startsWith(prefix))
    let maxSeq = 0
    for (const j of monthJournals) {
      const seqStr = j.voucher_no.slice(prefix.length)
      const num = parseInt(seqStr, 10)
      if (!isNaN(num) && num > maxSeq) maxSeq = num
    }
    const nextSeq = String(maxSeq + 1).padStart(4, '0')
    return `${prefix}${nextSeq}`
  }

  getNextVoucher() {
    return { voucherNo: this.getNextVoucherSync() }
  }

  // Journal Validation
  validateLines(rawLines) {
    if (!Array.isArray(rawLines) || rawLines.length < 2) {
      throw new Error('Jurnal harus memiliki sedikitnya dua baris akun.')
    }
    const accountMap = new Map(this.state.accounts.map((a) => [a.id, a]))
    let totalDebit = 0
    let totalCredit = 0
    const validated = []

    rawLines.forEach((item, index) => {
      const accountId = Number(item.account_id || item.accountId)
      if (!accountId || !accountMap.has(accountId)) {
        throw new Error(`Baris ${index + 1}: Akun wajib dipilih dengan benar.`)
      }
      const acc = accountMap.get(accountId)
      const debit = this.round(Number(item.debit) || 0)
      const credit = this.round(Number(item.credit) || 0)

      if (debit < 0 || credit < 0) {
        throw new Error(`Baris ${index + 1}: Nominal debit/kredit tidak boleh negatif.`)
      }
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new Error(`Baris ${index + 1}: Isi tepat salah satu kolom debit atau kredit.`)
      }

      totalDebit = this.round(totalDebit + debit)
      totalCredit = this.round(totalCredit + credit)

      validated.push({
        line_no: index + 1,
        account_id: accountId,
        code: acc.code,
        account_name: acc.name,
        debit,
        credit,
        memo: item.memo ? String(item.memo).trim() : ''
      })
    })

    if (Math.abs(totalDebit - totalCredit) >= 0.005) {
      throw new Error(
        `Jurnal tidak seimbang! Total Debit (Rp ${totalDebit.toLocaleString('id-ID')}) != Total Kredit (Rp ${totalCredit.toLocaleString('id-ID')}). Selisih: Rp ${Math.abs(totalDebit - totalCredit).toLocaleString('id-ID')}`
      )
    }

    return { lines: validated, total: totalDebit }
  }

  // Journal Operations
  getJournal(id) {
    const entry = this.state.journals.find((j) => String(j.id) === String(id))
    if (!entry) throw new Error('Jurnal tidak ditemukan.')
    return { entry }
  }

  createJournal(payload) {
    const entryDate = payload.entry_date || new Date().toISOString().slice(0, 10)
    const description = payload.description ? payload.description.trim() : 'Transaksi Jurnal Umum'
    const status = payload.status === 'POSTED' ? 'POSTED' : 'DRAFT'
    const voucherNo = payload.voucher_no && payload.voucher_no.trim() ? payload.voucher_no.trim() : this.getNextVoucherSync()

    const { lines, total } = this.validateLines(payload.lines || payload.items)
    const id = this.state.nextJournalId++
    const now = new Date().toISOString()

    const newJournal = {
      id,
      company_id: 1,
      period_id: 1,
      voucher_no: voucherNo,
      entry_date: entryDate,
      description,
      source: payload.source || 'MANUAL',
      status,
      created_by: 1,
      posted_by: status === 'POSTED' ? 1 : null,
      posted_at: status === 'POSTED' ? now : null,
      created_at: now,
      updated_at: now,
      creator_name: 'Staf Keuangan',
      poster_name: status === 'POSTED' ? 'Pimpinan Finova' : null,
      lines: lines.map((l, idx) => ({ ...l, id: idx + 1, journal_entry_id: id }))
    }

    this.state.journals.push(newJournal)
    this.addAuditLog('JOURNAL', id, 'CREATE', { voucher_no: voucherNo, total, status })
    if (status === 'POSTED') {
      this.addAuditLog('JOURNAL', id, 'POST', { voucher_no: voucherNo, status: 'POSTED' })
    }

    this.saveState()
    return { ok: true, id, entry: newJournal }
  }

  updateJournal(id, payload) {
    const index = this.state.journals.findIndex((j) => String(j.id) === String(id))
    if (index === -1) throw new Error('Jurnal tidak ditemukan.')
    const current = this.state.journals[index]

    const { lines, total } = this.validateLines(payload.lines || payload.items)
    current.entry_date = payload.entry_date || current.entry_date
    current.description = payload.description ? payload.description.trim() : current.description
    current.updated_at = new Date().toISOString()
    current.lines = lines.map((l, idx) => ({ ...l, id: idx + 1, journal_entry_id: Number(id) }))

    this.addAuditLog('JOURNAL', id, 'UPDATE', { voucher_no: current.voucher_no, total })
    this.saveState()
    return { ok: true, entry: current }
  }

  deleteJournal(id) {
    const index = this.state.journals.findIndex((j) => String(j.id) === String(id))
    if (index === -1) throw new Error('Jurnal tidak ditemukan.')
    const target = this.state.journals[index]
    if (target.status === 'POSTED') {
      throw new Error('Jurnal yang sudah diposting tidak dapat dihapus. Gunakan fitur Pembalikan Jurnal (Reverse).')
    }

    this.state.journals.splice(index, 1)
    this.addAuditLog('JOURNAL', id, 'DELETE', { voucher_no: target.voucher_no })
    this.saveState()
    return { ok: true, message: 'Jurnal berhasil dihapus.' }
  }

  postJournal(id) {
    const entry = this.state.journals.find((j) => String(j.id) === String(id))
    if (!entry) throw new Error('Jurnal tidak ditemukan.')
    if (entry.status === 'POSTED') return { ok: true, entry }

    entry.status = 'POSTED'
    entry.posted_by = 1
    entry.posted_at = new Date().toISOString()
    entry.poster_name = 'Pimpinan Finova'
    entry.updated_at = new Date().toISOString()

    this.addAuditLog('JOURNAL', id, 'POST', { voucher_no: entry.voucher_no })
    this.saveState()
    return { ok: true, entry }
  }

  reverseJournal(id, reason) {
    const original = this.state.journals.find((j) => String(j.id) === String(id))
    if (!original) throw new Error('Jurnal tidak ditemukan.')
    if (original.status !== 'POSTED') throw new Error('Hanya jurnal yang sudah POSTED yang dapat dibalik.')

    // Tandai jurnal lama
    original.status = 'REVERSED'
    original.updated_at = new Date().toISOString()

    // Buat jurnal pembalik
    const revVoucher = this.getNextVoucherSync()
    const revId = this.state.nextJournalId++
    const now = new Date().toISOString()
    const todayStr = now.slice(0, 10)

    const reversedLines = original.lines.map((line, idx) => ({
      id: idx + 1,
      journal_entry_id: revId,
      line_no: idx + 1,
      account_id: line.account_id,
      code: line.code,
      account_name: line.account_name,
      debit: line.credit, // Tukar posisi
      credit: line.debit, // Tukar posisi
      memo: `Pembalikan ${original.voucher_no}: ${line.memo || ''}`.trim()
    }))

    const revEntry = {
      id: revId,
      company_id: 1,
      period_id: 1,
      voucher_no: revVoucher,
      entry_date: todayStr,
      description: `[Pembalikan ${original.voucher_no}] ${reason || original.description}`,
      source: 'REVERSAL',
      status: 'POSTED',
      reversal_of_id: original.id,
      created_by: 1,
      posted_by: 1,
      posted_at: now,
      created_at: now,
      updated_at: now,
      creator_name: 'Staf Keuangan',
      poster_name: 'Pimpinan Finova',
      lines: reversedLines
    }

    this.state.journals.push(revEntry)
    this.addAuditLog('JOURNAL', original.id, 'REVERSE', {
      original_voucher: original.voucher_no,
      reversal_voucher: revVoucher,
      reason: reason || ''
    })

    this.saveState()
    return { ok: true, reversal: revEntry }
  }

  // Audit Logs
  addAuditLog(entity_type, entity_id, action, details) {
    const log = {
      id: this.state.nextAuditId++,
      company_id: 1,
      user_id: 1,
      entity_type,
      entity_id: Number(entity_id),
      action,
      details_json: JSON.stringify(details),
      created_at: new Date().toISOString()
    }
    this.state.auditLogs.unshift(log)
  }

  getJournalAudit(id) {
    const logs = this.state.auditLogs.filter(
      (l) => l.entity_type === 'JOURNAL' && String(l.entity_id) === String(id)
    )
    return { logs }
  }

  // Templates
  getTemplates() {
    return { templates: this.state.templates }
  }

  createTemplate(payload) {
    if (!payload.name || !Array.isArray(payload.lines) || payload.lines.length < 2) {
      throw new Error('Nama template dan minimal 2 baris akun wajib diisi.')
    }
    const id = this.state.nextTemplateId++
    const newTemplate = {
      id,
      name: payload.name.trim(),
      description: payload.description ? payload.description.trim() : '',
      lines: payload.lines
    }
    this.state.templates.push(newTemplate)
    this.saveState()
    return { ok: true, template: newTemplate }
  }

  deleteTemplate(id) {
    const idx = this.state.templates.findIndex((t) => String(t.id) === String(id))
    if (idx !== -1) {
      this.state.templates.splice(idx, 1)
      this.saveState()
    }
    return { ok: true }
  }

  // Excel / CSV Import preview & confirm
  previewImport(rows) {
    const batchId = this.state.nextBatchId++
    const accountByCode = new Map(this.state.accounts.map((a) => [a.code, a]))
    const accountByName = new Map(this.state.accounts.map((a) => [a.name.toLowerCase(), a]))

    const parsedEntries = []
    const errors = []
    let currentVoucher = null
    let currentEntry = null

    rows.forEach((row, idx) => {
      const vNo = (row.voucher_no || row['No Bukti'] || row['Voucher'] || '').toString().trim()
      const date = (row.date || row.entry_date || row['Tanggal'] || '').toString().trim()
      const desc = (row.description || row['Deskripsi'] || row['Keterangan'] || '').toString().trim()
      const accCode = (row.account_code || row.code || row['Kode Akun'] || '').toString().trim()
      const accName = (row.account_name || row['Nama Akun'] || '').toString().trim()
      const debit = Number(row.debit || row['Debit'] || 0)
      const credit = Number(row.credit || row['Kredit'] || 0)
      const memo = (row.memo || row['Catatan'] || '').toString().trim()

      let acc = accountByCode.get(accCode)
      if (!acc && accName) {
        acc = accountByName.get(accName.toLowerCase())
      }

      if (!acc) {
        errors.push(`Baris ${idx + 1}: Akun dengan kode "${accCode}" atau nama "${accName}" tidak ditemukan di bagan akun.`)
        return
      }

      if (vNo && vNo !== currentVoucher) {
        if (currentEntry) parsedEntries.push(currentEntry)
        currentVoucher = vNo
        currentEntry = {
          voucher_no: vNo,
          entry_date: date || new Date().toISOString().slice(0, 10),
          description: desc || 'Impor Jurnal',
          lines: []
        }
      }

      if (!currentEntry) {
        currentEntry = {
          voucher_no: this.getNextVoucherSync(),
          entry_date: date || new Date().toISOString().slice(0, 10),
          description: desc || 'Impor Jurnal',
          lines: []
        }
      }

      currentEntry.lines.push({
        account_id: acc.id,
        code: acc.code,
        account_name: acc.name,
        debit,
        credit,
        memo
      })
    })

    if (currentEntry) parsedEntries.push(currentEntry)

    // Validasi keseimbangan tiap entry
    parsedEntries.forEach((entry, eIdx) => {
      let d = 0, c = 0
      entry.lines.forEach((l) => {
        d = this.round(d + l.debit)
        c = this.round(c + l.credit)
      })
      if (Math.abs(d - c) >= 0.005) {
        errors.push(`Jurnal ${entry.voucher_no}: Total Debit (${d}) tidak sama dengan Total Kredit (${c}).`)
      }
    })

    const previewData = {
      batchId,
      totalRows: rows.length,
      validEntries: parsedEntries.length,
      errors,
      entries: parsedEntries
    }

    this.state.importBatches.push(previewData)
    return previewData
  }

  confirmImport(batchId) {
    const batch = this.state.importBatches.find((b) => String(b.batchId) === String(batchId))
    if (!batch) throw new Error('Data batch impor tidak ditemukan.')
    if (batch.errors.length > 0) throw new Error('Perbaiki kesalahan data sebelum memposting hasil impor.')

    let postedCount = 0
    batch.entries.forEach((e) => {
      this.createJournal({
        voucher_no: e.voucher_no,
        entry_date: e.entry_date,
        description: `[IMPOR] ${e.description}`,
        source: 'IMPORT',
        status: 'POSTED',
        lines: e.lines
      })
      postedCount++
    })

    return { ok: true, posted: postedCount }
  }

  // Reports
  getReports(kind, query = {}) {
    const todayStr = new Date().toISOString().slice(0, 10)
    const from = query.from || `${todayStr.slice(0, 8)}01`
    const to = query.to || todayStr

    const accountMap = new Map(this.state.accounts.map((a) => [a.id, a]))
    const allPostedJournals = this.state.journals.filter((j) => j.status === 'POSTED')

    switch (kind) {
      case 'dashboard': {
        const periodJournals = allPostedJournals.filter((j) => j.entry_date >= from && j.entry_date <= to)
        let cashBank = 0
        let receivables = 0
        let payables = 0
        let revenue = 0
        let expenses = 0

        // Saldo kumulatif s.d. tanggal 'to' untuk Neraca
        allPostedJournals
          .filter((j) => j.entry_date <= to)
          .forEach((j) => {
            j.lines.forEach((line) => {
              const acc = accountMap.get(line.account_id)
              if (!acc) return
              const d = line.debit || 0
              const c = line.credit || 0
              if (acc.is_cash_account) cashBank = this.round(cashBank + d - c)
              if (acc.code === '1200') receivables = this.round(receivables + d - c)
              if (acc.code === '2100') payables = this.round(payables + c - d)
            })
          })

        // Kinerja periode 'from' s.d. 'to' untuk Laba Rugi
        periodJournals.forEach((j) => {
          j.lines.forEach((line) => {
            const acc = accountMap.get(line.account_id)
            if (!acc) return
            const d = line.debit || 0
            const c = line.credit || 0
            if (acc.account_group === 'REVENUE') revenue = this.round(revenue + c - d)
            if (acc.account_group === 'EXPENSE') expenses = this.round(expenses + d - c)
          })
        })

        const netIncome = this.round(revenue - expenses)

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            cashBank: Math.max(0, cashBank),
            receivables: Math.max(0, receivables),
            payables: Math.max(0, payables),
            revenue,
            expenses,
            netIncome
          }
        }
      }

      case 'journal': {
        const periodEntries = this.state.journals
          .filter((j) => j.entry_date >= from && j.entry_date <= to)
          .sort((a, b) => {
            const dComp = b.entry_date.localeCompare(a.entry_date)
            return dComp !== 0 ? dComp : b.id - a.id
          })

        // Rekap debit & kredit per kode akun untuk jurnal yang POSTED
        const debitsMap = new Map()
        const creditsMap = new Map()
        let totalDebit = 0
        let totalCredit = 0

        periodEntries
          .filter((j) => j.status === 'POSTED')
          .forEach((entry) => {
            entry.lines.forEach((line) => {
              const code = line.code || ''
              const name = line.account_name || ''
              const d = line.debit || 0
              const c = line.credit || 0

              if (d > 0) {
                const prev = debitsMap.get(code) || { code, name, amount: 0 }
                prev.amount = this.round(prev.amount + d)
                debitsMap.set(code, prev)
                totalDebit = this.round(totalDebit + d)
              }
              if (c > 0) {
                const prev = creditsMap.get(code) || { code, name, amount: 0 }
                prev.amount = this.round(prev.amount + c)
                creditsMap.set(code, prev)
                totalCredit = this.round(totalCredit + c)
              }
            })
          })

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            entries: periodEntries,
            debits: Array.from(debitsMap.values()).sort((a, b) => a.code.localeCompare(b.code)),
            credits: Array.from(creditsMap.values()).sort((a, b) => a.code.localeCompare(b.code)),
            total_debit: totalDebit,
            total_credit: totalCredit
          }
        }
      }

      case 'ledger': {
        const accountId = Number(query.accountId)
        if (!accountId) throw new Error('Pilih akun untuk buku besar.')
        const account = accountMap.get(accountId)
        if (!account) throw new Error('Akun buku besar tidak ditemukan.')

        const isDebitNormal = account.normal_balance === 'DEBIT'

        // 1. Hitung saldo awal (transaksi sebelum 'from')
        let opening = 0
        allPostedJournals
          .filter((j) => j.entry_date < from)
          .forEach((j) => {
            j.lines.forEach((l) => {
              if (l.account_id === accountId) {
                const d = l.debit || 0
                const c = l.credit || 0
                opening = isDebitNormal ? opening + d - c : opening + c - d
              }
            })
          })
        opening = this.round(opening)

        // 2. Transaksi dalam periode 'from' s.d. 'to'
        const rows = []
        let runningBalance = opening

        const targetEntries = allPostedJournals
          .filter((j) => j.entry_date >= from && j.entry_date <= to)
          .sort((a, b) => {
            const dComp = a.entry_date.localeCompare(b.entry_date)
            return dComp !== 0 ? dComp : a.id - b.id
          })

        targetEntries.forEach((j) => {
          j.lines.forEach((l) => {
            if (l.account_id === accountId) {
              const d = l.debit || 0
              const c = l.credit || 0
              runningBalance = isDebitNormal
                ? this.round(runningBalance + d - c)
                : this.round(runningBalance + c - d)

              rows.push({
                entry_date: j.entry_date,
                voucher_no: j.voucher_no,
                description: j.description,
                memo: l.memo || '',
                debit: d,
                credit: c,
                balance: runningBalance
              })
            }
          })
        })

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            account,
            opening,
            closing: runningBalance,
            rows
          }
        }
      }

      case 'trial-balance': {
        // Neraca Saldo: dihitung kumulatif s.d. tanggal 'to'
        const accountBalances = new Map()
        this.state.accounts.forEach((a) => {
          accountBalances.set(a.id, {
            account: a,
            debit: 0,
            credit: 0
          })
        })

        allPostedJournals
          .filter((j) => j.entry_date <= to)
          .forEach((j) => {
            j.lines.forEach((l) => {
              const item = accountBalances.get(l.account_id)
              if (item) {
                item.debit = this.round(item.debit + (l.debit || 0))
                item.credit = this.round(item.credit + (l.credit || 0))
              }
            })
          })

        const rows = []
        let totalDebit = 0
        let totalCredit = 0

        this.state.accounts.forEach((a) => {
          const item = accountBalances.get(a.id)
          const isDebitNormal = a.normal_balance === 'DEBIT'
          const net = isDebitNormal ? item.debit - item.credit : item.credit - item.debit

          let d = 0
          let c = 0

          if (isDebitNormal) {
            if (net >= 0) d = this.round(net)
            else c = this.round(Math.abs(net))
          } else {
            if (net >= 0) c = this.round(net)
            else d = this.round(Math.abs(net))
          }

          if (d > 0 || c > 0 || item.debit > 0 || item.credit > 0) {
            totalDebit = this.round(totalDebit + d)
            totalCredit = this.round(totalCredit + c)

            rows.push({
              id: a.id,
              code: a.code,
              name: a.name,
              account_group: a.account_group,
              account_subtype: a.account_subtype,
              normal_balance: a.normal_balance,
              debit: d,
              credit: c
            })
          }
        })

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            rows: rows.sort((a, b) => a.code.localeCompare(b.code)),
            totals: {
              debit: totalDebit,
              credit: totalCredit
            }
          }
        }
      }

      case 'income-statement': {
        // Laporan Laba Rugi untuk periode 'from' s.d. 'to'
        const revenues = []
        const expenses = []
        let totalRevenue = 0
        let totalExpense = 0

        const periodEntries = allPostedJournals.filter((j) => j.entry_date >= from && j.entry_date <= to)

        this.state.accounts.forEach((acc) => {
          if (acc.account_group === 'REVENUE') {
            let sum = 0
            periodEntries.forEach((j) => {
              j.lines.forEach((l) => {
                if (l.account_id === acc.id) sum = this.round(sum + (l.credit || 0) - (l.debit || 0))
              })
            })
            if (sum !== 0) {
              revenues.push({ code: acc.code, name: acc.name, amount: sum })
              totalRevenue = this.round(totalRevenue + sum)
            }
          } else if (acc.account_group === 'EXPENSE') {
            let sum = 0
            periodEntries.forEach((j) => {
              j.lines.forEach((l) => {
                if (l.account_id === acc.id) sum = this.round(sum + (l.debit || 0) - (l.credit || 0))
              })
            })
            if (sum !== 0) {
              expenses.push({ code: acc.code, name: acc.name, amount: sum })
              totalExpense = this.round(totalExpense + sum)
            }
          }
        })

        const netIncome = this.round(totalRevenue - totalExpense)

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            revenues,
            expenses,
            totalRevenue,
            totalExpense,
            netIncome
          }
        }
      }

      case 'balance-sheet': {
        // Neraca per tanggal 'to'
        const assets = []
        const liabilities = []
        const equity = []
        let totalAssets = 0
        let totalLiabilities = 0
        let totalEquity = 0

        let cumulativeNetIncome = 0

        allPostedJournals
          .filter((j) => j.entry_date <= to)
          .forEach((j) => {
            j.lines.forEach((l) => {
              const acc = accountMap.get(l.account_id)
              if (!acc) return
              const d = l.debit || 0
              const c = l.credit || 0
              if (acc.account_group === 'REVENUE') cumulativeNetIncome = this.round(cumulativeNetIncome + c - d)
              if (acc.account_group === 'EXPENSE') cumulativeNetIncome = this.round(cumulativeNetIncome - (d - c))
            })
          })

        this.state.accounts.forEach((acc) => {
          let net = 0
          allPostedJournals
            .filter((j) => j.entry_date <= to)
            .forEach((j) => {
              j.lines.forEach((l) => {
                if (l.account_id === acc.id) {
                  const d = l.debit || 0
                  const c = l.credit || 0
                  if (acc.account_group === 'ASSET') {
                    net = acc.normal_balance === 'DEBIT' ? net + d - c : net - (c - d)
                  } else {
                    net = acc.normal_balance === 'CREDIT' ? net + c - d : net - (d - c)
                  }
                }
              })
            })
          net = this.round(net)

          if (acc.account_group === 'ASSET' && net !== 0) {
            assets.push({ code: acc.code, name: acc.name, amount: net, subtype: acc.account_subtype })
            totalAssets = this.round(totalAssets + net)
          } else if (acc.account_group === 'LIABILITY' && net !== 0) {
            liabilities.push({ code: acc.code, name: acc.name, amount: net, subtype: acc.account_subtype })
            totalLiabilities = this.round(totalLiabilities + net)
          } else if (acc.account_group === 'EQUITY' && net !== 0 && acc.code !== '3300') {
            equity.push({ code: acc.code, name: acc.name, amount: net, subtype: acc.account_subtype })
            totalEquity = this.round(totalEquity + net)
          }
        })

        // Tambahkan Laba Bersih Berjalan ke Ekuitas
        if (cumulativeNetIncome !== 0) {
          equity.push({
            code: 'LBN',
            name: 'Laba / (Rugi) Bersih Tahun Berjalan',
            amount: cumulativeNetIncome,
            subtype: 'CURRENT_EARNINGS'
          })
          totalEquity = this.round(totalEquity + cumulativeNetIncome)
        }

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            assets,
            liabilities,
            equity,
            totalAssets,
            totalLiabilities,
            totalEquity,
            totalLiabilitiesAndEquity: this.round(totalLiabilities + totalEquity)
          }
        }
      }

      case 'equity-changes': {
        // Laporan Perubahan Ekuitas
        let beginningCapital = 0
        let periodDrawings = 0
        let periodNetIncome = 0

        // Modal Awal sebelum tanggal 'from'
        allPostedJournals
          .filter((j) => j.entry_date < from)
          .forEach((j) => {
            j.lines.forEach((l) => {
              const acc = accountMap.get(l.account_id)
              if (!acc) return
              const d = l.debit || 0
              const c = l.credit || 0
              if (acc.code === '3100') beginningCapital = this.round(beginningCapital + c - d)
              if (acc.account_group === 'REVENUE') beginningCapital = this.round(beginningCapital + c - d)
              if (acc.account_group === 'EXPENSE') beginningCapital = this.round(beginningCapital - (d - c))
              if (acc.code === '3200') beginningCapital = this.round(beginningCapital - (d - c))
            })
          })

        // Laba Bersih & Prive selama periode
        allPostedJournals
          .filter((j) => j.entry_date >= from && j.entry_date <= to)
          .forEach((j) => {
            j.lines.forEach((l) => {
              const acc = accountMap.get(l.account_id)
              if (!acc) return
              const d = l.debit || 0
              const c = l.credit || 0
              if (acc.account_group === 'REVENUE') periodNetIncome = this.round(periodNetIncome + c - d)
              if (acc.account_group === 'EXPENSE') periodNetIncome = this.round(periodNetIncome - (d - c))
              if (acc.code === '3200') periodDrawings = this.round(periodDrawings + d - c)
            })
          })

        const endingCapital = this.round(beginningCapital + periodNetIncome - periodDrawings)

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            beginningCapital,
            netIncome: periodNetIncome,
            drawings: periodDrawings,
            endingCapital
          }
        }
      }

      case 'cash-flow': {
        // Laporan Arus Kas (Metode Langsung)
        const operating = []
        const investing = []
        const financing = []
        let netOperating = 0
        let netInvesting = 0
        let netFinancing = 0

        allPostedJournals
          .filter((j) => j.entry_date >= from && j.entry_date <= to)
          .forEach((j) => {
            const hasCash = j.lines.some((l) => {
              const acc = accountMap.get(l.account_id)
              return acc && acc.is_cash_account
            })
            if (!hasCash) return

            j.lines.forEach((l) => {
              const acc = accountMap.get(l.account_id)
              if (!acc || acc.is_cash_account) return
              const flowAmt = this.round((l.credit || 0) - (l.debit || 0))
              const cat = acc.cash_flow_category || 'OPERATING'

              if (cat === 'OPERATING') {
                operating.push({ name: `${acc.name} (${j.description})`, amount: flowAmt })
                netOperating = this.round(netOperating + flowAmt)
              } else if (cat === 'INVESTING') {
                investing.push({ name: `${acc.name} (${j.description})`, amount: flowAmt })
                netInvesting = this.round(netInvesting + flowAmt)
              } else if (cat === 'FINANCING') {
                financing.push({ name: `${acc.name} (${j.description})`, amount: flowAmt })
                netFinancing = this.round(netFinancing + flowAmt)
              }
            })
          })

        // Saldo Kas Awal & Akhir
        let openingCash = 0
        let closingCash = 0

        allPostedJournals
          .filter((j) => j.entry_date < from)
          .forEach((j) => {
            j.lines.forEach((l) => {
              const acc = accountMap.get(l.account_id)
              if (acc && acc.is_cash_account) openingCash = this.round(openingCash + (l.debit || 0) - (l.credit || 0))
            })
          })

        const netChange = this.round(netOperating + netInvesting + netFinancing)
        closingCash = this.round(openingCash + netChange)

        return {
          company: this.state.company,
          period: { from, to },
          data: {
            operating,
            investing,
            financing,
            netOperating,
            netInvesting,
            netFinancing,
            netChange,
            openingCash,
            closingCash
          }
        }
      }

      default:
        throw new Error(`Jenis laporan "${kind}" tidak ditemukan.`)
    }
  }

  // Music Library
  getMusicTracks() {
    return { tracks: this.state.musicTracks || [] }
  }

  addYouTubeTrack(url, title, artist) {
    if (!url) throw new Error('URL video YouTube wajib diisi.')
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
    const match = url.match(regExp)
    const youtubeId = match && match[2].length === 11 ? match[2] : null
    if (!youtubeId) throw new Error('Tautan YouTube tidak valid.')

    const exists = this.state.musicTracks.some((t) => t.youtube_id === youtubeId)
    if (exists) throw new Error('Video YouTube ini sudah ada di daftar putar.')

    const newTrack = {
      id: this.state.nextMusicId++,
      company_id: 1,
      kind: 'YOUTUBE',
      title: title || 'YouTube Track',
      artist: artist || 'YouTube Stream',
      youtube_id: youtubeId,
      thumbnail_url: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
      position: this.state.musicTracks.length,
      created_at: new Date().toISOString()
    }
    this.state.musicTracks.push(newTrack)
    this.saveState()
    return { ok: true, track: newTrack }
  }

  addLocalTrack(file) {
    const newTrack = {
      id: this.state.nextMusicId++,
      company_id: 1,
      kind: 'LOCAL',
      title: file.name.replace(/\.[^/.]+$/, ''),
      artist: 'Musik Lokal Pengguna',
      file_name: file.name,
      file_bytes: file.size || 0,
      audio_url: URL.createObjectURL(file),
      position: this.state.musicTracks.length,
      created_at: new Date().toISOString()
    }
    this.state.musicTracks.push(newTrack)
    this.saveState()
    return { ok: true, track: newTrack }
  }

  deleteMusicTrack(id) {
    const idx = this.state.musicTracks.findIndex((t) => String(t.id) === String(id))
    if (idx !== -1) {
      this.state.musicTracks.splice(idx, 1)
      this.saveState()
    }
    return { ok: true }
  }

  updateMusicOrder(ids) {
    if (Array.isArray(ids)) {
      const trackMap = new Map(this.state.musicTracks.map((t) => [t.id, t]))
      this.state.musicTracks = ids
        .map((id, index) => {
          const t = trackMap.get(id)
          if (t) t.position = index
          return t
        })
        .filter(Boolean)
      this.saveState()
    }
    return { ok: true }
  }
}

// Global Singleton Instance
export const accountingEngine = new AccountingEngine()
