// Endpoint Siklus Pendapatan (BAB V.pptx bagian B).
//
// Alur: pesanan penjualan (SO) -> penyajian/pengiriman -> faktur penjualan
// (tunai langsung kas, kredit lewat persetujuan manajer) -> penerimaan kas
// (BKM) -> setoran bank. Pemisahan tugas: penjualan, gudang, penagihan
// (akuntansi), dan penerimaan kas (keuangan) adalah akun login berbeda.
import { AppError } from '../errors'
import { assertBalanced, roundMoney, type AmountedLine } from '../domain'
import {
  assertCreditAllowed,
  assertReceiptAmount,
  buildOrderItems,
  cashAccountCodeFor,
  creditAvailable,
  invoiceRemaining,
  orderTotal,
  type OrderItemInput
} from '../revenue-domain'
import { localTimestamp } from '../lib/format'
import { intParam, readJson, strField, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>
type Handler = (ctx: Ctx) => Response | Promise<Response>

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Bagian B BAB V: enam dokumen siklus pendapatan.
export const REVENUE_DOCUMENT_TYPES = [
  ['SALES_ORDER', 'Pesanan penjualan (sales order)', 'Catatan pesanan pelanggan beserta menu, jumlah, dan harga.'],
  ['DELIVERY_NOTE', 'Dokumen penyajian / surat jalan', 'Bukti pesanan telah disajikan atau dikirim ke pelanggan.'],
  ['SALES_INVOICE', 'Faktur penjualan', 'Dokumen penagihan atas pesanan yang sudah disajikan.'],
  ['CASH_RECEIPT', 'Bukti penerimaan kas', 'Bukti penerimaan pembayaran pelanggan.'],
  ['BANK_DEPOSIT', 'Bukti setoran bank', 'Bukti penyetoran kas ke rekening bank perusahaan.'],
  ['RECEIVABLE_CARD', 'Kartu piutang pelanggan', 'Catatan mutasi piutang setiap pelanggan.']
] as const

function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function numField(body: Record<string, unknown>, key: string, fallback = 0): number {
  const raw = body[key]
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) throw AppError.badRequest(`Kolom ${key} harus berupa angka.`)
  return value
}

