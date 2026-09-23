import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  CheckCircle2,
  Copy,
  History,
  Layers,
  Lightbulb,
  Lock,
  Plus,
  Save,
  Send,
  Undo2,
  X,
  Zap
} from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { FieldWarning } from '../ui/FieldWarning.js'
import { AccountPicker } from '../ui/AccountPicker.js'
import { AmountInput } from '../ui/AmountInput.js'
import { AuditLogModal } from './AuditLogModal.js'
import { ReverseJournalModal } from './ReverseJournalModal.js'
import { request } from '../../api.js'
import { money, today, GL } from '../../utils/formatters.js'
import { validateJournal, JournalFormInput, JournalLineInput } from '../../utils/validators.js'
import { Account, JournalLine } from '../../../shared/types.js'

// Bentuk minimal yang dibutuhkan modal; register mengirim versi ini langsung dari laporan,
// sedangkan entri penuh datang dari GET /journals/:id.
export interface JournalModalEntry {
  id: number
  voucher_no: string
  entry_date: string
  description: string
  status?: string
  source?: string
  lines?: JournalLine[]
}

export interface JournalModalProps {
  accounts?: Account[]
  entry?: JournalModalEntry | null
  onClose: () => void
  onSaved?: () => void
  notify: (msg: string, isError?: boolean) => void
}

type CellCol = 'account' | 'debit' | 'credit' | 'memo'
type Mode = 'quick' | 'multi'

const STEP_HINT = '↑/↓ ±1 · Shift+↑/↓ ±1.000 · Alt+↑/↓ ±100.000 · Shift+D / Shift+K pindah sisi'

const hasContent = (line: JournalLineInput): boolean =>
  Boolean(line.account_id) || Number(line.debit || 0) > 0 || Number(line.credit || 0) > 0

