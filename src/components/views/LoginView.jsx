import { useState } from 'react'
import { CheckCircle2, Landmark, LogOut } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { ErrorNotice } from '../ui/ErrorNotice.jsx'
import { request } from '../../api.js'

export function LoginView({ onLogin }) {
  const [email, setEmail] = useState('admin@finova.local')
  const [password, setPassword] = useState('Admin123!')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await request('/auth/login', {
        method: 'POST',
        body: { email, password }
      })
      onLogin(res.user)
    } catch (r) {
      setError(r.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-aside" aria-label="Informasi Finova Akuntansi">
        <div>
          <div className="brand" style={{ padding: 0 }}>
            <span className="brand-mark" aria-hidden="true">
              <Landmark />
            </span>
            Finova
          </div>
          <h1>Akuntansi rapi, belajar jadi mudah &amp; pasti.</h1>
          <p>
            Sistem akuntansi Indonesia berbasis jurnal berpasangan standar, buku besar, dan laporan keuangan
            siap cetak &amp; ekspor Excel profesional.
          </p>
          <div className="feature-list">
            <div className="feature">
              <CheckCircle2 aria-hidden="true" /> Database lokal mandiri (tanpa phpMyAdmin/XAMPP)
            </div>
            <div className="feature">
              <CheckCircle2 aria-hidden="true" /> Jurnal umum klasik dengan indentasi kredit &amp; rekapitulasi
            </div>
            <div className="feature">
              <CheckCircle2 aria-hidden="true" /> Ekspor Excel berstandar korporat &amp; PDF siap cetak
            </div>
            <div className="feature">
              <CheckCircle2 aria-hidden="true" /> Siklus lengkap: Jurnal, Buku Besar, Neraca Saldo, Laba Rugi
            </div>
          </div>
        </div>
        <small>FINOVA · SISTEM AKUNTANSI INDONESIA</small>
      </section>

      <main className="login-form-wrap">
        <form className="login-card" onSubmit={submit} aria-label="Form Masuk Aplikasi">
          <div className="brand" style={{ padding: 0, color: '#0b5a39' }}>
            <span className="brand-mark" aria-hidden="true">
              <Landmark />
            </span>
            Finova
          </div>
          <h2>Masuk Aplikasi</h2>
          <p>Gunakan akun untuk mengakses pembukuan dan praktikum akuntansi Anda.</p>

          <div className="login-form">
            <div className="field">
              <label htmlFor="login-email">ALAMAT EMAIL</label>
              <input
                id="login-email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                autoComplete="email"
                placeholder="nama@email.com"
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">KATA SANDI</label>
              <input
                id="login-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                required
                autoComplete="current-password"
                placeholder="Masukkan kata sandi"
              />
            </div>
            <ErrorNotice error={error} />
            <Button disabled={busy} type="submit">
              {busy ? (
                'Memproses…'
              ) : (
                <>
                  <LogOut aria-hidden="true" /> Masuk ke Finova
                </>
              )}
            </Button>
          </div>

          <div className="demo-note">
            <strong>Akun bawaan sistem:</strong>
            <br />
            admin@finova.local / Admin123!
            <br />
            Database lokal SQLite aktif di <code>database/finova.sqlite</code>.
          </div>
        </form>
      </main>
    </div>
  )
}
