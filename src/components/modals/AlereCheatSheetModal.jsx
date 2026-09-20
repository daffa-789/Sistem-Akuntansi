import { Modal } from '../ui/Modal.jsx'
import { Button } from '../ui/Button.jsx'

export function AlereCheatSheetModal({ onClose }) {
  return (
    <Modal
      title="Panduan Aturan Saldo Normal (ALERE)"
      onClose={onClose}
      footer={<Button onClick={onClose}>Mengerti, Tutup Panduan</Button>}
    >
      <p style={{ margin: '0 0 14px', fontSize: 13, color: '#64748b' }}>
        Pedoman baku pencatatan Debit dan Kredit berpasangan dalam akuntansi. Berdasarkan Persamaan Dasar:{' '}
        <strong>Aset = Liabilitas + Ekuitas</strong>.
      </p>

      <div className="alere-grid">
        <div className="alere-item">
          <strong>1. Aset (Harta / Aktiva)</strong>
          <div className="alere-rule">
            • Bertambah: <span className="alere-badge-debit">DEBIT (+)</span>
            <br />
            • Berkurang: <span className="alere-badge-credit">KREDIT (-)</span>
            <br />
            • Saldo Normal: <strong>DEBIT</strong>
            <br />
            <small className="muted">Contoh: Kas, Bank, Piutang, Perlengkapan, Peralatan.</small>
          </div>
        </div>

        <div className="alere-item">
          <strong>2. Liabilitas (Kewajiban / Utang)</strong>
          <div className="alere-rule">
            • Bertambah: <span className="alere-badge-credit">KREDIT (+)</span>
            <br />
            • Berkurang: <span className="alere-badge-debit">DEBIT (-)</span>
            <br />
            • Saldo Normal: <strong>KREDIT</strong>
            <br />
            <small className="muted">Contoh: Utang Usaha, Utang Gaji, Utang Bank.</small>
          </div>
        </div>

        <div className="alere-item">
          <strong>3. Ekuitas (Modal Pemilik)</strong>
          <div className="alere-rule">
            • Bertambah: <span className="alere-badge-credit">KREDIT (+)</span>
            <br />
            • Berkurang: <span className="alere-badge-debit">DEBIT (-)</span>
            <br />
            • Saldo Normal: <strong>KREDIT</strong>
            <br />
            <small className="muted">Contoh: Modal Pemilik, Laba Ditahan.</small>
          </div>
        </div>

        <div className="alere-item">
          <strong>4. Pendapatan (Revenue)</strong>
          <div className="alere-rule">
            • Bertambah: <span className="alere-badge-credit">KREDIT (+)</span>
            <br />
            • Berkurang: <span className="alere-badge-debit">DEBIT (-)</span>
            <br />
            • Saldo Normal: <strong>KREDIT</strong>
            <br />
            <small className="muted">Contoh: Pendapatan Jasa, Penjualan Barang.</small>
          </div>
        </div>

        <div className="alere-item">
          <strong>5. Beban (Expense / Biaya)</strong>
          <div className="alere-rule">
            • Bertambah: <span className="alere-badge-debit">DEBIT (+)</span>
            <br />
            • Berkurang: <span className="alere-badge-credit">KREDIT (-)</span>
            <br />
            • Saldo Normal: <strong>DEBIT</strong>
            <br />
            <small className="muted">Contoh: Beban Gaji, Beban Sewa, Beban Listrik.</small>
          </div>
        </div>

        <div className="alere-item">
          <strong>6. Prive (Drawings / Penarikan)</strong>
          <div className="alere-rule">
            • Bertambah: <span className="alere-badge-debit">DEBIT (+)</span>
            <br />
            • Berkurang: <span className="alere-badge-credit">KREDIT (-)</span>
            <br />
            • Saldo Normal: <strong>DEBIT</strong>
            <br />
            <small className="muted">Prive mengurangi nilai modal pemilik perusahaan.</small>
          </div>
        </div>
      </div>

      <div
        style={{
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          padding: 12,
          borderRadius: 10,
          fontSize: 12,
          color: '#065f46',
          marginTop: 10
        }}
      >
        💡 <strong>Jembatan Keledai (Rumus Cepat Anak Akuntansi):</strong>
        <br />
        Ingat kata <strong>&quot;ADE&quot;</strong> (<strong>A</strong>set, <strong>D</strong>rawings/Prive,{' '}
        <strong>E</strong>xpense/Beban) bertambah di <strong>DEBIT</strong>. Sisanya (Liabilitas, Ekuitas, Pendapatan)
        bertambah di <strong>KREDIT</strong>!
      </div>
    </Modal>
  )
}
