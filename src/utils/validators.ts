export interface JournalLineInput {
  account_id?: number | string
  debit?: number | string
  credit?: number | string
  line_desc?: string
  memo?: string
}

export interface JournalFormInput {
  entryDate?: string
  description?: string
  voucherNo?: string
  lines: JournalLineInput[]
}

export interface LineError {
  account?: string
  amount?: string
  both?: string
}

export interface ValidationResult {
  valid: boolean
  errors: Record<string, string>
  lineErrors: (LineError | null)[]
}

export function validateJournal(form: JournalFormInput): ValidationResult {
  const errors: Record<string, string> = {}
  if (!form.entryDate) errors.entryDate = 'Tanggal transaksi wajib diisi.'
  if (!form.description || !form.description.trim()) {
    errors.description = 'Keterangan transaksi wajib diisi agar mudah dilacak.'
  }

  const filled = form.lines.filter(
    (l) => l.account_id && (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)
  )

  if (filled.length < 2) {
    errors.lines = 'Minimal 2 baris dengan akun dan nominal terisi untuk membentuk jurnal berpasangan.'
  }

  const lineErrors: (LineError | null)[] = form.lines.map((l) => {
    const e: LineError = {}
    if (!l.account_id && (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0)) {
      e.account = 'Pilih akun terlebih dahulu.'
    }
    if (l.account_id && Number(l.debit || 0) === 0 && Number(l.credit || 0) === 0) {
      e.amount = 'Isi nominal debit atau kredit.'
    }
    if (Number(l.debit || 0) > 0 && Number(l.credit || 0) > 0) {
      e.both = 'Hanya isi salah satu, debit atau kredit.'
    }
    return Object.keys(e).length ? e : null
  })

  return {
    valid: !Object.keys(errors).length && lineErrors.every((e) => !e),
    errors,
    lineErrors
  }
}
