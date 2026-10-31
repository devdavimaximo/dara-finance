/* eslint-disable @typescript-eslint/no-explicit-any */
import clsx from 'clsx'
import {
  AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CalendarCheck, ChevronRight, Coins, Info, LineChart, Pencil, Plus, RefreshCw,
  Target, Wallet, type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Donut, Legend, TipBox } from '../components/charts'
import { centsToInput, ColorPicker } from '../components/PoteForm'
import { Button, CategoryBadge, Chip, Empty, SectionTitle, Segmented, Sheet, Spinner, Toggle } from '../components/ui'
import { useCdi, useGoals, useInvestmentMutations, useInvestments, type InvestmentInput, type MoveInput } from '../lib/api'
import { fullDate, monthLabel, relativeDay, shortDate, todayISO } from '../lib/dates'
import { axisMoney, money, parseMoney, pct, signedMoney, signedPct } from '../lib/format'
import {
  byKind, cdiIndex, kindColor, kindLabel, nextPlan, ordered, pendingPlan, portfolio, STALE_DAYS, summarize, valueSeries,
  type CdiIndex, type Summary, type ValuePoint,
} from '../lib/investments'
import { useSession } from '../lib/session'
import type { Investment, InvestmentKind, InvestmentMove, MoveKind, Origin } from '../lib/types'

const kinds = Object.keys(kindLabel) as InvestmentKind[]

const moveMeta: Record<MoveKind, { label: string; icon: LucideIcon }> = {
  Valuation: { label: 'Atualização de valor', icon: RefreshCw },
  Contribution: { label: 'Aporte', icon: ArrowDownToLine },
  Withdrawal: { label: 'Resgate', icon: ArrowUpFromLine },
  Income: { label: 'Provento', icon: Coins },
}

const originLabel: Record<Origin, string> = { Cash: 'Do caixa', External: 'De fora', Reinvest: 'Proventos reinvestidos' }

const invColor = (i: Investment) => `var(--cat-${i.color})`

/** "8,4% a.a." quando dá para anualizar; senão o acumulado "no período". */
function rateText(s: Summary) {
  if (s.annual != null && s.annualReliable) return { value: signedPct(s.annual, 1), unit: 'ao ano' }
  return { value: signedPct(s.gainShare, 1), unit: 'no período' }
}

/** Índice do CDI desde o primeiro movimento das aplicações (null enquanto carrega ou sem rede). */
function useCdiIndex(invs: Investment[]): CdiIndex | null {
  const first = invs.flatMap((i) => i.moves.map((m) => m.date)).sort()[0] ?? null
  const q = useCdi(first)
  return useMemo(() => cdiIndex(q.data ?? []), [q.data])
}

/** "104% do CDI · no CDI seria R$ 21.950". */
function CdiLine({ s }: { s: Summary }) {
  if (!s.cdi) return null
  const good = s.cdi.pct == null ? null : s.cdi.pct >= 1
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      {s.cdi.pct != null && (
        <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold num',
          good ? 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-good-text' : 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-expense-text')}>
          {pct(s.cdi.pct)} do CDI
        </span>
      )}
      <span>No CDI teria <b className="num text-fg-2">{money(s.cdi.value)}</b> ({signedMoney(s.cdi.gain)})</span>
    </p>
  )
}

// ================================================================ lista

