import { describe, expect, it } from 'vitest'
import { formatNum, parseNum, SOURCE_LABEL } from './formatters.js'

describe('parseNum menerima pemisah angka Indonesia', () => {
  it('membaca titik sebagai pemisah ribuan', () => {
    expect(parseNum('1.500')).toBe(1500)
    expect(parseNum('1.500.000')).toBe(1500000)
    expect(parseNum('12.345.678')).toBe(12345678)
    expect(parseNum('Rp 1.500.000')).toBe(1500000)
  })

  it('membaca koma sebagai pemisah desimal', () => {
    expect(parseNum('1.500,50')).toBe(1500.5)
    expect(parseNum('12,5')).toBe(12.5)
    expect(parseNum('1500')).toBe(1500)
  })

  it('menerima format Inggris hasil tempelan dari spreadsheet', () => {
    expect(parseNum('1,500.50')).toBe(1500.5)
    expect(parseNum('1,500,000')).toBe(1500000)
  })

  it('tidak lagi menggabung desimal menjadi ribuan', () => {
    // Regresi lama: '1500.50' sebelumnya menghasilkan 150050.
    expect(parseNum('1500.50')).toBe(1500.5)
    expect(parseNum('2500.25')).toBe(2500.25)
  })

  it('menghasilkan nol untuk kosong dan tidak numerik', () => {
    expect(parseNum('')).toBe(0)
    expect(parseNum(null)).toBe(0)
    expect(parseNum(undefined)).toBe(0)
    expect(parseNum('abc')).toBe(0)
    expect(parseNum(4000)).toBe(4000)
  })
})

describe('formatNum menampilkan angka dengan pemisah Indonesia', () => {
  it('mengelompokkan ribuan', () => {
    expect(formatNum('1500')).toBe('1.500')
    expect(formatNum(1500000)).toBe('1.500.000')
    expect(formatNum(0)).toBe('0')
  })

  it('mempertahankan desimal dengan koma', () => {
    expect(formatNum('1500.5')).toBe('1.500,5')
    expect(formatNum('1500.25')).toBe('1.500,25')
  })

  it('kosong tetap kosong supaya kolom dapat dihapus', () => {
    expect(formatNum('')).toBe('')
    expect(formatNum(null)).toBe('')
    expect(formatNum(undefined)).toBe('')
  })

  it('bolak-balik dengan parseNum tidak mengubah nilai', () => {
    for (const value of ['1500', '2500.5', '1234567.89']) {
      expect(parseNum(formatNum(value))).toBe(Number(value))
    }
  })
})

describe('label sumber jurnal berbahasa Indonesia', () => {
  it('melengkapi MANUAL, IMPORT, CLOSING, REVERSAL', () => {
    expect(SOURCE_LABEL).toMatchObject({
      MANUAL: 'Manual',
      IMPORT: 'Impor Excel',
      CLOSING: 'Jurnal Penutup',
      REVERSAL: 'Pembalik'
    })
  })
})
