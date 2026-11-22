// Galat API — port dari src-rust/httpapi/common.rs.
//
// Bentuk respons dipertahankan persis: { "message": "..." } dengan status yang
// sama seperti Axum (bad_request = 422, bukan 400 — frontend sudah bergantung
// pada perilaku ini).
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }

  static badRequest(message: string): AppError {
    return new AppError(422, message)
  }

  static notFound(message: string): AppError {
    return new AppError(404, message)
  }

  static internal(message: string): AppError {
    return new AppError(500, message)
  }

  static conflict(message: string): AppError {
    return new AppError(409, message)
  }

  toResponse(): Response {
    return Response.json({ message: this.message }, { status: this.status })
  }
}

/**
 * Terjemahkan galat tak terduga menjadi AppError:
 *   - galat SQLite (SQLiteError) → 409 bila bentrok UNIQUE, selain itu 500;
 *   - galat domain/validasi lainnya → 422 beserta pesannya (setara
 *     From<String> for AppError di Rust).
 */
export function mapError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'SQLiteError') {
    if (
      message.includes('UNIQUE constraint failed') ||
      message.includes('SQLITE_CONSTRAINT_UNIQUE')
    ) {
      return AppError.conflict(
        'Data duplikat: kode akun, nomor bukti, atau berkas impor sudah digunakan.'
      )
    }
    return AppError.internal(`Kesalahan database: ${message}`)
  }
  return AppError.badRequest(message)
}
