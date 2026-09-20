import ExcelJS from 'exceljs'
import { dateLabel } from '../utils/formatters.js'

const FINOVA_PALETTE = {
  primary: 'FF0E7145',      // Forest Emerald
  primaryLight: 'FFEAF7F0', // Soft Mint
  accent: 'FF0A5835',       // Deep Forest
  white: 'FFFFFFFF',
  textDark: 'FF1E293B',     // Slate 800
  textMuted: 'FF64748B',    // Slate 500
  creditText: 'FF0369A1',   // Sky 700 (for credit accounts)
  border: 'FFE2E8F0',       // Slate 200
  zebra: 'FFF8FAFC'         // Slate 50
}

const ACCOUNTING_NUM_FMT = '#,##0'

function applySheetDefaults(ws) {
  ws.views = [{ showGridLines: true }]
}

function autoFitColumns(ws, minWidths = {}) {
  ws.columns.forEach((col, idx) => {
    let maxLength = minWidths[idx] || 12
    col.eachCell({ includeEmpty: false }, (cell) => {
      const val = cell.value ? String(cell.value) : ''
      if (val.length > maxLength) {
        maxLength = Math.min(val.length + 3, 50)
      }
    })
    col.width = maxLength
  })
}

function saveWorkbook(workbook, filename) {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  })
}

/**
 * 1. Export Laporan Jurnal Umum & Rekapitulasi (Multi-Sheet)
 */
