// Uji domain akuntansi — menjalankan dengan `bun test server/`.
//
// Nilai harapan dihitung berdasarkan perilaku versi Rust (src-rust/domain/mod.rs)
// agar porting ini tidak menyimpang dari aturan aslinya.
import { describe, expect, it } from 'bun:test'
import {
  assertBalanced,
  buildBalanceSheet,
  buildCashFlowDirect,
  buildEquityChanges,
  buildIncomeStatement,
  buildTrialBalance,
  calculateAccountBalances,
  dateText,
  flatten,
  makeClosingLines,
  normalizeAndAssert,
  parseF64,
  roundMoney,
  type Account,
  type AmountedLine,
  type Entry
} from './domain'

function account(
  id: number,
  code: string,
  group: string,
  subtype: string | null,
  normalBalance: 'DEBIT' | 'CREDIT',
  options: { cash?: boolean; cashFlow?: string; active?: boolean } = {}
): Account {
  return {
    id,
    code,
    name: `Akun ${code}`,
    group,
    subtype,
    normal_balance: normalBalance,
    cash_flow_category: options.cashFlow ?? 'OPERATING',
    is_cash_account: options.cash ?? false,
    is_active: options.active ?? true
  }
}

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
    code: null,
    account_name: null,
    source: '',
    entry_date: '',
    voucher_no: '',
    description: '',
    ...extra
  }
}

const ACCOUNTS: Account[] = [
  account(1, '1100', 'ASSET', 'CASH', 'DEBIT', { cash: true }),
  account(2, '1200', 'ASSET', 'RECEIVABLE', 'DEBIT'),
  account(3, '2100', 'LIABILITY', 'PAYABLE', 'CREDIT'),
  account(4, '3100', 'EQUITY', 'OWNER_CAPITAL', 'CREDIT', { cashFlow: 'FINANCING' }),
  account(5, '3200', 'EQUITY', 'DRAWINGS', 'DEBIT', { cashFlow: 'FINANCING' }),
  account(6, '3400', 'EQUITY', 'RETAINED_EARNINGS', 'CREDIT'),
  account(7, '4100', 'REVENUE', 'SERVICE_REVENUE', 'CREDIT'),
  account(8, '5100', 'EXPENSE', 'COGS', 'DEBIT'),
  account(9, '1500', 'ASSET', 'FIXED_ASSET', 'DEBIT', { cashFlow: 'INVESTING' })
]

describe('roundMoney', () => {
  it('membulatkan ke dua desimal seperti js_round di Rust', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    // Catatan: kompensasi NUMBER_EPSILON membuat 2.675 (yang di f64 bernilai
    // 2.6749999...) membulatkan ke 2.68 — perilaku ini SAMA dengan versi Rust,
    // dan itulah yang diujikan di sini (paritas, bukan nilai "ideal").
    expect(roundMoney(2.675)).toBe(2.68)
    expect(roundMoney(2.665)).toBe(2.67)
    expect(roundMoney(1.005)).toBe(1.01)
    expect(roundMoney(1234.5678)).toBe(1234.57)
  })

  it('membulatkan tepat 0,5 ke atas (seperti floor(v + 0.5))', () => {
    expect(roundMoney(0.125)).toBe(0.13)
    expect(roundMoney(0.135)).toBe(0.14)
  })

  it('menangani nilai negatif', () => {
    expect(roundMoney(-0.004)).toBe(0)
    expect(roundMoney(-0.005)).toBe(0)
  })
})

describe('parseF64', () => {
  it('menerima angka', () => {
    expect(parseF64(1000)).toBe(1000)
    expect(parseF64(1000.556)).toBe(1000.56)
  })

  it('membuang koma (pemisah ribuan) seperti versi Rust', () => {
    expect(parseF64('1.000,50'.replace('.', ''))).toBe(100050)
    expect(parseF64('250000')).toBe(250000)
  })

  it('mengembalikan 0 untuk nilai tak valid', () => {
    expect(parseF64('abc')).toBe(0)
    expect(parseF64(null)).toBe(0)
    expect(parseF64(undefined)).toBe(0)
    expect(parseF64({})).toBe(0)
  })
})

