// Mesin hitung penggajian murni (tanpa database / HTTP).
//
// Aturan yang dikodekan:
//   - PPh 21: TER Jan-Nov (PP 58/2023 + PMK 168/2023), Pasal 17 pada masa
//     pajak terakhir (Desember atau bulan karyawan berhenti).
//   - BPJS: Kesehatan (plafon Rp12 juta), JHT (tanpa plafon), JP (plafon
//     mengikuti tanggal), JKK (kelas risiko), JKM 0,3%.
//   - Lembur: upah sejam = (gaji pokok + tunjangan tetap)/173; jam pertama
//     1,5x, jam berikutnya 2x; hari libur 2x.
//
// Semua tarif adalah parameter bertanggal — jangan menganggap angka di sini
// permanen. Perubahan PTKP/UMP/PP terbaru perlu diperbarui di sini.
import { roundMoney } from './domain'

export type PtkpStatus = 'TK0' | 'TK1' | 'TK2' | 'TK3' | 'K0' | 'K1' | 'K2' | 'K3'
export type TerCategory = 'A' | 'B' | 'C'
export type TaxMode = 'TER' | 'ANNUAL'

export const PTKP_AMOUNT: Record<PtkpStatus, number> = {
  TK0: 54_000_000,
  TK1: 58_500_000,
  TK2: 63_000_000,
  TK3: 67_500_000,
  K0: 58_500_000,
  K1: 63_000_000,
  K2: 67_500_000,
  K3: 72_000_000
}

export const TER_CATEGORY: Record<PtkpStatus, TerCategory> = {
  TK0: 'A', TK1: 'A', K0: 'A',
  TK2: 'B', TK3: 'B', K1: 'B', K2: 'B',
  K3: 'C'
}

// Pasangan [batas atas bruto bulanan, tarif]. Batas terakhir Infinity.
type TerBracket = [number, number]

const TER_A: TerBracket[] = [
  [5_400_000, 0], [5_650_000, 0.0025], [5_950_000, 0.005], [6_300_000, 0.0075],
  [6_750_000, 0.01], [7_500_000, 0.0125], [8_550_000, 0.015], [9_650_000, 0.0175],
  [10_050_000, 0.02], [10_350_000, 0.0225], [10_700_000, 0.025], [11_050_000, 0.03],
  [11_600_000, 0.035], [12_500_000, 0.04], [13_750_000, 0.05], [15_100_000, 0.06],
  [16_950_000, 0.07], [19_750_000, 0.08], [24_150_000, 0.09], [26_450_000, 0.1],
  [28_000_000, 0.11], [30_050_000, 0.12], [32_400_000, 0.13], [35_400_000, 0.14],
  [39_100_000, 0.15], [43_850_000, 0.16], [47_800_000, 0.17], [51_400_000, 0.18],
  [56_300_000, 0.19], [62_200_000, 0.2], [68_600_000, 0.21], [77_500_000, 0.22],
  [89_000_000, 0.23], [103_000_000, 0.24], [125_000_000, 0.25], [157_000_000, 0.26],
  [206_000_000, 0.27], [337_000_000, 0.28], [454_000_000, 0.29], [550_000_000, 0.3],
  [695_000_000, 0.31], [910_000_000, 0.32], [1_400_000_000, 0.33], [Infinity, 0.34]
]

const TER_B: TerBracket[] = [
  [6_200_000, 0], [6_500_000, 0.0025], [6_850_000, 0.005], [7_300_000, 0.0075],
  [9_200_000, 0.01], [10_750_000, 0.015], [11_250_000, 0.02], [11_600_000, 0.025],
  [12_600_000, 0.03], [13_600_000, 0.04], [14_950_000, 0.05], [16_400_000, 0.06],
  [18_450_000, 0.07], [21_850_000, 0.08], [26_000_000, 0.09], [27_700_000, 0.1],
  [29_350_000, 0.11], [31_450_000, 0.12], [33_950_000, 0.13], [37_100_000, 0.14],
  [41_100_000, 0.15], [45_800_000, 0.16], [49_500_000, 0.17], [53_800_000, 0.18],
  [58_500_000, 0.19], [64_000_000, 0.2], [71_000_000, 0.21], [80_000_000, 0.22],
  [93_000_000, 0.23], [109_000_000, 0.24], [129_000_000, 0.25], [163_000_000, 0.26],
  [211_000_000, 0.27], [374_000_000, 0.28], [459_000_000, 0.29], [555_000_000, 0.3],
  [704_000_000, 0.31], [957_000_000, 0.32], [1_405_000_000, 0.33], [Infinity, 0.34]
]

