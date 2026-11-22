// Penulis PDF minimal (A4, font bawaan Helvetica) — pengganti printpdf.
//
// Hanya memplikasi yang dibutuhkan Jurnal Umum: segi empat berwarna, teks,
// dan paginasi. Sistem koordinat memakai asal kiri-bawah seperti printpdf,
// dengan satuan milimeter (dikonversi ke point: 1mm = 72/25.4pt).
const MM_TO_PT = 72 / 25.4

export type BuiltinFont = 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique'

const FONT_IDS: Record<BuiltinFont, number> = {
  Helvetica: 3,
  'Helvetica-Bold': 4,
  'Helvetica-Oblique': 5
}

function n(value: number): string {
  const fixed = value.toFixed(2)
  return fixed.replace(/\.?0+$/, '').replace(/^-$/, '0')
}

function pdfPoint(valueMm: number): string {
  return n(valueMm * MM_TO_PT)
}

function colorValue(v: number): string {
  return n(Math.max(0, Math.min(1, v)))
}

/** Escape teks literal PDF + petakan ke WinAnsi (karis diatas 255 jadi ?). */
function escapePdfText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63
    if (ch === '(' || ch === ')' || ch === '\\') {
      out += '\\' + ch
    } else if (ch === '\n' || ch === '\r') {
      out += ' '
    } else if (code <= 255) {
      out += ch
    } else {
      out += '?'
    }
  }
  return out
}

export class PdfBuilder {
  private pages: string[] = []
  private ops: string[] = []

  private get current(): string[] {
    return this.ops
  }

  newPage(): void {
    this.pages.push(this.ops.join('\n'))
    this.ops = []
  }

  rect(xMm: number, yMm: number, wMm: number, hMm: number, r: number, g: number, b: number): void {
    this.ops.push(
      `${colorValue(r)} ${colorValue(g)} ${colorValue(b)} rg ${pdfPoint(xMm)} ${pdfPoint(yMm)} ${pdfPoint(wMm)} ${pdfPoint(hMm)} re f`
    )
  }

  text(
    text: string,
    sizePt: number,
    xMm: number,
    yMm: number,
    font: BuiltinFont,
    r: number,
    g: number,
    b: number
  ): void {
    this.ops.push(
      `BT /F${FONT_IDS[font] - 2} ${sizePt} Tf ${colorValue(r)} ${colorValue(g)} ${colorValue(b)} rg 1 0 0 1 ${pdfPoint(xMm)} ${pdfPoint(yMm)} Tm (${escapePdfText(text)}) Tj ET`
    )
  }

  /** Bangun berkas PDF lengkap dari semua halaman yang sudah diisi. */
  finish(title: string): Uint8Array {
    this.pages.push(this.ops.join('\n'))
    const pageCount = this.pages.length

    // Objek: 1=katalog, 2=pages, 3..5=font, lalu pasangan (page, contents).
    const objects: string[] = []
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    const pageObjIds = []
    for (let i = 0; i < pageCount; i++) pageObjIds.push(6 + i * 2)
    objects[2] =
      `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`
    objects[3] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    objects[4] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    objects[5] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>'

    for (let i = 0; i < pageCount; i++) {
      const pageId = 6 + i * 2
      const contentId = pageId + 1
      objects[pageId] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfPoint(210)} ${pdfPoint(297)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`
      const stream = this.pages[i] ?? ''
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    }

    let pdf = '%PDF-1.7\n%\u00e7\u00f1\u00f8\n'
    const offsets: number[] = []
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = pdf.length
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
    }
    const xrefOffset = pdf.length
    const count = objects.length // termasuk objek bebas 0
    pdf += `xref\n0 ${count}\n0000000000 65535 f \n`
    for (let id = 1; id < objects.length; id++) {
      pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
    }
    pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

    const bytes = new Uint8Array(pdf.length)
    for (let i = 0; i < pdf.length; i++) {
      const code = pdf.charCodeAt(i)
      bytes[i] = code & 0xff
    }
    return bytes
  }
}
