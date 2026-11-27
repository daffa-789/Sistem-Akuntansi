// Autentikasi lokal Finova: pengguna database + sesi cookie HttpOnly.
//
// Modul penggajian memisahkan tugas SDM / pencatatan waktu / penggajian /
// pembayaran / akuntansi (slide 30 BAB V.pptx). Pemisahan itu hanya bermakna
// bila peran berasal dari identitas yang login, bukan dari body request.
import crypto from 'node:crypto'
import type { Db } from './db'

export const DEMO_PASSWORD = 'finova2026'
export const SESSION_COOKIE = 'finova_session'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000

/** Daftar akunDemo yang dibuat saat bootstrap. Sandi semua sama (mode lokal). */
export const DEMO_USERS: Array<{ email: string; name: string; role: string }> = [
  { email: 'admin@finova.local', name: 'Administrator', role: 'ADMIN' },
  { email: 'sdm@finova.local', name: 'Bagian SDM', role: 'SDM' },
  { email: 'penggajian@finova.local', name: 'Bagian Penggajian', role: 'PENGGAJIAN' },
  { email: 'akuntansi@finova.local', name: 'Bagian Akuntansi', role: 'AKUNTANSI' },
  { email: 'keuangan@finova.local', name: 'Bagian Keuangan', role: 'KEUANGAN' },
  { email: 'manajer-sdm@finova.local', name: 'Manajer SDM', role: 'SDM_MANAGER' }
]

export interface AuthUser {
  id: number
  name: string
  email: string
  role: string
}

interface Session {
  user: AuthUser
  expiresAt: number
}

/** Sesi disimpan di memori proses: restart server = semua pengguna logout. */
const sessions = new Map<string, Session>()

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const expected = Buffer.from(parts[2], 'hex')
    const actual = crypto.scryptSync(password, parts[1], expected.length)
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function cookieValue(req: Request, name: string): string {
  const raw = req.headers.get('cookie') || ''
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

export function createAuthManager(db: Db, companyId: number) {
  function findUser(req: Request): AuthUser | null {
    const token = cookieValue(req, SESSION_COOKIE)
    if (!token) return null
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token)
      return null
    }
    return session.user
  }

  return {
    userFromRequest: findUser,

    async login(email: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
      const row = db.connection
        .query(
          `SELECT id, company_id, name, email, password_hash, role
           FROM users WHERE email = ? AND company_id = ? AND is_active = 1`
        )
        .get(email.trim().toLowerCase(), companyId) as
        | { id: number; company_id: number; name: string; email: string; password_hash: string; role: string }
        | null
      if (!row || !verifyPassword(password, row.password_hash)) return null

      const user: AuthUser = {
        id: Number(row.id),
        name: row.name,
        email: row.email,
        role: row.role
      }
      const token = crypto.randomBytes(32).toString('hex')
      sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS })
      return { token, user }
    },

    logout(req: Request): void {
      const token = cookieValue(req, SESSION_COOKIE)
      if (token) sessions.delete(token)
    }
  }
}

export type AuthManager = ReturnType<typeof createAuthManager>

export function sessionCookieHeader(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}
