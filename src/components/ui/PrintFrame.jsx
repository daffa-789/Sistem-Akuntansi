import React from 'react'
import { readSigners } from '../../services/downloads.js'
import { dateLabel } from '../../utils/formatters.js'

export function PrintHeader({ title, company, range }) {
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

export function PrintSignatures() {
  const signers = readSigners()
  const columns = [
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
