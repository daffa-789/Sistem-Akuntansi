import { AppError } from '../errors'
import { readJson, strField, type AppState, type Ctx } from '../http/router'

export function accountsRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  return [
    ['GET', '/api/company', async () => {
      const company = state.db.connection
        .query(
          'SELECT id, name, address, phone, email, currency, fiscal_year_start, created_at, updated_at FROM companies WHERE id = ?'
        )
        .get(state.config.companyId) as Record<string, unknown>
      if (!company) throw AppError.notFound('Perusahaan tidak ditemukan.')
      return Response.json({ company })
    }],

    ['PUT', '/api/company', async (ctx) => {
      const body = await readJson(ctx.req)
      const name = strField(body, 'name')
      if (name === '') throw AppError.badRequest('Nama perusahaan wajib diisi.')

      const address = strField(body, 'address') || null
      const phone = strField(body, 'phone') || null
      const email = strField(body, 'email') || null
      const fiscalYearStartRaw = body.fiscalYearStart
      let fiscalYearStart = 1
      if (typeof fiscalYearStartRaw === 'number' && Number.isFinite(fiscalYearStartRaw)) {
        fiscalYearStart = Math.trunc(fiscalYearStartRaw)
      }

      state.db.connection.run(
        `UPDATE companies SET name = ?, address = ?, phone = ?, email = ?, fiscal_year_start = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [name, address, phone, email, fiscalYearStart, state.config.companyId]
      )
      return Response.json({ ok: true })
    }],

    ['GET', '/api/accounts', async () => {
      const accounts = state.db.connection
        .query(
          `SELECT id, company_id, code, name, account_group, account_subtype, normal_balance,
                  cash_flow_category, is_cash_account, is_active, created_at, updated_at
           FROM accounts WHERE company_id = ? ORDER BY code`
        )
        .all(state.config.companyId)
      return Response.json({
        accounts: accounts.map((row: any) => ({
          id: row.id,
          company_id: row.company_id,
          code: row.code,
          name: row.name,
          account_group: row.account_group,
          account_subtype: row.account_subtype ?? null,
          normal_balance: row.normal_balance,
          cash_flow_category: row.cash_flow_category,
          is_cash_account: row.is_cash_account !== 0,
          is_active: row.is_active !== 0,
          created_at: row.created_at,
          updated_at: row.updated_at
        }))
      })
    }],

    ['GET', '/api/periods', async () => {
      const periods = state.db.connection
        .query(
          `SELECT id, company_id, name, start_date, end_date, status, closed_at, closed_by, created_at
           FROM accounting_periods WHERE company_id = ? ORDER BY start_date DESC`
        )
        .all(state.config.companyId)
      return Response.json({
        periods: periods.map((row: any) => ({
          id: row.id,
          company_id: row.company_id,
          name: row.name,
          start_date: row.start_date,
          end_date: row.end_date,
          status: row.status,
          closed_at: row.closed_at ?? null,
          closed_by: row.closed_by ?? null,
          created_at: row.created_at
        }))
      })
    }],

    ['POST', '/api/periods', async (ctx) => {
      const body = await readJson(ctx.req)
      const name = strField(body, 'name')
      const startDate = strField(body, 'startDate')
      const endDate = strField(body, 'endDate')
      if (name === '' || startDate === '' || endDate === '' || startDate > endDate) {
        throw AppError.badRequest('Nama dan rentang tanggal periode tidak valid.')
      }
      const info = state.db.connection.run(
        'INSERT INTO accounting_periods (company_id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
        [state.config.companyId, name, startDate, endDate]
      )
      return Response.json({ id: Number(info.lastInsertRowid) }, { status: 201 })
    }]
  ]
}