export async function exportJournalToExcel({ company, entries = [], range, totals, recap }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Finova Akuntansi Indonesia'
  wb.created = new Date()

  // --- SHEET 1: JURNAL UMUM ---
  const ws = wb.addWorksheet('Jurnal Umum')
  applySheetDefaults(ws)
  ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: true }]

  // Header Dokumen
  const compRow = ws.addRow([company?.name || 'PT Finova Akuntansi Indonesia'])
  compRow.font = { name: 'Arial', size: 14, bold: true, color: { argb: FINOVA_PALETTE.accent } }

  const titleRow = ws.addRow(['BUKU JURNAL UMUM (GENERAL JOURNAL)'])
  titleRow.font = { name: 'Arial', size: 11, bold: true, color: { argb: FINOVA_PALETTE.textDark } }

  const periodRow = ws.addRow([`Periode: ${dateLabel(range.from)} s.d. ${dateLabel(range.to)}`])
  periodRow.font = { name: 'Arial', size: 10, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }

  const curRow = ws.addRow(['(Dinyatakan dalam Rupiah / IDR — Standar Akuntansi Indonesia)'])
  curRow.font = { name: 'Arial', size: 9, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }

  ws.addRow([]) // Baris kosong pembatas

  // Table Headers
  const th = ws.addRow(['Tanggal', 'No. Bukti', 'Keterangan Akun & Transaksi', 'Ref', 'Debit (Rp)', 'Kredit (Rp)'])
  th.font = { name: 'Arial', size: 10, bold: true, color: { argb: FINOVA_PALETTE.white } }
  th.alignment = { vertical: 'middle', horizontal: 'center' }
  th.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primary } }
    cell.border = {
      top: { style: 'thin', color: { argb: FINOVA_PALETTE.border } },
      bottom: { style: 'medium', color: { argb: FINOVA_PALETTE.accent } }
    }
  })

  // Rows
  if (entries.length === 0) {
    const emptyRow = ws.addRow(['', '', 'Belum ada transaksi pada periode ini.', '', null, null])
    emptyRow.font = { italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
  } else {
    for (const [eIdx, e] of entries.entries()) {
      const isEven = eIdx % 2 === 0
      const lines = e.lines || []

      for (const [idx, l] of lines.entries()) {
        const isFirst = idx === 0
        const isCredit = Number(l.credit || 0) > 0
        const accTitle = (isCredit ? '     ↳ ' : '') + `${l.account_name || ''}`

        const row = ws.addRow([
          isFirst ? e.entry_date : '',
          isFirst ? e.voucher_no : '',
          accTitle,
          l.code || '',
          Number(l.debit) > 0 ? Number(l.debit) : null,
          Number(l.credit) > 0 ? Number(l.credit) : null
        ])

        row.font = { name: 'Arial', size: 10 }
        row.getCell(1).alignment = { horizontal: 'center' }
        row.getCell(2).alignment = { horizontal: 'center' }
        row.getCell(4).alignment = { horizontal: 'center' }

        if (isCredit) {
          row.getCell(3).font = { name: 'Arial', size: 10, color: { argb: FINOVA_PALETTE.creditText } }
        }

        row.getCell(5).numFmt = ACCOUNTING_NUM_FMT
        row.getCell(6).numFmt = ACCOUNTING_NUM_FMT

        row.eachCell((cell) => {
          cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFF1F5F9' } }
          }
          if (isEven) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.zebra } }
          }
        })
      }

      if (e.description) {
        const memoRow = ws.addRow(['', '', `(${e.description})`, '', null, null])
        memoRow.getCell(3).font = { name: 'Arial', size: 9, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
        memoRow.eachCell((cell) => {
          cell.border = { bottom: { style: 'thin', color: { argb: FINOVA_PALETTE.border } } }
          if (isEven) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.zebra } }
          }
        })
      }
    }
  }

  // Total Baris dengan Double Underline Akuntansi
  const totalRow = ws.addRow(['', '', 'JUMLAH TOTAL JURNAL', '', totals?.debit || 0, totals?.credit || 0])
  totalRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: FINOVA_PALETTE.accent } }
  totalRow.getCell(3).alignment = { horizontal: 'right' }
  totalRow.getCell(5).numFmt = ACCOUNTING_NUM_FMT
  totalRow.getCell(6).numFmt = ACCOUNTING_NUM_FMT
  totalRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primaryLight } }
    cell.border = {
      top: { style: 'thin', color: { argb: FINOVA_PALETTE.primary } },
      bottom: { style: 'double', color: { argb: FINOVA_PALETTE.primary } }
    }
  })

  // Lembar Pengesahan di Excel
  ws.addRow([])
  ws.addRow([])
  const signDateRow = ws.addRow(['', '', '', '', 'Dicetak pada:', new Date().toLocaleDateString('id-ID')])
  signDateRow.font = { size: 9, color: { argb: FINOVA_PALETTE.textMuted } }

  const signTitleRow = ws.addRow(['', 'Dibuat Oleh,', '', 'Diperiksa Oleh,', '', 'Disetujui Oleh,'])
  signTitleRow.font = { name: 'Arial', size: 10, bold: true }
  signTitleRow.alignment = { horizontal: 'center' }

  ws.addRow([])
  ws.addRow([])
  ws.addRow([])

  const signNameRow = ws.addRow(['', '( Staf Akuntansi )', '', '( Guru / Dosen )', '', '( Pimpinan )'])
  signNameRow.font = { name: 'Arial', size: 9, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
  signNameRow.alignment = { horizontal: 'center' }

  autoFitColumns(ws, { 0: 14, 1: 16, 2: 44, 3: 10, 4: 18, 5: 18 })

  // --- SHEET 2: REKAPITULASI JURNAL ---
  if (recap) {
    const wsRecap = wb.addWorksheet('Rekapitulasi Jurnal')
    applySheetDefaults(wsRecap)

    const rComp = wsRecap.addRow([company?.name || 'PT Finova Akuntansi Indonesia'])
    rComp.font = { name: 'Arial', size: 14, bold: true, color: { argb: FINOVA_PALETTE.accent } }

    const rTitle = wsRecap.addRow(['TABEL REKAPITULASI JURNAL UMUM'])
    rTitle.font = { name: 'Arial', size: 11, bold: true }

    const rPer = wsRecap.addRow([`Periode: ${dateLabel(range.from)} s.d. ${dateLabel(range.to)}`])
    rPer.font = { name: 'Arial', size: 10, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }

    wsRecap.addRow([])

    const rHead = wsRecap.addRow([
      'DEBIT: Kode Akun', 'Nama Akun', 'Jumlah (Rp)', '',
      'KREDIT: Kode Akun', 'Nama Akun', 'Jumlah (Rp)'
    ])
    rHead.font = { name: 'Arial', size: 10, bold: true, color: { argb: FINOVA_PALETTE.white } }
    rHead.eachCell((cell, colNum) => {
      if (colNum !== 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primary } }
      }
    })

    const maxLen = Math.max(recap.debits?.length || 0, recap.credits?.length || 0)
    for (let i = 0; i < maxLen; i++) {
      const d = recap.debits[i]
      const c = recap.credits[i]
      const r = wsRecap.addRow([
        d ? d.code : '', d ? d.name : '', d ? d.amount : '',
        '',
        c ? c.code : '', c ? c.name : '', c ? c.amount : ''
      ])
      r.font = { name: 'Arial', size: 10 }
      if (d) r.getCell(3).numFmt = ACCOUNTING_NUM_FMT
      if (c) r.getCell(7).numFmt = ACCOUNTING_NUM_FMT
    }

    const rTot = wsRecap.addRow([
      '', 'TOTAL DEBIT', recap.totalDebit || 0,
      '',
      '', 'TOTAL KREDIT', recap.totalCredit || 0
    ])
    rTot.font = { name: 'Arial', size: 10, bold: true, color: { argb: FINOVA_PALETTE.accent } }
    rTot.getCell(3).numFmt = ACCOUNTING_NUM_FMT
    rTot.getCell(7).numFmt = ACCOUNTING_NUM_FMT
    rTot.eachCell((cell, colNum) => {
      if (colNum !== 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primaryLight } }
        cell.border = {
          top: { style: 'thin', color: { argb: FINOVA_PALETTE.primary } },
          bottom: { style: 'double', color: { argb: FINOVA_PALETTE.primary } }
        }
      }
    })

    autoFitColumns(wsRecap, { 0: 16, 1: 30, 2: 18, 3: 4, 4: 16, 5: 30, 6: 18 })
  }

  const filename = `Finova_Jurnal_Umum_${range.from}_sd_${range.to}.xlsx`
  return saveWorkbook(wb, filename)
}

