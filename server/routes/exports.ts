// Endpoint ekspor (xlsx & pdf) — port dari src-rust/httpapi/exports.rs.
import { AppError } from '../errors'
import {
  accountBalance,
  buildTrialBalance,
  calculateAccountBalances,
  flatten,
  roundMoney,
  type Account,
  type AmountedLine,
  type Entry
} from '../domain'
import { accountsWorkbook, journalWorkbook, ledgerWorkbook, trialBalanceWorkbook } from '../export/xlsx'
import { PDF_MIME, journalPdf } from '../export/pdf'
import { defaultRange, getReportContext, type ReportContext } from './reports'
import { todayLocal } from '../lib/format'
import type { AppState, Ctx } from '../http/router'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function makeDownload(filename: string, contentType: string, payload: Uint8Array): Response {
  return new Response(payload, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  })
}

function sanitizeFilename(prefix: string, suffix: string): string {
  const clean = prefix.replace(/[/\\"\r\n]/g, '-')
  return `${clean}${suffix}`
}

interface ExportQuery {
  from: string | null
  to: string | null
  accountId: number | null
  status: string | null
  q: string | null
  sort: string | null
  dir: string | null
  maker: string | null
  checker: string | null
  approver: string | null
}

function readExportQuery(ctx: Ctx): ExportQuery {
  const q = ctx.query
  const accountIdRaw = q.get('accountId')
  const accountId = accountIdRaw !== null && accountIdRaw !== '' && Number.isInteger(Number(accountIdRaw))
    ? Number(accountIdRaw)
    : null
  return {
    from: q.get('from'),
    to: q.get('to'),
    accountId,
    status: q.get('status'),
    q: q.get('q'),
    sort: q.get('sort'),
    dir: q.get('dir'),
    maker: q.get('maker'),
    checker: q.get('checker'),
    approver: q.get('approver')
  }
}

export function exportRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  const db = state.db.connection
  const companyId = state.config.companyId

  return [
    ['GET', '/api/exports/journal.xlsx', (ctx) => {
      const query = readExportQuery(ctx)
      const [data, filename] = buildJournalExportData(state, query, false)
      const book = journalWorkbook(data)
      return makeDownload(sanitizeFilename(filename, '.xlsx'), XLSX_MIME, book)
    }],

    ['GET', '/api/exports/journal.pdf', (ctx) => {
      const query = readExportQuery(ctx)
      const [data, filename] = buildJournalExportData(state, query, true)
      const pdf = journalPdf(data)
      return makeDownload(sanitizeFilename(filename, '.pdf'), PDF_MIME, pdf)
    }],

    ['GET', '/api/exports/ledger.xlsx', (ctx) => {
      const query = readExportQuery(ctx)
      const accountId = query.accountId
      if (accountId === null) {
        throw AppError.badRequest('Pilih akun untuk buku besar.')
      }

      const [from, to] = defaultRange(query.from, query.to)
      const reportCtx = getReportContext(db, companyId, from, to, false)

      const targetAccount = reportCtx.accounts.find((account) => account.id === accountId)
      if (!targetAccount) throw AppError.badRequest('Pilih akun untuk buku besar.')

      const allLines = flatten(reportCtx.allEntries)
      const periodLines = flatten(reportCtx.periodEntries)

      const beforeLines = allLines.filter(
        (line) => line.account_id === accountId && line.entry_date < from
      )
      const initialBalance = accountBalance(
        targetAccount,
        calculateAccountBalances(reportCtx.accounts, beforeLines)
      )

      let running = initialBalance
      const rows: {
        date: string
        voucher: string
        description: string
        debit: number
        credit: number
        balance: number
      }[] = []

      for (const line of periodLines) {
        if (line.account_id !== accountId) continue
        if (targetAccount.normal_balance === 'DEBIT') {
          running = roundMoney(running + line.debit - line.credit)
        } else {
          running = roundMoney(running + line.credit - line.debit)
        }
        const description =
          line.description !== '' ? line.description : (line.memo ?? '')
        rows.push({
          date: line.entry_date,
          voucher: line.voucher_no,
          description,
          debit: line.debit,
          credit: line.credit,
          balance: running
        })
      }

      const companyName = companyNameOf(reportCtx)
      const accountLabel = `${targetAccount.code} - ${targetAccount.name}`
      const filename = `Finova_Buku_Besar_${targetAccount.code}_${from}`

      const data = {
        company: companyName,
        account_label: accountLabel,
        normal_balance: targetAccount.normal_balance,
        from,
        to,
        opening: initialBalance,
        rows,
        closing: running
      }
      const book = ledgerWorkbook(data)
      return makeDownload(sanitizeFilename(filename, '.xlsx'), XLSX_MIME, book)
    }],

    ['GET', '/api/exports/trial-balance.xlsx', (ctx) => {
      const query = readExportQuery(ctx)
      const [, to] = defaultRange(query.from, query.to)

      const reportCtx = getReportContext(db, companyId, '1970-01-01', to, false)
      const allLines = flatten(reportCtx.allEntries)
      const tb = buildTrialBalance(reportCtx.accounts, allLines)

      const rows = tb.rows.map((row) => ({
        code: row.code,
        name: row.name,
        group: row.group,
        debit: row.debit,
        credit: row.credit
      }))

      const data = {
        company: companyNameOf(reportCtx),
        as_of: to,
        rows,
        total_debit: tb.totals.debit,
        total_credit: tb.totals.credit
      }
      const filename = `Finova_Neraca_Saldo_${to}`
      const book = trialBalanceWorkbook(data)
      return makeDownload(sanitizeFilename(filename, '.xlsx'), XLSX_MIME, book)
    }],

    ['GET', '/api/exports/accounts.xlsx', (ctx) => {
      void ctx
      const companyName =
        (
          db
            .query('SELECT name FROM companies WHERE id = ?')
            .get(companyId) as { name: string } | null
        )?.name ?? 'PT Finova Akuntansi Indonesia'

      const rows = db
        .query(
          `SELECT code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account
           FROM accounts WHERE company_id = ? ORDER BY code`
        )
        .all(companyId) as Record<string, any>[]

      const data = {
        company: companyName,
        rows: rows.map((row) => ({
          code: row.code,
          name: row.name,
          group: row.account_group,
          subtype: row.account_subtype ?? '',
          normal_balance: row.normal_balance,
          cash_flow: row.cash_flow_category,
          cash_label: row.is_cash_account !== 0 ? 'Ya (Kas/Bank)' : 'Tidak'
        }))
      }
      const filename = `Finova_Bagan_Akun_${todayLocal()}`
      const book = accountsWorkbook(data)
      return makeDownload(sanitizeFilename(filename, '.xlsx'), XLSX_MIME, book)
    }]
  ]
}

function companyNameOf(reportCtx: ReportContext): string {
  const name = reportCtx.company?.name
  return typeof name === 'string' && name !== '' ? name : 'PT Finova Akuntansi Indonesia'
}

function buildJournalExportData(
  state: AppState,
  query: ExportQuery,
  asPdf: boolean
): [
  {
    company: string
    from: string
    to: string
    entries: any[]
    total_debit: number
    total_credit: number
    recap: any
    signers: any
    printed_on: string
  },
  string
] {
  const [from, to] = defaultRange(query.from, query.to)
  if (from > to) throw AppError.badRequest('Rentang tanggal tidak valid.')

  const db = state.db.connection
  const reportCtx = getReportContext(db, state.config.companyId, from, to, true)

  const statusFilter = (query.status ?? 'ALL').toUpperCase()
  const searchFilter = (query.q ?? '').trim().toLowerCase()
  const accountIdFilter = query.accountId ?? 0

  const filteredEntries: Entry[] = []
  for (const entry of reportCtx.periodEntries) {
    if (statusFilter !== 'ALL' && statusFilter !== '' && entry.status !== statusFilter) {
      continue
    }
    if (accountIdFilter !== 0 && !entry.lines.some((line) => line.account_id === accountIdFilter)) {
      continue
    }
    if (searchFilter !== '') {
      let matched =
        entry.voucher_no.toLowerCase().includes(searchFilter) ||
        entry.description.toLowerCase().includes(searchFilter)
      if (!matched) {
        for (const line of entry.lines) {
          if (
            (line.code ?? '').toLowerCase().includes(searchFilter) ||
            (line.account_name ?? '').toLowerCase().includes(searchFilter) ||
            (line.memo ?? '').toLowerCase().includes(searchFilter)
          ) {
            matched = true
            break
          }
        }
      }
      if (!matched) continue
    }
    filteredEntries.push(entry)
  }

  const sortKey = query.sort ?? 'date'
  const sortDir = query.dir ?? 'desc'
  const isDesc = sortDir === 'desc'

  filteredEntries.sort((a, b) => {
    let ord: number
    switch (sortKey) {
      case 'voucher':
        ord = a.voucher_no < b.voucher_no ? -1 : a.voucher_no > b.voucher_no ? 1 : 0
        break
      case 'debit': {
        const da = a.lines.reduce((sum, line) => sum + line.debit, 0)
        const dbSum = b.lines.reduce((sum, line) => sum + line.debit, 0)
        ord = da - dbSum
        break
      }
      case 'credit': {
        const ca = a.lines.reduce((sum, line) => sum + line.credit, 0)
        const cb = b.lines.reduce((sum, line) => sum + line.credit, 0)
        ord = ca - cb
        break
      }
      default:
        ord =
          a.entry_date < b.entry_date
            ? -1
            : a.entry_date > b.entry_date
              ? 1
              : a.id - b.id
    }
    return isDesc ? -ord : ord
  })

  const marker = asPdf ? '     » ' : '     ↳ '

  const rows: any[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (let entryIdx = 0; entryIdx < filteredEntries.length; entryIdx++) {
    const entry = filteredEntries[entryIdx]
    const lineCount = entry.lines.length
    for (let lineIdx = 0; lineIdx < entry.lines.length; lineIdx++) {
      const line = entry.lines[lineIdx]
      const rawAcc = line.account_name ?? ''
      const accountText = line.credit > 0 ? `${marker}${rawAcc}` : rawAcc

      rows.push({
        show_head: lineIdx === 0,
        date: lineIdx === 0 ? entry.entry_date : '',
        voucher: lineIdx === 0 ? entry.voucher_no : '',
        account: accountText,
        ref_code: line.code ?? '',
        debit: line.debit,
        credit: line.credit,
        is_credit: line.credit > 0,
        alternate: entryIdx % 2 === 1,
        line_memo: line.memo ?? '',
        end_memo: lineIdx === lineCount - 1 ? entry.description : ''
      })
    }
  }

  // Rekapitulasi hanya dari entri POSTED
  const postedEntries = filteredEntries.filter((entry) => entry.status === 'POSTED')

  const recapDebits = new Map<string, { name: string; amount: number }>()
  const recapCredits = new Map<string, { name: string; amount: number }>()
  let recapTotalDebit = 0
  let recapTotalCredit = 0

  for (const entry of postedEntries) {
    for (const line of entry.lines) {
      const code = line.code ?? ''
      const name = line.account_name ?? ''
      if (line.debit > 0) {
        let item = recapDebits.get(code)
        if (!item) {
          item = { name, amount: 0 }
          recapDebits.set(code, item)
        }
        item.amount = roundMoney(item.amount + line.debit)
        recapTotalDebit = roundMoney(recapTotalDebit + line.debit)
        totalDebit = roundMoney(totalDebit + line.debit)
      }
      if (line.credit > 0) {
        let item = recapCredits.get(code)
        if (!item) {
          item = { name, amount: 0 }
          recapCredits.set(code, item)
        }
        item.amount = roundMoney(item.amount + line.credit)
        recapTotalCredit = roundMoney(recapTotalCredit + line.credit)
        totalCredit = roundMoney(totalCredit + line.credit)
      }
    }
  }

  const debitsList = [...recapDebits.entries()]
    .map(([code, { name, amount }]) => ({ code, name, amount }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const creditsList = [...recapCredits.entries()]
    .map(([code, { name, amount }]) => ({ code, name, amount }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))

  const recap = {
    debits: debitsList,
    credits: creditsList,
    total_debit: recapTotalDebit,
    total_credit: recapTotalCredit,
    is_balanced: Math.abs(recapTotalDebit - recapTotalCredit) < 0.005
  }

  const signersRaw = {
    maker: query.maker ?? '',
    checker: query.checker ?? '',
    approver: query.approver ?? ''
  }
  const signers = {
    maker: signersRaw.maker.trim() === '' ? 'Staf Akuntansi' : signersRaw.maker,
    checker: signersRaw.checker.trim() === '' ? 'Supervisor' : signersRaw.checker,
    approver: signersRaw.approver.trim() === '' ? 'Pimpinan' : signersRaw.approver
  }

  const companyName = companyNameOf(reportCtx)
  const filename = `Finova_Jurnal_Umum_${from}_sd_${to}`

  return [
    {
      company: companyName,
      from,
      to,
      entries: rows,
      total_debit: totalDebit,
      total_credit: totalCredit,
      recap,
      signers,
      printed_on: todayLocal()
    },
    filename
  ]
}
