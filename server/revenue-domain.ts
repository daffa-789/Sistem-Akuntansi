// Perhitungan murni Siklus Pendapatan (BAB V.pptx bagian B).
//
// Tanpa akses DB/HTTP: dipakai bersama oleh routes/revenue.ts dan test.
// Alur: pesanan -> penyajian -> faktur (tunai/kredit) -> penerimaan kas.
import { AppError } from './errors'
import { MONEY_EPSILON, roundMoney } from './domain'

export type CustomerType = 'TUNAI' | 'MEMBER' | 'KORPORAT'
export type MenuCategory = 'MINUMAN' | 'MAKANAN' | 'DESSERT' | 'PAKET_EVENT' | 'MERCH'
export type OrderType = 'DINE_IN' | 'TAKE_AWAY' | 'CATERING' | 'EVENT'
export type OrderPaymentType = 'TUNAI' | 'KREDIT'
export type ReceiptMethod = 'KAS' | 'BANK'

export const MENU_CATEGORIES: MenuCategory[] = [
  'MINUMAN', 'MAKANAN', 'DESSERT', 'PAKET_EVENT', 'MERCH'
]

export const ORDER_TYPES: OrderType[] = ['DINE_IN', 'TAKE_AWAY', 'CATERING', 'EVENT']

export const CUSTOMER_TYPES: CustomerType[] = ['TUNAI', 'MEMBER', 'KORPORAT']

export interface OrderItemInput {
  menu_item_id?: number | null
  description?: string
  qty: number
  unit_price: number
}

export interface OrderItemCalculated {
  menu_item_id: number | null
  description: string
  qty: number
  unit_price: number
  line_total: number
}

/** Total satu baris pesanan: qty × harga, dibulatkan ke rupiah. */
export function lineTotal(qty: number, unitPrice: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(unitPrice) || qty <= 0 || unitPrice < 0) {
    throw AppError.badRequest('Jumlah dan harga satuan harus angka, jumlah > 0, harga >= 0.')
  }
  return roundMoney(qty * unitPrice)
}

/**
 * Normalisasi baris pesanan: deskripsi wajib (dari menu atau input manual),
 * total per baris dihitung dan dibulatkan.
 */
export function buildOrderItems(items: OrderItemInput[]): OrderItemCalculated[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw AppError.badRequest('Pesanan harus memiliki sedikitnya satu item menu.')
  }
  return items.map((item) => {
    const description = String(item.description ?? '').trim()
    if (!description) throw AppError.badRequest('Setiap item pesanan wajib memiliki deskripsi menu.')
    const calculated = lineTotal(Number(item.qty), Number(item.unit_price))
    return {
      menu_item_id: item.menu_item_id ?? null,
      description,
      qty: Number(item.qty),
      unit_price: roundMoney(Number(item.unit_price)),
      line_total: calculated
    }
  })
}

/** Total pesanan = penjumlahan total baris. */
export function orderTotal(items: OrderItemCalculated[]): number {
  return roundMoney(items.reduce((sum, item) => sum + item.line_total, 0))
}

/** Sisa limit kredit pelanggan setelah memperhitungkan faktur terbuka. */
export function creditAvailable(
  creditLimit: number,
  outstanding: number
): number {
  return roundMoney(Math.max(Number(creditLimit || 0) - Number(outstanding || 0), 0))
}

/**
 * Pengendalian "persetujuan untuk penjualan kredit" (BAB V bagian B):
 * penjualan kredit hanya boleh bila pelanggan punya limit kredit dan
 * total piutang setelah faktur ini tidak melebihi limit tersebut.
 */
export function assertCreditAllowed(input: {
  paymentType: OrderPaymentType
  customerType: string
  creditLimit: number
  outstanding: number
  orderTotal: number
  creditApproved: boolean
}): void {
  if (input.paymentType !== 'KREDIT') return
  if (Number(input.creditLimit) <= 0) {
    throw AppError.badRequest(
      'Pelanggan tidak memiliki limit kredit. Gunakan pembayaran tunai atau atur limit kredit terlebih dahulu.'
    )
  }
  if (!input.creditApproved) {
    throw AppError.badRequest(
      'Penjualan kredit harus mendapat persetujuan manajer sebelum faktur dibuat.'
    )
  }
  const projected = roundMoney(Number(input.outstanding || 0) + Number(input.orderTotal || 0))
  if (projected > Number(input.creditLimit) + MONEY_EPSILON) {
    throw AppError.badRequest(
      `Limit kredit pelanggan tidak mencukupi: piutang berjalan ${projected} melebihi limit ${input.creditLimit}.`
    )
  }
}

/** Sisa utang satu faktur: amount − paid. */
export function invoiceRemaining(amount: number, paid: number): number {
  return roundMoney(Math.max(Number(amount || 0) - Number(paid || 0), 0))
}

/**
 * Penerimaan kas (aktivitas d): jumlah diterima tidak boleh melebihi sisa
 * faktur dan harus positif.
 */
export function assertReceiptAmount(amount: number, remaining: number): number {
  const value = roundMoney(Number(amount || 0))
  if (value <= 0) throw AppError.badRequest('Jumlah penerimaan kas harus lebih dari nol.')
  if (remaining <= 0) throw AppError.badRequest('Faktur ini sudah lunas.')
  if (value > remaining + MONEY_EPSILON) {
    throw AppError.badRequest(
      `Penerimaan ${value} melebihi sisa faktur ${remaining}. Periksa kembali jumlahnya.`
    )
  }
  return value
}

/**
 * Akun kas yang didebit saat penerimaan: BANK -> Kas di Bank (1110),
 * KAS -> Kas di Tangan (1120).
 */
export function cashAccountCodeFor(method: ReceiptMethod): string {
  return method === 'KAS' ? '1120' : '1110'
}
