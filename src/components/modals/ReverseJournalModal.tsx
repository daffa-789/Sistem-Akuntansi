import React, { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { request } from '../../api.js'
import { money, today } from '../../utils/formatters.js'

export interface ReverseLine {
  debit: number
  credit: number
  memo?: string | null
  code?: string
  account_name?: string
}

export interface ReverseTarget {
  id: number
  voucher_no: string
  entry_date: string
  description: string
  lines: ReverseLine[]
}

export interface ReverseJournalModalProps {
  entry: ReverseTarget
  onClose: () => void
  onReversed?: () => void
  notify: (msg: string, isError?: boolean) => void
}

export function ReverseJournalModal({
  entry,
  onClose,
  onReversed,
  notify
}: ReverseJournalModalProps): React.JSX.Element {
  const [entryDate, setEntryDate] = useState<string>(entry.entry_date || today())
  const [voucherNo, setVoucherNo] = useState<string>(`REV-${entry.voucher_no}`)
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  async function submit(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await request(`/journals/${entry.id}/reverse`, { method: 'POST', body: { entryDate, voucherNo } })
      notify(`Jurnal pembalik ${voucherNo} tersimpan. Jurnal asal ${entry.voucher_no} tetap tercatat.`)
      onReversed?.()
    } catch (r: any) {
      setError(r.message || 'Gagal membuat jurnal pembalik.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Jurnal Pembalik ${entry.voucher_no}`}
      onClose={onClose}
      maxWidth="620px"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={busy || !entryDate.trim()} onClick={submit}>
            {busy ? 'Menyimpan…' : 'Simpan Jurnal Pembalik'}
          </Button>
        </>
      }
    >
      <p className="page-copy" style={{ margin: '0 0 16px', fontSize: 13 }}>
        <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} aria-hidden="true" />
        Mengoreksi jurnal terposting dilakukan dengan menambahkan jurnal pembalik (sisi debit dan kredit
        ditukar), bukan dengan menghapus. Data asli dan jejak audit tetap utuh.
      </p>

      <div className="grid-equal">
        <div className="field">
          <label htmlFor="reverse-date">TANGGAL PEMBALIK</label>
          <input
            id="reverse-date"
            className="input"
            type="date"
            data-autofocus
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="reverse-voucher">NOMOR BUKTI PEMBALIK</label>
          <input
            id="reverse-voucher"
            className="input"
            value={voucherNo}
            onChange={(e) => setVoucherNo(e.target.value)}
          />
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label id="reverse-entry-label">JURNAL YANG DIBALIK</label>
        <div className="muted" style={{ fontSize: 12 }} aria-labelledby="reverse-entry-label">
          {entry.voucher_no} — {entry.description}
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="table" aria-label="Pratinjau jurnal pembalik">
          <thead>
            <tr>
              <th scope="col">Akun</th>
              <th scope="col" className="number">Debit asal</th>
              <th scope="col" className="number">Kredit asal</th>
              <th scope="col" className="number">Debit pembalik</th>
              <th scope="col" className="number">Kredit pembalik</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((line, index) => (
              <tr key={index}>
                <td>
                  {line.code} — {line.account_name}
                </td>
                <td className="number">{Number(line.debit) > 0 ? money(line.debit) : ''}</td>
                <td className="number">{Number(line.credit) > 0 ? money(line.credit) : ''}</td>
                <td className="number">{Number(line.credit) > 0 ? money(line.credit) : ''}</td>
                <td className="number">{Number(line.debit) > 0 ? money(line.debit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ErrorNotice error={error} />
    </Modal>
  )
}
