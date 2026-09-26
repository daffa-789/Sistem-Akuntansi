import React, { useCallback, useEffect, useState } from 'react'
import {
  ListMusic, Music2, Pause, Play, Plus, Repeat, Shuffle,
  SkipBack, SkipForward, Trash2, Volume2, X
} from 'lucide-react'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer.js'
import {
  formatClock, nextTrackIndex, parseYouTubeInput, youtubeThumbnail,
  type Track
} from '../../utils/music.js'

const YT_HOST_ID = 'finova-yt-host'
const VOLUME_KEY = 'finova_music_volume'

interface YouTubeMeta { title: string; artist: string }

// lookupYouTubeMeta mengambil judul/pemegang hak lewat endpoint oEmbed publik
// YouTube langsung dari peramban. Bila jaringan tidak tersedia, lagu tetap bisa
// diputar dengan judul sementara berupa ID videonya.
async function lookupYouTubeMeta(videoId: string): Promise<YouTubeMeta | null> {
  try {
    const watch = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${watch}`)
    if (!response.ok) return null
    const data = await response.json()
    return { title: String(data.title || ''), artist: String(data.author_name || '') }
  } catch {
    return null
  }
}

// Pemutar musik melayang di kanan atas: piringan hitam dengan sampul lagu
// full-bleed yang berputar saat lagu jalan. Daftar putar bersifat sementara —
// tidak ada lagu yang disimpan ke basis data maupun peramban.
export function MusicPlayer({ notify }: { notify: (message: string, isError?: boolean) => void }): React.JSX.Element {
  const [tracks, setTracks] = useState<Track[]>([])
  const [index, setIndex] = useState(-1)
  const [shuffle, setShuffle] = useState(false)
  const [repeatOne, setRepeatOne] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [volume, setVolume] = useState<number>(() => Number(localStorage.getItem(VOLUME_KEY) ?? 70))
  const [muted, setMuted] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const yt = useYouTubePlayer(YT_HOST_ID)

  const current = index >= 0 && index < tracks.length ? tracks[index] : undefined
  const playing = yt.playing
  const duration = yt.duration
  const position = yt.current

  // Penjaga: kalau permintaan putar tidak menghasilkan suara (kebijakan autoplay
  // lingkungan menolak iframe lintas-asal), beri tahu alih-alih diam saja.
  const [playToken, setPlayToken] = useState(0)
  const [blockedHint, setBlockedHint] = useState(false)

  useEffect(() => {
    if (!playToken) return undefined
    setBlockedHint(false)
    if (playing || yt.error) return undefined
    const timer = window.setTimeout(() => setBlockedHint(true), 3500)
    return () => window.clearTimeout(timer)
  }, [playToken, playing, yt.error])

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume))
    yt.setVolume(muted ? 0 : volume)
  }, [volume, muted, yt])

  const playTrack = useCallback((wanted: number) => {
    const track = tracks[wanted]
    if (!track) return
    setIndex(wanted)
    setPlayToken((value) => value + 1)
    yt.load(track.youtubeId, true)
  }, [tracks, yt])

  const advance = useCallback((direction: 1 | -1) => {
    if (!tracks.length) return
    const next = nextTrackIndex({
      count: tracks.length,
      current: index < 0 ? 0 : index,
      repeatOne: direction === 1 ? repeatOne : false,
      shuffle
    })
    playTrack(next)
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
      if (tracks.length) playTrack(0)
      return
    }
    if (yt.playing) yt.pause()
    else {
      setPlayToken((value) => value + 1)
      yt.play()
    }
  }, [current, tracks.length, playTrack, yt])

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
    const existing = tracks.findIndex((track) => track.youtubeId === videoId)
    if (existing >= 0) {
      playTrack(existing)
      setLinkDraft('')
      setPanelOpen(true)
      return
    }

    // Pemutaran HARUS dipanggil masih di dalam genggaman klik pengguna. Jika
    // menunggu metadata dulu, aktivasi pengguna habis dan kebijakan autoplay
    // peramban menolak suaranya - piringan pun tidak berputar. Judul dan
    // penyanyi diisi menyusul begitu oEmbed menjawab.
    const track: Track = {
      key: `yt:${videoId}`,
      title: videoId,
      artist: 'YouTube',
      youtubeId: videoId,
      thumbnail: youtubeThumbnail(videoId)
    }
    setTracks((prev) => [...prev, track])
    setIndex(tracks.length)
    setLinkDraft('')
    setPlayToken((value) => value + 1)
    yt.load(videoId, true)

    setBusy(true)
    try {
      const meta = await lookupYouTubeMeta(videoId)
      if (meta) {
        setTracks((prev) => prev.map((item) => (item.key === track.key ? { ...item, title: meta.title, artist: meta.artist } : item)))
        notify(`Memutar "${meta.title}".`)
      }
    } finally {
      setBusy(false)
    }
  }

  function removeTrack(key: string) {
    setTracks((prev) => {
      const removed = prev.findIndex((track) => track.key === key)
      const next = prev.filter((track) => track.key !== key)
      if (removed >= 0 && removed === index) {
        yt.pause()
        setIndex(-1)
      } else if (removed >= 0 && removed < index) {
        setIndex((value) => value - 1)
      }
      return next
    })
  }

  const labelStyle = current?.thumbnail ? { backgroundImage: `url("${current.thumbnail}")` } : undefined

  return (
    <>
      <div id={YT_HOST_ID} className="music-host" aria-hidden="true" />

      <div className="music-fab no-print" role="group" aria-label="Pemutar musik">
        <button
          className={`vinyl vinyl-fab ${playing ? 'spinning' : ''}`}
          onClick={togglePlay}
          aria-label={playing ? 'Jeda musik' : 'Putar musik'}
          title={current ? `${current.title} — ${playing ? 'Jeda (Alt+P)' : 'Putar (Alt+P)'}` : 'Putar musik (Alt+P)'}
        >
          {current?.thumbnail
            ? <span className="vinyl-label" style={labelStyle} />
            : <Music2 size={15} className="vinyl-fallback" />}
        </button>
        <button
          className="mini-open"
          onClick={() => setPanelOpen((value) => !value)}
          title="Daftar putar"
          aria-label="Daftar putar musik"
          aria-expanded={panelOpen}
        >
          <ListMusic size={13} />
        </button>

        {panelOpen && (
          <div className="music-card">
            <div className="music-head">
              <strong>Pemutar musik</strong>
              <button className="icon-button" onClick={() => setPanelOpen(false)} title="Tutup panel" aria-label="Tutup panel musik">
                <X size={13} />
              </button>
            </div>

            <div className="music-info">
              <strong title={current?.title}>{current ? current.title : 'Belum ada lagu'}</strong>
              <small>{current ? current.artist : 'Tempel tautan YouTube di bawah untuk mulai memutar'}</small>
              {yt.error && <em className="music-error">{yt.error}</em>}
              {blockedHint && !yt.error && (
                <em className="music-error">Belum terdengar suaranya — klik piringan atau tombol putar untuk memulai.</em>
              )}
            </div>

            <div className="music-seek">
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={Math.min(position, Math.max(0, duration))}
                onChange={(event) => yt.seek(Number(event.target.value))}
                disabled={!current || !duration}
                aria-label="Posisi lagu"
              />
              <span>{formatClock(position)} / {duration ? formatClock(duration) : '--:--'}</span>
            </div>

            <div className="music-row2">
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
              <div className="music-extra">
                <button className={`icon-button ${shuffle ? 'on' : ''}`} onClick={() => setShuffle((v) => !v)} title="Acak" aria-label="Acak" aria-pressed={shuffle}>
                  <Shuffle size={14} />
                </button>
                <button className={`icon-button ${repeatOne ? 'on' : ''}`} onClick={() => setRepeatOne((v) => !v)} title="Ulangi lagu ini" aria-label="Ulangi lagu ini" aria-pressed={repeatOne}>
                  <Repeat size={14} />
                </button>
                <button className={`icon-button ${muted ? 'on' : ''}`} onClick={() => setMuted((v) => !v)} title="Bisukan (Alt+M)" aria-label="Bisukan">
                  <Volume2 size={14} />
                </button>
                <input type="range" min={0} max={100} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="music-volume" aria-label="Kekuatan suara" />
              </div>
            </div>

            <form className="music-add" onSubmit={(event) => void addLink(event)}>
              <input
                type="url"
                value={linkDraft}
                onChange={(event) => setLinkDraft(event.target.value)}
                placeholder="Tempel tautan YouTube (kanal resmi)…"
                aria-label="Tautan YouTube"
              />
              <button type="submit" className="button secondary small" disabled={busy || !linkDraft.trim()}>
                <Plus size={13} /> Putar
              </button>
            </form>

            <ol className="music-list">
              {tracks.length === 0 && <li className="music-empty">Daftar putar kosong — lagu yang diputar tidak disimpan.</li>}
              {tracks.map((track, wanted) => (
                <li key={track.key} className={wanted === index ? 'active' : ''}>
                  <button className="music-row" onClick={() => playTrack(wanted)} title="Putar lagu ini">
                    <span className="music-row-art">
                      <img src={track.thumbnail} alt="" loading="lazy" />
                    </span>
                    <span className="music-row-text">
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </span>
                  </button>
                  <span className="music-row-actions">
                    <button className="icon-button" onClick={() => removeTrack(track.key)} title="Hapus dari daftar putar" aria-label="Hapus lagu">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </>
  )
}
