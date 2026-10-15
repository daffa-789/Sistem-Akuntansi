// Layanan pustaka musik murni React & in-memory / localStorage
import { request } from '../api.js'

export async function listTracks() {
  const payload = await request('/music')
  return payload.tracks || []
}

export async function addYouTubeTrack(url) {
  const payload = await request('/music/youtube', {
    method: 'POST',
    body: { url }
  })
  return payload.track
}

function readAudioDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(file)
    let settled = false
    const finish = (value) => {
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
    window.setTimeout(() => finish(Number.isFinite(audio.duration) ? audio.duration : 0), 4000)
    audio.src = url
  })
}

export async function uploadLocalTrack(file) {
  const duration = await readAudioDuration(file)
  const payload = await request('/music/local', {
    method: 'POST',
    body: file
  })
  return payload.track
}

export async function removeTrack(id) {
  await request(`/music/${id}`, { method: 'DELETE' })
}

export async function openOnYouTube(url) {
  await request('/music/open-external', { method: 'POST', body: { url } })
}

export async function refreshTrackMetadata(id) {
  return { ok: true }
}

export async function saveTrackOrder(tracks) {
  await request('/music/order', {
    method: 'PUT',
    body: { trackIds: tracks.map((track) => track.id) }
  })
}
