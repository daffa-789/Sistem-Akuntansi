// Router HTTP minimal + CORS + penyaji aset statis — pengganti Axum.
//
// Pola: [METHOD /api/journals/:id] dengan parameter path. Tidak ada dependensi;
// Bun.serve memanggil fetchHandler untuk setiap permintaan.
import { AppError, mapError } from '../errors'
import fs from 'node:fs'
import path from 'node:path'
import type { Config } from '../config'
import { Db } from '../db'
import { dataDirOf } from '../config'

export interface AppState {
  config: Config
  db: Db
  operatorId: number
}

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  query: URLSearchParams
}

export type Handler = (ctx: Ctx) => Response | Promise<Response>

interface Route {
  method: string
  regex: RegExp
  keys: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  add(method: string, pattern: string, handler: Handler): void {
    const keys: string[] = []
    const regex = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((segment) => {
            if (segment.startsWith(':')) {
              keys.push(segment.slice(1))
              return '([^/]+)'
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          })
          .join('/') +
        '$'
    )
    this.routes.push({ method, regex, keys, handler })
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler)
  }

  post(pattern: string, handler: Handler): void {
    this.add('POST', pattern, handler)
  }

  put(pattern: string, handler: Handler): void {
    this.add('PUT', pattern, handler)
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler)
  }

  async dispatch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const pathname = decodeURIComponent(url.pathname)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    for (const route of this.routes) {
      if (route.method !== req.method) continue
      const match = route.regex.exec(pathname)
      if (!match) continue
      const params: Record<string, string> = {}
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(match[i + 1])
      })
      const ctx: Ctx = { req, url, params, query: url.searchParams }
      try {
        const response = await route.handler(ctx)
        return withCors(response)
      } catch (err) {
        return withCors(mapError(err).toResponse())
      }
    }

    // Tidak ada rute /api yang cocok → 404 JSON seperti versi Rust.
    if (pathname.startsWith('/api')) {
      return withCors(
        Response.json({ message: 'Endpoint tidak ditemukan.' }, { status: 404 })
      )
    }

    return withCors(await serveStatic(req, pathname))
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

// ===== Aset statis =====

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

let staticDirCache: { base: string; resolved: string | null } | null = null

/**
 * Folder aset frontend, diperiksa berurutan:
 *   1. STATIC_DIR (env/flag -static) bila diisi;
 *   2. internal/web/dist relatif terhadap folder kerja (mode repo);
 *   3. internal/web/dist relatif terhadap lokasi biner (mode terpasang);
 *   4. dist/ atau web/ relatif terhadap lokasi biner (tata letak installer).
 * Kandidat pertama yang ada yang menang.
 */
function resolveStaticDir(state: AppState): { base: string; resolved: string | null } {
  if (!staticDirCache) {
    const explicit = state.config.staticDir
    const candidates: string[] = []
    if (explicit) {
      candidates.push(path.resolve(explicit))
    }
    candidates.push(path.resolve('internal', 'web', 'dist'))
    // Bun build --compile: process.execPath menunjuk ke biner finova.exe.
    const exeDir = path.dirname(process.execPath)
    candidates.push(path.join(exeDir, 'internal', 'web', 'dist'))
    candidates.push(path.join(exeDir, 'dist'))
    candidates.push(path.join(exeDir, 'web'))

    let resolved: string | null = null
    let base = candidates[0]
    for (const candidate of candidates) {
      base = candidate
      if (fs.existsSync(path.join(candidate, 'index.html'))) {
        resolved = candidate
        break
      }
    }
    staticDirCache = { base, resolved }
  }
  return staticDirCache
}

async function serveStatic(req: Request, pathname: string): Promise<Response> {
  // Diperlukan hanya saat router dipakai bersama state; karena router tidak
  // menyimpan state, fungsi ini menerima state lewat closure di index.ts.
  return staticHandlerRef(req, pathname)
}

// Disediakan oleh index.ts supaya penyaji statis tahu lokasi folder aset.
let staticHandlerRef: (
  req: Request,
  pathname: string
) => Promise<Response> = async () => placeholder()

export function setStaticHandlerRef(fn: (req: Request, pathname: string) => Promise<Response>) {
  staticHandlerRef = fn
}

function placeholder(): Response {
  return new Response(
    '<!DOCTYPE html><html><body><h1>Finova API Server (Bun)</h1><p>Frontend belum tertanam. Jalankan <code>bun run build:client</code>.</p></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function serveStaticFromDir(
  state: AppState,
  req: Request,
  pathname: string
): Promise<Response> {
  const { base, resolved } = resolveStaticDir(state)
  const relative = pathname.replace(/^\/+/, '')

  if (resolved && relative) {
    // Cegah path traversal: hasil join harus tetap berada di dalam folder aset.
    const target = path.resolve(resolved, relative)
    if (target.startsWith(resolved + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) {
      const ext = path.extname(target).toLowerCase()
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
      const cacheControl = relative.startsWith('assets/')
        ? 'public, max-age=31536000, immutable'
        : undefined
      const headers: Record<string, string> = { 'Content-Type': contentType }
      if (cacheControl) headers['Cache-Control'] = cacheControl
      return new Response(Bun.file(target), { headers })
    }
  }

  // SPA fallback: selalu kirim index.html.
  const indexPath = resolved ? path.join(resolved, 'index.html') : path.join(base, 'index.html')
  if (fs.existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  }

  return placeholder()
}

// ===== Pembantu request =====

/** Baca body JSON; body kosong diperlakukan sebagai {} (Axum menerima POST tanpa body). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return {}
    return parsed as Record<string, unknown>
  } catch {
    throw AppError.badRequest('Badan permintaan bukan JSON yang valid.')
  }
}

/** Parameter path wajib bilangan bulat. */
export function intParam(ctx: Ctx, name: string): number {
  const raw = ctx.params[name]
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw AppError.notFound('Sumber daya tidak ditemukan.')
  }
  return value
}

/** Ambil field string dari body JSON (dengan trim). */
export function strField(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

/** Ambil field boolean yang mungkin datang sebagai bool atau angka. */
export function boolField(
  body: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = body[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.trim() !== '' && value !== 'false' && value !== '0'
  return fallback
}

export function dataDirFor(state: AppState): string {
  return dataDirOf(state.config.databaseFile)
}
