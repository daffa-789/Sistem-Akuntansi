import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  History,
  Layers,
  Plus,
  Send,
  X,
  Zap
} from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { FieldWarning } from '../ui/FieldWarning.js'
import { AuditLogModal } from './AuditLogModal.js'
import { useLoad } from '../../hooks/useLoad.js'
import { request } from '../../api.js'
import { formatNum, parseNum, money, today, GL } from '../../utils/formatters.js'
import { validateJournal, JournalFormInput, JournalLineInput } from '../../utils/validators.js'
import { Account, AccountGroup, JournalEntry, JournalLine } from '../../../shared/types.js'

export interface JournalModalProps {
  accounts?: Account[]
  entry?: (JournalEntry & { lines?: JournalLine[] }) | null
  onClose: () => void
  onSaved?: () => void
  notify: (msg: string, isError?: boolean) => void
}



export function JournalModal({
  accounts = [],
  entry,
  onClose,
  onSaved,
  notify
}: JournalModalProps): React.JSX.Element {
  const emptyLine = (): JournalLineInput => ({ account_id: '', debit: '', credit: '', memo: '' })

  const isExistingMulti = Boolean(entry && entry.lines && entry.lines.length > 2)

  const [mode, setMode] = useState<'quick' | 'multi'>(isExistingMulti ? 'multi' : 'quick')

  const [form, setForm] = useState<JournalFormInput>(() => ({
    voucherNo: entry?.voucher_no || '',
    entryDate: entry?.entry_date?.slice(0, 10) || today(),
    description: entry?.description || '',
    lines:
      entry?.lines?.map((l) => ({
        account_id: String(l.account_id ?? l.accountId ?? ''),
        debit: l.debit || '',
        credit: l.credit || '',
        memo: l.memo || ''
      })) || [emptyLine(), emptyLine()]
  }))

  // Quick mode dedicated states for 2-legged entry
  const [quickDebitId, setQuickDebitId] = useState<string>(() => {
    if (entry?.lines && entry.lines.length >= 2) {
      const d = entry.lines.find((l) => Number(l.debit || 0) > 0)
      if (d) return String(d.account_id ?? d.accountId ?? '')
    }
    return ''
  })
  const [quickCreditId, setQuickCreditId] = useState<string>(() => {
    if (entry?.lines && entry.lines.length >= 2) {
      const c = entry.lines.find((l) => Number(l.credit || 0) > 0)
      if (c) return String(c.account_id ?? c.accountId ?? '')
    }
    return ''
  })
  const [quickAmount, setQuickAmount] = useState<string>(() => {
    if (entry?.lines && entry.lines.length >= 2) {
      const d = entry.lines.find((l) => Number(l.debit || 0) > 0)
      if (d) return String(d.debit || '')
    }
    return ''
  })

  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [showAudit, setShowAudit] = useState<boolean>(false)

  useEffect(() => {
    if (!entry) {
      request('/journals/next-voucher')
        .then((d) => setForm((f) => ({ ...f, voucherNo: d.voucherNo })))
        .catch(() => {})
    }
  }, [entry])

  const activeAccounts = useMemo(() => accounts.filter((a) => Boolean(a.is_active)), [accounts])

  // Sync quick mode inputs into form.lines when in quick mode
  useEffect(() => {
    if (mode === 'quick') {
      const debitLine: JournalLineInput = {
        account_id: quickDebitId,
        debit: quickAmount,
        credit: '',
        memo: form.description
      }
      const creditLine: JournalLineInput = {
        account_id: quickCreditId,
        debit: '',
        credit: quickAmount,
        memo: form.description
      }
      setForm((f) => ({
        ...f,
        lines: [debitLine, creditLine]
      }))
    }
  }, [mode, quickDebitId, quickCreditId, quickAmount, form.description])

  const totals = useMemo(() => {
    if (mode === 'quick') {
      const amt = Number(quickAmount || 0)
      const valid = Boolean(quickDebitId && quickCreditId && amt > 0)
      return {
        debit: valid ? amt : 0,
        credit: valid ? amt : 0
      }
    }
    return {
      debit: form.lines.reduce((s, l) => s + Number(l.debit || 0), 0),
      credit: form.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
    }
  }, [mode, quickDebitId, quickCreditId, quickAmount, form.lines])

  const validation = useMemo(() => {
    if (mode === 'quick') {
      const errs: Record<string, string> = {}
      if (!form.entryDate) errs.entryDate = 'Tanggal harus diisi.'
      if (!(form.description || '').trim()) errs.description = 'Keterangan transaksi harus diisi.'
      if (!quickDebitId) errs.debit = 'Pilih akun Debit.'
      if (!quickCreditId) errs.credit = 'Pilih akun Kredit.'
      if (quickDebitId && quickCreditId && quickDebitId === quickCreditId) {
        errs.same = 'Akun Debit dan Kredit tidak boleh sama.'
      }
      if (!Number(quickAmount) || Number(quickAmount) <= 0) {
        errs.amount = 'Nominal harus lebih besar dari 0.'
      }
      return {
        valid: Object.keys(errs).length === 0,
        errors: errs,
        lineErrors: []
      }
    }
    return validateJournal(form)
  }, [mode, form, quickDebitId, quickCreditId, quickAmount])

  const diff = totals.debit - totals.credit
  const balanced = Math.abs(diff) < 0.005
  const canSave = validation.valid && balanced && !busy

  // Selected accounts metadata for smart contextual hints
  const selectedDebitAccount = useMemo(
    () => accounts.find((a) => String(a.id) === String(quickDebitId)),
    [accounts, quickDebitId]
  )
  const selectedCreditAccount = useMemo(
    () => accounts.find((a) => String(a.id) === String(quickCreditId)),
    [accounts, quickCreditId]
  )

  function getAlereHint(acc: Account | undefined, side: 'DEBIT' | 'KREDIT'): string {
    if (!acc) return ''
    const grp = acc.account_group
    if (side === 'DEBIT') {
      switch (grp) {
        case 'ASSET':
          return `Aset "${acc.name}" bertambah dicatat di sisi DEBIT (penambahan kas, piutang, barang, dll).`
        case 'EXPENSE':
          return `Beban "${acc.name}" bertambah dicatat di sisi DEBIT (biaya operasional perusahaan).`
        case 'LIABILITY':
          return `Liabilitas "${acc.name}" berkurang dicatat di sisi DEBIT (pelunasan utang).`
        case 'EQUITY':
          return `Ekuitas "${acc.name}" berkurang dicatat di sisi DEBIT (misal penarikan prive).`
        case 'REVENUE':
          return `Pendapatan "${acc.name}" di sisi DEBIT (pengurangan atau koreksi pendapatan).`
        default:
          return `Posisi saldo normal: ${acc.normal_balance}`
      }
    } else {
      switch (grp) {
        case 'ASSET':
          return `Aset "${acc.name}" berkurang dicatat di sisi KREDIT (kas keluar, pemakaian perlengkapan).`
        case 'LIABILITY':
          return `Liabilitas "${acc.name}" bertambah dicatat di sisi KREDIT (timbul utang/kewajiban baru).`
        case 'EQUITY':
          return `Ekuitas "${acc.name}" bertambah dicatat di sisi KREDIT (setoran modal pemilik).`
        case 'REVENUE':
          return `Pendapatan "${acc.name}" diakui dicatat di sisi KREDIT (penerimaan hasil penjualan/jasa).`
        case 'EXPENSE':
          return `Beban "${acc.name}" berkurang di sisi KREDIT (koreksi/penyesuaian beban).`
        default:
          return `Posisi saldo normal: ${acc.normal_balance}`
      }
    }
  }



  function changeLine(i: number, f: keyof JournalLineInput, v: any) {
    const ls = [...form.lines]
    ls[i] = { ...ls[i], [f]: v }
    if (f === 'debit' && Number(v) > 0) ls[i].credit = ''
    if (f === 'credit' && Number(v) > 0) ls[i].debit = ''
    setForm({ ...form, lines: ls })
  }

  function autoBalance() {
    if (balanced) return
    const diffAbs = Math.abs(diff)
    const ls = [...form.lines]
    const emptyIdx = ls.findIndex(
      (l) => !l.account_id || (Number(l.debit || 0) === 0 && Number(l.credit || 0) === 0)
    )
    if (emptyIdx >= 0) {
      if (diff > 0) {
        ls[emptyIdx].credit = String(diffAbs)
        ls[emptyIdx].debit = ''
      } else {
        ls[emptyIdx].debit = String(diffAbs)
        ls[emptyIdx].credit = ''
      }
      setForm({ ...form, lines: ls })
    } else {
      const newLine = emptyLine()
      if (diff > 0) newLine.credit = String(diffAbs)
      else newLine.debit = String(diffAbs)
      setForm({ ...form, lines: [...ls, newLine] })
    }
  }

  function autoFillAccounts() {
    const hasDebit = form.lines.findIndex((l) => Number(l.debit) > 0)
    const hasCredit = form.lines.findIndex((l) => Number(l.credit) > 0)
    if (hasDebit < 0 || hasCredit < 0) return
    const ls = [...form.lines]
    const debitLine = ls[hasDebit]
    const creditLine = ls[hasCredit]
    const dDiff = Number(debitLine.debit || 0) - Number(creditLine.credit || 0)
    if (Math.abs(dDiff) < 0.001 && !creditLine.account_id && debitLine.account_id) {
      creditLine.account_id = debitLine.account_id
      creditLine.memo = debitLine.memo || ''
      setForm({ ...form, lines: ls })
    }
  }



  function addLines(n: number) {
    setForm({ ...form, lines: [...form.lines, ...Array(n).fill(null).map(emptyLine)] })
  }

  async function save() {
    setBusy(true)
    setError('')

    let cleanLines: JournalLineInput[] = []
    if (mode === 'quick') {
      cleanLines = [
        { account_id: quickDebitId, debit: quickAmount, credit: '', memo: form.description },
        { account_id: quickCreditId, debit: '', credit: quickAmount, memo: form.description }
      ]
    } else {
      cleanLines = form.lines.filter(
        (l) => l.account_id || Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0
      )
    }

    const body = {
      voucherNo: form.voucherNo,
      entryDate: form.entryDate,
      description: form.description,
      lines: cleanLines.map((l) => ({
        ...l,
        account_id: Number(l.account_id),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0)
      }))
    }

    try {
      if (entry) {
        await request(`/journals/${entry.id}`, { method: 'PUT', body })
        await request(`/journals/${entry.id}/post`, { method: 'POST' })
      } else {
        await request('/journals', { method: 'POST', body: { ...body, status: 'POSTED' } })
      }
      notify(`Jurnal ${form.voucherNo || '(baru)'} berhasil disimpan & diposting.`)
      onSaved?.()
    } catch (r: any) {
      setError(r.message || 'Gagal menyimpan jurnal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={entry ? `Ubah Jurnal ${entry.voucher_no}` : 'Catat Transaksi Jurnal Umum'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={!canSave || busy} onClick={save}>
            <Send size={16} /> {busy ? 'Menyimpan…' : 'Simpan Transaksi'}
          </Button>
        </>
      }
    >
      {entry && (
        <div style={{ marginBottom: 14 }}>
          <Button variant="secondary" small onClick={() => setShowAudit(true)}>
            <History size={14} /> Riwayat Audit
          </Button>
        </div>
      )}

      {/* Mode Switcher Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: mode === 'quick' ? '#ecfdf5' : '#f0f9ff',
          border: `1px solid ${mode === 'quick' ? '#a7f3d0' : '#bae6fd'}`,
          borderRadius: 8,
          padding: '8px 14px',
          marginBottom: 16
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 700, color: mode === 'quick' ? '#065f46' : '#0369a1' }}>
            {mode === 'quick' ? '⚡ Mode Cepat (2-Akun Otomatis Seimbang)' : '📋 Mode Multi-Baris (Jurnal Majemuk)'}
          </span>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {mode === 'quick' ? '— Cocok untuk 90% transaksi harian' : '— Untuk transaksi dengan >2 akun'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === 'quick' ? 'multi' : 'quick')}
          className="button button-secondary"
          style={{ fontSize: 11, padding: '4px 10px', height: 'auto' }}
        >
          <ArrowRightLeft size={12} />
          {mode === 'quick' ? 'Ganti ke Mode Multi-Baris' : 'Ganti ke Mode Cepat'}
        </button>
      </div>

      {/* Basic Info: Tanggal, Voucher, Keterangan */}
      <div className="grid-equal">
        <div className="field">
          <label htmlFor="journal-voucher">NOMOR BUKTI TRANSAKSI</label>
          <input
            id="journal-voucher"
            className="input"
            placeholder="Otomatis, misal: JRN-202609-001"
            value={form.voucherNo}
            onChange={(e) => setForm({ ...form, voucherNo: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="journal-date">TANGGAL TRANSAKSI</label>
          <input
            id="journal-date"
            className="input"
            type="date"
            value={form.entryDate}
            onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
          />
          <FieldWarning message={validation.errors.entryDate} />
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="journal-desc">KETERANGAN TRANSAKSI</label>
        <input
          id="journal-desc"
          className="input"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Contoh: Penerimaan pembayaran piutang dari pelanggan PT ABC"
        />
        <FieldWarning message={validation.errors.description} />
      </div>

      {/* MODE CEPAT (2-Akun) */}
      {mode === 'quick' ? (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: 16
            }}
          >
            {/* Akun Debit */}
            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label htmlFor="quick-debit-account" style={{ color: '#15803d', fontWeight: 800 }}>
                  📥 AKUN DEBIT (Menerima / Bertambah)
                </label>
                {selectedDebitAccount && (
                  <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                    {GL[selectedDebitAccount.account_group] || selectedDebitAccount.account_group}
                  </span>
                )}
              </div>
              <select
                id="quick-debit-account"
                className="select"
                value={quickDebitId}
                onChange={(e) => setQuickDebitId(e.target.value)}
                style={{ borderColor: selectedDebitAccount ? '#86efac' : undefined }}
              >
                <option value="">-- Pilih Akun Debit --</option>
                {(['ASSET', 'EXPENSE', 'LIABILITY', 'EQUITY', 'REVENUE'] as AccountGroup[]).map((grp) => {
                  const grpAccounts = activeAccounts.filter((a) => a.account_group === grp)
                  if (!grpAccounts.length) return null
                  return (
                    <optgroup key={grp} label={`--- ${GL[grp] || grp} ---`}>
                      {grpAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
              {selectedDebitAccount ? (
                <div style={{ marginTop: 6, fontSize: 11, color: '#15803d', background: '#f0fdf4', padding: '6px 8px', borderRadius: 6, border: '1px solid #dcfce7' }}>
                  💡 {getAlereHint(selectedDebitAccount, 'DEBIT')}
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                  Pilih akun yang menerima uang/aset atau akun beban.
                </div>
              )}
            </div>

            {/* Akun Kredit */}
            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label htmlFor="quick-credit-account" style={{ color: '#0369a1', fontWeight: 800 }}>
                  📤 AKUN KREDIT (Sumber / Berkurang / Diakui)
                </label>
                {selectedCreditAccount && (
                  <span style={{ fontSize: 11, background: '#e0f2fe', color: '#075985', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                    {GL[selectedCreditAccount.account_group] || selectedCreditAccount.account_group}
                  </span>
                )}
              </div>
              <select
                id="quick-credit-account"
                className="select"
                value={quickCreditId}
                onChange={(e) => setQuickCreditId(e.target.value)}
                style={{ borderColor: selectedCreditAccount ? '#7dd3fc' : undefined }}
              >
                <option value="">-- Pilih Akun Kredit --</option>
                {(['REVENUE', 'LIABILITY', 'EQUITY', 'ASSET', 'EXPENSE'] as AccountGroup[]).map((grp) => {
                  const grpAccounts = activeAccounts.filter((a) => a.account_group === grp)
                  if (!grpAccounts.length) return null
                  return (
                    <optgroup key={grp} label={`--- ${GL[grp] || grp} ---`}>
                      {grpAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>
              {selectedCreditAccount ? (
                <div style={{ marginTop: 6, fontSize: 11, color: '#0369a1', background: '#f0f9ff', padding: '6px 8px', borderRadius: 6, border: '1px solid #e0f2fe' }}>
                  💡 {getAlereHint(selectedCreditAccount, 'KREDIT')}
                </div>
              ) : (
                <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                  Pilih akun sumber kas keluar, pendapatan yang diakui, atau utang.
                </div>
              )}
            </div>
          </div>

          {/* Nominal Input Field */}
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="quick-amount" style={{ fontWeight: 800 }}>
              NOMINAL TRANSAKSI (Rp)
            </label>
            <div style={{ position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontWeight: 700,
                  color: '#64748b',
                  fontSize: 14
                }}
              >
                Rp
              </span>
              <input
                id="quick-amount"
                className="input"
                style={{ paddingLeft: 44, fontSize: 16, fontWeight: 700 }}
                placeholder="Contoh: 1.500.000"
                value={formatNum(quickAmount)}
                onChange={(e) => {
                  const num = parseNum(e.target.value)
                  setQuickAmount(num > 0 ? String(num) : '')
                }}
              />
            </div>
            {quickDebitId && quickCreditId && Number(quickAmount) > 0 && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#16a34a' }}>
                <CheckCircle2 size={16} /> Otomatis Seimbang: Debit {money(Number(quickAmount))} = Kredit {money(Number(quickAmount))}
              </div>
            )}
            {validation.errors.same && <FieldWarning message={validation.errors.same} />}
            {validation.errors.amount && <FieldWarning message={validation.errors.amount} />}
          </div>
        </div>
      ) : (
        /* MODE MULTI-BARIS (Jurnal Majemuk) */
        <div style={{ marginTop: 18 }} className="journal-lines">
          <FieldWarning message={validation.errors.lines} />
          <div className="journal-grid header">
            <span>POSISI & NAMA AKUN</span>
            <span>DEBIT (Rp)</span>
            <span>KREDIT (Rp)</span>
            <span />
          </div>
          {form.lines.map((line, i) => {
            const le = validation.lineErrors?.[i]
            const isDebit = Number(line.debit || 0) > 0
            const isCredit = Number(line.credit || 0) > 0
            return (
              <div
                className={`journal-grid ${isDebit ? 'line-debit' : isCredit ? 'line-credit' : ''}`}
                key={i}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 5px',
                      borderRadius: 4,
                      background: isDebit ? '#dcfce7' : isCredit ? '#e0f2fe' : '#f1f5f9',
                      color: isDebit ? '#15803d' : isCredit ? '#0369a1' : '#64748b'
                    }}
                  >
                    {isDebit ? 'DEBIT' : isCredit ? '↳ KREDIT' : `${i + 1}`}
                  </span>
                  <select
                    aria-label={`Pilih akun baris ${i + 1}`}
                    className="select"
                    style={{ flex: 1, paddingLeft: isCredit ? 16 : 8 }}
                    value={line.account_id}
                    onChange={(e) => changeLine(i, 'account_id', e.target.value)}
                  >
                    <option value="">Pilih akun...</option>
                    {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as AccountGroup[]).map((grp) => {
                      const grpAccounts = activeAccounts.filter((a) => a.account_group === grp)
                      if (!grpAccounts.length) return null
                      return (
                        <optgroup key={grp} label={`--- ${GL[grp] || grp} ---`}>
                          {grpAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name} ({a.normal_balance === 'DEBIT' ? 'D' : 'K'})
                            </option>
                          ))}
                        </optgroup>
                      )
                    })}
                  </select>
                </div>
                <input
                  aria-label={`Nominal Debit baris ${i + 1}`}
                  className="input"
                  style={{ textAlign: 'right' }}
                  type="text"
                  value={formatNum(line.debit)}
                  onChange={(e) => changeLine(i, 'debit', parseNum(e.target.value))}
                  placeholder="0"
                />
                <input
                  aria-label={`Nominal Kredit baris ${i + 1}`}
                  className="input"
                  style={{ textAlign: 'right' }}
                  type="text"
                  value={formatNum(line.credit)}
                  onChange={(e) => changeLine(i, 'credit', parseNum(e.target.value))}
                  placeholder="0"
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Hapus baris ${i + 1}`}
                  disabled={form.lines.length <= 2}
                  onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}
                >
                  <X size={16} />
                </button>
                {(le?.account || le?.amount || le?.both) && (
                  <div className="field-warning" style={{ gridColumn: '1/-1' }}>
                    {le?.account || le?.amount || le?.both}
                  </div>
                )}
              </div>
            )
          })}

          <div
            style={{
              marginTop: 10,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center'
            }}
          >
            <Button
              variant="secondary"
              small
              onClick={autoBalance}
              style={{ background: '#fffbeb', borderColor: '#fef3c7', color: '#b45309' }}
            >
              <Zap size={14} /> Auto-Balance (Seimbangkan)
            </Button>
            <Button variant="secondary" small onClick={autoFillAccounts}>
              <Copy size={14} /> Salin Akun Berpasangan
            </Button>
            <Button variant="secondary" small onClick={() => addLines(1)}>
              <Plus size={14} /> +1 Baris
            </Button>
            <Button variant="secondary" small onClick={() => addLines(2)}>
              <Layers size={14} /> +2 Baris
            </Button>
          </div>
        </div>
      )}

      {/* Balance Indicator Footer */}
      <div
        style={{
          marginTop: 16,
          background: balanced ? '#f0fdf4' : '#fff1f2',
          border: `1px solid ${balanced ? '#bbf7d0' : '#fecdd3'}`,
          borderRadius: 10,
          padding: '12px 16px'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            fontSize: 13
          }}
        >
          <div>
            <span>
              Total Debit: <strong className={balanced ? 'good' : 'bad'}>{money(totals.debit)}</strong>
            </span>
            <span style={{ margin: '0 12px', color: '#94a3b8' }}>|</span>
            <span>
              Total Kredit: <strong className={balanced ? 'good' : 'bad'}>{money(totals.credit)}</strong>
            </span>
          </div>
          <div style={{ fontWeight: 700 }}>
            {balanced ? (
              <span style={{ color: '#16a34a' }}>✓ Jurnal Seimbang (Debit = Kredit)!</span>
            ) : (
              <span style={{ color: '#e11d48' }}>
                {diff > 0
                  ? `⚠️ Sisi Kredit Kurang: ${money(Math.abs(diff))}`
                  : `⚠️ Sisi Debit Kurang: ${money(Math.abs(diff))}`}
              </span>
            )}
          </div>
        </div>
      </div>

      <ErrorNotice error={error} />

      {showAudit && entry && <AuditLogModal journalId={entry.id} onClose={() => setShowAudit(false)} />}
    </Modal>
  )
}
