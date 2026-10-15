import * as XLSX from 'xlsx'
import { accountingEngine } from '../backend/accountingEngine.js'

export function queryString(values) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function readSigners() {
  try {
    const raw = localStorage.getItem('finova_signers')
    if (raw) {
      const parsed = JSON.parse(raw)
      return { maker: parsed.maker, checker: parsed.checker, approver: parsed.approver }
    }
  } catch {}
  return { maker: 'Staf Keuangan', checker: 'Auditor / Penguji', approver: 'Pimpinan Finova' }
}

export async function exportJournalFile(range, format = 'xlsx', extra = {}) {
  const rep = accountingEngine.getReports('journal', range)
  const entries = rep.data?.entries || []
  const debits = rep.data?.debits || []
  const credits = rep.data?.credits || []
  const signers = readSigners()

  if (format === 'pdf') {
    window.print()
    return
  }

  const rows = [
    ['FINOVA — SISTEM AKUNTANSI & PEMBUKUAN INDONESIA'],
    ['LAPORAN JURNAL UMUM (GENERAL JOURNAL)'],
    [`Periode: ${range.from} s.d. ${range.to}`],
    [`Perusahaan: ${rep.company.name}`],
    [],
    ['Tanggal', 'No Bukti', 'Keterangan', 'Kode Akun', 'Nama Akun', 'Catatan / Memo', 'Debit (Rp)', 'Kredit (Rp)']
  ]

  entries.forEach((entry) => {
    (entry.lines || []).forEach((line, idx) => {
      rows.push([
        idx === 0 ? entry.entry_date : '',
        idx === 0 ? entry.voucher_no : '',
        idx === 0 ? entry.description : '',
        line.code || '',
        line.account_name || '',
        line.memo || '',
        line.debit || 0,
        line.credit || 0
      ])
    })
  })

  rows.push([])
  rows.push(['REKAPITULASI JURNAL UMUM'])
  rows.push(['Kode Akun (Debit)', 'Nama Akun', 'Total Debit (Rp)', '', 'Kode Akun (Kredit)', 'Nama Akun', 'Total Kredit (Rp)'])

  const maxLen = Math.max(debits.length, credits.length)
  for (let i = 0; i < maxLen; i++) {
    const d = debits[i]
    const c = credits[i]
    rows.push([
      d ? d.code : '',
      d ? d.name : '',
      d ? d.amount : '',
      '',
      c ? c.code : '',
      c ? c.name : '',
      c ? c.amount : ''
    ])
  }

  rows.push([])
  rows.push(['TOTAL KESEIMBANGAN (BALANCE CHECK):', '', rep.data.total_debit, '', '', '', rep.data.total_credit])
  rows.push([])
  rows.push(['Dibuat Oleh:', signers.maker, '', 'Diperiksa Oleh:', signers.checker, '', 'Disetujui Oleh:', signers.approver])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Jurnal Umum')

  const filename = `Finova_Jurnal_Umum_${range.from}_sd_${range.to}.xlsx`
  XLSX.writeFile(wb, filename)
}

export async function exportLedgerFile(range, accountId, accountCode) {
  const rep = accountingEngine.getReports('ledger', { accountId, ...range })
  const d = rep.data
  const signers = readSigners()

  const rows = [
    ['FINOVA — SISTEM AKUNTANSI & PEMBUKUAN INDONESIA'],
    ['BUKU BESAR (GENERAL LEDGER)'],
    [`Akun: ${d.account.code} — ${d.account.name} (Saldo Normal: ${d.account.normal_balance})`],
    [`Periode: ${range.from} s.d. ${range.to}`],
    [`Perusahaan: ${rep.company.name}`],
    [],
    ['Tanggal', 'No Bukti', 'Keterangan', 'Catatan / Memo', 'Debit (Rp)', 'Kredit (Rp)', 'Saldo Berjalan (Rp)'],
    [range.from, '-', 'SALDO AWAL (OPENING BALANCE)', '-', 0, 0, d.opening]
  ]

  ;(d.rows || []).forEach((r) => {
    rows.push([
      r.entry_date,
      r.voucher_no,
      r.description || '',
      r.memo || '',
      r.debit || 0,
      r.credit || 0,
      r.balance || 0
    ])
  })

  rows.push([])
  rows.push(['SALDO AKHIR (CLOSING BALANCE):', '', '', '', '', '', d.closing])
  rows.push([])
  rows.push(['Dibuat Oleh:', signers.maker, '', 'Diperiksa Oleh:', signers.checker, '', 'Disetujui Oleh:', signers.approver])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Buku Besar ${accountCode}`)

  const filename = `Finova_Buku_Besar_${accountCode}_${range.from}_sd_${range.to}.xlsx`
  XLSX.writeFile(wb, filename)
}

export async function exportTrialBalanceFile(range) {
  const rep = accountingEngine.getReports('trial-balance', range)
  const d = rep.data
  const signers = readSigners()

  const rows = [
    ['FINOVA — SISTEM AKUNTANSI & PEMBUKUAN INDONESIA'],
    ['NERACA SALDO (TRIAL BALANCE)'],
    [`Per Tanggal: ${range.to}`],
    [`Perusahaan: ${rep.company.name}`],
    [],
    ['Kode Akun', 'Nama Akun', 'Kelompok Akun', 'Saldo Normal', 'Debit (Rp)', 'Kredit (Rp)']
  ]

  ;(d.rows || []).forEach((r) => {
    rows.push([
      r.code,
      r.name,
      r.account_group,
      r.normal_balance,
      r.debit || 0,
      r.credit || 0
    ])
  })

  rows.push([])
  rows.push(['TOTAL KESEIMBANGAN:', '', '', '', d.totals.debit, d.totals.credit])
  rows.push([
    Math.abs(d.totals.debit - d.totals.credit) < 0.005 ? 'STATUS: SEIMBANG (BALANCED)' : 'STATUS: TIDAK SEIMBANG (UNBALANCED)'
  ])
  rows.push([])
  rows.push(['Dibuat Oleh:', signers.maker, '', 'Diperiksa Oleh:', signers.checker, '', 'Disetujui Oleh:', signers.approver])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Neraca Saldo')

  const filename = `Finova_Neraca_Saldo_${range.to}.xlsx`
  XLSX.writeFile(wb, filename)
}

export async function exportAccountsFile() {
  const rep = accountingEngine.getAccounts()
  const list = rep.accounts || []
  const today = new Date().toISOString().slice(0, 10)

  const rows = [
    ['FINOVA — SISTEM AKUNTANSI & PEMBUKUAN INDONESIA'],
    ['BAGAN AKUN STANDAR (CHART OF ACCOUNTS)'],
    [`Tanggal Unduh: ${today}`],
    [],
    ['Kode Akun', 'Nama Akun', 'Kelompok', 'Subtipe', 'Saldo Normal', 'Kategori Arus Kas', 'Akun Kas/Bank', 'Status Aktif']
  ]

  list.forEach((a) => {
    rows.push([
      a.code,
      a.name,
      a.account_group,
      a.account_subtype || '-',
      a.normal_balance,
      a.cash_flow_category || 'OPERATING',
      a.is_cash_account ? 'Ya' : 'Tidak',
      a.is_active ? 'Aktif' : 'Non-Aktif'
    ])
  })

  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Bagan Akun')

  const filename = `Finova_Bagan_Akun_${today}.xlsx`
  XLSX.writeFile(wb, filename)
}
