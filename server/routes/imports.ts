// Endpoint impor jurnal — port dari src-rust/httpapi/imports.rs.
//
// Membaca .xlsx memakai paket `xlsx` (SheetJS) yang sudah jadi dependensi
// proyek, jadi tidak ada pustaka baru yang perlu dipasang. Shim ESM SheetJS
// hanya menyediakan named export, jadi import namespace dipakai (sama seperti
// src/services/downloads.js di frontend).
import * as XLSX from 'xlsx/xlsx.mjs'
import { AppError } from '../errors'
import { assertBalanced, roundMoney, type AmountedLine } from '../domain'
import { journalTemplate } from '../export/xlsx'
import { intParam, readJson, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>

interface ImportLine {
  account_id: number
  debit: number
  credit: number
}

interface ImportEntry {
  voucherNo: string
  entryDate: string
  description: string
  lines: ImportLine[]
}

interface ImportError {
  line: unknown
  message: string
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function importRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  const db = state.db.connection
  const companyId = state.config.companyId

  // writeEntry versi journals dipakai agar seluruh aturan validasi (periode
  // terbuka, akun aktif, keseimbangan, penomoran baris) identik dengan Rust.
  function writeEntryImpl(params: {
    userId: number
    voucherNo: string
    entryDate: string
    description: string
    source: string
    status: string
    lines: AmountedLine[]
    importBatchId: number | null
    reversalOfId: number | null
  }): number {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.entryDate)) {
      throw AppError.badRequest('Tanggal jurnal tidak valid.')
    }
    const balanced = assertBalanced(params.lines)

    const period = db
      .query(
        `SELECT id, status FROM accounting_periods
         WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
      )
      .get(companyId, params.entryDate) as AnyRow | null

    if (!period) {
      throw AppError.badRequest('Tanggal transaksi belum memiliki periode akuntansi.')
    }
    if (period.status !== 'OPEN') {
      throw AppError.badRequest('Periode transaksi telah ditutup dan dikunci.')
    }

    const accountIds = new Set(balanced.map((line) => line.account_id))
    for (const accId of accountIds) {
      const account = db
        .query('SELECT is_active FROM accounts WHERE id = ? AND company_id = ?')
        .get(accId, companyId) as AnyRow | null
      if (!account || account.is_active !== 1) {
        throw AppError.badRequest('Satu atau beberapa akun tidak aktif atau tidak ditemukan.')
      }
    }

    const source = params.source === '' ? 'MANUAL' : params.source
    const status = params.status === '' ? 'DRAFT' : params.status

    const info = db.run(
      `INSERT INTO journal_entries (company_id, period_id, voucher_no, entry_date, description, source, status, import_batch_id, reversal_of_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        period.id,
        params.voucherNo,
        params.entryDate,
        params.description,
        source,
        status,
        params.importBatchId,
        params.reversalOfId,
        params.userId
      ]
    )
    const entryId = Number(info.lastInsertRowid)

    balanced.forEach((line, index) => {
      db.run(
        'INSERT INTO journal_lines (journal_entry_id, account_id, line_no, memo, debit, credit) VALUES (?, ?, ?, ?, ?, ?)',
        [entryId, line.account_id, index + 1, line.memo, line.debit, line.credit]
      )
    })

    db.run(
      `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
       VALUES (?, ?, 'JOURNAL_ENTRY', ?, ?, ?)`,
      [
        companyId,
        state.operatorId,
        entryId,
        status === 'POSTED' ? 'POSTED' : 'CREATED',
        JSON.stringify({ source, voucherNo: params.voucherNo })
      ]
    )

    return entryId
  }

  return [
    ['GET', '/api/imports/template', async () => {
      const bytes = journalTemplate()
      return new Response(bytes, {
        headers: {
          'Content-Type': XLSX_MIME,
          'Content-Disposition': 'attachment; filename="template-jurnal-finova.xlsx"'
        }
      })
    }],

    ['POST', '/api/imports/preview', async (ctx) => {
      const form = await ctx.req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        throw AppError.badRequest('Berkas Excel wajib diunggah.')
      }
      const fileData = new Uint8Array(await file.arrayBuffer())
      const fileName = file.name || 'jurnal.xlsx'

      const hasher = new Bun.CryptoHasher('sha256')
      hasher.update(fileData)
      const hashHex = hasher.digest('hex')

      const parsed = parseImportData(db, companyId, fileData)

      const status = parsed.errors.length === 0 ? 'PREVIEW' : 'REJECTED'
      const payloadJson = JSON.stringify(parsed.entries)
      const errorsJson = JSON.stringify(parsed.errors)

      const info = db.run(
        `INSERT INTO import_batches (company_id, uploaded_by, original_filename, content_hash, status, total_rows, valid_entries, payload_json, errors_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          state.operatorId,
          fileName,
          hashHex,
          status,
          parsed.totalRows,
          parsed.entries.length,
          payloadJson,
          errorsJson
        ]
      )
      const batchId = Number(info.lastInsertRowid)

      state.db.audit(
        companyId,
        state.operatorId,
        'IMPORT_BATCH',
        batchId,
        status === 'PREVIEW' ? 'PREVIEWED' : 'REJECTED',
        { totalRows: parsed.totalRows, errors: parsed.errors.length }
      )

      const summaries = parsed.entries.map((entry) => ({
        voucherNo: entry.voucherNo,
        entryDate: entry.entryDate,
        description: entry.description,
        lineCount: entry.lines.length
      }))

      return Response.json({
        batchId,
        valid: parsed.errors.length === 0,
        totalRows: parsed.totalRows,
        entries: summaries,
        errors: parsed.errors
      })
    }],

    ['POST', '/api/imports/:id/confirm', async (ctx) => {
      const id = intParam(ctx, 'id')
      return state.db.withTransaction(() => {
        const batch = db
          .query('SELECT status, payload_json FROM import_batches WHERE id = ? AND company_id = ?')
          .get(id, companyId) as AnyRow | null
        if (!batch) throw AppError.notFound('Batch impor tidak ditemukan.')
        if (batch.status !== 'PREVIEW') {
          throw AppError.badRequest('Batch ini tidak siap dikonfirmasi.')
        }

        let entries: ImportEntry[]
        try {
          entries = JSON.parse(batch.payload_json) as ImportEntry[]
        } catch {
          throw AppError.badRequest('Isi batch impor tidak dapat dibaca.')
        }

        for (const entry of entries) {
          const lines: AmountedLine[] = entry.lines.map((line) => ({
            account_id: line.account_id,
            line_no: 0,
            debit: line.debit,
            credit: line.credit,
            memo: null,
            code: null,
            account_name: null,
            source: '',
            entry_date: '',
            voucher_no: '',
            description: ''
          }))

          // Sama seperti versi Rust: write_entry memvalidasi ulang (periode,
          // keseimbangan, akun aktif) di dalam transaksi yang sama.
          writeEntryImpl({
            userId: state.operatorId,
            voucherNo: entry.voucherNo,
            entryDate: entry.entryDate,
            description: entry.description,
            source: 'IMPORT',
            status: 'POSTED',
            lines,
            importBatchId: id,
            reversalOfId: null
          })
        }

        db.run(
          `UPDATE import_batches SET status = 'POSTED', posted_at = datetime('now', 'localtime') WHERE id = ?`,
          [id]
        )
        db.run(
          `INSERT INTO audit_logs (company_id, user_id, entity_type, entity_id, action, details_json)
           VALUES (?, ?, 'IMPORT_BATCH', ?, 'POSTED', ?)`,
          [companyId, state.operatorId, id, JSON.stringify({ entries: entries.length })]
        )

        return Response.json({ ok: true, posted: entries.length })
      })
    }]
  ]
}

interface ParsedImport {
  totalRows: number
  entries: ImportEntry[]
  errors: ImportError[]
}

function parseImportData(db: any, companyId: number, data: Uint8Array): ParsedImport {
  const workbook = XLSX.read(data, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw AppError.badRequest('Lembar kerja kosong.')

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false
  })
  if (rows.length === 0) {
    throw AppError.badRequest('Format spreadsheet tidak memiliki judul kolom.')
  }

  const headerRow = rows[0]
  const colMap = new Map<string, number>()
  headerRow.forEach((cell, index) => {
    const name = String(cell ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s/g, '')
    colMap.set(name, index)
  })

  const getCol = (name: string): number | undefined =>
    colMap.get(name.toLowerCase().replace(/\s/g, ''))

  const colVoucher = getCol('nobukti')
  const colDate = getCol('tanggal')
  const colCode = getCol('kodeakun')
  const colDebit = getCol('debit')
  const colCredit = getCol('kredit')
  const colDesc = getCol('keterangan')

  if (colVoucher === undefined) throw AppError.badRequest('Kolom NoBukti tidak ditemukan.')
  if (colDate === undefined) throw AppError.badRequest('Kolom Tanggal tidak ditemukan.')
  if (colCode === undefined) throw AppError.badRequest('Kolom KodeAkun tidak ditemukan.')
  if (colDebit === undefined) throw AppError.badRequest('Kolom Debit tidak ditemukan.')
  if (colCredit === undefined) throw AppError.badRequest('Kolom Kredit tidak ditemukan.')

  const accountByCode = new Map<string, { id: number; isActive: boolean }>()
  const accountRows = db
    .query('SELECT id, code, is_active FROM accounts WHERE company_id = ?')
    .all(companyId) as AnyRow[]
  for (const row of accountRows) {
    accountByCode.set(row.code, { id: row.id, isActive: row.is_active !== 0 })
  }

  interface Grouped {
    voucher: string
    entryDate: string
    description: string
    lines: ImportLine[]
    rowNumbers: number[]
  }

  const grouped = new Map<string, Grouped>()
  const order: string[] = []
  const errors: ImportError[] = []
  let totalRows = 0

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? []
    const lineNum = rowIndex + 1
    totalRows += 1

    const voucher = cleanCellStr(row[colVoucher])
    const rawDate = cleanCellStr(row[colDate])
    const entryDate = parseExcelDate(rawDate)
    const code = cleanCellStr(row[colCode])
    const debit = cleanCellNum(row[colDebit]) ?? 0
    const credit = cleanCellNum(row[colCredit]) ?? 0
    const desc = colDesc !== undefined ? cleanCellStr(row[colDesc]) : ''

    if (voucher === '') {
      errors.push({ line: lineNum, message: 'NoBukti wajib diisi.' })
    }
    if (entryDate === '') {
      errors.push({
        line: lineNum,
        message: 'Tanggal harus memakai format YYYY-MM-DD atau DD/MM/YYYY.'
      })
    }

    const account = accountByCode.get(code)
    if (!account || !account.isActive) {
      errors.push({
        line: lineNum,
        message: `Kode akun ${code === '' ? '(kosong)' : code} tidak aktif atau tidak ditemukan.`
      })
    }

    const debitVal = roundMoney(debit)
    const creditVal = roundMoney(credit)

    if (
      (debitVal > 0 && creditVal > 0) ||
      (debitVal === 0 && creditVal === 0) ||
      debitVal < 0 ||
      creditVal < 0
    ) {
      errors.push({
        line: lineNum,
        message: 'Isi tepat salah satu nominal Debit atau Kredit.'
      })
    }

    if (voucher === '' || entryDate === '' || !account) continue

    const line: ImportLine = { account_id: account.id, debit: debitVal, credit: creditVal }

    const existing = grouped.get(voucher)
    if (existing) {
      if (existing.entryDate !== entryDate) {
        errors.push({
          line: lineNum,
          message: `NoBukti ${voucher} memiliki tanggal yang berbeda.`
        })
      }
      existing.lines.push(line)
      existing.rowNumbers.push(lineNum)
    } else {
      order.push(voucher)
      grouped.set(voucher, {
        voucher,
        entryDate,
        description: desc === '' ? `Impor ${voucher}` : desc,
        lines: [line],
        rowNumbers: [lineNum]
      })
    }
  }

  const entries: ImportEntry[] = []
  for (const voucher of order) {
    const group = grouped.get(voucher)!
    const amounted: AmountedLine[] = group.lines.map((line) => ({
      account_id: line.account_id,
      line_no: 0,
      debit: line.debit,
      credit: line.credit,
      memo: null,
      code: null,
      account_name: null,
      source: '',
      entry_date: '',
      voucher_no: '',
      description: ''
    }))

    try {
      assertBalanced(amounted)
    } catch (err) {
      errors.push({
        line: group.rowNumbers.join(', '),
        message: `${voucher}: ${err instanceof Error ? err.message : String(err)}`
      })
    }

    const period = db
      .query(
        `SELECT status FROM accounting_periods
         WHERE company_id = ? AND ? BETWEEN start_date AND end_date LIMIT 1`
      )
      .get(companyId, group.entryDate) as AnyRow | null

    if (!period || period.status !== 'OPEN') {
      errors.push({
        line: group.rowNumbers.join(', '),
        message: `${voucher}: Periode transaksi telah ditutup atau belum tersedia.`
      })
    }

    entries.push({
      voucherNo: group.voucher,
      entryDate: group.entryDate,
      description: group.description,
      lines: group.lines
    })
  }

  for (const voucher of order) {
    const exists = db
      .query(
        'SELECT EXISTS(SELECT 1 FROM journal_entries WHERE company_id = ? AND voucher_no = ?) AS e'
      )
      .get(companyId, voucher) as { e: number }
    if (exists.e) {
      errors.push({ line: '', message: `NoBukti ${voucher} sudah pernah digunakan.` })
    }
  }

  return { totalRows, entries, errors }
}

function cleanCellStr(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value)
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

function cleanCellNum(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim().replace(/,/g, ''))
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function parseExcelDate(text: string): string {
  const t = text.trim()
  if (t === '') return ''

  // Serial number Excel: 1 = 1900-01-01 (dengan quirk tahun kabisat 1900,
  // basis yang dipakai versi Rust adalah 1899-12-30).
  const serial = Number(t)
  if (!Number.isNaN(serial) && /^\d+(\.\d+)?$/.test(t)) {
    const days = Math.trunc(serial)
    const base = Date.UTC(1899, 11, 30)
    const date = new Date(base + days * 86400000)
    return date.toISOString().slice(0, 10)
  }

  const reIso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t)
  if (reIso) {
    return makeDate(Number(reIso[1]), Number(reIso[2]), Number(reIso[3]))
  }

  const reId = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t)
  if (reId) {
    // Format Indonesia: hari/bulan/tahun.
    return makeDate(Number(reId[3]), Number(reId[2]), Number(reId[1]))
  }

  return ''
}

function makeDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return ''
  }
  const y = String(date.getUTCFullYear()).padStart(4, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