describe('normalizeAndAssert', () => {
  it('menolak jurnal satu baris', () => {
    expect(() =>
      normalizeAndAssert([{ accountId: 1, debit: 100, credit: 0 }])
    ).toThrow('Jurnal harus memiliki sedikitnya dua baris.')
  })

  it('menomor baris berurutan dan mempertahankan memo', () => {
    const lines = normalizeAndAssert([
      { accountId: 1, debit: 100, credit: 0, memo: 'kas' },
      { account_id: 4, debit: 0, credit: 100 }
    ])
    expect(lines.map((l) => l.line_no)).toEqual([1, 2])
    expect(lines[0].memo).toBe('kas')
    expect(lines[0].account_id).toBe(1)
    expect(lines[1].account_id).toBe(4)
  })

  it('menerima accountId maupun account_id', () => {
    const lines = normalizeAndAssert([
      { account_id: 1, debit: 100, credit: 0 },
      { accountId: 4, debit: 0, credit: 100 }
    ])
    expect(lines.map((l) => l.account_id)).toEqual([1, 4])
  })

  it('menolak baris tanpa akun', () => {
    expect(() =>
      normalizeAndAssert([
        { debit: 100, credit: 0 },
        { accountId: 4, debit: 0, credit: 100 }
      ])
    ).toThrow('Baris 1: akun wajib dipilih.')
  })

  it('menolak baris dengan debit dan kredit terisi bersamaan', () => {
    expect(() =>
      normalizeAndAssert([
        { accountId: 1, debit: 100, credit: 50 },
        { accountId: 4, debit: 0, credit: 50 }
      ])
    ).toThrow('Baris 1: isi tepat salah satu kolom debit atau kredit.')
  })

  it('menolak jurnal tidak seimbang dengan pesan persis', () => {
    expect(() =>
      normalizeAndAssert([
        { accountId: 1, debit: 100, credit: 0 },
        { accountId: 4, debit: 0, credit: 90 }
      ])
    ).toThrow('Jurnal tidak seimbang: debit 100 dan kredit 90.')
  })

  it('meloloskan jurnal seimbang dan membulatkan nominal', () => {
    // parseF64 membuang koma: '100,555' -> 100555
    const lines = normalizeAndAssert([
      { accountId: 1, debit: '100,555', credit: 0 },
      { accountId: 4, debit: 0, credit: 100555 }
    ])
    expect(lines[0].debit).toBe(100555)
    expect(lines[1].credit).toBe(100555)
  })
})

describe('assertBalanced', () => {
  it('mentoleransi selisih di bawah epsilon', () => {
    const ok = [
      line(1, 100, 0),
      line(4, 0, 100)
    ]
    expect(() => assertBalanced(ok)).not.toThrow()
  })
})

describe('buildTrialBalance', () => {
  const lines = [
    line(1, 5000000, 0),
    line(4, 0, 5000000),
    line(2, 1000000, 0),
    line(7, 0, 1000000)
  ]

  it('menghitung saldo bertanda sesuai saldo normal', () => {
    const tb = buildTrialBalance(ACCOUNTS, lines)
    const kas = tb.rows.find((r) => r.code === '1100')!
    const modal = tb.rows.find((r) => r.code === '3100')!
    expect(kas.debit).toBe(5000000)
    expect(kas.credit).toBe(0)
    expect(kas.signedBalance).toBe(5000000)
    expect(modal.credit).toBe(5000000)
    expect(modal.signedBalance).toBe(5000000)
  })

  it('hanya memuat akun dengan saldo tak nol', () => {
    const tb = buildTrialBalance(ACCOUNTS, lines)
    expect(tb.rows.map((r) => r.code).sort()).toEqual(['1100', '1200', '3100', '4100'])
  })

  it('melaporkan keseimbangan', () => {
    const tb = buildTrialBalance(ACCOUNTS, lines)
    expect(tb.totals.debit).toBe(6000000)
    expect(tb.totals.credit).toBe(6000000)
    expect(tb.isBalanced).toBe(true)
  })
})

