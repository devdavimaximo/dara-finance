/* eslint-disable @typescript-eslint/no-explicit-any */
import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { CalendarDay, CashPoint, MonthPoint, Ranked, Slice } from '../lib/analytics'
import { dayLabel, monthLabel, shortMonth } from '../lib/dates'
import { axisMoney, money, moneyShort, pct, signedMoney } from '../lib/format'
import { Dot } from './ui'

const axis = { stroke: 'var(--axis)', tick: { fill: 'var(--muted)', fontSize: 11 }, tickLine: false, axisLine: false } as const

// ---------------------------------------------------------------- tooltip

export function TipBox({ title, rows, footer }: { title: ReactNode; rows: { color?: string; label: string; value: string; dashed?: boolean }[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-2xl border border-line bg-surface/95 px-3.5 py-3 text-sm shadow-xl backdrop-blur">
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">{title}</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            {r.color && (r.dashed
              ? <span className="inline-block h-0 w-3 border-t-2 border-dashed" style={{ borderColor: r.color }} />
              : <Dot color={r.color} />)}
            <span className="flex-1 text-fg-2">{r.label}</span>
            <span className="num font-bold">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 border-t border-line pt-2 text-xs text-muted">{footer}</div>}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean; faded?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs font-semibold text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed
            ? <span className="inline-block w-3.5 border-t-2 border-dashed" style={{ borderColor: i.color }} />
            : <span className="inline-block size-2.5 rounded-[3px]" style={{ background: i.color, opacity: i.faded ? 0.45 : 1 }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- caixa diário

export function CashChart({ data, today, height = 200 }: { data: CashPoint[]; today: string; height?: number }) {
  const hasToday = data.some((d) => d.date === today)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cash)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--cash)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" strokeDasharray="0" />
        <XAxis dataKey="day" {...axis} interval="preserveStartEnd" minTickGap={18} />
        <YAxis {...axis} width={46} tickFormatter={axisMoney} domain={['auto', 'auto']} />
        <ReferenceLine y={0} stroke="var(--line-strong)" />
        {hasToday && <ReferenceLine x={Number(today.slice(8, 10))} stroke="var(--muted)" strokeDasharray="2 4" label={{ value: 'hoje', position: 'insideTopRight', fill: 'var(--muted)', fontSize: 11 }} />}
        <Tooltip
          cursor={{ stroke: 'var(--line-strong)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as CashPoint
            return (
              <TipBox
                title={dayLabel(p.date)}
                rows={[
                  ...(p.realized != null ? [{ color: 'var(--cash)', label: 'Caixa', value: money(p.realized) }] : []),
                  ...(p.projected != null && p.realized == null ? [{ color: 'var(--fg-2)', dashed: true, label: 'Projetado', value: money(p.projected) }] : []),
                  ...(p.inflow ? [{ color: 'var(--income)', label: 'Entradas', value: money(p.inflow) }] : []),
                  ...(p.outflow ? [{ color: 'var(--expense)', label: 'Saídas', value: money(p.outflow) }] : []),
                ]}
              />
            )
          }}
        />
        <Area type="monotone" dataKey="realized" stroke="var(--cash)" strokeWidth={2.25} fill="url(#cashFill)" connectNulls={false} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive />
        <Line type="monotone" dataKey="projected" stroke="var(--fg-2)" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------- 12 meses

export function MonthlyChart({ data, mode, height = 260, selected }: { data: MonthPoint[]; mode: 'planned' | 'settled'; height?: number; selected?: string }) {
  const rows = data.map((d) => ({
    ...d,
    inc: mode === 'planned' ? d.income : d.incomeSettled,
    exp: mode === 'planned' ? d.expense : d.expenseSettled,
    res: mode === 'planned' ? d.net : d.incomeSettled - d.expenseSettled,
  }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="key" {...axis} tickFormatter={shortMonth} interval={0} fontSize={10} />
        <YAxis {...axis} width={46} tickFormatter={axisMoney} />
        <ReferenceLine y={0} stroke="var(--line-strong)" />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)', radius: 8 } as any}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof rows)[number]
            return (
              <TipBox
                title={<span className="capitalize">{monthLabel(p.key, true)}{p.future ? ' · previsão' : ''}</span>}
                rows={[
                  { color: 'var(--income)', label: 'Receitas', value: money(p.inc) },
                  { color: 'var(--expense)', label: 'Despesas', value: money(p.exp) },
                  { color: 'var(--fg)', label: 'Resultado', value: signedMoney(p.res) },
                ]}
                footer={p.inc ? `Margem ${pct(p.res / p.inc)}` : undefined}
              />
            )
          }}
        />
        <Bar dataKey="inc" fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={18}>
          {rows.map((r) => <Cell key={r.key} fillOpacity={r.future ? 0.38 : r.key === selected || !selected ? 1 : 0.8} />)}
        </Bar>
        <Bar dataKey="exp" fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={18}>
          {rows.map((r) => <Cell key={r.key} fillOpacity={r.future ? 0.38 : r.key === selected || !selected ? 1 : 0.8} />)}
        </Bar>
        <Line type="monotone" dataKey="res" stroke="var(--fg)" strokeWidth={2} dot={{ r: 3, fill: 'var(--fg)', strokeWidth: 2, stroke: 'var(--surface)' }} activeDot={{ r: 5 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Resultado mensal em barras divergentes (positivo azul, negativo vermelho). */
export function NetBars({ data, height = 220 }: { data: MonthPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="key" {...axis} tickFormatter={shortMonth} interval={0} fontSize={10} />
        <YAxis {...axis} width={46} tickFormatter={axisMoney} />
        <ReferenceLine y={0} stroke="var(--line-strong)" />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as MonthPoint
            return <TipBox title={<span className="capitalize">{monthLabel(p.key, true)}</span>} rows={[{ color: p.net >= 0 ? 'var(--income)' : 'var(--expense)', label: 'Resultado', value: signedMoney(p.net) }]} footer={p.margin != null ? `Margem ${pct(p.margin)}` : undefined} />
          }}
        />
        <Bar dataKey="net" radius={[4, 4, 4, 4]} maxBarSize={28}>
          {data.map((d) => <Cell key={d.key} fill={d.net >= 0 ? 'var(--income)' : 'var(--expense)'} fillOpacity={d.future ? 0.4 : 1} />)}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------- rosca

export function Donut({ data, total, label, size = 200 }: { data: Slice[]; total: number; label: string; size?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const h = hover != null ? data[hover] : null
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <Pie
          data={data.length ? data : [{ value: 1, color: 'var(--surface-3)', id: 'empty' }]}
          dataKey="value"
          innerRadius={size * 0.36}
          outerRadius={size * 0.48}
          paddingAngle={data.length > 1 ? 2.5 : 0}
          cornerRadius={4}
          stroke="var(--surface)"
          strokeWidth={2}
          startAngle={90}
          endAngle={-270}
          onMouseEnter={(_: unknown, i: number) => setHover(i)}
          onMouseLeave={() => setHover(null)}
          isAnimationActive
        >
          {(data.length ? data : [{ color: 'var(--surface-3)', id: 'empty' }]).map((d, i) => (
            <Cell key={d.id} fill={d.color} fillOpacity={hover == null || hover === i ? 1 : 0.35} />
          ))}
        </Pie>
      </PieChart>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div className="max-w-[60%]">
          <p className="truncate text-[11px] font-bold uppercase tracking-wider text-muted">{h ? h.name : label}</p>
          <p className="display num mt-0.5 text-xl font-bold leading-tight">{moneyShort(h ? h.value : total)}</p>
          {h && <p className="text-xs font-semibold text-muted">{pct(h.share, 1)}</p>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- barras horizontais (HTML)

export function HBars({ rows, color, emptyText = 'Nada no período.' }: { rows: (Ranked & { color?: string })[]; color: string; emptyText?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>
  const max = Math.max(...rows.map((r) => r.value))
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.name} className="group">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-semibold">{r.name}</span>
            <span className="shrink-0 text-fg-2"><b className="num text-fg">{money(r.value)}</b> <span className="num text-xs text-muted">· {pct(r.share)}</span></span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Barra 100% empilhada com rótulos diretos. */
export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.label} className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-700" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${money(p.value)}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {parts.map((p) => (
          <div key={p.label}>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Dot color={p.color} /> {p.label}</p>
            <p className="num mt-0.5 font-bold">{money(p.value)} <span className="text-sm font-semibold text-muted">{total ? pct(p.value / total) : '—'}</span></p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- calendário

const wd = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

/** Mapa de calor dos vencimentos (despesas) do mês — rampa sequencial de 1 matiz. */
export function CalendarHeat({ days, today, selected, onSelect }: { days: CalendarDay[]; today: string; selected: string | null; onSelect: (d: string | null) => void }) {
  const first = new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay()
  const max = Math.max(1, ...days.map((d) => d.expense + d.income))
  const level = (v: number) => (v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)))
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-faint">{wd.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: first }).map((_, i) => <span key={`b${i}`} />)}
        {days.map((d) => {
          const lv = level(d.expense + d.income)
          const isSel = selected === d.date
          return (
            <button
              key={d.date}
              onClick={() => onSelect(isSel ? null : d.date)}
              title={`${dayLabel(d.date)} — ${d.count} lançamento(s)`}
              className={clsx('relative grid aspect-square place-items-center rounded-xl text-xs font-bold transition',
                isSel ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : 'hover:brightness-110',
                d.date === today && !isSel && 'ring-1 ring-accent-text')}
              style={{ background: lv ? `var(--seq-${lv})` : 'var(--surface-2)', color: lv ? `var(--seq-ink-${lv})` : 'var(--fg-2)' }}
            >
              {d.day}
              {d.overdue > 0 && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-critical" />}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted">
        menos {[0, 1, 2, 3, 4, 5].map((l) => <span key={l} className="size-3 rounded-[4px]" style={{ background: l ? `var(--seq-${l})` : 'var(--surface-2)' }} />)} mais
      </div>
    </div>
  )
}
