// Penyimpanan berkas audio MILIK PENGGUNA di IndexedDB peramban.
// Sengaja tidak masuk basis data pembukuan: ukurannya besar dan hanya berguna di
// peramban tempat file-nya dipilih. Yang disimpan: metadata + blob audionya.

const DB_NAME = 'finova-music'
const DB_VERSION = 1
const META_STORE = 'meta'
const AUDIO_STORE = 'audio'

export interface LocalTrackMeta {
  id: string
  title: string
  artist: string
  duration?: number
  fileName: string
  addedAt: string
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Peramban ini tidak mendukung penyimpanan lokal.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(AUDIO_STORE)) {
        database.createObjectStore(AUDIO_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Gagal membuka penyimpanan musik.'))
  })
  return databasePromise
}

function requestToPromise<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error || new Error('Gagal membaca penyimpanan musik.'))
  })
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// readDuration memakai elemen audio sementara untuk mengetahui panjang lagu.
function readDuration(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(blob)
    const done = (value: number | undefined): void => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : undefined)
    audio.onerror = () => done(undefined)
    window.setTimeout(() => done(audio.duration), 4000)
    audio.src = url
  })
}

export async function listLocalTracks(): Promise<LocalTrackMeta[]> {
  const database = await openDatabase()
  const transaction = database.transaction(META_STORE, 'readonly')
  const records = await requestToPromise<LocalTrackMeta[]>(transaction.objectStore(META_STORE).getAll())
  return (records || []).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))
}

export async function addLocalTrack(file: File): Promise<LocalTrackMeta> {
  const database = await openDatabase()
  const id = newId()
  const duration = await readDuration(file)
  const title = (file.name.replace(/\.[a-z0-9]+$/i, '') || 'Audio').replace(/_+/g, ' ').trim()
  const meta: LocalTrackMeta = {
    id,
    title,
    artist: 'Berkas lokal',
    duration,
    fileName: file.name,
    addedAt: new Date().toISOString()
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([META_STORE, AUDIO_STORE], 'readwrite')
    transaction.objectStore(META_STORE).put(meta)
    transaction.objectStore(AUDIO_STORE).put(file, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Gagal menyimpan berkas audio.'))
  })
  return meta
}

const urlCache = new Map<string, string>()

export async function getLocalUrl(id: string): Promise<string> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const database = await openDatabase()
  const transaction = database.transaction(AUDIO_STORE, 'readonly')
  const blob = await requestToPromise<Blob | undefined>(transaction.objectStore(AUDIO_STORE).get(id))
  if (!blob) throw new Error('Berkas audio tidak ditemukan di penyimpanan.')
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export async function removeLocalTrack(id: string): Promise<void> {
  const database = await openDatabase()
  const cached = urlCache.get(id)
  if (cached) {
    URL.revokeObjectURL(cached)
    urlCache.delete(id)
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([META_STORE, AUDIO_STORE], 'readwrite')
    transaction.objectStore(META_STORE).delete(id)
    transaction.objectStore(AUDIO_STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('Gagal menghapus berkas audio.'))
  })
}

export function isAudioFile(file: File): boolean {
  return /^audio\//.test(file.type) || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(file.name)
}
