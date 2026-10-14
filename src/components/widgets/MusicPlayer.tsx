import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink, ListMusic, Music2, Pause, Play, Plus, RefreshCw, Repeat, Shuffle,
  SkipBack, SkipForward, Trash2, Upload, Volume2, X
} from 'lucide-react'
import { useYouTubePlayer } from '../../hooks/useYouTubePlayer.js'
import {
  addYouTubeTrack, listTracks, openOnYouTube, refreshTrackMetadata, removeTrack, uploadLocalTrack
} from '../../services/musicLibrary.js'
import {
  audioAcceptValue, formatBytes, formatClock, isAudioFile, nextTrackIndex,
  parseYouTubeInput, trackSourceLabel, youtubeThumbnail,
  type Track
} from '../../utils/music.js'

const YT_HOST_ID = 'finova-yt-host'
const VOLUME_KEY = 'finova_music_volume'
const LAST_TRACK_KEY = 'finova_last_track_id'

// Judul cadangan yang dipakai server saat oEmbed gagal (mis. saat ditambah
// tanpa internet). Bentuknya selalu "YouTube <id-11-karakter>".
const PLACEHOLDER_TITLE = /^YouTube [A-Za-z0-9_-]{11}$/

const isPlaceholderTitle = (track: Track): boolean => PLACEHOLDER_TITLE.test(track.title)

