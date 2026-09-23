import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACKS, formatClock, mergeTracks, nextTrackIndex, parseYouTubeInput,
  trackFromRow, youtubeThumbnail, youtubeWatchUrl
} from './music.js'

describe('parseYouTubeInput', () => {
  it('menerima berbagai bentuk tautan YouTube', () => {
    expect(parseYouTubeInput('https://www.youtube.com/watch?v=dsuJZx24V_A')).toBe('dsuJZx24V_A')
    expect(parseYouTubeInput('https://m.youtube.com/watch?feature=youtu.be&v=lvuHvXsZPrk')).toBe('lvuHvXsZPrk')
    expect(parseYouTubeInput('https://youtu.be/ZNGqBDRJgvo?t=12')).toBe('ZNGqBDRJgvo')
    expect(parseYouTubeInput('https://www.youtube.com/shorts/abcDEF12345')).toBe('abcDEF12345')
    expect(parseYouTubeInput('https://www.youtube.com/embed/O6Pf-7F06SQ')).toBe('O6Pf-7F06SQ')
    expect(parseYouTubeInput('  abcDEF12345 ')).toBe('abcDEF12345')
  })

  it('menolak bukan tautan video', () => {
    expect(parseYouTubeInput('https://example.com/watch?v=abc')).toBeNull()
    expect(parseYouTubeInput('pendek')).toBeNull()
    expect(parseYouTubeInput('')).toBeNull()
  })
})

describe('formatClock', () => {
  it('menit:detik dengan dua digit', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
    expect(formatClock(-9)).toBe('0:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
  })
})

describe('nextTrackIndex', () => {
  const base = { count: 3, current: 2 }

  it('berputar maju dan mundur', () => {
    expect(nextTrackIndex({ ...base, repeatOne: false, shuffle: false })).toBe(0)
    expect(nextTrackIndex({ ...base, repeatOne: false, shuffle: false, direction: -1 })).toBe(1)
  })

  it('repeat satu menahan lagu yang sama saat maju', () => {
    expect(nextTrackIndex({ ...base, repeatOne: true, shuffle: false })).toBe(2)
    expect(nextTrackIndex({ ...base, repeatOne: true, shuffle: false, direction: -1 })).toBe(1)
  })

  it('acak memilih indeks berbeda bila ada lebih dari satu lagu', () => {
    const picked = nextTrackIndex({ ...base, repeatOne: false, shuffle: true, random: () => 0.5 })
    expect(picked).toBe(1)
    expect(nextTrackIndex({ count: 1, current: 0, repeatOne: false, shuffle: true })).toBe(0)
  })

  it('mengembalikan -1 untuk daftar kosong', () => {
    expect(nextTrackIndex({ count: 0, current: 0, repeatOne: false, shuffle: false })).toBe(-1)
  })
})

describe('mergeTracks', () => {
  const yt = (id: string) => trackFromRow({ id: 1, youtube_id: id, title: `Lagu ${id}`, artist: 'Artis', thumbnail_url: youtubeThumbnail(id) })

  it('menggabungkan server + lokal tanpa duplikat', () => {
    const merged = mergeTracks([yt('aaaaaaaaaaa')], [yt('aaaaaaaaaaa'), yt('bbbbbbbbbbb')], false)
    expect(merged.map((t) => t.youtubeId)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
  })

  it('hanya menampilkan saran bawaan saat daftar masih kosong', () => {
    expect(mergeTracks([], [], true).length).toBe(DEFAULT_TRACKS.length)
    expect(mergeTracks([yt('ccccccccccc')], [], true).map((t) => t.youtubeId)).toEqual(['ccccccccccc'])
    expect(mergeTracks([], [], false).length).toBe(0)
  })

  it('saran tidak pernah menimpa daftar milik pengguna', () => {
    const saved = trackFromRow({ id: 7, youtube_id: DEFAULT_TRACKS[0].youtubeId, title: 'Versi saya', artist: 'X' })
    const merged = mergeTracks([saved], [], true)
    expect(merged).toHaveLength(1)
    expect(merged[0].title).toBe('Versi saya')
    expect(merged[0].trackId).toBe(7)
  })
})

describe('tautan resmi bawaan', () => {
  it('semua saran memakai ID video 11 karakter dan URL sampul', () => {
    expect(DEFAULT_TRACKS.length).toBeGreaterThan(0)
    for (const track of DEFAULT_TRACKS) {
      expect(track.youtubeId).toMatch(/^[A-Za-z0-9_-]{11}$/)
      expect(track.thumbnail).toContain(track.youtubeId as string)
      expect(youtubeWatchUrl(track.youtubeId as string)).toContain(`watch?v=${track.youtubeId}`)
    }
  })
})
