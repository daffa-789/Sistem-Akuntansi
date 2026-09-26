import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Jaring pengaman sistem desain. Cacat nyata yang pernah terjadi di sini:
// warna hex di inline style komponen tidak mengikuti token tema, sehingga
// teks bisa sehitam latar (Jurnal Umum). Mode gelap sudah dilepas, jadi
// tidak ada lagi aturan body.dark yang perlu diuji.

const ROOT = process.cwd()

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx$/.test(name) ? [full] : []
  })
}

// Bilah samping selalu hijau, jadi warnanya memang sengaja tertulis di komponen.
// Selain itu, warna harus datang dari token.
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
})
