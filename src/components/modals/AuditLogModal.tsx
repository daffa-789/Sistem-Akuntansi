import React from 'react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { Badge } from '../ui/Badge.js'
import { PageLoading } from '../ui/PageLoading.js'
import { Empty } from '../ui/Empty.js'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { dateLabel } from '../../utils/formatters.js'
import { AuditLog } from '../../../shared/types.js'

export interface AuditLogModalProps {
  journalId: number | string
  onClose: () => void
}

export function AuditLogModal({ journalId, onClose }: AuditLogModalProps): React.JSX.Element {
  const { data, loading } = useLoad<{ logs: (AuditLog & { action_label?: string })[] }>(
    () => request(`/journals/${journalId}/audit`),
    [journalId]
  )

  return (
    <Modal
      title="Riwayat Perubahan Jurnal (Audit Trail)"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      {loading ? (
        <PageLoading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Pengguna</th>
                <th scope="col">Aksi</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs?.map((l, i) => (
                <tr key={i}>
                  <td>{dateLabel(l.created_at)}</td>
                  <td>{l.user_name || 'Sistem'}</td>
                  <td>
                    <Badge status={l.action === 'POSTED' ? 'POSTED' : l.action === 'CREATED' ? 'DRAFT' : 'OPEN'} />{' '}
                    {l.action_label || l.action}
                  </td>
                  <td className="muted">
                    {l.details_json ? JSON.stringify(l.details_json).slice(0, 80) : '-'}
                  </td>
                </tr>
              ))}
              {!data?.logs?.length && (
                <tr>
                  <td colSpan={4}>
                    <Empty>Belum ada riwayat audit untuk jurnal ini.</Empty>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
