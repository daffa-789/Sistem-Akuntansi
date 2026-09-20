import { Modal } from '../ui/Modal.jsx'
import { Button } from '../ui/Button.jsx'
import { Badge } from '../ui/Badge.jsx'
import { PageLoading } from '../ui/PageLoading.jsx'
import { Empty } from '../ui/Empty.jsx'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { dateLabel } from '../../utils/formatters.js'

export function AuditLogModal({ journalId, onClose }) {
  const { data, loading } = useLoad(() => request(`/journals/${journalId}/audit`), [journalId])

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
                    {l.action_label}
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