describe('buildIncomeStatement', () => {
  it('mengabaikan baris bersumber CLOSING', () => {
    const lines = [
      line(7, 0, 1000000, { source: 'MANUAL' }),
      line(8, 250000, 0, { source: 'MANUAL' }),
      line(7, 1000000, 0, { source: 'CLOSING' }),
      line(8, 0, 250000, { source: 'CLOSING' })
    ]
    const income = buildIncomeStatement(ACCOUNTS, lines)
    expect(income.revenueTotal).toBe(1000000)
    expect(income.expenseTotal).toBe(250000)
    expect(income.netIncome).toBe(750000)
  })

  it('tidak menampilkan saldo negatif (max 0)', () => {
    const lines = [line(8, 100, 0), line(1, 0, 100)]
    const income = buildIncomeStatement(ACCOUNTS, lines)
    expect(income.expenseTotal).toBe(100)
  })
})

describe('buildBalanceSheet', () => {
  it('menghitung ekuitas termasuk prive yang dinegasikan', () => {
    const lines = [
      line(1, 8000000, 0),
      line(4, 0, 5000000),
      line(5, 2000000, 0), // prive: saldo normal DEBIT, dinegasikan di ekuitas
      line(7, 0, 5000000)
    ]
    const bs = buildBalanceSheet(ACCOUNTS, lines)
    // aset 8.000.000; liabilitas 0; ekuitas = modal 5.000.000 - prive 2.000.000 + laba 5.000.000
    expect(bs.assets.total).toBe(8000000)
    expect(bs.liabilities.total).toBe(0)
    expect(bs.equity.rows.find((r) => r.code === '3100')!.amount).toBe(5000000)
    expect(bs.equity.rows.find((r) => r.code === '3200')!.amount).toBe(-2000000)
    expect(bs.equity.unclosedProfit).toBe(5000000)
    expect(bs.balanced).toBe(true)
  })
})

describe('buildEquityChanges', () => {
  it('menghitung ekuitas awal, modal, prive, laba, dan ekuitas akhir', () => {
    const before = [line(4, 0, 1000000)]
    const period = [
      line(4, 0, 500000),
      line(5, 100000, 0),
      line(7, 0, 250000),
      line(1, 350000, 0)
    ]
    const changes = buildEquityChanges(ACCOUNTS, before, period)
    expect(changes.opening).toBe(1000000)
    expect(changes.capital).toBe(500000)
    expect(changes.drawings).toBe(-100000)
    expect(changes.netIncome).toBe(250000)
    expect(changes.closing).toBe(1650000)
  })
})

