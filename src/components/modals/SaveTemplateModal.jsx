import { useState } from 'react'
import { Modal } from '../ui/Modal.jsx'
import { Button } from '../ui/Button.jsx'
import { ErrorNotice } from '../ui/ErrorNotice.jsx'
import { request } from '../../api.js'

export function SaveTemplateModal({ form, onClose, notify, onSaved }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setBusy(true)
    setError('')
    const lines = form.lines
      .filter((l) => l.account_id)
      .map((l) => ({
        account_id: Number(l.account_id),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        memo: l.memo
      }))

    try {
      await request('/templates', {
        method: 'POST',
        body: { name, description: desc, lines }
      })
      notify(`Template "${name}" berhasil disimpan.`)
      onSaved?.()
      onClose?.()
    } catch (r) {
      setError(r.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Simpan Sebagai Template Baru"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={busy || !name.trim()} onClick={save}>
            {busy ? 'Menyimpan…' : 'Simpan Template'}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="template-name">NAMA TEMPLATE</label>
        <input
          id="template-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Contoh: Pembayaran Biaya Iklan & Promosi"
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="template-desc">KETERANGAN</label>
        <input
          id="template-desc"
          className="input"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Deskripsi singkat template ini"
        />
      </div>
      <ErrorNotice error={error} />
    </Modal>
  )
}
