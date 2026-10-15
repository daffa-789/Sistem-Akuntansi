import { useCallback, useEffect, useRef, useState } from 'react'

const API_SRC = 'https://www.youtube.com/iframe_api'

let apiLoader = null

function loadApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Hanya berjalan di peramban.'))
  if (apiLoader) return apiLoader
  apiLoader = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT)
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous()
      resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onerror = () => {
      apiLoader = null
      reject(new Error('Pemutar YouTube tidak dapat dimuat. Periksa koneksi internet.'))
    }
    document.head.appendChild(script)
  })
  return apiLoader
}

export function errorText(code) {
  switch (code) {
    case 2:
      return 'Tautan video tidak valid.'
    case 5:
      return 'Video tidak dapat diputar di peramban ini.'
    case 100:
      return 'Video sudah dihapus atau tidak dibuat publik.'
    case 101:
    case 150:
      return 'Pemilik video menonaktifkan penyematan. Putar lewat tombol "Buka di YouTube" atau pakai berkas lokal.'
    default:
      return 'Pemutar YouTube mengalami gangguan.'
  }
}

export function useYouTubePlayer(hostId) {
  const playerRef = useRef(null)
  const timerRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [current, setCurrent] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const volumeRef = useRef(70)

  useEffect(() => {
    let cancelled = false
    let mount = null

    loadApi()
      .then((YT) => {
        if (cancelled || !YT || !document.getElementById(hostId)) return
        mount = document.createElement('div')
        mount.id = `${hostId}-frame`
        document.getElementById(hostId)?.appendChild(mount)

        const options = {
          height: '1',
          width: '1',
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => {
              if (cancelled) return
              setReady(true)
              setDuration(Number(playerRef.current?.getDuration?.() || 0))
              playerRef.current?.setVolume?.(volumeRef.current)
            },
            onStateChange: (event) => {
              const state = event?.data
              const PLAYING = 1
              const PAUSED = 2
              const ENDED = 0
              if (state === PLAYING) {
                setPlaying(true)
                setError('')
                setDuration(Number(playerRef.current?.getDuration?.() || 0))
              } else if (state === PAUSED) setPlaying(false)
              else if (state === ENDED) {
                setPlaying(false)
                window.dispatchEvent(new CustomEvent('finova:track-ended'))
              }
            },
            onError: (event) => {
              setError(errorText(Number(event?.data)))
              setPlaying(false)
            }
          }
        }
        if (pending?.videoId) options.videoId = pending.videoId
        playerRef.current = new YT.Player(String(mount.id), options)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError?.message || String(loadError))
      })

    return () => {
      cancelled = true
      if (timerRef.current) window.clearInterval(timerRef.current)
      try {
        playerRef.current?.destroy?.()
      } catch {}
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId])

  useEffect(() => {
    if (!ready) return
    if (playing && !timerRef.current) {
      timerRef.current = window.setInterval(() => {
        const value = Number(playerRef.current?.getCurrentTime?.() || 0)
        setCurrent(value)
      }, 500)
    }
    if (!playing && timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [playing, ready])

  const load = useCallback((videoId, autoplay) => {
    const player = playerRef.current
    if (!player || typeof player.loadVideoById !== 'function') {
      setPending({ videoId, autoplay })
      return
    }
    setError('')
    setCurrent(0)
    if (autoplay) player.loadVideoById(videoId)
    else {
      player.cueVideoById(videoId)
      setPlaying(false)
    }
    window.setTimeout(() => setDuration(Number(player.getDuration?.() || 0)), 900)
  }, [])

  useEffect(() => {
    if (!ready || !pending) return
    load(pending.videoId, pending.autoplay)
    setPending(null)
  }, [ready, pending, load])

  const play = useCallback(() => {
    playerRef.current?.playVideo?.()
  }, [])

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo?.()
  }, [])

  const seek = useCallback((seconds) => {
    playerRef.current?.seekTo?.(seconds, true)
    setCurrent(seconds)
  }, [])

  const setVolume = useCallback((value) => {
    volumeRef.current = Math.max(0, Math.min(100, value))
    playerRef.current?.setVolume?.(volumeRef.current)
  }, [])

  return { ready, playing, duration, current, error, load, play, pause, seek, setVolume }
}
