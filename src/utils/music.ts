// Utilitas murni pemutar musik: parsing tautan, format waktu, dan urutan daftar
// putar SEMENTARA. Sengaja tanpa DOM supaya bisa diuji langsung (lihat music.test.ts).
// Tidak ada lagu yang disimpan: tidak ke basis data, tidak ke peramban.

export interface Track {
  key: string
  title: string
  artist: string
  youtubeId: string
  thumbnail: string
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
