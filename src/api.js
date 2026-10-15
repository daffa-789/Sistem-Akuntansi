// API Client layer for Finova — Rust Native Backend
// Connects to Axum + SQLite backend at /api with in-app engine resilience.
import { accountingEngine } from './backend/accountingEngine.js'

const API = '/api'

export async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  }

  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers,
      body: isFormData || options.body === undefined ? options.body : JSON.stringify(options.body)
    })

    if (response.status === 204) return null
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(payload.message || 'Permintaan tidak dapat diproses oleh server Rust.')
    }
    return payload
  } catch (err) {
    // Jika koneksi ke server Rust gagal (misal dijalankan standalone `vite` tanpa dev.mjs),
    // gunakan fallback engine lokal agar UI tetap responsif.
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('Load failed'))) {
      console.warn('[api] Server Rust belum terhubung di /api, mengalihkan ke engine lokal:', path)
      return fallbackLocalRequest(path, options)
    }
    throw err
  }
}

export async function download(path, filename) {
  try {
    const response = await fetch(`${API}${path}`)
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.message || 'Berkas tidak dapat diunduh dari server Rust.')
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await response.blob())
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  } catch (err) {
    if (err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
      console.warn('[download] Menggunakan unduhan lokal:', path)
      // Jalankan export lokal
      const clean = path.startsWith('/exports/') ? path.slice(9) : path
      if (clean.startsWith('journal.xlsx')) {
        const { exportJournalFile } = await import('./services/downloads.js')
        const range = extractQueryRange(path)
        return exportJournalFile(range, 'xlsx')
      }
      if (clean.startsWith('ledger.xlsx')) {
        const { exportLedgerFile } = await import('./services/downloads.js')
        const range = extractQueryRange(path)
        const params = new URLSearchParams(path.split('?')[1] || '')
        return exportLedgerFile(range, params.get('accountId'), 'BukuBesar')
      }
      if (clean.startsWith('trial-balance.xlsx')) {
        const { exportTrialBalanceFile } = await import('./services/downloads.js')
        const range = extractQueryRange(path)
        return exportTrialBalanceFile(range)
      }
      if (clean.startsWith('accounts.xlsx')) {
        const { exportAccountsFile } = await import('./services/downloads.js')
        return exportAccountsFile()
      }
    }
    throw err
  }
}

function extractQueryRange(path) {
  const search = path.split('?')[1] || ''
  const params = new URLSearchParams(search)
  const today = new Date().toISOString().slice(0, 10)
  return {
    from: params.get('from') || `${today.slice(0, 8)}01`,
    to: params.get('to') || today
  }
}

async function fallbackLocalRequest(path, options) {
  const cleanPath = path.startsWith('/api') ? path.slice(4) : path
  const [pathname, search] = cleanPath.split('?')
  const query = {}
  if (search) {
    const params = new URLSearchParams(search)
    for (const [k, v] of params.entries()) query[k] = v
  }
  const method = (options.method || 'GET').toUpperCase()
  const body = options.body

  if (pathname === '/health') {
    return { ok: true, service: 'finova-api', runtime: 'rust', version: '1.0.0' }
  }
  if (pathname === '/company') {
    if (method === 'GET') return accountingEngine.getCompany()
    if (method === 'PUT') return accountingEngine.updateCompany(body)
  }
  if (pathname === '/accounts') {
    if (method === 'GET') return accountingEngine.getAccounts()
    if (method === 'POST') return accountingEngine.createAccount(body)
  }
  const accMatch = pathname.match(/^\/accounts\/(\d+)$/)
  if (accMatch && method === 'PUT') {
    return accountingEngine.updateAccount(accMatch[1], body)
  }
  if (pathname === '/periods') {
    if (method === 'GET') return accountingEngine.getPeriods()
    if (method === 'POST') return accountingEngine.createPeriod(body)
  }
  const periodCloseMatch = pathname.match(/^\/periods\/(\d+)\/close$/)
  if (periodCloseMatch) return accountingEngine.closePeriod(periodCloseMatch[1])

  if (pathname === '/journals/next-voucher') return accountingEngine.getNextVoucher()
  if (pathname === '/journals') {
    if (method === 'POST') return accountingEngine.createJournal(body)
  }
  const jPostMatch = pathname.match(/^\/journals\/(\d+)\/post$/)
  if (jPostMatch) return accountingEngine.postJournal(jPostMatch[1])
  const jReverseMatch = pathname.match(/^\/journals\/(\d+)\/reverse$/)
  if (jReverseMatch) return accountingEngine.reverseJournal(jReverseMatch[1], body?.reason)
  const jAuditMatch = pathname.match(/^\/journals\/(\d+)\/audit$/)
  if (jAuditMatch) return accountingEngine.getJournalAudit(jAuditMatch[1])
  const jMatch = pathname.match(/^\/journals\/(\d+)$/)
  if (jMatch) {
    if (method === 'GET') return accountingEngine.getJournal(jMatch[1])
    if (method === 'PUT') return accountingEngine.updateJournal(jMatch[1], body)
    if (method === 'DELETE') return accountingEngine.deleteJournal(jMatch[1])
  }
  const repMatch = pathname.match(/^\/reports\/([a-zA-Z0-9_-]+)$/)
  if (repMatch) return accountingEngine.getReports(repMatch[1], query)

  if (pathname === '/templates') {
    if (method === 'GET') return accountingEngine.getTemplates()
    if (method === 'POST') return accountingEngine.createTemplate(body)
  }
  const tplMatch = pathname.match(/^\/templates\/(\d+)$/)
  if (tplMatch && method === 'DELETE') return accountingEngine.deleteTemplate(tplMatch[1])

  if (pathname === '/imports/preview') return accountingEngine.previewImport(body?.rows || body || [])
  const impConfirmMatch = pathname.match(/^\/imports\/(\d+)\/confirm$/)
  if (impConfirmMatch) return accountingEngine.confirmImport(impConfirmMatch[1])

  if (pathname === '/music') return accountingEngine.getMusicTracks()
  if (pathname === '/music/youtube') return accountingEngine.addYouTubeTrack(body?.url, body?.title, body?.artist)
  if (pathname === '/music/local') return accountingEngine.addLocalTrack(body)
  if (pathname === '/music/order') return accountingEngine.updateMusicOrder(body?.trackIds)
  const musDelMatch = pathname.match(/^\/music\/(\d+)$/)
  if (musDelMatch) return accountingEngine.deleteMusicTrack(musDelMatch[1])

  return { ok: true }
}
