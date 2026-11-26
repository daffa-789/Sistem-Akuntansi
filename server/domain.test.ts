import { describe, expect, it } from 'bun:test'
import { assertBalanced, roundMoney, type AmountedLine } from './domain'

function line(
  accountId: number,
  debit: number,
  credit: number,
  extra: Partial<AmountedLine> = {}
): AmountedLine {
  return {
    account_id: accountId,
    line_no: 1,
    debit,
    credit,
    memo: null,
    source: 'PAYROLL',
    entry_date: '2026-11-26',
    voucher_no: 'PAY-202611',
    description: 'Penggajian',
    ...extra
  }
}

describe('roundMoney', () => {
  it('membulatkan nominal gaji ke dua desimal', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(1234.5678)).toBe(1234.57)
    expect(roundMoney(0.125)).toBe(0.13)
  })
})

describe('assertBalanced', () => {
  it('menerima jurnal penggajian yang seimbang', () => {
    const lines = [
      line(1, 5_000_000, 0),
      line(2, 0, 1_000_000),
      line(3, 0, 4_000_000)
    ]
    expect(assertBalanced(lines)).toEqual(lines)
  })

  it('menolak jurnal satu baris', () => {
    expect(() => assertBalanced([line(1, 5_000_000, 0)])).toThrow(
      'Jurnal harus memiliki sedikitnya dua baris.'
    )
  })

  it('menolak akun dan baris nominal yang tidak valid', () => {
    expect(() => assertBalanced([line(0, 100, 0), line(1, 0, 100)])).toThrow(
      'Baris 1: akun wajib dipilih.'
    )
    expect(() => assertBalanced([line(1, 100, 50), line(1, 0, 50)])).toThrow(
      'Baris 1: isi tepat salah satu kolom debit atau kredit.'
    )
    expect(() => assertBalanced([line(1, -100, 0), line(1, 0, 100)])).toThrow(
      'Baris 1: isi tepat salah satu kolom debit atau kredit.'
    )
  })

  it('menolak selisih debit dan kredit', () => {
    expect(() => assertBalanced([line(1, 100, 0), line(1, 0, 90)])).toThrow(
      'Jurnal tidak seimbang: debit 100 dan kredit 90.'
    )
  })
})
