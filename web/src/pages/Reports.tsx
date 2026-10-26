import clsx from 'clsx'
import { Download, Printer } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { HBars, Legend, MonthlyChart, NetBars, StackBar } from '../components/charts'
import { Button, Chip, Delta, Dot, Empty, SectionTitle, Segmented, Spinner } from '../components/ui'
import {
  byCategory, byCounterparty, byMethod, categoryMatrix, change, dueIn, fixedVsVariable, monthly, totals, catColor, type MatrixRow, type Slice,
} from '../lib/analytics'
import { useCategories, useEntries } from '../lib/api'
import { addDays, addMonthsKey, diffDays, fullDate, monthEnd, monthKey, monthLabel, monthRange, monthStart, shortMonth, todayISO } from '../lib/dates'
import { methodLabel, money, moneyShort, pct, signedMoney } from '../lib/format'
import { getTheme, setTheme, useSession } from '../lib/session'
import type { Category, Kind } from '../lib/types'

type Preset = 'month' | 'last' | 'quarter' | 'ytd' | '12m' | 'custom'

function rangeFor(p: Preset, today: string, custom: { from: string; to: string }) {
  const cur = monthKey(today)
  switch (p) {
    case 'month': return { from: monthStart(cur), to: monthEnd(cur) }
    case 'last': return { from: monthStart(addMonthsKey(cur, -1)), to: monthEnd(addMonthsKey(cur, -1)) }
    case 'quarter': return { from: monthStart(addMonthsKey(cur, -2)), to: monthEnd(cur) }
    case 'ytd': return { from: `${today.slice(0, 4)}-01-01`, to: monthEnd(cur) }
    case '12m': return { from: monthStart(addMonthsKey(cur, -11)), to: monthEnd(cur) }
    case 'custom': return custom
  }
}

/** Período anterior de mesmo tamanho. Meses inteiros comparam com meses inteiros. */
function previousOf(from: string, to: string) {
  const wholeMonths = from.endsWith('-01') && to === monthEnd(monthKey(to))
  if (wholeMonths) {
    const n = monthRange(monthKey(from), monthKey(to)).length
    return { from: monthStart(addMonthsKey(monthKey(from), -n)), to: monthEnd(addMonthsKey(monthKey(to), -n)) }
  }
  const len = diffDays(to, from) + 1
  return { from: addDays(from, -len), to: addDays(from, -1) }
}

