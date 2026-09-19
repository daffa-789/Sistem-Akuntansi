import {
  assertBalancedLines, buildBalanceSheet, buildCashFlowDirect, buildEquityChanges,
  buildIncomeStatement, buildTrialBalance, makeClosingLines
} from './accounting.js'

const accounts = [
  { id: 1, code: '1100', name: 'Kas', account_group: 'ASSET', account_subtype: 'CASH', normal_balance: 'DEBIT', is_active: true, is_cash_account: true, cash_flow_category: 'OPERATING' },
  { id: 2, code: '3100', name: 'Modal', account_group: 'EQUITY', account_subtype: 'OWNER_CAPITAL', normal_balance: 'CREDIT', is_active: true, cash_flow_category: 'FINANCING' },
  { id: 3, code: '3200', name: 'Laba Ditahan', account_group: 'EQUITY', account_subtype: 'RETAINED_EARNINGS', normal_balance: 'CREDIT', is_active: true, cash_flow_category: 'OPERATING' },
  { id: 4, code: '4100', name: 'Pendapatan', account_group: 'REVENUE', account_subtype: 'SERVICE_REVENUE', normal_balance: 'CREDIT', is_active: true, cash_flow_category: 'OPERATING' },
  { id: 5, code: '5200', name: 'Beban Gaji', account_group: 'EXPENSE', account_subtype: 'SALARY', normal_balance: 'DEBIT', is_active: true, cash_flow_category: 'OPERATING' },
  { id: 6, code: '3300', name: 'Prive', account_group: 'EQUITY', account_subtype: 'DRAWINGS', normal_balance: 'DEBIT', is_active: true, cash_flow_category: 'FINANCING' }
]

const capital = { source: 'MANUAL', lines: [{ account_id: 1, debit: 5000000, credit: 0 }, { account_id: 2, debit: 0, credit: 5000000 }] }
const income = { source: 'MANUAL', lines: [{ account_id: 1, debit: 1000000, credit: 0 }, { account_id: 4, debit: 0, credit: 1000000 }] }
const expense = { source: 'MANUAL', lines: [{ account_id: 5, debit: 400000, credit: 0 }, { account_id: 1, debit: 0, credit: 400000 }] }
const drawings = { source: 'MANUAL', lines: [{ account_id: 6, debit: 200000, credit: 0 }, { account_id: 1, debit: 0, credit: 200000 }] }
const lines = [...capital.lines, ...income.lines, ...expense.lines, ...drawings.lines]

describe('aturan jurnal akuntansi', () => {
  it('menerima jurnal berpasangan dan menolak yang tidak seimbang', () => {
    expect(assertBalancedLines(income.lines)).toHaveLength(2)
    expect(() => assertBalancedLines([{ account_id: 1, debit: 100, credit: 0 }, { account_id: 4, debit: 0, credit: 99 }])).toThrow('Jurnal tidak seimbang')
  })

  it('membentuk neraca saldo dengan debit dan kredit seimbang', () => {
    const report = buildTrialBalance(accounts, lines)
    expect(report.totals.debit).toBe(6000000)
    expect(report.totals.credit).toBe(6000000)
  })

  it('menempatkan saldo akun yang berlawanan arah pada sisi lawannya', () => {
    const report = buildTrialBalance(accounts, [{ account_id: 1, debit: 0, credit: 150000 }, { account_id: 4, debit: 150000, credit: 0 }])
    expect(report.rows.find((row) => row.accountId === 1)).toMatchObject({ debit: 0, credit: 150000 })
    expect(report.rows.find((row) => row.accountId === 4)).toMatchObject({ debit: 150000, credit: 0 })
  })

  it('menghitung laba rugi dan neraca yang seimbang', () => {
    const incomeStatement = buildIncomeStatement(accounts, [...income.lines, ...expense.lines])
    expect(incomeStatement.netIncome).toBe(600000)
    const balanceSheet = buildBalanceSheet(accounts, lines)
    expect(balanceSheet.assets.total).toBe(5400000)
    expect(balanceSheet.equity.total).toBe(5400000)
    expect(balanceSheet.balanced).toBe(true)
  })

  it('menghitung perubahan modal dengan prive sebagai pengurang modal', () => {
    const report = buildEquityChanges(accounts, capital.lines, [...income.lines, ...expense.lines, ...drawings.lines])
    expect(report.opening).toBe(5000000)
    expect(report.drawings).toBe(-200000)
    expect(report.netIncome).toBe(600000)
    expect(report.closing).toBe(5400000)
  })

  it('mengelompokkan arus kas langsung berdasarkan akun lawan', () => {
    const report = buildCashFlowDirect(accounts, [capital, income, expense, drawings])
    expect(report.operating).toBe(600000)
    expect(report.financing).toBe(4800000)
    expect(report.netChange).toBe(5400000)
  })

  it('membuat jurnal penutup yang seimbang ke laba ditahan', () => {
    const closing = makeClosingLines(accounts, [...income.lines, ...expense.lines])
    expect(closing.reduce((sum, line) => sum + line.debit, 0)).toBe(1000000)
    expect(closing.reduce((sum, line) => sum + line.credit, 0)).toBe(1000000)
    expect(closing.find((line) => line.account_id === 3)).toMatchObject({ credit: 600000 })
  })
})
