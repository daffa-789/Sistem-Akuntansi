import React, { useState } from 'react'
import { Button } from '../ui/Button.js'

export interface OnboardingWalkthroughProps {
  done: () => void
}

export function OnboardingWalkthrough({ done }: OnboardingWalkthroughProps): React.JSX.Element {
  const [step, setStep] = useState<number>(0)
  const steps = [
    {
      title: 'Selamat Datang di Finova!',
      text: 'Finova dirancang khusus untuk pembelajaran dan pembukuan akuntansi Indonesia yang rapi, mudah, dan sesuai kaidah akuntansi resmi.'
    },
    {
      title: 'Catat Jurnal & Auto Balance',
      text: 'Catat transaksi berpasangan dengan fitur Auto-Balance dan Template Transaksi Populer (Setoran Modal, Beli Perlengkapan, Gaji, Prive, dll).'
    },
    {
      title: 'Laporan Jurnal Umum Standar',
      text: 'Buka menu "Laporan Jurnal" untuk melihat buku jurnal klasik dengan akun kredit menjorok, kode ref, tabel rekapitulasi, cetak resmi, serta ekspor Excel & PDF.'
    },
    {
      title: 'Buku Besar & Neraca Saldo',
      text: 'Siklus akuntansi lengkap tersedia: dari Jurnal Umum, posting ke Buku Besar per akun, hingga verifikasi keseimbangan di Neraca Saldo.'
    }
  ]
  const s = steps[step]

  return (
    <div className="onboard-overlay" role="dialog" aria-modal="true" aria-label="Panduan Awal Finova">
      <div className="onboard-card">
        <h3>{s.title}</h3>
        <p>{s.text}</p>
        <div className="onboard-footer">
          <span className="muted">
            {step + 1} / {steps.length}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" small onClick={done}>
              Lewati
            </Button>
            <Button
              small
              onClick={() => (step < steps.length - 1 ? setStep(step + 1) : done())}
            >
              {step < steps.length - 1 ? 'Berikutnya' : 'Mulai Belajar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