describe('buildCashFlowDirect', () => {
  function entry(id: number, source: string, lines: Entry['lines']): Entry {
    return {
      id,
      voucher_no: `JRN-00${id}`,
      entry_date: '2026-10-01',
      description: '',
      source,
      status: 'POSTED',
      reversal_of_id: null,
      reversed: false,
      lines
    }
  }

  it('mengelompokkan arus kas berdasarkan lawan akun kas', () => {
    const entries: Entry[] = [
      entry(1, 'MANUAL', [
        { account_id: 1, line_no: 1, debit: 1000000, credit: 0, memo: null, code: '1100', account_name: 'Kas' },
        { account_id: 7, line_no: 2, debit: 0, credit: 1000000, memo: null, code: '4100', account_name: 'Pendapatan' }
      ]),
      entry(2, 'MANUAL', [
        { account_id: 1, line_no: 1, debit: 0, credit: 500000, memo: null, code: '1100', account_name: 'Kas' },
        { account_id: 9, line_no: 2, debit: 500000, credit: 0, memo: null, code: '1500', account_name: 'Peralatan' }
      ]),
      entry(3, 'MANUAL', [
        { account_id: 1, line_no: 1, debit: 2000000, credit: 0, memo: null, code: '1100', account_name: 'Kas' },
        { account_id: 4, line_no: 2, debit: 0, credit: 2000000, memo: null, code: '3100', account_name: 'Modal' }
      ])
    ]
    const cash = buildCashFlowDirect(ACCOUNTS, entries)
    expect(cash.operating).toBe(1000000)
    expect(cash.investing).toBe(-500000)
    expect(cash.financing).toBe(2000000)
    expect(cash.netChange).toBe(2500000)
  })

  it('mengabaikan entri CLOSING', () => {
    const entries: Entry[] = [
      entry(1, 'CLOSING', [
        { account_id: 1, line_no: 1, debit: 999999, credit: 0, memo: null, code: '1100', account_name: 'Kas' },
        { account_id: 6, line_no: 2, debit: 0, credit: 999999, memo: null, code: '3400', account_name: 'Laba Ditahan' }
      ])
    ]
    const cash = buildCashFlowDirect(ACCOUNTS, entries)
    expect(cash.netChange).toBe(0)
  })
})

describe('makeClosingLines', () => {
  it('menutup pendapatan & beban ke laba ditahan', () => {
    const lines = [
      line(7, 0, 1000000),
      line(8, 250000, 0),
      line(1, 750000, 0),
      line(4, 0, 500000)
    ]
    const closing = makeClosingLines(ACCOUNTS, lines)
    const byCode = new Map(closing.map((l) => [l.account_id, l]))
    expect(byCode.get(7)!.debit).toBe(1000000)
    expect(byCode.get(8)!.credit).toBe(250000)
    expect(byCode.get(6)!.credit).toBe(750000)
  })

  it('tidak menghasilkan baris ketika tidak ada pendapatan/beban', () => {
    const closing = makeClosingLines(ACCOUNTS, [line(1, 100, 0), line(4, 0, 100)])
    expect(closing).toEqual([])
  })

  it('mengarahkan selisih ke debit laba ditahan bila rugi', () => {
    const lines = [line(8, 100, 0), line(1, 0, 100)]
    const closing = makeClosingLines(ACCOUNTS, lines)
    const retained = closing.find((l) => l.account_id === 6)!
    expect(retained.debit).toBe(100)
  })
})

describe('flatten & dateText', () => {
  it('membawa metadata entri ke setiap baris', () => {
    const entries: Entry[] = [
      {
        id: 1,
        voucher_no: 'JRN-001',
        entry_date: '2026-10-01',
        description: 'Uji',
        source: 'MANUAL',
        status: 'POSTED',
        reversal_of_id: null,
        reversed: false,
        lines: [
          { account_id: 1, line_no: 1, debit: 100, credit: 0, memo: 'm', code: '1100', account_name: 'Kas' },
          { account_id: 4, line_no: 2, debit: 0, credit: 100, memo: null, code: null, account_name: null }
        ]
      }
    ]
    const flat = flatten(entries)
    expect(flat.length).toBe(2)
    expect(flat[0].voucher_no).toBe('JRN-001')
    expect(flat[0].source).toBe('MANUAL')
    expect(flat[1].code).toBeNull()
  })

  it('mengambil 10 karakter pertama tanggal', () => {
    expect(dateText('2026-10-01 12:34:56')).toBe('2026-10-01')
    expect(dateText('2026-10-01')).toBe('2026-10-01')
  })
})

describe('calculateAccountBalances', () => {
  it('mengakumulasi debit dan kredit per akun', () => {
    const balances = calculateAccountBalances(ACCOUNTS, [
      line(1, 100, 0),
      line(1, 50, 0),
      line(1, 0, 30)
    ])
    expect(balances.get(1)).toEqual({ debit: 150, credit: 30 })
    expect(balances.get(2)).toEqual({ debit: 0, credit: 0 })
  })
})