/**
 * 2. Export Buku Besar (General Ledger)
 */
export async function exportLedgerToExcel({ company, account, rows = [], initialBalance = 0, range }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Finova Akuntansi Indonesia'
  const ws = wb.addWorksheet('Buku Besar')
  applySheetDefaults(ws)
  ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: true }]

  ws.addRow([company?.name || 'PT Finova Akuntansi Indonesia']).font = { size: 14, bold: true, color: { argb: FINOVA_PALETTE.accent } }
  ws.addRow([`BUKU BESAR (GENERAL LEDGER) — ${account ? `${account.code} - ${account.name}` : 'SEMUA AKUN'}`]).font = { size: 11, bold: true }
  ws.addRow([`Periode: ${dateLabel(range?.from)} s.d. ${dateLabel(range?.to)}`]).font = { size: 10, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
  ws.addRow([`Saldo Normal: ${account?.normal_balance === 'DEBIT' ? 'DEBIT' : 'KREDIT'}`]).font = { size: 9, bold: true, color: { argb: FINOVA_PALETTE.primary } }
  ws.addRow([])

  const th = ws.addRow(['Tanggal', 'No. Bukti', 'Keterangan Transaksi', 'Debit (Rp)', 'Kredit (Rp)', 'Saldo Akhir (Rp)'])
  th.font = { bold: true, color: { argb: FINOVA_PALETTE.white } }
  th.alignment = { vertical: 'middle', horizontal: 'center' }
  th.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primary } }
  })

  // Saldo Awal
  const initRow = ws.addRow([range?.from || '', '', 'SALDO AWAL PERIODE', null, null, initialBalance])
  initRow.font = { italic: true, bold: true }
  initRow.getCell(6).numFmt = ACCOUNTING_NUM_FMT

  let curBal = initialBalance
  let totalDebit = 0
  let totalCredit = 0

  for (const r of rows) {
    const deb = Number(r.debit || 0)
    const cred = Number(r.credit || 0)
    totalDebit += deb
    totalCredit += cred

    if (account?.normal_balance === 'CREDIT') {
      curBal = curBal + cred - deb
    } else {
      curBal = curBal + deb - cred
    }

    const row = ws.addRow([
      r.entry_date,
      r.voucher_no,
      r.description || r.memo || '',
      deb > 0 ? deb : null,
      cred > 0 ? cred : null,
      curBal
    ])

    row.getCell(4).numFmt = ACCOUNTING_NUM_FMT
    row.getCell(5).numFmt = ACCOUNTING_NUM_FMT
    row.getCell(6).numFmt = ACCOUNTING_NUM_FMT
    row.eachCell(c => {
      c.border = { bottom: { style: 'thin', color: { argb: FINOVA_PALETTE.border } } }
    })
  }

  // Total Mutasi
  const totRow = ws.addRow(['', '', 'TOTAL MUTASI PERIODE', totalDebit, totalCredit, curBal])
  totRow.font = { bold: true, color: { argb: FINOVA_PALETTE.accent } }
  totRow.getCell(4).numFmt = ACCOUNTING_NUM_FMT
  totRow.getCell(5).numFmt = ACCOUNTING_NUM_FMT
  totRow.getCell(6).numFmt = ACCOUNTING_NUM_FMT
  totRow.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primaryLight } }
    c.border = {
      top: { style: 'thin', color: { argb: FINOVA_PALETTE.primary } },
      bottom: { style: 'double', color: { argb: FINOVA_PALETTE.primary } }
    }
  })

  autoFitColumns(ws, { 0: 14, 1: 16, 2: 36, 3: 18, 4: 18, 5: 20 })
  const filename = `Finova_Buku_Besar_${account?.code || 'All'}_${range?.from || ''}.xlsx`
  return saveWorkbook(wb, filename)
}

/**
 * 3. Export Neraca Saldo (Trial Balance)
 */
