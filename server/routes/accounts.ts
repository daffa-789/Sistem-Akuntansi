// Endpoint perusahaan, akun, periode, template — port dari
// src-rust/httpapi/accounts.rs.
import { AppError } from '../errors'
import { boolField, intParam, readJson, strField, type AppState, type Ctx } from '../http/router'

// Semua handler dibuat lewat factory ini supaya punya akses ke AppState.
export function accountsRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  return [
    ['GET', '/api/company', async (ctx) => {
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

    ['GET', '/api/accounts', async (ctx) => {
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

    ['POST', '/api/accounts', async (ctx) => {
      const body = await readJson(ctx.req)
      const code = strField(body, 'code')
      const name = strField(body, 'name')
      const group = strField(body, 'accountGroup')
      const normalBalance = strField(body, 'normalBalance')

      const validGroups = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
      if (
        code === '' ||
        name === '' ||
        !validGroups.includes(group) ||
        (normalBalance !== 'DEBIT' && normalBalance !== 'CREDIT')
      ) {
        throw AppError.badRequest('Data akun tidak lengkap atau tidak valid.')
      }

      const subtype = strField(body, 'accountSubtype') || null
      let cashFlowCategory = strField(body, 'cashFlowCategory')
      if (cashFlowCategory === '') cashFlowCategory = 'OPERATING'
      const isCash = boolField(body, 'isCashAccount', false)

      const info = state.db.connection.run(
        `INSERT INTO accounts (company_id, code, name, account_group, account_subtype, normal_balance, cash_flow_category, is_cash_account)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          state.config.companyId,
          code,
          name,
          group,
          subtype,
          normalBalance,
          cashFlowCategory,
          isCash ? 1 : 0
        ]
      )
      state.db.audit(state.config.companyId, state.operatorId, 'ACCOUNT', Number(info.lastInsertRowid), 'CREATED', null)
      return Response.json({ id: Number(info.lastInsertRowid) }, { status: 201 })
    }],

    ['PUT', '/api/accounts/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      const body = await readJson(ctx.req)
      const name = strField(body, 'name')
      if (name === '') throw AppError.badRequest('Nama akun wajib diisi.')

      const subtype = strField(body, 'accountSubtype') || null
      let cashFlowCategory = strField(body, 'cashFlowCategory')
      if (cashFlowCategory === '') cashFlowCategory = 'OPERATING'
      const isCash = boolField(body, 'isCashAccount', false)
      const isActive = boolField(body, 'isActive', true)

      const info = state.db.connection.run(
        `UPDATE accounts SET name = ?, account_subtype = ?, cash_flow_category = ?, is_cash_account = ?, is_active = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ? AND company_id = ?`,
        [name, subtype, cashFlowCategory, isCash ? 1 : 0, isActive ? 1 : 0, id, state.config.companyId]
      )
      if (info.changes === 0) throw AppError.notFound('Akun tidak ditemukan.')
      state.db.audit(state.config.companyId, state.operatorId, 'ACCOUNT', id, 'UPDATED', null)
      return Response.json({ ok: true })
    }],

    ['GET', '/api/periods', async (ctx) => {
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
    }],

    ['GET', '/api/templates', async (ctx) => {
      const templates = state.db.connection
        .query(
          `SELECT id, company_id, name, description, lines_json, created_by, created_at
           FROM journal_templates WHERE company_id = ? ORDER BY name`
        )
        .all(state.config.companyId)
      return Response.json({
        templates: templates.map((row: any) => {
          let lines: unknown = []
          try {
            lines = JSON.parse(row.lines_json)
          } catch {
            lines = []
          }
          return {
            id: row.id,
            company_id: row.company_id,
            name: row.name,
            description: row.description,
            lines,
            created_by: row.created_by,
            created_at: row.created_at
          }
        })
      })
    }],

    ['POST', '/api/templates', async (ctx) => {
      const body = await readJson(ctx.req)
      const name = strField(body, 'name')
      const description = strField(body, 'description')
      const lines = body.lines
      if (!Array.isArray(lines) || lines.length === 0 || name === '') {
        throw AppError.badRequest('Nama template dan baris jurnal wajib diisi.')
      }
      const linesJson = JSON.stringify(lines)
      const info = state.db.connection.run(
        'INSERT INTO journal_templates (company_id, name, description, lines_json, created_by) VALUES (?, ?, ?, ?, ?)',
        [state.config.companyId, name, description, linesJson, state.operatorId]
      )
      return Response.json({ id: Number(info.lastInsertRowid) }, { status: 201 })
    }],

    ['DELETE', '/api/templates/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      state.db.connection.run('DELETE FROM journal_templates WHERE id = ? AND company_id = ?', [
        id,
        state.config.companyId
      ])
      return Response.json({ ok: true })
    }]
  ]
}
