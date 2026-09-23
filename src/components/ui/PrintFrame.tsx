import React from 'react'
import { readSigners } from '../../services/downloads.js'
import { dateLabel } from '../../utils/formatters.js'
import { Company } from '../../../shared/types.js'

// Rangka cetak laporan: kop di atas dan blok tanda tangan di bawah. Keduanya
// disembunyikan di layar (lihat .print-head / .print-signatures) dan baru
// muncul pada @media print, supaya mencetak dari peramban menghasilkan
// lembar kerja yang sama lengkapnya dengan ekspor Excel/PDF dari server.

export interface PrintHeaderProps {
  title: string
  company?: Company | null
  range?: { from: string; to: string }
}

export function PrintHeader({ title, company, range }: PrintHeaderProps): React.JSX.Element {
  const identitas = [company?.address, company?.phone, company?.email].filter(Boolean).join(' · ')
  return (
    <div className="print-head">
      <h2>{company?.name || 'Perusahaan'}</h2>
      <p>{title}</p>
      {range?.from && <p>Periode {dateLabel(range.from)} — {dateLabel(range.to)}</p>}
      {identitas && <p className="print-head-sub">{identitas}</p>}
    </div>
  )
}

export function PrintSignatures(): React.JSX.Element {
  const signers = readSigners()
  const columns: [string, string | undefined][] = [
    ['Dibuat oleh', signers.maker],
    ['Diperiksa oleh', signers.checker],
    ['Disetujui oleh', signers.approver]
  ]

  return (
    <div className="print-signatures">
      {columns.map(([title, name]) => (
        <div className="sig-col" key={title}>
          <div className="sig-space" />
          <div className="sig-line">{name || ' '}</div>
          <div className="sig-title">{title}</div>
        </div>
      ))}
    </div>
  )
}