const TER_C: TerBracket[] = [
  [6_600_000, 0], [6_950_000, 0.0025], [7_350_000, 0.005], [7_800_000, 0.0075],
  [8_850_000, 0.01], [9_800_000, 0.0125], [10_950_000, 0.015], [11_200_000, 0.0175],
  [12_050_000, 0.02], [12_950_000, 0.03], [14_150_000, 0.04], [15_550_000, 0.05],
  [17_050_000, 0.06], [19_500_000, 0.07], [22_700_000, 0.08], [26_600_000, 0.09],
  [28_100_000, 0.1], [30_100_000, 0.11], [32_600_000, 0.12], [35_400_000, 0.13],
  [38_900_000, 0.14], [43_000_000, 0.15], [47_400_000, 0.16], [51_200_000, 0.17],
  [55_800_000, 0.18], [60_400_000, 0.19], [66_700_000, 0.2], [74_500_000, 0.21],
  [83_200_000, 0.22], [95_600_000, 0.23], [110_000_000, 0.24], [134_000_000, 0.25],
  [169_000_000, 0.26], [221_000_000, 0.27], [390_000_000, 0.28], [463_000_000, 0.29],
  [561_000_000, 0.3], [709_000_000, 0.31], [965_000_000, 0.32], [1_419_000_000, 0.33],
  [Infinity, 0.34]
]

const TER_TABLES: Record<TerCategory, TerBracket[]> = { A: TER_A, B: TER_B, C: TER_C }

const JKK_RATES = [0.0024, 0.0054, 0.0089, 0.0127, 0.0174]
const BPJS_KESEHATAN_CAP = 12_000_000

export interface PayrollEmployeeInput {
  basicSalary: number
  fixedAllowance: number
  ptkpStatus: PtkpStatus
  jkkRiskClass: number
  familyMembers: number
  isExpatriate: boolean
  prorationFactor?: number
  activeDays?: number
  calendarDays?: number
}

export interface PayrollPeriodInput {
  period: string
  absentDays: number
  overtimeHours: number
  overtimeDays?: number
  holidayOvertimeHours: number
  /** Menit keterlambatan; dicatat sebagai data waktu kerja, bukan potongan gaji otomatis. */
  lateMinutes?: number
  thrAmount: number
  otherAllowance: number
  otherDeduction: number
  taxMode: TaxMode
}

export interface PayrollYtd {
  /** Bruto PPh yang sudah dipotong pada Jan..periode sebelumnya tahun berjalan. */
  gross: number
  /** PPh 21 yang sudah dipotong Jan..periode sebelumnya. */
  tax: number
  /** JHT + JP karyawan yang sudah dipotong Jan..periode sebelumnya. */
  pension: number
}

export interface PayrollCalculation {
  taxMode: TaxMode
  taxCategory: TerCategory | null
  terCategory: TerCategory
  absenceDeduction: number
  overtimePay: number
  thrAmount: number
  otherAllowance: number
  grossCash: number
  bpjsKesehatanEmployee: number
  bpjsKesehatanEmployer: number
  jhtEmployee: number
  jhtEmployer: number
  jpEmployee: number
  jpEmployer: number
  jkkEmployer: number
  jkmEmployer: number
  employerContribution: number
  taxBruto: number
  pph21: number
  otherDeduction: number
  totalDeductions: number
  netPay: number
  employerCost: number
  calculation: Record<string, unknown>
}

export function terRate(category: TerCategory, monthlyBruto: number): number {
  for (const [limit, rate] of TER_TABLES[category]) {
    if (monthlyBruto <= limit) return rate
  }
  return 0.34
}

