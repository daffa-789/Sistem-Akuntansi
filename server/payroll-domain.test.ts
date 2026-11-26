import { describe, expect, it } from 'bun:test'
import {
  calculatePayroll,
  jpWageCap,
  suggestThrAmount,
  progressiveTax,
  terRate,
  type PayrollEmployeeInput,
  type PayrollPeriodInput
} from './payroll-domain'

const employee: PayrollEmployeeInput = {
  basicSalary: 10_000_000,
  fixedAllowance: 0,
  ptkpStatus: 'TK0',
  jkkRiskClass: 1,
  familyMembers: 0,
  isExpatriate: false
}

const period = (overrides: Partial<PayrollPeriodInput> = {}): PayrollPeriodInput => ({
  period: '2026-06',
  absentDays: 0,
  overtimeHours: 0,
  holidayOvertimeHours: 0,
  thrAmount: 0,
  otherAllowance: 0,
  otherDeduction: 0,
  taxMode: 'TER',
  ...overrides
})

describe('tarif PPh 21', () => {
  it('TER A membaca batas bruto bulanan dengan tepat', () => {
    expect(terRate('A', 5_400_000)).toBe(0)
    expect(terRate('A', 5_400_001)).toBe(0.0025)
    expect(terRate('A', 10_454_000)).toBe(0.025)
    expect(terRate('A', 1_400_000_001)).toBe(0.34)
  })

  it('kategori TER mengikuti PTKP awal tahun', () => {
    expect(terRate('B', 6_200_000)).toBe(0)
    expect(terRate('C', 6_600_000)).toBe(0)
  })

  it('tarif progresif Pasal 17 menghitung per lapisan', () => {
    expect(progressiveTax(0)).toBe(0)
    expect(progressiveTax(60_000_000)).toBe(3_000_000)
    // 60 jt pertama 5%, sisanya 15%.
    expect(progressiveTax(100_000_000)).toBe(9_000_000)
  })

  it('plafon JP berubah pada Maret 2026', () => {
    expect(jpWageCap('2026-02')).toBe(10_547_400)
    expect(jpWageCap('2026-03')).toBe(11_086_300)
  })
})

describe('hitung gaji', () => {
  it('menghitung BPJS dan PPh TER untuk karyawan TK/0', () => {
    const result = calculatePayroll(employee, period(), { gross: 0, tax: 0, pension: 0 })
    expect(result.grossCash).toBe(10_000_000)
    expect(result.bpjsKesehatanEmployee).toBe(100_000)
    expect(result.bpjsKesehatanEmployer).toBe(400_000)
    expect(result.jhtEmployee).toBe(200_000)
    expect(result.jpEmployee).toBe(100_000)
    expect(result.jkkEmployer).toBe(24_000)
    expect(result.jkmEmployer).toBe(30_000)
    expect(result.taxBruto).toBe(10_454_000)
    expect(result.pph21).toBe(261_350)
    expect(result.netPay).toBe(9_338_650)
    expect(result.employerCost).toBe(11_024_000)
  })

  it('lembur jam pertama 1,5x per hari dan jam berikutnya 2x', () => {
    const result = calculatePayroll(
      { ...employee, basicSalary: 1_730_000 },
      period({ overtimeHours: 3 }),
      { gross: 0, tax: 0, pension: 0 }
    )
    // Upah sejam Rp10.000 -> 10.000*1,5 + 20.000*2 = 55.000
    expect(result.overtimePay).toBe(55_000)
    expect(result.grossCash).toBe(1_785_000)

    const twoDays = calculatePayroll(
      { ...employee, basicSalary: 1_730_000 },
      period({ overtimeHours: 4, overtimeDays: 2 } as Partial<PayrollPeriodInput>),
      { gross: 0, tax: 0, pension: 0 }
    )
    // Dua jam pertama pada dua hari berbeda: 2*10.000*1,5 + 2*10.000*2.
    expect(twoDays.overtimePay).toBe(70_000)
  })

  it('memprorasi upah untuk karyawan masuk atau keluar di tengah periode', () => {
    const result = calculatePayroll(
      { ...employee, prorationFactor: 0.5, activeDays: 15, calendarDays: 30 },
      period(),
      { gross: 0, tax: 0, pension: 0 }
    )
    expect(result.grossCash).toBe(5_000_000)
    expect(result.jhtEmployee).toBe(100_000)
    expect(result.calculation.prorationFactor).toBe(0.5)
  })

  it('menolak total potongan yang melebihi gaji kotor', () => {
    expect(() => calculatePayroll(
      { ...employee, basicSalary: 3_000_000 },
      period({ otherDeduction: 100_000_000 }),
      { gross: 0, tax: 0, pension: 0 }
    )).toThrow('melebihi gaji kotor')
  })

  it('potongan absensi dikurangi dari gaji kotor', () => {
    const result = calculatePayroll(employee, period({ absentDays: 3 }), { gross: 0, tax: 0, pension: 0 })
    expect(result.absenceDeduction).toBe(1_000_000)
    expect(result.grossCash).toBe(9_000_000)
  })

  it('memakai Pasal 17 dan mengurangi PPh yang sudah dipotong pada masa terakhir', () => {
    const result = calculatePayroll(
      employee,
      period({ period: '2026-12', taxMode: 'ANNUAL' }),
      { gross: 114_994_000, tax: 2_873_850, pension: 3_300_000 }
    )
    expect(result.taxMode).toBe('ANNUAL')
    expect(result.taxCategory).toBeNull()
    expect(result.terCategory).toBe('A')
    expect(result.pph21).toBeGreaterThan(0)
    expect(result.pph21).toBeLessThan(1_000_000)
  })

  it('THR prorata masuk bruto tapi tidak menaikkan basis BPJS', () => {
    const result = calculatePayroll(employee, period({ thrAmount: 5_000_000 }), { gross: 0, tax: 0, pension: 0 })
    expect(result.grossCash).toBe(15_000_000)
    expect(result.jhtEmployee).toBe(200_000)
    expect(result.taxBruto).toBe(15_454_000)
  })

  it('menyarankan THR 1 bulan untuk masa kerja 12 bulan dan proporsional di bawahnya', () => {
    expect(suggestThrAmount(10_000_000, '2025-06-01', '2026-06-01')).toBe(10_000_000)
    expect(suggestThrAmount(10_000_000, '2026-01-01', '2026-06-01')).toBe(4_166_666.67)
    expect(suggestThrAmount(10_000_000, '2026-05-01', '2026-06-01')).toBe(833_333.33)
  })

  it('ekspatriat tidak dipotong JP', () => {
    const result = calculatePayroll(
      { ...employee, isExpatriate: true },
      period(),
      { gross: 0, tax: 0, pension: 0 }
    )
    expect(result.jpEmployee).toBe(0)
    expect(result.jpEmployer).toBe(0)
  })

  it('jumlah debit dan kredit jurnal selalu seimbang', () => {
    const result = calculatePayroll(
      { ...employee, fixedAllowance: 2_000_000, familyMembers: 1 },
      period({ overtimeHours: 2, otherAllowance: 500_000, otherDeduction: 250_000 }),
      { gross: 0, tax: 0, pension: 0 }
    )
    const employeeDeductions =
      result.bpjsKesehatanEmployee + result.jhtEmployee + result.jpEmployee + result.pph21 + result.otherDeduction
    const kredit =
      result.netPay + employeeDeductions + result.employerContribution
    expect(kredit).toBe(result.employerCost)
  })
})
