import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const dbFile = path.resolve('database/finova.sqlite')

if (!fs.existsSync(dbFile)) {
  console.log('Database belum ada. Jalankan npm run dev atau npx tsx scripts/init-db.ts terlebih dahulu.')
  process.exit(0)
}

const db: Database.Database = new Database(dbFile)
db.pragma('foreign_keys = OFF')

console.log('=== STATUS DATABASE SEBELUM PEMBERSIHAN ===')
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
for (const t of tables) {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number }).c
  console.log(`- ${t.name}: ${count} baris`)
}

console.log('\nMembersihkan data transaksi & riwayat...')
db.prepare('DELETE FROM journal_lines').run()
db.prepare('DELETE FROM journal_entries').run()
db.prepare('DELETE FROM audit_logs').run()
db.prepare('DELETE FROM import_batches').run()
db.prepare('DELETE FROM journal_templates').run()

// Reset auto-increment sequence
try {
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('journal_entries', 'journal_lines', 'audit_logs', 'import_batches', 'journal_templates')").run()
} catch {
  // sqlite_sequence might be empty or not yet created
}

db.pragma('foreign_keys = ON')
db.prepare('VACUUM').run()

console.log('\n=== STATUS DATABASE SETELAH PEMBERSIHAN ===')
for (const t of tables) {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get() as { c: number }).c
  console.log(`- ${t.name}: ${count} baris`)
}

db.close()
console.log('\nDatabase finova.sqlite sekarang BERSIH KOSONGAN (0 transaksi).')
