// Endpoint pustaka musik — port dari src-rust/httpapi/music.rs.
//
// Lagu lokal disimpan ke <folder-database>/music. Lagu YouTube hanya berupa
// tautan resmi; audio tidak pernah diunduh atau disalin ke disk.
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../errors'
import { dataDirOf } from '../config'
import { intParam, strField, type AppState, type Ctx } from '../http/router'

type AnyRow = Record<string, any>

const MAX_AUDIO_SIZE = 100 * 1024 * 1024 // 100 MB
const ALLOWED_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.weba']

export function musicRoutes(
  state: AppState
): Array<[string, string, (ctx: Ctx) => Response | Promise<Response>]> {
  const db = state.db.connection
  const companyId = state.config.companyId
  const dataDir = dataDirOf(state.config.databaseFile)
  const musicDir = path.join(dataDir, 'music')

  function extractYoutubeId(input: string): string | null {
    const text = input.trim()
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text

    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /\/embed\/([A-Za-z0-9_-]{11})/,
      /\/shorts\/([A-Za-z0-9_-]{11})/,
      /\/live\/([A-Za-z0-9_-]{11})/
    ]
    for (const pattern of patterns) {
      const match = pattern.exec(text)
      if (match) return match[1]
    }
    return null
  }

  async function fetchYoutubeOembed(
    videoId: string
  ): Promise<{ title: string; artist: string; thumbnail: string } | null> {
    const url = `https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${videoId}`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
      if (!response.ok) return null
      const value = (await response.json()) as AnyRow
      const title = typeof value.title === 'string' ? value.title : ''
      if (title === '') return null
      return {
        title,
        artist: typeof value.author_name === 'string' ? value.author_name : 'YouTube',
        thumbnail: typeof value.thumbnail_url === 'string' ? value.thumbnail_url : ''
      }
    } catch {
      // Kegagalan jaringan hanya berarti metadata belum tersedia.
      return null
    }
  }

  function nextPosition(): number {
    const row = db
      .query('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM music_tracks WHERE company_id = ?')
      .get(companyId) as { next: number }
    return row.next
  }

  return [
    ['GET', '/api/music', async () => {
      const rows = db
        .query(
          `SELECT id, kind, title, artist, youtube_id, thumbnail_url, file_name, file_bytes, duration, position, created_at
           FROM music_tracks WHERE company_id = ? ORDER BY position, id`
        )
        .all(companyId) as AnyRow[]

      const tracks = rows.map((row) => {
        const base: AnyRow = {
          id: row.id,
          kind: row.kind,
          title: row.title,
          artist: row.artist ?? '',
          position: row.position,
          addedAt: row.created_at
        }
        if (row.kind === 'LOCAL') {
          base.audioUrl = `/api/music/${row.id}/media`
          base.sizeBytes = row.file_bytes
          base.duration = row.duration ?? null
        } else {
          const vid = row.youtube_id ?? ''
          const thumb = row.thumbnail_url ?? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
          base.youtubeId = vid
          base.thumbnail = thumb
        }
        return base
      })
      return Response.json({ tracks })
    }],

    ['POST', '/api/music/youtube', async (ctx) => {
      const body = await readBodyJson(ctx.req)
      const input = strField(body, 'url') || strField(body, 'youtubeId') || strField(body, 'link')
      const videoId = extractYoutubeId(input)
      if (!videoId) {
        throw AppError.badRequest(
          'Tautan YouTube tidak dikenali. Tempel URL video atau 11 karakter ID-nya.'
        )
      }

      let title = strField(body, 'title')
      let artist = strField(body, 'artist')
      let thumbnail = strField(body, 'thumbnailUrl')

      if (title === '' || artist === '' || thumbnail === '') {
        const oembed = await fetchYoutubeOembed(videoId)
        if (oembed) {
          if (title === '') title = oembed.title
          if (artist === '') artist = oembed.artist
          if (thumbnail === '') thumbnail = oembed.thumbnail
        }
      }
      if (title === '') title = `YouTube ${videoId}`
      if (thumbnail === '') thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

      const info = db.run(
        `INSERT INTO music_tracks (company_id, kind, title, artist, youtube_id, thumbnail_url, added_by, position)
         VALUES (?, 'YOUTUBE', ?, ?, ?, ?, ?, ?)`,
        [companyId, title, artist, videoId, thumbnail, state.operatorId, nextPosition()]
      )
      const id = Number(info.lastInsertRowid)
      const created = db.query('SELECT created_at FROM music_tracks WHERE id = ?').get(id) as {
        created_at: string
      }

      return Response.json(
        {
          track: {
            id,
            kind: 'YOUTUBE',
            title,
            artist,
            youtubeId: videoId,
            thumbnail,
            position: 1,
            addedAt: created.created_at
          }
        },
        { status: 201 }
      )
    }],

    ['POST', '/api/music/open-external', async (ctx) => {
      const body = await readBodyJson(ctx.req)
      const input = strField(body, 'url') || strField(body, 'youtubeId')
      const videoId = extractYoutubeId(input)
      if (!videoId) throw AppError.badRequest('Tautan YouTube tidak dikenali.')
      // URL selalu dibangun ulang dari ID video — tidak ada tautan lain yang bocor.
      const watch = `https://www.youtube.com/watch?v=${videoId}`

      try {
        const command =
          process.platform === 'win32'
            ? ['cmd', '/c', 'start', '', watch]
            : ['xdg-open', watch]
        Bun.spawn({ cmd: command, stdout: 'ignore', stderr: 'ignore' })
        return Response.json({ ok: true, opened: watch })
      } catch {
        return Response.json({ ok: false, url: watch })
      }
    }],

    ['PUT', '/api/music/order', async (ctx) => {
      const body = await readBodyJson(ctx.req)
      const ids = body.ids
      if (!Array.isArray(ids)) {
        throw AppError.badRequest('Urutan pustaka tidak valid.')
      }
      state.db.withTransaction(() => {
        ids.forEach((value, index) => {
          if (typeof value === 'number' && Number.isInteger(value)) {
            db.run('UPDATE music_tracks SET position = ? WHERE id = ? AND company_id = ?', [
              index + 1,
              value,
              companyId
            ])
          }
        })
      })
      return Response.json({ ok: true })
    }],

    ['POST', '/api/music/:id/refresh', async (ctx) => {
      const id = intParam(ctx, 'id')
      const track = db
        .query('SELECT kind, youtube_id FROM music_tracks WHERE id = ? AND company_id = ?')
        .get(id, companyId) as AnyRow | null
      if (!track) throw AppError.notFound('Lagu tidak ditemukan.')
      if (track.kind !== 'YOUTUBE') {
        throw AppError.badRequest('Lagu ini berkas lokal — judulnya diambil dari nama berkas.')
      }

      const videoId = track.youtube_id ?? ''
      const oembed = await fetchYoutubeOembed(videoId)
      if (!oembed) {
        throw AppError.badRequest(
          'Judul video tidak dapat diambil dari YouTube. Periksa koneksi internet.'
        )
      }

      const thumbnail =
        oembed.thumbnail === ''
          ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          : oembed.thumbnail

      db.run(
        'UPDATE music_tracks SET title = ?, artist = ?, thumbnail_url = ? WHERE id = ? AND company_id = ?',
        [oembed.title, oembed.artist, thumbnail, id, companyId]
      )
      const created = db.query('SELECT created_at FROM music_tracks WHERE id = ?').get(id) as {
        created_at: string
      }

      return Response.json({
        track: {
          id,
          kind: 'YOUTUBE',
          title: oembed.title,
          artist: oembed.artist,
          youtubeId: videoId,
          thumbnail,
          addedAt: created.created_at
        }
      })
    }],

    ['POST', '/api/music/local', async (ctx) => {
      const form = await ctx.req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        throw AppError.badRequest('Pilih berkas audio terlebih dahulu.')
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length > MAX_AUDIO_SIZE) {
        throw AppError.badRequest('Ukuran berkas audio melebihi 100 MB.')
      }
      const originalName = file.name || 'audio.mp3'

      const titleRaw = form.get('title')
      const artistRaw = form.get('artist')
      const durationRaw = form.get('duration')
      const title = typeof titleRaw === 'string' && titleRaw.trim() !== '' ? titleRaw.trim() : null
      const artist =
        typeof artistRaw === 'string' && artistRaw.trim() !== '' ? artistRaw.trim() : null
      const duration =
        typeof durationRaw === 'string' && durationRaw.trim() !== ''
          ? Number(durationRaw)
          : null

      const ext = (path.extname(originalName).toLowerCase() || '.mp3').replace(/^\./, '.')
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw AppError.badRequest(
          'Format berkas belum didukung. Pakai MP3, M4A, AAC, OGG, OPUS, WAV, atau FLAC.'
        )
      }

      const finalTitle = title ?? cleanTrackTitle(originalName)
      const finalArtist = artist ?? 'Berkas lokal'

      const info = db.run(
        `INSERT INTO music_tracks (company_id, kind, title, artist, file_bytes, duration, added_by, position)
         VALUES (?, 'LOCAL', ?, ?, ?, ?, ?, ?)`,
        [companyId, finalTitle, finalArtist, bytes.length, duration, state.operatorId, nextPosition()]
      )
      const id = Number(info.lastInsertRowid)
      const created = db.query('SELECT created_at FROM music_tracks WHERE id = ?').get(id) as {
        created_at: string
      }

      const filename = `track-${id}${ext}`
      const targetPath = path.join(musicDir, filename)
      try {
        fs.mkdirSync(musicDir, { recursive: true })
        fs.writeFileSync(targetPath, bytes)
      } catch (err) {
        db.run('DELETE FROM music_tracks WHERE id = ?', [id])
        throw AppError.internal(
          `Gagal menyimpan berkas audio: ${err instanceof Error ? err.message : String(err)}`
        )
      }
      db.run('UPDATE music_tracks SET file_name = ? WHERE id = ?', [filename, id])

      return Response.json(
        {
          track: {
            id,
            kind: 'LOCAL',
            title: finalTitle,
            artist: finalArtist,
            audioUrl: `/api/music/${id}/media`,
            sizeBytes: bytes.length,
            duration,
            position: 1,
            addedAt: created.created_at
          }
        },
        { status: 201 }
      )
    }],

    ['DELETE', '/api/music/:id', async (ctx) => {
      const id = intParam(ctx, 'id')
      const row = db
        .query('SELECT file_name FROM music_tracks WHERE id = ? AND company_id = ?')
        .get(id, companyId) as AnyRow | null
      const affected = db.run('DELETE FROM music_tracks WHERE id = ? AND company_id = ?', [
        id,
        companyId
      ])
      if (affected.changes === 0) throw AppError.notFound('Lagu tidak ditemukan.')

      if (row?.file_name) {
        try {
          fs.rmSync(path.join(musicDir, String(row.file_name)))
        } catch {
          /* berkas mungkin sudah hilang — abaikan */
        }
      }
      return Response.json({ ok: true })
    }],

    ['GET', '/api/music/:id/media', async (ctx) => {
      const id = intParam(ctx, 'id')
      const track = db
        .query('SELECT kind, file_name FROM music_tracks WHERE id = ? AND company_id = ?')
        .get(id, companyId) as AnyRow | null
      if (!track) throw AppError.notFound('Lagu tidak ditemukan.')
      if (track.kind !== 'LOCAL') {
        throw AppError.notFound('Lagu ini hanya berupa tautan YouTube.')
      }
      if (!track.file_name) {
        throw AppError.notFound('Berkas audio lagu ini tidak ada di penyimpanan.')
      }
      const filePath = path.join(musicDir, String(track.file_name))
      if (!fs.existsSync(filePath)) {
        throw AppError.notFound('Berkas audio lagu ini tidak ditemukan di penyimpanan.')
      }

      const file = Bun.file(filePath)
      const fileSize = file.size
      const contentType = file.type || 'audio/mpeg'
      const rangeHeader = ctx.req.headers.get('Range')

      const parsed = parseRangeHeader(rangeHeader, fileSize)
      if (parsed) {
        const [start, end] = parsed
        const length = end - start + 1
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': String(length),
            'Cache-Control': 'private, max-age=86400'
          }
        })
      }

      return new Response(file, {
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
          'Cache-Control': 'private, max-age=86400'
        }
      })
    }]
  ]
}

async function readBodyJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function cleanTrackTitle(name: string): string {
  const base = path.basename(name, path.extname(name)) || 'Audio'
  const replaced = base.replace(/[_-]/g, ' ')
  const cleaned = replaced.replace(/\s+/g, ' ').trim()
  if (cleaned.replace(/[ .\-_]/g, '') === '') return 'Audio'
  return cleaned
}

function parseRangeHeader(range: string | null, fileSize: number): [number, number] | null {
  if (!range || !range.startsWith('bytes=')) return null
  const parts = range.slice('bytes='.length).split('-')
  if (parts.length !== 2) return null
  const start = Number(parts[0].trim())
  const end =
    parts[1].trim() === '' ? fileSize - 1 : Math.min(Number(parts[1].trim()), fileSize - 1)
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start <= end && start < fileSize) return [start, end]
  return null
}
