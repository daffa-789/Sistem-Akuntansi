import { describe, expect, it } from 'bun:test'
import {
  assertPaymentAmount,
  billRemaining,
  buildPurchaseOrderItems,
  buildRequisitionItems,
  cashAccountCodeFor,
  expenseAccountCodeFor,
  linesTotal,
  matchDifference,
  threeWayMatch
} from './expenditure-domain'

describe('item permintaan dan pesanan pembelian', () => {
  it('membangun item permintaan dan menjumlahkan estimasi', () => {
    const items = buildRequisitionItems([
      { description: 'Biji kopi Arabika 1 kg', qty: 2, unit_price: 220_000 },
      { description: 'Tepung beras mochi', qty: 5, unit_price: 18_000 }
    ])
    expect(items).toHaveLength(2)
    expect(items[0].unit_price).toBe(220_000)
    expect(linesTotal(items)).toBe(530_000)
  })

  it('membangun item PO dan menghitung total pesanan', () => {
    const items = buildPurchaseOrderItems([
      { description: 'Biji kopi Arabika 1 kg', qty: 2, unit_price: 220_000 },
      { description: 'Sirup stroberi', qty: 3, unit_price: 42_000 }
    ])
    expect(items[1].line_total).toBe(126_000)
    expect(linesTotal(items)).toBe(566_000)
  })

  it('menolak daftar kosong atau deskripsi kosong', () => {
    expect(() => buildPurchaseOrderItems([])).toThrow('Pesanan pembelian harus memiliki sedikitnya satu item.')
    expect(() => buildRequisitionItems([{ qty: 1, unit_price: 10_000 }])).toThrow('deskripsi')
    expect(() => buildPurchaseOrderItems([{ description: 'Kopi', qty: 0, unit_price: 10_000 }])).toThrow(
      'Jumlah dan harga satuan harus angka'
    )
  })
})

describe('three-way match siklus pengeluaran', () => {
  it('menyatakan MATCHED bila PO, penerimaan, dan faktur sama', () => {
    expect(threeWayMatch(566_000, 566_000, 566_000)).toBe('MATCHED')
  })

  it('menyatakan MISMATCH dan menghitung selisihnya', () => {
    expect(threeWayMatch(566_000, 566_000, 600_000)).toBe('MISMATCH')
    expect(threeWayMatch(566_000, 500_000, 566_000)).toBe('MISMATCH')
    expect(matchDifference(566_000, 566_000, 600_000)).toBe(34_000)
    expect(matchDifference(566_000, 500_000, 566_000)).toBe(66_000)
  })

  it('toleransi pembulatan rupiah tetap MATCHED', () => {
    expect(threeWayMatch(100.001, 100.0, 100.001)).toBe('MATCHED')
  })
})

describe('akun jurnal siklus pengeluaran', () => {
  it('memetakan kategori pemasok ke akun beban', () => {
    expect(expenseAccountCodeFor('BAHAN_BAKU')).toBe('5100')
    expect(expenseAccountCodeFor('UTILITY')).toBe('5300')
    expect(expenseAccountCodeFor('KOSTUM')).toBe('5400')
    expect(expenseAccountCodeFor('JASA')).toBe('5500')
    expect(expenseAccountCodeFor('LAINNYA')).toBe('5100')
  })

  it('memilih akun kas sesuai metode pembayaran', () => {
    expect(cashAccountCodeFor('BANK')).toBe('1110')
    expect(cashAccountCodeFor('KAS')).toBe('1120')
  })
})

describe('pembayaran pemasok', () => {
  it('menghitung sisa utang faktur', () => {
    expect(billRemaining(566_000, 100_000)).toBe(466_000)
    expect(billRemaining(566_000, 566_000)).toBe(0)
  })

  it('menerima pembayaran sebagian atau penuh', () => {
    expect(assertPaymentAmount(466_000, 466_000)).toBe(466_000)
    expect(assertPaymentAmount(150_000, 466_000)).toBe(150_000)
  })

  it('menolak pembayaran nol atau melebihi sisa utang', () => {
    expect(() => assertPaymentAmount(0, 466_000)).toThrow('Jumlah pembayaran harus lebih dari nol.')
    expect(() => assertPaymentAmount(500_000, 466_000)).toThrow('melebihi sisa utang')
    expect(() => assertPaymentAmount(10_000, 0)).toThrow('Faktur pemasok ini sudah lunas.')
  })
})
