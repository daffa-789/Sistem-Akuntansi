import React, { useState } from 'react'
import {
  ArrowUpRight, CircleDollarSign, Landmark, ReceiptText, RefreshCw, WalletCards, LucideIcon
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '../ui/Button.js'
import { Badge } from '../ui/Badge.js'
import { PageLoading } from '../ui/PageLoading.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { useLoad } from '../../hooks/useLoad.js'
import { useThemeTokens } from '../../hooks/useThemeTokens.js'
import { request } from '../../api.js'
import { apiPath, dateLabel, firstDay, money, today } from '../../utils/formatters.js'

export interface DashboardData {
  cashBank: number
  receivables: number
  payables: number
  revenue: number
  expenses: number
  netIncome: number
}

const CHART_TOKENS = ['--brand-500', '--warn', '--credit', '--line', '--ink-3', '--ink-4', '--surface-3']

// "10 jt", "850 rb", "1,2 M" — sumbu Y tidak muat kalau menulis angka penuh.
function shortNumber(value: number): string {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  const fmt = (v: number, digits: number) =>
    v.toFixed(digits).replace(/\.0+$/, '').replace('.', ',')
  if (abs >= 1e9) return `${fmt(n / 1e9, 1)} M`
  if (abs >= 1e6) return `${fmt(n / 1e6, abs >= 1e7 ? 0 : 1)} jt`
  if (abs >= 1e3) return `${fmt(n / 1e3, 0)} rb`
  return String(Math.round(n))
}

interface TipProps {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string
}

function ChartTip({ active, payload, label }: TipProps): React.JSX.Element | null {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <span>{label}</span>
      <strong>{money(Number(payload[0].value) || 0)}</strong>
    </div>
  )
}

export function DashboardView(): React.JSX.Element {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
  const t = useThemeTokens(CHART_TOKENS)
  const barColor: Record<string, string> = {
    Pendapatan: t['--brand-500'],
    Beban: t['--warn'],
    Laba: t['--credit']
  }
  const { data, loading, error, reload } = useLoad<{ data: DashboardData }>(
    () => request(apiPath('/reports/dashboard', range)),
    [range.from, range.to]
  )

  if (loading) return <PageLoading message="Memuat ringkasan keuangan…" />

  const v = data?.data
  const stats: [string, number, LucideIcon][] = v
    ? [
        ['Kas & Bank', v.cashBank, WalletCards],
        ['Piutang Usaha', v.receivables, ArrowUpRight],
        ['Utang Usaha', v.payables, ReceiptText],
        ['Pendapatan', v.revenue, CircleDollarSign],
        ['Laba Bersih', v.netIncome, Landmark]
      ]
    : []

  const chart = v
    ? [
        { name: 'Pendapatan', value: v.revenue },
        { name: 'Beban', value: v.expenses },
        { name: 'Laba', value: v.netIncome }
      ]
    : []

  return (
    <>
      <div className="toolbar">
        <div>
          <h1 className="page-title">Ringkasan Keuangan</h1>
          <p className="page-copy">Pantau posisi kas, utang-piutang, serta kinerja laba rugi perusahaan.</p>
        </div>
        <div className="filter-row">
          <div className="field">
            <label htmlFor="dash-from">DARI TANGGAL</label>
            <input
              id="dash-from"
              className="input"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="dash-to">SAMPAI TANGGAL</label>
            <input
              id="dash-to"
              className="input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <Button variant="secondary" small onClick={reload} aria-label="Segarkan data ringkasan">
            <RefreshCw size={14} aria-hidden="true" /> Segarkan
          </Button>
        </div>
      </div>

      <ErrorNotice error={error} />

      <div className="stats">
        {stats.map(([label, val, Icon]) => (
          <article className="stat-card" key={label}>
            <div className="stat-label">{label}</div>
            <div className={`stat-value ${label === 'Laba Bersih' && val < 0 ? 'bad' : ''}`}>
              {money(val)}
            </div>
            <div className="stat-icon" aria-hidden="true">
              <Icon />
            </div>
          </article>
        ))}
      </div>

      {v && (
        <div className="grid-two">
          <section className="panel" aria-label="Grafik Kinerja Keuangan">
            <h2 className="panel-title">Kinerja Periode Ini</h2>
            <p className="panel-subtitle">Perbandingan pendapatan operasional, beban, dan laba bersih.</p>
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -6 }} barCategoryGap="34%">
                  <CartesianGrid stroke={t['--line']} strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: t['--ink-3'], fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: t['--line'] }}
                  />
                  <YAxis
                    width={56}
                    tick={{ fill: t['--ink-4'], fontSize: 11 }}
                    tickFormatter={shortNumber}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip cursor={{ fill: t['--surface-3'] }} content={<ChartTip />} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={84}>
                    {chart.map((row) => (
                      <Cell key={row.name} fill={barColor[row.name] || t['--brand-500']} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="chart-legend">
              {chart.map((row) => (
                <li key={row.name}>
                  <i style={{ background: barColor[row.name] || t['--brand-500'] }} aria-hidden="true" />
                  {row.name}
                  <strong>{money(row.value)}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-label="Informasi Pembukuan">
            <h2 className="panel-title">Informasi Pembukuan</h2>
            <p className="panel-subtitle">Parameter status akuntansi aktif.</p>
            <div className="report-line">
              <span>Periode aktif</span>
              <strong>
                {dateLabel(range.from)} — {dateLabel(range.to)}
              </strong>
            </div>
            <div className="report-line">
              <span>Status pembukuan</span>
              <Badge status="OPEN" />
            </div>
            <div className="report-line">
              <span>Saldo kas dan bank</span>
              <strong>{money(v.cashBank)}</strong>
            </div>
            <div className="report-line">
              <span>Posisi laba</span>
              <strong className={v.netIncome < 0 ? 'bad' : 'good'}>
                {v.netIncome >= 0 ? 'Surplus' : 'Defisit'}
              </strong>
            </div>
            <div className="report-line total">
              <span>Total beban</span>
              <strong>{money(v.expenses)}</strong>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
