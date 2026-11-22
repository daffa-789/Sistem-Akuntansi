// Kunci satu-instansi untuk server web Finova.
//
// dipakai supaya menjalankan `bun start` dua kali tidak menyalakan dua server:
// proses kedua hanya diberitahu alamat server yang sudah hidup. Kuncinya
// opsional — kalau berkas tidak bisa ditulis, server tetap berjalan normal.
import fs from 'node:fs'
import path from 'node:path'

export interface InstanceLock {
  pid: number
  port: number
}

export function lockPath(dataDir: string): string {
  return path.join(dataDir, 'finova.lock')
}

export function readLock(dataDir: string): InstanceLock | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath(dataDir), 'utf8')) as InstanceLock
    if (typeof parsed.port === 'number' && parsed.port > 0) return parsed
  } catch {
    /* berkas rusak/kosong dianggap tidak ada */
  }
  return null
}

export function writeLock(dataDir: string, port: number): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(lockPath(dataDir), JSON.stringify({ pid: process.pid, port }))
  } catch {
    /* kunci bersifat opsional; kegagalan menulis tidak fatal */
  }
}

export function removeLock(dataDir: string): void {
  try {
    fs.rmSync(lockPath(dataDir), { force: true })
  } catch {
    /* abaikan */
  }
}

/** Cek apakah server Finova masih hidup di port tersebut. */
export async function serverAlive(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500)
    })
    if (!response.ok) return false
    const body = (await response.json()) as { service?: string }
    return body.service === 'finova-api'
  } catch {
    return false
  }
}
