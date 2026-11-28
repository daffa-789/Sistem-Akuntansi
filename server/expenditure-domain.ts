// Perhitungan murni Siklus Pengeluaran (BAB V.pptx bagian C).
//
// Tanpa akses DB/HTTP: dipakai bersama oleh routes/expenditure.ts dan test.
// Alur: permintaan pembelian -> PO -> penerimaan barang ->
//       faktur pemasok (three-way match) -> pembayaran.
import { AppError } from './errors'
import { MONEY_EPSILON, roundMoney } from './domain'

export type SupplierCategory = 'BAHAN_BAKU' | 'KOSTUM' | 'UTILITY' | 'JASA'
export type PurchaseOrderStatus = 'DRAFT' | 'DIKIRIM' | 'SELESAI' | 'DIBATALKAN'
export type BillMatchStatus = 'PENDING' | 'MATCHED' | 'MISMATCH'
export type PaymentMethod = 'KAS' | 'BANK'

export const SUPPLIER_CATEGORIES: SupplierCategory[] = [
  'BAHAN_BAKU', 'KOSTUM', 'UTILITY', 'JASA'
]

export const REQUISITION_DEPARTMENTS = ['DAPUR', 'KAFE', 'KOSTUM', 'UMUM'] as const

export interface LineInput {
  description?: string
  qty: number
  unit_price: number
}

export interface LineCalculated {
  description: string
  qty: number
  unit_price: number
  line_total: number
}

function buildLines(items: LineInput[], label: string): LineCalculated[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw AppError.badRequest(`${label} harus memiliki sedikitnya satu item.`)
  }
  return items.map((item) => {
    const description = String(item.description ?? '').trim()
    if (!description) throw AppError.badRequest(`Setiap item ${label.toLowerCase()} wajib memiliki deskripsi.`)
    const qty = Number(item.qty)
    const price = Number(item.unit_price)
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) {
      throw AppError.badRequest('Jumlah dan harga satuan harus angka, jumlah > 0, harga >= 0.')
    }
    return {
      description,
      qty,
      unit_price: roundMoney(price),
      line_total: roundMoney(qty * price)
    }
  })
}

/** Normalisasi item permintaan pembelian (estimasi harga boleh nol). */
export function buildRequisitionItems(items: LineInput[]): LineCalculated[] {
  return buildLines(items, 'Permintaan pembelian')
}

/** Normalisasi item pesanan pembelian (PO). */
export function buildPurchaseOrderItems(items: LineInput[]): LineCalculated[] {
  return buildLines(items, 'Pesanan pembelian')
}

export function linesTotal(items: LineCalculated[]): number {
  return roundMoney(items.reduce((sum, item) => sum + item.line_total, 0))
}

/**
 * Pencocokan tiga arah (three-way match) — BAB V bagian C aktivitas d:
 * pesanan pembelian, laporan penerimaan barang, dan faktur pemasok harus
 * menunjukkan nilai yang sama sebelum utang dicatat.
 */
export function threeWayMatch(poTotal: number, acceptedTotal: number, billAmount: number): BillMatchStatus {
  const po = roundMoney(Number(poTotal || 0))
  const accepted = roundMoney(Number(acceptedTotal || 0))
  const bill = roundMoney(Number(billAmount || 0))
  const same = Math.abs(po - accepted) < MONEY_EPSILON && Math.abs(accepted - bill) < MONEY_EPSILON
  return same ? 'MATCHED' : 'MISMATCH'
}

/** Selisih faktur terhadap dokumen pembanding untuk pesan galat. */
export function matchDifference(poTotal: number, acceptedTotal: number, billAmount: number): number {
  const po = roundMoney(Number(poTotal || 0))
  const accepted = roundMoney(Number(acceptedTotal || 0))
  const bill = roundMoney(Number(billAmount || 0))
  const reference = Math.abs(po - accepted) >= MONEY_EPSILON ? Math.abs(po - accepted) : Math.abs(accepted - bill)
  return roundMoney(reference)
}

/**
 * Akun beban untuk faktur pemasok menurut kategori pemasok:
 * BAHAN_BAKU -> 5100, UTILITY -> 5300, KOSTUM -> 5400, JASA -> 5500.
 */
export function expenseAccountCodeFor(category: string): string {
  if (category === 'UTILITY') return '5300'
  if (category === 'KOSTUM') return '5400'
  if (category === 'JASA') return '5500'
  return '5100'
}

export function billRemaining(amount: number, paid: number): number {
  return roundMoney(Math.max(Number(amount || 0) - Number(paid || 0), 0))
}

/** Pembayaran ke pemasok: positif dan tidak melebihi sisa utang faktur. */
export function assertPaymentAmount(amount: number, remaining: number): number {
  const value = roundMoney(Number(amount || 0))
  if (value <= 0) throw AppError.badRequest('Jumlah pembayaran harus lebih dari nol.')
  if (remaining <= 0) throw AppError.badRequest('Faktur pemasok ini sudah lunas.')
  if (value > remaining + MONEY_EPSILON) {
    throw AppError.badRequest(
      `Pembayaran ${value} melebihi sisa utang ${remaining}. Periksa kembali jumlahnya.`
    )
  }
  return value
}

/** Akun kas yang dikredit saat pembayaran pemasok. */
export function cashAccountCodeFor(method: PaymentMethod): string {
  return method === 'KAS' ? '1120' : '1110'
}
