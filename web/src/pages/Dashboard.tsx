import clsx from 'clsx'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock, Flame, Gauge, Info, Landmark, Lightbulb, LineChart, PiggyBank, Repeat, Scale,
  ShieldCheck, TrendingDown, TrendingUp, Wallet, type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarHeat, CashChart, Donut, HBars, Legend, MonthlyChart, StackBar } from '../components/charts'
import { EntryRow } from '../components/EntryRow'
import { CategoryBadge, Delta, Empty, MonthSwitcher, Progress, SectionTitle, Segmented, Spinner } from '../components/ui'
import {
  byCategory, byCounterparty, byMethod, calendar, cashCurve, change, dueInMonth, fixedVsVariable, indicators, monthly,
  overdueList, totals, upcomingList,
} from '../lib/analytics'
import { useCategories, useEntries, useEntryMutations, useInvestments } from '../lib/api'
import { pendingPlan, plannedFlows, portfolio, valueInCash } from '../lib/investments'
import { addMonthsKey, dayLabel, monthEnd, monthKey, monthLabel, monthStart, todayISO } from '../lib/dates'
import { methodLabel, money, pct, signedMoney } from '../lib/format'
import { buildInsights, type Tone } from '../lib/insights'
import { useSession } from '../lib/session'
import type { Category, Entry, Kind } from '../lib/types'

