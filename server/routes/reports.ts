// Endpoint laporan — port dari src-rust/httpapi/reports.rs.
//
// Konteks laporan (perusahaan, akun, entri jurnal untuk rentang tanggal) juga
// dipakai oleh ekspor, jadi diekspor dari modul ini dan tidak diduplikasi.
import { AppError } from '../errors'
import {
  accountBalance,
  buildBalanceSheet,
  buildCashFlowDirect,
  buildEquityChanges,
  buildIncomeStatement,
  buildTrialBalance,
  calculateAccountBalances,
  dateText,
  flatten,
  makeClosingLines,
  roundMoney,
  type Account,
  type AmountedLine,
  type Entry,
  type Line
} from '../domain'
import { intParam, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>

const MONEY_EPSILON = 0.005

export interface ReportContext {
  company: AnyRow
  accounts: Account[]
  allEntries: Entry[]
  periodEntries: Entry[]
}

export function getReportContext(
  db: any,
  companyId: number,
  from: string,
  to: string,
  includeDrafts: boolean
): ReportContext {
  const company = db
    .query('SELECT id, name, address, phone, email, currency FROM companies WHERE id = ?')
    .get(companyId)
  if (!company) throw AppError.notFound('Perusahaan tidak ditemukan.')

  const accRows = db
    .query(
      `SELECT id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account, is_active
       FROM accounts WHERE company_id = ? ORDER BY code`
    )
    .all(companyId) as AnyRow[]

  const accounts: Account[] = accRows.map((r) => {
    let normalBalance: string = r.normal_balance
    if (normalBalance === '') {
      normalBalance = r.account_group === 'ASSET' || r.account_group === 'EXPENSE' ? 'DEBIT' : 'CREDIT'
    }
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      group: r.account_group,
      subtype: r.account_subtype ?? null,
      normal_balance: normalBalance,
      cash_flow_category: r.cash_flow_category,
      is_cash_account: r.is_cash_account !== 0,
      is_active: r.is_active !== 0
    }
  })

  const statusClause = includeDrafts
    ? "e.status IN ('POSTED', 'DRAFT')"
    : "e.status = 'POSTED'"

  const rows = db
    .query(
      `SELECT e.id, e.voucher_no, e.entry_date, e.description, e.source, e.status, e.reversal_of_id,
              EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_id = e.id) AS reversed,
              l.account_id, l.line_no, l.debit, l.credit, l.memo, a.code, a.name AS account_name
       FROM journal_entries e
       JOIN journal_lines l ON l.journal_entry_id = e.id
       JOIN accounts a ON a.id = l.account_id
       WHERE e.company_id = ? AND ${statusClause} AND e.entry_date <= ?
       ORDER BY e.entry_date, e.id, l.line_no`
    )
    .all(companyId, to) as AnyRow[]

  const entriesMap = new Map<number, Entry>()
  const orderedIds: number[] = []

  for (const r of rows) {
    const line: Line = {
      account_id: r.account_id,
      line_no: r.line_no,
      debit: roundMoney(r.debit),
      credit: roundMoney(r.credit),
      memo: r.memo ?? null,
      code: r.code ?? null,
      account_name: r.account_name ?? null
    }
    const existing = entriesMap.get(r.id)
    if (existing) {
      existing.lines.push(line)
    } else {
      orderedIds.push(r.id)
      entriesMap.set(r.id, {
        id: r.id,
        voucher_no: r.voucher_no,
        entry_date: dateText(r.entry_date),
        description: r.description,
        source: r.source,
        status: r.status,
        reversal_of_id: r.reversal_of_id ?? null,
        reversed: r.reversed !== 0,
        lines: [line]
      })
    }
  }

  const allEntries: Entry[] = orderedIds.map((id) => {
    const entry = entriesMap.get(id)!
    entry.lines.sort((a, b) => a.line_no - b.line_no)
    return entry
  })

  const periodEntries = allEntries.filter((entry) => entry.entry_date >= from)

  return { company, accounts, allEntries, periodEntries }
}

export function defaultRange(from: string | null, to: string | null): [string, string] {
  const today = new Date().toISOString().slice(0, 10)
  const fromValue = from ?? `${today.slice(0, 8)}01`
  return [fromValue, to ?? today]
}

