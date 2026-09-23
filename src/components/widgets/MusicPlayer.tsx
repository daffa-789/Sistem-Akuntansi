import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Album, ChevronDown, ChevronUp, Download, ListMusic, Music2, Pause, Play, Plus,
  Repeat, Save, Shuffle, SkipBack, SkipForward, Trash2, Upload, Volume2, X
} from 'lucide-react'
import { request } from '../../api.js'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer.js'
import {
  addLocalTrack, clearLocalTracks, getLocalUrl, isAudioFile, listLocalTracks,
  removeLocalTrack, saveLocalTrackToDisk
} from '../../services/localAudio.js'
import {
  buildPlaylistM3u, formatClock, mergeTracks, nextTrackIndex, parseYouTubeInput,
  sanitizeFileName, trackFromRow, youtubeWatchUrl, type Track
} from '../../utils/music.js'

const YT_HOST_ID = 'finova-yt-host'
const VOLUME_KEY = 'finova_music_volume'
const MODE_KEY = 'finova_music_mode'
const SEED_DISMISS_KEY = 'finova_music_seed'

type WidgetMode = 'full' | 'mini'

// Pemutar musik kecil di kiri atas: piringan minimalis yang berputar saat lagu jalan,
// sampul lagu menjadi label tengah piringan, dan bisa dikecilkan atau ditutup.
export function MusicPlayer({ notify }: { notify: (message: string, isError?: boolean) => void }): React.JSX.Element {
  const [serverTracks, setServerTracks] = useState<Track[]>([])
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const [index, setIndex] = useState(-1)
  const [shuffle, setShuffle] = useState(false)
  const [repeatOne, setRepeatOne] = useState(false)
  const [mode, setMode] = useState<WidgetMode>(() => (localStorage.getItem(MODE_KEY) === 'mini' ? 'mini' : 'full'))
  const [panelOpen, setPanelOpen] = useState(false)
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

  // Jam putar berkas lokal (elemen <audio> tidak memberi event per detik).
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
      // penyimpanan lokal tidak tersedia (mode privat): biarkan daftar kosong
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
    localStorage.setItem(MODE_KEY, mode)
  }, [mode])

  const playTrack = useCallback(async (wanted: number) => {
    const track = tracks[wanted]
    if (!track) return
    setIndex(wanted)
    setAudioClock({ position: 0, duration: track.duration || 0 })
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
        if (error?.name === 'NotAllowedError') notify('Peramban meminta interaksi dulu - klik piringan sekali lagi.')
        else notify(error.message || 'Berkas audio tidak dapat diputar.', true)
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
      if (audioRef.current.paused) void audioRef.current.play().catch(() => notify('Peramban menolak pemutaran otomatis.', true))
      else audioRef.current.pause()
      return
    }
    if (yt.playing) yt.pause()
    else yt.play()
  }, [current, tracks.length, playTrack, yt, notify])

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
    const files = Array.from(event.target.files || []).filter(isAudioFile)
    if (!files.length) {
      notify('Pilih berkas audio (mp3, m4a, ogg, opus, wav, atau flac).', true)
      event.target.value = ''
      return
    }
    setBusy(true)
    try {
      for (const file of files) await addLocalTrack(file)
      await refreshLocal()
      notify(`${files.length} berkas ditambahkan — tersimpan di peramban ini.`)
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

  async function saveToDisk(track: Track) {
    if (track.kind !== 'local' || !track.localId) return
    try {
      await saveLocalTrackToDisk(track.localId, `${sanitizeFileName(track.title)}.audio`)
      notify('Berkas audio Anda disimpan ke folder unduhan.')
    } catch (error: any) {
      notify(`Gagal menyimpan berkas: ${error.message}`, true)
    }
  }

  function exportPlaylist() {
    const text = buildPlaylistM3u(tracks)
    if (!text) {
      notify('Belum ada lagu YouTube di daftar putar untuk diekspor.', true)
      return
    }
    const blob = new Blob([text], { type: 'audio/x-mpegurl' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'Finova_daftar_putar.m3u'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    notify('Daftar putar diekspor sebagai .m3u (berisi tautan, bukan berkas audio).')
  }

  async function clearAll() {
    if (!window.confirm('Hapus seluruh daftar putar (lagu tersimpan + berkas di peramban)?')) return
    setBusy(true)
    try {
      audioRef.current?.pause()
      yt.pause()
      for (const track of serverTracks) {
        if (track.trackId) await request(`/tracks/${track.trackId}`, { method: 'DELETE' })
      }
      await clearLocalTracks()
      setIndex(-1)
      await refreshServer()
      await refreshLocal()
      notify('Daftar putar dikosongkan.')
    } catch (error: any) {
      notify(`Penghapusan tidak lengkap: ${error.message}`, true)
    } finally {
      setBusy(false)
    }
  }

  const labelStyle = current?.thumbnail ? { backgroundImage: `url("${current.thumbnail}")` } : undefined

  // ---------- Mode kecil: hanya piringan, bisa dibuka kembali ----------
  if (mode === 'mini') {
    return (
      <>
        <div id={YT_HOST_ID} className="music-host" aria-hidden="true" />
        <div className="music-mini no-print" role="group" aria-label="Pemutar musik (mode kecil)">
          <button
            className={`vinyl vinyl-min ${playing ? 'spinning' : ''}`}
            onClick={togglePlay}
            aria-label={playing ? 'Jeda musik' : 'Putar musik'}
            title={playing ? 'Jeda (Alt+P)' : 'Putar (Alt+P)'}
          >
            <span className="vinyl-label" style={labelStyle} />
            {!current?.thumbnail && <Music2 size={11} className="vinyl-fallback" />}
          </button>
          <button className="mini-open" onClick={() => setMode('full')} title="Buka pemutar" aria-label="Buka pemutar musik">
            <ChevronDown size={13} />
          </button>
        </div>
      </>
    )
  }

  // ---------- Mode penuh: strip ramping di kiri atas ----------
  return (
    <>
      <div id={YT_HOST_ID} className="music-host" aria-hidden="true" />

      <section className="music-bar no-print" aria-label="Pemutar musik">
        <button
          className={`vinyl vinyl-min ${playing ? 'spinning' : ''}`}
          onClick={togglePlay}
          aria-label={playing ? 'Jeda musik' : 'Putar musik'}
          title={playing ? 'Jeda (Alt+P)' : 'Putar (Alt+P)'}
        >
          <span className="vinyl-label" style={labelStyle} />
          {!current?.thumbnail && <Music2 size={11} className="vinyl-fallback" />}
        </button>

        <div className="music-info">
          <strong title={current?.title}>{current ? current.title : 'Pemutar musik'}</strong>
          <small>
            {current
              ? `${current.artist}${current.kind === 'local' ? ' · berkas lokal' : ''}`
              : 'Belum ada lagu — tempel tautan YouTube atau impor berkas audio'}
          </small>
          {yt.error && <em className="music-error">{yt.error}</em>}
        </div>

        <div className="music-controls">
          <button className="icon-button" onClick={() => advance(-1)} title="Lagu sebelumnya (Alt+←)" aria-label="Lagu sebelumnya">
            <SkipBack size={15} />
          </button>
          <button className="music-play" onClick={togglePlay} title="Putar/jeda (Alt+P)" aria-label={playing ? 'Jeda' : 'Putar'}>
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="icon-button" onClick={() => advance(1)} title="Lagu berikutnya (Alt+→)" aria-label="Lagu berikutnya">
            <SkipForward size={15} />
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
          <button className={`icon-button ${shuffle ? 'on' : ''}`} onClick={() => setShuffle((v) => !v)} title="Acak" aria-label="Acak" aria-pressed={shuffle}>
            <Shuffle size={14} />
          </button>
          <button className={`icon-button ${repeatOne ? 'on' : ''}`} onClick={() => setRepeatOne((v) => !v)} title="Ulangi lagu ini" aria-label="Ulangi lagu ini" aria-pressed={repeatOne}>
            <Repeat size={14} />
          </button>
          <button className="icon-button" onClick={() => setMuted((v) => !v)} title="Bisukan (Alt+M)" aria-label="Bisukan">
            <Volume2 size={14} />
          </button>
          <input type="range" min={0} max={100} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="music-volume" aria-label="Kekuatan suara" />
          <button className={`icon-button ${panelOpen ? 'on' : ''}`} onClick={() => setPanelOpen((v) => !v)} title="Daftar putar" aria-label="Daftar putar" aria-expanded={panelOpen}>
            <ListMusic size={14} />
          </button>
          <button className="icon-button" onClick={() => setMode('mini')} title="Kecilkan" aria-label="Kecilkan pemutar">
            <ChevronUp size={14} />
          </button>
          <button className="icon-button" onClick={() => { setMode('mini'); setPanelOpen(false) }} title="Tutup" aria-label="Tutup pemutar">
            <X size={14} />
          </button>
        </div>

        {panelOpen && (
          <div className="music-card">
            <form className="music-add" onSubmit={addLink}>
              <input
                type="url"
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                placeholder="Tempel tautan YouTube (kanal resmi)…"
                aria-label="Tautan YouTube"
              />
              <button type="submit" className="button secondary small" disabled={busy || !linkDraft.trim()}>
                <Plus size={13} /> Tambah
              </button>
            </form>

            <div className="music-tools">
              <label className="music-tool">
                <input type="file" accept="audio/*" multiple onChange={onFiles} disabled={busy} />
                <Upload size={13} /> Impor berkas audio
              </label>
              <button type="button" className="music-tool" onClick={exportPlaylist} title="Unduh daftar tautan sebagai .m3u">
                <Save size={13} /> Ekspor .m3u
              </button>
              <button type="button" className="music-tool danger" onClick={() => void clearAll()} disabled={busy || !tracks.length}>
                <Trash2 size={13} /> Kosongkan
              </button>
            </div>

            <ol className="music-list">
              {tracks.length === 0 && <li className="music-empty">Belum ada lagu. Tempel tautan YouTube atau impor berkas audio Anda.</li>}
              {tracks.map((track, wanted) => (
                <li key={track.key} className={wanted === index ? 'active' : ''}>
                  <button className="music-row" onClick={() => void playTrack(wanted)} title={track.kind === 'local' ? 'Putar berkas lokal' : 'Putar lewat penyematan YouTube'}>
                    <span className="music-row-art">
                      {track.thumbnail ? <img src={track.thumbnail} alt="" loading="lazy" /> : <Album size={14} />}
                    </span>
                    <span className="music-row-text">
                      <strong>{track.title}</strong>
                      <small>{track.artist}{track.kind === 'local' ? ' · lokal' : ''}</small>
                    </span>
                    <span className="music-row-time">{track.duration ? formatClock(track.duration) : ''}</span>
                  </button>
                  <span className="music-row-actions">
                    {track.kind === 'youtube' && track.youtubeId && !track.trackId && (
                      <button className="icon-button" onClick={() => void saveSeed(track)} title="Simpan ke daftar putar" aria-label="Simpan ke daftar putar">
                        <Plus size={13} />
                      </button>
                    )}
                    {track.kind === 'youtube' && track.youtubeId && (
                      <a className="icon-button" href={youtubeWatchUrl(track.youtubeId)} target="_blank" rel="noreferrer" title="Buka di YouTube" aria-label="Buka di YouTube">
                        <Download size={13} />
                      </a>
                    )}
                    {track.kind === 'local' && (
                      <button className="icon-button" onClick={() => void saveToDisk(track)} title="Simpan berkas ini ke komputer" aria-label="Simpan berkas ke komputer">
                        <Download size={13} />
                      </button>
                    )}
                    <button className="icon-button" onClick={() => void removeTrack(track)} title="Hapus dari daftar putar" aria-label="Hapus lagu">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>

            <p className="music-note">
              Lagu YouTube diputar lewat pemutar resmi YouTube (tidak diunduh). Berkas audio Anda tersimpan di
              peramban ini dan bisa disimpan ulang ke komputer atau dihapus.
            </p>
            <p className="music-note">
              Pintasan: <kbd>Alt</kbd>+<kbd>P</kbd> putar/jeda · <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> ganti lagu ·
              <kbd>Alt</kbd>+<kbd>M</kbd> bisukan.
            </p>
          </div>
        )}
      </section>
    </>
  )
}
