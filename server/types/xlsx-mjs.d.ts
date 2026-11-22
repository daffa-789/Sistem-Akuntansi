// Paket xlsx 0.18.5 hanya mendeklarasikan tipe untuk specifier "xlsx".
// Server Bun memakai berkas ESM agar tidak memuat modul CJS yang mengarah ke
// dist/cpexcel.js (tidak ikut terpasang), jadi beri tipe yang sama pada subpath.
declare module 'xlsx/xlsx.mjs' {
  export * from 'xlsx'
}
