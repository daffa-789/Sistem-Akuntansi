// Ekspor PDF Jurnal Umum — port dari src-rust/export/pdf.rs (printpdf →
// lib/pdf.ts buatan sendiri). Ukuran halaman A4, kolom, warna, dan paginasi
// mengikuti versi Rust baris per baris.
import { formatIdr } from '../lib/format'
import { PdfBuilder } from '../lib/pdf'
import { recapIsEmpty, signersWithDefaults, type JournalData } from './index'

export const PDF_MIME = 'application/pdf'

const COLOR_DARK_TEXT = [0.12, 0.16, 0.23] as const
const COLOR_TITLE = [0.04, 0.35, 0.21] as const
const COLOR_META = [0.39, 0.45, 0.55] as const
const COLOR_GREEN_TOTAL = [0.05, 0.44, 0.27] as const
const COLOR_BLUE = [0.01, 0.52, 0.78] as const

export function journalPdf(data: JournalData): Uint8Array {
  const signers = signersWithDefaults(data.signers)
  const pdf = new PdfBuilder()

  // Margin kiri 14mm, atas 14mm. y adalah koordinat PDF (dari bawah), dimulai
  // dari 297 - 14 = 14mm di bawah tepi atas, lalu turun seiring isi.
  let y = 297 - 14

  const companyName = data.company === '' ? 'PT Finova Akuntansi Indonesia' : data.company

  pdf.text(companyName, 14, 14, y - 5, 'Helvetica-Bold', ...COLOR_TITLE)
  y -= 8
  pdf.text('JURNAL UMUM (GENERAL JOURNAL)', 11, 14, y - 4, 'Helvetica-Bold', ...COLOR_DARK_TEXT)
  y -= 7
  pdf.text(
    `Periode: ${data.from} s.d. ${data.to} | Dicetak: ${data.printed_on}`,
    9,
    14,
    y - 3.5,
    'Helvetica-Oblique',
    ...COLOR_META
  )
  y -= 9

  const colX = [14, 14 + 20, 14 + 20 + 24, 14 + 20 + 24 + 68, 14 + 20 + 24 + 68 + 14, 14 + 20 + 24 + 68 + 14 + 28]

  // Kepala tabel
  pdf.rect(14, y - 8, 182, 8, ...COLOR_GREEN_TOTAL)
  const titles = ['Tanggal', 'No. Bukti', 'Keterangan Akun & Transaksi', 'Ref', 'Debit (Rp)', 'Kredit (Rp)']
  for (let i = 0; i < titles.length; i++) {
    pdf.text(titles[i], 9, colX[i] + 2, y - 5.5, 'Helvetica-Bold', 1, 1, 1)
  }
  y -= 8

  // Baris jurnal
  for (const entry of data.entries) {
    if (y < 35) {
      pdf.newPage()
      y = 297 - 16
    }

    const rowH = 7
    if (entry.alternate) {
      pdf.rect(14, y - rowH, 182, rowH, 0.97, 0.98, 0.99)
    }

    if (entry.show_head) {
      pdf.text(entry.date, 8, colX[0] + 1, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)
      pdf.text(entry.voucher, 8, colX[1] + 1, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)
    }

    let acc = entry.account
    if (entry.is_credit) {
      acc = `  » ${acc.replace(/^     » /, '').replace(/^     ↳ /, '')}`
    }
    const maxLen = 38
    const displayAcc =
      acc.length > maxLen ? `${acc.slice(0, maxLen)}...` : acc

    const font = entry.is_credit ? 'Helvetica' : 'Helvetica-Bold'
    pdf.text(displayAcc, 8, colX[2] + 1, y - 5, font, ...COLOR_DARK_TEXT)
    pdf.text(entry.ref_code, 8, colX[3] + 2, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)

    if (entry.debit > 0) {
      pdf.text(formatIdr(entry.debit), 8, colX[4] + 2, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)
    } else {
      pdf.text('-', 8, colX[4] + 10, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)
    }

    if (entry.credit > 0) {
      pdf.text(formatIdr(entry.credit), 8, colX[5] + 2, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)
    } else {
      pdf.text('-', 8, colX[5] + 10, y - 5, 'Helvetica', ...COLOR_DARK_TEXT)
    }

    y -= rowH
  }

  // Baris TOTAL
  const totH = 8
  pdf.rect(14, y - totH, 182, totH, 0.94, 0.99, 0.96)
  pdf.text('TOTAL', 9, colX[2] + 1, y - 5.5, 'Helvetica-Bold', ...COLOR_GREEN_TOTAL)
  pdf.text(formatIdr(data.total_debit), 8.5, colX[4] + 1, y - 5.5, 'Helvetica-Bold', ...COLOR_GREEN_TOTAL)
  pdf.text(formatIdr(data.total_credit), 8.5, colX[5] + 1, y - 5.5, 'Helvetica-Bold', ...COLOR_GREEN_TOTAL)
  y -= totH + 10

  // Rekapitulasi
  if (!recapIsEmpty(data.recap)) {
    if (y < 70) {
      pdf.newPage()
      y = 297 - 16
    }

    pdf.text('REKAPITULASI JURNAL UMUM', 10, 14, y - 5, 'Helvetica-Bold', ...COLOR_DARK_TEXT)
    y -= 8

    const recX = [14, 14 + 55, 14 + 55 + 36, 14 + 55 + 36 + 55]

    pdf.rect(14, y - 7, 182, 7, ...COLOR_BLUE)
    const recTitles = ['Akun Debit', 'Jumlah (Rp)', 'Akun Kredit', 'Jumlah (Rp)']
    for (let i = 0; i < recTitles.length; i++) {
      pdf.text(recTitles[i], 8.5, recX[i] + 2, y - 5, 'Helvetica-Bold', 1, 1, 1)
    }
    y -= 7

    const maxLen = Math.max(data.recap.debits.length, data.recap.credits.length)
    for (let i = 0; i < maxLen; i++) {
      if (y < 35) {
        pdf.newPage()
        y = 297 - 16
      }
      const d = data.recap.debits[i]
      const c = data.recap.credits[i]
      if (d) {
        pdf.text(`${d.code} - ${d.name}`, 8, recX[0] + 1, y - 4.5, 'Helvetica', ...COLOR_DARK_TEXT)
        pdf.text(formatIdr(d.amount), 8, recX[1] + 1, y - 4.5, 'Helvetica', ...COLOR_DARK_TEXT)
      }
      if (c) {
        pdf.text(`${c.code} - ${c.name}`, 8, recX[2] + 1, y - 4.5, 'Helvetica', ...COLOR_DARK_TEXT)
        pdf.text(formatIdr(c.amount), 8, recX[3] + 1, y - 4.5, 'Helvetica', ...COLOR_DARK_TEXT)
      }
      y -= 6
    }

    pdf.rect(14, y - 7, 182, 7, 0.95, 0.97, 0.99)
    pdf.text('TOTAL DEBIT', 8.5, recX[0] + 1, y - 5, 'Helvetica-Bold', ...COLOR_BLUE)
    pdf.text(formatIdr(data.recap.total_debit), 8.5, recX[1] + 1, y - 5, 'Helvetica-Bold', ...COLOR_BLUE)
    pdf.text('TOTAL KREDIT', 8.5, recX[2] + 1, y - 5, 'Helvetica-Bold', ...COLOR_BLUE)
    pdf.text(formatIdr(data.recap.total_credit), 8.5, recX[3] + 1, y - 5, 'Helvetica-Bold', ...COLOR_BLUE)
    y -= 15
  }

  // Lembar pengesahan
  if (y < 45) {
    pdf.newPage()
    y = 297 - 25
  }

  pdf.text('Dibuat Oleh,', 9, 25, y, 'Helvetica', ...COLOR_DARK_TEXT)
  pdf.text('Diperiksa Oleh,', 9, 90, y, 'Helvetica', ...COLOR_DARK_TEXT)
  pdf.text('Disetujui Oleh,', 9, 155, y, 'Helvetica', ...COLOR_DARK_TEXT)
  pdf.text(`( ${signers.maker} )`, 9, 25, y - 18, 'Helvetica-Bold', ...COLOR_DARK_TEXT)
  pdf.text(`( ${signers.checker} )`, 9, 90, y - 18, 'Helvetica-Bold', ...COLOR_DARK_TEXT)
  pdf.text(`( ${signers.approver} )`, 9, 155, y - 18, 'Helvetica-Bold', ...COLOR_DARK_TEXT)

  return pdf.finish(`Jurnal Umum - ${data.company}`)
}