export function jpWageCap(period: string): number {
  return period >= '2026-03' ? 11_086_300 : 10_547_400
}

/** Tarif Pasal 17 ayat (1) huruf a UU PPh untuk penghasilan kena pajak setahun. */
export function progressiveTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0
  let tax = 0
  let previous = 0
  const brackets: Array<[number, number]> = [
    [60_000_000, 0.05],
    [250_000_000, 0.15],
    [500_000_000, 0.25],
    [5_000_000_000, 0.3],
    [Infinity, 0.35]
  ]
  for (const [limit, rate] of brackets) {
    if (taxableIncome <= limit) return tax + (taxableIncome - previous) * rate
    tax += (limit - previous) * rate
    previous = limit
  }
  return tax
}

function overtimePayOf(
  basicPlusFixed: number,
  regularHours: number,
  overtimeDays: number,
  holidayHours: number
): number {
  const hourly = basicPlusFixed / 173
  const days = regularHours > 0 ? Math.max(1, Math.floor(overtimeDays)) : 0
  const firstHours = Math.min(regularHours, days)
  const rest = Math.max(0, regularHours - firstHours)
  const first = firstHours * hourly * 1.5
  const subsequent = rest * hourly * 2
  const holiday = holidayHours * hourly * 2
  return roundMoney(first + subsequent + holiday)
}

/**
 * THR prorata (Permenaker 6/2016): 1 bulan upah setelah 12 bulan masa kerja,
 * atau proporsional untuk masa kerja 1–12 bulan. Upah = gaji pokok + tunjangan tetap.
 */
export function suggestThrAmount(wage: number, joinDate: string, asOfDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate) || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return 0
  if (joinDate > asOfDate) return 0
  const [jy, jm] = joinDate.split('-').map(Number)
  const [ay, am] = asOfDate.split('-').map(Number)
  const months = (ay - jy) * 12 + (am - jm)
  if (months >= 12) return roundMoney(Math.max(0, wage))
  if (months < 1) return 0
  return roundMoney((Math.max(0, wage) * months) / 12)
}

