import React, { useEffect, useMemo, useState } from 'react'
import {
  Copy, HelpCircle, History, Layers, Plus, Send, X, Zap
} from 'lucide-react'
import { Modal } from '../ui/Modal.js'
import { Button } from '../ui/Button.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { FieldWarning } from '../ui/FieldWarning.js'
import { TemplateModal, TemplateItem } from './TemplateModal.js'
import { SaveTemplateModal } from './SaveTemplateModal.js'
import { AuditLogModal } from './AuditLogModal.js'
import { AlereCheatSheetModal } from './AlereCheatSheetModal.js'
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

export function JournalModal({ accounts = [], entry, onClose, onSaved, notify }: JournalModalProps): React.JSX.Element {
  const emptyLine = (): JournalLineInput => ({ account_id: '', debit: '', credit: '', memo: '' })

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

  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [showTemplates, setShowTemplates] = useState<boolean>(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState<boolean>(false)
  const [showAudit, setShowAudit] = useState<boolean>(false)
  const [showCheatSheet, setShowCheatSheet] = useState<boolean>(false)

  const templatesState = useLoad<{ templates: TemplateItem[] }>(() => request('/templates'), [])
  const templates = templatesState.data?.templates || []

  useEffect(() => {
    if (!entry) {
      request('/journals/next-voucher')
        .then((d) => setForm((f) => ({ ...f, voucherNo: d.voucherNo })))
        .catch(() => {})
    }
  }, [entry])

  const activeAccounts = useMemo(() => accounts.filter((a) => Boolean(a.is_active)), [accounts])

  const totals = useMemo(
    () => ({
      debit: form.lines.reduce((s, l) => s + Number(l.debit || 0), 0),
      credit: form.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
    }),
    [form.lines]
  )

  const validation = useMemo(() => validateJournal(form), [form])
  const diff = totals.debit - totals.credit
  const balanced = Math.abs(diff) < 0.005
  const canSave = validation.valid && balanced && !busy

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

  function useTemplate(t: TemplateItem) {
    const byCode = new Map(accounts.map((a) => [String(a.code), a.id]))
    const newLines: JournalLineInput[] = t.lines.map((l: any) => ({
      account_id: String(l.account_id || byCode.get(String(l.account_code || l.code)) || ''),
      debit: l.debit ? String(l.debit) : '',
      credit: l.credit ? String(l.credit) : '',
      memo: l.memo || ''
    }))
    setForm((f) => ({
      ...f,
      description: f.description || t.description || t.name,
      lines: newLines.length >= 2 ? newLines : [...newLines, emptyLine()]
    }))
    setShowTemplates(false)
    notify(`Template "${t.name}" berhasil dimuat.`)
  }

  function addLines(n: number) {
    setForm({ ...form, lines: [...form.lines, ...Array(n).fill(null).map(emptyLine)] })
  }

  async function save(target: 'DRAFT' | 'POSTED') {
    setBusy(true)
    setError('')
    const cleanLines = form.lines.filter(
      (l) => l.account_id || Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0
    )
    const body = {
      ...form,
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
        if (target === 'POSTED') await request(`/journals/${entry.id}/post`, { method: 'POST' })
      } else {
        await request('/journals', { method: 'POST', body: { ...body, status: target } })
      }
      notify(
        `Jurnal ${form.voucherNo || '(baru)'} berhasil ${
          target === 'POSTED' ? 'diposting' : 'disimpan sebagai draft'
        }.`
      )
      onSaved?.()
    } catch (r: any) {
      setError(r.message || 'Gagal menyimpan jurnal.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function hk(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        if (canSave) save('POSTED')
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        if (canSave) save('DRAFT')
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    document.addEventListener('keydown', hk)
    return () => document.removeEventListener('keydown', hk)
  })

  return (
    <Modal
      title={entry ? `Ubah Jurnal ${entry.voucher_no}` : 'Catat Jurnal Umum Baru'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button variant="secondary" disabled={!canSave} onClick={() => save('DRAFT')}>
            <Copy size={16} /> Simpan Draft
          </Button>
          <Button disabled={!canSave} onClick={() => save('POSTED')}>
            <Send size={16} /> Posting Jurnal
          </Button>
        </>
      }
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 8
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!entry && (
            <Button variant="secondary" small onClick={() => setShowTemplates(true)}>
              <Layers size={14} /> Pakai Template Soal/Kasus
            </Button>
          )}
          {!entry && (
            <Button variant="secondary" small onClick={() => setShowSaveTemplate(true)}>
              <Copy size={14} /> Simpan Template
            </Button>
          )}
          {entry && (
            <Button variant="secondary" small onClick={() => setShowAudit(true)}>
              <History size={14} /> Riwayat Audit
            </Button>
          )}
        </div>
        <Button
          variant="secondary"
          small
          onClick={() => setShowCheatSheet(true)}
          style={{ color: '#047857', borderColor: '#a7f3d0' }}
        >
          <HelpCircle size={14} /> Panduan Saldo Normal (ALERE)
        </Button>
      </div>

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

      <div className="field" style={{ marginTop: 15 }}>
        <label htmlFor="journal-desc">KETERANGAN TRANSAKSI</label>
        <input
          id="journal-desc"
          className="input"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Contoh: Penyetoran modal awal tunai pemilik ke kas perusahaan"
        />
        <FieldWarning message={validation.errors.description} />
      </div>

      <FieldWarning message={validation.errors.lines} />

      <div style={{ marginTop: 18 }} className="journal-lines">
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
      </div>

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

      <div
        style={{
          marginTop: 14,
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
              Total Kredit:{' '}
              <strong className={balanced ? 'good' : 'bad'}>{money(totals.credit)}</strong>
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
      <div className="shortcut-hint">
        Pintasan Keyboard: <strong>Ctrl+Enter</strong> = Posting Langsung |{' '}
        <strong>Ctrl+S</strong> = Simpan Draft | <strong>Esc</strong> = Tutup
      </div>

      {showTemplates && (
        <TemplateModal
          templates={templates}
          onUse={useTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {showSaveTemplate && (
        <SaveTemplateModal
          form={form}
          onClose={() => setShowSaveTemplate(false)}
          notify={notify}
          onSaved={() => templatesState.reload()}
        />
      )}
      {showAudit && entry && <AuditLogModal journalId={entry.id} onClose={() => setShowAudit(false)} />}
      {showCheatSheet && <AlereCheatSheetModal onClose={() => setShowCheatSheet(false)} />}
    </Modal>
  )
}
