import { describe, expect, it } from 'bun:test'
import {
  assertCreditAllowed,
  assertReceiptAmount,
  buildOrderItems,
  cashAccountCodeFor,
  creditAvailable,
  invoiceRemaining,
  lineTotal,
  orderTotal
} from './revenue-domain'

describe('total pesanan siklus pendapatan', () => {
  it('menghitung total baris qty × harga dengan pembulatan rupiah', () => {
    expect(lineTotal(2, 45_000)).toBe(90_000)
    expect(lineTotal(3, 28_500)).toBe(85_500)
    expect(lineTotal(1, 0)).toBe(0)
  })

  it('menolak jumlah dan harga yang tidak wajar', () => {
    expect(() => lineTotal(0, 45_000)).toThrow('Jumlah dan harga satuan harus angka')
    expect(() => lineTotal(2, -1)).toThrow('Jumlah dan harga satuan harus angka')
    expect(() => lineTotal(Number.NaN, 45_000)).toThrow('Jumlah dan harga satuan harus angka')
  })

  it('membangun item pesanan dan menjumlahkan totalnya', () => {
    const items = buildOrderItems([
      { description: 'Omurice Melody', qty: 2, unit_price: 45_000 },
      { menu_item_id: 7, description: 'Latte Art Kuu', qty: 1, unit_price: 28_000 }
    ])
    expect(items).toHaveLength(2)
    expect(items[0].line_total).toBe(90_000)
    expect(items[1].menu_item_id).toBe(7)
    expect(orderTotal(items)).toBe(118_000)
  })

  it('pesanan tanpa item atau tanpa deskripsi ditolak', () => {
    expect(() => buildOrderItems([])).toThrow('Pesanan harus memiliki sedikitnya satu item menu.')
    expect(() => buildOrderItems([{ qty: 1, unit_price: 10_000 }])).toThrow('deskripsi')
  })
})

describe('pengendalian penjualan kredit', () => {
  const base = {
    paymentType: 'KREDIT' as const,
    customerType: 'KORPORAT',
    creditLimit: 2_000_000,
    outstanding: 500_000,
    orderTotal: 750_000,
    creditApproved: true
  }

  it('menghitung sisa limit kredit', () => {
    expect(creditAvailable(2_000_000, 500_000)).toBe(1_500_000)
    expect(creditAvailable(500_000, 800_000)).toBe(0)
  })

  it('menerima kredit yang masih dalam limit', () => {
    expect(() => assertCreditAllowed(base)).not.toThrow()
  })

  it('menolak kredit tanpa persetujuan manajer', () => {
    expect(() => assertCreditAllowed({ ...base, creditApproved: false })).toThrow(
      'Penjualan kredit harus mendapat persetujuan manajer'
    )
  })

  it('menolak kredit ketika pelanggan tidak punya limit', () => {
    expect(() => assertCreditAllowed({ ...base, creditLimit: 0 })).toThrow(
      'Pelanggan tidak memiliki limit kredit'
    )
  })

  it('menolak kredit yang melebihi limit piutang', () => {
    expect(() => assertCreditAllowed({ ...base, orderTotal: 1_600_000 })).toThrow(
      'Limit kredit pelanggan tidak mencukupi'
    )
  })

  it('penjualan tunai tidak memerlukan persetujuan kredit', () => {
    expect(() => assertCreditAllowed({ ...base, paymentType: 'TUNAI', creditApproved: false })).not.toThrow()
  })
})

describe('penerimaan kas dan sisa faktur', () => {
  it('menghitung sisa faktur', () => {
    expect(invoiceRemaining(118_000, 50_000)).toBe(68_000)
    expect(invoiceRemaining(118_000, 118_000)).toBe(0)
    expect(invoiceRemaining(118_000, 200_000)).toBe(0)
  })

  it('menerima pembayaran penuh dan sebagian', () => {
    expect(assertReceiptAmount(68_000, 68_000)).toBe(68_000)
    expect(assertReceiptAmount(25_000, 68_000)).toBe(25_000)
  })

  it('menolak penerimaan nol, negatif, atau melebihi sisa faktur', () => {
    expect(() => assertReceiptAmount(0, 68_000)).toThrow('Jumlah penerimaan kas harus lebih dari nol.')
    expect(() => assertReceiptAmount(100_000, 68_000)).toThrow('melebihi sisa faktur')
    expect(() => assertReceiptAmount(10_000, 0)).toThrow('Faktur ini sudah lunas.')
  })

  it('memilih akun kas sesuai metode penerimaan', () => {
    expect(cashAccountCodeFor('BANK')).toBe('1110')
    expect(cashAccountCodeFor('KAS')).toBe('1120')
  })
})
