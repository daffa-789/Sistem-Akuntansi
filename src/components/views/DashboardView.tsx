import React, { useState } from 'react'
import {
  ArrowUpRight, CircleDollarSign, Landmark, ReceiptText, RefreshCw, WalletCards, LucideIcon
} from 'lucide-react'
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '../ui/Button.js'
import { Badge } from '../ui/Badge.js'
import { PageLoading } from '../ui/PageLoading.js'
import { ErrorNotice } from '../ui/ErrorNotice.js'
import { useLoad } from '../../hooks/useLoad.js'
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

export function DashboardView(): React.JSX.Element {
  const [range, setRange] = useState({ from: firstDay(), to: today() })
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
            <div style={{ height: 270 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(val) => `${Math.round(val / 1000000)} jt`}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip formatter={(val: any) => money(val)} />
                  <Bar dataKey="value" fill="#168b55" radius={[7, 7, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
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
