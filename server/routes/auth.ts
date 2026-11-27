// Endpoint login/logout/profil pengguna. Peran yang dipakai modul penggajian
// berasal dari sesi ini, bukan dari field operator_role di body request.
import { AppError } from '../errors'
import {
  clearSessionCookieHeader,
  sessionCookieHeader,
  type AuthManager
} from '../auth'
import { readJson, strField, type Ctx, type Handler } from '../http/router'

export function authRoutes(auth: AuthManager): Array<[string, string, Handler]> {
  return [
    ['POST', '/api/auth/login', async (ctx: Ctx) => {
      const body = await readJson(ctx.req)
      const email = strField(body, 'email')
      const password = strField(body, 'password')
      if (!email || !password) {
        throw new AppError(422, 'Email dan kata sandi wajib diisi.')
      }
      const session = await auth.login(email, password)
      if (!session) {
        throw new AppError(401, 'Email atau kata sandi salah.')
      }
      const response = Response.json({ user: session.user })
      response.headers.append('Set-Cookie', sessionCookieHeader(session.token))
      return response
    }],

    ['POST', '/api/auth/logout', (ctx: Ctx) => {
      auth.logout(ctx.req)
      const response = Response.json({ ok: true })
      response.headers.append('Set-Cookie', clearSessionCookieHeader())
      return response
    }],

    ['GET', '/api/auth/me', (ctx: Ctx) => Response.json({ user: ctx.user })]
  ]
}