export function DashboardPage() {
  const { workspace, openEntry } = useSession()
  const today = todayISO()
  const current = monthKey(today)
  const [key, setKey] = useState(current)

  // Janela: 11 meses antes (série de 12) até 3 meses depois (projeção), sempre incluindo hoje.
  const windowFrom = monthStart(addMonthsKey(key, -11))
  const toKey = [addMonthsKey(key, 3), addMonthsKey(current, 1)].sort().at(-1)!
  const q = useEntries(workspace.id, windowFrom, monthEnd(toKey))
  const categories = useCategories(workspace.id).data ?? []
  const m = useEntryMutations(workspace.id)
  const investments = useInvestments(workspace.id).data
  const wallet = useMemo(() => {
    const active = investments?.filter((i) => !i.archived && i.moves.length) ?? []
    const pending = investments?.filter((i) => pendingPlan(i, today)).length ?? 0
    return active.length ? { ...portfolio(active, today), inCash: valueInCash(active, today), pending } : null
  }, [investments, today])
  // Aportes programados ainda não confirmados: saídas na projeção do caixa.
  const planned = useMemo(() => plannedFlows(investments ?? [], today, monthEnd(toKey)), [investments, today, toKey])

  const d = useMemo(() => {
    if (!q.data) return null
    const all = q.data.items
    const month = dueInMonth(all, key)
    const prevMonth = dueInMonth(all, addMonthsKey(key, -1))
    const now = totals(month, today)
    const prev = totals(prevMonth, today)
    const curve = cashCurve(all, q.data.balanceBefore, windowFrom, key, today, q.data.flows, planned)
    const ind = indicators(all, q.data.balanceBefore, windowFrom, key, today, q.data.flows, planned)
    const expenseCats = byCategory(month, prevMonth, 'Expense', categories)
    const incomeCats = byCategory(month, prevMonth, 'Income', categories)
    const upcoming = upcomingList(all, today, 7)
    const overdue = overdueList(all, today)
    return {
      all, month, now, prev, curve, ind, expenseCats, incomeCats, upcoming, overdue,
      series: monthly(all, addMonthsKey(key, -11), addMonthsKey(key, 3), today),
      cal: calendar(month, key, today),
      fixed: fixedVsVariable(month),
      methods: byMethod(month, 'Expense', (x) => methodLabel[x]),
      suppliers: byCounterparty(month, 'Expense', 5),
      clients: byCounterparty(month, 'Income', 5),
      insights: buildInsights({ now, prev, curve, ind, expenseCats, upcoming, overdue, isCurrent: key === current, isBusiness: workspace.kind === 'Business' }),
    }
  }, [q.data, key, today, windowFrom, categories, current, workspace.kind, planned])

  if (!d) return <Spinner />

  const catMap = new Map(categories.map((c) => [c.id, c]))
  const toggle = m.toggle
  const isCurrent = key === current
  const isPast = key < current
  const empty = d.all.length === 0

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">{workspace.kind === 'Business' ? 'Empresa' : 'Pessoal'} · {workspace.name}</p>
          <h1 className="display text-3xl font-bold lg:text-4xl">Painel</h1>
        </div>
        <MonthSwitcher value={key} onChange={setKey} min={addMonthsKey(current, -36)} max={addMonthsKey(current, 12)} />
      </header>

      {empty && (
        <div className="card">
          <Empty
            icon={Wallet}
            title="Comece pelo que já sabe"
            hint="Lance aluguel, assinaturas, salários e projetos — inclusive recorrentes e parcelados. O painel se monta sozinho."
            action={<div className="flex gap-2"><button onClick={() => openEntry(null, 'Expense')} className="h-11 rounded-2xl bg-accent px-5 font-bold text-accent-ink">Nova despesa</button><button onClick={() => openEntry(null, 'Income')} className="h-11 rounded-2xl bg-surface-2 px-5 font-bold">Nova receita</button></div>}
          />
        </div>
      )}

      {/* ------------------------------------------------ caixa + KPIs */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <section className="card rise overflow-hidden p-5 lg:col-span-7 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-muted">{isPast ? `Caixa no fim de ${monthLabel(key, true)}` : 'Saldo em caixa hoje'}</p>
              <p className={clsx('display num mt-1 text-[2.6rem] font-bold leading-none lg:text-5xl', (isPast ? d.ind.projectedMonthEnd : d.ind.cashToday) < 0 && 'text-expense-text')}>
                {money(isPast ? d.ind.projectedMonthEnd : d.ind.cashToday)}
              </p>
            </div>
            {!isPast && (
              <div className="rounded-2xl bg-surface-2 px-4 py-3">
                <p className="text-xs font-semibold text-muted">Previsto p/ {monthEnd(key).slice(8)}/{key.slice(5)}</p>
                <p className={clsx('num text-lg font-bold', d.ind.projectedMonthEnd < 0 && 'text-expense-text')}>{money(d.ind.projectedMonthEnd)}</p>
                <p className="num text-xs font-semibold text-muted">{signedMoney(d.ind.projectedMonthEnd - d.ind.cashToday)} até lá</p>
              </div>
            )}
          </div>
          <div className="-mx-1 mt-4">
            <CashChart data={d.curve} today={today} height={210} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <Legend items={[{ color: 'var(--cash)', label: 'Caixa realizado' }, { color: 'var(--fg-2)', label: 'Projeção (contas em aberto)', dashed: true }]} />
            {workspace.openingBalanceCents === 0 && <span className="text-xs text-faint">Defina o saldo inicial em Ajustes para bater com o banco.</span>}
          </div>
          {wallet && !isPast && (
            <Link to="/carteira" className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 transition hover:bg-surface-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent-text"><LineChart size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-muted">
                  Investido{wallet.pending > 0 && <span className="text-accent-text"> · {wallet.pending} aporte{wallet.pending > 1 ? 's' : ''} para confirmar</span>}
                </span>
                <span className="num block truncate font-bold">{money(wallet.value)}</span>
                <span className="num block truncate text-[11px] text-muted">
                  Patrimônio {money(d.ind.cashToday + wallet.value - wallet.inCash)}{wallet.inCash > 0 && <> · {money(wallet.inCash)} já no caixa</>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={clsx('num block text-sm font-bold', wallet.gain < 0 ? 'text-expense-text' : 'text-good-text')}>{signedMoney(wallet.gain)}</span>
                <span className="num block text-[11px] text-muted">{wallet.annual != null && wallet.annualReliable ? `${pct(wallet.annual, 1)} a.a.` : `${pct(wallet.gainShare, 1)} no período`}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted" />
            </Link>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3 lg:col-span-5 lg:gap-4">
          <Kpi
            icon={TrendingUp} tone="income" title="Receitas" value={money(d.now.income.planned)}
            delta={<Delta value={change(d.now.income.planned, d.prev.income.planned)} />}
            progress={d.now.income.progress} progressLabel={`${money(d.now.income.settled)} recebido`}
          />
          <Kpi
            icon={TrendingDown} tone="expense" title="Despesas" value={money(d.now.expense.planned)}
            delta={<Delta value={change(d.now.expense.planned, d.prev.expense.planned)} goodWhenUp={false} />}
            progress={d.now.expense.progress} progressLabel={`${money(d.now.expense.settled)} pago`}
          />
          <Kpi
            icon={Scale} tone={d.now.netPlanned >= 0 ? 'neutral' : 'expense'} title="Resultado" value={signedMoney(d.now.netPlanned)}
            delta={<Delta value={change(d.now.netPlanned, d.prev.netPlanned)} />}
            foot={<>Margem <b className="text-fg">{pct(d.now.margin)}</b> · realizado {signedMoney(d.now.netSettled)}</>}
          />
          {d.now.expense.overdue + d.now.income.overdue > 0 ? (
            <Kpi
              icon={AlertTriangle} tone="critical" title="Em atraso" value={money(d.now.expense.overdue)}
              foot={<>{d.now.expense.overdueCount} a pagar{d.now.income.overdueCount ? <> · <b className="text-fg">{money(d.now.income.overdue)}</b> a receber</> : null}</>}
            />
          ) : (
            <Kpi icon={CheckCircle2} tone="good" title="Em atraso" value="Nada" foot={<>Em aberto: {money(d.now.expense.open)} a pagar · {money(d.now.income.open)} a receber</>} />
          )}
        </div>
      </div>

      {/* ------------------------------------------------ insights */}
      <section className="scroll-x -mx-4 flex snap-x gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 xl:grid-cols-4">
        {d.insights.slice(0, 4).map((i, idx) => <InsightCard key={i.title} {...i} delay={idx} />)}
      </section>

      {/* ------------------------------------------------ 12 meses + indicadores */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <MonthlySection series={d.series} selected={key} />
        <section className="card p-5 lg:col-span-4 lg:p-6">
          <SectionTitle title="Indicadores" hint="O que os números dizem" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <Stat icon={Gauge} label="Comprometimento" value={pct(d.now.commitment)} hint="da receita vai para despesas" bar={d.now.commitment} barColor={d.now.commitment != null && d.now.commitment > 1 ? 'var(--critical)' : 'var(--fg)'} />
            <Stat icon={Repeat} label="Despesa fixa" value={pct(d.fixed.fixedShare)} hint="vem de recorrências" bar={d.fixed.fixedShare} />
            <Stat icon={PiggyBank} label="Margem 12 meses" value={pct(d.ind.margin12)} hint="resultado ÷ receita" bar={d.ind.margin12 != null ? Math.max(0, d.ind.margin12) : null} barColor="var(--income)" />
            <Stat icon={Landmark} label="Fôlego de caixa" value={d.ind.runwayMonths == null ? '—' : `${d.ind.runwayMonths.toFixed(1).replace('.', ',')} m`} hint="meses sem receita" bar={d.ind.runwayMonths != null ? d.ind.runwayMonths / 12 : null} barColor="var(--accent)" />
            <Stat icon={ShieldCheck} label="Pagas em dia" value={pct(d.ind.onTimeExpense)} hint="últimos 12 meses" bar={d.ind.onTimeExpense} barColor="var(--good)" />
            <Stat icon={Clock} label="Recebidas em dia" value={pct(d.ind.onTimeIncome)} hint="últimos 12 meses" bar={d.ind.onTimeIncome} barColor="var(--good)" />
            <Stat icon={Flame} label="Gasto médio/dia" value={d.ind.dailyBurn != null ? money(d.ind.dailyBurn) : '—'} hint={isCurrent ? 'realizado no mês' : 'só no mês atual'} />
            <Stat icon={Wallet} label={`Resultado ${key.slice(0, 4)}`} value={signedMoney(d.ind.ytd.netPlanned)} hint={`margem ${pct(d.ind.ytd.margin)}`} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div><p className="text-xs font-semibold text-muted">Receita média (3m)</p><p className="num font-bold">{money(d.ind.avgIncome3)}</p></div>
            <div><p className="text-xs font-semibold text-muted">Despesa média (3m)</p><p className="num font-bold">{money(d.ind.avgExpense3)}</p></div>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------ potes + calendário */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <CategorySection expense={d.expenseCats} income={d.incomeCats} totals={d.now} />
        <CalendarSection days={d.cal} month={d.month} today={today} catMap={catMap} onOpen={openEntry} onToggle={toggle} />
      </div>

      {/* ------------------------------------------------ próximos / atrasados + composição */}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <DueSection upcoming={d.upcoming} overdue={d.overdue} today={today} catMap={catMap} onOpen={openEntry} onToggle={toggle} />
        <section className="card p-5 lg:col-span-6 lg:p-6">
          <SectionTitle title="Composição das despesas" hint={monthLabel(key, true)} />
          <StackBar parts={[
            { label: 'Fixas (recorrentes)', value: d.fixed.fixed, color: 'var(--cat-7)' },
            { label: 'Variáveis (avulsas)', value: d.fixed.variable, color: 'var(--cat-3)' },
          ]} />
          <h3 className="mb-3 mt-7 text-sm font-bold text-fg-2">Formas de pagamento</h3>
          <HBars rows={d.methods} color="var(--cat-1)" emptyText="Sem despesas no mês." />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <section className="card p-5 lg:p-6">
          <SectionTitle title={workspace.kind === 'Business' ? 'Maiores fornecedores' : 'Para quem mais pago'} hint="Despesas do mês por contraparte" />
          <HBars rows={d.suppliers} color="var(--expense)" emptyText="Preencha o fornecedor nos lançamentos para ver o ranking." />
        </section>
        <section className="card p-5 lg:p-6">
          <SectionTitle title={workspace.kind === 'Business' ? 'Maiores clientes' : 'De onde vem o dinheiro'} hint="Receitas do mês por contraparte" />
          <HBars rows={d.clients} color="var(--income)" emptyText="Preencha o cliente/fonte nas receitas para ver o ranking." />
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- peças

const toneColor = { income: 'var(--income)', expense: 'var(--expense)', neutral: 'var(--fg)', critical: 'var(--critical)', good: 'var(--good)' }

function Kpi({ icon: Icon, tone, title, value, delta, progress, progressLabel, foot }: {
  icon: LucideIcon; tone: keyof typeof toneColor; title: string; value: string; delta?: ReactNode
  progress?: number | null; progressLabel?: string; foot?: ReactNode
}) {
  const c = toneColor[tone]
  return (
    <section className="card rise flex min-w-0 flex-col p-4 lg:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="grid size-8 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${c} 16%, transparent)`, color: c }}><Icon size={17} /></span>
        {delta}
      </div>
      <p className="mt-3 text-[13px] font-semibold text-muted">{title}</p>
      <p className="display num truncate text-[1.1rem] font-bold leading-tight min-[400px]:text-[1.3rem] lg:text-2xl">{value}</p>
      <div className="mt-auto pt-3">
        {progress !== undefined && (
          <>
            <Progress value={progress} color={c} />
            <p className="mt-1.5 truncate text-xs text-muted"><b className="num text-fg-2">{pct(progress)}</b> · {progressLabel}</p>
          </>
        )}
        {foot && <p className="text-xs leading-snug text-muted">{foot}</p>}
      </div>
    </section>
  )
}

const toneStyle: Record<Tone, { icon: LucideIcon; color: string }> = {
  bad: { icon: AlertTriangle, color: 'var(--critical)' },
  warn: { icon: Info, color: 'var(--warning)' },
  good: { icon: CheckCircle2, color: 'var(--good)' },
  // Azul, não dourado: o destaque da marca é dourado e ficaria igual ao "atenção" (warning).
  info: { icon: Lightbulb, color: 'var(--income)' },
}

function InsightCard({ tone, title, text, delay }: { tone: Tone; title: string; text: string; delay: number }) {
  const { icon: Icon, color } = toneStyle[tone]
  return (
    <article className="card rise flex w-[78vw] max-w-80 shrink-0 snap-start gap-3 p-4 sm:w-auto sm:max-w-none" style={{ animationDelay: `${delay * 70}ms` }}>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}><Icon size={18} /></span>
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-fg-2">{text}</p>
      </div>
    </article>
  )
}

function Stat({ icon: Icon, label, value, hint, bar, barColor = 'var(--fg)' }: { icon: LucideIcon; label: string; value: string; hint: string; bar?: number | null; barColor?: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted"><Icon size={13} /> {label}</p>
      <p className="display num mt-1 truncate text-xl font-bold">{value}</p>
      {bar !== undefined && <Progress value={bar} color={barColor} className="mt-1.5" height={4} />}
      <p className="mt-1 truncate text-[11px] text-faint">{hint}</p>
    </div>
  )
}

function MonthlySection({ series, selected }: { series: ReturnType<typeof monthly>; selected: string }) {
  const [mode, setMode] = useState<'planned' | 'settled'>('planned')
  const past = series.filter((s) => !s.future)
  const best = [...past].sort((a, b) => b.net - a.net)[0]
  const worst = [...past].sort((a, b) => a.net - b.net)[0]
  const positive = past.filter((s) => s.net > 0).length
  return (
    <section className="card p-5 lg:col-span-8 lg:p-6">
      <SectionTitle
        title="12 meses + projeção"
        hint="Receitas, despesas e resultado; os 3 meses à frente vêm das recorrências"
        right={<Segmented className="w-52 shrink-0" value={mode} onChange={setMode} options={[{ value: 'planned', label: 'Previsto' }, { value: 'settled', label: 'Realizado' }]} />}
      />
      <div className="-mx-1"><MonthlyChart data={series} mode={mode} selected={selected} /></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Legend items={[{ color: 'var(--income)', label: 'Receitas' }, { color: 'var(--expense)', label: 'Despesas' }, { color: 'var(--fg)', label: 'Resultado' }, { color: 'var(--fg-2)', label: 'Futuro', faded: true }]} />
      </div>
      {past.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
          <div><p className="text-xs font-semibold text-muted">Melhor mês</p><p className="font-bold capitalize">{best && monthLabel(best.key)}</p><p className="num text-xs text-income-text">{best && signedMoney(best.net)}</p></div>
          <div><p className="text-xs font-semibold text-muted">Pior mês</p><p className="font-bold capitalize">{worst && monthLabel(worst.key)}</p><p className={clsx('num text-xs', worst && worst.net < 0 ? 'text-expense-text' : 'text-muted')}>{worst && signedMoney(worst.net)}</p></div>
          <div><p className="text-xs font-semibold text-muted">Meses no azul</p><p className="font-bold">{positive} de {past.length}</p><p className="num text-xs text-muted">{pct(positive / past.length)}</p></div>
        </div>
      )}
    </section>
  )
}

function CategorySection({ expense, income, totals: t }: { expense: ReturnType<typeof byCategory>; income: ReturnType<typeof byCategory>; totals: ReturnType<typeof totals> }) {
  const [kind, setKind] = useState<Kind>('Expense')
  const rows = kind === 'Expense' ? expense : income
  const total = kind === 'Expense' ? t.expense.planned : t.income.planned
  return (
    <section className="card p-5 lg:col-span-7 lg:p-6">
      <SectionTitle
        title={kind === 'Expense' ? 'Para onde vai o dinheiro' : 'De onde vem o dinheiro'}
        hint="Por pote · variação vs. mês anterior"
        right={<Segmented className="w-48 shrink-0" value={kind} onChange={setKind} options={[{ value: 'Expense', label: 'Despesas' }, { value: 'Income', label: 'Receitas' }]} />}
      />
      {rows.length === 0 ? <Empty title="Nada por aqui" hint="Sem lançamentos deste tipo no mês." /> : (
        <div className="grid items-center gap-6 sm:grid-cols-[200px_1fr]">
          <Donut data={rows} total={total} label={kind === 'Expense' ? 'Despesas' : 'Receitas'} />
          <ul className="space-y-3.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3">
                <CategoryBadge icon={r.icon} color={r.color} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    <span className="num shrink-0 text-sm font-bold">{money(r.value)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${r.share * 100}%`, background: r.color }} />
                    </div>
                    <span className="num w-10 text-right text-xs font-semibold text-muted">{pct(r.share)}</span>
                    <Delta value={r.delta} goodWhenUp={kind === 'Income'} className="w-[4.2rem] justify-center" />
                  </div>
                  {r.budget != null && (
                    <p className={clsx('mt-1 text-[11px] font-semibold', r.budgetUse! > 1 ? 'text-expense-text' : 'text-muted')}>
                      {pct(r.budgetUse)} do teto de {money(r.budget)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function CalendarSection({ days, month, today, catMap, onOpen, onToggle }: {
  days: ReturnType<typeof calendar>; month: Entry[]; today: string; catMap: Map<string, Category>
  onOpen: (e: Entry) => void; onToggle: (e: Entry) => void
}) {
  const [sel, setSel] = useState<string | null>(null)
  const list = sel ? month.filter((e) => e.dueDate === sel) : []
  const busiest = [...days].sort((a, b) => b.expense - a.expense)[0]
  return (
    <section className="card p-5 lg:col-span-5 lg:p-6">
      <SectionTitle title="Calendário de vencimentos" hint={busiest?.expense ? `Dia mais pesado: ${busiest.day} (${money(busiest.expense)} a pagar)` : 'Toque num dia para ver as contas'} right={<CalendarClock size={20} className="text-muted" />} />
      <CalendarHeat days={days} today={today} selected={sel} onSelect={setSel} />
      {sel && (
        <div className="fade-in mt-4 border-t border-line pt-3">
          <p className="mb-1 text-sm font-bold capitalize">{dayLabel(sel)}</p>
          {list.length === 0 ? <p className="py-3 text-sm text-muted">Nada vence neste dia.</p> : (
            <div className="divide-y divide-line">
              {list.map((e) => <EntryRow key={e.id} entry={e} category={e.categoryId ? catMap.get(e.categoryId) : undefined} today={today} onOpen={() => onOpen(e)} onToggle={() => onToggle(e)} showDate={false} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function DueSection({ upcoming, overdue, today, catMap, onOpen, onToggle }: {
  upcoming: Entry[]; overdue: Entry[]; today: string; catMap: Map<string, Category>
  onOpen: (e: Entry) => void; onToggle: (e: Entry) => void
}) {
  const [tab, setTab] = useState<'next' | 'late'>(overdue.length ? 'late' : 'next')
  const list = tab === 'next' ? upcoming : overdue
  const pay = list.filter((e) => e.kind === 'Expense').reduce((a, e) => a + e.amountCents, 0)
  const receive = list.filter((e) => e.kind === 'Income').reduce((a, e) => a + e.amountCents, 0)
  return (
    <section className="card p-5 lg:col-span-6 lg:p-6">
      <SectionTitle title="Agenda" hint={`${money(pay)} a pagar · ${money(receive)} a receber`} />
      <Segmented
        className="mb-2"
        value={tab}
        onChange={setTab}
        options={[{ value: 'next', label: `Próx. 7 dias · ${upcoming.length}` }, { value: 'late', label: `Atrasados · ${overdue.length}` }]}
      />
      {list.length === 0 ? (
        <Empty icon={CheckCircle2} title={tab === 'next' ? 'Semana livre' : 'Nada atrasado'} hint={tab === 'next' ? 'Nenhuma conta vence nos próximos 7 dias.' : 'Tudo pago e recebido em dia.'} />
      ) : (
        <div className="max-h-[26rem] divide-y divide-line overflow-y-auto">
          {list.map((e) => <EntryRow key={e.id} entry={e} category={e.categoryId ? catMap.get(e.categoryId) : undefined} today={today} onOpen={() => onOpen(e)} onToggle={() => onToggle(e)} />)}
        </div>
      )}
    </section>
  )
}
