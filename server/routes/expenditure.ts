// Endpoint Siklus Pengeluaran (BAB V.pptx bagian C).
//
// Alur: surat permintaan pembelian (PR) -> persetujuan manajer -> pesanan
// pembelian (PO) oleh pembelian -> laporan penerimaan barang (LPB) oleh
// gudang -> faktur pemasok dicatat akuntansi dengan pencocokan tiga arah ->
// pembayaran (BKK) oleh keuangan. Pemisahan tugas lewat akun login berbeda.
import { AppError } from '../errors'
import { assertBalanced, roundMoney, type AmountedLine } from '../domain'
import {
  assertPaymentAmount,
  billRemaining,
  buildPurchaseOrderItems,
  buildRequisitionItems,
  cashAccountCodeFor,
  expenseAccountCodeFor,
  linesTotal,
  matchDifference,
  threeWayMatch,
  type LineInput
} from '../expenditure-domain'
import { localTimestamp } from '../lib/format'
import { intParam, readJson, strField, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>
type Handler = (ctx: Ctx) => Response | Promise<Response>

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Bagian C BAB V: tujuh dokumen siklus pengeluaran.
export const EXPENDITURE_DOCUMENT_TYPES = [
  ['PURCHASE_REQUISITION', 'Surat permintaan pembelian', 'Permintaan barang/jasa dari bagian yang membutuhkan.'],
  ['PURCHASE_ORDER', 'Pesanan pembelian (purchase order)', 'PO yang disetujui kepada pemasok terpilih.'],
  ['GOODS_RECEIPT', 'Laporan penerimaan barang', 'Pemeriksaan jumlah dan kondisi barang yang diterima.'],
  ['SUPPLIER_INVOICE', 'Faktur pemasok', 'Tagihan pemasok yang dicocokkan dengan PO dan laporan penerimaan.'],
  ['CASH_DISBURSEMENT', 'Bukti kas keluar', 'Persetujuan pembayaran kepada pemasok.'],
  ['TRANSFER_PROOF', 'Bukti transfer / pembayaran', 'Bukti pembayaran melalui bank atau kas.'],
  ['PAYABLE_RECORD', 'Catatan utang usaha', 'Saldo utang per pemasok dan mutasinya.']
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

export function expenditureRoutes(state: AppState): Array<[string, string, Handler]> {
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

  /** Nomor dokumen berurutan per bulan: PR-, PO-, LPB-, FP-, BKK-YYYYMM-001. */
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
    const prefix = `EXP-${period}-`
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
    if (!DATE_RE.test(entryDate)) throw AppError.badRequest('Tanggal jurnal pengeluaran tidak valid.')
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
       VALUES (?, ?, ?, ?, ?, 'EXPENDITURE', 'POSTED', ?, ?, ?)`,
      [companyId, accountingPeriod.id, voucherNo, entryDate, description, actorOf(ctx).id, actorOf(ctx).id, localTimestamp()]
    )
    const entryId = Number(info.lastInsertRowid)
    balanced.forEach((line, index) => {
      db.run(
        'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, line.account_id, index + 1, line.memo, line.debit, line.credit]
      )
    })
    audit(ctx, 'JOURNAL_ENTRY', entryId, 'POSTED', { source: 'EXPENDITURE', voucherNo })
    return entryId
  }

  function supplierOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM purchase_suppliers WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Pemasok tidak ditemukan.')
    return row
  }

  function requisitionOf(id: number): AnyRow {
    const row = db
      .query('SELECT * FROM purchase_requisitions WHERE id = ? AND company_id = ?')
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Permintaan pembelian tidak ditemukan.')
    return row
  }

  function orderOf(id: number): AnyRow {
    const row = db
      .query(
        `SELECT o.*, s.name AS supplier_name, s.category AS supplier_category, s.is_trusted
         FROM purchase_orders o JOIN purchase_suppliers s ON s.id = o.supplier_id
         WHERE o.id = ? AND o.company_id = ?`
      )
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Pesanan pembelian tidak ditemukan.')
    return row
  }

  function billOf(id: number): AnyRow {
    const row = db
      .query(
        `SELECT b.*, o.order_no, s.name AS supplier_name, s.category AS supplier_category
         FROM purchase_bills b
         JOIN purchase_orders o ON o.id = b.order_id
         JOIN purchase_suppliers s ON s.id = b.supplier_id
         WHERE b.id = ? AND b.company_id = ?`
      )
      .get(id, companyId) as AnyRow | null
    if (!row) throw AppError.notFound('Faktur pemasok tidak ditemukan.')
    return row
  }

  function latestReceiptOf(orderId: number): AnyRow | null {
    return db
      .query(
        'SELECT * FROM purchase_goods_receipts WHERE order_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(orderId, companyId) as AnyRow | null
  }

  function validateSupplier(body: Record<string, unknown>): void {
    if (!strField(body, 'supplier_code')) throw AppError.badRequest('Kode pemasok wajib diisi.')
    if (!strField(body, 'name')) throw AppError.badRequest('Nama pemasok wajib diisi.')
    const category = strField(body, 'category') || 'BAHAN_BAKU'
    if (!['BAHAN_BAKU', 'KOSTUM', 'UTILITY', 'JASA'].includes(category)) {
      throw AppError.badRequest('Kategori pemasok tidak dikenal.')
    }
  }

  return [
    ['GET', '/api/expenditure/suppliers', () => {
      const rows = db
        .query('SELECT * FROM purchase_suppliers WHERE company_id = ? ORDER BY supplier_code')
        .all(companyId)
      return Response.json({ suppliers: rows })
    }],

    ['POST', '/api/expenditure/suppliers', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PEMBELIAN'], 'Data pemasok dikelola oleh bagian pembelian.')
      const body = await readJson(ctx.req)
      validateSupplier(body)
      const info = db.run(
        `INSERT INTO purchase_suppliers
          (company_id, supplier_code, name, category, phone, address, is_trusted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          strField(body, 'supplier_code').toUpperCase(),
          strField(body, 'name'),
          strField(body, 'category') || 'BAHAN_BAKU',
          strField(body, 'phone'),
          strField(body, 'address'),
          numField(body, 'is_trusted') ? 1 : 0
        ]
      )
      const id = Number(info.lastInsertRowid)
      audit(ctx, 'EXPENDITURE_SUPPLIER', id, 'CREATED', { code: strField(body, 'supplier_code') })
      return Response.json({ id }, { status: 201 })
    }],

    ['PUT', '/api/expenditure/suppliers/:id', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PEMBELIAN'], 'Data pemasok dikelola oleh bagian pembelian.')
      const supplier = supplierOf(intParam(ctx, 'id'))
      const body = await readJson(ctx.req)
      validateSupplier(body)
      db.run(
        `UPDATE purchase_suppliers SET supplier_code = ?, name = ?, category = ?, phone = ?,
         address = ?, is_trusted = ?, is_active = ?, updated_at = datetime('now','localtime')
         WHERE id = ? AND company_id = ?`,
        [
          strField(body, 'supplier_code').toUpperCase(),
          strField(body, 'name'),
          strField(body, 'category') || 'BAHAN_BAKU',
          strField(body, 'phone'),
          strField(body, 'address'),
          numField(body, 'is_trusted') ? 1 : 0,
          numField(body, 'is_active', supplier.is_active ? 1 : 0) ? 1 : 0,
          supplier.id,
          companyId
        ]
      )
      audit(ctx, 'EXPENDITURE_SUPPLIER', supplier.id, 'UPDATED', { code: strField(body, 'supplier_code') })
      return Response.json({ ok: true })
    }],

    ['GET', '/api/expenditure/requisitions', () => {
      const rows = db
        .query(
          `SELECT r.*, u.name AS approver_name,
             (SELECT COALESCE(SUM(est_total), 0) FROM purchase_requisition_items i WHERE i.requisition_id = r.id) AS estimated_total
           FROM purchase_requisitions r
           LEFT JOIN users u ON u.id = r.approved_by
           WHERE r.company_id = ?
           ORDER BY r.requisition_date DESC, r.id DESC`
        )
        .all(companyId) as AnyRow[]
      const items = db
        .query('SELECT * FROM purchase_requisition_items WHERE company_id = ? ORDER BY requisition_id, id')
        .all(companyId) as AnyRow[]
      const byRequisition = new Map<number, AnyRow[]>()
      for (const item of items) {
        const bucket = byRequisition.get(item.requisition_id) ?? []
        bucket.push(item)
        byRequisition.set(item.requisition_id, bucket)
      }
      return Response.json({
        requisitions: rows.map((row) => ({ ...row, items: byRequisition.get(row.id) ?? [] }))
      })
    }],

    ['POST', '/api/expenditure/requisitions', async (ctx) => {
      // Setiap bagian (dapur, kafe, kostum) boleh mengajukan permintaan.
      const body = await readJson(ctx.req)
      const requisitionDate = strField(body, 'requisition_date')
      if (!isValidDate(requisitionDate)) throw AppError.badRequest('Tanggal permintaan tidak valid.')
      const department = strField(body, 'department') || 'DAPUR'
      if (!['DAPUR', 'KAFE', 'KOSTUM', 'UMUM'].includes(department)) {
        throw AppError.badRequest('Bagian pengusul tidak dikenal.')
      }
      const items = buildRequisitionItems(
        (Array.isArray(body.items) ? body.items : []) as LineInput[]
      )
      const requisitionNo = nextDocNo('PR', 'purchase_requisitions', 'requisition_no', requisitionDate)

      let requisitionId = 0
      state.db.withTransaction(() => {
        const info = db.run(
          `INSERT INTO purchase_requisitions
            (company_id, requisition_no, requisition_date, department, requested_by, reason, status)
           VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')`,
          [
            companyId, requisitionNo, requisitionDate, department,
            strField(body, 'requested_by') || actorOf(ctx).name,
            strField(body, 'reason') || ''
          ]
        )
        requisitionId = Number(info.lastInsertRowid)
        for (const item of items) {
          db.run(
            `INSERT INTO purchase_requisition_items
              (company_id, requisition_id, description, qty, est_price, est_total)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [companyId, requisitionId, item.description, item.qty, item.unit_price, item.line_total]
          )
        }
        audit(ctx, 'EXPENDITURE_REQUISITION', requisitionId, 'CREATED', {
          requisitionNo, department, total: linesTotal(items)
        })
      })
      return Response.json({ id: requisitionId, requisition_no: requisitionNo }, { status: 201 })
    }],

    ['POST', '/api/expenditure/requisitions/:id/decide', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'SDM_MANAGER'], 'Persetujuan pembelian harus dilakukan manajer.')
      const requisition = requisitionOf(intParam(ctx, 'id'))
      if (requisition.status !== 'DRAFT') throw AppError.badRequest('Permintaan pembelian sudah diputuskan.')
      const body = await readJson(ctx.req)
      const decision = strField(body, 'decision').toUpperCase()
      if (!['APPROVED', 'REJECTED'].includes(decision)) {
        throw AppError.badRequest('Keputusan harus APPROVED atau REJECTED.')
      }
      db.run(
        `UPDATE purchase_requisitions SET status = ?, approved_by = ?, approved_at = datetime('now','localtime'),
         decision_note = ?, updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
        [decision, actorOf(ctx).id, strField(body, 'note') || null, requisition.id, companyId]
      )
      audit(ctx, 'EXPENDITURE_REQUISITION', requisition.id, decision, { requisitionNo: requisition.requisition_no })
      return Response.json({ ok: true, status: decision })
    }],

    ['GET', '/api/expenditure/orders', () => {
      const rows = db
        .query(
          `SELECT o.*, s.name AS supplier_name, s.category AS supplier_category, s.is_trusted,
             r.requisition_no,
             (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_items i WHERE i.order_id = o.id) AS total
           FROM purchase_orders o
           JOIN purchase_suppliers s ON s.id = o.supplier_id
           JOIN purchase_requisitions r ON r.id = o.requisition_id
           WHERE o.company_id = ?
           ORDER BY o.order_date DESC, o.id DESC`
        )
        .all(companyId) as AnyRow[]
      const items = db
        .query('SELECT * FROM purchase_order_items WHERE company_id = ? ORDER BY order_id, id')
        .all(companyId) as AnyRow[]
      const byOrder = new Map<number, AnyRow[]>()
      for (const item of items) {
        const bucket = byOrder.get(item.order_id) ?? []
        bucket.push(item)
        byOrder.set(item.order_id, bucket)
      }
      return Response.json({
        orders: rows.map((row) => ({ ...row, items: byOrder.get(row.id) ?? [] }))
      })
    }],

    ['POST', '/api/expenditure/orders', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'PEMBELIAN'], 'Pesanan pembelian dibuat oleh bagian pembelian.')
      const body = await readJson(ctx.req)
      const orderDate = strField(body, 'order_date')
      if (!isValidDate(orderDate)) throw AppError.badRequest('Tanggal pesanan pembelian tidak valid.')
      const requisition = requisitionOf(Number(body.requisition_id))
      if (requisition.status !== 'APPROVED') {
        throw AppError.badRequest('Permintaan pembelian belum disetujui manajer.')
      }
      const supplier = supplierOf(Number(body.supplier_id))
      if (Number(supplier.is_active) !== 1) throw AppError.badRequest('Pemasok tidak aktif.')
      const items = buildPurchaseOrderItems(
        (Array.isArray(body.items) ? body.items : []) as LineInput[]
      )
      const total = linesTotal(items)
      const orderNo = nextDocNo('PO', 'purchase_orders', 'order_no', orderDate)
      const warnings: string[] = []
      if (Number(supplier.is_trusted) !== 1) {
        warnings.push(
          `Pemasok ${supplier.name} belum ditandai terpercaya. Pengendalian BAB V menyarankan pemilihan pemasok yang dapat dipercaya.`
        )
      }

      let orderId = 0
      state.db.withTransaction(() => {
        const info = db.run(
          `INSERT INTO purchase_orders
            (company_id, order_no, order_date, requisition_id, supplier_id, status, total, notes)
           VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
          [companyId, orderNo, orderDate, requisition.id, supplier.id, total, strField(body, 'notes') || null]
        )
        orderId = Number(info.lastInsertRowid)
        for (const item of items) {
          db.run(
            `INSERT INTO purchase_order_items (company_id, order_id, description, qty, unit_price, line_total)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [companyId, orderId, item.description, item.qty, item.unit_price, item.line_total]
          )
        }
        audit(ctx, 'EXPENDITURE_ORDER', orderId, 'CREATED', { orderNo, total, supplier: supplier.name })
      })
      return Response.json({ id: orderId, order_no: orderNo, total, warnings }, { status: 201 })
    }],

    ['POST', '/api/expenditure/orders/:id/send', (ctx) => {
      assertRole(ctx, ['ADMIN', 'PEMBELIAN'], 'Penerbitan PO kepada pemasok dilakukan bagian pembelian.')
      const order = orderOf(intParam(ctx, 'id'))
      if (order.status !== 'DRAFT') throw AppError.badRequest('Pesanan pembelian sudah diproses atau dibatalkan.')
      db.run(
        `UPDATE purchase_orders SET status = 'DIKIRIM', sent_at = datetime('now','localtime'),
         updated_at = datetime('now','localtime') WHERE id = ? AND company_id = ?`,
        [order.id, companyId]
      )
      audit(ctx, 'EXPENDITURE_ORDER', order.id, 'SENT', { orderNo: order.order_no })
      return Response.json({ ok: true })
    }],

    ['POST', '/api/expenditure/orders/:id/cancel', (ctx) => {
      assertRole(ctx, ['ADMIN', 'PEMBELIAN'], 'Pembatalan PO dilakukan bagian pembelian.')
      const order = orderOf(intParam(ctx, 'id'))
      if (!['DRAFT', 'DIKIRIM'].includes(order.status)) {
        throw AppError.badRequest('Pesanan yang sudah menerima barang tidak dapat dibatalkan.')
      }
      db.run(
        `UPDATE purchase_orders SET status = 'DIBATALKAN', updated_at = datetime('now','localtime')
         WHERE id = ? AND company_id = ?`,
        [order.id, companyId]
      )
      audit(ctx, 'EXPENDITURE_ORDER', order.id, 'CANCELLED', { orderNo: order.order_no })
      return Response.json({ ok: true })
    }],

    ['GET', '/api/expenditure/receipts', () => {
      const rows = db
        .query(
          `SELECT g.*, o.order_no
           FROM purchase_goods_receipts g JOIN purchase_orders o ON o.id = g.order_id
           WHERE g.company_id = ?
           ORDER BY g.receipt_date DESC, g.id DESC`
        )
        .all(companyId) as AnyRow[]
      return Response.json({ receipts: rows })
    }],

    ['POST', '/api/expenditure/orders/:id/receipt', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'GUDANG'], 'Pemeriksaan barang diterima dilakukan bagian gudang.')
      const order = orderOf(intParam(ctx, 'id'))
      if (order.status !== 'DIKIRIM') {
        throw AppError.badRequest('Laporan penerimaan barang hanya untuk PO yang sudah dikirim ke pemasok.')
      }
      const body = await readJson(ctx.req)
      const receiptDate = strField(body, 'receipt_date') || order.order_date
      if (!isValidDate(receiptDate)) throw AppError.badRequest('Tanggal penerimaan barang tidak valid.')
      const acceptedTotal = roundMoney(numField(body, 'accepted_total', Number(order.total)))
      if (acceptedTotal <= 0) throw AppError.badRequest('Nilai barang diterima harus lebih dari nol.')

      const receiptNo = nextDocNo('LPB', 'purchase_goods_receipts', 'receipt_no', receiptDate)
      let receiptId = 0
      state.db.withTransaction(() => {
        const info = db.run(
          `INSERT INTO purchase_goods_receipts
            (company_id, receipt_no, receipt_date, order_id, accepted_total, condition_note, checked_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId, receiptNo, receiptDate, order.id, acceptedTotal,
            strField(body, 'condition_note') || null,
            strField(body, 'checked_by') || actorOf(ctx).name
          ]
        )
        receiptId = Number(info.lastInsertRowid)
        db.run(
          `UPDATE purchase_orders SET status = 'SELESAI', updated_at = datetime('now','localtime')
           WHERE id = ? AND company_id = ?`,
          [order.id, companyId]
        )
        audit(ctx, 'EXPENDITURE_ORDER', order.id, 'RECEIVED', {
          receiptNo, acceptedTotal, orderNo: order.order_no
        })
      })
      return Response.json({ ok: true, id: receiptId, receipt_no: receiptNo }, { status: 201 })
    }],

    ['GET', '/api/expenditure/bills', () => {
      const rows = db
        .query(
          `SELECT b.*, o.order_no, s.name AS supplier_name, s.category AS supplier_category
           FROM purchase_bills b
           JOIN purchase_orders o ON o.id = b.order_id
           JOIN purchase_suppliers s ON s.id = b.supplier_id
           WHERE b.company_id = ?
           ORDER BY b.bill_date DESC, b.id DESC`
        )
        .all(companyId) as AnyRow[]
      return Response.json({ bills: rows })
    }],

    ['POST', '/api/expenditure/bills', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'AKUNTANSI'], 'Pencatatan faktur dan utang dilakukan bagian akuntansi.')
      const body = await readJson(ctx.req)
      const order = orderOf(Number(body.order_id))
      if (order.status !== 'SELESAI') {
        throw AppError.badRequest('Faktur pemasok hanya dicatat untuk pesanan yang barangnya sudah diterima.')
      }
      const receipt = latestReceiptOf(order.id)
      if (!receipt) throw AppError.badRequest('Laporan penerimaan barang belum tersedia untuk pesanan ini.')
      const billDate = strField(body, 'bill_date') || String(receipt.receipt_date)
      if (!isValidDate(billDate)) throw AppError.badRequest('Tanggal faktur pemasok tidak valid.')
      const amount = roundMoney(numField(body, 'amount', Number(order.total)))
      if (amount <= 0) throw AppError.badRequest('Nilai faktur pemasok harus lebih dari nol.')

      const matchStatus = threeWayMatch(Number(order.total), Number(receipt.accepted_total), amount)
      if (matchStatus === 'MISMATCH') {
        const difference = matchDifference(Number(order.total), Number(receipt.accepted_total), amount)
        throw AppError.badRequest(
          `Dokumen tidak cocok (three-way match gagal): PO ${order.total}, barang diterima ${receipt.accepted_total}, ` +
          `faktur ${amount}. Selisih ${difference}. Cocokkan dokumen sebelum mencatat utang.`
        )
      }

      const payableAccount = accountId('2120')
      const expenseAccount = accountId(expenseAccountCodeFor(String(order.supplier_category)))
      const billNo = nextDocNo('FP', 'purchase_bills', 'bill_no', billDate)
      let billId = 0
      let journalId = 0
      state.db.withTransaction(() => {
        const info = db.run(
          `INSERT INTO purchase_bills
            (company_id, bill_no, bill_date, order_id, supplier_id, supplier_invoice_no, amount, match_status, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'MATCHED', 'OPEN')`,
          [
            companyId, billNo, billDate, order.id, order.supplier_id,
            strField(body, 'supplier_invoice_no') || '', amount
          ]
        )
        billId = Number(info.lastInsertRowid)
        const lines: AmountedLine[] = [
          {
            account_id: expenseAccount,
            debit: amount,
            credit: 0,
            memo: `Beban ${String(order.supplier_category).toLowerCase()} kafe`
          },
          { account_id: payableAccount, debit: 0, credit: amount, memo: 'Utang usaha pemasok' }
        ]
        journalId = postJournal(
          ctx,
          billDate.slice(0, 7),
          billDate,
          `Utang pemasok ${billNo} — ${order.supplier_name} (PO ${order.order_no})`,
          lines
        )
        db.run('UPDATE purchase_bills SET ap_journal_id = ? WHERE id = ?', [journalId, billId])
        audit(ctx, 'EXPENDITURE_BILL', billId, 'CREATED', {
          billNo, amount, orderNo: order.order_no, supplierInvoiceNo: strField(body, 'supplier_invoice_no')
        })
      })
      return Response.json({ ok: true, id: billId, bill_no: billNo, journalId }, { status: 201 })
    }],

    ['GET', '/api/expenditure/payments', () => {
      const rows = db
        .query(
          `SELECT p.*, b.bill_no, b.supplier_invoice_no
           FROM purchase_payments p JOIN purchase_bills b ON b.id = p.bill_id
           WHERE p.company_id = ?
           ORDER BY p.payment_date DESC, p.id DESC`
        )
        .all(companyId) as AnyRow[]
      return Response.json({ payments: rows })
    }],

    ['POST', '/api/expenditure/payments', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'KEUANGAN'], 'Pembayaran kepada pemasok dilakukan bagian keuangan.')
      const body = await readJson(ctx.req)
      const bill = billOf(Number(body.bill_id))
      if (bill.match_status !== 'MATCHED') {
        throw AppError.badRequest('Faktur pemasok belum lolos pencocokan tiga arah.')
      }
      if (bill.status !== 'OPEN') throw AppError.badRequest('Faktur pemasok ini sudah lunas.')
      const method = strField(body, 'method') === 'KAS' ? 'KAS' : 'BANK'
      const remaining = billRemaining(bill.amount, bill.paid)
      const amount = assertPaymentAmount(numField(body, 'amount', remaining), remaining)
      const paymentDate = strField(body, 'payment_date') || bill.bill_date
      if (!isValidDate(paymentDate)) throw AppError.badRequest('Tanggal pembayaran tidak valid.')

      const cashAccount = accountId(cashAccountCodeFor(method))
      const payableAccount = accountId('2120')
      const paymentNo = nextDocNo('BKK', 'purchase_payments', 'payment_no', paymentDate)
      let paymentId = 0
      let journalId = 0
      state.db.withTransaction(() => {
        const info = db.run(
          `INSERT INTO purchase_payments
            (company_id, payment_no, payment_date, bill_id, amount, method, reference_no)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [companyId, paymentNo, paymentDate, bill.id, amount, method, strField(body, 'reference_no') || '']
        )
        paymentId = Number(info.lastInsertRowid)
        const lines: AmountedLine[] = [
          { account_id: payableAccount, debit: amount, credit: 0, memo: 'Pelunasan utang usaha pemasok' },
          { account_id: cashAccount, debit: 0, credit: amount, memo: 'Pembayaran via bank/kas' }
        ]
        journalId = postJournal(
          ctx,
          paymentDate.slice(0, 7),
          paymentDate,
          `Pembayaran pemasok ${paymentNo} — ${bill.supplier_name} (faktur ${bill.bill_no})`,
          lines
        )
        db.run('UPDATE purchase_payments SET payment_journal_id = ? WHERE id = ?', [journalId, paymentId])
        const paid = roundMoney(Number(bill.paid) + amount)
        db.run(
          `UPDATE purchase_bills SET paid = ?, status = ?, updated_at = datetime('now','localtime')
           WHERE id = ? AND company_id = ?`,
          [paid, paid >= Number(bill.amount) ? 'PAID' : 'OPEN', bill.id, companyId]
        )
        audit(ctx, 'EXPENDITURE_PAYMENT', paymentId, 'CREATED', {
          paymentNo, amount, method, billNo: bill.bill_no
        })
      })
      return Response.json({ ok: true, id: paymentId, payment_no: paymentNo, journalId }, { status: 201 })
    }],

    ['GET', '/api/expenditure/journals', () => {
      const entries = db
        .query(
          `SELECT id, voucher_no, entry_date, description, source, status, posted_at
           FROM journal_entries WHERE company_id = ? AND source = 'EXPENDITURE'
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
           WHERE e.company_id = ? AND e.source = 'EXPENDITURE'
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

    ['GET', '/api/expenditure/controls', (ctx) => {
      const period = ctx.query.get('period') || ''
      if (!PERIOD_RE.test(period)) throw AppError.badRequest('Periode harus berformat YYYY-MM.')
      const checks = db
        .query('SELECT * FROM expenditure_control_checks WHERE company_id = ? AND period = ? ORDER BY kind')
        .all(companyId, period) as AnyRow[]
      const payable = db
        .query(
          `SELECT COALESCE(SUM(amount - paid), 0) AS total FROM purchase_bills
           WHERE company_id = ? AND status = 'OPEN' AND substr(bill_date, 1, 7) = ?`
        )
        .get(companyId, period) as { total: number }
      const untrusted = db
        .query('SELECT COUNT(*) AS total FROM purchase_suppliers WHERE company_id = ? AND is_trusted = 0')
        .get(companyId) as { total: number }
      return Response.json({
        period,
        checks,
        suggested: {
          payableTotal: roundMoney(Number(payable.total)),
          untrustedSuppliers: Number(untrusted.total)
        }
      })
    }],

    ['POST', '/api/expenditure/controls', async (ctx) => {
      assertRole(ctx, ['ADMIN', 'AKUNTANSI', 'KEUANGAN'], 'Rekonsiliasi utang dilakukan akuntansi atau keuangan.')
      const body = await readJson(ctx.req)
      const period = strField(body, 'period')
      if (!PERIOD_RE.test(period)) throw AppError.badRequest('Periode harus berformat YYYY-MM.')
      const kind = strField(body, 'kind').toUpperCase()
      if (kind !== 'AP_RECONCILIATION') throw AppError.badRequest('Jenis pengendalian tidak dikenal.')
      const payable = db
        .query(
          `SELECT COALESCE(SUM(amount - paid), 0) AS total FROM purchase_bills
           WHERE company_id = ? AND status = 'OPEN' AND substr(bill_date, 1, 7) = ?`
        )
        .get(companyId, period) as { total: number }
      const expected = roundMoney(Number(payable.total))
      const actual = roundMoney(numField(body, 'statement_total'))
      const difference = roundMoney(actual - expected)
      const status = Math.abs(difference) < 0.01 ? 'OK' : 'MISMATCH'
      db.run(
        `INSERT INTO expenditure_control_checks
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
      audit(ctx, 'EXPENDITURE_CONTROL', null, kind, { period, status, expected, actual, difference })
      return Response.json({ ok: true, status, expected, actual, difference })
    }]
  ]
}