export function reportRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  const db = state.db.connection
  const companyId = state.config.companyId

  return [
    ['GET', '/api/reports/:kind', async (ctx) => {
      const kind = ctx.params.kind
      const [from, to] = defaultRange(ctx.query.get('from'), ctx.query.get('to'))
      if (from > to) throw AppError.badRequest('Rentang tanggal tidak valid.')

      const includeDrafts = kind === 'journal'
      const reportCtx = getReportContext(db, companyId, from, to, includeDrafts)

      const allLines = flatten(reportCtx.allEntries)
      const periodLines = flatten(reportCtx.periodEntries)

      const data = buildReportData(kind, ctx, reportCtx, allLines, periodLines)

      return Response.json({
        company: reportCtx.company,
        period: { from, to },
        data
      })
    }],

    ['POST', '/api/periods/:id/close', async (ctx) => {
      const id = intParam(ctx, 'id')
      return state.db.withTransaction(() => {
        const period = db
          .query(
            'SELECT id, name, start_date, end_date, status FROM accounting_periods WHERE id = ? AND company_id = ?'
          )
          .get(id, companyId) as AnyRow | null
        if (!period) throw AppError.notFound('Periode tidak ditemukan.')
        if (period.status !== 'OPEN') throw AppError.badRequest('Periode sudah ditutup.')

        const reportCtx = getReportContext(
          db,
          companyId,
          period.start_date,
          period.end_date,
          false
        )
        const periodLines = flatten(reportCtx.periodEntries)
        const closingLines = makeClosingLines(reportCtx.accounts, periodLines)

        let closingEntryId: number | null = null
        if (closingLines.length > 0) {
          const voucherNo = `TUTUP-${period.end_date.replace(/-/g, '')}`
          const description = `Jurnal penutup periode ${period.name}`
          closingEntryId = writeClosingEntry(
            db,
            companyId,
            state.operatorId,
            voucherNo,
            period.end_date,
            description,
            closingLines,
            period.id
          )
        }

        db.run(
          `UPDATE accounting_periods SET status = 'CLOSED', closed_at = datetime('now', 'localtime'), closed_by = ? WHERE id = ?`,
          [state.operatorId, id]
        )
        db.run(
          `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
           VALUES (?, ?, 'ACCOUNTING_PERIOD', ?, 'CLOSED', ?)`,
          [companyId, state.operatorId, id, JSON.stringify({ closingEntryId })]
        )

        const netIncome = buildIncomeStatement(reportCtx.accounts, periodLines).netIncome
        return Response.json({ ok: true, entryId: closingEntryId, netIncome })
      })
    }]
  ]
}

function writeClosingEntry(
  db: any,
  companyId: number,
  operatorId: number,
  voucherNo: string,
  entryDate: string,
  description: string,
  lines: AmountedLine[],
  periodId: number
): number {
  const info = db.run(
    `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, created_by, posted_by, posted_at)
     VALUES (?, ?, ?, ?, ?, 'CLOSING', 'POSTED', ?, ?, datetime('now', 'localtime'))`,
    [companyId, periodId, voucherNo, entryDate, description, operatorId, operatorId]
  )
  const entryId = Number(info.lastInsertRowid)
  lines.forEach((line, index) => {
    db.run(
      'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
      [entryId, line.account_id, index + 1, null, line.debit, line.credit]
    )
  })
  db.run(
    `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
     VALUES (?, ?, 'JOURNAL_ENTRY', ?, 'POSTED', ?)`,
    [companyId, operatorId, entryId, JSON.stringify({ source: 'CLOSING', voucherNo })]
  )
  return entryId
}

function buildReportData(
  kind: string,
  ctx: Ctx,
  reportCtx: ReportContext,
  allLines: AmountedLine[],
  periodLines: AmountedLine[]
): unknown {
  switch (kind) {
    case 'journal': {
      const postedEntries = reportCtx.periodEntries.filter((entry) => entry.status === 'POSTED')
      return buildJournalReportData(reportCtx.periodEntries, postedEntries)
    }
    case 'trial-balance': {
      return buildTrialBalance(reportCtx.accounts, allLines)
    }
    case 'income-statement': {
      return buildIncomeStatement(reportCtx.accounts, periodLines)
    }
    case 'balance-sheet': {
      return buildBalanceSheet(reportCtx.accounts, allLines)
    }
    case 'equity-changes': {
      const [from] = defaultRange(ctx.query.get('from'), ctx.query.get('to'))
      const before = allLines.filter((line) => line.entry_date < from)
      return buildEquityChanges(reportCtx.accounts, before, periodLines)
    }
    case 'cash-flow': {
      return buildCashFlowDirect(reportCtx.accounts, reportCtx.periodEntries)
    }
    case 'ledger': {
      const accountId = Number(ctx.query.get('accountId'))
      if (!Number.isInteger(accountId)) {
        throw AppError.badRequest('Pilih akun untuk buku besar.')
      }
      const [from] = defaultRange(ctx.query.get('from'), ctx.query.get('to'))
      return buildLedgerData(reportCtx, accountId, from, allLines, periodLines)
    }
    case 'dashboard': {
      return buildDashboardData(reportCtx, periodLines, allLines)
    }
    default:
      throw AppError.notFound('Jenis laporan tidak ditemukan.')
  }
}