function lastDayOf(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period}-${String(day).padStart(2, '0')}`
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

export function revenueRoutes(state: AppState): Array<[string, string, Handler]> {
  const db = state.db.connection
  const companyId = state.config.companyId

  /** Peran dan identitas berasal dari sesi login, bukan dari body request. */
  function actorOf(ctx: Ctx) {
    if (!ctx.user) throw new AppError(401, 'Silakan masuk terlebih dahulu.')
    return ctx.user
  }

  function assertRole(ctx: Ctx, roles: string[], message: string): void {
    const role = actorOf(ctx).role
    if (!roles.includes(role)) throw AppError.badRequest(message)
  }

  function audit(ctx: Ctx, entityType: string, entityId: number | null, action: string, details: unknown): void {
    state.db.audit(companyId, actorOf(ctx).id, entityType, entityId, action, details)
  }

  function accountId(code: string): number {
    const row = db
      .query('SELECT id FROM accounts WHERE company_id = ? AND code = ?')
      .get(companyId, code) as { id: number } | null
    if (!row) throw AppError.badRequest(`Akun ${code} belum tersedia dalam bagan akun.`)
    return row.id
  }

  /** Nomor dokumen berurutan per bulan: SO-202606-001, FJ-202606-001, BKM-202606-001. */
  function nextDocNo(prefix: string, table: string, column: string, date: string): string {
    const stamp = date.slice(0, 7).replace('-', '')
    const fullPrefix = `${prefix}-${stamp}-`
    const last = db
      .query(`SELECT ${column} AS no FROM ${table} WHERE company_id = ? AND ${column} LIKE ? ORDER BY id DESC LIMIT 1`)
      .get(companyId, `${fullPrefix}%`) as { no: string } | null
    let sequence = 1
    if (last) {
      const parsed = Number(String(last.no).slice(fullPrefix.length))
      if (Number.isInteger(parsed)) sequence = parsed + 1
    }
    return `${fullPrefix}${String(sequence).padStart(3, '0')}`
  }

  function nextVoucher(period: string): string {
    const prefix = `REV-${period}-`
    const last = db
      .query(
        'SELECT voucher_no FROM journal_entries WHERE company_id = ? AND voucher_no LIKE ? ORDER BY id DESC LIMIT 1'
      )
      .get(companyId, `${prefix}%`) as { voucher_no: string } | null
    let sequence = 1
    if (last) {
      const parsed = Number(last.voucher_no.slice(prefix.length))
      if (Number.isInteger(parsed)) sequence = parsed + 1
    }
    return `${prefix}${String(sequence).padStart(3, '0')}`
  }

  function postJournal(
    ctx: Ctx,
    period: string,
    entryDate: string,
    description: string,
    lines: AmountedLine[]
  ): number {
    if (!DATE_RE.test(entryDate)) throw AppError.badRequest('Tanggal jurnal pendapatan tidak valid.')
    const balanced = assertBalanced(lines)
    const accountingPeriod = db
      .query(
        `SELECT id, status FROM accounting_periods
         WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
      )
      .get(companyId, entryDate) as { id: number; status: string } | null
    if (!accountingPeriod) throw AppError.badRequest('Tanggal jurnal belum memiliki periode akuntansi.')
    if (accountingPeriod.status !== 'OPEN') throw AppError.badRequest('Periode akuntansi telah ditutup.')

    const voucherNo = nextVoucher(period)
    const info = db.run(
      `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, created_by, posted_by, posted_at)
       VALUES (?, ?, ?, ?, ?, 'REVENUE', 'POSTED', ?, ?, ?)`,
      [companyId, accountingPeriod.id, voucherNo, entryDate, description, actorOf(ctx).id, actorOf(ctx).id, localTimestamp()]
    )
    const entryId = Number(info.lastInsertRowid)
    balanced.forEach((line, index) => {
      db.run(
        'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, line.account_id, index + 1, line.memo, line.debit, line.credit]
      )
    })
    audit(ctx, 'JOURNAL_ENTRY', entryId, 'POSTED', { source: 'REVENUE', voucherNo })
    return entryId
  }

  function customerOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM revenue_customers WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Pelanggan tidak ditemukan.')
    return row
  }

  function menuOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM revenue_menu_items WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Menu tidak ditemukan.')
    return row
  }

  function orderOf(id: number): AnyRow {
    const row = db
      .query(
        `SELECT o.*, c.name AS customer_name, c.customer_type, c.credit_limit
         FROM revenue_orders o JOIN revenue_customers c ON c.id = o.customer_id
         WHERE o.id = ? AND o.company_id = ?`
      )
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Pesanan penjualan tidak ditemukan.')
    return row
  }

  function orderItemsOf(orderId: number): AnyRow[] {
    return db
      .query('SELECT * FROM revenue_order_items WHERE order_id = ? ORDER BY id')
      .all(orderId) as AnyRow[]
  }

  function orderTotalOf(orderId: number): number {
    const row = db
      .query('SELECT COALESCE(SUM(line_total), 0) AS total FROM revenue_order_items WHERE order_id = ?')
      .get(orderId) as { total: number }
    return roundMoney(Number(row.total))
  }

  function invoiceOf(id: number): AnyRow {
    const row = db
      .query(
        `SELECT i.*, o.order_no, o.payment_type, c.name AS customer_name, c.customer_type
         FROM revenue_invoices i
         JOIN revenue_orders o ON o.id = i.order_id
         JOIN revenue_customers c ON c.id = i.customer_id
         WHERE i.id = ? AND i.company_id = ?`
      )
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Faktur penjualan tidak ditemukan.')
    return row
  }

  function receiptOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM revenue_receipts WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Bukti penerimaan kas tidak ditemukan.')
    return row
  }

  /** Piutang berjalan pelanggan: total sisa faktur OPEN. */
  function outstandingOf(customerId: number): number {
    const row = db
      .query(
        `SELECT COALESCE(SUM(amount - paid), 0) AS outstanding
         FROM revenue_invoices WHERE company_id = ? AND customer_id = ? AND status = 'OPEN'`
      )
      .get(companyId, customerId) as { outstanding: number }
    return roundMoney(Number(row.outstanding))
  }

  function validateCustomer(body: Record<string, unknown>): void {
    if (!strField(body, 'customer_code')) throw AppError.badRequest('Kode pelanggan wajib diisi.')
    if (!strField(body, 'name')) throw AppError.badRequest('Nama pelanggan wajib diisi.')
    const type = strField(body, 'customer_type') || 'TUNAI'
    if (!['TUNAI', 'MEMBER', 'KORPORAT'].includes(type)) {
      throw AppError.badRequest('Tipe pelanggan tidak dikenal.')
    }
    if (numField(body, 'credit_limit') < 0) throw AppError.badRequest('Limit kredit tidak boleh negatif.')
  }

  function validateMenu(body: Record<string, unknown>): void {
    if (!strField(body, 'item_code')) throw AppError.badRequest('Kode menu wajib diisi.')
    if (!strField(body, 'name')) throw AppError.badRequest('Nama menu wajib diisi.')
    const category = strField(body, 'category') || 'MINUMAN'
    if (!['MINUMAN', 'MAKANAN', 'DESSERT', 'PAKET_EVENT', 'MERCH'].includes(category)) {
      throw AppError.badRequest('Kategori menu tidak dikenal.')
    }
    if (numField(body, 'unit_price') < 0) throw AppError.badRequest('Harga jual tidak boleh negatif.')
  }

  return [
    ['GET', '/api/revenue/customers', () => {
      const rows = db
        .query('SELECT * FROM revenue_customers WHERE company_id = ? ORDER BY customer_code')
        .all(companyId)
      return Response.json({ customers: rows })
    }],

    ['POST', '/api/revenue/customers', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PENJUALAN'], 'Data pelanggan dikelola oleh bagian penjualan.')
      const body = await readJson(ctx.req)
      validateCustomer(body)
      const type = strField(body, 'customer_type') || 'TUNAI'
      const info = db.run(
        `INSERT INTO revenue_customers
          (company_id, customer_code, name, customer_type, phone, address, credit_limit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          strField(body, 'customer_code').toUpperCase(),
          strField(body, 'name'),
          type,
          strField(body, 'phone'),
          strField(body, 'address'),
          type === 'TUNAI' ? 0 : numField(body, 'credit_limit')
        ]
      )
      const id = Number(info.lastInsertRowid)
      audit(ctx, 'REVENUE_CUSTOMER', id, 'CREATED', { code: strField(body, 'customer_code') })
      return Response.json({ id }, { status: 201 })
    }],

    ['PUT', '/api/revenue/customers/:id', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PENJUALAN'], 'Data pelanggan dikelola oleh bagian penjualan.')
      const customer = customerOf(intParam(ctx, 'id'))
      const body = await readJson(ctx.req)
      validateCustomer(body)
      const type = strField(body, 'customer_type') || 'TUNAI'
      db.run(
        `UPDATE revenue_customers SET customer_code = ?, name = ?, customer_type = ?, phone = ?,
         address = ?, credit_limit = ?, is_active = ?, updated_at = datetime('now','localtime')
         WHERE id = ? AND company_id = ?`,
        [
          strField(body, 'customer_code').toUpperCase(),
          strField(body, 'name'),
          type,
          strField(body, 'phone'),
          strField(body, 'address'),
          type === 'TUNAI' ? 0 : numField(body, 'credit_limit'),
          numField(body, 'is_active', customer.is_active ? 1 : 0) ? 1 : 0,
          customer.id,
          companyId
        ]
      )
      audit(ctx, 'REVENUE_CUSTOMER', customer.id, 'UPDATED', { code: strField(body, 'customer_code') })
      return Response.json({ ok: true })
    }],

    ['GET', '/api/revenue/menu-items', () => {
      const rows = db
        .query('SELECT * FROM revenue_menu_items WHERE company_id = ? ORDER BY item_code')
        .all(companyId)
      return Response.json({ menu_items: rows })
    }],

    ['POST', '/api/revenue/menu-items', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PENJUALAN'], 'Data menu dikelola oleh bagian penjualan.')
      const body = await readJson(ctx.req)
      validateMenu(body)
      const info = db.run(
        `INSERT INTO revenue_menu_items (company_id, item_code, name, category, unit_price)
         VALUES (?, ?, ?, ?, ?)`,
        [
          companyId,
          strField(body, 'item_code').toUpperCase(),
          strField(body, 'name'),
          strField(body, 'category') || 'MINUMAN',
          numField(body, 'unit_price')
        ]
      )
      const id = Number(info.lastInsertRowid)
      audit(ctx, 'REVENUE_MENU', id, 'CREATED', { code: strField(body, 'item_code') })
      return Response.json({ id }, { status: 201 })
    }],

    ['PUT', '/api/revenue/menu-items/:id', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PENJUALAN'], 'Data menu dikelola oleh bagian penjualan.')
      const menu = menuOf(intParam(ctx, 'id'))
      const body = await readJson(ctx.req)
      validateMenu(body)
      db.run(
        `UPDATE revenue_menu_items SET item_code = ?, name = ?, category = ?, unit_price = ?,
         is_active = ?, updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
        [
          strField(body, 'item_code').toUpperCase(),
          strField(body, 'name'),
          strField(body, 'category') || 'MINUMAN',
          numField(body, 'unit_price'),
          numField(body, 'is_active', menu.is_active ? 1 : 0) ? 1 : 0,
          menu.id,
          companyId
        ]
      )
      audit(ctx, 'REVENUE_MENU', menu.id, 'UPDATED', { code: strField(body, 'item_code') })
      return Response.json({ ok: true })
    }],

    ['GET', '/api/revenue/orders', () => {
      const rows = db
        .query(
          `SELECT o.*, c.name AS customer_name, c.customer_type,
             (SELECT COALESCE(SUM(line_total), 0) FROM revenue_order_items i WHERE i.order_id = o.id) AS total
           FROM revenue_orders o JOIN revenue_customers c ON c.id = o.customer_id
           WHERE o.company_id = ?
           ORDER BY o.order_date DESC, o.id DESC`
        )
        .all(companyId) as AnyRow[]
      return Response.json({ orders: rows })
    }],

    ['GET', '/api/revenue/orders/:id', (ctx) => {
      const order = orderOf(intParam(ctx, 'id'))
      return Response.json({ order: { ...order, total: orderTotalOf(order.id), items: orderItemsOf(order.id) } })
    }],

    ['POST', '/api/revenue/orders', async (ctx) => {
      const body = await readJson(ctx.req)
      const orderDate = strField(body, 'order_date')
      if (!isValidDate(orderDate)) throw AppError.badRequest('Tanggal pesanan tidak valid.')
      const customerId = Number(body.customer_id)
      if (!Number.isInteger(customerId)) throw AppError.badRequest('Pelanggan tidak valid.')
      const customer = customerOf(customerId)
      if (Number(customer.is_active) !== 1) throw AppError.badRequest('Pelanggan tidak aktif.')
      const orderType = strField(body, 'order_type') || 'DINE_IN'
      if (!['DINE_IN', 'TAKE_AWAY', 'CATERING', 'EVENT'].includes(orderType)) {
        throw AppError.badRequest('Jenis pesanan tidak dikenal.')
      }
      const paymentType = strField(body, 'payment_type') || 'TUNAI'
      if (!['TUNAI', 'KREDIT'].includes(paymentType)) throw AppError.badRequest('Jenis pembayaran tidak dikenal.')
      if (paymentType === 'KREDIT' && Number(customer.credit_limit) <= 0) {
        throw AppError.badRequest('Pelanggan tidak memiliki limit kredit. Gunakan pembayaran tunai.')
      }
      const rawItems = Array.isArray(body.items) ? body.items as OrderItemInput[] : []
      const items = buildOrderItems(rawItems.map((item) => ({
        ...item,
        description: item.description || (item.menu_item_id ? String(menuOf(Number(item.menu_item_id)).name) : '')
      })))
      const total = orderTotal(items)
      const orderNo = nextDocNo('SO', 'revenue_orders', 'order_no', orderDate)

      let orderId = 0
      state.db.withTransaction(() => {
        const info = db.run(
          `INSERT INTO revenue_orders
            (company_id, order_no, order_date, customer_id, order_type, payment_type, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?)`,
          [companyId, orderNo, orderDate, customerId, orderType, paymentType, strField(body, 'notes') || null]
        )
        orderId = Number(info.lastInsertRowid)
        for (const item of items) {
          db.run(
            `INSERT INTO revenue_order_items (company_id, order_id, menu_item_id, description, qty, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [companyId, orderId, item.menu_item_id, item.description, item.qty, item.unit_price, item.line_total]
          )
        }
        audit(ctx, 'REVENUE_ORDER', orderId, 'CREATED', { orderNo, total, paymentType })
      })
      return Response.json({ id: orderId, order_no: orderNo, total }, { status: 201 })
    }],

    ['POST', '/api/revenue/orders/:id/confirm', (ctx) => {
      assertRole(ctx, ['ADMIN', 'PENJUALAN'], 'Penerimaan pesanan pelanggan dilakukan bagian penjualan.')
      const order = orderOf(intParam(ctx, 'id'))
      if (order.status !== 'DRAFT') throw AppError.badRequest('Pesanan sudah diproses atau dibatalkan.')
      db.run(
        `UPDATE revenue_orders SET status = 'DITERIMA', updated_at = datetime('now','localtime')
         WHERE id = ? AND company_id = ?`,
        [order.id, companyId]
      )
      audit(ctx, 'REVENUE_ORDER', order.id, 'CONFIRMED', { orderNo: order.order_no })
      return Response.json({ ok: true })
    }],

    ['POST', '/api/revenue/orders/:id/serve', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'GUDANG'], 'Penyajian pesanan dicatat bagian gudang / pelayanan.')
      const order = orderOf(intParam(ctx, 'id'))
      if (order.status !== 'DITERIMA') {
        throw AppError.badRequest('Pesanan harus dikonfirmasi bagian penjualan sebelum disajikan.')
      }
      const body = await readJson(ctx.req)
      db.run(
        `UPDATE revenue_orders SET status = 'DISAJIKAN', served_at = datetime('now','localtime'),
         served_note = ?, updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
        [strField(body, 'served_note') || 'Pesanan disajikan sesuai pesanan penjualan.', order.id, companyId]
      )
      audit(ctx, 'REVENUE_ORDER', order.id, 'SERVED', { orderNo: order.order_no })
      return Response.json({ ok: true })
    }],

    ['POST', '/api/revenue/orders/:id/approve-credit', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'SDM_MANAGER'], 'Persetujuan penjualan kredit harus dilakukan manajer.')
      const order = orderOf(intParam(ctx, 'id'))
      if (order.status === 'DIBATALKAN') throw AppError.badRequest('Pesanan sudah dibatalkan.')
      if (order.payment_type !== 'KREDIT') {
        throw AppError.badRequest('Persetujuan kredit hanya untuk pesanan dengan pembayaran kredit.')
      }
      if (order.credit_approved_at) throw AppError.badRequest('Pesanan ini sudah disetujui.')
      const body = await readJson(ctx.req)
      const total = orderTotalOf(order.id)
      const outstanding = outstandingOf(order.customer_id)
      assertCreditAllowed({
        paymentType: 'KREDIT',
        customerType: String(order.customer_type),
        creditLimit: Number(order.credit_limit),
        outstanding,
        orderTotal: total,
        creditApproved: true
      })
      db.run(
        `UPDATE revenue_orders SET credit_approved_by = ?, credit_approved_at = datetime('now','localtime'),
         credit_approval_note = ?, updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
        [actorOf(ctx).id, strField(body, 'note') || 'Disetujui sesuai limit kredit pelanggan.', order.id, companyId]
      )
      audit(ctx, 'REVENUE_ORDER', order.id, 'CREDIT_APPROVED', {
        orderNo: order.order_no, total, outstanding, limit: Number(order.credit_limit)
      })
      return Response.json({ ok: true, remaining: creditAvailable(Number(order.credit_limit), outstanding + total) })
    }],

    ['POST', '/api/revenue/orders/:id/invoice', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'AKUNTANSI'], 'Penagihan pelanggan dilakukan bagian akuntansi.')
      const order = orderOf(intParam(ctx, 'id'))
      if (order.status !== 'DISAJIKAN') {
        throw AppError.badRequest('Faktur hanya dibuat untuk pesanan yang sudah disajikan.')
      }
      const body = await readJson(ctx.req)
      const invoiceDate = strField(body, 'invoice_date') || order.order_date
      if (!isValidDate(invoiceDate)) throw AppError.badRequest('Tanggal faktur tidak valid.')
      const total = orderTotalOf(order.id)
      if (total <= 0) throw AppError.badRequest('Pesanan belum memiliki item yang dinilai.')

      const revenueAccount = accountId('4100')
      const receivableAccount = accountId('1130')
      let invoiceId = 0
      let invoiceNo = ''
      let journalId = 0

      state.db.withTransaction(() => {
        if (order.payment_type === 'KREDIT') {
          if (!order.credit_approved_at) {
            throw AppError.badRequest('Penjualan kredit belum disetujui manajer.')
          }
          const outstanding = outstandingOf(order.customer_id)
          assertCreditAllowed({
            paymentType: 'KREDIT',
            customerType: String(order.customer_type),
            creditLimit: Number(order.credit_limit),
            outstanding,
            orderTotal: total,
            creditApproved: true
          })
          invoiceNo = nextDocNo('FJ', 'revenue_invoices', 'invoice_no', invoiceDate)
          const info = db.run(
            `INSERT INTO revenue_invoices
              (company_id, invoice_no, invoice_date, order_id, customer_id, amount, due_date, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
            [companyId, invoiceNo, invoiceDate, order.id, order.customer_id, total, strField(body, 'due_date') || addDays(invoiceDate, 14)]
          )
          invoiceId = Number(info.lastInsertRowid)
          const lines: AmountedLine[] = [
            { account_id: receivableAccount, debit: total, credit: 0, memo: 'Piutang usaha pelanggan' },
            { account_id: revenueAccount, debit: 0, credit: total, memo: 'Pendapatan menu & layanan' }
          ]
          journalId = postJournal(
            ctx,
            invoiceDate.slice(0, 7),
            invoiceDate,
            `Faktur penjualan ${invoiceNo} — ${order.customer_name} (pesanan ${order.order_no})`,
            lines
          )
          db.run('UPDATE revenue_invoices SET accrual_journal_id = ? WHERE id = ?', [journalId, invoiceId])
        } else {
          // Penjualan tunai: pendapatan diakui langsung saat kas diterima
          // (bukti penerimaan kas dibuat otomatis bersama faktur).
          const method = strField(body, 'method') === 'KAS' ? 'KAS' : 'BANK'
          const cashAccount = accountId(cashAccountCodeFor(method))
          invoiceNo = nextDocNo('FJ', 'revenue_invoices', 'invoice_no', invoiceDate)
          const info = db.run(
            `INSERT INTO revenue_invoices
              (company_id, invoice_no, invoice_date, order_id, customer_id, amount, paid, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID')`,
            [companyId, invoiceNo, invoiceDate, order.id, order.customer_id, total, total]
          )
          invoiceId = Number(info.lastInsertRowid)
          const receiptNo = nextDocNo('BKM', 'revenue_receipts', 'receipt_no', invoiceDate)
          const receiptInfo = db.run(
            `INSERT INTO revenue_receipts
              (company_id, receipt_no, receipt_date, invoice_id, amount, method, deposit_status, deposited_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
            [
              companyId, receiptNo, invoiceDate, invoiceId, total, method,
              method === 'BANK' ? 'DEPOSITED' : 'NOT_DEPOSITED'
            ]
          )
          const receiptId = Number(receiptInfo.lastInsertRowid)
          const lines: AmountedLine[] = [
            { account_id: cashAccount, debit: total, credit: 0, memo: 'Penerimaan kas penjualan tunai' },
            { account_id: revenueAccount, debit: 0, credit: total, memo: 'Pendapatan menu & layanan' }
          ]
          journalId = postJournal(
            ctx,
            invoiceDate.slice(0, 7),
            invoiceDate,
            `Penjualan tunai ${invoiceNo} — ${order.customer_name} (bukti ${receiptNo})`,
            lines
          )
          db.run('UPDATE revenue_receipts SET payment_journal_id = ? WHERE id = ?', [journalId, receiptId])
        }
        db.run(
          `UPDATE revenue_orders SET status = 'DIFAKTURKAN', updated_at = datetime('now','localtime')
           WHERE id = ? AND company_id = ?`,
          [order.id, companyId]
        )
        audit(ctx, 'REVENUE_ORDER', order.id, 'INVOICED', { invoiceNo, total, journalId })
      })
      return Response.json({ ok: true, id: invoiceId, invoice_no: invoiceNo, journalId }, { status: 201 })
    }],

    ['POST', '/api/revenue/orders/:id/cancel', (ctx) => {
      assertRole(ctx, ['ADMIN', 'PENJUALAN'], 'Pembatalan pesanan dilakukan bagian penjualan.')
      const order = orderOf(intParam(ctx, 'id'))
      if (!['DRAFT', 'DITERIMA'].includes(order.status)) {
        throw AppError.badRequest('Pesanan yang sudah disajikan atau difakturkan tidak dapat dibatalkan.')
      }
      db.run(
        `UPDATE revenue_orders SET status = 'DIBATALKAN', updated_at = datetime('now','localtime')
         WHERE id = ? AND company_id = ?`,
        [order.id, companyId]
      )
      audit(ctx, 'REVENUE_ORDER', order.id, 'CANCELLED', { orderNo: order.order_no })
      return Response.json({ ok: true })
    }],

    ['GET', '/api/revenue/invoices', () => {
      const rows = db
        .query(
          `SELECT i.*, o.order_no, o.payment_type, c.name AS customer_name, c.customer_type
           FROM revenue_invoices i
           JOIN revenue_orders o ON o.id = i.order_id
           JOIN revenue_customers c ON c.id = i.customer_id
           WHERE i.company_id = ?
           ORDER BY i.invoice_date DESC, i.id DESC`
        )
        .all(companyId) as AnyRow[]
      return Response.json({ invoices: rows })
    }],

    ['GET', '/api/revenue/receipts', () => {
      const rows = db
        .query(
          `SELECT r.*, i.invoice_no, i.amount AS invoice_amount
           FROM revenue_receipts r JOIN revenue_invoices i ON i.id = r.invoice_id
           WHERE r.company_id = ?
           ORDER BY r.receipt_date DESC, r.id DESC`
        )
        .all(companyId) as AnyRow[]
      return Response.json({ receipts: rows })
    }],

    ['POST', '/api/revenue/receipts', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'KEUANGAN'], 'Penerimaan kas dilakukan bagian keuangan.')
      const body = await readJson(ctx.req)
      const invoice = invoiceOf(Number(body.invoice_id))
      if (invoice.status !== 'OPEN') throw AppError.badRequest('Faktur ini sudah lunas.')
      if (invoice.payment_type !== 'KREDIT') {
        throw AppError.badRequest('Faktur penjualan tunai dibayar langsung saat faktur dibuat.')
      }
      const method = strField(body, 'method') === 'KAS' ? 'KAS' : 'BANK'
      const remaining = invoiceRemaining(invoice.amount, invoice.paid)
      const amount = assertReceiptAmount(numField(body, 'amount'), remaining)
      const receiptDate = strField(body, 'receipt_date') || invoice.invoice_date
      if (!isValidDate(receiptDate)) throw AppError.badRequest('Tanggal penerimaan tidak valid.')

      const cashAccount = accountId(cashAccountCodeFor(method))
      const receivableAccount = accountId('1130')
      let receiptId = 0
      let receiptNo = ''
      let journalId = 0
      state.db.withTransaction(() => {
        receiptNo = nextDocNo('BKM', 'revenue_receipts', 'receipt_no', receiptDate)
        const info = db.run(
          `INSERT INTO revenue_receipts
            (company_id, receipt_no, receipt_date, invoice_id, amount, method, deposit_status, deposited_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId, receiptNo, receiptDate, invoice.id, amount, method,
            method === 'BANK' ? 'DEPOSITED' : 'NOT_DEPOSITED',
            method === 'BANK' ? localTimestamp() : null
          ]
        )
        receiptId = Number(info.lastInsertRowid)
        const lines: AmountedLine[] = [
          { account_id: cashAccount, debit: amount, credit: 0, memo: 'Penerimaan kas dari pelanggan' },
          { account_id: receivableAccount, debit: 0, credit: amount, memo: 'Pelunasan piutang usaha' }
        ]
        journalId = postJournal(
          ctx,
          receiptDate.slice(0, 7),
          receiptDate,
          `Penerimaan kas ${receiptNo} — ${invoice.customer_name} (faktur ${invoice.invoice_no})`,
          lines
        )
        db.run('UPDATE revenue_receipts SET payment_journal_id = ? WHERE id = ?', [journalId, receiptId])
        const paid = roundMoney(Number(invoice.paid) + amount)
        db.run(
          `UPDATE revenue_invoices SET paid = ?, status = ?, updated_at = datetime('now','localtime')
           WHERE id = ? AND company_id = ?`,
          [paid, paid >= Number(invoice.amount) ? 'PAID' : 'OPEN', invoice.id, companyId]
        )
        audit(ctx, 'REVENUE_RECEIPT', receiptId, 'CREATED', { receiptNo, amount, method, invoiceNo: invoice.invoice_no })
      })
      return Response.json({ ok: true, id: receiptId, receipt_no: receiptNo, journalId }, { status: 201 })
    }],

    ['POST', '/api/revenue/receipts/:id/deposit', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'KEUANGAN'], 'Setoran bank dilakukan bagian keuangan.')
      const receipt = receiptOf(intParam(ctx, 'id'))
      if (receipt.method !== 'KAS') {
        throw AppError.badRequest('Penerimaan metode transfer/QRIS sudah masuk rekening bank.')
      }
      if (receipt.deposit_status === 'DEPOSITED') throw AppError.badRequest('Penerimaan ini sudah disetor ke bank.')
      const body = await readJson(ctx.req)
      const amount = roundMoney(Number(receipt.amount))
      const cashAccount = accountId('1120')
      const bankAccount = accountId('1110')
      let journalId = 0
      state.db.withTransaction(() => {
        const lines: AmountedLine[] = [
          { account_id: bankAccount, debit: amount, credit: 0, memo: 'Setoran kas ke rekening bank' },
          { account_id: cashAccount, debit: 0, credit: amount, memo: 'Kas di tangan disetor' }
        ]
        journalId = postJournal(
          ctx,
          String(receipt.receipt_date).slice(0, 7),
          String(receipt.receipt_date),
          `Setoran bank ${String(receipt.receipt_no)} ke rekening kafe`,
          lines
        )
        db.run(
          `UPDATE revenue_receipts SET deposit_status = 'DEPOSITED', deposited_at = datetime('now','localtime'),
           deposit_reference = ? WHERE id = ? AND company_id = ?`,
          [strField(body, 'reference_no') || '', receipt.id, companyId]
        )
        audit(ctx, 'REVENUE_RECEIPT', receipt.id, 'DEPOSITED', { receiptNo: receipt.receipt_no, amount, journalId })
      })
      return Response.json({ ok: true, journalId })
    }],

    ['GET', '/api/revenue/journals', () => {
      const entries = db
        .query(
          `SELECT id, voucher_no, entry_date, description, source, status, posted_at
           FROM journal_entries WHERE company_id = ? AND source = 'REVENUE'
           ORDER BY entry_date DESC, id DESC`
        )
        .all(companyId) as AnyRow[]
      const lines = db
        .query(
          `SELECT l.journal_entry_id, l.account_id, l.memo, l.debit, l.credit,
                  a.code AS account_code, a.name AS account_name
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.journal_entry_id
           JOIN accounts a ON a.id = l.account_id
           WHERE e.company_id = ? AND e.source = 'REVENUE'
           ORDER BY l.journal_entry_id, l.line_no`
        )
        .all(companyId) as AnyRow[]
      const byEntry = new Map<number, AnyRow[]>()
      for (const line of lines) {
        const bucket = byEntry.get(line.journal_entry_id) ?? []
        bucket.push(line)
        byEntry.set(line.journal_entry_id, bucket)
      }
      return Response.json({
        journals: entries.map((entry) => ({ ...entry, lines: byEntry.get(entry.id) ?? [] }))
      })
    }],

    ['GET', '/api/revenue/controls', (ctx) => {
      const period = ctx.query.get('period') || ''
      if (!PERIOD_RE.test(period)) throw AppError.badRequest('Periode harus berformat YYYY-MM.')
      const checks = db
        .query('SELECT * FROM revenue_control_checks WHERE company_id = ? AND period = ? ORDER BY kind')
        .all(companyId, period) as AnyRow[]
      const deposited = db
        .query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_receipts
           WHERE company_id = ? AND deposit_status = 'DEPOSITED' AND substr(receipt_date, 1, 7) = ?`
        )
        .get(companyId, period) as { total: number }
      const outstanding = db
        .query(
          `SELECT COALESCE(SUM(amount - paid), 0) AS total FROM revenue_invoices
           WHERE company_id = ? AND status = 'OPEN'`
        )
        .get(companyId) as { total: number }
      return Response.json({
        period,
        checks,
        suggested: {
          depositedTotal: roundMoney(Number(deposited.total)),
          outstandingTotal: roundMoney(Number(outstanding.total))
        }
      })
    }],

    ['POST', '/api/revenue/controls', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'AKUNTANSI', 'KEUANGAN'], 'Rekonsiliasi kas dilakukan akuntansi atau keuangan.')
      const body = await readJson(ctx.req)
      const period = strField(body, 'period')
      if (!PERIOD_RE.test(period)) throw AppError.badRequest('Periode harus berformat YYYY-MM.')
      const kind = strField(body, 'kind').toUpperCase()
      if (kind !== 'CASH_RECONCILIATION') throw AppError.badRequest('Jenis pengendalian tidak dikenal.')
      const deposited = db
        .query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_receipts
           WHERE company_id = ? AND deposit_status = 'DEPOSITED' AND substr(receipt_date, 1, 7) = ?`
        )
        .get(companyId, period) as { total: number }
      const expected = roundMoney(Number(deposited.total))
      const actual = roundMoney(numField(body, 'bank_total'))
      const difference = roundMoney(actual - expected)
      const status = Math.abs(difference) < 0.01 ? 'OK' : 'MISMATCH'
      db.run(
        `INSERT INTO revenue_control_checks
          (company_id, period, kind, expected_value, actual_value, difference, status,
           operator_id, operator_role, checked_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(company_id, period, kind) DO UPDATE SET
           expected_value = excluded.expected_value, actual_value = excluded.actual_value,
           difference = excluded.difference, status = excluded.status,
           operator_id = excluded.operator_id, operator_role = excluded.operator_role,
           checked_at = excluded.checked_at, note = excluded.note`,
        [
          companyId, period, kind, expected, actual, difference, status,
          actorOf(ctx).id, actorOf(ctx).role, localTimestamp(), strField(body, 'note') || null
        ]
      )
      audit(ctx, 'REVENUE_CONTROL', null, kind, { period, status, expected, actual, difference })
      return Response.json({ ok: true, status, expected, actual, difference })
    }]
  ]
}
