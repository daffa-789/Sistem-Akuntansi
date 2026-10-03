// Utilitas murni pemutar musik: parsing tautan, format waktu, urutan daftar
// putar, dan pemeriksaan berkas audio impor. Sengaja tanpa DOM supaya bisa diuji
// langsung (lihat music.test.ts).
//
// Pustaka musik disimpan di server (tabel music_tracks): lagu lokal disimpan
// sebagai berkas di folder data aplikasi, sedangkan lagu YouTube hanya berupa
// tautan. Audio YouTube tidak pernah disalin ke disk.

export type TrackKind = 'LOCAL' | 'YOUTUBE'

// Track satu lagu di pustaka. Lagu lokal memakai audioUrl, lagu YouTube memakai
// youtubeId + thumbnail.
export interface Track {
  id: number
  kind: TrackKind
  title: string
  artist: string
  position: number
  addedAt?: string
  // Khusus lagu lokal
  audioUrl?: string
  sizeBytes?: number
  duration?: number
  // Khusus lagu YouTube
  youtubeId?: string
  thumbnail?: string
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const PATTERNS: RegExp[] = [
  /[?&]v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /\/embed\/([A-Za-z0-9_-]{11})/,
  /\/shorts\/([A-Za-z0-9_-]{11})/,
  /\/live\/([A-Za-z0-9_-]{11})/
]

// parseYouTubeInput menerima URL watch/shorts/embed/youtu.be atau ID polos.
// Mengembalikan null bila bukan tautan video YouTube yang sah.
export function parseYouTubeInput(value: string): string | null {
  const text = (value || '').trim()
  if (!text) return null
  if (VIDEO_ID.test(text)) return text
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text)
    if (match) return match[1]
  }
  return null
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

// AUDIO_EXTENSIONS daftar format yang boleh diimpor; sinkron dengan daftar di
// internal/httpapi/music.go supaya tidak ada berkas yang ditolak belakangan.
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba']

// audioAcceptValue nilai atribut accept untuk <input type="file">.
export const audioAcceptValue = AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',')

// isAudioFile memeriksa berkas berdasarkan ekstensi namanya.
export function isAudioFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}

// formatBytes ukuran berkas menjadi teks pendek berbahasa Indonesia.
export function formatBytes(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// trackExtension memberi keterangan jenis lagu untuk ditampilkan di daftar.
export function trackSourceLabel(track: Track): string {
  if (track.kind === 'LOCAL') return 'Berkas lokal'
  return track.artist || 'YouTube'
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export interface AdvanceOptions {
  count: number
  current: number
  repeatOne: boolean
  shuffle: boolean
  direction?: 1 | -1
  random?: () => number
}

// nextTrackIndex menentukan lagu berikutnya/sebelumnya.
// - repeatOne + maju -> tetap di lagu yang sama
// - acak -> indeks lain (kalau ada lebih dari satu lagu)
// - tanpa acak -> naik/turun dengan lingkaran penuh
export function nextTrackIndex(options: AdvanceOptions): number {
  const { count, current, repeatOne, shuffle } = options
  const direction = options.direction ?? 1
  const random = options.random ?? Math.random
  if (count <= 0) return -1
  if (repeatOne && direction === 1) return current
  if (shuffle && count > 1) {
    let candidate = current
    let guard = 0
    while (candidate === current && guard < 24) {
      candidate = Math.floor(random() * count)
      guard += 1
    }
    return candidate
  }
  return (current + direction + count) % count
}
