// Ekspor XLSX — port dari src-rust/export/xlsx.rs (rust_xlsxwriter →
// lib/xlsx.ts buatan sendiri). Tata letak, warna, dan format dipertahankan.
import { Sheet, STYLE, Workbook } from '../lib/xlsx'
import type {
  AccountRow,
  AccountsData,
  JournalData,
  LedgerData,
  TrialBalanceData,
  TrialBalanceRow
} from './index'

const HEADER_GREEN = 'FF0E7042'

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Template impor jurnal (7 kolom + contoh). */
export function journalTemplate(): Uint8Array {
  const wb = new Workbook()
  const ws = wb.add('Jurnal')

  const headers: [string, number][] = [
    ['NoBukti', 16],
    ['Tanggal', 14],
    ['KodeAkun', 12],
    ['NamaAkun', 28],
    ['Debit', 16],
    ['Kredit', 16],
    ['Keterangan', 32]
  ]
  headers.forEach(([title, width], col) => {
    ws.write(0, col, title, STYLE.HEADER_TEMPLATE)
    ws.width(col, width)
  })

  const samples: [string, string, string, string, number, number, string][] = [
    ['JU-001', '2026-01-01', '1100', 'Kas', 5000000, 0, 'Setoran Modal Awal'],
    ['JU-001', '2026-01-01', '3100', 'Modal Pemilik', 0, 5000000, 'Setoran Modal Awal'],
    ['JU-002', '2026-01-02', '1300', 'Perlengkapan Kantor', 250000, 0, 'Beli Alat Tulis Kantor'],
    ['JU-002', '2026-01-02', '1100', 'Kas', 0, 250000, 'Beli Alat Tulis Kantor']
  ]
  samples.forEach((sample, rowIdx) => {
    const r = rowIdx + 1
    sample.forEach((value, col) => {
      if (typeof value === 'number') ws.write(r, col, value)
      else ws.write(r, col, value)
    })
  })

  return wb.build()
}

function writeTitleBlock(ws: Sheet, company: string, subtitle: string, meta: string): void {
  ws.write(0, 0, company, STYLE.TITLE)
  ws.write(1, 0, subtitle, STYLE.SUBTITLE)
  ws.write(2, 0, meta, STYLE.META)
}