export function ReportsPage() {
  const { workspace } = useSession()
  const today = todayISO()
  const [preset, setPreset] = useState<Preset>('12m')
  const [custom, setCustom] = useState({ from: monthStart(monthKey(today)), to: today })
  const { from, to } = rangeFor(preset, today, custom)
  const prev = previousOf(from, to)
  const q = useEntries(workspace.id, prev.from, to)
  const categories = useCategories(workspace.id).data ?? []
  const [matrixKind, setMatrixKind] = useState<Kind>('Expense')
  const [chartMode, setChartMode] = useState<'planned' | 'settled'>('planned')

  const r = useMemo(() => {
    if (!q.data || from > to) return null
    const all = q.data.items
    const cur = dueIn(all, from, to)
    const before = dueIn(all, prev.from, prev.to)
    const months = monthRange(monthKey(from), monthKey(to))
    const series = monthly(cur, months[0]!, months.at(-1)!, today)
    let acc = 0
    const evolution = series.map((s) => ({ ...s, acc: (acc += s.net) }))
    return {
      cur, months, series, evolution,
      now: totals(cur, today),
      then: totals(before, today),
      expCats: byCategory(cur, before, 'Expense', categories, 99),
      incCats: byCategory(cur, before, 'Income', categories, 99),
      matrix: { Expense: categoryMatrix(cur, 'Expense', categories, months), Income: categoryMatrix(cur, 'Income', categories, months) },
      suppliers: byCounterparty(cur, 'Expense', 10),
      clients: byCounterparty(cur, 'Income', 10),
      methods: byMethod(cur, 'Expense', (x) => methodLabel[x]),
      fixed: fixedVsVariable(cur),
      top: [...cur].filter((e) => e.kind === 'Expense').sort((a, b) => b.amountCents - a.amountCents).slice(0, 8),
    }
  }, [q.data, from, to, prev.from, prev.to, categories, today])

  const print = () => {
    const before = getTheme()
    setTheme('light')
    setTimeout(() => { window.print(); setTheme(before) }, 50)
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">{workspace.name} · {fullDate(from)} a {fullDate(to)}</p>
          <h1 className="display text-3xl font-bold lg:text-4xl">Relatórios</h1>
        </div>
        <div className="no-print flex gap-2">
          <a href={`/api/w/${workspace.id}/export.csv?from=${from}&to=${to}`} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-surface-2 px-4 text-sm font-semibold hover:bg-surface-3"><Download size={17} /> CSV</a>
          <Button variant="soft" className="h-11" onClick={print}><Printer size={17} /> PDF</Button>
        </div>
      </header>

      <div className="no-print space-y-3">
        <div className="scroll-x -mx-4 flex gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {([['month', 'Este mês'], ['last', 'Mês passado'], ['quarter', 'Trimestre'], ['ytd', 'Ano atual'], ['12m', '12 meses'], ['custom', 'Personalizado']] as [Preset, string][]).map(([v, l]) => (
            <Chip key={v} active={preset === v} onClick={() => setPreset(v)}>{l}</Chip>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div><label className="label">De</label><input type="date" className="field" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></div>
            <div><label className="label">Até</label><input type="date" className="field" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></div>
          </div>
        )}
      </div>

      {!r ? (q.isLoading ? <Spinner /> : <div className="card"><Empty title="Período inválido" hint="A data inicial precisa ser antes da final." /></div>) : r.cur.length === 0 ? (
        <div className="card"><Empty title="Sem lançamentos no período" hint="Escolha outro período ou lance contas a pagar e a receber." /></div>
      ) : (
        <>
          <p className="text-xs text-muted">Comparando com {fullDate(prev.from)} a {fullDate(prev.to)}.</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <SummaryCard label="Receitas" value={money(r.now.income.planned)} delta={<Delta value={change(r.now.income.planned, r.then.income.planned)} />} sub={`${money(r.now.income.settled)} recebido`} color="var(--income)" />
            <SummaryCard label="Despesas" value={money(r.now.expense.planned)} delta={<Delta value={change(r.now.expense.planned, r.then.expense.planned)} goodWhenUp={false} />} sub={`${money(r.now.expense.settled)} pago`} color="var(--expense)" />
            <SummaryCard label="Resultado" value={signedMoney(r.now.netPlanned)} delta={<Delta value={change(r.now.netPlanned, r.then.netPlanned)} />} sub={`realizado ${signedMoney(r.now.netSettled)}`} color="var(--fg)" />
            <SummaryCard label="Margem" value={pct(r.now.margin, 1)} delta={<Delta value={r.now.margin != null && r.then.margin != null ? r.now.margin - r.then.margin : null} />} sub={`antes ${pct(r.then.margin, 1)}`} color="var(--accent)" />
          </div>

          {r.months.length > 1 && (
            <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
              <section className="card p-5 lg:p-6">
                <SectionTitle title="Receitas × despesas" hint="Por mês de vencimento" right={<Segmented className="w-52 shrink-0 no-print" value={chartMode} onChange={setChartMode} options={[{ value: 'planned', label: 'Previsto' }, { value: 'settled', label: 'Realizado' }]} />} />
                <MonthlyChart data={r.series} mode={chartMode} height={240} />
                <div className="mt-3"><Legend items={[{ color: 'var(--income)', label: 'Receitas' }, { color: 'var(--expense)', label: 'Despesas' }, { color: 'var(--fg)', label: 'Resultado' }]} /></div>
              </section>
              <section className="card p-5 lg:p-6">
                <SectionTitle title="Resultado mês a mês" hint="Azul = sobrou · vermelho = faltou" />
                <NetBars data={r.series} height={240} />
              </section>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
            <Dre now={r.now} inc={r.incCats} exp={r.expCats} />
            <section className="card overflow-hidden lg:col-span-7">
              <div className="p-5 pb-3 lg:p-6 lg:pb-3"><SectionTitle title="Evolução mensal" hint="Resultado e saldo acumulado no período" /></div>
              <div className="overflow-x-auto">
                <table className="num w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-y border-line bg-surface-2/50 text-left text-xs font-bold uppercase tracking-wide text-muted">
                      <th className="px-5 py-2.5 font-bold">Mês</th><th className="px-3 text-right">Receitas</th><th className="px-3 text-right">Despesas</th><th className="px-3 text-right">Resultado</th><th className="px-3 text-right">Margem</th><th className="px-5 text-right">Acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {r.evolution.map((m) => (
                      <tr key={m.key} className="hover:bg-surface-2/40">
                        <td className="px-5 py-2.5 font-semibold capitalize">{monthLabel(m.key)}</td>
                        <td className="px-3 text-right">{money(m.income)}</td>
                        <td className="px-3 text-right">{money(m.expense)}</td>
                        <td className={clsx('px-3 text-right font-bold', m.net < 0 ? 'text-expense-text' : 'text-income-text')}>{signedMoney(m.net)}</td>
                        <td className="px-3 text-right text-muted">{pct(m.margin)}</td>
                        <td className={clsx('px-5 text-right font-semibold', m.acc < 0 && 'text-expense-text')}>{signedMoney(m.acc)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line-strong font-bold">
                      <td className="px-5 py-3">Total</td>
                      <td className="px-3 text-right">{money(r.now.income.planned)}</td>
                      <td className="px-3 text-right">{money(r.now.expense.planned)}</td>
                      <td className="px-3 text-right">{signedMoney(r.now.netPlanned)}</td>
                      <td className="px-3 text-right">{pct(r.now.margin)}</td>
                      <td className="px-5" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>

          <section className="card overflow-hidden">
            <div className="p-5 pb-3 lg:p-6 lg:pb-3">
              <SectionTitle
                title="Pote × mês"
                hint="Intensidade da cor = peso do valor naquela linha"
                right={<Segmented className="w-48 shrink-0 no-print" value={matrixKind} onChange={setMatrixKind} options={[{ value: 'Expense', label: 'Despesas' }, { value: 'Income', label: 'Receitas' }]} />}
              />
            </div>
            <Matrix rows={r.matrix[matrixKind]} months={r.months} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
            <section className="card p-5 lg:p-6">
              <SectionTitle title={workspace.kind === 'Business' ? 'Fornecedores' : 'Para quem pago'} hint="Top 10 em despesas" />
              <HBars rows={r.suppliers} color="var(--expense)" />
            </section>
            <section className="card p-5 lg:p-6">
              <SectionTitle title={workspace.kind === 'Business' ? 'Clientes' : 'Fontes de renda'} hint="Top 10 em receitas" />
              <HBars rows={r.clients} color="var(--income)" />
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
            <section className="card p-5 lg:col-span-5 lg:p-6">
              <SectionTitle title="Fixo × variável" hint="Despesas recorrentes vs. avulsas" />
              <StackBar parts={[{ label: 'Fixas', value: r.fixed.fixed, color: 'var(--cat-7)' }, { label: 'Variáveis', value: r.fixed.variable, color: 'var(--cat-3)' }]} />
              <h3 className="mb-3 mt-7 text-sm font-bold text-fg-2">Formas de pagamento</h3>
              <HBars rows={r.methods} color="var(--cat-1)" />
            </section>
            <section className="card p-5 lg:col-span-7 lg:p-6">
              <SectionTitle title="Maiores despesas" hint="Lançamentos individuais do período" />
              <ol className="divide-y divide-line">
                {r.top.map((e, i) => {
                  const c = e.categoryId ? categories.find((x) => x.id === e.categoryId) : undefined
                  return (
                    <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className="num w-5 text-right text-xs font-bold text-faint">{i + 1}</span>
                      <Dot color={catColor(c)} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{e.description}</span><span className="text-xs text-muted">{fullDate(e.dueDate)} · {c?.name ?? 'Sem pote'}{e.counterparty ? ` · ${e.counterparty}` : ''}</span></span>
                      <span className="num font-bold">{money(e.amountCents)}</span>
                    </li>
                  )
                })}
              </ol>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, delta, sub, color }: { label: string; value: string; delta: ReactNode; sub: string; color: string }) {
  return (
    <section className="card relative overflow-hidden p-4 lg:p-5">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: color }} />
      <div className="flex items-center justify-between gap-2"><p className="text-[13px] font-semibold text-muted">{label}</p>{delta}</div>
      <p className="display num mt-1.5 truncate text-[1.1rem] font-bold min-[400px]:text-[1.3rem] lg:text-2xl">{value}</p>
      <p className="num mt-0.5 truncate text-xs text-faint">{sub}</p>
    </section>
  )
}

/** DRE simplificada: receitas por pote, despesas por pote, resultado. */
function Dre({ now, inc, exp }: { now: ReturnType<typeof totals>; inc: Slice[]; exp: Slice[] }) {
  const Row = ({ s, base }: { s: Slice; base: number }) => (
    <tr className="hover:bg-surface-2/40">
      <td className="py-2 pl-5 pr-2"><span className="flex items-center gap-2"><Dot color={s.color} /><span className="truncate">{s.name}</span></span></td>
      <td className="px-2 text-right">{money(s.value)}</td>
      <td className="pr-5 text-right text-xs text-muted">{pct(base ? s.value / base : null, 1)}</td>
    </tr>
  )
  return (
    <section className="card overflow-hidden lg:col-span-5">
      <div className="p-5 pb-3 lg:p-6 lg:pb-3"><SectionTitle title="DRE simplificada" hint="% sobre a receita do período" /></div>
      <table className="num w-full text-sm">
        <tbody>
          <tr className="border-y border-line bg-[color-mix(in_oklab,var(--income)_8%,transparent)] font-bold"><td className="py-2.5 pl-5">(+) Receitas</td><td className="px-2 text-right">{money(now.income.planned)}</td><td className="pr-5 text-right text-xs">100%</td></tr>
          {inc.map((s) => <Row key={s.id} s={s} base={now.income.planned} />)}
          <tr className="border-y border-line bg-[color-mix(in_oklab,var(--expense)_8%,transparent)] font-bold"><td className="py-2.5 pl-5">(−) Despesas</td><td className="px-2 text-right">{money(now.expense.planned)}</td><td className="pr-5 text-right text-xs">{pct(now.commitment, 1)}</td></tr>
          {exp.map((s) => <Row key={s.id} s={s} base={now.income.planned} />)}
          <tr className="border-t-2 border-line-strong text-base font-bold">
            <td className="py-3 pl-5">(=) Resultado</td>
            <td className={clsx('px-2 text-right', now.netPlanned < 0 ? 'text-expense-text' : 'text-income-text')}>{signedMoney(now.netPlanned)}</td>
            <td className="pr-5 text-right text-xs">{pct(now.margin, 1)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function Matrix({ rows, months }: { rows: MatrixRow[]; months: string[] }) {
  if (!rows.length) return <p className="px-6 pb-6 text-sm text-muted">Nada no período.</p>
  const colTotal = (k: string) => rows.reduce((a, r) => a + (r.perMonth[k] ?? 0), 0)
  return (
    <div className="overflow-x-auto pb-2">
      <table className="num w-full text-sm" style={{ minWidth: 260 + months.length * 84 }}>
        <thead>
          <tr className="border-y border-line bg-surface-2/50 text-xs font-bold uppercase tracking-wide text-muted">
            <th className="sticky left-0 z-10 bg-surface px-5 py-2.5 text-left">Pote</th>
            {months.map((k) => <th key={k} className="px-2 text-right capitalize">{shortMonth(k)}</th>)}
            <th className="px-3 text-right">Total</th><th className="px-3 text-right">Média</th><th className="pr-5 text-right">%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const max = Math.max(...months.map((k) => r.perMonth[k] ?? 0), 1)
            return (
              <tr key={r.id}>
                <td className="sticky left-0 z-10 bg-surface px-5 py-2"><span className="flex items-center gap-2 font-semibold"><Dot color={r.color} /><span className="max-w-40 truncate">{r.name}</span></span></td>
                {months.map((k) => {
                  const v = r.perMonth[k] ?? 0
                  return (
                    <td key={k} className="px-1 py-1 text-right">
                      <span className="block rounded-lg px-1.5 py-1.5 text-xs" style={{ background: v ? `color-mix(in oklab, var(--seq-4) ${Math.round(8 + (v / max) * 42)}%, transparent)` : 'transparent', color: v ? 'var(--fg)' : 'var(--faint)' }}>
                        {v ? moneyShort(v) : '—'}
                      </span>
                    </td>
                  )
                })}
                <td className="px-3 text-right font-bold">{money(r.total)}</td>
                <td className="px-3 text-right text-muted">{moneyShort(r.avg)}</td>
                <td className="pr-5 text-right text-xs text-muted">{pct(r.share)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line-strong font-bold">
            <td className="sticky left-0 z-10 bg-surface px-5 py-3">Total</td>
            {months.map((k) => <td key={k} className="px-2 text-right text-xs">{moneyShort(colTotal(k))}</td>)}
            <td className="px-3 text-right">{money(rows.reduce((a, r) => a + r.total, 0))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export type { Category }