export function InvestmentsPage() {
  const { workspace } = useSession()
  const q = useInvestments(workspace.id)
  const navigate = useNavigate()
  const today = todayISO()
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const cdi = useCdiIndex(q.data ?? [])

  const view = useMemo(() => {
    const all = q.data ?? []
    const active = all.filter((i) => !i.archived)
    const rows = active.map((i) => ({ inv: i, s: summarize(i, today, cdi) }))
    const groups = kinds
      .map((k) => ({ kind: k, rows: rows.filter((r) => r.inv.kind === k).sort((a, b) => b.s.value - a.s.value) }))
      .filter((g) => g.rows.length)
    return {
      active, groups,
      archived: all.filter((i) => i.archived),
      total: portfolio(active, today, cdi),
      series: valueSeries(active, today, cdi),
      composition: byKind(active, today),
      stale: rows.filter((r) => !r.s.closed && r.inv.moves.length && (r.s.staleDays == null || r.s.staleDays > STALE_DAYS)),
      pending: active.flatMap((i) => { const d = pendingPlan(i, today); return d ? [{ inv: i, date: d }] : [] }),
    }
  }, [q.data, today, cdi])

  if (q.isLoading && !q.data) return <Spinner />

  const t = view.total
  const rate = rateText(t)

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">{workspace.name}</p>
          <h1 className="display text-3xl font-bold lg:text-4xl">Carteira</h1>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus size={16} /> Nova aplicação</Button>
      </header>

      {view.active.length === 0 ? (
        <div className="card">
          <Empty
            icon={LineChart}
            title="Seu dinheiro rendendo, num lugar só"
            hint="Cadastre cada aplicação (CDB, Tesouro, FIIs, ações…), lance os aportes e, de vez em quando, quanto ela vale hoje. O dara calcula quanto rende por ano."
            action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Primeira aplicação</Button>}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
            <section className="card rise p-5 lg:col-span-7 lg:p-6">
              <p className="text-sm font-semibold text-muted">Valor da carteira</p>
              <p className="display num mt-1 text-[2.6rem] font-bold leading-none lg:text-5xl">{money(t.value)}</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Metric label="Ganho" value={signedMoney(t.gain)} tone={t.gain < 0 ? 'bad' : 'good'} />
                <Metric label={`Rende ${rate.unit}`} value={rate.value} tone={(t.annual ?? t.gainShare ?? 0) < 0 ? 'bad' : 'good'} />
                <Metric label="Aportado" value={money(t.invested)} />
              </div>
              <CdiLine s={t} />
              {!t.annualReliable && t.firstDate && <p className="mt-3 text-xs text-muted">Com menos de 3 meses de histórico, mostramos o rendimento acumulado — anualizar agora daria um número enganoso.</p>}
              {view.series.length > 1 && <ValueSection data={view.series} />}
            </section>

            <section className="card p-5 lg:col-span-5 lg:p-6">
              <SectionTitle title="Composição" hint="Valor por tipo de aplicação" />
              {view.composition.length === 0 ? <Empty title="Sem valor ainda" hint="Lance um aporte para começar." /> : (
                <div className="grid items-center gap-6 sm:grid-cols-[180px_1fr] lg:grid-cols-1">
                  <Donut data={view.composition} total={t.value} label="Carteira" size={180} />
                  <ul className="space-y-2.5">
                    {view.composition.map((r) => (
                      <li key={r.id} className="flex items-center gap-2.5 text-sm">
                        <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                        <span className="num font-bold">{money(r.value)}</span>
                        <span className="num w-10 text-right text-xs text-muted">{pct(r.share)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(t.income > 0 || t.reinvested > 0) && (
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                  <div><p className="text-xs font-semibold text-muted">Proventos no caixa</p><p className="num font-bold">{money(t.income)}</p></div>
                  <div><p className="text-xs font-semibold text-muted">Proventos reinvestidos</p><p className="num font-bold">{money(t.reinvested)}</p></div>
                </div>
              )}
            </section>
          </div>

          {view.pending.length > 0 && (
            <section className="card flex gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent-text"><CalendarCheck size={18} /></span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-bold">Aporte programado para confirmar</p>
                <ul className="mt-1 space-y-1">
                  {view.pending.map(({ inv, date }) => (
                    <li key={inv.id}>
                      <Link to={`/carteira/${inv.id}?confirmar=1`} className="font-semibold underline decoration-line-strong underline-offset-2">{inv.name}</Link>
                      <span className="text-fg-2"> · <b className="num">{money(inv.plan!.amountCents)}</b> de {shortDate(date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {view.stale.length > 0 && (
            <section className="card flex gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-[var(--warning)]"><AlertTriangle size={18} /></span>
              <div className="min-w-0 text-sm">
                <p className="font-bold">Hora de atualizar o valor</p>
                <p className="text-fg-2">
                  {view.stale.map((r, i) => (
                    <span key={r.inv.id}>{i > 0 && ', '}<Link to={`/carteira/${r.inv.id}?atualizar=1`} className="font-semibold underline decoration-line-strong underline-offset-2">{r.inv.name}</Link></span>
                  ))}{' '}
                  — sem atualização há mais de {STALE_DAYS} dias. A rentabilidade fica mais certa com o valor do mês.
                </p>
              </div>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
            {view.groups.map((g) => {
              const sum = g.rows.reduce((a, r) => a + r.s.value, 0)
              return (
                <section key={g.kind} className="card p-5 lg:p-6">
                  <SectionTitle title={kindLabel[g.kind]} hint={`${g.rows.length} ${g.rows.length === 1 ? 'aplicação' : 'aplicações'} · ${money(sum)}`} />
                  <div className="-mx-2 divide-y divide-line">
                    {g.rows.map(({ inv, s }) => <InvestmentRow key={inv.id} inv={inv} s={s} />)}
                  </div>
                </section>
              )
            })}
          </div>
        </>
      )}

      {view.archived.length > 0 && (
        <section className="card p-5 lg:p-6">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setShowArchived((v) => !v)}>
            <span className="text-sm font-bold text-fg-2">Arquivadas · {view.archived.length}</span>
            <ChevronRight size={16} className={clsx('text-muted transition', showArchived && 'rotate-90')} />
          </button>
          {showArchived && (
            <div className="-mx-2 mt-3 divide-y divide-line">
              {view.archived.map((inv) => <InvestmentRow key={inv.id} inv={inv} s={summarize(inv, today)} />)}
            </div>
          )}
        </section>
      )}

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nova aplicação">
        {creating && <InvestmentForm investment={null} onDone={(inv) => { setCreating(false); if (inv) navigate(`/carteira/${inv.id}?novo=1`) }} />}
      </Sheet>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-semibold text-muted">{label}</p>
      <p className={clsx('num truncate text-base font-bold sm:text-lg', tone === 'good' && 'text-good-text', tone === 'bad' && 'text-expense-text')}>{value}</p>
    </div>
  )
}

function InvestmentRow({ inv, s }: { inv: Investment; s: Summary }) {
  const today = todayISO()
  const rate = rateText(s)
  const stale = !s.closed && (s.staleDays == null || s.staleDays > STALE_DAYS)
  return (
    <Link to={`/carteira/${inv.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-3 transition hover:bg-surface-2">
      <CategoryBadge icon="trending-up" color={invColor(inv)} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{inv.name}</p>
        <p className="truncate text-xs text-muted">
          {inv.institution ?? kindLabel[inv.kind]}
          {inv.countsInCash && ' · no caixa'}
          {s.closed ? ' · encerrada' : s.lastValuation
            ? <span className={clsx(stale && 'text-[var(--warning)]')}> · atualizado {relativeDay(s.lastValuation, today)}</span>
            : inv.moves.length > 0 && <span className="text-[var(--warning)]"> · sem atualização</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="num font-bold">{money(s.value)}</p>
        {s.invested > 0 && (
          <p className={clsx('num text-xs font-semibold', s.gain < 0 ? 'text-expense-text' : 'text-good-text')}>
            {rate.value} <span className="font-normal text-muted">{rate.unit === 'ao ano' ? 'a.a.' : 'no período'}{s.cdi?.pct != null && ` · ${pct(s.cdi.pct)} CDI`}</span>
          </p>
        )}
      </div>
    </Link>
  )
}

/** Gráfico + legenda. A linha do CDI só aparece quando há taxas para o período todo. */
function ValueSection({ data }: { data: ValuePoint[] }) {
  const withCdi = data.every((p) => p.cdi != null)
  return (
    <>
      <div className="-mx-1 mt-5"><ValueChart data={data} withCdi={withCdi} /></div>
      <div className="mt-2">
        <Legend items={[
          { color: 'var(--cash)', label: 'Valor' },
          { color: 'var(--fg-2)', label: 'Aportado (líquido)', dashed: true },
          ...(withCdi ? [{ color: 'var(--income)', label: 'Se estivesse no CDI', dashed: true }] : []),
        ]} />
      </div>
    </>
  )
}

function ValueChart({ data, withCdi }: { data: ValuePoint[]; withCdi: boolean }) {
  const axis = { tick: { fill: 'var(--muted)', fontSize: 11 }, tickLine: false, axisLine: false } as const
  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cash)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--cash)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="key" {...axis} tickFormatter={(k: string) => monthLabel(k)} minTickGap={20} />
        <YAxis {...axis} width={46} tickFormatter={axisMoney} domain={[0, 'auto']} />
        <Tooltip
          cursor={{ stroke: 'var(--line-strong)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as ValuePoint
            return (
              <TipBox
                title={<span className="capitalize">{monthLabel(p.key, true)}</span>}
                rows={[
                  { color: 'var(--cash)', label: 'Valor', value: money(p.value) },
                  { color: 'var(--fg-2)', dashed: true, label: 'Aportado', value: money(p.net) },
                  ...(withCdi && p.cdi != null ? [{ color: 'var(--income)', dashed: true, label: 'No CDI', value: money(p.cdi) }] : []),
                ]}
                footer={`Ganho ${signedMoney(p.value - p.net)}`}
              />
            )
          }}
        />
        {/* Linear: curva suavizada "antecipa" o aporte e passa abaixo da linha do aportado. */}
        <Area type="linear" dataKey="value" stroke="var(--cash)" strokeWidth={2.25} fill="url(#valueFill)" dot={false} />
        <Line type="stepAfter" dataKey="net" stroke="var(--fg-2)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
        {withCdi && <Line type="linear" dataKey="cdi" stroke="var(--income)" strokeWidth={1.75} strokeDasharray="2 4" dot={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ================================================================ detalhe

export function InvestmentDetailPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { workspace } = useSession()
  const q = useInvestments(workspace.id)
  const today = todayISO()
  const inv = q.data?.find((i) => i.id === id)
  const goal = useGoals(workspace.id).data?.find((g) => g.id === inv?.goalId)
  const cdi = useCdiIndex(inv ? [inv] : [])
  const [editing, setEditing] = useState(false)
  const [move, setMove] = useState<{ kind: MoveKind; move: InvestmentMove | null; preset?: Preset } | null>(null)

  const confirmPlan = (date: string) =>
    inv?.plan && setMove({ kind: 'Contribution', move: null, preset: { amountCents: inv.plan.amountCents, date, planDate: date } })

  // Recém-criada → já abre o primeiro aporte. Vindo dos avisos → abre a atualização ou a confirmação do programado.
  useEffect(() => {
    if (!inv) return
    const pending = pendingPlan(inv, today)
    if (params.get('novo') && inv.moves.length === 0) setMove({ kind: 'Contribution', move: null })
    else if (params.get('atualizar')) setMove({ kind: 'Valuation', move: null })
    else if (params.get('confirmar') && pending && inv.plan)
      setMove({ kind: 'Contribution', move: null, preset: { amountCents: inv.plan.amountCents, date: pending, planDate: pending } })
    if (params.size) setParams({}, { replace: true })
  }, [inv, params, setParams, today])

  const view = useMemo(() => inv && {
    s: summarize(inv, today, cdi),
    series: valueSeries([inv], today, cdi),
    timeline: ordered(inv.moves).reverse(),
    pending: pendingPlan(inv, today),
    next: nextPlan(inv, today),
  }, [inv, today, cdi])

  if (q.isLoading && !q.data) return <Spinner />
  if (!inv || !view) return <div className="card"><Empty title="Aplicação não encontrada" action={<Button onClick={() => navigate('/carteira')}>Voltar</Button>} /></div>

  const { s } = view
  const rate = rateText(s)
  const color = invColor(inv)
  const stale = !s.closed && inv.moves.length > 0 && (s.staleDays == null || s.staleDays > STALE_DAYS)

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to="/carteira" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft size={16} /> Carteira</Link>
          <div className="flex items-center gap-3">
            <CategoryBadge icon="trending-up" color={color} size={44} />
            <div className="min-w-0">
              <h1 className="display truncate text-3xl font-bold lg:text-4xl">{inv.name}</h1>
              <p className="truncate text-sm text-muted">
                {kindLabel[inv.kind]}{inv.institution && ` · ${inv.institution}`}{inv.countsInCash && ' · conta no caixa'}
                {goal && <> · <Link to={`/objetivos/${goal.id}`} className="inline-flex items-center gap-1 font-semibold text-fg-2 hover:text-fg"><Target size={13} />{goal.name}</Link></>}
              </p>
            </div>
          </div>
        </div>
        <Button variant="soft" size="sm" onClick={() => setEditing(true)}><Pencil size={15} /> Editar</Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <section className="card rise p-5 lg:col-span-7 lg:p-6">
          <p className="text-sm font-semibold text-muted">Vale hoje</p>
          <p className="display num mt-1 text-[2.6rem] font-bold leading-none lg:text-5xl">{money(s.value)}</p>
          <p className={clsx('mt-1.5 text-xs', stale ? 'font-semibold text-[var(--warning)]' : 'text-muted')}>
            {s.lastValuation ? `Atualizado ${relativeDay(s.lastValuation, today)} (${fullDate(s.lastValuation)})` : inv.moves.length ? 'Ainda sem atualização: o valor é só o que foi aportado.' : 'Sem movimentos ainda.'}
            {s.lastValuation && s.asOf && s.asOf > s.lastValuation && ' + aportes/resgates depois disso'}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Ganho" value={signedMoney(s.gain)} tone={s.gain < 0 ? 'bad' : 'good'} />
            <Metric label={`Rende ${rate.unit}`} value={rate.value} tone={(s.annual ?? s.gainShare ?? 0) < 0 ? 'bad' : 'good'} />
            <Metric label="Aportado" value={money(s.invested)} />
          </div>
          {(s.income > 0 || s.reinvested > 0 || s.withdrawn > 0) && (
            <p className="mt-3 text-xs text-muted">
              {[s.withdrawn > 0 && `${money(s.withdrawn)} resgatado`, s.income > 0 && `${money(s.income)} em proventos no caixa`, s.reinvested > 0 && `${money(s.reinvested)} reinvestido`].filter(Boolean).join(' · ')}
            </p>
          )}
          <CdiLine s={s} />
          {inv.plan && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
              <CalendarCheck size={18} className="shrink-0 text-accent-text" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Aporte programado: <span className="num">{money(inv.plan.amountCents)}</span> todo dia {inv.plan.day}</p>
                <p className="text-xs text-muted">
                  {view.pending ? `O de ${shortDate(view.pending)} ainda não foi confirmado.` : view.next ? `Próximo: ${fullDate(view.next)}` : `A partir de ${fullDate(inv.plan.start)}`}
                  {!inv.countsInCash && ' · já entra na projeção do caixa'}
                </p>
              </div>
              {view.pending && <Button size="sm" onClick={() => confirmPlan(view.pending!)}>Confirmar</Button>}
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button className="col-span-2 sm:col-span-1" onClick={() => setMove({ kind: 'Valuation', move: null })}><RefreshCw size={16} /> Atualizar valor</Button>
            <Button variant="soft" onClick={() => setMove({ kind: 'Contribution', move: null })}><ArrowDownToLine size={16} /> Aporte</Button>
            <Button variant="soft" onClick={() => setMove({ kind: 'Withdrawal', move: null })}><ArrowUpFromLine size={16} /> Resgate</Button>
            <Button variant="soft" className="col-span-2 sm:col-span-1" onClick={() => setMove({ kind: 'Income', move: null })}><Coins size={16} /> Provento</Button>
          </div>
        </section>

        <section className="card p-5 lg:col-span-5 lg:p-6">
          <SectionTitle title="Evolução" hint="Valor no fim de cada mês × dinheiro aplicado" />
          {view.series.length < 2 ? <Empty icon={LineChart} title="Sem histórico ainda" hint="Lance o aporte e, depois, quanto vale hoje." /> : <ValueSection data={view.series} />}
        </section>
      </div>

      <section className="card p-5 lg:p-6">
        <SectionTitle title="Histórico" hint="Toque para corrigir ou excluir" />
        {view.timeline.length === 0 ? (
          <Empty icon={Wallet} title="Nada lançado" hint="Comece pelo aporte — com a data em que o dinheiro foi aplicado." action={<Button onClick={() => setMove({ kind: 'Contribution', move: null })}>Lançar aporte</Button>} />
        ) : (
          <div className="-mx-2 divide-y divide-line">
            {view.timeline.map((m) => <MoveRow key={m.id} m={m} onOpen={() => setMove({ kind: m.kind, move: m })} />)}
          </div>
        )}
        {inv.notes && (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Anotações</p>
            <p className="whitespace-pre-wrap text-sm text-fg-2">{inv.notes}</p>
          </div>
        )}
      </section>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Editar aplicação">
        {editing && <InvestmentForm investment={inv} onDone={() => setEditing(false)} onDeleted={() => navigate('/carteira')} />}
      </Sheet>
      <Sheet open={!!move} onClose={() => setMove(null)} title={move ? (move.move ? `Editar ${moveMeta[move.kind].label.toLowerCase()}` : moveMeta[move.kind].label) : ''}>
        {move && <MoveForm inv={inv} kind={move.kind} move={move.move} preset={move.preset} onDone={() => setMove(null)} />}
      </Sheet>
    </div>
  )
}

function MoveRow({ m, onOpen }: { m: InvestmentMove; onOpen: () => void }) {
  const { label, icon: Icon } = moveMeta[m.kind]
  const sub = m.kind === 'Contribution' ? originLabel[m.origin ?? 'Cash'] + (m.planDate ? ' · programado' : '')
    : m.kind === 'Withdrawal' ? (m.toCash ? 'Voltou para o caixa' : 'Foi para fora')
    : m.kind === 'Income' ? 'Caiu no caixa' : 'Valor total da aplicação'
  const sign = m.kind === 'Contribution' ? '+' : m.kind === 'Withdrawal' ? '−' : ''
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left transition hover:bg-surface-2">
      <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', m.kind === 'Valuation' ? 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent-text' : 'bg-surface-2 text-fg-2')}><Icon size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="block truncate text-xs text-muted">{fullDate(m.date)} · {sub}{m.notes && ` · ${m.notes}`}</span>
      </span>
      <span className="num shrink-0 font-bold">{sign}{money(m.amountCents)}</span>
    </button>
  )
}

// ================================================================ formulários

export function InvestmentForm({ investment, onDone, onDeleted }: { investment: Investment | null; onDone: (inv?: Investment) => void; onDeleted?: () => void }) {
  const { workspace } = useSession()
  const m = useInvestmentMutations(workspace.id)
  const [kind, setKind] = useState<InvestmentKind>(investment?.kind ?? 'Cdb')
  const [name, setName] = useState(investment?.name ?? '')
  const [institution, setInstitution] = useState(investment?.institution ?? '')
  const [color, setColor] = useState(investment?.color ?? kindColor.Cdb)
  const [countsInCash, setCountsInCash] = useState(investment?.countsInCash ?? false)
  const [notes, setNotes] = useState(investment?.notes ?? '')
  const [archived, setArchived] = useState(investment?.archived ?? false)
  const [goalId, setGoalId] = useState(investment?.goalId ?? '')
  const [planOn, setPlanOn] = useState(!!investment?.plan)
  const [planAmount, setPlanAmount] = useState(centsToInput(investment?.plan?.amountCents))
  const [planDay, setPlanDay] = useState(String(investment?.plan?.day ?? 5))
  const [planStart, setPlanStart] = useState(investment?.plan?.start ?? todayISO())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const goals = (useGoals(workspace.id).data ?? []).filter((g) => !g.archived || g.id === investment?.goalId)
  const err = m.create.error?.message ?? m.update.error?.message ?? m.remove.error?.message
  const day = Number(planDay)
  const planValid = !planOn || (parseMoney(planAmount) > 0 && day >= 1 && day <= 31 && !!planStart)

  const pickKind = (k: InvestmentKind) => {
    setKind(k)
    if (!investment) setColor(kindColor[k])
  }

  const save = async () => {
    const body: InvestmentInput = {
      name, kind, institution: institution || null, color, countsInCash, notes: notes || null, archived, goalId: goalId || null,
      plan: planOn ? { amountCents: parseMoney(planAmount), day, start: planStart } : null,
    }
    onDone(investment ? await m.update.mutateAsync({ id: investment.id, ...body }) : await m.create.mutateAsync(body))
  }

  return (
    <div className="space-y-5 pt-1">
      <div>
        <label className="label">Tipo</label>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => <Chip key={k} active={kind === k} onClick={() => pickKind(k)}>{kindLabel[k]}</Chip>)}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <CategoryBadge icon="trending-up" color={`var(--cat-${color})`} size={52} />
        <input className="field" placeholder={placeholders[kind]} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!investment} />
      </div>
      <div>
        <label className="label">Banco / corretora (opcional)</label>
        <input className="field" placeholder="Ex.: Nubank, XP, Inter" value={institution} onChange={(e) => setInstitution(e.target.value)} />
      </div>
      <ColorPicker value={color} onChange={setColor} />
      <div className="rounded-3xl border border-line px-4 pb-3">
        <Toggle checked={countsInCash} onChange={setCountsInCash} label="Contar no saldo de caixa" />
        <p className="text-xs leading-relaxed text-muted">
          {countsInCash
            ? 'O valor desta aplicação aparece no saldo do painel: aportar e resgatar só trocam o dinheiro de lugar, e o rendimento soma no caixa. Bom para reserva com liquidez diária.'
            : 'O aporte sai do saldo de caixa e o resgate volta para ele. O valor aplicado aparece só na Carteira (e no patrimônio do painel).'}
        </p>
      </div>
      {goals.length > 0 && (
        <div>
          <label className="label">Guardando para um objetivo (opcional)</label>
          <select className="field" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Nenhum</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {goalId && <p className="mt-1.5 text-xs text-muted">O valor desta aplicação aparece como "guardado" no objetivo e reduz quanto falta juntar por mês.</p>}
        </div>
      )}
      <div className="rounded-3xl border border-line px-4 pb-3">
        <Toggle checked={planOn} onChange={setPlanOn} label="Aporte programado (todo mês)" />
        {planOn ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_5.5rem] gap-3">
              <div>
                <label className="label">Valor</label>
                <input className="field num" inputMode="decimal" placeholder="0,00" value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} />
              </div>
              <div>
                <label className="label">Dia</label>
                <input className="field num" inputMode="numeric" value={planDay} onChange={(e) => setPlanDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
              </div>
            </div>
            <div>
              <label className="label">A partir de</label>
              <input className="field" type="date" value={planStart} onChange={(e) => setPlanStart(e.target.value)} />
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Não vira lançamento: {countsInCash ? 'como esta aplicação conta no caixa, não muda a projeção.' : 'entra na projeção do caixa do painel.'}{' '}
              No dia, a Carteira pede para confirmar — aí vira um aporte de verdade (dá para ajustar valor e data).
            </p>
          </div>
        ) : <p className="text-xs text-muted">Para quem aplica todo mês: aparece na projeção e lembra de confirmar.</p>}
      </div>
      <div>
        <label className="label">Anotações</label>
        <textarea className="field min-h-20 resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional — taxa contratada, vencimento, liquidez" />
      </div>
      {investment && <div className="rounded-3xl border border-line px-4"><Toggle checked={archived} onChange={setArchived} label="Arquivar (resgatei tudo)" /></div>}
      {err && <p className="text-sm font-semibold text-expense-text">{err}</p>}
      <Button size="lg" className="w-full" loading={m.create.isPending || m.update.isPending} disabled={!name.trim() || !planValid} onClick={save}>
        {investment ? 'Salvar' : 'Criar e lançar o aporte'}
      </Button>
      {investment && (!confirmDelete ? (
        <Button variant="ghost" className="w-full text-expense-text" onClick={() => setConfirmDelete(true)}>Excluir aplicação</Button>
      ) : (
        <div className="space-y-2 rounded-3xl border border-line p-4">
          <p className="text-sm">Apaga a aplicação e todo o histórico dela. O saldo de caixa volta a ser como se ela nunca tivesse existido. Se você só resgatou tudo, prefira arquivar.</p>
          <div className="flex gap-2">
            <Button variant="danger" loading={m.remove.isPending} onClick={() => m.remove.mutate(investment.id, { onSuccess: () => onDeleted?.() })}>Excluir</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

const placeholders: Record<InvestmentKind, string> = {
  Fii: 'Ex.: MXRF11', Stock: 'Ex.: ITSA4', Etf: 'Ex.: IVVB11', Cdb: 'Ex.: CDB 110% CDI', TesouroSelic: 'Ex.: Tesouro Selic 2029',
  Treasury: 'Ex.: Tesouro IPCA+ 2035', Fund: 'Ex.: Fundo DI', Crypto: 'Ex.: Bitcoin', Other: 'Nome da aplicação',
}

/** Aporte já preenchido ao confirmar a ocorrência do aporte programado. */
type Preset = { amountCents: number; date: string; planDate: string }

function MoveForm({ inv, kind, move, preset, onDone }: { inv: Investment; kind: MoveKind; move: InvestmentMove | null; preset?: Preset; onDone: () => void }) {
  const { workspace } = useSession()
  const m = useInvestmentMutations(workspace.id)
  const today = todayISO()
  const [date, setDate] = useState(move?.date ?? preset?.date ?? today)
  const [amount, setAmount] = useState(move ? centsToInput(move.amountCents) || (move.kind === 'Valuation' ? '0' : '') : centsToInput(preset?.amountCents))
  const planDate = move?.planDate ?? preset?.planDate ?? null
  const [origin, setOrigin] = useState<Origin>(move?.origin ?? 'Cash')
  const [toCash, setToCash] = useState(move?.toCash ?? true)
  const [closeOut, setCloseOut] = useState(false)
  const [notes, setNotes] = useState(move?.notes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const err = m.addMove.error?.message ?? m.updateMove.error?.message ?? m.removeMove.error?.message
  const cents = parseMoney(amount)

  // Valor estimado antes desta atualização (sem ela), para mostrar quanto rendeu desde a anterior.
  const before = useMemo(() => {
    if (kind !== 'Valuation') return null
    const others = inv.moves.filter((x) => x.id !== move?.id && x.date <= date)
    if (!others.length) return null
    return summarize({ ...inv, moves: others }, today).value
  }, [kind, inv, move, date, today])

  const save = () => {
    const body: MoveInput = {
      kind, date, amountCents: cents, origin: kind === 'Contribution' ? origin : null, toCash, notes: notes || null,
      closeOut: kind === 'Withdrawal' && closeOut, planDate,
    }
    const opts = { onSuccess: onDone }
    if (move) m.updateMove.mutate({ investmentId: inv.id, id: move.id, ...body }, opts)
    else m.addMove.mutate({ investmentId: inv.id, ...body }, opts)
  }

  const amountLabel = { Valuation: 'Quanto vale hoje', Contribution: 'Valor aplicado', Withdrawal: 'Valor que caiu na conta', Income: 'Valor recebido' }[kind]
  const valid = kind === 'Valuation' ? amount.trim() !== '' && cents >= 0 : cents > 0

  return (
    <div className="space-y-5 pt-1">
      {planDate && !move && <Hint>Confirmando o aporte programado de <b>{fullDate(planDate)}</b>. Ajuste o valor e a data se o real foi diferente.</Hint>}
      {kind === 'Valuation' && (
        <Hint>
          Abra a aplicação no app do banco e copie o valor <b>líquido</b> (o que cairia na conta se resgatasse hoje — já sem IR e taxas).
          Se o banco só mostra o bruto, use o bruto, mas sempre o mesmo dos dois.
        </Hint>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{amountLabel}</label>
          <input className="field num" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">{kind === 'Contribution' ? 'Data do aporte' : 'Data'}</label>
          <input className="field" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {kind === 'Valuation' && before != null && amount.trim() !== '' && (
        <p className="-mt-2 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm">
          Antes: <b className="num">{money(before)}</b> · {cents >= before ? 'rendeu' : 'variou'} <b className={clsx('num', cents < before ? 'text-expense-text' : 'text-good-text')}>{signedMoney(cents - before)}</b>
          {before > 0 && <span className="num text-muted"> ({signedPct((cents - before) / before, 2)})</span>}
        </p>
      )}

      {kind === 'Contribution' && (
        <div>
          <label className="label">De onde veio o dinheiro</label>
          <Segmented value={origin} onChange={setOrigin} options={(['Cash', 'External', 'Reinvest'] as Origin[]).map((o) => ({ value: o, label: o === 'Reinvest' ? 'Reinvestido' : originLabel[o] }))} />
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {origin === 'Cash' && (inv.countsInCash ? 'Saiu do caixa, mas esta aplicação conta no caixa: o saldo não muda, o dinheiro só troca de lugar.' : 'Sai do saldo de caixa do painel nesta data.')}
            {origin === 'External' && 'Dinheiro que não passou por este caixa — por exemplo, o que já estava aplicado antes de você usar o dara. Não mexe no saldo.'}
            {origin === 'Reinvest' && 'Proventos/dividendos que você reinvestiu. Conta como rendimento (não como dinheiro novo) e não mexe no saldo.'}
          </p>
        </div>
      )}

      {kind === 'Withdrawal' && (
        <div className="rounded-3xl border border-line px-4">
          <Toggle checked={toCash} onChange={setToCash} label="Voltou para o caixa deste espaço" />
          {!move && <Toggle checked={closeOut} onChange={setCloseOut} label="Resgatei tudo (zera a aplicação)" />}
        </div>
      )}

      {kind === 'Income' && <Hint>Provento/dividendo que caiu na conta e entra no saldo de caixa. Se você reinvestiu, lance como <b>Aporte → Reinvestido</b>.</Hint>}

      <div>
        <label className="label">Observação (opcional)</label>
        <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={kind === 'Valuation' ? 'Ex.: extrato de outubro' : 'Ex.: 10 cotas a R$ 10,20'} />
      </div>
      {err && <p className="text-sm font-semibold text-expense-text">{err}</p>}
      <Button size="lg" className="w-full" loading={m.addMove.isPending || m.updateMove.isPending} disabled={!valid || !date || date > today} onClick={save}>
        {move ? 'Salvar' : kind === 'Valuation' ? 'Atualizar valor' : `Lançar ${moveMeta[kind].label.toLowerCase()}`}
      </Button>
      {move && (!confirmDelete ? (
        <Button variant="ghost" className="w-full text-expense-text" onClick={() => setConfirmDelete(true)}>Excluir</Button>
      ) : (
        <div className="flex gap-2 rounded-3xl border border-line p-4">
          <Button variant="danger" loading={m.removeMove.isPending} onClick={() => m.removeMove.mutate({ investmentId: inv.id, id: move.id }, { onSuccess: onDone })}>Excluir</Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
        </div>
      ))}
    </div>
  )
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="flex gap-2.5 rounded-2xl bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-fg-2">
    <Info size={16} className="mt-0.5 shrink-0 text-[var(--income)]" /><span>{children}</span>
  </p>
)