export function journalWorkbook(data: JournalData): Uint8Array {
  const wb = new Workbook()
  const ws = wb.add('Jurnal Umum')

  const company = data.company === '' ? 'PT Finova Akuntansi Indonesia' : data.company
  writeTitleBlock(
    ws,
    company,
    'JURNAL UMUM (GENERAL JOURNAL)',
    `Periode: ${data.from} s.d. ${data.to} | Dicetak: ${data.printed_on}`
  )

  const columns: [string, number][] = [
    ['Tanggal', 14],
    ['No. Bukti', 16],
    ['Keterangan Akun & Transaksi', 36],
    ['Ref', 10],
    ['Debit (Rp)', 18],
    ['Kredit (Rp)', 18]
  ]
  columns.forEach(([name, width], col) => {
    ws.write(4, col, name, STYLE.HEADER)
    ws.width(col, width)
  })

  let currentRow = 5
  for (const entry of data.entries) {
    let accountName = entry.account
    if (entry.is_credit) {
      accountName = `     ↳ ${accountName
        .replace(/^     » /, '')
        .replace(/^     ↳ /, '')}`
    }

    let desc: string
    if (entry.line_memo !== '') {
      desc = `${accountName}\n(${entry.line_memo})`
    } else if (entry.end_memo !== '' && entry.show_head) {
      desc = `${accountName}\n(${entry.end_memo})`
    } else {
      desc = accountName
    }

    if (entry.show_head) {
      ws.write(currentRow, 0, entry.date, STYLE.NORMAL)
      ws.write(currentRow, 1, entry.voucher, STYLE.NORMAL)
    } else {
      ws.write(currentRow, 0, '', STYLE.NORMAL)
      ws.write(currentRow, 1, '', STYLE.NORMAL)
    }

    ws.write(currentRow, 2, desc, STYLE.NORMAL)
    ws.write(currentRow, 3, entry.ref_code, STYLE.NORMAL)

    if (entry.debit > 0) ws.write(currentRow, 4, entry.debit, STYLE.MONEY)
    else ws.write(currentRow, 4, '-', STYLE.NORMAL)

    if (entry.credit > 0) ws.write(currentRow, 5, entry.credit, STYLE.MONEY)
    else ws.write(currentRow, 5, '-', STYLE.NORMAL)

    currentRow += 1
  }

  // Baris TOTAL
  ws.write(currentRow, 0, '', STYLE.TOTAL_LABEL)
  ws.write(currentRow, 1, '', STYLE.TOTAL_LABEL)
  ws.write(currentRow, 2, 'TOTAL', STYLE.TOTAL_LABEL)
  ws.write(currentRow, 3, '', STYLE.TOTAL_LABEL)
  ws.write(currentRow, 4, data.total_debit, STYLE.TOTAL_MONEY)
  ws.write(currentRow, 5, data.total_credit, STYLE.TOTAL_MONEY)
  currentRow += 3

  // Rekapitulasi (kalau ada)
  if (
    data.recap.debits.length > 0 ||
    data.recap.credits.length > 0
  ) {
    ws.write(currentRow, 0, 'REKAPITULASI JURNAL UMUM', STYLE.RECAP_TITLE)
    currentRow += 1

    ws.write(currentRow, 0, 'Akun Debit', STYLE.RECAP_HEADER)
    ws.write(currentRow, 1, 'Jumlah', STYLE.RECAP_HEADER)
    ws.write(currentRow, 2, 'Akun Kredit', STYLE.RECAP_HEADER)
    ws.write(currentRow, 3, 'Jumlah', STYLE.RECAP_HEADER)
    currentRow += 1

    const maxLen = Math.max(data.recap.debits.length, data.recap.credits.length)
    for (let i = 0; i < maxLen; i++) {
      const d = data.recap.debits[i]
      const c = data.recap.credits[i]
      if (d) {
        ws.write(currentRow, 0, `${d.code} - ${d.name}`, STYLE.NORMAL)
        ws.write(currentRow, 1, d.amount, STYLE.MONEY)
      } else {
        ws.write(currentRow, 0, '', STYLE.NORMAL)
        ws.write(currentRow, 1, '', STYLE.NORMAL)
      }
      if (c) {
        ws.write(currentRow, 2, `${c.code} - ${c.name}`, STYLE.NORMAL)
        ws.write(currentRow, 3, c.amount, STYLE.MONEY)
      } else {
        ws.write(currentRow, 2, '', STYLE.NORMAL)
        ws.write(currentRow, 3, '', STYLE.NORMAL)
      }
      currentRow += 1
    }

    ws.write(currentRow, 0, 'TOTAL DEBIT', STYLE.BOLD)
    ws.write(currentRow, 1, data.recap.total_debit, STYLE.TOTAL_MONEY)
    ws.write(currentRow, 2, 'TOTAL KREDIT', STYLE.BOLD)
    ws.write(currentRow, 3, data.recap.total_credit, STYLE.TOTAL_MONEY)
    currentRow += 3
  }

  // Lembar pengesahan
  const signers = data.signers
  ws.write(currentRow, 0, 'Dibuat Oleh,')
  ws.write(currentRow, 2, 'Diperiksa Oleh,')
  ws.write(currentRow, 4, 'Disetujui Oleh,')
  ws.write(currentRow + 4, 0, `( ${signers.maker} )`)
  ws.write(currentRow + 4, 2, `( ${signers.checker} )`)
  ws.write(currentRow + 4, 4, `( ${signers.approver} )`)

  return wb.build()
}

