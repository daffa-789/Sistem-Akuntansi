// Penulis XLSX minimal bergaya (zip + OOXML) — pengganti rust_xlsxwriter.
//
// Cukup lengkap untuk ekspor Finova: teks, angka, lebar kolom, format
// #,##0.00, warna isian, tepi tipis, garis ganda bawah, dan tebal/miring.
// Tanpa dependensi npm — mengikuti aturan proyek agar node_modules tetap ringan.
import { zipStore } from './zip'

type CellValue = string | number

interface Cell {
  r: number
  c: number
  v: CellValue
  s: number
}

// ===== Gaya (indeks dipakai langsung sebagai s="..." pada elemen <c>) =====
export const STYLE = {
  DEFAULT: 0,
  TITLE: 1, // tebal 14 hijau tua
  SUBTITLE: 2, // tebal 11
  META: 3, // miring 9 abu
  HEADER: 4, // tebal putih di atas hijau 0E7042, bertepi
  HEADER_TEMPLATE: 5, // tebal putih di atas hijau 0A5835, tanpa tepi
  NORMAL: 6, // bertepi tipis
  MONEY: 7, // bertepi tipis, #,##0.00
  BOLD: 8, // tebal, bertepi tipis
  TOTAL_LABEL: 9, // tebal, tepi tipis + ganda bawah, latar F0FDF4
  TOTAL_MONEY: 10, // seperti TOTAL_LABEL + #,##0.00
  RECAP_HEADER: 11, // tebal putih di atas biru 0284C7, bertepi
  RECAP_TITLE: 12 // tebal 10
} as const

export class Sheet {
  name: string
  private columns: { width: number }[] = []
  private cells: Cell[] = []

  constructor(name: string) {
    this.name = name
  }

  width(c: number, w: number): void {
    this.columns[c] = { width: w }
  }

  write(r: number, c: number, v: CellValue, style = STYLE.DEFAULT): void {
    this.cells.push({ r, c, v, s: style })
  }

  /** Elemen <sheetData> untuk satu lembar. */
  private sheetData(): string {
    const maxRow = this.cells.reduce((m, cell) => Math.max(m, cell.r), 0)
    if (this.cells.length === 0) return '<sheetData/>'

    const byCol = (c: number): string => {
      let n = c
      let s = ''
      while (true) {
        s = String.fromCharCode(65 + (n % 26)) + s
        n = Math.floor(n / 26) - 1
        if (n < 0) break
      }
      return s
    }

    let rows = ''
    for (let r = 0; r <= maxRow; r++) {
      const cells = this.cells.filter((cell) => cell.r === r)
      if (cells.length === 0) continue
      cells.sort((a, b) => a.c - b.c)
      let row = `<row r="${r + 1}">`
      for (const cell of cells) {
        const ref = `${byCol(cell.c)}${r + 1}`
        if (typeof cell.v === 'number') {
          row += `<c r="${ref}" s="${cell.s}"><v>${cell.v}</v></c>`
        } else if (cell.v === '') {
          // Sel kosong ber-gaya (menepi) — sama seperti versi Rust.
          row += `<c r="${ref}" s="${cell.s}"/>`
        } else {
          row += `<c r="${ref}" s="${cell.s}" t="inlineStr"><is><t>${escapeXml(cell.v)}</t></is></c>`
        }
      }
      row += '</row>'
      rows += row
    }
    return `<sheetData>${rows}</sheetData>`
  }

  private colsXml(): string {
    if (this.columns.length === 0) return ''
    let cols = ''
    for (let c = 0; c < this.columns.length; c++) {
      const col = this.columns[c]
      if (!col) continue
      cols += `<col min="${c + 1}" max="${c + 1}" width="${col.width}" customWidth="1"/>`
    }
    return `<cols>${cols}</cols>`
  }

  toXml(): string {
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      this.colsXml() +
      this.sheetData() +
      '</worksheet>'
    )
  }
}

export class Workbook {
  private sheets: Sheet[] = []

  add(name: string): Sheet {
    const sheet = new Sheet(name)
    this.sheets.push(sheet)
    return sheet
  }

  build(): Uint8Array {
    const encoder = new TextEncoder()
    const contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      this.sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'

    const rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'

    const sheetsXml = this.sheets
      .map(
        (sheet, i) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join('')
    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${sheetsXml}</sheets>` +
      '</workbook>'

    const sheetRels = this.sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('')
    const workbookRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}` +
      `<Relationship Id="rId${this.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>'

    return zipStore([
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
      { name: '_rels/.rels', data: encoder.encode(rootRels) },
      { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
      { name: 'xl/styles.xml', data: encoder.encode(stylesXml()) },
      ...this.sheets.map((sheet, i) => ({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: encoder.encode(sheet.toXml())
      }))
    ])
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function stylesXml(): string {
  const fonts = [
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>', // 0 default
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>', // 1 tebal
    '<font><b/><sz val="14"/><color rgb="FF0A5835"/><name val="Calibri"/><family val="2"/></font>', // 2 judul
    '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>', // 3 subjudul
    '<font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>', // 4 meta
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>', // 5 header putih
    '<font><b/><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' // 6 recap title
  ].join('')

  const fills = [
    '<fill><patternFill patternType="none"/></fill>', // 0
    '<fill><patternFill patternType="gray125"/></fill>', // 1 wajib ada
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0A5835"/><bgColor indexed="64"/></patternFill></fill>', // 2
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7042"/><bgColor indexed="64"/></patternFill></fill>', // 3
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF0FDF4"/><bgColor indexed="64"/></patternFill></fill>', // 4
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0284C7"/><bgColor indexed="64"/></patternFill></fill>' // 5
  ].join('')

  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>', // 0
    '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom></border>', // 1 tipis
    '<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="double"><color rgb="FF000000"/></bottom></border>' // 2 tipis + ganda
  ].join('')

  // cellXfs — urutannya HARUS sama dengan nilai STYLE di atas.
  const cellXfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    '<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf numFmtId="0" fontId="5" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>',
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>',
    '<xf numFmtId="0" fontId="1" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf numFmtId="164" fontId="1" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>',
    '<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  ].join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
    `<fonts count="7">${fonts}</fonts>` +
    `<fills count="6">${fills}</fills>` +
    `<borders count="3">${borders}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="13">${cellXfs}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  )
}
