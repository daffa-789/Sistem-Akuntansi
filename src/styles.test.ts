import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Jaring pengaman sistem desain. Dua cacat nyata yang pernah terjadi di sini:
//  1) warna hex di inline style komponen tidak berbalik pada mode gelap,
//     sehingga teks jadi sehitam latar (Jurnal Umum, mode gelap);
//  2) token di :root yang nilainya memakai var() lain terkunci lebih awal,
//     jadi ikut memakai nilai terang walau body.dark menimpa token dasarnya
//     (garis bawah topbar tetap putih di mode gelap).

const ROOT = process.cwd()
const CSS = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(name) ? [full] : []
  })
}

// Bilah samping selalu hijau pada kedua mode, jadi warnanya memang sengaja
// tertulis di komponen. Selain itu, warna harus datang dari token.
const FIXED_COLOR_SURFACES = ['components/layout/AppShell.tsx']

const HEX_IN_STYLE = /(color|background|backgroundColor|background-color|borderColor|border-color)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/g

describe('sistem desain', () => {
  it('tidak menetapkan warna hex lewat inline style pada komponen', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(ROOT, 'src/components'))) {
      const rel = relative(join(ROOT, 'src'), file).replace(/\\/g, '/')
      if (FIXED_COLOR_SURFACES.includes(rel)) continue
      const matches = readFileSync(file, 'utf8').match(HEX_IN_STYLE) || []
      if (matches.length) offenders.push(`${rel}: ${[...new Set(matches)].join(', ')}`)
    }
    expect(offenders, 'pindahkan warna ke kelas berbasis token (lihat .t-debit, .muted, dsb.)').toEqual([])
  })

  it('token di :root tidak mengunci var() yang ditimpa mode gelap', () => {
    const block = (selector: string) => {
      const start = CSS.indexOf(selector)
      expect(start, `blok ${selector} tidak ditemukan`).toBeGreaterThan(-1)
      const open = CSS.indexOf('{', start)
      const close = CSS.indexOf('}', open)
      return CSS.slice(open + 1, close)
    }
    const declared = (text: string): Map<string, string> => {
      const out = new Map<string, string>()
      for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim())
      return out
    }

    const light = declared(block(':root'))
    const dark = declared(block('body.dark'))
    const offenders: string[] = []

    for (const [token, value] of light) {
      if (!value.includes('var(') || dark.has(token)) continue
      for (const ref of value.matchAll(/var\((--[\w-]+)/g)) {
        if (dark.has(ref[1])) {
          offenders.push(`${token}: ${value} memakai ${ref[1]} yang ditimpa body.dark`)
        }
      }
    }

    expect(offenders, 'deklarasikan ulang token turunan di body.dark, atau tulis nilainya langsung').toEqual([])
  })
})
