// Layanan pustaka musik: membaca/menulis daftar lagu tersimpan di server.
// Lagu lokal diunggah sebagai berkas (disimpan server di folder data aplikasi),
// sedangkan tautan YouTube hanya disimpan sebagai tautan. Tidak ada audio
// YouTube yang diunduh atau disimpan di sini.
import { request } from '../api.js'
import type { Track } from '../utils/music.js'

interface TrackListResponse {
  tracks: Track[]
}

interface TrackResponse {
  track: Track
}

// listTracks memuat seluruh pustaka musik yang tersimpan.
export async function listTracks(): Promise<Track[]> {
  const payload = await request<TrackListResponse>('/music')
  return payload.tracks || []
}

// addYouTubeTrack menyimpan tautan video YouTube ke pustaka.
export async function addYouTubeTrack(url: string): Promise<Track> {
  const payload = await request<TrackResponse>('/music/youtube', {
    method: 'POST',
    body: { url }
  })
  return payload.track
}

// readAudioDuration membaca panjang lagu dari berkas sebelum diunggah, supaya
// daftar bisa menampilkan durasi tanpa perlu memuat audionya lebih dulu.
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(file)
    let settled = false
    const finish = (value: number): void => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(value)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    audio.onerror = () => finish(0)
    // Beberapa format tidak melaporkan metadata dengan cepat: jangan tunggu selamanya.
    window.setTimeout(() => finish(Number.isFinite(audio.duration) ? audio.duration : 0), 4000)
    audio.src = url
  })
}

// uploadLocalTrack mengunggah berkas audio MILIK PENGGUNA ke penyimpanan server
// agar tetap ada setelah aplikasi ditutup.
export async function uploadLocalTrack(file: File): Promise<Track> {
  const duration = await readAudioDuration(file)
  const form = new FormData()
  form.append('file', file)
  form.append('title', file.name.replace(/\.[a-z0-9]+$/i, '').replace(/_+/g, ' ').trim())
  form.append('artist', 'Berkas lokal')
  form.append('duration', String(duration || 0))

  const payload = await request<TrackResponse>('/music/local', {
    method: 'POST',
    body: form
  })
  return payload.track
}

// removeTrack menghapus lagu dari pustaka (berikut berkas audionya bila lokal).
export async function removeTrack(id: number): Promise<void> {
  await request(`/music/${id}`, { method: 'DELETE' })
}

// openOnYouTube membuka video di peramban sistem lewat backend. Dipakai saat
// pemilik video menonaktifkan penyematan: lagu tetap diputar lewat pemutar
// resmi YouTube, tidak pernah diunduh atau disalin ke disk.
export async function openOnYouTube(url: string): Promise<void> {
  await request('/music/open-external', { method: 'POST', body: { url } })
}

// refreshTrackMetadata mengambil ulang judul/penyewa/sampul sebuah tautan
// YouTube (oEmbed) untuk lagu yang tersimpan sebelum jaringan tersedia.
export async function refreshTrackMetadata(id: number): Promise<Track> {
  const payload = await request<TrackResponse>(`/music/${id}/refresh`, {
    method: 'POST'
  })
  return payload.track
}

// saveTrackOrder menyimpan urutan pustaka setelah pengguna menata ulang.
export async function saveTrackOrder(tracks: Track[]): Promise<void> {
  await request('/music/order', {
    method: 'PUT',
    body: { ids: tracks.map((track) => track.id) }
  })
}