export function ledgerWorkbook(data: LedgerData): Uint8Array {
  const wb = new Workbook()
  const ws = wb.add('Buku Besar')

  writeTitleBlock(ws, data.company, `BUKU BESAR: ${data.account_label}`, '')
  ws.write(
    2,
    0,
    `Periode: ${data.from} s.d. ${data.to} | Saldo Normal: ${data.normal_balance}`
  )

  const cols: [string, number][] = [
    ['Tanggal', 14],
    ['No. Bukti', 16],
    ['Keterangan', 36],
    ['Debit (Rp)', 18],
    ['Kredit (Rp)', 18],
    ['Saldo (Rp)', 18]
  ]
  cols.forEach(([title, width], col) => {
    ws.write(4, col, title, STYLE.HEADER)
    ws.width(col, width)
  })

  let r = 5
  ws.write(r, 0, data.from, STYLE.NORMAL)
  ws.write(r, 1, '-', STYLE.NORMAL)
  ws.write(r, 2, 'Saldo Awal', STYLE.NORMAL)
  ws.write(r, 3, '-', STYLE.NORMAL)
  ws.write(r, 4, '-', STYLE.NORMAL)
  ws.write(r, 5, data.opening, STYLE.MONEY)
  r += 1

  for (const row of data.rows) {
    ws.write(r, 0, row.date, STYLE.NORMAL)
    ws.write(r, 1, row.voucher, STYLE.NORMAL)
    ws.write(r, 2, row.description, STYLE.NORMAL)
    if (row.debit > 0) ws.write(r, 3, row.debit, STYLE.MONEY)
    else ws.write(r, 3, '-', STYLE.NORMAL)
    if (row.credit > 0) ws.write(r, 4, row.credit, STYLE.MONEY)
    else ws.write(r, 4, '-', STYLE.NORMAL)
    ws.write(r, 5, row.balance, STYLE.MONEY)
    r += 1
  }

  return wb.build()
}

export function trialBalanceWorkbook(data: TrialBalanceData): Uint8Array {
  const wb = new Workbook()
  const ws = wb.add('Neraca Saldo')

  writeTitleBlock(ws, data.company, 'NERACA SALDO (TRIAL BALANCE)', `Per Tanggal: ${data.as_of}`)

  const cols: [string, number][] = [
    ['Kode Akun', 14],
    ['Nama Akun', 32],
    ['Kelompok', 16],
    ['Debit (Rp)', 18],
    ['Kredit (Rp)', 18]
  ]
  cols.forEach(([title, width], col) => {
    ws.write(4, col, title, STYLE.HEADER)
    ws.width(col, width)
  })

  let r = 5
  for (const row of data.rows) {
    ws.write(r, 0, row.code, STYLE.NORMAL)
    ws.write(r, 1, row.name, STYLE.NORMAL)
    ws.write(r, 2, row.group, STYLE.NORMAL)
    if (row.debit > 0) ws.write(r, 3, row.debit, STYLE.MONEY)
    else ws.write(r, 3, '-', STYLE.NORMAL)
    if (row.credit > 0) ws.write(r, 4, row.credit, STYLE.MONEY)
    else ws.write(r, 4, '-', STYLE.NORMAL)
    r += 1
  }

  ws.write(r, 0, '', STYLE.TOTAL_LABEL)
  ws.write(r, 1, 'TOTAL', STYLE.TOTAL_LABEL)
  ws.write(r, 2, '', STYLE.TOTAL_LABEL)
  ws.write(r, 3, data.total_debit, STYLE.TOTAL_MONEY)
  ws.write(r, 4, data.total_credit, STYLE.TOTAL_MONEY)

  return wb.build()
}

export function accountsWorkbook(data: AccountsData): Uint8Array {
  const wb = new Workbook()
  const ws = wb.add('Bagan Akun')

  ws.write(0, 0, data.company, STYLE.TITLE)
  ws.write(1, 0, 'BAGAN AKUN STANDAR (CHART OF ACCOUNTS)', STYLE.TITLE)

  const cols: [string, number][] = [
    ['Kode', 12],
    ['Nama Akun', 32],
    ['Kelompok', 16],
    ['Subtipe', 20],
    ['Saldo Normal', 14],
    ['Kategori Arus Kas', 18],
    ['Kas/Bank', 14]
  ]
  cols.forEach(([title, width], col) => {
    ws.write(3, col, title, STYLE.HEADER)
    ws.width(col, width)
  })

  let r = 4
  for (const row of data.rows) {
    ws.write(r, 0, row.code, STYLE.NORMAL)
    ws.write(r, 1, row.name, STYLE.NORMAL)
    ws.write(r, 2, row.group, STYLE.NORMAL)
    ws.write(r, 3, row.subtype, STYLE.NORMAL)
    ws.write(r, 4, row.normal_balance, STYLE.NORMAL)
    ws.write(r, 5, row.cash_flow, STYLE.NORMAL)
    ws.write(r, 6, row.cash_label, STYLE.NORMAL)
    r += 1
  }

  return wb.build()
}

// Diekspor agar pemanggil tidak perlu mengimpor konstanta warna terpisah.
export const TEMPLATE_HEADER_GREEN = HEADER_GREEN
