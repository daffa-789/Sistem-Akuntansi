import React, { useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet } from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { download, request } from '../../api.js'

export interface ExcelImportModalProps {
  onClose: () => void
  notify: (msg: string, isError?: boolean) => void
  onImported?: () => void
}

export interface PreviewData {
  batchId?: number
  valid: boolean
  totalRows: number
  entries: { voucherNo: string; entryDate: string; description: string; lineCount: number }[]
  errors: string[]
}

export function ExcelImportModal({ onClose, notify, onImported }: ExcelImportModalProps): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [preview, setPreview] = useState<PreviewData | null>(null)

  async function handleDownloadTemplate() {
    try {
      await download('/imports/template', 'Finova_Template_Impor_Jurnal.xlsx')
      notify('Template Excel berhasil diunduh.')
    } catch (err: any) {
      notify(`Gagal mengunduh template: ${err.message}`, true)
    }
  }

  async function handlePreview() {
    if (!file) return
    setBusy(true)
    setError('')
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await request<PreviewData>('/imports/preview', {
        method: 'POST',
        body: formData
      })
      setPreview(res)
    } catch (err: any) {
      setError(err.message || 'Gagal memvalidasi berkas.')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm() {
    if (!preview?.batchId) return
    setBusy(true)
    setError('')

    try {
      const res = await request<{ ok: boolean; posted: number }>(`/imports/${preview.batchId}/confirm`, {
        method: 'POST'
      })
      notify(`${res.posted} transaksi jurnal berhasil diimpor & diposting.`)
      onImported?.()
      onClose?.()
    } catch (err: any) {
      setError(err.message || 'Gagal memposting transaksi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Impor Transaksi Jurnal dari Excel"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          {!preview?.valid ? (
            <Button disabled={!file || busy} onClick={handlePreview}>
              {busy ? 'Memeriksa Berkas…' : 'Validasi Berkas Excel'}
            </Button>
          ) : (
            <Button disabled={busy} onClick={handleConfirm}>
              <CheckCircle2 size={16} /> {busy ? 'Memposting…' : 'Konfirmasi & Posting ke Jurnal'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: '#64748b' }}>
          Unggah file Excel (<strong>.xlsx</strong>) yang berisi daftar transaksi jurnal. Format harus sesuai
          dengan template standar Finova (kolom Tanggal, No. Bukti, Kode Akun, Debit, Kredit, Keterangan).
        </p>
        <Button variant="secondary" small onClick={handleDownloadTemplate}>
          <Download size={14} /> Unduh Format Template Excel (.xlsx)
        </Button>
      </div>

      {!preview ? (
        <div className="upload-zone">
          <FileSpreadsheet aria-hidden="true" />
          <div>
            <strong>Pilih berkas Excel (.xlsx) dari komputer Anda</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Maksimal ukuran berkas: 10 MB
            </div>
          </div>
          <input
            id="excel-file-input"
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            aria-label="Pilih berkas Excel (.xlsx)"
          />
          {file && (
            <div style={{ marginTop: 10, fontWeight: 700, color: '#0e7145', fontSize: 13 }}>
              Berkas terpilih: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </div>
          )}
        </div>
      ) : (
        <div>
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: preview.valid ? '#f0fdf4' : '#fff1f2',
              border: `1px solid ${preview.valid ? '#bbf7d0' : '#fecdd3'}`,
              marginBottom: 14
            }}
          >
            <strong>
              {preview.valid
                ? `✓ Siap diimpor: ${preview.entries?.length || 0} transaksi jurnal valid ditemukan (${preview.totalRows} baris)`
                : `⚠️ Terdapat ${preview.errors?.length || 0} kesalahan validasi pada berkas Excel Anda`}
            </strong>
          </div>

          {preview.errors?.length > 0 && (
            <div style={{ maxHeight: 180, overflow: 'auto', marginBottom: 14 }}>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#b91c1c', fontSize: 12 }}>
                {preview.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.entries?.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">No. Bukti</th>
                    <th scope="col">Tanggal</th>
                    <th scope="col">Keterangan</th>
                    <th scope="col">Jumlah Baris</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((e, idx) => (
                    <tr key={idx}>
                      <td>{e.voucherNo}</td>
                      <td>{e.entryDate}</td>
                      <td>{e.description}</td>
                      <td>{e.lineCount} baris</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ErrorNotice error={error} />
    </Modal>
  )
}