export function calculatePayroll(
  employee: PayrollEmployeeInput,
  period: PayrollPeriodInput,
  ytd: PayrollYtd
): PayrollCalculation {
  const basic = Math.max(0, Number(employee.basicSalary) || 0)
  const fixed = Math.max(0, Number(employee.fixedAllowance) || 0)
  const wage = basic + fixed
  const [year, month] = period.period.split('-').map(Number)
  const calendarDays = Math.max(
    1,
    Math.floor(Number(employee.calendarDays) || new Date(Date.UTC(year, month, 0)).getUTCDate())
  )
  const activeDays = Math.min(
    calendarDays,
    Math.max(0, Math.floor(Number(employee.activeDays ?? calendarDays)))
  )
  const prorationFactor = Math.min(1, Math.max(0, Number(employee.prorationFactor ?? activeDays / calendarDays)))
  const proratedWage = roundMoney(wage * prorationFactor)
  const absenceDeduction = roundMoney(Math.min(
    proratedWage,
    (wage / 30) * Math.min(calendarDays, Math.max(0, Number(period.absentDays) || 0), activeDays)
  ))
  const overtimeDays = Math.max(1, Math.floor(Number(period.overtimeDays) || 1))
  const overtimePay = overtimePayOf(
    wage,
    Math.max(0, Number(period.overtimeHours) || 0),
    overtimeDays,
    Math.max(0, Number(period.holidayOvertimeHours) || 0)
  )
  const thrAmount = roundMoney(Math.max(0, Number(period.thrAmount) || 0))
  const otherAllowance = roundMoney(Math.max(0, Number(period.otherAllowance) || 0))
  const otherDeduction = roundMoney(Math.max(0, Number(period.otherDeduction) || 0))
  const grossCash = roundMoney(Math.max(
    0,
    proratedWage - absenceDeduction + overtimePay + thrAmount + otherAllowance
  ))

  // BPJS dipotong dari upah pokok + tunjangan tetap, bukan dari lembur/THR.
  const healthBase = Math.min(proratedWage, BPJS_KESEHATAN_CAP)
  const extraFamily = Math.max(0, Math.floor(Number(employee.familyMembers) || 0))
  const bpjsKesehatanEmployee = roundMoney(healthBase * 0.01 * (1 + extraFamily))
  const bpjsKesehatanEmployer = roundMoney(healthBase * 0.04)
  const jhtEmployee = roundMoney(proratedWage * 0.02)
  const jhtEmployer = roundMoney(proratedWage * 0.037)
  const jpBase = employee.isExpatriate ? 0 : Math.min(proratedWage, jpWageCap(period.period))
  const jpEmployee = roundMoney(jpBase * 0.01)
  const jpEmployer = roundMoney(jpBase * 0.02)
  const riskIndex = Math.min(4, Math.max(0, Math.floor(Number(employee.jkkRiskClass) || 1) - 1))
  const jkkEmployer = roundMoney(proratedWage * JKK_RATES[riskIndex])
  const jkmEmployer = roundMoney(proratedWage * 0.003)
  const employerContribution = roundMoney(
    bpjsKesehatanEmployer + jhtEmployer + jpEmployer + jkkEmployer + jkmEmployer
  )

  // Premi JKK, JKM, dan BPJS Kesehatan 4% pemberi kerja masuk bruto PPh.
  const taxBruto = roundMoney(grossCash + bpjsKesehatanEmployer + jkkEmployer + jkmEmployer)
  const category = TER_CATEGORY[employee.ptkpStatus]
  let pph21 = 0

  if (period.taxMode === 'ANNUAL') {
    const annualGross = Math.max(0, Number(ytd.gross) || 0) + taxBruto
    const biayaJabatan = Math.min(annualGross * 0.05, 500_000 * 12)
    const pension = Math.max(0, Number(ytd.pension) || 0) + jhtEmployee + jpEmployee
    const ptkp = PTKP_AMOUNT[employee.ptkpStatus] ?? PTKP_AMOUNT.TK0
    const pkp = Math.max(0, annualGross - biayaJabatan - pension - ptkp)
    const annualTax = progressiveTax(pkp)
    pph21 = roundMoney(Math.max(0, annualTax - Math.max(0, Number(ytd.tax) || 0)))
  } else {
    pph21 = roundMoney(taxBruto * terRate(category, taxBruto))
  }

  const totalDeductions = roundMoney(
    bpjsKesehatanEmployee + jhtEmployee + jpEmployee + pph21 + otherDeduction
  )
  if (totalDeductions > grossCash + 0.01) {
    throw new Error('Total potongan melebihi gaji kotor; periksa absensi, pajak, dan potongan lain.')
  }
  const netPay = roundMoney(grossCash - totalDeductions)
  const employerCost = roundMoney(grossCash + employerContribution)

  return {
    taxMode: period.taxMode,
    taxCategory: period.taxMode === 'TER' ? category : null,
    terCategory: category,
    absenceDeduction,
    overtimePay,
    thrAmount,
    otherAllowance,
    grossCash,
    bpjsKesehatanEmployee,
    bpjsKesehatanEmployer,
    jhtEmployee,
    jhtEmployer,
    jpEmployee,
    jpEmployer,
    jkkEmployer,
    jkmEmployer,
    employerContribution,
    taxBruto,
    pph21,
    otherDeduction,
    totalDeductions,
    netPay,
    employerCost,
    calculation: {
      basic,
      fixedAllowance: fixed,
      wageBasis: wage,
      proratedWage,
      prorationFactor,
      activeDays,
      calendarDays,
      absenceDeduction,
      overtimeDays,
      lateMinutes: Math.max(0, Math.floor(Number(period.lateMinutes) || 0)),
      healthBase,
      jpBase,
      jkkRate: JKK_RATES[riskIndex],
      ptkp: PTKP_AMOUNT[employee.ptkpStatus] ?? PTKP_AMOUNT.TK0,
      terCategory: category,
      ytd
    }
  }
}