// Pemutar musik melayang di kanan atas: piringan hitam dengan sampul lagu
// full-bleed yang berputar saat lagu jalan.
//
// Pustaka lagu TERSIMPAN di server: berkas audio milik pengguna disalin ke folder
// data aplikasi (tetap ada setelah aplikasi ditutup), sedangkan lagu YouTube
// hanya menyimpan tautannya dan diputar lewat sematan resmi. Audio YouTube tidak
// pernah diunduh atau disimpan ke disk.
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
  const [libraryLoading, setLibraryLoading] = useState(true)
  const yt = useYouTubePlayer(YT_HOST_ID)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const current = index >= 0 && index < tracks.length ? tracks[index] : undefined
  const isLocal = current?.kind === 'LOCAL'

  // Keadaan pemutaran untuk lagu lokal (elemen audio HTML) dan YouTube berbeda
  // sumbernya; disatukan di sini supaya panel hanya peduli satu pasang nilai.
  const [localPlaying, setLocalPlaying] = useState(false)
  const [localPosition, setLocalPosition] = useState(0)
  const [localDuration, setLocalDuration] = useState(0)

  const playing = isLocal ? localPlaying : yt.playing
  const duration = isLocal ? localDuration : yt.duration
  const position = isLocal ? localPosition : yt.current

  // Muat pustaka tersimpan sekali saat pemutar dipasang.
  useEffect(() => {
    let cancelled = false
    listTracks()
      .then((saved) => {
        if (!cancelled) {
          setTracks(saved)
          if (saved.length > 0) {
            const lastId = localStorage.getItem(LAST_TRACK_KEY)
            const foundIdx = lastId ? saved.findIndex((t) => String(t.id) === lastId) : 0
            const targetIdx = foundIdx >= 0 ? foundIdx : 0
            setIndex(targetIdx)
          }
        }
      })
      .catch(() => {
        if (!cancelled) notify('Pustaka musik tidak dapat dimuat dari server.', true)
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Penjaga: kalau permintaan putar tidak menghasilkan suara (kebijakan autoplay
  // lingkungan menolak iframe lintas-asal), beri tahu alih-alih diam saja.
  const [playToken, setPlayToken] = useState(0)
  const [blockedHint, setBlockedHint] = useState(false)

  useEffect(() => {
    if (!playToken || isLocal) return undefined
    setBlockedHint(false)
    if (yt.playing || yt.error) return undefined
    const timer = window.setTimeout(() => setBlockedHint(true), 3500)
    return () => window.clearTimeout(timer)
  }, [playToken, isLocal, yt.playing, yt.error])

  useEffect(() => {
    localStorage.setItem(VOLUME_KEY, String(volume))
    if (audioRef.current) audioRef.current.volume = (muted ? 0 : volume) / 100
    yt.setVolume(muted ? 0 : volume)
  }, [volume, muted, yt])

  // Menjatuhkan lagu lokal mematikan pemutar YouTube supaya tidak ada dua suara.
  const stopOtherEngine = useCallback((keep: 'LOCAL' | 'YOUTUBE') => {
    if (keep !== 'YOUTUBE') yt.pause()
    if (keep !== 'LOCAL' && audioRef.current) audioRef.current.pause()
  }, [yt])

  const playTrack = useCallback((wanted: number) => {
    const track = tracks[wanted]
    if (!track) return
    setIndex(wanted)
    if (track.id) {
      localStorage.setItem(LAST_TRACK_KEY, String(track.id))
    }
    setBlockedHint(false)

    if (track.kind === 'LOCAL') {
      stopOtherEngine('LOCAL')
      setLocalPlaying(false)
      setLocalPosition(0)
      setLocalDuration(track.duration || 0)
      setPlayToken((value) => value + 1)
      // Elemen audio sudah dimuat ulang lewat perubahan src; play dipicu effect.
      return
    }

    stopOtherEngine('YOUTUBE')
    setPlayToken((value) => value + 1)
    if (track.youtubeId) yt.load(track.youtubeId, true)
  }, [tracks, yt, stopOtherEngine])

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

  // Setelah src berganti ke lagu lokal, mulai pemutarannya. Dipisah dari
  // playTrack supaya elemen sudah menerima sumber baru sebelum diputar.
  useEffect(() => {
    if (!isLocal || !current?.audioUrl) return
    const audio = audioRef.current
    if (!audio) return
    audio.volume = (muted ? 0 : volume) / 100
    void audio.play().then(
      () => setLocalPlaying(true),
      () => {
        setLocalPlaying(false)
        setBlockedHint(true)
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.audioUrl, isLocal])

  const togglePlay = useCallback(() => {
    if (!current) {
      if (tracks.length) playTrack(0)
      return
    }
    if (isLocal) {
      const audio = audioRef.current
      if (!audio) return
      if (audio.paused) {
        void audio.play().then(
          () => setLocalPlaying(true),
          () => setBlockedHint(true)
        )
      } else {
        audio.pause()
      }
      return
    }
    if (yt.playing) yt.pause()
    else {
      setPlayToken((value) => value + 1)
      yt.play()
    }
  }, [current, tracks.length, playTrack, isLocal, yt])

  const seek = useCallback((seconds: number) => {
    if (isLocal) {
      const audio = audioRef.current
      if (audio) {
        audio.currentTime = seconds
        setLocalPosition(seconds)
      }
      return
    }
    yt.seek(seconds)
  }, [isLocal, yt])

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

  // Tambah tautan YouTube ke pustaka tersimpan.
  async function addLink(event: React.FormEvent) {
    event.preventDefault()
    const videoId = parseYouTubeInput(linkDraft)
    if (!videoId) {
      notify('Tempel tautan YouTube yang benar, mis. https://youtu.be/dsuJZx24V_A', true)
      return
    }
    const existing = tracks.findIndex((track) => track.kind === 'YOUTUBE' && track.youtubeId === videoId)
    if (existing >= 0) {
      playTrack(existing)
      setLinkDraft('')
      setPanelOpen(true)
      notify('Lagu ini sudah ada di pustaka — diputar dari daftar.')
      return
    }

    setBusy(true)
    try {
      const saved = await addYouTubeTrack(linkDraft.trim())
      const wanted = tracks.length
      setTracks((prev) => [...prev, saved])
      setIndex(wanted)
      setLinkDraft('')
      if (saved.kind === 'YOUTUBE' && saved.youtubeId) {
        setPlayToken((value) => value + 1)
        yt.load(saved.youtubeId, true)
        // Kalau judul masih cadangan (oEmbed gagal saat menambah), coba sekali
        // lagi sekarang — biasanya jaringan sudah stabil.
        if (isPlaceholderTitle(saved)) {
          try {
            const fresh = await refreshTrackMetadata(saved.id)
            setTracks((prev) => prev.map((item) => (item.id === fresh.id ? fresh : item)))
          } catch {
            // Biarkan judul cadangan; tombol segarkan tetap tersedia.
          }
        }
      }
      notify(`Tersimpan di pustaka: "${saved.title}".`)
    } catch (error: any) {
      notify(error?.message || 'Tautan YouTube tidak dapat disimpan.', true)
    } finally {
      setBusy(false)
    }
  }

  // Impor berkas audio milik pengguna; berkas disalin ke penyimpanan aplikasi.
  async function importFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    if (!picked.length) return

    const accepted = picked.filter((file) => isAudioFile(file.name))
    const rejected = picked.length - accepted.length
    if (rejected > 0) {
      notify(`${rejected} berkas dilewati karena bukan format audio yang didukung.`, true)
    }
    if (!accepted.length) return

    setBusy(true)
    let savedCount = 0
    let lastSaved: Track | null = null
    try {
      for (const file of accepted) {
        try {
          const saved = await uploadLocalTrack(file)
          lastSaved = saved
          savedCount += 1
          setTracks((prev) => [...prev, saved])
        } catch (error: any) {
          notify(`"${file.name}" gagal diimpor: ${error?.message || 'kesalahan tidak dikenal'}`, true)
        }
      }
      if (savedCount > 0) {
        notify(`${savedCount} lagu tersimpan permanen di pustaka musik.`)
        if (lastSaved) {
          // Daftar sudah ditambahkan di atas; lagu terakhir langsung diputar.
          const wanted = tracks.length + savedCount - 1
          setIndex(wanted)
          if (lastSaved.kind === 'LOCAL') {
            setLocalPlaying(false)
            setLocalPosition(0)
            setLocalDuration(lastSaved.duration || 0)
          }
        }
      }
    } finally {
      setBusy(false)
    }
  }

  async function removeSaved(track: Track) {
    const removedIndex = tracks.findIndex((item) => item.id === track.id)
    try {
      await removeTrack(track.id)
    } catch (error: any) {
      notify(error?.message || 'Lagu tidak dapat dihapus dari pustaka.', true)
      return
    }
    setTracks((prev) => prev.filter((item) => item.id !== track.id))
    if (removedIndex === index) {
      if (isLocal) audioRef.current?.pause()
      else yt.pause()
      setLocalPlaying(false)
      setIndex(-1)
    } else if (removedIndex >= 0 && removedIndex < index) {
      setIndex((value) => value - 1)
    }
    notify('Lagu dihapus dari pustaka.')
  }

  // Buka video di youtube.com lewat peramban sistem. Ini jalan keluar yang
  // selalu jalan ketika pemilik video menonaktifkan penyematan (galat 101/150).
  async function openTrackExternal(track: Track) {
    const url = track.youtubeId
      ? `https://www.youtube.com/watch?v=${track.youtubeId}`
      : track.title
    if (!url) return
    try {
      await openOnYouTube(url)
    } catch (error: any) {
      notify(error?.message || 'YouTube tidak dapat dibuka di peramban.', true)
      // Cadangan terakhir: biar peramban aplikasi yang membuka tautannya.
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  // Ambil ulang judul/penyewa/sampul dari YouTube untuk lagu yang judulnya
  // masih berupa cadangan "YouTube <id>".
  async function refreshMeta(track: Track) {
    try {
      const fresh = await refreshTrackMetadata(track.id)
      setTracks((prev) => prev.map((item) => (item.id === fresh.id ? fresh : item)))
      notify(`Judul diperbarui: "${fresh.title}".`)
    } catch (error: any) {
      notify(error?.message || 'Judul video tidak dapat diperbarui dari YouTube.', true)
    }
  }

  const labelStyle = useMemo(
    () => (current?.thumbnail ? { backgroundImage: `url("${current.thumbnail}")` } : undefined),
    [current?.thumbnail]
  )

  const hasLocal = tracks.some((track) => track.kind === 'LOCAL')

  return (
    <>
      <div id={YT_HOST_ID} className="music-host" aria-hidden="true" />

      {/* Elemen audio untuk lagu lokal; sumbernya diganti lewat atribut src. */}
      <audio
        ref={audioRef}
        src={isLocal ? current?.audioUrl : ''}
        preload="metadata"
        onPlay={() => setLocalPlaying(true)}
        onPause={() => setLocalPlaying(false)}
        onEnded={() => {
          setLocalPlaying(false)
          advance(1)
        }}
        onTimeUpdate={(event) => setLocalPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration
          if (Number.isFinite(value)) setLocalDuration(value)
        }}
        onError={() => {
          if (!isLocal) return
          setLocalPlaying(false)
          notify('Berkas audio lagu ini tidak dapat diputar.', true)
        }}
      />

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
          title="Pustaka musik"
          aria-label="Pustaka musik"
          aria-expanded={panelOpen}
        >
          <ListMusic size={13} />
        </button>

        {panelOpen && (
          <div className="music-card">
            <div className="music-head">
              <strong>Pustaka musik</strong>
              <button className="icon-button" onClick={() => setPanelOpen(false)} title="Tutup panel" aria-label="Tutup panel musik">
                <X size={13} />
              </button>
            </div>

            <div className="music-info">
              <strong title={current?.title}>{current ? current.title : 'Belum ada lagu'}</strong>
              <small>{current ? trackSourceLabel(current) : 'Impor berkas audio atau tempel tautan YouTube di bawah'}</small>
              {!isLocal && yt.error && <em className="music-error">{yt.error}</em>}
              {blockedHint && !(yt.error && !isLocal) && (
                <em className="music-error">Belum terdengar suaranya — klik piringan atau tombol putar untuk memulai.</em>
              )}
              {!isLocal && current?.youtubeId && (
                <button
                  type="button"
                  className={`music-open-yt${yt.error ? ' is-error' : ''}`}
                  onClick={() => void openTrackExternal(current)}
                  title="Putar lagu ini di youtube.com lewat peramban sistem"
                >
                  <ExternalLink size={11} /> Buka di YouTube
                </button>
              )}
            </div>

            <div className="music-seek">
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={Math.min(position, Math.max(0, duration))}
                onChange={(event) => seek(Number(event.target.value))}
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

            <div className="music-import">
              <input
                ref={fileInputRef}
                type="file"
                accept={audioAcceptValue}
                multiple
                onChange={(event) => void importFiles(event)}
                className="music-file-input"
                aria-label="Pilih berkas audio untuk diimpor"
              />
              <button
                type="button"
                className="button secondary small"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                title="Impor berkas audio milik Anda (mp3, m4a, ogg, wav, flac)"
              >
                <Upload size={13} /> Impor berkas audio
              </button>
              <small className="music-import-hint">Disalin ke penyimpanan aplikasi dan tetap ada setelah ditutup.</small>
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
                <Plus size={13} /> Simpan
              </button>
            </form>

            <ol className="music-list">
              {libraryLoading && <li className="music-empty">Memuat pustaka musik…</li>}
              {!libraryLoading && tracks.length === 0 && (
                <li className="music-empty">Pustaka kosong — impor berkas audio atau simpan tautan YouTube.</li>
              )}
              {tracks.map((track, wanted) => (
                <li key={track.id} className={wanted === index ? 'active' : ''}>
                  <button className="music-row" onClick={() => playTrack(wanted)} title="Putar lagu ini">
                    <span className="music-row-art">
                      {track.thumbnail
                        ? <img src={track.thumbnail} alt="" loading="lazy" />
                        : <Music2 size={14} className="music-row-art-fallback" />}
                    </span>
                    <span className="music-row-text">
                      <strong>{track.title}</strong>
                      <small>
                        {trackSourceLabel(track)}
                        {track.kind === 'LOCAL' && track.sizeBytes
                          ? ` · ${formatBytes(track.sizeBytes)}`
                          : ''}
                      </small>
                    </span>
                  </button>
                  <span className="music-row-actions">
                    {track.kind === 'YOUTUBE' && (
                      <>
                        {isPlaceholderTitle(track) && (
                          <button
                            className="icon-button"
                            onClick={() => void refreshMeta(track)}
                            title="Perbarui judul dari YouTube"
                            aria-label="Perbarui judul lagu ini dari YouTube"
                          >
                            <RefreshCw size={13} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          onClick={() => void openTrackExternal(track)}
                          title="Buka di YouTube"
                          aria-label="Buka lagu ini di YouTube"
                        >
                          <ExternalLink size={13} />
                        </button>
                      </>
                    )}
                    <button className="icon-button" onClick={() => void removeSaved(track)} title="Hapus dari pustaka" aria-label="Hapus lagu">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>

            {hasLocal && (
              <p className="music-note">
                Lagu lokal tersimpan di folder data aplikasi. Tautan YouTube hanya menyimpan alamatnya —
                audionya diputar lewat pemutar resmi YouTube, tidak pernah disalin ke komputer.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
