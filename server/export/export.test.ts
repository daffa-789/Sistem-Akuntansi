// Uji ekspor xlsx/pdf + format IDR — menjalankan dengan `bun test server/`.
import { describe, expect, it } from 'bun:test'
import * as XLSX from 'xlsx/xlsx.mjs'
import { formatIdr } from '../lib/format'
import { journalPdf } from './pdf'
import { Sheet, STYLE, Workbook } from '../lib/xlsx'
import { journalTemplate, journalWorkbook } from './xlsx'
import type { JournalData, JournalRow } from './index'

function journalRow(overrides: Partial<JournalRow> = {}): JournalRow {
  return {
    show_head: true,
    date: '2026-10-01',
    voucher: 'JRN-001',
    account: 'Kas',
    ref_code: '1100',
    debit: 5000000,
    credit: 0,
    is_credit: false,
    alternate: false,
    line_memo: '',
    end_memo: '',
    ...overrides
  }
}

function journalData(entries: JournalRow[]): JournalData {
  return {
    company: 'PT Finova Akuntansi Indonesia',
    from: '2026-10-01',
    to: '2026-10-31',
    entries,
    total_debit: entries.reduce((sum, e) => sum + e.debit, 0),
    total_credit: entries.reduce((sum, e) => sum + e.credit, 0),
    recap: {
      debits: [{ code: '1100', name: 'Kas', amount: 5000000 }],
      credits: [{ code: '3100', name: 'Modal Pemilik', amount: 5000000 }],
      total_debit: 5000000,
      total_credit: 5000000,
      is_balanced: true
    },
    signers: { maker: 'Staf Akuntansi', checker: 'Supervisor', approver: 'Pimpinan' },
    printed_on: '2026-10-19'
  }
}

describe('formatIdr', () => {
  it('memformat rupiah gaya Indonesia', () => {
    expect(formatIdr(5000000)).toBe('5.000.000')
    expect(formatIdr(750000)).toBe('750.000')
    expect(formatIdr(0)).toBe('-')
  })

  it('memformat dua desimal dengan koma', () => {
    expect(formatIdr(1234.5)).toBe('1.234,50')
    expect(formatIdr(1234.56)).toBe('1.234,56')
    expect(formatIdr(1000.05)).toBe('1.000,05')
  })

  it('memakai tanda minus untuk nilai negatif', () => {
    expect(formatIdr(-250000)).toBe('-250.000')
  })
})

describe('xlsx', () => {
  it('menghasilkan arsip zip yang valid (magic PK)', () => {
    const bytes = journalTemplate()
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes.length).toBeGreaterThan(3000)
  })

  it('memuat seluruh bagian wajib OOXML', () => {
    // Telusuri nama-nama entri dengan membaca isi arsip secara kasar: cukup
    // pastikan workload memuat penanda string kunci XML.
    const bytes = journalTemplate()
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain('[Content_Types].xml')
    expect(text).toContain('xl/workbook.xml')
    expect(text).toContain('xl/styles.xml')
    expect(text).toContain('xl/worksheets/sheet1.xml')
    expect(text).toContain('#,##0.00')
    expect(text).toContain('Jurnal')
  })

  it('menulis sel string sebagai inlineStr dan angka sebagai number', () => {
    const wb = new Workbook()
    const ws = wb.add('Uji')
    ws.write(0, 0, 'Halo', STYLE.NORMAL)
    ws.write(0, 1, 5000, STYLE.MONEY)
    const bytes = wb.build()
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain('t="inlineStr"')
    expect(text).toContain('<v>5000</v>')
  })

  it('menghitung referensi kolom melewati Z ke AA', () => {
    const wb = new Workbook()
    const ws = wb.add('Uji')
    ws.write(0, 26, 'Kolom ke-27')
    ws.write(0, 27, 'Kolom ke-28')
    const text = new TextDecoder('latin1').decode(wb.build())
    expect(text).toContain('r="AA1"')
    expect(text).toContain('r="AB1"')
  })

  it('dapat dibaca ulang oleh SheetJS (template)', () => {
    const wb = XLSX.read(journalTemplate(), { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['Jurnal'])
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Jurnal'], { header: 1 })
    expect(rows[0]).toEqual(['NoBukti', 'Tanggal', 'KodeAkun', 'NamaAkun', 'Debit', 'Kredit', 'Keterangan'])
    expect(rows[1][0]).toBe('JU-001')
    expect(rows[1][4]).toBe(5000000)
    expect(rows[4][4]).toBe(0)
  })

  it('dapat dibaca ulang oleh SheetJS (jurnal umum)', () => {
    const data = journalData([
      journalRow(),
      journalRow({
        show_head: false,
        date: '',
        voucher: '',
        account: 'Modal Pemilik',
        ref_code: '3100',
        debit: 0,
        credit: 5000000,
        is_credit: true
      })
    ])
    const wb = XLSX.read(journalWorkbook(data), { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['Jurnal Umum'])
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Jurnal Umum'], {
      header: 1
    })
    // Baris ke-5 (indeks 4) adalah kepala tabel; cari baris TOTAL.
    const flat = rows.map((r) => (r ?? []) as unknown[])
    const totalRow = flat.find((r) => r[2] === 'TOTAL')
    expect(totalRow).toBeDefined()
    expect(totalRow![4]).toBe(5000000)
    expect(totalRow![5]).toBe(5000000)
  })
})

describe('pdf', () => {
  it('menghasilkan berkas PDF lengkap', () => {
    const data = journalData([
      journalRow(),
      journalRow({
        show_head: false,
        date: '',
        voucher: '',
        account: '     ↳ Modal Pemilik',
        ref_code: '3100',
        debit: 0,
        credit: 5000000,
        is_credit: true,
        alternate: true,
        end_memo: 'Setoran modal awal'
      })
    ])
    const bytes = journalPdf(data)
    const header = new TextDecoder('latin1').decode(bytes.slice(0, 8))
    const tail = new TextDecoder('latin1').decode(bytes.slice(-8))
    expect(header.startsWith('%PDF-')).toBe(true)
    expect(tail).toContain('%%EOF')
    expect(bytes.length).toBeGreaterThan(1500)
  })

  it('memuat font Helvetica dan objek halaman', () => {
    const bytes = journalPdf(journalData([journalRow()]))
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).toContain('/Type /Page')
    expect(text).toContain('JURNAL UMUM')
  })

  it('memecah halaman ketika baris melewati batas bawah', () => {
    const many: JournalRow[] = []
    for (let i = 0; i < 120; i++) {
      many.push(journalRow({ show_head: i % 2 === 0, date: i % 2 === 0 ? '2026-10-01' : '', voucher: i % 2 === 0 ? `JRN-${i}` : '' }))
    }
    const bytes = journalPdf(journalData(many))
    const text = new TextDecoder('latin1').decode(bytes)
    const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length
    expect(pageCount).toBeGreaterThan(1)
  })
})
