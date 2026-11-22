// Endpoint jurnal — port dari src-rust/httpapi/journals.rs.
import { AppError } from '../errors'
import {
  assertBalanced,
  dateText,
  normalizeAndAssert,
  type AmountedLine,
  type Entry,
  type Line
} from '../domain'
import { localTimestamp, yearMonthLocal } from '../lib/format'
import { intParam, readJson, strField, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>

export function journalRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  const db = state.db.connection
  const companyId = state.config.companyId

  function nextVoucher(yearMonth: string): string {
    const prefix = `JRN-${yearMonth}-`
    const last = db
      .query(
        'SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no LIKE ? ORDER BY id DESC LIMIT 1'
      )
      .get(companyId, `${prefix}%`) as { voucher_no: string } | null

    let sequence = 1
    if (last) {
      const pos = last.voucher_no.lastIndexOf('-')
      if (pos >= 0) {
        const parsed = Number(last.voucher_no.slice(pos + 1))
        if (Number.isInteger(parsed)) sequence = parsed + 1
      }
    }
    return `${prefix}${String(sequence).padStart(3, '0')}`
  }

  interface WriteParams {
    userId: number
    voucherNo: string
    entryDate: string
    description: string
    source: string
    status: string
    lines: AmountedLine[]
    importBatchId: number | null
    reversalOfId: number | null
  }

  function writeEntry(params: WriteParams): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.entryDate)) {
      throw AppError.badRequest('Tanggal jurnal tidak valid.')
    }

    const balanced = assertBalanced(params.lines)

    const period = db
      .query(
        `SELECT id, status FROM accounting_periods
         WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
      )
      .get(companyId, params.entryDate) as { id: number; status: string } | null

    if (!period) {
      throw AppError.badRequest('Tanggal transaksi belum memiliki periode akuntansi.')
    }
    if (period.status !== 'OPEN') {
      throw AppError.badRequest('Periode transaksi telah ditutup dan dikunci.')
    }

    // Validasi akun aktif
    const accountIds = new Set(balanced.map((line) => line.account_id))
    for (const accId of accountIds) {
      const account = db
        .query('SELECT is_active FROM accounts WHERE id = ? AND company_id = ?')
        .get(accId, companyId) as { is_active: number } | null
      if (!account || account.is_active !== 1) {
        throw AppError.badRequest('Satu atau beberapa akun tidak aktif atau tidak ditemukan.')
      }
    }

    const source = params.source === '' ? 'MANUAL' : params.source
    const status = params.status === '' ? 'DRAFT' : params.status
    const posted = status === 'POSTED'
    const postedBy = posted ? params.userId : null
    const postedAt = posted ? localTimestamp() : null

    const info = db.run(
      `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, import_batch_id, reversal_of_id, created_by, posted_by, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        period.id,
        params.voucherNo,
        params.entryDate,
        params.description,
        source,
        status,
        params.importBatchId,
        params.reversalOfId,
        params.userId,
        postedBy,
        postedAt
      ]
    )
    const entryId = Number(info.lastInsertRowid)

    for (let index = 0; index < balanced.length; index++) {
      const line = balanced[index]
      db.run(
        'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, line.account_id, index + 1, line.memo, line.debit, line.credit]
      )
    }

    const action = status === 'POSTED' ? 'POSTED' : 'CREATED'
    const details = JSON.stringify({ source, voucherNo: params.voucherNo })
    db.run(
      `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
       VALUES (?, ?, 'JOURNAL_ENTRY', ?, ?, ?)`,
      [companyId, state.operatorId, entryId, action, details]
    )

    return entryId
  }

  function fetchEntry(id: number): AnyRow {
    const entry = db
      .query(
        `SELECT e.id, e.company_id, e.period_id, e.voucher_no, e.entry_date, e.description,
                e.source, e.status, e.import_batch_id, e.reversal_of_id, e.created_by,
                e.posted_by, e.posted_at, e.created_at, e.updated_at, u.name AS created_by_name
         FROM journal_entries e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE e.id = ? AND e.company_id = ?`
      )
      .get(id, companyId) as AnyRow | null

    if (!entry) throw AppError.notFound('Jurnal tidak ditemukan.')

    const lines = db
      .query(
        `SELECT l.id, l.journal_entry_id, l.account_id, l.line_no, l.memo, l.debit, l.credit,
                a.code, a.name AS account_name
         FROM journal_lines l
         JOIN accounts a ON a.id = l.account_id
         WHERE l.journal_entry_id = ? ORDER BY l.line_no`
      )
      .all(id) as AnyRow[]

    return {
      id: entry.id,
      company_id: entry.company_id,
      period_id: entry.period_id,
      voucher_no: entry.voucher_no,
      entry_date: entry.entry_date,
      description: entry.description,
      source: entry.source,
      status: entry.status,
      import_batch_id: entry.import_batch_id ?? null,
      reversal_of_id: entry.reversal_of_id ?? null,
      created_by: entry.created_by,
      posted_by: entry.posted_by ?? null,
      posted_at: entry.posted_at ?? null,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      created_by_name: entry.created_by_name ?? null,
      lines: lines.map((row) => ({
        id: row.id,
        journal_entry_id: row.journal_entry_id,
        account_id: row.account_id,
        line_no: row.line_no,
        memo: row.memo ?? null,
        debit: row.debit,
        credit: row.credit,
        code: row.code,
        account_name: row.account_name
      }))
    }
  }

  return [
    ['GET', '/api/journals/next-voucher', async () => {
      const voucherNo = nextVoucher(yearMonthLocal())
      return Response.json({ voucherNo })
    }],

    ['POST', '/api/journals', async (ctx) => {
      const body = await readJson(ctx.req)
      let voucherNo = strField(body, 'voucherNo')
      const entryDate = strField(body, 'entryDate')
      const description = strField(body, 'description')
      let status = strField(body, 'status')
      if (status === '') status = 'DRAFT'

      if (description === '' || entryDate === '' || (status !== 'DRAFT' && status !== 'POSTED')) {
        throw AppError.badRequest('Tanggal, keterangan, dan status jurnal tidak valid.')
      }

      const rawLines = body.lines
      if (!Array.isArray(rawLines)) {
        throw AppError.badRequest('Jurnal harus memiliki sedikitnya dua baris.')
      }
      const normalized = normalizeAndAssert(rawLines as any)

      return state.db.withTransaction(() => {
        if (voucherNo === '') {
          if (entryDate.length >= 7) {
            voucherNo = nextVoucher(entryDate.slice(0, 7).replace('-', ''))
          }
          if (voucherNo === '') {
            throw AppError.badRequest('Tanggal jurnal tidak valid.')
          }
        }

        const id = writeEntry({
          userId: state.operatorId,
          voucherNo,
          entryDate,
          description,
          source: 'MANUAL',
          status,
          lines: normalized,
          importBatchId: null,
          reversalOfId: null
        })
        return Response.json({ id, voucherNo }, { status: 201 })
      })
    }],

    ['GET', '/api/journals/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      return Response.json({ entry: fetchEntry(id) })
    }],

    ['PUT', '/api/journals/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      const body = await readJson(ctx.req)
      const voucherNo = strField(body, 'voucherNo')
      const entryDate = strField(body, 'entryDate')
      const description = strField(body, 'description')

      const rawLines = body.lines
      if (!Array.isArray(rawLines)) {
        throw AppError.badRequest('Jurnal harus memiliki sedikitnya dua baris.')
      }
      const normalized = normalizeAndAssert(rawLines as any)

      return state.db.withTransaction(() => {
        const entry = fetchEntry(id)
        if (entry.status !== 'DRAFT') {
          throw AppError.badRequest('Hanya jurnal draft yang dapat diubah.')
        }

        const period = db
          .query(
            `SELECT id, status FROM accounting_periods
             WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
          )
          .get(companyId, entryDate) as { id: number; status: string } | null

        if (!period) {
          throw AppError.badRequest('Tanggal transaksi belum memiliki periode akuntansi.')
        }
        if (period.status !== 'OPEN') {
          throw AppError.badRequest('Periode transaksi telah ditutup dan dikunci.')
        }

        db.run(
          `UPDATE journal_entries SET voucher_no = ?, entry_date = ?, period_id = ?, description = ?, updated_at = datetime('now', 'localtime')
           WHERE id = ?`,
          [voucherNo, entryDate, period.id, description, id]
        )
        db.run('DELETE FROM journal_lines WHERE journal_entry_id = ?', [id])
        normalized.forEach((line, index) => {
          db.run(
            'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
            [id, line.account_id, index + 1, line.memo, line.debit, line.credit]
          )
        })
        db.run(
          `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
           VALUES (?, ?, 'JOURNAL_ENTRY', ?, 'UPDATED', NULL)`,
          [companyId, state.operatorId, id]
        )
        return Response.json({ ok: true })
      })
    }],

    ['POST', '/api/journals/:id/post', async (ctx) => {
      const id = intParam(ctx, 'id')
      return state.db.withTransaction(() => {
        const entry = fetchEntry(id)
        if (entry.status !== 'DRAFT') {
          throw AppError.badRequest('Jurnal ini sudah diposting.')
        }

        const period = db
          .query(
            `SELECT status FROM accounting_periods
             WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
          )
          .get(companyId, entry.entry_date) as { status: string } | null

        if (!period || period.status !== 'OPEN') {
          throw AppError.badRequest('Periode transaksi telah ditutup dan dikunci.')
        }

        db.run(
          `UPDATE journal_entries SET status = 'POSTED', posted_by = ?, posted_at = datetime('now', 'localtime') WHERE id = ?`,
          [state.operatorId, id]
        )
        db.run(
          `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
           VALUES (?, ?, 'JOURNAL_ENTRY', ?, 'POSTED', NULL)`,
          [companyId, state.operatorId, id]
        )
        return Response.json({ ok: true })
      })
    }],

    ['DELETE', '/api/journals/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      return state.db.withTransaction(() => {
        const entry = fetchEntry(id)
        if (entry.status !== 'DRAFT') {
          throw AppError.badRequest(
            `Jurnal ${entry.voucher_no} sudah diposting sehingga tidak dapat dihapus tanpa menghapus jejak audit. Gunakan Jurnal Pembalik.`
          )
        }
        if (entry.source !== 'MANUAL') {
          throw AppError.badRequest(
            'Jurnal hasil impor, penutup, atau pembalik tidak dapat dihapus. Buat jurnal koreksi manual.'
          )
        }
        db.run('DELETE FROM journal_lines WHERE journal_entry_id = ?', [id])
        db.run('DELETE FROM journal_entries WHERE id = ?', [id])
        db.run(
          `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
           VALUES (?, ?, 'JOURNAL_ENTRY', ?, 'DELETED', NULL)`,
          [companyId, state.operatorId, id]
        )
        return Response.json({ ok: true })
      })
    }],

    ['POST', '/api/journals/:id/reverse', async (ctx) => {
      const id = intParam(ctx, 'id')
      const body = await readJson(ctx.req)

      return state.db.withTransaction(() => {
        const original = fetchEntry(id)
        if (original.status !== 'POSTED') {
          throw AppError.badRequest('Hanya jurnal terposting yang dapat dibalik.')
        }

        const existing = db
          .query('SELECT id FROM journal_entries WHERE company_id = ? AND reversal_of_id = ? LIMIT 1')
          .get(companyId, id) as { id: number } | null
        if (existing) {
          throw AppError.badRequest(
            `Jurnal ${original.voucher_no} sudah memiliki pembalik dan tidak dapat dibalik dua kali.`
          )
        }

        const mirrored: AmountedLine[] = original.lines.map((line: Line) => ({
          account_id: line.account_id,
          line_no: line.line_no,
          debit: line.credit,
          credit: line.debit,
          memo: line.memo,
          code: null,
          account_name: null,
          source: '',
          entry_date: '',
          voucher_no: '',
          description: ''
        }))

        const voucherNo = strField(body, 'voucherNo') || `REV-${original.voucher_no}`
        const entryDate =
          dateText(strField(body, 'entryDate')) || dateText(original.entry_date as string)
        const description = `Pembalik: ${original.description}`

        const reversalId = writeEntry({
          userId: state.operatorId,
          voucherNo,
          entryDate,
          description,
          source: 'REVERSAL',
          status: 'POSTED',
          lines: mirrored,
          importBatchId: null,
          reversalOfId: id
        })

        db.run(
          `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
           VALUES (?, ?, 'JOURNAL_ENTRY', ?, 'REVERSED', ?)`,
          [companyId, state.operatorId, id, JSON.stringify({ reversalEntryId: reversalId })]
        )
        return Response.json({ id: reversalId }, { status: 201 })
      })
    }],

    ['GET', '/api/journals/:id/audit', async (ctx) => {
      const id = intParam(ctx, 'id')
      const logs = db
        .query(
          `SELECT a.id, a.company_id, a.user_id, a.entity_type, a.entity_id, a.action, a.details_json, a.created_at,
                  u.name AS user_name
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE a.company_id = ? AND a.entity_type = 'JOURNAL_ENTRY' AND a.entity_id = ?
           ORDER BY a.created_at DESC`
        )
        .all(companyId, id) as AnyRow[]

      const mapped = logs.map((row) => {
        let details: unknown = null
        if (typeof row.details_json === 'string') {
          try {
            details = JSON.parse(row.details_json)
          } catch {
            details = null
          }
        }
        return {
          id: row.id,
          company_id: row.company_id,
          user_id: row.user_id ?? null,
          user_name: row.user_name ?? null,
          entity_type: row.entity_type,
          entity_id: row.entity_id ?? null,
          action: row.action,
          action_label: auditLabel(row.action),
          details,
          created_at: row.created_at
        }
      })
      return Response.json({ logs: mapped })
    }]
  ]
}

function auditLabel(action: string): string {
  switch (action) {
    case 'CREATED':
      return 'Jurnal dibuat'
    case 'POSTED':
      return 'Jurnal diposting'
    case 'UPDATED':
      return 'Jurnal diubah'
    case 'REVERSED':
      return 'Jurnal dibalikkan'
    case 'DELETED':
      return 'Jurnal dihapus'
    default:
      return action
  }
}
