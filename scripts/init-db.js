import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()
const dbName = process.env.DB_NAME || 'finova_akuntansi'
const host = process.env.DB_HOST || '127.0.0.1'
const port = Number(process.env.DB_PORT || 3306)

try {
  const connection = await mysql.createConnection({
    host, port, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', multipleStatements: true
  })
  const sql = fs.readFileSync(path.resolve('database/schema.sql'), 'utf8').replaceAll('`finova_akuntansi`', `\`${dbName}\``)
  await connection.query(sql)
  await connection.end()
  console.log(`Database ${dbName} siap digunakan.`)
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.error(`MySQL tidak dapat dihubungi di ${host}:${port}. Jalankan MySQL dari XAMPP Control Panel, lalu ulangi perintah ini.`)
    process.exitCode = 1
  } else {
    console.error(`Inisialisasi database gagal: ${error.message}`)
    process.exitCode = 1
  }
}
