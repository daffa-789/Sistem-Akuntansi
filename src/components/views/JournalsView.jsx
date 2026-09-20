import { useState } from 'react'
import { Plus, RefreshCw, RotateCcw, Upload } from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Badge } from '../ui/Badge.jsx'
import { PageLoading } from '../ui/PageLoading.jsx'
import { Empty } from '../ui/Empty.jsx'
import { ErrorNotice } from '../ui/ErrorNotice.jsx'
import { JournalModal } from '../modals/JournalModal.jsx'
import { ExcelImportModal } from '../modals/ExcelImportModal.jsx'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { apiPath, dateLabel, firstDay, money, today } from '../../utils/formatters.js'

export function JournalsView({ accounts = [], notify }) {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const [modal, setModal] = useState(null)
  const [showImport, setShowImport] = useState(false)

  const { data, loading, error, reload } = useLoad(
    () => request(apiPath('/journals', range)),
    [range.from, range.to]
  )

  async function edit(id) {
    try {
      const res = await request(`/journals/${id}`)
      setModal(res.entry)
    } catch (r) {
      notify(r.message, true)
    }
  }

  async function reverse(id, vn) {
    if (
      !window.confirm(
        `Batalkan jurnal ${vn}? Jurnal pembalik otomatis dibuat dengan tanggal hari ini.`
      )
    ) {
      return
    }
    try {
      await request(`/journals/${id}/reverse`, {
        method: 'POST',
        body: { entryDate: today() }
      })
      notify(`Jurnal ${vn} berhasil dibalik.`)
      reload()
    } catch (r) {
      notify(r.message, true)
    }
  }

  return (
    <>
      <div className="toolbar">
        <div>
          <h1 className="page-title">Pencatatan Jurnal</h1>
          <p className="page-copy">
            Kelola transaksi harian, simpan draft jurnal, posting ke buku besar, atau impor dari Excel.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={16} /> Impor dari Excel
          </Button>
          <Button onClick={() => setModal({})}>
            <Plus size={16} /> Catat Jurnal Baru
          </Button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="filter-row">
          <div className="field">
            <label htmlFor="journals-from">DARI TANGGAL</label>
            <input
              id="journals-from"
              className="input"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="journals-to">SAMPAI TANGGAL</label>
            <input
              id="journals-to"
              className="input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <Button variant="secondary" small onClick={reload} aria-label="Muat ulang daftar jurnal">
            <RefreshCw size={14} aria-hidden="true" /> Muat Ulang
          </Button>
        </div>
      </div>

      <ErrorNotice error={error} />

      {loading ? (
        <PageLoading message="Memuat daftar transaksi jurnal…" />
      ) : (
        <section className="panel panel-tight" aria-label="Daftar Jurnal Transaksi">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Tanggal</th>
                  <th scope="col">No. Bukti</th>
                  <th scope="col">Keterangan</th>
                  <th scope="col">Sumber</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="number">
                    Total Nilai
                  </th>
                  <th scope="col" aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {data?.entries?.map((e) => (
                  <tr
                    key={e.id}
                    className={e.status === 'DRAFT' ? 'clickable' : ''}
                    onClick={() => e.status === 'DRAFT' && edit(e.id)}
                  >
                    <td>{dateLabel(e.entry_date)}</td>
                    <td>
                      <strong>{e.voucher_no}</strong>
                    </td>
                    <td>{e.description}</td>
                    <td className="muted">
                      {e.source === 'IMPORT'
                        ? 'Impor Excel'
                        : e.source === 'REVERSAL'
                        ? 'Pembalik'
                        : 'Manual'}
                    </td>
                    <td>
                      <Badge status={e.status} />
                    </td>
                    <td className="number">{money(e.total_debit)}</td>
                    <td>
                      {e.status === 'POSTED' && (
                        <button
                          type="button"
                          className="icon-button"
                          title={`Balikkan jurnal ${e.voucher_no}`}
                          aria-label={`Balikkan jurnal ${e.voucher_no}`}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            reverse(e.id, e.voucher_no)
                          }}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.entries?.length && (
              <Empty>
                Belum ada jurnal pada rentang tanggal ini. Klik &quot;Catat Jurnal Baru&quot; untuk memulai.
              </Empty>
            )}
          </div>
        </section>
      )}

      {modal !== null && (
        <JournalModal
          accounts={accounts}
          entry={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            reload()
          }}
          notify={notify}
        />
      )}

      {showImport && (
        <ExcelImportModal
          onClose={() => setShowImport(false)}
          notify={notify}
          onImported={reload}
        />
      )}
    </>
  )
}
