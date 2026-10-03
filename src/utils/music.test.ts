import { describe, expect, it } from 'vitest'
import {
  audioAcceptValue, formatBytes, formatClock, isAudioFile,
  nextTrackIndex, parseYouTubeInput, trackSourceLabel, type Track
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

describe('isAudioFile', () => {
  it('menerima format audio yang didukung', () => {
    expect(isAudioFile('lagu.mp3')).toBe(true)
    expect(isAudioFile('Album/Musik Malam.M4A')).toBe(true)
    expect(isAudioFile('suara.opus')).toBe(true)
    expect(isAudioFile('tanpa-nama.FLAC')).toBe(true)
  })

  it('menolak berkas yang bukan audio', () => {
    expect(isAudioFile('laporan.xlsx')).toBe(false)
    expect(isAudioFile('video.mp4')).toBe(false)
    expect(isAudioFile('tanpa-ekstensi')).toBe(false)
  })
})

describe('audioAcceptValue', () => {
  it('memuat seluruh ekstensi yang didukung', () => {
    const value = audioAcceptValue
    expect(value).toContain('.mp3')
    expect(value).toContain('.flac')
    expect(value).toContain('.opus')
  })
})

describe('formatBytes', () => {
  it('menampilkan ukuran dalam satuan yang terbaca', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('trackSourceLabel', () => {
  it('membedakan lagu lokal dari tautan YouTube', () => {
    const local = { id: 1, kind: 'LOCAL', title: 'A', artist: 'Berkas lokal', position: 1 } as Track
    const youtube = { id: 2, kind: 'YOUTUBE', title: 'B', artist: 'Kanal Resmi', position: 2 } as Track
    expect(trackSourceLabel(local)).toBe('Berkas lokal')
    expect(trackSourceLabel(youtube)).toBe('Kanal Resmi')
  })
})
