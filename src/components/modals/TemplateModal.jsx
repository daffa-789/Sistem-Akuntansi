import { Modal } from '../ui/Modal.jsx'
import { Button } from '../ui/Button.jsx'
import { Empty } from '../ui/Empty.jsx'

export function TemplateModal({ templates = [], onUse, onClose }) {
  return (
    <Modal
      title="Pilih Template Transaksi Akuntansi"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Tutup
        </Button>
      }
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b' }}>
        Pilih template untuk mempercepat pencatatan transaksi yang sering muncul dalam praktikum dan soal kasus
        akuntansi.
      </p>

      {!templates.length ? (
        <Empty>Belum ada template transaksi tersimpan.</Empty>
      ) : (
        <div style={{ display: 'grid', gap: 10, maxHeight: 400, overflow: 'auto' }}>
          {templates.map((t) => (
            <div
              key={t.id}
              className="panel"
              style={{ padding: 14, cursor: 'pointer', transition: '.15s' }}
              onClick={() => onUse(t)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{t.name}</strong>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                    {t.description || `${t.lines?.length || 0} baris akun`}
                  </p>
                </div>
                <Button small>Gunakan</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