export async function exportTrialBalanceToExcel({ company, accounts = [], asOfDate, totals }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Finova Akuntansi Indonesia'
  const ws = wb.addWorksheet('Neraca Saldo')
  applySheetDefaults(ws)
  ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: true }]

  ws.addRow([company?.name || 'PT Finova Akuntansi Indonesia']).font = { size: 14, bold: true, color: { argb: FINOVA_PALETTE.accent } }
  ws.addRow(['NERACA SALDO (TRIAL BALANCE)']).font = { size: 11, bold: true }
  ws.addRow([`Per Tanggal: ${dateLabel(asOfDate)}`]).font = { size: 10, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
  ws.addRow(['(Dinyatakan dalam Rupiah / IDR)']).font = { size: 9, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
  ws.addRow([])

  const th = ws.addRow(['Kode Akun', 'Nama Akun', 'Kelompok', 'Debit (Rp)', 'Kredit (Rp)'])
  th.font = { bold: true, color: { argb: FINOVA_PALETTE.white } }
  th.alignment = { vertical: 'middle', horizontal: 'center' }
  th.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primary } }
  })

  let tDeb = 0
  let tCred = 0

  for (const a of accounts) {
    const deb = Number(a.debit || a.debit_balance || 0)
    const cred = Number(a.credit || a.credit_balance || 0)
    tDeb += deb
    tCred += cred

    const row = ws.addRow([
      a.code,
      a.name,
      a.account_group || a.group || '',
      deb > 0 ? deb : null,
      cred > 0 ? cred : null
    ])
    row.getCell(4).numFmt = ACCOUNTING_NUM_FMT
    row.getCell(5).numFmt = ACCOUNTING_NUM_FMT
    row.eachCell(c => {
      c.border = { bottom: { style: 'thin', color: { argb: FINOVA_PALETTE.border } } }
    })
  }

  const totRow = ws.addRow(['', 'TOTAL NERACA SALDO', '', totals?.debit ?? tDeb, totals?.credit ?? tCred])
  totRow.font = { bold: true, color: { argb: FINOVA_PALETTE.accent } }
  totRow.getCell(4).numFmt = ACCOUNTING_NUM_FMT
  totRow.getCell(5).numFmt = ACCOUNTING_NUM_FMT
  totRow.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primaryLight } }
    c.border = {
      top: { style: 'thin', color: { argb: FINOVA_PALETTE.primary } },
      bottom: { style: 'double', color: { argb: FINOVA_PALETTE.primary } }
    }
  })

  autoFitColumns(ws, { 0: 14, 1: 34, 2: 18, 3: 20, 4: 20 })
  const filename = `Finova_Neraca_Saldo_${asOfDate || 'Periode'}.xlsx`
  return saveWorkbook(wb, filename)
}

/**
 * 4. Export Master Bagan Akun (Chart of Accounts)
 */
export async function exportAccountsToExcel({ company, accounts = [] }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Finova Akuntansi Indonesia'
  const ws = wb.addWorksheet('Bagan Akun')
  applySheetDefaults(ws)
  ws.views = [{ state: 'frozen', ySplit: 5, showGridLines: true }]

  ws.addRow([company?.name || 'PT Finova Akuntansi Indonesia']).font = { size: 14, bold: true, color: { argb: FINOVA_PALETTE.accent } }
  ws.addRow(['BAGAN AKUN STANDAR INDONESIA (CHART OF ACCOUNTS)']).font = { size: 11, bold: true }
  ws.addRow([`Total Akun Terdaftar: ${accounts.length} Akun`]).font = { size: 10, italic: true, color: { argb: FINOVA_PALETTE.textMuted } }
  ws.addRow([])

  const th = ws.addRow(['Kode', 'Nama Akun', 'Kelompok', 'Subtipe', 'Saldo Normal', 'Kategori Arus Kas', 'Kas/Bank'])
  th.font = { bold: true, color: { argb: FINOVA_PALETTE.white } }
  th.alignment = { vertical: 'middle', horizontal: 'center' }
  th.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINOVA_PALETTE.primary } }
  })

  for (const a of accounts) {
    const row = ws.addRow([
      a.code,
      a.name,
      a.account_group,
      a.account_subtype || '-',
      a.normal_balance,
      a.cash_flow_category || 'OPERATING',
      a.is_cash_account ? 'Ya (Kas/Bank)' : 'Tidak'
    ])
    row.eachCell(c => {
      c.border = { bottom: { style: 'thin', color: { argb: FINOVA_PALETTE.border } } }
    })
  }

  autoFitColumns(ws, { 0: 12, 1: 34, 2: 18, 3: 18, 4: 16, 5: 20, 6: 14 })
  const filename = `Finova_Bagan_Akun_${new Date().toISOString().slice(0, 10)}.xlsx`
  return saveWorkbook(wb, filename)
}
