/* eslint-disable @typescript-eslint/no-explicit-any */
import { AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, Pencil, Receipt } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { HBars, Legend, TipBox } from '../components/charts'
import { EntryRow } from '../components/EntryRow'
import { GoalBar, GoalForm, ProgressRing, StatusPill } from '../components/GoalBits'
import { Button, CategoryBadge, Empty, Segmented, SectionTitle, Sheet, Spinner } from '../components/ui'
import { catColor } from '../lib/analytics'
import { useCategories, useEntryMutations, useGoalEntries, useGoals } from '../lib/api'
import { fullDate, monthLabel, relativeDay, todayISO } from '../lib/dates'
import { axisMoney, money, pct } from '../lib/format'
import { goalCurve, goalProgress, type GoalPoint } from '../lib/goals'
import { useSession } from '../lib/session'

export function GoalDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { workspace, openEntry } = useSession()
  const goals = useGoals(workspace.id)
  const entriesQ = useGoalEntries(workspace.id, id)
  const categories = useCategories(workspace.id).data ?? []
  const m = useEntryMutations(workspace.id)
  const [editing, setEditing] = useState(false)
  const [list, setList] = useState<'next' | 'paid'>('next')
  const today = todayISO()
  const goal = goals.data?.find((g) => g.id === id)
  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data])

  const view = useMemo(() => {
    if (!goal) return null
    const catMap = new Map(categories.map((c) => [c.id, c]))
    const byPote = new Map<string, { name: string; value: number; count: number; color: string }>()
    for (const e of entries) {
      const c = e.categoryId ? catMap.get(e.categoryId) : undefined
      const k = c?.id ?? '_none'
      const row = byPote.get(k) ?? { name: c?.name ?? 'Sem pote', value: 0, count: 0, color: catColor(c) }
      row.value += e.paidDate ? (e.paidAmountCents ?? e.amountCents) : e.amountCents
      row.count++
      byPote.set(k, row)
    }
    const totalByPote = [...byPote.values()].reduce((a, r) => a + r.value, 0)
    return {
      p: goalProgress(goal, today),
      curve: goalCurve(entries, goal, today),
      catMap,
      pots: [...byPote.values()].sort((a, b) => b.value - a.value).map((r) => ({ ...r, share: totalByPote ? r.value / totalByPote : 0 })),
      next: entries.filter((e) => !e.paidDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      paid: entries.filter((e) => e.paidDate).sort((a, b) => b.paidDate!.localeCompare(a.paidDate!)),
    }
  }, [goal, entries, categories, today])

  if (goals.isLoading && !goals.data) return <Spinner />
  if (!goal || !view) return <div className="card"><Empty title="Objetivo não encontrado" action={<Button onClick={() => navigate('/potes?aba=objetivos')}>Voltar</Button>} /></div>

  const { p } = view
  const color = `var(--cat-${goal.color})`
  const shown = list === 'next' ? view.next : view.paid

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link to="/potes?aba=objetivos" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft size={16} /> Objetivos</Link>
          <div className="flex items-center gap-3">
            <CategoryBadge icon={goal.icon} color={color} size={44} />
            <h1 className="display truncate text-3xl font-bold lg:text-4xl">{goal.name}</h1>
          </div>
        </div>
        <Button variant="soft" size="sm" onClick={() => setEditing(true)}><Pencil size={15} /> Editar</Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        {/* Progresso */}
        <section className="card rise p-5 lg:col-span-7 lg:p-6">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            <ProgressRing paid={p.paidShare} committed={p.committedShare} color={color} size={168} stroke={16}>
              <div>
                <p className="display num text-3xl font-bold leading-none">{pct(p.paidShare)}</p>
                <p className="mt-1 text-xs font-semibold text-muted">pago</p>
                {p.scheduled > 0 && <p className="num mt-0.5 text-[11px] text-faint">{pct(p.committedShare)} com agendado</p>}
              </div>
            </ProgressRing>
            <div className="w-full min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2"><StatusPill status={p.status} />{goal.targetDate && <span className="text-sm text-muted">até {fullDate(goal.targetDate)}</span>}</div>
              <div>
                <p className="text-sm font-semibold text-muted">Falta pagar</p>
                <p className="display num text-4xl font-bold leading-tight">{money(p.toPay)}</p>
                <p className="num text-sm text-muted">de uma meta de {money(goal.targetCents)}</p>
              </div>
              {p.monthlyNeeded != null && (
                <p className="rounded-2xl bg-surface-2 px-4 py-2.5 text-sm">
                  Para chegar lá: <b className="num">{money(p.monthlyNeeded)}/mês</b> nos próximos {p.monthsLeft} {p.monthsLeft === 1 ? 'mês' : 'meses'}.
                </p>
              )}
              {goal.overdueCents > 0 && (
                <p className="flex items-center gap-1.5 text-sm font-semibold text-expense-text"><AlertTriangle size={15} /> {money(goal.overdueCents)} em contas atrasadas</p>
              )}
            </div>
          </div>
          <div className="mt-6"><GoalBar p={p} color={color} target={goal.targetCents} /></div>
          {p.unplanned > 0 && (
            <p className="mt-3 text-xs text-muted">"Sem conta lançada" é a parte da meta que ainda não virou conta. Agende as parcelas para o objetivo prever o caixa.</p>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button onClick={() => openEntry(null, 'Expense', { goalId: goal.id, paid: true })}><Receipt size={16} /> Registrar pago</Button>
            <Button variant="soft" onClick={() => openEntry(null, 'Expense', { goalId: goal.id })}><CalendarPlus size={16} /> Agendar conta</Button>
          </div>
        </section>

        {/* Evolução */}
        <section className="card p-5 lg:col-span-5 lg:p-6">
          <SectionTitle title="Evolução" hint="Acumulado pago e o que já está agendado" />
          {view.curve.length < 2 ? <Empty icon={Receipt} title="Sem histórico ainda" hint="Registre o que já pagou para ver a curva." /> : (
            <>
              <GoalChart data={view.curve} target={goal.targetCents} color={color} today={today} />
              <div className="mt-3"><Legend items={[{ color, label: 'Pago (acumulado)' }, { color: 'var(--fg-2)', label: 'Com agendado', dashed: true }, { color: 'var(--muted)', label: 'Meta', dashed: true }]} /></div>
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <section className="card p-5 lg:col-span-7 lg:p-6">
          <SectionTitle title="Contas do objetivo" hint={`${goal.paidCount} paga(s) · ${goal.openCount} em aberto`} />
          <Segmented className="mb-2" value={list} onChange={setList}
            options={[{ value: 'next', label: `Próximas · ${view.next.length}` }, { value: 'paid', label: `Pagas · ${view.paid.length}` }]} />
          {entriesQ.isLoading && !entriesQ.data ? <Spinner /> : shown.length === 0 ? (
            <Empty icon={CheckCircle2} title={list === 'next' ? 'Nada agendado' : 'Nada pago ainda'}
              hint={list === 'next' ? 'Use "Agendar conta" para lançar parcelas e vencimentos.' : 'Use "Registrar pago" para o que já saiu do bolso.'} />
          ) : (
            <div className="divide-y divide-line">
              {shown.map((e) => (
                <EntryRow key={e.id} entry={e} category={e.categoryId ? view.catMap.get(e.categoryId) : undefined} today={today}
                  onOpen={() => openEntry(e)} onToggle={() => m.toggle(e)} />
              ))}
            </div>
          )}
          {list === 'next' && view.next[0] && <p className="mt-3 text-xs text-muted">Próximo vencimento {relativeDay(view.next[0].dueDate, today)} ({fullDate(view.next[0].dueDate)}).</p>}
        </section>

        <section className="card p-5 lg:col-span-5 lg:p-6">
          <SectionTitle title="Para onde vai o dinheiro" hint="Pago + agendado, por pote" />
          <HBars rows={view.pots} color={color} emptyText="Nenhuma conta ligada ainda." />
          {goal.notes && (
            <div className="mt-6 border-t border-line pt-4">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Anotações</p>
              <p className="whitespace-pre-wrap text-sm text-fg-2">{goal.notes}</p>
            </div>
          )}
        </section>
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Editar objetivo">
        {editing && <GoalForm goal={goal} onDone={() => setEditing(false)} onDeleted={() => navigate('/potes?aba=objetivos')} />}
      </Sheet>
    </div>
  )
}

function GoalChart({ data, target, color, today }: { data: GoalPoint[]; target: number; color: string; today: string }) {
  const max = Math.max(target, ...data.map((d) => d.projected ?? d.paid ?? 0))
  const axis = { tick: { fill: 'var(--muted)', fontSize: 11 }, tickLine: false, axisLine: false } as const
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={data} margin={{ top: 12, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="goalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="key" {...axis} tickFormatter={(k: string) => monthLabel(k)} minTickGap={20} />
        <YAxis {...axis} width={46} tickFormatter={axisMoney} domain={[0, Math.ceil(max * 1.08)]} />
        <ReferenceLine y={target} stroke="var(--muted)" strokeDasharray="4 4" label={{ value: 'meta', position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 11 }} />
        <ReferenceLine x={today.slice(0, 7)} stroke="var(--line-strong)" strokeDasharray="2 4" />
        <Tooltip
          cursor={{ stroke: 'var(--line-strong)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload as GoalPoint
            return (
              <TipBox
                title={<span className="capitalize">{monthLabel(d.key, true)}</span>}
                rows={[
                  ...(d.paid != null ? [{ color, label: 'Pago até aqui', value: money(d.paid) }] : []),
                  ...(d.projected != null ? [{ color: 'var(--fg-2)', dashed: true, label: 'Com agendado', value: money(d.projected) }] : []),
                  ...(d.monthPaid ? [{ label: 'Pago no mês', value: money(d.monthPaid) }] : []),
                  ...(d.monthScheduled ? [{ label: 'Agendado no mês', value: money(d.monthScheduled) }] : []),
                ]}
                footer={`Meta ${money(target)}`}
              />
            )
          }}
        />
        <Area type="stepAfter" dataKey="paid" stroke={color} strokeWidth={2.25} fill="url(#goalFill)" dot={false} connectNulls={false} />
        <Line type="stepAfter" dataKey="projected" stroke="var(--fg-2)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