export function JournalModal({
  accounts = [],
  entry,
  onClose,
  onSaved,
  notify
}: JournalModalProps): React.JSX.Element {
  const emptyLine = (): JournalLineInput => ({ account_id: '', debit: '', credit: '', memo: '' })
  const readOnly = Boolean(entry && entry.status !== 'DRAFT')

  const [mode, setMode] = useState<Mode>(entry && (entry.lines?.length || 0) > 2 ? 'multi' : 'quick')
  const [form, setForm] = useState<JournalFormInput>(() => ({
    voucherNo: entry?.voucher_no || '',
    entryDate: entry?.entry_date?.slice(0, 10) || today(),
    description: entry?.description || '',
    lines: entry?.lines?.length
      ? entry.lines.map((l) => ({
          account_id: String(l.account_id ?? l.accountId ?? ''),
          debit: String(l.debit ?? ''),
          credit: String(l.credit ?? ''),
          memo: l.memo || ''
        }))
      : [emptyLine(), emptyLine()]
  }))

  const firstDebit = entry?.lines?.find((l) => Number(l.debit || 0) > 0)
  const firstCredit = entry?.lines?.find((l) => Number(l.credit || 0) > 0)
  const [quickDebitId, setQuickDebitId] = useState<string>(String(firstDebit?.account_id ?? firstDebit?.accountId ?? ''))
  const [quickCreditId, setQuickCreditId] = useState<string>(String(firstCredit?.account_id ?? firstCredit?.accountId ?? ''))
  const [quickAmount, setQuickAmount] = useState<string>(String(firstDebit?.debit ?? ''))

  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [touched, setTouched] = useState<boolean>(false)
  const [showAudit, setShowAudit] = useState<boolean>(false)
  const [showReverse, setShowReverse] = useState<boolean>(false)

  const cellRefs = useRef(new Map<string, HTMLElement>())
  const pendingFocus = useRef<string | null>(null)
  const snapshot = useRef<string>('')

  const markTouched = useCallback((): void => setTouched(true), [])

  useEffect(() => {
    if (entry) return
    let alive = true
    request<{ voucherNo: string }>('/journals/next-voucher')
      .then((d) => {
        if (alive) setForm((f) => ({ ...f, voucherNo: d.voucherNo }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [entry])

  // Fokus tertunda dipakai saat baris baru perlu dibuat lebih dulu sebelum dipindahkan.
  useEffect(() => {
    if (!pendingFocus.current) return
    const target = pendingFocus.current
    pendingFocus.current = null
    cellRefs.current.get(target)?.focus()
  })

  const activeAccounts = useMemo(() => accounts.filter((a) => Boolean(a.is_active)), [accounts])

  const totals = useMemo(() => {
    if (mode === 'quick') {
      const amt = Number(quickAmount || 0)
      const valid = Boolean(quickDebitId && quickCreditId && amt > 0)
      return { debit: valid ? amt : 0, credit: valid ? amt : 0 }
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
      if (!quickDebitId) errs.debitAccount = 'Pilih akun Debit.'
      if (!quickCreditId) errs.creditAccount = 'Pilih akun Kredit.'
      if (quickDebitId && quickCreditId && quickDebitId === quickCreditId) {
        errs.same = 'Akun Debit dan Kredit tidak boleh sama.'
      }
      if (!Number(quickAmount) || Number(quickAmount) <= 0) errs.amount = 'Nominal harus lebih besar dari 0.'
      return { valid: Object.keys(errs).length === 0, errors: errs, lineErrors: [] as ReturnType<typeof validateJournal>['lineErrors'] }
    }
    return validateJournal(form)
  }, [mode, form, quickDebitId, quickCreditId, quickAmount])

  const diff = totals.debit - totals.credit
  const balanced = Math.abs(diff) < 0.005
  const canSave = validation.valid && balanced && !busy && !readOnly

  const signature = JSON.stringify({
    entryDate: form.entryDate,
    description: form.description,
    lines: form.lines,
    quickDebitId,
    quickCreditId,
    quickAmount,
    mode
  })
  if (!snapshot.current) snapshot.current = signature
  const dirty = touched && signature !== snapshot.current

  useEffect(() => {
    if (!dirty || busy) return
    function warn(e: BeforeUnloadEvent): void {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])

  function setCellRef(row: number, col: CellCol) {
    return (node: HTMLElement | null): void => {
      const key = `${row}:${col}`
      if (node) cellRefs.current.set(key, node)
      else cellRefs.current.delete(key)
    }
  }

  function moveTo(row: number, col: CellCol): void {
    if (row < 0) return
    if (row >= form.lines.length) {
      addLines(1)
      pendingFocus.current = `${row}:${col}`
      return
    }
    cellRefs.current.get(`${row}:${col}`)?.focus()
  }

  function gridKeyDown(e: React.KeyboardEvent, row: number): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) moveTo(row - 1, 'account')
      else moveTo(row + 1, 'account')
    } else if (e.key.toLowerCase() === 'd' && e.ctrlKey) {
      e.preventDefault()
      duplicateLine(row)
    }
  }

  function changeLine(i: number, field: keyof JournalLineInput, value: string): void {
    const lines = [...form.lines]
    lines[i] = { ...lines[i], [field]: value }
    if (field === 'debit' && Number(value) > 0) lines[i].credit = ''
    if (field === 'credit' && Number(value) > 0) lines[i].debit = ''
    setForm({ ...form, lines })
    markTouched()
  }

  function transferSide(i: number, side: 'DEBIT' | 'KREDIT'): void {
    const line = form.lines[i]
    const value = Number(line?.debit || 0) || Number(line?.credit || 0)
    if (!value) return
    changeLine(i, side === 'DEBIT' ? 'debit' : 'credit', String(value))
    cellRefs.current.get(`${i}:${side === 'DEBIT' ? 'debit' : 'credit'}`)?.focus()
  }

  function addLines(n: number): void {
    setForm({ ...form, lines: [...form.lines, ...Array(n).fill(null).map(emptyLine)] })
    markTouched()
  }

  function duplicateLine(i: number): void {
    const source = form.lines[i]
    if (!source) return
    const lines = [...form.lines]
    lines.splice(i + 1, 0, { ...source })
    setForm({ ...form, lines })
    markTouched()
    pendingFocus.current = `${i + 1}:account`
  }

  function removeLine(i: number): void {
    if (form.lines.length <= 2) return
    setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })
    markTouched()
  }

  function autoBalance(): void {
    if (balanced) return
    const gap = Math.abs(diff)
    const lines = [...form.lines]
    const emptyIdx = lines.findIndex((l) => !l.account_id || (Number(l.debit || 0) === 0 && Number(l.credit || 0) === 0))
    if (emptyIdx >= 0) {
      lines[emptyIdx] = diff > 0
        ? { ...lines[emptyIdx], credit: String(gap), debit: '' }
        : { ...lines[emptyIdx], debit: String(gap), credit: '' }
      setForm({ ...form, lines })
    } else {
      const extra = emptyLine()
      if (diff > 0) extra.credit = String(gap)
      else extra.debit = String(gap)
      setForm({ ...form, lines: [...lines, extra] })
      pendingFocus.current = `${lines.length}:account`
    }
    markTouched()
  }

  function autoFillAccounts(): void {
    const debitIdx = form.lines.findIndex((l) => Number(l.debit) > 0)
    const creditIdx = form.lines.findIndex((l) => Number(l.credit) > 0)
    if (debitIdx < 0 || creditIdx < 0) return
    const lines = [...form.lines]
    const debitLine = lines[debitIdx]
    const creditLine = lines[creditIdx]
    if (Math.abs(Number(debitLine.debit || 0) - Number(creditLine.credit || 0)) < 0.001 && !creditLine.account_id && debitLine.account_id) {
      lines[creditIdx] = { ...creditLine, account_id: debitLine.account_id, memo: creditLine.memo || debitLine.memo || '' }
      setForm({ ...form, lines })
      markTouched()
    }
  }

  const realLineCount = form.lines.filter(hasContent).length
  const quickCannotHoldThis = mode === 'multi' && realLineCount > 2

  function switchMode(next: Mode): void {
    if (next === mode) return
    if (next === 'multi' && (quickDebitId || quickCreditId || Number(quickAmount))) {
      setForm({
        ...form,
        lines: [
          { account_id: quickDebitId, debit: quickAmount, credit: '', memo: '' },
          { account_id: quickCreditId, debit: '', credit: quickAmount, memo: '' }
        ]
      })
      markTouched()
    }
    setMode(next)
  }

  const errorFieldIds: Record<string, string> = {
    entryDate: 'journal-date',
    description: 'journal-desc',
    voucherNo: 'journal-voucher',
    debitAccount: 'quick-debit-account',
    creditAccount: 'quick-credit-account',
    amount: 'quick-amount',
    same: 'quick-amount'
  }

  function focusFirstInvalid(): void {
    for (const key of Object.keys(validation.errors)) {
      const node = document.getElementById(errorFieldIds[key] || '')
      if (node) {
        node.focus()
        notify(validation.errors[key], true)
        return
      }
    }
    if (validation.errors.lines) {
      moveTo(0, 'account')
      notify(validation.errors.lines, true)
      return
    }
    const badLine = validation.lineErrors.findIndex((e) => e)
    if (badLine >= 0) {
      const issue = validation.lineErrors[badLine]
      cellRefs.current.get(`${badLine}:${(issue?.account && !form.lines[badLine].account_id) ? 'account' : 'debit'}`)?.focus()
      notify(`Baris ${badLine + 1}: ${issue?.account || issue?.amount || issue?.both}`, true)
      return
    }
    notify(diff > 0 ? `Sisi kredit kurang ${money(Math.abs(diff))}.` : `Sisi debit kurang ${money(Math.abs(diff))}.`, true)
  }

  function collectLines(): JournalLineInput[] {
    if (mode === 'quick') {
      return [
        { account_id: quickDebitId, debit: quickAmount, credit: '', memo: '' },
        { account_id: quickCreditId, debit: '', credit: quickAmount, memo: '' }
      ]
    }
    return form.lines.filter(hasContent)
  }

  async function save(status: 'POSTED' | 'DRAFT' = 'POSTED'): Promise<void> {
    if (readOnly) return
    if (!canSave) {
      focusFirstInvalid()
      return
    }
    setBusy(true)
    setError('')
    const body = {
      voucherNo: form.voucherNo,
      entryDate: form.entryDate,
      description: form.description,
      lines: collectLines().map((l) => ({
        account_id: Number(l.account_id),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        memo: (l.memo || '').trim() || null
      }))
    }
    try {
      if (entry) {
        await request(`/journals/${entry.id}`, { method: 'PUT', body })
        if (status === 'POSTED') await request(`/journals/${entry.id}/post`, { method: 'POST' })
      } else {
        await request('/journals', { method: 'POST', body: { ...body, status } })
      }
      setTouched(false)
      notify(
        status === 'POSTED'
          ? `Jurnal ${form.voucherNo || '(baru)'} tersimpan dan terposting.`
          : `Jurnal ${form.voucherNo || '(baru)'} tersimpan sebagai draft.`
      )
      onSaved?.()
    } catch (r: any) {
      setError(r.message || 'Gagal menyimpan jurnal.')
    } finally {
      setBusy(false)
    }
  }

  function handleFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      save('POSTED')
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save('DRAFT')
    }
  }

  // Formulir yang belum disentuh tidak dihakimi: pesan field baru muncul setelah operator mengetik,
  // sementara tombol simpan tetap menunggu jurnal valid dan seimbang.
  const vErrors: Record<string, string> = touched ? validation.errors : {}
  const vLineErrors: typeof validation.lineErrors = touched ? validation.lineErrors : []

  const selectedDebitAccount = useMemo(() => accounts.find((a) => String(a.id) === quickDebitId), [accounts, quickDebitId])
  const selectedCreditAccount = useMemo(() => accounts.find((a) => String(a.id) === quickCreditId), [accounts, quickCreditId])

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
        default:
          return `Pendapatan "${acc.name}" di sisi DEBIT (pengurangan atau koreksi pendapatan).`
      }
    }
    switch (grp) {
      case 'ASSET':
        return `Aset "${acc.name}" berkurang dicatat di sisi KREDIT (kas keluar, pemakaian perlengkapan).`
      case 'LIABILITY':
        return `Liabilitas "${acc.name}" bertambah dicatat di sisi KREDIT (timbul utang/kewajiban baru).`
      case 'EQUITY':
        return `Ekuitas "${acc.name}" bertambah dicatat di sisi KREDIT (setoran modal pemilik).`
      case 'REVENUE':
        return `Pendapatan "${acc.name}" diakui dicatat di sisi KREDIT (penerimaan hasil penjualan/jasa).`
      default:
        return `Beban "${acc.name}" berkurang di sisi KREDIT (koreksi/penyesuaian beban).`
    }
  }

  return (
    <Modal
      title={entry ? (readOnly ? `Jurnal ${entry.voucher_no}` : `Ubah Draft ${entry.voucher_no}`) : 'Catat Transaksi Jurnal Umum'}
      onClose={onClose}
      dirty={dirty}
      closeMessage="Buang transaksi yang belum disimpan?"
      footer={
        <>
          <span className="shortcut-hint" style={{ marginRight: 'auto', alignSelf: 'center', textAlign: 'left' }}>
            Enter simpan &middot; Ctrl+S draft &middot; Esc tutup
          </span>
          {readOnly ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Tutup
              </Button>
              <Button variant="secondary" onClick={() => setShowReverse(true)}>
                <Undo2 size={16} /> Jurnal Pembalik
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose}>
                Batal
              </Button>
              <Button variant="secondary" disabled={!canSave} onClick={() => save('DRAFT')}>
                <Save size={16} /> Simpan Draft
              </Button>
              <Button disabled={!canSave} onClick={() => save('POSTED')}>
                <Send size={16} /> {busy ? 'Menyimpan…' : 'Simpan & Posting'}
              </Button>
            </>
          )}
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save('POSTED') }} onKeyDown={handleFormKeyDown}>
        {entry && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <Button variant="secondary" small onClick={() => setShowAudit(true)}>
              <History size={14} /> Riwayat Audit
            </Button>
            {readOnly && (
              <Button variant="secondary" small onClick={() => setShowReverse(true)}>
                <Undo2 size={14} /> Jurnal Pembalik
              </Button>
            )}
          </div>
        )}

        {readOnly && (
          <div className="notice">
            <Lock size={15} aria-hidden="true" />
            Jurnal terposting tidak dapat diubah agar jejak audit tetap sah. Gunakan Jurnal Pembalik untuk mengoreksi.
          </div>
        )}

        <div className={mode === 'quick' ? 'mode-bar' : 'mode-bar is-multi'}>
          <div className="mode-bar-text">
            <strong>
              {mode === 'quick' ? <Zap size={14} /> : <Layers size={14} />}
              {mode === 'quick' ? 'Mode Cepat (2 akun, otomatis seimbang)' : 'Mode Multi-Baris (jurnal majemuk)'}
            </strong>
            <em>{mode === 'quick' ? 'cocok untuk 90% transaksi harian' : 'untuk transaksi dengan lebih dari dua akun'}</em>
          </div>
          <button
            type="button"
            onClick={() => switchMode(mode === 'quick' ? 'multi' : 'quick')}
            disabled={readOnly || quickCannotHoldThis}
            title={quickCannotHoldThis ? 'Jurnal majemuk lebih dari dua baris tidak bisa dialihkan ke Mode Cepat' : 'Ganti mode input'}
            className="button button-secondary chip"
          >
            <ArrowRightLeft size={12} />
            {mode === 'quick' ? 'Ganti ke Mode Multi-Baris' : 'Ganti ke Mode Cepat'}
          </button>
        </div>

        <div className="grid-equal">
          <div className="field">
            <label htmlFor="journal-voucher">NOMOR BUKTI TRANSAKSI</label>
            <input
              id="journal-voucher"
              className="input"
              placeholder="Otomatis, misal: JRN-202609-001"
              value={form.voucherNo}
              disabled={readOnly}
              onChange={(e) => {
                setForm({ ...form, voucherNo: e.target.value })
                markTouched()
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="journal-date">TANGGAL TRANSAKSI</label>
            <input
              id="journal-date"
              className="input"
              type="date"
              value={form.entryDate}
              disabled={readOnly}
              onChange={(e) => {
                setForm({ ...form, entryDate: e.target.value })
                markTouched()
              }}
            />
            <FieldWarning message={vErrors.entryDate} />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="journal-desc">KETERANGAN TRANSAKSI</label>
          <input
            id="journal-desc"
            className="input"
            data-autofocus
            value={form.description}
            disabled={readOnly}
            placeholder="Contoh: Penerimaan pembayaran piutang dari pelanggan PT ABC"
            onChange={(e) => {
              setForm({ ...form, description: e.target.value })
              markTouched()
            }}
          />
          <FieldWarning message={vErrors.description} />
        </div>

        {mode === 'quick' ? (
          <div style={{ marginTop: 18 }}>
            <div className="quick-panel">
              <div className="field">
                <div className="quick-top">
                  <label htmlFor="quick-debit-account" className="quick-label">
                    <ArrowDownToLine size={13} /> Akun Debit (menerima / bertambah)
                  </label>
                  {selectedDebitAccount && <span className="quick-tag">{GL[selectedDebitAccount.account_group] || selectedDebitAccount.account_group}</span>}
                </div>
                <AccountPicker
                  id="quick-debit-account"
                  accounts={activeAccounts}
                  value={quickDebitId}
                  side="DEBIT"
                  ariaLabel="Pilih akun debit"
                  placeholder="Ketik kode atau nama akun, mis. 11 atau kas"
                  disabled={readOnly}
                  invalid={Boolean(vErrors.debitAccount)}
                  onChange={(id) => {
                    setQuickDebitId(id)
                    markTouched()
                  }}
                  onSelected={readOnly ? undefined : () => document.getElementById('quick-credit-account')?.focus()}
                />
                {selectedDebitAccount ? (
                  <div className="quick-hint">
                    <Lightbulb size={12} /> {getAlereHint(selectedDebitAccount, 'DEBIT')}
                  </div>
                ) : (
                  <div className="quick-note">
                    {vErrors.debitAccount || 'Pilih akun yang menerima uang/aset atau akun beban.'}
                  </div>
                )}
              </div>

              <div className="field">
                <div className="quick-top">
                  <label htmlFor="quick-credit-account" className="quick-label credit">
                    <ArrowUpFromLine size={13} /> Akun Kredit (sumber / berkurang / diakui)
                  </label>
                  {selectedCreditAccount && <span className="quick-tag credit">{GL[selectedCreditAccount.account_group] || selectedCreditAccount.account_group}</span>}
                </div>
                <AccountPicker
                  id="quick-credit-account"
                  accounts={activeAccounts}
                  value={quickCreditId}
                  side="KREDIT"
                  ariaLabel="Pilih akun kredit"
                  placeholder="Ketik kode atau nama akun, mis. 41 atau pendapatan"
                  disabled={readOnly}
                  invalid={Boolean(vErrors.creditAccount)}
                  onChange={(id) => {
                    setQuickCreditId(id)
                    markTouched()
                  }}
                  onSelected={readOnly ? undefined : () => document.getElementById('quick-amount')?.focus()}
                />
                {selectedCreditAccount ? (
                  <div className="quick-hint credit">
                    <Lightbulb size={12} /> {getAlereHint(selectedCreditAccount, 'KREDIT')}
                  </div>
                ) : (
                  <div className="quick-note">
                    {vErrors.creditAccount || 'Pilih akun sumber kas keluar, pendapatan yang diakui, atau utang.'}
                  </div>
                )}
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="quick-amount" style={{ fontWeight: 800 }}>
                NOMINAL TRANSAKSI (Rp)
              </label>
              <AmountInput
                id="quick-amount"
                value={quickAmount}
                ariaLabel="Nominal transaksi"
                title={STEP_HINT}
                disabled={readOnly}
                invalid={Boolean(vErrors.amount)}
                onChange={(v) => {
                  setQuickAmount(v)
                  markTouched()
                }}
              />
              {quickDebitId && quickCreditId && Number(quickAmount) > 0 && (
                <div className="quick-ok">
                  <CheckCircle2 size={16} /> Otomatis Seimbang: Debit {money(Number(quickAmount))} = Kredit{' '}
                  {money(Number(quickAmount))}
                </div>
              )}
              <FieldWarning message={vErrors.same} />
              <FieldWarning message={vErrors.amount} />
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 18 }} className="journal-lines">
            <FieldWarning message={vErrors.lines} />
            <div className="journal-grid header">
              <span>POSISI &amp; NAMA AKUN</span>
              <span>DEBIT (Rp)</span>
              <span>KREDIT (Rp)</span>
              <span>KETERANGAN BARIS</span>
              <span />
            </div>
            {form.lines.map((line, i) => {
              const le = vLineErrors[i]
              const isDebit = Number(line.debit || 0) > 0
              const isCredit = Number(line.credit || 0) > 0
              return (
                <div className={`journal-grid ${isDebit ? 'line-debit' : isCredit ? 'line-credit' : ''}`} key={i}>
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <AccountPicker
                        accounts={activeAccounts}
                        value={String(line.account_id ?? '')}
                        side={isCredit ? 'KREDIT' : 'DEBIT'}
                        ariaLabel={`Pilih akun baris ${i + 1}`}
                        disabled={readOnly}
                        invalid={Boolean(le?.account)}
                        inputRef={setCellRef(i, 'account')}
                        onEnter={(up) => moveTo(i + (up ? -1 : 1), 'account')}
                        onChange={(id) => changeLine(i, 'account_id', id)}
                      />
                    </div>
                  </div>
                  <AmountInput
                    value={String(line.debit ?? '')}
                    ariaLabel={`Nominal Debit baris ${i + 1}`}
                    title={STEP_HINT}
                    disabled={readOnly}
                    inputRef={setCellRef(i, 'debit')}
                    onSideTransfer={readOnly ? undefined : (side) => transferSide(i, side)}
                    onChange={(v) => changeLine(i, 'debit', v)}
                    onKeyDown={(e) => gridKeyDown(e, i)}
                  />
                  <AmountInput
                    value={String(line.credit ?? '')}
                    ariaLabel={`Nominal Kredit baris ${i + 1}`}
                    title={STEP_HINT}
                    disabled={readOnly}
                    inputRef={setCellRef(i, 'credit')}
                    onSideTransfer={readOnly ? undefined : (side) => transferSide(i, side)}
                    onChange={(v) => changeLine(i, 'credit', v)}
                    onKeyDown={(e) => gridKeyDown(e, i)}
                  />
                  <input
                    className="input"
                    aria-label={`Keterangan baris ${i + 1}`}
                    placeholder="memo baris"
                    value={line.memo || ''}
                    disabled={readOnly}
                    ref={setCellRef(i, 'memo')}
                    onChange={(e) => changeLine(i, 'memo', e.target.value)}
                    onKeyDown={(e) => gridKeyDown(e, i)}
                  />
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Salin baris ${i + 1}`}
                      title="Salin baris (Ctrl+D)"
                      disabled={readOnly}
                      onClick={() => duplicateLine(i)}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Hapus baris ${i + 1}`}
                      disabled={readOnly || form.lines.length <= 2}
                      onClick={() => removeLine(i)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {(le?.account || le?.amount || le?.both) && (
                    <div className="field-warning" style={{ gridColumn: '1/-1' }}>
                      {le?.account || le?.amount || le?.both}
                    </div>
                  )}
                </div>
              )
            })}

            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Button
                variant="secondary"
                small
                className="warn"
                disabled={readOnly || balanced}
                onClick={autoBalance}
              >
                <Zap size={14} /> Auto-Balance (Seimbangkan)
              </Button>
              <Button variant="secondary" small disabled={readOnly} onClick={autoFillAccounts}>
                <Copy size={14} /> Salin Akun Berpasangan
              </Button>
              <Button variant="secondary" small disabled={readOnly} onClick={() => addLines(1)}>
                <Plus size={14} /> +1 Baris
              </Button>
              <Button variant="secondary" small disabled={readOnly} onClick={() => addLines(2)}>
                <Layers size={14} /> +2 Baris
              </Button>
            </div>
          </div>
        )}

        <div className={balanced ? 'balance-box' : 'balance-box is-off'}>
          <div className="balance-row">
            <div className="balance-totals">
              <span>
                Total Debit: <strong className={balanced ? 'good' : 'bad'}>{money(totals.debit)}</strong>
              </span>
              <span className="balance-sep">|</span>
              <span>
                Total Kredit: <strong className={balanced ? 'good' : 'bad'}>{money(totals.credit)}</strong>
              </span>
            </div>
            <div className="balance-state">
              {balanced ? (
                <span className="t-good"><CheckCircle2 size={14} /> Jurnal seimbang (debit = kredit)</span>
              ) : (
                <span className="t-bad">
                  <AlertTriangle size={14} />
                  {diff > 0 ? `Sisi kredit kurang ${money(Math.abs(diff))}` : `Sisi debit kurang ${money(Math.abs(diff))}`}
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="shortcut-hint">
          {mode === 'quick'
            ? 'Ketik kode lalu tekan Enter untuk berpindah kolom · Ctrl+S simpan draft · Ctrl+Enter simpan & posting'
            : 'Enter pindah baris · Shift+Enter kembali · Ctrl+D salin baris · Shift+D / Shift+K pindah sisi · Ctrl+S simpan draft · Ctrl+Enter simpan & posting'}
        </p>

        <button type="submit" className="sr-only" disabled={!canSave} tabIndex={-1} aria-hidden="true">
          Simpan
        </button>
      </form>

      <ErrorNotice error={error} />

      {showAudit && entry && <AuditLogModal journalId={entry.id} onClose={() => setShowAudit(false)} />}
      {showReverse && entry && (
        <ReverseJournalModal
          entry={{
            id: entry.id,
            voucher_no: entry.voucher_no,
            entry_date: String(entry.entry_date).slice(0, 10),
            description: entry.description,
            lines: (entry.lines || []).map((l) => ({
              debit: Number(l.debit || 0),
              credit: Number(l.credit || 0),
              memo: l.memo,
              code: l.code,
              account_name: l.account_name
            }))
          }}
          onClose={() => setShowReverse(false)}
          notify={notify}
          onReversed={() => {
            setShowReverse(false)
            onSaved?.()
          }}
        />
      )}
    </Modal>
  )
}
