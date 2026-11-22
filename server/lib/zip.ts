// Penulis ZIP minimal (metode STORED, tanpa kompresi) — cukup untuk membuat
// berkas .xlsx yang valid. Ditulis tangan supaya ekspor xlsx tidak perlu
// dependensi npm tambahan (proyek ini sengaja menjaga node_modules ringan).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff
  }
  return out
}

function putU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function putU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

/** Bangun arsip zip dari daftar entri (semua disimpan tanpa kompresi). */
export function zipStore(entries: ZipEntry[]): Uint8Array {
  // Tanggal/waktu DOS tetap — cukup valid, dan membuat keluaran deterministik.
  const dosTime = 0
  const dosDate = 0x5856 // 2019-01-01

  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encodeLatin1(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + nameBytes.length + size)
    const localView = new DataView(local.buffer)
    putU32(localView, 0, 0x04034b50) // tanda tangan local file header
    putU16(localView, 4, 20) // versi minimum
    putU16(localView, 6, 0) // flag
    putU16(localView, 8, 0) // metode: stored
    putU16(localView, 10, dosTime)
    putU16(localView, 12, dosDate)
    putU32(localView, 14, crc)
    putU32(localView, 18, size)
    putU32(localView, 22, size)
    putU16(localView, 26, nameBytes.length)
    putU16(localView, 28, 0) // extra
    local.set(nameBytes, 30)
    local.set(entry.data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    putU32(centralView, 0, 0x02014b50) // tanda tangan central directory
    putU16(centralView, 4, 20) // versi pembuat
    putU16(centralView, 6, 20) // versi minimum
    putU16(centralView, 8, 0)
    putU16(centralView, 10, 0)
    putU16(centralView, 12, dosTime)
    putU16(centralView, 14, dosDate)
    putU32(centralView, 16, crc)
    putU32(centralView, 20, size)
    putU32(centralView, 24, size)
    putU16(centralView, 28, nameBytes.length)
    putU16(centralView, 30, 0) // extra
    putU16(centralView, 32, 0) // comment
    putU16(centralView, 34, 0) // disk
    putU16(centralView, 36, 0) // internal attrs
    putU32(centralView, 38, 0) // external attrs
    putU32(centralView, 42, offset)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  let centralSize = 0
  for (const c of centrals) centralSize += c.length

  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  putU32(endView, 0, 0x06054b50) // EOCD
  putU16(endView, 8, entries.length)
  putU16(endView, 10, entries.length)
  putU32(endView, 12, centralSize)
  putU32(endView, 16, offset)

  const total =
    offset + centralSize + end.length
  const out = new Uint8Array(total)
  let pos = 0
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, pos)
    pos += chunk.length
  }
  return out
}