export function buildJournalReportData(allPeriod: Entry[], postedEntries: Entry[]): unknown {
  const debits = new Map<string, { name: string; amount: number }>()
  const credits = new Map<string, { name: string; amount: number }>()
  let totalDebit = 0
  let totalCredit = 0

  for (const entry of postedEntries) {
    for (const line of entry.lines) {
      const code = line.code ?? ''
      const name = line.account_name ?? ''

      if (line.debit > 0) {
        let item = debits.get(code)
        if (!item) {
          item = { name, amount: 0 }
          debits.set(code, item)
        }
        item.amount = roundMoney(item.amount + line.debit)
        totalDebit = roundMoney(totalDebit + line.debit)
      }
      if (line.credit > 0) {
        let item = credits.get(code)
        if (!item) {
          item = { name, amount: 0 }
          credits.set(code, item)
        }
        item.amount = roundMoney(item.amount + line.credit)
        totalCredit = roundMoney(totalCredit + line.credit)
      }
    }
  }

  const debitsList = [...debits.entries()]
    .map(([code, { name, amount }]) => ({ code, name, amount }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const creditsList = [...credits.entries()]
    .map(([code, { name, amount }]) => ({ code, name, amount }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))

  return {
    entries: allPeriod,
    recap: {
      debits: debitsList,
      credits: creditsList,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < MONEY_EPSILON
    }
  }
}

function buildLedgerData(
  reportCtx: ReportContext,
  accountId: number,
  from: string,
  allLines: AmountedLine[],
  periodLines: AmountedLine[]
): unknown {
  const targetAccount = reportCtx.accounts.find((account) => account.id === accountId)
  if (!targetAccount) throw AppError.badRequest('Pilih akun untuk buku besar.')

  const before = allLines.filter(
    (line) => line.account_id === accountId && line.entry_date < from
  )
  const initialBalance = accountBalance(
    targetAccount,
    calculateAccountBalances(reportCtx.accounts, before)
  )

  let running = initialBalance
  const rows: unknown[] = []

  for (const line of periodLines) {
    if (line.account_id !== accountId) continue
    if (targetAccount.normal_balance === 'DEBIT') {
      running = roundMoney(running + line.debit - line.credit)
    } else {
      running = roundMoney(running + line.credit - line.debit)
    }
    rows.push({
      account_id: line.account_id,
      line_no: line.line_no,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo,
      code: line.code,
      account_name: line.account_name,
      source: line.source,
      entry_date: line.entry_date,
      voucher_no: line.voucher_no,
      description: line.description,
      balance: running
    })
  }

  return {
    account: {
      id: targetAccount.id,
      code: targetAccount.code,
      name: targetAccount.name,
      account_group: targetAccount.group,
      account_subtype: targetAccount.subtype,
      normal_balance: targetAccount.normal_balance,
      cash_flow_category: targetAccount.cash_flow_category,
      is_cash_account: targetAccount.is_cash_account,
      is_active: targetAccount.is_active
    },
    opening: initialBalance,
    rows,
    closing: running
  }
}

function buildDashboardData(
  reportCtx: ReportContext,
  periodLines: AmountedLine[],
  allLines: AmountedLine[]
): unknown {
  const income = buildIncomeStatement(reportCtx.accounts, periodLines)
  const balance = buildBalanceSheet(reportCtx.accounts, allLines)

  const accountSubtypes = new Map<string, string>()
  for (const account of reportCtx.accounts) {
    accountSubtypes.set(String(account.id), account.subtype ?? '')
  }

  const totalOf = (rows: { accountId: number; amount: number }[], wanted: string[]): number => {
    let total = 0
    for (const row of rows) {
      const subtype = accountSubtypes.get(String(row.accountId))
      if (subtype && wanted.includes(subtype)) {
        total = roundMoney(total + row.amount)
      }
    }
    return total
  }

  return {
    cashBank: totalOf(balance.assets.rows, ['CASH', 'BANK']),
    receivables: totalOf(balance.assets.rows, ['RECEIVABLE']),
    payables: totalOf(balance.liabilities.rows, ['PAYABLE']),
    revenue: income.revenueTotal,
    expenses: income.expenseTotal,
    netIncome: income.netIncome
  }
}
