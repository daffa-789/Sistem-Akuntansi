import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Album, ListMusic, Maximize2, Minimize2, Music2, Pause, Play, Plus, Repeat,
  Shuffle, SkipBack, SkipForward, Trash2, Volume2, X, ExternalLink
} from 'lucide-react'
import { request } from '../../api.js'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer.js'
import { addLocalTrack, getLocalUrl, isAudioFile, listLocalTracks, removeLocalTrack } from '../../services/localAudio.js'
import {
  formatClock, mergeTracks, nextTrackIndex, parseYouTubeInput, trackFromRow,
  youtubeWatchUrl, type Track
} from '../../utils/music.js'

const YT_HOST_ID = 'finova-yt-host'
const VOLUME_KEY = 'finova_music_volume'
const OPEN_KEY = 'finova_music_open'
const SEED_DISMISS_KEY = 'finova_music_seed'

// Pemutar musik yang menempel di dasar layar, supaya laporan bisa dikerjakan sambil
// mendengar musik. Sumber: tautan YouTube resmi (disemat) atau berkas audio milik
// sendiri yang tersimpan di peramban.
export function MusicPlayer({ notify }: { notify: (message: string, isError?: boolean) => void }): React.JSX.Element {
  const [serverTracks, setServerTracks] = useState<Track[]>([])
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const [index, setIndex] = useState(-1)
  const [shuffle, setShuffle] = useState(false)
  const [repeatOne, setRepeatOne] = useState(false)
  const [panelOpen, setPanelOpen] = useState<boolean>(() => localStorage.getItem(OPEN_KEY) === '1')
  const [volume, setVolume] = useState<number>(() => Number(localStorage.getItem(VOLUME_KEY) ?? 70))
  const [muted, setMuted] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [seedDismissed, setSeedDismissed] = useState<boolean>(() => localStorage.getItem(SEED_DISMISS_KEY) === '1')
  const [audioActive, setAudioActive] = useState(false)
  const [audioClock, setAudioClock] = useState({ position: 0, duration: 0 })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const yt = useYouTubePlayer(YT_HOST_ID)

  const tracks = useMemo(
    () => mergeTracks(serverTracks, localTracks, !seedDismissed && serverTracks.length === 0 && localTracks.length === 0),
    [serverTracks, localTracks, seedDismissed]
  )
  const current = index >= 0 && index < tracks.length ? tracks[index] : undefined
  const isLocal = current?.kind === 'local'
  const playing = isLocal ? audioActive : yt.playing
  const duration = isLocal ? (audioClock.duration || current?.duration || 0) : yt.duration
  const position = isLocal ? audioClock.position : yt.current

  useEffect(() => {
    const audio = new window.Audio()
    audio.preload = 'metadata'
    audio.addEventListener('play', () => setAudioActive(true))
    audio.addEventListener('pause', () => setAudioActive(false))
    audio.addEventListener('ended', () => window.dispatchEvent(new CustomEvent('finova:track-ended')))
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [])

  // Jam putar untuk berkas lokal (elemen <audio> tidak punya event per detik).
  useEffect(() => {
    if (!audioActive) return
    const tick = (): void => {
      const audio = audioRef.current
      if (!audio) return
      setAudioClock({
        position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0
      })
    }
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [audioActive])

  const refreshServer = useCallback(async () => {
    try {
      const payload = await request<{ tracks: Record<string, unknown>[] }>('/tracks')
      setServerTracks((payload.tracks || []).map(trackFromRow))
    } catch (error: any) {
      notify(`Daftar lagu tidak dapat dimuat: ${error.message}`, true)
    }
  }, [notify])

  const refreshLocal = useCallback(async () => {
    try {
      const records = await listLocalTracks()
      setLocalTracks(records.map((item) => ({
        key: `local:${item.id}`,
        kind: 'local' as const,
        title: item.title,
        artist: item.artist,
        duration: item.duration,
        localId: item.id
      })))
    } catch {
      // penyimpanan lokal tidak tersedia (mode privat): abaikan diam-diam
    }
  }, [])

  useEffect(() => {
    void refreshServer()
    void refreshLocal()
  }, [refreshServer, refreshLocal])

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume))
    yt.setVolume(muted ? 0 : volume)
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume / 100
  }, [volume, muted, yt])

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, panelOpen ? '1' : '0')
  }, [panelOpen])

  const playTrack = useCallback(async (position: number) => {
    const track = tracks[position]
    if (!track) return
    setIndex(position)
    const audio = audioRef.current
    if (track.kind === 'local' && track.localId) {
      yt.pause()
      try {
        const url = await getLocalUrl(track.localId)
        if (audio) {
          if (audio.dataset.track !== track.localId) {
            audio.dataset.track = track.localId
            audio.src = url
          }
          audio.volume = muted ? 0 : volume / 100
          await audio.play()
        }
      } catch (error: any) {
        // Peramban menolak pemutaran tanpa interaksi pengguna (autoplay policy).
        if (error?.name === 'NotAllowedError') {
          notify('Peramban meminta interaksi dulu - klik tombol putar sekali lagi.')
        } else {
          notify(error.message || 'Berkas audio tidak dapat diputar.', true)
        }
      }
      return
    }
    if (audio && !audio.paused) audio.pause()
    if (track.youtubeId) yt.load(track.youtubeId, true)
  }, [tracks, yt, notify, volume, muted])

  const advance = useCallback((direction: 1 | -1) => {
    if (!tracks.length) return
    const next = nextTrackIndex({
      count: tracks.length,
      current: index < 0 ? 0 : index,
      repeatOne: direction === 1 ? repeatOne : false,
      shuffle
    })
    void playTrack(next)
  }, [tracks.length, index, repeatOne, shuffle, playTrack])

  // Lagu selesai -> lanjut otomatis (hormati repeat/shuffle).
  useEffect(() => {
    function onEnded() {
      advance(1)
    }
    window.addEventListener('finova:track-ended', onEnded)
    return () => window.removeEventListener('finova:track-ended', onEnded)
  }, [advance])

  const togglePlay = useCallback(() => {
    if (!current) {
      if (tracks.length) void playTrack(0)
      return
    }
    if (current.kind === 'local' && audioRef.current) {
      if (audioRef.current.paused) void audioRef.current.play()
      else audioRef.current.pause()
      return
    }
    if (yt.playing) yt.pause()
    else yt.play()
  }, [current, tracks.length, playTrack, yt])

  // Pintasan keyboard: Alt+P putar/jeda, Alt+panah ganti lagu, Alt+M bisukan.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 'p') {
        event.preventDefault()
        togglePlay()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        advance(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        advance(-1)
      } else if (key === 'm') {
        event.preventDefault()
        setMuted((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlay, advance])

  async function addLink(event: React.FormEvent) {
    event.preventDefault()
    const videoId = parseYouTubeInput(linkDraft)
    if (!videoId) {
      notify('Tempel tautan YouTube yang benar, mis. https://youtu.be/dsuJZx24V_A', true)
      return
    }
    setBusy(true)
    try {
      await request('/tracks', { method: 'POST', body: { url: youtubeWatchUrl(videoId) } })
      setLinkDraft('')
      setSeedDismissed(true)
      localStorage.setItem(SEED_DISMISS_KEY, '1')
      await refreshServer()
      notify('Lagu ditambahkan ke daftar putar.')
    } catch (error: any) {
      notify(`Gagal menambah lagu: ${error.message}`, true)
    } finally {
      setBusy(false)
    }
  }

  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    const accepted = files.filter(isAudioFile)
    if (!accepted.length) {
      if (files.length) notify('Format berkas tidak dikenali. Pakai mp3, m4a, ogg, opus, wav, atau flac.', true)
      return
    }
    setBusy(true)
    try {
      for (const file of accepted) await addLocalTrack(file)
      await refreshLocal()
      notify(`${accepted.length} berkas audio ditambahkan (tersimpan di peramban ini).`)
    } catch (error: any) {
      notify(`Gagal menyimpan berkas: ${error.message}`, true)
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function removeTrack(track: Track) {
    setBusy(true)
    try {
      if (track.kind === 'local' && track.localId) {
        await removeLocalTrack(track.localId)
        if (current?.key === track.key) {
          audioRef.current?.pause()
          setIndex(-1)
        }
        await refreshLocal()
      } else if (track.trackId) {
        await request(`/tracks/${track.trackId}`, { method: 'DELETE' })
        if (current?.key === track.key) setIndex(-1)
        await refreshServer()
      } else {
        setSeedDismissed(true)
        localStorage.setItem(SEED_DISMISS_KEY, '1')
      }
      notify('Lagu dihapus dari daftar putar.')
    } catch (error: any) {
      notify(`Gagal menghapus: ${error.message}`, true)
    } finally {
      setBusy(false)
    }
  }

  async function saveSeed(track: Track) {
    if (!track.youtubeId) return
    setBusy(true)
    try {
      await request('/tracks', {
        method: 'POST',
        body: { url: youtubeWatchUrl(track.youtubeId), title: track.title, artist: track.artist, thumbnailUrl: track.thumbnail }
      })
      await refreshServer()
      notify(`"${track.title}" disimpan ke daftar putar.`)
    } catch (error: any) {
      notify(`Gagal menyimpan: ${error.message}`, true)
    } finally {
      setBusy(false)
    }
  }

  const label = current?.thumbnail
    ? { backgroundImage: `url(${current.thumbnail})` }
    : undefined

  return (
    <>
      <div id={YT_HOST_ID} className="music-host" aria-hidden="true" />

      {panelOpen && (
        <aside className="music-panel no-print" aria-label="Daftar putar musik">
          <header className="music-panel-head">
            <h2><ListMusic size={15} /> Daftar putar</h2>
            <button className="icon-button" onClick={() => setPanelOpen(false)} aria-label="Tutup daftar putar">
              <X size={15} />
            </button>
          </header>

          <form className="music-add" onSubmit={addLink}>
            <input
              type="url"
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder="Tempel tautan YouTube (kanal resmi)…"
              aria-label="Tautan YouTube"
            />
            <button type="submit" className="btn btn-small" disabled={busy || !linkDraft.trim()}>
              <Plus size={14} /> Tambah
            </button>
          </form>

          <label className="music-file">
            <input type="file" accept="audio/*" multiple onChange={onFiles} disabled={busy} />
            <Music2 size={14} /> Impor berkas audio dari komputer
          </label>

          <ol className="music-list">
            {tracks.length === 0 && (
              <li className="music-empty">Belum ada lagu. Tempel tautan YouTube atau impor berkas audio.</li>
            )}
            {tracks.map((track, position) => (
              <li key={track.key} className={position === index ? 'active' : ''}>
                <button
                  className="music-row"
                  onClick={() => void playTrack(position)}
                  title={track.kind === 'local' ? 'Putar berkas lokal' : 'Putar lewat penyematan YouTube'}
                >
                  <span className="music-row-art">
                    {track.thumbnail
                      ? <img src={track.thumbnail} alt="" loading="lazy" />
                      : <Album size={16} />}
                  </span>
                  <span className="music-row-text">
                    <strong>{track.title}</strong>
                    <small>{track.artist}{track.kind === 'local' ? ' · lokal' : ''}</small>
                  </span>
                  <span className="music-row-time">{track.duration ? formatClock(track.duration) : ''}</span>
                </button>
                <span className="music-row-actions">
                  {track.kind === 'youtube' && track.youtubeId && !track.trackId && (
                    <button className="icon-button" onClick={() => void saveSeed(track)} title="Simpan ke daftar putar">
                      <Plus size={14} />
                    </button>
                  )}
                  {track.kind === 'youtube' && track.youtubeId && (
                    <a
                      className="icon-button"
                      href={youtubeWatchUrl(track.youtubeId)}
                      target="_blank"
                      rel="noreferrer"
                      title="Buka di YouTube"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <button className="icon-button" onClick={() => void removeTrack(track)} title="Hapus dari daftar putar">
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ol>

          <p className="music-note">
            Audio diputar langsung dari YouTube (bukan salinan) atau dari berkas Anda sendiri.
            Sebagian kanal menonaktifkan penyematan - kalau gagal putar, pakai tombol
            {" “Buka di YouTube” "}.
          </p>
        </aside>
      )}

      <footer className="music-dock no-print" aria-label="Pemutar musik">
        <div
          className={`vinyl ${playing ? 'spinning' : ''}`}
          onClick={togglePlay}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              togglePlay()
            }
          }}
          aria-label={playing ? 'Jeda musik' : 'Putar musik'}
          title={playing ? 'Jeda (Alt+P)' : 'Putar (Alt+P)'}
        >
          <div className="vinyl-label" style={label}>
            {!current?.thumbnail && <Music2 size={14} />}
          </div>
        </div>

        <div className="music-meta">
          <strong title={current?.title}>{current ? current.title : 'Pemutar musik'}</strong>
          <small>
            {current
              ? current.artist
              : 'Alt+P putar/jeda · Alt+panah ganti lagu · Alt+M bisukan'}
          </small>
          {yt.error && <em className="music-error">{yt.error}</em>}
        </div>

        <div className="music-controls">
          <button className="icon-button" onClick={() => advance(-1)} title="Lagu sebelumnya (Alt+←)" aria-label="Lagu sebelumnya">
            <SkipBack size={16} />
          </button>
          <button className="music-play" onClick={togglePlay} title="Putar/jeda (Alt+P)" aria-label={playing ? 'Jeda' : 'Putar'}>
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button className="icon-button" onClick={() => advance(1)} title="Lagu berikutnya (Alt+→)" aria-label="Lagu berikutnya">
            <SkipForward size={16} />
          </button>
        </div>

        <div className="music-seek">
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(position, Math.max(0, duration))}
            onChange={(event) => {
              const seconds = Number(event.target.value)
              if (current?.kind === 'local' && audioRef.current) audioRef.current.currentTime = seconds
              else yt.seek(seconds)
            }}
            disabled={!current || !duration}
            aria-label="Posisi lagu"
          />
          <span>{formatClock(position)} / {duration ? formatClock(duration) : '--:--'}</span>
        </div>

        <div className="music-extra">
          <button
            className={`icon-button ${shuffle ? 'on' : ''}`}
            onClick={() => setShuffle((value) => !value)}
            title="Acak"
            aria-label="Acak"
            aria-pressed={shuffle}
          >
            <Shuffle size={15} />
          </button>
          <button
            className={`icon-button ${repeatOne ? 'on' : ''}`}
            onClick={() => setRepeatOne((value) => !value)}
            title="Ulangi lagu ini"
            aria-label="Ulangi lagu ini"
            aria-pressed={repeatOne}
          >
            <Repeat size={15} />
          </button>
          <button
            className="icon-button"
            onClick={() => setMuted((value) => !value)}
            title="Bisukan (Alt+M)"
            aria-label="Bisukan"
          >
            <Volume2 size={15} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="music-volume"
            aria-label="Kekuatan suara"
          />
          <button
            className="icon-button"
            onClick={() => setPanelOpen((value) => !value)}
            title={panelOpen ? 'Tutup daftar putar' : 'Buka daftar putar'}
            aria-label="Daftar putar"
          >
            {panelOpen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </footer>
    </>
  )
}
