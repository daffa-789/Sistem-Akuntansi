const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const PATTERNS = [
  /[?&]v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /\/embed\/([A-Za-z0-9_-]{11})/,
  /\/shorts\/([A-Za-z0-9_-]{11})/,
  /\/live\/([A-Za-z0-9_-]{11})/
]

export function parseYouTubeInput(value) {
  const text = (value || '').trim()
  if (!text) return null
  if (VIDEO_ID.test(text)) return text
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text)
    if (match) return match[1]
  }
  return null
}

export function youtubeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`
}

export function youtubeThumbnail(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba']

export const audioAcceptValue = AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export function isAudioFile(name) {
  const dot = (name || '').lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}

export function formatBytes(bytes) {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function trackSourceLabel(track) {
  if (track?.kind === 'LOCAL') return 'Berkas lokal'
  return track?.artist || 'YouTube'
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function nextTrackIndex(options) {
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
