// Utilitas murni pemutar musik: parsing tautan, urutan daftar putar, dan format waktu.
// Sengaja tanpa DOM supaya bisa diuji langsung (lihat music.test.ts).

export type TrackKind = 'youtube' | 'local'

export interface Track {
  key: string
  kind: TrackKind
  title: string
  artist: string
  thumbnail?: string
  youtubeId?: string
  localId?: string
  duration?: number
  trackId?: number
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

// trackFromRow memetakan baris /api/tracks menjadi Track.
export function trackFromRow(row: Record<string, unknown>): Track {
  const id = String(row.youtube_id || '')
  return {
    key: `yt:${id}`,
    kind: 'youtube',
    title: String(row.title || 'Tanpa judul'),
    artist: String(row.artist || 'YouTube'),
    thumbnail: (row.thumbnail_url as string) || youtubeThumbnail(id),
    youtubeId: id,
    duration: row.duration ? Number(row.duration) : undefined,
    trackId: Number(row.id)
  }
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

// DEFAULT_TRACKS adalah tautan audio RESMI (kanal artist distribusi OST Atlus/Sony)
// yang ditawarkan saat daftar putar masih kosong. Tidak ada berkas audio yang
// disalin — pemutaran memakai pemutar semat YouTube.
const SEED_SOURCE = [
  { title: 'Rivers In the Desert', artist: 'Lyn - Topic (Persona 3 / Persona 5)', youtubeId: 'lvuHvXsZPrk' },
  { title: 'Life Will Change', artist: 'Lyn - Topic (Persona 5)', youtubeId: 'dsuJZx24V_A' },
  { title: 'Last Surprise', artist: 'Lyn - Topic (Persona 5)', youtubeId: 'ZNGqBDRJgvo' }
]

export const DEFAULT_TRACKS: Track[] = SEED_SOURCE.map((item) => ({
  key: `seed:${item.youtubeId}`,
  kind: 'youtube' as const,
  title: item.title,
  artist: item.artist,
  youtubeId: item.youtubeId,
  thumbnail: youtubeThumbnail(item.youtubeId)
}))

// sanitizeFileName membersihkan judul untuk dipakai sebagai nama berkas.
export function sanitizeFileName(value: string): string {
  const cleaned = (value || 'lagu')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 80) || 'lagu'
}

// buildPlaylistM3u menyusun berkas M3U berisi TAUTAN YouTube resmi (bukan audio).
// Berkas lokal dilewati karena tidak punya alamat yang berarti di komputer lain.
export function buildPlaylistM3u(tracks: Track[]): string {
  const lines = ['#EXTM3U', '#EXTGENRE:Finova - daftar putar']
  for (const track of tracks) {
    if (track.kind !== 'youtube' || !track.youtubeId) continue
    const seconds = Math.max(0, Math.round(track.duration || 0))
    const label = track.artist ? `${track.artist} - ${track.title}` : track.title
    lines.push(`#EXTINF:${seconds},${label}`.replace(/\n/g, ' '))
    lines.push(youtubeWatchUrl(track.youtubeId))
  }
  if (lines.length <= 2) return ''
  return `${lines.join('\n')}\n`
}

// mergeTracks menggabungkan daftar server + berkas lokal. Saran bawaan hanya
// ditampilkan bila keduanya benar-benar kosong, supaya daftar putar milik pengguna
// tidak pernah tercampur usulan.
export function mergeTracks(server: Track[], local: Track[], showSeeds: boolean): Track[] {
  const seen = new Set<string>()
  const merged: Track[] = []
  for (const track of [...server, ...local]) {
    const id = track.youtubeId || track.localId || track.key
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(track)
  }
  if (showSeeds && merged.length === 0) {
    for (const seed of DEFAULT_TRACKS) {
      if (seen.has(seed.youtubeId as string)) continue
      seen.add(seed.youtubeId as string)
      merged.push(seed)
    }
  }
  return merged
}
