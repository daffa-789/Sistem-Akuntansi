import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  BookOpen,
  CalendarDays,
  Calculator,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  WalletCards,
  XCircle
} from 'lucide-react'
import { Button } from '../ui/Button.jsx'
import { Modal } from '../ui/Modal.jsx'
import { ErrorNotice } from '../ui/ErrorNotice.jsx'
import { money } from '../../utils/formatters.js'
import { request } from '../../api.js'
import { CycleEmpty, CycleIntro, CycleMetric, CycleStatus, CycleTabs, todayISO } from './CyclePrimitives.jsx'

// Susunan tab mengikuti BAB V.pptx bagian E (Sistem Penggajian / SDM).
const VIEWS = [
  ['summary', 'Ringkasan', BookOpen],
  ['employees', 'Data karyawan', Users],
  ['periods', 'Periode & absensi', CalendarDays],
  ['payroll', 'Daftar gaji', WalletCards],
  ['documents', 'Dokumen', FolderOpen],
  ['journal', 'Jurnal', FileText],
  ['controls', 'Pengendalian', ShieldCheck]
]
const PTKP_FALLBACK = ['TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3']
const NUMERIC_FIELDS = ['basic_salary', 'fixed_allowance', 'jkk_risk_class', 'family_members']
const NULLABLE_FIELDS = ['exit_date', 'npwp', 'bank_name', 'bank_account']
const CHANGE_FIELDS = [
  ...NUMERIC_FIELDS, 'is_expatriate', 'employee_code', 'name', 'department', 'position',
  'employment_type', 'status', 'join_date', ...NULLABLE_FIELDS, 'ptkp_status'
]
const FIELD_LABELS = {
  employee_code: 'Kode karyawan', name: 'Nama', department: 'Bagian', position: 'Jabatan',
  employment_type: 'Jenis kontrak', status: 'Status', join_date: 'Tanggal masuk',
  exit_date: 'Tanggal keluar', ptkp_status: 'PTKP', npwp: 'NPWP', bank_name: 'Bank',
  bank_account: 'Nomor rekening', basic_salary: 'Gaji pokok', fixed_allowance: 'Tunjangan tetap',
  jkk_risk_class: 'Kelas JKK', family_members: 'Tanggungan', is_expatriate: 'Ekspatriat'
}

// Slide 27: lima aktivitas sistem penggajian.
const ACTIVITY_STEPS = [
  ['Pengelolaan data karyawan', 'Bagian SDM mencatat identitas, jabatan, status kepegawaian, gaji, dan perubahan data yang telah disetujui.', 'SDM'],
  ['Pencatatan kehadiran dan jam kerja', 'Perusahaan mengumpulkan kehadiran, keterlambatan, jam kerja, dan lembur melalui daftar hadir atau sistem elektronik.', 'PENCATATAN WAKTU'],
  ['Perhitungan gaji', 'Bagian penggajian menghitung gaji bruto, tunjangan, lembur, potongan, dan gaji bersih yang diterima karyawan.', 'PENGGAJIAN'],
  ['Pembayaran gaji', 'Perusahaan membayarkan gaji melalui transfer bank atau metode pembayaran lain yang sah.', 'KEUANGAN'],
  ['Pencatatan akuntansi', 'Bagian akuntansi mencatat beban gaji, utang terkait penggajian, dan pembayaran gaji sesuai kondisi transaksi.', 'AKUNTANSI']
]

// Slide 26: tujuan sistem penggajian.
const PAYROLL_GOALS = [
  'Gaji dibayarkan sesuai hak karyawan dan tepat waktu.',
  'Gaji, tunjangan, lembur, dan potongan dihitung secara akurat.',
  'Menghindari pembayaran kepada karyawan fiktif atau yang sudah tidak bekerja.',
  'Menjaga kerahasiaan data karyawan.',
  'Menyediakan informasi biaya tenaga kerja untuk manajemen dan laporan keuangan.'
]

// Slide 30: pengendalian internal.
const CONTROL_DUTIES = [
  ['SDM', 'Mengelola data induk karyawan dan mengajukan perubahan data/gaji.'],
  ['Pencatatan waktu', 'Mencatat kehadiran, keterlambatan, dan lembur.'],
  ['Penggajian', 'Menghitung gaji kotor, potongan, dan gaji bersih.'],
  ['Pembayaran', 'Memverifikasi penerima, membayar, dan merekonsiliasi dengan bank.']
]

function periodLabel(period) {
  const date = new Date(String(period || '') + '-15T12:00:00')
  return Number.isNaN(date.getTime())
    ? period || '—'
    : new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(date)
}

