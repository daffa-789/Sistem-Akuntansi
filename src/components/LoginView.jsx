import React, { useState } from 'react'
import { LockKeyhole, ShieldCheck, Users } from 'lucide-react'
import { Button } from './ui/Button.jsx'
import { request } from '../api.js'

// Sama dengan DEMO_USERS di server/auth.ts. Sandi demo dipakai bersama agar
// pengguna bisa mencoba setiap peran dalam pemisahan tugas BAB V.pptx
// (SDM/penggajian, penjualan, gudang, penagihan, kas, dan pengadaan).
const DEMO_ACCOUNTS = [
  ['Administrator', 'admin@finova.local', 'ADMIN'],
  ['Bagian SDM', 'sdm@finova.local', 'SDM'],
  ['Bagian Penggajian', 'penggajian@finova.local', 'PENGGAJIAN'],
  ['Bagian Akuntansi', 'akuntansi@finova.local', 'AKUNTANSI'],
  ['Bagian Keuangan', 'keuangan@finova.local', 'KEUANGAN'],
  ['Manajer SDM', 'manajer-sdm@finova.local', 'SDM_MANAGER'],
  ['Bagian Penjualan', 'penjualan@finova.local', 'PENJUALAN'],
  ['Bagian Gudang', 'gudang@finova.local', 'GUDANG'],
  ['Bagian Pembelian', 'pembelian@finova.local', 'PEMBELIAN']
]
const DEMO_PASSWORD = 'finova2026'

export function LoginView({ onLogin }) {
  const [email, setEmail] = useState('admin@finova.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const payload = await request('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      })
      onLogin(payload.user)
    } catch (err) {
      setError(err.message || 'Login gagal.')
    } finally {
      setBusy(false)
    }
  }

  function choose(accountEmail) {
    setEmail(accountEmail)
    setPassword(DEMO_PASSWORD)
    setError('')
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><img src="/favicon.png" alt="" /><strong>Finova</strong></div>
        <h1>Masuk ke sistem penggajian</h1>
        <p className="login-intro">
          Setiap peran memiliki kewenangan berbeda sesuai pengendalian internal siklus SDM.
        </p>

        <label className="cycle-field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="cycle-field">
          <span>Kata sandi</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error && <p className="login-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>
          <LockKeyhole size={15} /> {busy ? 'Memeriksa…' : 'Masuk'}
        </Button>

        <div className="login-demo">
          <p><ShieldCheck size={14} /> Akun demo — kata sandi <code>{DEMO_PASSWORD}</code></p>
          <div className="login-demo-list">
            {DEMO_ACCOUNTS.map(([label, accountEmail, role]) => (
              <button
                type="button"
                key={accountEmail}
                className={email === accountEmail ? 'active' : ''}
                onClick={() => choose(accountEmail)}
                title={`Masuk sebagai ${label}`}
              >
                <Users size={13} /> <span>{label}</span><small>{role}</small>
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  )
}
