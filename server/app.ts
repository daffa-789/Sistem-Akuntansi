// Pabrik aplikasi Finova — bootstrap DB + router API + penyaji SPA.
//
// Dipakai oleh server/index.ts (CLI) dan scripts/start.mjs (web produksi).
// Satu definisi rute dipakai untuk pengembangan maupun penyajian web.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, type Config } from './config'
import { Db } from './db'
import {
  Router,
  serveStaticFromDir,
  setStaticHandlerRef,
  type AppState
} from './http/router'
import { createAuthManager } from './auth'
import { accountsRoutes } from './routes/accounts'
import { authRoutes } from './routes/auth'
import { payrollRoutes } from './routes/payroll'
import { revenueRoutes } from './routes/revenue'
import { expenditureRoutes } from './routes/expenditure'

export type ServerHandle = ReturnType<typeof Bun.serve>

export interface FinovaApp {
  config: Config
  db: Db
  router: Router
  server: ServerHandle | null
  /** Port nyata setelah start() (0 = belum start). */
  port: number
  /** Bind ke 127.0.0.1:<config.port> (0 = pilih port bebas). Balik: port nyata. */
  start(): number
  stop(): void
}

export interface AppOverrides {
  port?: number
  databaseFile?: string
  staticDir?: string | null
  version?: string
}

export function createFinovaApp(overrides: AppOverrides = {}): FinovaApp {
  const config = loadConfig()
  if (overrides.port !== undefined) config.port = overrides.port
  if (overrides.databaseFile !== undefined) config.databaseFile = overrides.databaseFile
  if (overrides.staticDir !== undefined) config.staticDir = overrides.staticDir
  if (overrides.version !== undefined) config.version = overrides.version

  const database = Db.open(config.databaseFile)
  database.bootstrap(config.companyId, config.companyName, config.operatorName)

  const state: AppState = { config, db: database, operatorId: 1 }
  const auth = createAuthManager(database, config.companyId)

  const router = new Router()
  router.setAuth(auth)
  for (const [method, pattern, handler] of [
    ['GET', '/api/health', () =>
      Response.json({
        ok: true,
        service: 'finova-api',
        runtime: 'bun',
        version: config.version
      })],
    ...authRoutes(auth),
    ...accountsRoutes(state),
    ...payrollRoutes(state),
    ...revenueRoutes(state),
    ...expenditureRoutes(state)
  ] as Array<[string, string, (ctx: any) => Response | Promise<Response>]>) {
    router.add(method, pattern, handler)
  }

  setStaticHandlerRef((req, pathname) => serveStaticFromDir(state, req, pathname))

  const app: FinovaApp = {
    config,
    db: database,
    router,
    server: null,
    port: 0,

    start(): number {
      if (app.server) return app.port
      app.server = Bun.serve({
        port: config.port,
        hostname: '127.0.0.1',
        fetch: (req) => router.dispatch(req),
        error(err) {
          console.error('[Finova] server error:', err)
          return Response.json(
            { message: 'Terjadi kesalahan internal pada server.' },
            { status: 500 }
          )
        }
      })
      app.port = app.server.port
      return app.port
    },

    stop(): void {
      if (!app.server) return
      try {
        app.server.stop(true)
      } catch {
        /* sudah berhenti */
      }
      app.server = null
      app.port = 0
    }
  }

  return app
}

/**
 * Kandidat folder aset frontend hasil build: cari "dist" relatif terhadap
 * beberapa titik acuan (biner server, sumber, atau folder kerja).
 */
export function resolveBundledStaticDir(): string | null {
  const candidates: string[] = []
  const anchors: string[] = []
  try {
    anchors.push(path.dirname(process.execPath))
  } catch {
    /* ignore */
  }
  try {
    if (typeof import.meta.dir === 'string') anchors.push(import.meta.dir)
  } catch {
    /* ignore */
  }
  try {
    if (process.argv[1]) anchors.push(path.dirname(path.resolve(process.argv[1])))
  } catch {
    /* ignore */
  }
  anchors.push(process.cwd())

  for (const anchor of anchors) {
    for (const relative of ['dist', '../dist', '../../dist', 'internal/web/dist', '../internal/web/dist']) {
      const candidate = path.resolve(anchor, relative)
      if (!candidates.includes(candidate)) candidates.push(candidate)
    }
  }
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate
  }
  return null
}