function lastDayOf(period) {
  const [year, month] = String(period).split('-').map(Number)
  if (!year || !month) return todayISO()
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period}-${String(day).padStart(2, '0')}`
}

function dateText(value) {
  if (!value) return '—'
  const date = new Date(String(value).slice(0, 10) + 'T12:00:00')
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

function periodBadge(status) {
  if (status === 'PAID') return <CycleStatus status="paid" label="Dibayar" />
  if (status === 'APPROVED') return <CycleStatus status="progress" label="Disetujui" />
  return <CycleStatus status="planned" label="Draft" />
}

function controlBadge(status, label) {
  if (status === 'OK') return <span className="cycle-control-badge is-ok"><CheckCircle2 size={12} /> {label || 'Sesuai'}</span>
  if (status === 'MISMATCH') return <span className="cycle-control-badge is-mismatch"><XCircle size={12} /> {label || 'Selisih'}</span>
  return <span className="cycle-control-badge is-pending">{label || 'Belum diperiksa'}</span>
}

function emptyEmployee() {
  return {
    employee_code: '',
    name: '',
    department: '',
    position: '',
    employment_type: 'PKWTT',
    status: 'ACTIVE',
    join_date: todayISO(),
    exit_date: '',
    ptkp_status: 'TK0',
    npwp: '',
    bank_name: '',
    bank_account: '',
    basic_salary: 0,
    fixed_allowance: 0,
    jkk_risk_class: 1,
    family_members: 0,
    is_expatriate: false,
    reason: '',
    original: null
  }
}

function employeeToDraft(employee) {
  return {
    ...emptyEmployee(),
    ...employee,
    original: { ...employee },
    reason: '',
    exit_date: employee.exit_date || '',
    npwp: employee.npwp || '',
    bank_name: employee.bank_name || '',
    bank_account: employee.bank_account || '',
    is_expatriate: Number(employee.is_expatriate) === 1
  }
}

function comparable(field, value) {
  if (field === 'is_expatriate') return Number(Boolean(value))
  if (NULLABLE_FIELDS.includes(field)) return String(value || '')
  if (NUMERIC_FIELDS.includes(field)) return Number(value || 0)
  return String(value ?? '')
}

function inputToDraft(input) {
  return {
    absent_days: input?.absent_days ?? 0,
    overtime_hours: input?.overtime_hours ?? 0,
    holiday_overtime_hours: input?.holiday_overtime_hours ?? 0,
    thr_amount: input?.thr_amount ?? 0,
    other_allowance: input?.other_allowance ?? 0,
    other_deduction: input?.other_deduction ?? 0,
    notes: input?.notes || ''
  }
}

function readCalculation(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function fetchPayrollJournals() {
  const response = await request('/api/payroll/journals')
  return Array.isArray(response?.journals) ? response.journals : []
}

function DetailRow({ label, note = '', value }) {
  return (
    <div className="cycle-breakdown-row">
      <span>{label}</span>
      <span>{note}</span>
      <strong>{money(value)}</strong>
    </div>
  )
}

function JournalList({ entries, limit }) {
  const shown = limit ? entries.slice(0, limit) : entries
  return (
    <div className="cycle-journal-list">
      {shown.map((entry) => {
        const lines = entry.lines || []
        const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
        return (
          <article className="cycle-journal-entry" key={entry.id || entry.voucher_no}>
            <div className="cycle-journal-head">
              <div>
                <strong>{entry.description || 'Jurnal penggajian'}</strong>
                <small>{entry.voucher_no} <i>·</i> {dateText(entry.entry_date)}</small>
              </div>
              <b>{money(debit)}</b>
            </div>
            <div className="cycle-journal-lines">
              {lines.map((line, index) => (
                <div key={`${entry.id || entry.voucher_no}-${index}`}>
                  <span>
                    <em>{Number(line.debit || 0) > 0 ? 'Debit' : 'Kredit'}</em>
                    {line.account_name || line.code || '—'}
                  </span>
                  <strong>{money(Number(line.debit || 0) || Number(line.credit || 0))}</strong>
                </div>
              ))}
              {!lines.length && <div><span>Tidak ada rincian baris.</span><strong>—</strong></div>}
            </div>
          </article>
        )
      })}
      {!shown.length && <CycleEmpty>Belum ada jurnal payroll yang diposting.</CycleEmpty>}
    </div>
  )
}

// Fungsi default harus stabil: efek periodik bergantung pada prop ini.
const NOOP = () => {}

export function PayrollCycleView({ notify = NOOP }) {
  const [view, setView] = useState('summary')
  const [employees, setEmployees] = useState([])
  const [periods, setPeriods] = useState([])
  const [parameters, setParameters] = useState(null)
  const [journals, setJournals] = useState([])
  const [changeRequests, setChangeRequests] = useState([])
  const [lines, setLines] = useState([])
  const [documents, setDocuments] = useState([])
  const [controls, setControls] = useState([])
  const [controlSuggested, setControlSuggested] = useState({
    payeeCount: 0, calculatedCount: 0, netTotal: 0, accountingTotal: 0
  })
  const [linesVersion, setLinesVersion] = useState(0)
  const [activePeriodId, setActivePeriodId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [employeeModal, setEmployeeModal] = useState(null)
  const [periodModal, setPeriodModal] = useState(false)
  const [periodDraft, setPeriodDraft] = useState({ period: todayISO().slice(0, 7), pay_date: '' })
  const [inputModal, setInputModal] = useState(null)
  const [slipModal, setSlipModal] = useState(null)
  const [documentModal, setDocumentModal] = useState(null)
  const [verificationDraft, setVerificationDraft] = useState({ verified_count: '', operator_role: 'SDM', note: '' })
  const [reconciliationDraft, setReconciliationDraft] = useState({ bank_total: '', operator_role: 'AKUNTANSI', note: '' })
  const [query, setQuery] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [employeeResult, periodResult, parameterResult, journalResult, requestResult] = await Promise.allSettled([
      request('/api/payroll/employees'),
      request('/api/payroll/periods'),
      request('/api/payroll/parameters'),
      fetchPayrollJournals(),
      request('/api/payroll/change-requests')
    ])
    const failures = []
    if (employeeResult.status === 'fulfilled') {
      setEmployees(employeeResult.value?.employees || [])
    } else {
      setEmployees([])
      failures.push(`Data karyawan: ${employeeResult.reason?.message || 'gagal dimuat.'}`)
    }
    if (periodResult.status === 'fulfilled') {
      setPeriods(periodResult.value?.periods || [])
    } else {
      setPeriods([])
      failures.push(`Data periode penggajian: ${periodResult.reason?.message || 'gagal dimuat.'} Pastikan server Finova sudah berjalan.`)
    }
    if (parameterResult.status === 'fulfilled') setParameters(parameterResult.value)
    if (journalResult.status === 'fulfilled') setJournals(journalResult.value || [])
    if (requestResult.status === 'fulfilled') setChangeRequests(requestResult.value?.requests || [])
    else failures.push(`Persetujuan perubahan: ${requestResult.reason?.message || 'gagal dimuat.'}`)
    setLoadError(failures.join(' '))
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (!periods.length) {
      if (activePeriodId !== null) setActivePeriodId(null)
      return
    }
    if (!periods.some((period) => period.id === activePeriodId)) setActivePeriodId(periods[0].id)
  }, [periods, activePeriodId])

  useEffect(() => {
    if (activePeriodId === null) {
      setLines([])
      setDocuments([])
      setControls([])
      return
    }
    let cancelled = false
    Promise.allSettled([
      request(`/api/payroll/periods/${activePeriodId}/lines`),
      request(`/api/payroll/periods/${activePeriodId}/documents`),
      request(`/api/payroll/periods/${activePeriodId}/controls`)
    ]).then(([lineResult, documentResult, controlResult]) => {
      if (cancelled) return
      setLines(lineResult.status === 'fulfilled' ? lineResult.value?.lines || [] : [])
      setDocuments(documentResult.status === 'fulfilled' ? documentResult.value?.documents || [] : [])
      if (lineResult.status === 'rejected') notify(lineResult.reason?.message || 'Gagal memuat daftar gaji.', true)
      if (controlResult.status !== 'fulfilled') return
      const suggested = controlResult.value?.suggested || {}
      const checks = controlResult.value?.checks || []
      setControlSuggested({
        payeeCount: Number(suggested.payeeCount || 0),
        calculatedCount: Number(suggested.calculatedCount || 0),
        netTotal: Number(suggested.netTotal || 0),
        accountingTotal: Number(suggested.accountingTotal || 0)
      })
      setControls(checks)
      const verification = checks.find((check) => check.kind === 'PAYEE_VERIFICATION')
      const reconciliation = checks.find((check) => check.kind === 'RECONCILIATION')
      setVerificationDraft({
        verified_count: verification ? String(verification.actual_value) : '',
        operator_role: verification?.operator_role || 'SDM',
        note: verification?.note || ''
      })
      setReconciliationDraft({
        bank_total: reconciliation ? String(reconciliation.actual_value) : '',
        operator_role: reconciliation?.operator_role || 'AKUNTANSI',
        note: reconciliation?.note || ''
      })
    })
    return () => { cancelled = true }
  }, [activePeriodId, linesVersion, notify])

  const activePeriod = useMemo(
    () => periods.find((period) => period.id === activePeriodId) || null,
    [periods, activePeriodId]
  )
  const isDraft = activePeriod?.status === 'DRAFT'
  const activeCount = employees.filter((employee) => employee.status === 'ACTIVE').length
  const grossTotal = lines.reduce((sum, line) => sum + Number(line.run?.gross_cash || 0), 0)
  const netTotal = lines.reduce((sum, line) => sum + Number(line.run?.net_pay || 0), 0)
  const calculatedCount = lines.filter((line) => line.run).length
  const pendingRequests = changeRequests.filter((request) => request.status === 'PENDING')
  const verifiedDocuments = documents.filter((document) => document.status === 'VERIFIED').length
  const verificationCheck = controls.find((check) => check.kind === 'PAYEE_VERIFICATION')
  const reconciliationCheck = controls.find((check) => check.kind === 'RECONCILIATION')

  const ptkpOptions = Object.keys(parameters?.ptkp || {}).length
    ? Object.keys(parameters.ptkp)
    : PTKP_FALLBACK
  const jkkRates = parameters?.jkkRates || []

  const filteredEmployees = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id')
    return employees.filter((employee) => !needle || [
      employee.employee_code,
      employee.name,
      employee.department,
      employee.position
    ].some((value) => String(value || '').toLocaleLowerCase('id').includes(needle)))
  }, [employees, query])

  const periodJournals = journals.filter((entry) => {
    if (!activePeriod) return false
    const voucher = String(entry.voucher_no || '')
    const description = String(entry.description || '')
    return voucher.startsWith(`PAY-${activePeriod.period}-`) || description.includes(activePeriod.period)
  })

  function refreshPeriodData() {
    setLinesVersion((version) => version + 1)
  }

  function openEmployeeModal(employee) {
    setEmployeeModal(employee ? employeeToDraft(employee) : emptyEmployee())
  }

  function patchEmployee(key, value) {
    setEmployeeModal((current) => ({ ...current, [key]: value }))
  }

  async function saveEmployee(event) {
    event.preventDefault()
    const draft = employeeModal
    if (!draft) return
    if (!draft.employee_code.trim() || !draft.name.trim() || !draft.join_date) {
      notify('Kode karyawan, nama, dan tanggal masuk wajib diisi.', true)
      return
    }
    if (Number(draft.basic_salary || 0) < 0 || Number(draft.fixed_allowance || 0) < 0) {
      notify('Gaji pokok dan tunjangan tetap tidak boleh negatif.', true)
      return
    }
    const payload = {
      employee_code: draft.employee_code.trim().toUpperCase(),
      name: draft.name.trim(),
      department: draft.department,
      position: draft.position,
      employment_type: draft.employment_type,
      status: draft.status,
      join_date: draft.join_date,
      exit_date: draft.exit_date,
      ptkp_status: draft.ptkp_status,
      npwp: draft.npwp,
      bank_name: draft.bank_name,
      bank_account: draft.bank_account,
      basic_salary: Number(draft.basic_salary || 0),
      fixed_allowance: Number(draft.fixed_allowance || 0),
      jkk_risk_class: Number(draft.jkk_risk_class || 1),
      family_members: Number(draft.family_members || 0),
      is_expatriate: Boolean(draft.is_expatriate)
    }
    try {
      if (draft.id) {
        const reason = String(draft.reason || '').trim()
        if (!reason) {
          notify('Alasan perubahan wajib diisi agar perubahan dapat disetujui.', true)
          return
        }
        const changed = CHANGE_FIELDS.filter(
          (field) => comparable(field, draft.original?.[field]) !== comparable(field, payload[field])
        )
        if (!changed.length) {
          notify('Tidak ada perubahan yang diajukan.')
          setEmployeeModal(null)
          return
        }
        for (const field of changed) {
          await request('/api/payroll/change-requests', {
            method: 'POST',
            body: {
              employee_id: draft.id,
              field_name: field,
              new_value: payload[field],
              reason,
              requested_by_role: 'SDM'
            }
          })
        }
        notify(`${changed.length} perubahan diajukan untuk disetujui bagian terkait.`)
      } else {
        await request('/api/payroll/employees', { method: 'POST', body: payload })
        notify('Karyawan baru berhasil ditambahkan.')
      }
      setEmployeeModal(null)
      await loadAll()
      refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    }
  }

  async function decideRequest(id, decision) {
    setBusy(true)
    try {
      await request(`/api/payroll/change-requests/${id}/decide`, {
        method: 'POST',
        body: {
          decision,
          note: decision === 'APPROVED' ? 'Disetujui sesuai ketentuan perubahan data karyawan.' : 'Ditolak oleh penanggung jawab.'
        }
      })
      notify(decision === 'APPROVED' ? 'Perubahan disetujui dan diterapkan pada data karyawan.' : 'Perubahan ditolak.')
      await loadAll()
      refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal memproses persetujuan.', true)
    } finally {
      setBusy(false)
    }
  }

  async function deactivateEmployee(employee) {
    if (!window.confirm(`Nonaktifkan karyawan ${employee.name} (${employee.employee_code})?`)) return
    try {
      await request(`/api/payroll/employees/${employee.id}`, { method: 'DELETE' })
      notify('Karyawan berhasil dinonaktifkan.')
      await loadAll()
      refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    }
  }

  function openPeriodModal() {
    const period = todayISO().slice(0, 7)
    setPeriodDraft({ period, pay_date: lastDayOf(period) })
    setPeriodModal(true)
  }

  function patchPeriod(key, value) {
    setPeriodDraft((current) => ({ ...current, [key]: value }))
  }

  async function savePeriod(event) {
    event.preventDefault()
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodDraft.period)) {
      notify('Periode harus berformat YYYY-MM.', true)
      return
    }
    try {
      const result = await request('/api/payroll/periods', {
        method: 'POST',
        body: { period: periodDraft.period, pay_date: periodDraft.pay_date || lastDayOf(periodDraft.period) }
      })
      notify('Periode penggajian berhasil dibuat.')
      setPeriodModal(false)
      await loadAll()
      setActivePeriodId(result.id)
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    }
  }

  async function runAction(path, message, periodId) {
    setBusy(true)
    try {
      const result = await request(path, { method: 'POST' })
      notify(message)
      if (Array.isArray(result?.warnings) && result.warnings.length) {
        notify(result.warnings.join(' '), true)
      }
      await loadAll()
      if (periodId === activePeriodId) refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    } finally {
      setBusy(false)
    }
  }

  function openInputModal(line) {
    const draft = inputToDraft(line.input)
    if (!line.input && line.thr_suggestion) draft.thr_amount = line.thr_suggestion
    setInputModal({ line, draft })
  }

  function patchInput(key, value) {
    setInputModal((current) => ({ ...current, draft: { ...current.draft, [key]: value } }))
  }

  async function saveInput(event) {
    event.preventDefault()
    if (!activePeriod || !inputModal) return
    const draft = inputModal.draft
    try {
      await request(`/api/payroll/periods/${activePeriod.id}/inputs/${inputModal.line.employee.id}`, {
        method: 'PUT',
        body: {
          absent_days: Number(draft.absent_days || 0),
          overtime_hours: Number(draft.overtime_hours || 0),
          holiday_overtime_hours: Number(draft.holiday_overtime_hours || 0),
          thr_amount: Number(draft.thr_amount || 0),
          other_allowance: Number(draft.other_allowance || 0),
          other_deduction: Number(draft.other_deduction || 0),
          notes: draft.notes
        }
      })
      notify('Input kehadiran dan lembur berhasil disimpan.')
      setInputModal(null)
      refreshPeriodData()
      await loadAll()
    } catch (err) {
      notify(err.message || 'Gagal memproses permintaan.', true)
    }
  }

  function openDocumentModal(document) {
    setDocumentModal({
      ...document,
      reference_no: document.reference_no || '',
      doc_date: document.doc_date || '',
      title: document.title || document.label,
      status: document.status || 'DRAFT',
      note: document.note || ''
    })
  }

  function patchDocument(key, value) {
    setDocumentModal((current) => ({ ...current, [key]: value }))
  }

  async function saveDocument(event) {
    event.preventDefault()
    if (!activePeriod || !documentModal) return
    try {
      await request(`/api/payroll/periods/${activePeriod.id}/documents`, {
        method: 'POST',
        body: {
          doc_type: documentModal.doc_type,
          reference_no: documentModal.reference_no,
          doc_date: documentModal.doc_date,
          title: documentModal.title,
          status: documentModal.status,
          note: documentModal.note
        }
      })
      notify('Dokumen periode berhasil disimpan.')
      setDocumentModal(null)
      refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan dokumen.', true)
    }
  }

  async function deleteDocument(id) {
    if (!window.confirm('Hapus catatan dokumen ini?')) return
    try {
      await request(`/api/payroll/documents/${id}`, { method: 'DELETE' })
      notify('Catatan dokumen dihapus.')
      refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal menghapus dokumen.', true)
    }
  }

  async function saveControl(kind, draft) {
    if (!activePeriod) return
    setBusy(true)
    try {
      const body = kind === 'PAYEE_VERIFICATION'
        ? { kind, verified_count: Number(draft.verified_count || 0), operator_role: draft.operator_role, note: draft.note }
        : { kind, bank_total: Number(draft.bank_total || 0), operator_role: draft.operator_role, note: draft.note }
      const result = await request(`/api/payroll/periods/${activePeriod.id}/controls`, { method: 'POST', body })
      if (result.status === 'OK') {
        notify(kind === 'PAYEE_VERIFICATION' ? 'Daftar penerima gaji terverifikasi.' : 'Rekonsiliasi gaji dan bank sesuai.')
      } else {
        notify(`Pemeriksaan menyatakan selisih ${money(result.difference)}. Periksa kembali datanya.`, true)
      }
      refreshPeriodData()
    } catch (err) {
      notify(err.message || 'Gagal menyimpan pemeriksaan.', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <CycleIntro
        number="04"
        title="Siklus Penggajian / SDM"
        description="Mengelola data karyawan, kehadiran, perhitungan gaji, pembayaran, pencatatan akuntansi, dokumen, dan pengendalian internal sesuai BAB V Sistem Informasi Akuntansi."
        actions={<><Button variant="secondary" onClick={openPeriodModal}><CalendarDays size={15} /> Tambah periode</Button><Button onClick={() => openEmployeeModal(null)}><Plus size={15} /> Tambah karyawan</Button></>}
      />
      <CycleTabs value={view} items={VIEWS} onChange={setView} />
      <div className="cycle-page-label">
        <span>{VIEWS.find(([key]) => key === view)?.[1]}</span>
        <span>{activeCount} karyawan aktif <i>·</i> {periods.length} periode {activePeriod ? <><i>·</i> {periodLabel(activePeriod.period)}</> : null}</span>
      </div>

      <ErrorNotice error={loadError} />
      {loading && <CycleEmpty>Memuat data penggajian dari server…</CycleEmpty>}

      {!loading && view === 'summary' && <>
        <div className="cycle-metrics">
          <CycleMetric label="Karyawan aktif" value={activeCount} note={`${employees.length} karyawan terdaftar`} Icon={Users} />
          <CycleMetric label="Gaji kotor periode ini" value={grossTotal} note={calculatedCount ? `${calculatedCount} dari ${lines.length} baris dihitung` : 'Belum ada hasil perhitungan'} Icon={WalletCards} tone="is-amber" />
          <CycleMetric label="Gaji bersih periode ini" value={netTotal} note={activePeriod ? `Status ${activePeriod.status.toLowerCase()}` : 'Pilih periode terlebih dahulu'} Icon={Banknote} tone="is-green" />
          <CycleMetric label="Dokumen terverifikasi" value={`${verifiedDocuments}/8`} note={activePeriod ? `Periode ${periodLabel(activePeriod.period)}` : 'Belum ada periode'} Icon={FolderOpen} tone="is-blue" />
        </div>

        <div className="cycle-two-column">
          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Lima aktivitas siklus penggajian</h2><p>Alur dari data karyawan sampai pencatatan akuntansi (slide 27).</p></div><ClipboardList size={18} /></div>
            {ACTIVITY_STEPS.map(([title, note, role], index) => (
              <div className="cycle-check-row" key={title}>
                <span className="cycle-check-mark">{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{title}</strong><small>{note}</small></span>
                <span className="cycle-role-tag">{role}</span>
              </div>
            ))}
          </section>

          <section className="panel cycle-card">
            <div className="cycle-card-heading"><div><h2>Tujuan & komponen perhitungan</h2><p>Slide 26 dan slide 28 BAB V.</p></div><Calculator size={18} /></div>
            <ul className="cycle-goal-list">
              {PAYROLL_GOALS.map((goal) => <li key={goal}>{goal}</li>)}
            </ul>
            <div className="cycle-formula"><strong>Gaji Bersih = Gaji Bruto − Total Potongan</strong></div>
            <div className="cycle-formula"><small>Bruto = gaji pokok + tunjangan + upah lembur</small></div>
            <div className="cycle-formula"><small>Potongan = PPh 21 + iuran BPJS karyawan + potongan lain</small></div>
          </section>
        </div>

        <section className="panel panel-tight cycle-recent" style={{ marginTop: 16 }}>
          <div className="cycle-table-heading"><div><h2>Periode terbaru</h2><p>Klik baris untuk memilih periode aktif.</p></div><Button small variant="ghost" onClick={() => setView('periods')}>Lihat semua</Button></div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Periode</th><th>Tanggal bayar</th><th>Status</th><th>Disetujui</th><th>Dibayar</th></tr></thead>
            <tbody>
              {periods.slice(0, 5).map((period) => (
                <tr key={period.id} onClick={() => setActivePeriodId(period.id)} style={{ cursor: 'pointer' }}>
                  <td><strong className="cycle-id">{periodLabel(period.period)}</strong><small>{period.id === activePeriodId ? `${period.period} · aktif` : period.period}</small></td>
                  <td>{dateText(period.pay_date)}</td>
                  <td>{periodBadge(period.status)}</td>
                  <td>{dateText(period.approved_at)}</td>
                  <td>{dateText(period.paid_at)}</td>
                </tr>
              ))}
              {!periods.length && <tr><td className="cycle-empty" colSpan={5}>Belum ada periode penggajian.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section className="panel cycle-card" style={{ marginTop: 16 }}>
          <div className="cycle-card-heading"><div><h2>Jurnal payroll terbaru</h2><p>Jurnal akrual dan pembayaran yang dibuat otomatis oleh sistem.</p></div><FileText size={18} /></div>
          <JournalList entries={journals} limit={3} />
        </section>
      </>}

      {!loading && view === 'employees' && <>
        <section className="panel cycle-card" style={{ marginBottom: 16 }}>
          <div className="cycle-card-heading"><div><h2>Persetujuan perubahan data karyawan</h2><p>Slide 30: perubahan data karyawan dan gaji harus mendapat persetujuan sebelum periode disetujui.</p></div><ShieldCheck size={18} /></div>
          {pendingRequests.length ? pendingRequests.map((request) => (
            <div className="cycle-check-row" key={request.id}>
              <span className="cycle-check-mark">PR</span>
              <span>
                <strong>{request.employee_name} — {FIELD_LABELS[request.field_name] || request.field_name}</strong>
                <small>{String(request.old_value || '—')} → {String(request.new_value || '—')} · {request.reason} · diajukan oleh {request.requested_by_role}</small>
              </span>
              <span className="cycle-inline-actions">
                <Button small disabled={busy} onClick={() => decideRequest(request.id, 'APPROVED')}>Setujui</Button>
                <Button small variant="secondary" disabled={busy} onClick={() => decideRequest(request.id, 'REJECTED')}>Tolak</Button>
              </span>
            </div>
          )) : <CycleEmpty>Tidak ada perubahan karyawan yang menunggu persetujuan.</CycleEmpty>}
        </section>

        <section className="panel panel-tight cycle-table-panel">
          <div className="cycle-table-heading">
            <div><h2>Data induk karyawan</h2><p>Identitas, jabatan, status kepegawaian, dan gaji yang dipakai dalam perhitungan.</p></div>
            <label className="cycle-search"><span className="sr-only">Cari karyawan</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari kode, nama, atau bagian" /></label>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Kode</th><th>Nama</th><th>Bagian / jabatan</th><th>Kontrak</th><th>PTKP</th><th className="num">Gaji pokok</th><th className="num">Tunjangan</th><th>Status</th><th /></tr></thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td><strong className="cycle-id">{employee.employee_code}</strong></td>
                  <td className="cycle-party"><strong>{employee.name}</strong><small>{employee.npwp || 'NPWP belum diisi'}</small></td>
                  <td>{employee.department || '—'}<small>{employee.position || '—'}</small></td>
                  <td>{employee.employment_type}</td>
                  <td>{employee.ptkp_status}</td>
                  <td className="num">{money(employee.basic_salary)}</td>
                  <td className="num">{money(employee.fixed_allowance)}</td>
                  <td><CycleStatus status={employee.status === 'ACTIVE' ? 'paid' : 'overdue'} label={employee.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'} /></td>
                  <td className="cycle-action-cell">
                    <Button small variant="ghost" onClick={() => openEmployeeModal(employee)} aria-label={`Ubah ${employee.name}`}><Pencil size={13} /> Ubah</Button>
                    {employee.status === 'ACTIVE' && <Button small variant="secondary" onClick={() => deactivateEmployee(employee)}>Nonaktifkan</Button>}
                  </td>
                </tr>
              ))}
              {!filteredEmployees.length && <tr><td className="cycle-empty" colSpan={9}>Belum ada karyawan. Tambahkan karyawan untuk memulai.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </>}

      {!loading && view === 'periods' && <section className="panel panel-tight cycle-table-panel">
        <div className="cycle-table-heading"><div><h2>Periode & kehadiran</h2><p>Klik baris untuk memilih periode aktif. Hitung → setujui → bayar sesuai lima aktivitas PPT.</p></div><Button small onClick={openPeriodModal}><Plus size={15} /> Tambah periode</Button></div>
        {pendingRequests.length > 0 && <div className="cycle-form-hint" style={{ color: '#8a5a2b' }}>{pendingRequests.length} perubahan data karyawan masih menunggu persetujuan; periode belum dapat disetujui.</div>}
        <div className="cycle-table-wrap"><table className="cycle-table">
          <thead><tr><th>Periode</th><th>Tanggal bayar</th><th>Status</th><th>Disetujui</th><th>Dibayar</th><th>Aksi</th></tr></thead>
          <tbody>
            {periods.map((period) => (
              <tr key={period.id} onClick={() => setActivePeriodId(period.id)} style={{ cursor: 'pointer' }}>
                <td><strong className="cycle-id">{periodLabel(period.period)}</strong><small>{period.id === activePeriodId ? `${period.period} · aktif` : period.period}</small></td>
                <td>{dateText(period.pay_date)}</td>
                <td>{periodBadge(period.status)}</td>
                <td>{dateText(period.approved_at)}</td>
                <td>{dateText(period.paid_at)}</td>
                <td className="cycle-action-cell" onClick={(event) => event.stopPropagation()}>
                  {period.status === 'DRAFT' && <>
                    <Button small variant="secondary" disabled={busy} onClick={() => runAction(`/api/payroll/periods/${period.id}/run`, 'Perhitungan gaji selesai.', period.id)}><Calculator size={13} /> Hitung gaji</Button>
                    <Button small disabled={busy} onClick={() => runAction(`/api/payroll/periods/${period.id}/approve`, 'Periode disetujui. Jurnal akrual telah dibuat.', period.id)}>Setujui</Button>
                  </>}
                  {period.status === 'APPROVED' && <Button small disabled={busy} onClick={() => runAction(`/api/payroll/periods/${period.id}/pay`, 'Gaji dibayar. Jurnal pembayaran telah dibuat.', period.id)}>Bayar</Button>}
                  {period.status === 'PAID' && <span className="muted">Selesai</span>}
                </td>
              </tr>
            ))}
            {!periods.length && <tr><td className="cycle-empty" colSpan={6}>Belum ada periode. Buat periode untuk mulai mengolah daftar gaji.</td></tr>}
          </tbody>
        </table></div>
      </section>}

      {!loading && view === 'payroll' && <>
        {!activePeriod ? <section className="panel panel-tight cycle-table-panel">
          <CycleEmpty>Belum ada periode penggajian. Buat periode terlebih dahulu untuk melihat daftar gaji.</CycleEmpty>
          <div style={{ padding: '0 20px 20px', textAlign: 'center' }}><Button onClick={() => { setView('periods'); openPeriodModal() }}><Plus size={15} /> Buat periode</Button></div>
        </section> : <section className="panel panel-tight cycle-table-panel">
          <div className="cycle-table-heading">
            <div><h2>Daftar gaji {periodLabel(activePeriod.period)}</h2><p>Status {activePeriod.status.toLowerCase()} · {calculatedCount} dari {lines.length} karyawan sudah dihitung. Gaji bersih = gaji bruto − total potongan.</p></div>
            <Button small variant="secondary" disabled={!isDraft || busy} onClick={() => runAction(`/api/payroll/periods/${activePeriod.id}/run`, 'Perhitungan gaji selesai.', activePeriod.id)}><RefreshCw size={13} /> Hitung ulang</Button>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>Karyawan</th><th>Status pajak</th><th className="num">Gaji kotor</th><th className="num">BPJS karyawan</th><th className="num">PPh 21</th><th className="num">Gaji bersih</th><th>Status hitung</th><th /></tr></thead>
            <tbody>
              {lines.map((line) => {
                const run = line.run
                const employeeBpjs = Number(run?.bpjs_kesehatan_employee || 0) + Number(run?.jht_employee || 0) + Number(run?.jp_employee || 0)
                return (
                  <tr key={line.employee.id}>
                    <td className="cycle-party"><strong>{line.employee.name}</strong><small>{line.employee.employee_code} · {line.employee.department || '—'}</small></td>
                    <td>{run ? `${run.tax_mode} · ${run.tax_category || 'Progresif'}` : '—'}</td>
                    <td className="num">{run ? money(run.gross_cash) : '—'}</td>
                    <td className="num">{run ? money(employeeBpjs) : '—'}</td>
                    <td className="num">{run ? money(run.pph21) : '—'}</td>
                    <td className="num">{run ? money(run.net_pay) : '—'}</td>
                    <td>{run ? <CycleStatus status="complete" label="Dihitung" /> : <CycleStatus status="planned" label="Belum dihitung" />}</td>
                    <td className="cycle-action-cell">
                      <Button small variant="ghost" disabled={!run} onClick={() => setSlipModal(line)}>Lihat slip</Button>
                      {isDraft && <Button small variant="secondary" onClick={() => openInputModal(line)}><ClipboardList size={13} /> Input kehadiran</Button>}
                    </td>
                  </tr>
                )
              })}
              {!lines.length && <tr><td className="cycle-empty" colSpan={8}>Belum ada karyawan aktif untuk periode ini.</td></tr>}
            </tbody>
          </table></div>
        </section>}
      </>}

      {!loading && view === 'documents' && <>
        {!activePeriod ? <section className="panel panel-tight cycle-table-panel"><CycleEmpty>Buat periode terlebih dahulu untuk mengelola dokumen penggajian.</CycleEmpty></section> : <section className="panel panel-tight cycle-table-panel">
          <div className="cycle-table-heading">
            <div><h2>Dokumen periode {periodLabel(activePeriod.period)}</h2><p>Delapan dokumen siklus penggajian sesuai slide 28 BAB V.pptx. {verifiedDocuments} dari {documents.length || 8} sudah terverifikasi.</p></div>
          </div>
          <div className="cycle-table-wrap"><table className="cycle-table">
            <thead><tr><th>No</th><th>Dokumen</th><th>Nomor referensi</th><th>Tanggal</th><th>Status</th><th /></tr></thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.doc_type}>
                  <td><strong className="cycle-id">{String(document.order).padStart(2, '0')}</strong></td>
                  <td className="cycle-party"><strong>{document.label}</strong><small>{document.description}</small></td>
                  <td>{document.reference_no || '—'}<small>{document.title || ''}</small></td>
                  <td>{dateText(document.doc_date)}</td>
                  <td>{document.status === 'VERIFIED' ? <CycleStatus status="complete" label="Terverifikasi" /> : <CycleStatus status="planned" label={document.id ? 'Draft' : 'Belum ada'} />}</td>
                  <td className="cycle-action-cell">
                    <Button small variant="ghost" disabled={activePeriod.status === 'PAID'} onClick={() => openDocumentModal(document)}><Pencil size={13} /> Isi</Button>
                    {document.id && <Button small variant="secondary" disabled={activePeriod.status === 'PAID'} onClick={() => deleteDocument(document.id)}>Hapus</Button>}
                  </td>
                </tr>
              ))}
              {!documents.length && <tr><td className="cycle-empty" colSpan={6}>Dokumen tidak dapat dimuat dari server.</td></tr>}
            </tbody>
          </table></div>
        </section>}
      </>}

      {!loading && view === 'journal' && <>
        <section className="panel cycle-card">
          <div className="cycle-card-heading"><div><h2>Jurnal payroll</h2><p>Jurnal akrual dibuat saat periode disetujui; jurnal pembayaran dibuat saat gaji dibayar.</p></div><FileText size={18} /></div>
          <JournalList entries={journals} />
        </section>
        <section className="panel cycle-card" style={{ marginTop: 16 }}>
          <div className="cycle-card-heading"><div><h2>Contoh jurnal pada BAB V</h2><p>Gaji dan tunjangan bruto Rp5.000.000, potongan Rp500.000, gaji bersih Rp4.500.000.</p></div><BookOpen size={18} /></div>
          <div className="cycle-two-column">
            <div>
              <p className="cycle-form-intro">Pengakuan beban dan utang gaji</p>
              <DetailRow label="Beban Gaji" note="Debit" value={5_000_000} />
              <DetailRow label="Utang Potongan Gaji" note="Kredit" value={500_000} />
              <DetailRow label="Utang Gaji" note="Kredit" value={4_500_000} />
            </div>
            <div>
              <p className="cycle-form-intro">Pembayaran gaji bersih</p>
              <DetailRow label="Utang Gaji" note="Debit" value={4_500_000} />
              <DetailRow label="Bank" note="Kredit" value={4_500_000} />
            </div>
          </div>
          <p className="cycle-form-hint">Pada sistem ini “Utang Potongan Gaji” dipecah menjadi 2130 Utang BPJS, 2140 Utang PPh 21, dan 2150 Utang Potongan Lain. “Utang Gaji” memakai akun 2110 dan “Bank” memakai akun 1110.</p>
        </section>
      </>}

      {!loading && view === 'controls' && <>
        {!activePeriod ? <section className="panel panel-tight cycle-table-panel"><CycleEmpty>Buat periode terlebih dahulu untuk melakukan pengendalian internal.</CycleEmpty></section> : <>
          <div className="cycle-two-column">
            <section className="panel cycle-card">
              <div className="cycle-card-heading"><div><h2>Pemisahan tugas</h2><p>Slide 30: SDM, pencatatan waktu, penggajian, dan pembayaran tidak digabung.</p></div><ShieldCheck size={18} /></div>
              {CONTROL_DUTIES.map(([role, note], index) => (
                <div className="cycle-check-row" key={role}>
                  <span className="cycle-check-mark">{String(index + 1).padStart(2, '0')}</span>
                  <span><strong>{role}</strong><small>{note}</small></span>
                </div>
              ))}
              <p className="cycle-form-hint">Perubahan data karyawan diajukan oleh SDM dan diterapkan hanya setelah disetujui. Periode dengan perubahan pending tidak dapat disetujui.</p>
            </section>

            <section className="panel cycle-card">
              <div className="cycle-card-heading"><div><h2>Verifikasi daftar penerima gaji</h2><p>Pastikan jumlah penerima sesuai daftar gaji sebelum pembayaran.</p></div><Users size={18} /></div>
              <div style={{ marginBottom: 10 }}>{controlBadge(verificationCheck?.status)}</div>
              <form className="cycle-form" onSubmit={(event) => { event.preventDefault(); saveControl('PAYEE_VERIFICATION', verificationDraft) }}>
                <div className="cycle-form-grid">
                  <label className="cycle-field"><span>Jumlah penerima pada daftar gaji</span><input className="input" value={controlSuggested.payeeCount} readOnly /></label>
                  <label className="cycle-field"><span>Jumlah penerima terverifikasi</span><input className="input" type="number" min="0" value={verificationDraft.verified_count} onChange={(event) => setVerificationDraft({ ...verificationDraft, verified_count: event.target.value })} /></label>
                  <label className="cycle-field"><span>Peran petugas</span><select className="input" value={verificationDraft.operator_role} onChange={(event) => setVerificationDraft({ ...verificationDraft, operator_role: event.target.value })}><option>SDM</option><option>PENGGAJIAN</option><option>AKUNTANSI</option></select></label>
                  <label className="cycle-field cycle-field-wide"><span>Catatan</span><input className="input" value={verificationDraft.note} onChange={(event) => setVerificationDraft({ ...verificationDraft, note: event.target.value })} placeholder="Nomor daftar hadir / berita acara verifikasi" /></label>
                </div>
                <Button type="submit" small disabled={busy} style={{ marginTop: 10 }}>Simpan verifikasi</Button>
              </form>
            </section>
          </div>

          <section className="panel cycle-card" style={{ marginTop: 16 }}>
            <div className="cycle-card-heading"><div><h2>Rekonsiliasi gaji, akuntansi, dan rekening bank</h2><p>Slide 30: total gaji direkonsiliasi dengan catatan akuntansi dan rekening bank.</p></div><Landmark size={18} /></div>
            <div style={{ marginBottom: 10 }}>{controlBadge(reconciliationCheck?.status)}</div>
            <div className="cycle-breakdown">
              <div>
                <DetailRow label="Gaji bersih" note="Dari daftar gaji" value={controlSuggested.netTotal} />
                <DetailRow label="Jurnal pembayaran" note="Akun 1110 Bank" value={controlSuggested.accountingTotal} />
              </div>
              <div>
                <DetailRow label="Selisih" note="Bank − daftar gaji" value={Number(reconciliationDraft.bank_total || 0) - controlSuggested.netTotal} />
              </div>
            </div>
            <form className="cycle-form" onSubmit={(event) => { event.preventDefault(); saveControl('RECONCILIATION', reconciliationDraft) }}>
              <div className="cycle-form-grid">
                <label className="cycle-field"><span>Saldo/rekap transfer bank (Rp)</span><input className="input" type="number" min="0" step="1000" value={reconciliationDraft.bank_total} onChange={(event) => setReconciliationDraft({ ...reconciliationDraft, bank_total: event.target.value })} /></label>
                <label className="cycle-field"><span>Peran petugas</span><select className="input" value={reconciliationDraft.operator_role} onChange={(event) => setReconciliationDraft({ ...reconciliationDraft, operator_role: event.target.value })}><option>AKUNTANSI</option><option>KEUANGAN</option><option>PENGGAJIAN</option></select></label>
                <label className="cycle-field cycle-field-wide"><span>Catatan rekonsiliasi</span><input className="input" value={reconciliationDraft.note} onChange={(event) => setReconciliationDraft({ ...reconciliationDraft, note: event.target.value })} placeholder="Nomor bukti transfer / tanggal rekonsiliasi" /></label>
              </div>
              <Button type="submit" small disabled={busy} style={{ marginTop: 10 }}>Simpan rekonsiliasi</Button>
            </form>
          </section>

          <section className="panel panel-tight cycle-table-panel" style={{ marginTop: 16 }}>
            <div className="cycle-table-heading"><div><h2>Riwayat pemeriksaan</h2><p>Catatan verifikasi dan rekonsiliasi periode ini.</p></div></div>
            <div className="cycle-table-wrap"><table className="cycle-table">
              <thead><tr><th>Pemeriksaan</th><th>Harapan</th><th>Actual</th><th>Selisih</th><th>Status</th><th>Petugas</th><th>Waktu</th></tr></thead>
              <tbody>
                {controls.map((check) => (
                  <tr key={check.kind}>
                    <td><strong>{check.kind === 'PAYEE_VERIFICATION' ? 'Verifikasi penerima' : 'Rekonsiliasi bank'}</strong></td>
                    <td>{check.kind === 'PAYEE_VERIFICATION' ? check.expected_value : money(check.expected_value)}</td>
                    <td>{check.kind === 'PAYEE_VERIFICATION' ? check.actual_value : money(check.actual_value)}</td>
                    <td>{check.kind === 'PAYEE_VERIFICATION' ? check.difference : money(check.difference)}</td>
                    <td>{controlBadge(check.status)}</td>
                    <td>{check.operator_role || '—'}</td>
                    <td>{dateText(check.checked_at)}</td>
                  </tr>
                ))}
                {!controls.length && <tr><td className="cycle-empty" colSpan={7}>Belum ada pemeriksaan untuk periode ini.</td></tr>}
              </tbody>
            </table></div>
          </section>
        </>}
      </>}

      <div className="cycle-footnote"><FileText size={14} /><span>Seluruh data dan perhitungan berasal dari API Finova. Perubahan pada periode yang sudah disetujui atau dibayar tidak dapat dilakukan.</span></div>

      {employeeModal && <Modal
        title={employeeModal.id ? 'Ajukan perubahan karyawan' : 'Tambah karyawan'}
        onClose={() => setEmployeeModal(null)}
        maxWidth="720px"
        footer={<><Button variant="secondary" onClick={() => setEmployeeModal(null)}>Batal</Button><Button type="submit" form="cycle-employee-form"><Plus size={15} /> {employeeModal.id ? 'Ajukan perubahan' : 'Simpan karyawan'}</Button></>}
      >
        <form id="cycle-employee-form" className="cycle-form" onSubmit={saveEmployee}>
          <p className="cycle-form-intro">{employeeModal.id
            ? 'Perubahan data karyawan dan gaji harus disetujui sebelum periode gaji disetujui. Isi alasan perubahan di bawah.'
            : 'Kode, nama, dan tanggal masuk wajib diisi. Gaji pokok dan tunjangan tetap tidak boleh negatif.'}</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Kode karyawan</span><input className="input" required maxLength={30} value={employeeModal.employee_code} onChange={(event) => patchEmployee('employee_code', event.target.value)} placeholder="AR-005" /></label>
            <label className="cycle-field"><span>Nama karyawan</span><input className="input" required maxLength={100} value={employeeModal.name} onChange={(event) => patchEmployee('name', event.target.value)} /></label>
            <label className="cycle-field"><span>Bagian</span><input className="input" value={employeeModal.department} onChange={(event) => patchEmployee('department', event.target.value)} placeholder="Produksi" /></label>
            <label className="cycle-field"><span>Jabatan</span><input className="input" value={employeeModal.position} onChange={(event) => patchEmployee('position', event.target.value)} placeholder="Staf" /></label>
            <label className="cycle-field"><span>Jenis kontrak</span><select className="input" value={employeeModal.employment_type} onChange={(event) => patchEmployee('employment_type', event.target.value)}><option value="PKWTT">PKWTT</option><option value="PKWT">PKWT</option></select></label>
            <label className="cycle-field"><span>Status karyawan</span><select className="input" value={employeeModal.status} onChange={(event) => patchEmployee('status', event.target.value)}><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option></select></label>
            <label className="cycle-field"><span>Tanggal masuk</span><input className="input" type="date" required value={employeeModal.join_date} onChange={(event) => patchEmployee('join_date', event.target.value)} /></label>
            <label className="cycle-field"><span>Tanggal keluar</span><input className="input" type="date" value={employeeModal.exit_date} onChange={(event) => patchEmployee('exit_date', event.target.value)} /></label>
            <label className="cycle-field"><span>Status PTKP</span><select className="input" value={employeeModal.ptkp_status} onChange={(event) => patchEmployee('ptkp_status', event.target.value)}>{ptkpOptions.map((status) => <option key={status} value={status}>{status} — {money(parameters?.ptkp?.[status] || 0)}</option>)}</select></label>
            <label className="cycle-field"><span>Kelas risiko JKK</span><select className="input" value={employeeModal.jkk_risk_class} onChange={(event) => patchEmployee('jkk_risk_class', Number(event.target.value))}>{[1, 2, 3, 4, 5].map((risk) => <option key={risk} value={risk}>Kelas {risk}{jkkRates[risk - 1] !== undefined ? ` — ${String(jkkRates[risk - 1]).replace('.', ',')}%` : ''}</option>)}</select></label>
            <label className="cycle-field"><span>Gaji pokok (Rp)</span><input className="input" type="number" min="0" step="1000" value={employeeModal.basic_salary} onChange={(event) => patchEmployee('basic_salary', event.target.value)} /></label>
            <label className="cycle-field"><span>Tunjangan tetap (Rp)</span><input className="input" type="number" min="0" step="1000" value={employeeModal.fixed_allowance} onChange={(event) => patchEmployee('fixed_allowance', event.target.value)} /></label>
            <label className="cycle-field"><span>Jumlah tanggungan keluarga</span><input className="input" type="number" min="0" step="1" value={employeeModal.family_members} onChange={(event) => patchEmployee('family_members', event.target.value)} /></label>
            <label className="cycle-field"><span>NPWP</span><input className="input" value={employeeModal.npwp} onChange={(event) => patchEmployee('npwp', event.target.value)} /></label>
            <label className="cycle-field"><span>Nama bank</span><input className="input" value={employeeModal.bank_name} onChange={(event) => patchEmployee('bank_name', event.target.value)} /></label>
            <label className="cycle-field"><span>Nomor rekening</span><input className="input" value={employeeModal.bank_account} onChange={(event) => patchEmployee('bank_account', event.target.value)} /></label>
            <label className="cycle-field cycle-field-wide"><span><input type="checkbox" checked={employeeModal.is_expatriate} onChange={(event) => patchEmployee('is_expatriate', event.target.checked)} /> &nbsp;Karyawan ekspatriat (JP tidak dipotong)</span></label>
            {employeeModal.id && <label className="cycle-field cycle-field-wide"><span>Alasan perubahan <b>(wajib)</b></span><textarea className="input" rows="2" value={employeeModal.reason} onChange={(event) => patchEmployee('reason', event.target.value)} placeholder="Misalnya: SK kenaikan jabatan No. 12/2026" /></label>}
          </div>
        </form>
      </Modal>}

      {periodModal && <Modal
        title="Tambah periode penggajian"
        onClose={() => setPeriodModal(false)}
        maxWidth="520px"
        footer={<><Button variant="secondary" onClick={() => setPeriodModal(false)}>Batal</Button><Button type="submit" form="cycle-period-form"><Plus size={15} /> Simpan periode</Button></>}
      >
        <form id="cycle-period-form" className="cycle-form" onSubmit={savePeriod}>
          <p className="cycle-form-intro">Periode digunakan untuk mengelompokkan perhitungan, dokumen, dan jurnal penggajian.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Periode gaji</span><input className="input" type="month" required value={periodDraft.period} onChange={(event) => patchPeriod('period', event.target.value)} /></label>
            <label className="cycle-field"><span>Tanggal bayar</span><input className="input" type="date" required value={periodDraft.pay_date} onChange={(event) => patchPeriod('pay_date', event.target.value)} /></label>
          </div>
        </form>
      </Modal>}

      {inputModal && <Modal
        title={`Input kehadiran — ${inputModal.line.employee.name}`}
        onClose={() => setInputModal(null)}
        maxWidth="620px"
        footer={<><Button variant="secondary" onClick={() => setInputModal(null)}>Batal</Button><Button type="submit" form="cycle-input-form"><Plus size={15} /> Simpan input</Button></>}
      >
        <form id="cycle-input-form" className="cycle-form" onSubmit={saveInput}>
          <p className="cycle-form-intro">Periode {activePeriod?.period}. Absen 0–31 hari; lembur biasa dan lembur libur maksimal 80 jam.</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Hari absen</span><input className="input" type="number" min="0" max="31" value={inputModal.draft.absent_days} onChange={(event) => patchInput('absent_days', event.target.value)} /></label>
            <label className="cycle-field"><span>Lembur biasa (jam)</span><input className="input" type="number" min="0" max="80" value={inputModal.draft.overtime_hours} onChange={(event) => patchInput('overtime_hours', event.target.value)} /></label>
            <label className="cycle-field"><span>Lembur libur (jam)</span><input className="input" type="number" min="0" max="80" value={inputModal.draft.holiday_overtime_hours} onChange={(event) => patchInput('holiday_overtime_hours', event.target.value)} /></label>
            <div className="cycle-field"><span>THR / Tunjangan Hari Raya (Rp)</span><input className="input" type="number" min="0" step="1000" value={inputModal.draft.thr_amount} onChange={(event) => patchInput('thr_amount', event.target.value)} /><small>Saran prorata: {money(inputModal.line.thr_suggestion || 0)} · <button type="button" className="button ghost small" onClick={() => patchInput('thr_amount', String(inputModal.line.thr_suggestion || 0))}>pakai</button></small></div>
            <label className="cycle-field"><span>Tunjangan lain (Rp)</span><input className="input" type="number" min="0" step="1000" value={inputModal.draft.other_allowance} onChange={(event) => patchInput('other_allowance', event.target.value)} /></label>
            <label className="cycle-field"><span>Potongan lain (Rp)</span><input className="input" type="number" min="0" step="1000" value={inputModal.draft.other_deduction} onChange={(event) => patchInput('other_deduction', event.target.value)} /></label>
            <label className="cycle-field cycle-field-wide"><span>Catatan</span><textarea className="input" rows="2" value={inputModal.draft.notes} onChange={(event) => patchInput('notes', event.target.value)} /></label>
          </div>
          <p className="cycle-form-hint">Simpan input lalu jalankan Hitung gaji agar perubahan tercermin pada daftar gaji.</p>
        </form>
      </Modal>}

      {documentModal && <Modal
        title={`Dokumen — ${documentModal.label}`}
        onClose={() => setDocumentModal(null)}
        maxWidth="560px"
        footer={<><Button variant="secondary" onClick={() => setDocumentModal(null)}>Batal</Button><Button type="submit" form="cycle-document-form"><Plus size={15} /> Simpan dokumen</Button></>}
      >
        <form id="cycle-document-form" className="cycle-form" onSubmit={saveDocument}>
          <p className="cycle-form-intro">{documentModal.description}</p>
          <div className="cycle-form-grid">
            <label className="cycle-field"><span>Nomor referensi</span><input className="input" value={documentModal.reference_no} onChange={(event) => patchDocument('reference_no', event.target.value)} placeholder="SK-12/2026" /></label>
            <label className="cycle-field"><span>Tanggal dokumen</span><input className="input" type="date" value={documentModal.doc_date} onChange={(event) => patchDocument('doc_date', event.target.value)} /></label>
            <label className="cycle-field cycle-field-wide"><span>Judul / keterangan</span><input className="input" value={documentModal.title} onChange={(event) => patchDocument('title', event.target.value)} /></label>
            <label className="cycle-field"><span>Status</span><select className="input" value={documentModal.status} onChange={(event) => patchDocument('status', event.target.value)}><option value="DRAFT">Draft</option><option value="VERIFIED">Terverifikasi</option></select></label>
            <label className="cycle-field cycle-field-wide"><span>Catatan</span><textarea className="input" rows="2" value={documentModal.note} onChange={(event) => patchDocument('note', event.target.value)} /></label>
          </div>
        </form>
      </Modal>}

      {slipModal && <Modal
        title={`Slip gaji — ${slipModal.employee.name}`}
        onClose={() => setSlipModal(null)}
        maxWidth="720px"
        footer={<Button variant="secondary" onClick={() => setSlipModal(null)}>Tutup</Button>}
      >
        {(() => {
          const run = slipModal.run
          if (!run) return <CycleEmpty>Periode ini belum dihitung untuk karyawan tersebut.</CycleEmpty>
          const calc = readCalculation(run.calculation_json)
          const employeeBpjs = Number(run.bpjs_kesehatan_employee || 0) + Number(run.jht_employee || 0) + Number(run.jp_employee || 0)
          return <>
            <p className="cycle-form-intro">{slipModal.employee.employee_code} · {slipModal.employee.department || '—'} · {activePeriod ? periodLabel(activePeriod.period) : '—'} · Pajak {run.tax_mode}{run.tax_category ? ` kategori ${run.tax_category}` : ''}</p>
            <div className="cycle-breakdown">
              <div><p className="cycle-form-intro">Pendapatan</p>
                <DetailRow label="Gaji pokok" note="Upah dasar" value={calc.basic} />
                <DetailRow label="Tunjangan tetap" note="Komponen tetap" value={calc.fixedAllowance} />
                <DetailRow label="Uang lembur" note="Lembur biasa dan libur" value={run.overtime_pay} />
                <DetailRow label="THR" note="Kena PPh, tidak masuk basis BPJS" value={run.thr_amount} />
                <DetailRow label="Tunjangan lain" note="Input tambahan" value={run.other_allowance} />
                <DetailRow label="Gaji kotor" note="Total upah sebelum potongan" value={run.gross_cash} />
              </div>
              <div><p className="cycle-form-intro">Potongan karyawan</p>
                <DetailRow label="BPJS Kesehatan" note={`Dasar ${money(calc.healthBase)}`} value={run.bpjs_kesehatan_employee} />
                <DetailRow label="JHT" note="2% dari upah" value={run.jht_employee} />
                <DetailRow label="JP" note={`Dasar ${money(calc.jpBase)}`} value={run.jp_employee} />
                <DetailRow label="Bruto pajak" note="Dasar PPh 21" value={run.tax_bruto} />
                <DetailRow label="PPh 21" note={run.tax_mode === 'TER' ? `TER kategori ${run.tax_category || '—'}` : 'Pasal 17 tahunan'} value={run.pph21} />
                <DetailRow label="Potongan lain" note="Input tambahan" value={run.other_deduction} />
              </div>
              <div><p className="cycle-form-intro">Iuran pemberi kerja</p>
                <DetailRow label="BPJS Kesehatan" note="4%" value={run.bpjs_kesehatan_employer} />
                <DetailRow label="JHT" note="3,7%" value={run.jht_employer} />
                <DetailRow label="JP" note="2%" value={run.jp_employer} />
                <DetailRow label="JKK" note={`Kelas risiko · ${String(Number(calc.jkkRate || 0) * 100).replace('.', ',')}%`} value={run.jkk_employer} />
                <DetailRow label="JKM" note="0,3%" value={run.jkm_employer} />
                <DetailRow label="Total iuran employer" note="Di luar gaji kotor" value={run.employer_contribution} />
                <DetailRow label="Total biaya employer" note="Gaji kotor + iuran" value={run.employer_cost} />
              </div>
            </div>
            <div className="cycle-form-total"><span>Gaji bersih<small>Gaji kotor dikurangi BPJS karyawan ({money(employeeBpjs)}), PPh 21, dan potongan lain</small></span><strong>{money(run.net_pay)}</strong></div>
            <div className="cycle-form-total" style={{ marginTop: 8 }}><span>Dasar perhitungan<small>Upah sejam = dasar upah / 173 · PTKP tahunan</small></span><strong>{money(Number(calc.wageBasis || 0) / 173)} <small style={{ display: 'block', textAlign: 'right' }}>PTKP {money(calc.ptkp)}</small></strong></div>
            <p className="cycle-form-hint">Jurnal yang dihasilkan: {periodJournals.length} jurnal payroll untuk periode ini.</p>
            <JournalList entries={periodJournals} limit={2} />
          </>
        })()}
      </Modal>}
    </>
  )
}
