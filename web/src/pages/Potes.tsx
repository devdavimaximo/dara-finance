import clsx from 'clsx'
import { AlertTriangle, ChevronRight, Plus, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EntryRow } from '../components/EntryRow'
import { GoalForm, ProgressRing, StatusPill } from '../components/GoalBits'
import { PoteForm } from '../components/PoteForm'
import { Button, CategoryBadge, Empty, MonthSwitcher, Progress, Segmented, Sheet, Spinner } from '../components/ui'
import { catColor, dueInMonth, paidValue } from '../lib/analytics'
import { useCategories, useEntries, useEntryMutations, useGoals } from '../lib/api'
import { addMonthsKey, fullDate, monthEnd, monthKey, monthLabel, monthStart, todayISO } from '../lib/dates'
import { money, pct } from '../lib/format'
import { goalProgress } from '../lib/goals'
import { useSession } from '../lib/session'
import type { Category, Entry, Kind } from '../lib/types'

export function PotesPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('aba') === 'objetivos' ? 'goals' : 'potes'
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Onde o dinheiro mora e para onde ele vai</p>
          <h1 className="display text-3xl font-bold lg:text-4xl">{tab === 'potes' ? 'Potes' : 'Objetivos'}</h1>
        </div>
        <Segmented
          className="w-full sm:w-72"
          value={tab}
          onChange={(v) => setParams(v === 'goals' ? { aba: 'objetivos' } : {}, { replace: true })}
          options={[{ value: 'potes', label: 'Potes' }, { value: 'goals', label: 'Objetivos' }]}
        />
      </header>
      {tab === 'potes' ? <PotesTab /> : <GoalsTab />}
    </div>
  )
}

// ---------------------------------------------------------------- potes

interface PoteMonth { pote: Category | null; paid: number; scheduled: number; total: number; entries: Entry[] }

function PotesTab() {
  const { workspace } = useSession()
  const today = todayISO()
  const current = monthKey(today)
  const [key, setKey] = useState(current)
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [viewing, setViewing] = useState<PoteMonth | null>(null)
  const [creating, setCreating] = useState<Kind | null>(null)
  const categories = useCategories(workspace.id).data
  const q = useEntries(workspace.id, monthStart(key), monthEnd(key))

  const data = useMemo(() => {
    if (!categories || !q.data) return null
    const month = dueInMonth(q.data.items, key)
    const by = (kind: Kind) => {
      const rows: PoteMonth[] = categories.filter((c) => c.kind === kind).map((c) => ({ pote: c, paid: 0, scheduled: 0, total: 0, entries: [] }))
      const none: PoteMonth = { pote: null, paid: 0, scheduled: 0, total: 0, entries: [] }
      for (const e of month.filter((x) => x.kind === kind)) {
        const row = rows.find((r) => r.pote!.id === e.categoryId) ?? none
        row.entries.push(e)
        if (e.paidDate) row.paid += paidValue(e); else row.scheduled += e.amountCents
        row.total += e.amountCents
      }
      return { rows: rows.sort((a, b) => b.total - a.total), none }
    }
    const expense = by('Expense')
    const budgeted = expense.rows.filter((r) => r.pote!.budgetCents && !r.pote!.archived)
    return {
      expense, income: by('Income'),
      budget: budgeted.reduce((a, r) => a + r.pote!.budgetCents!, 0),
      usedInBudgeted: budgeted.reduce((a, r) => a + r.total, 0),
      over: budgeted.filter((r) => r.total > r.pote!.budgetCents!),
      totalExpense: expense.rows.reduce((a, r) => a + r.total, 0) + expense.none.total,
    }
  }, [categories, q.data, key])

  if (!data) return <Spinner />
  const visible = (rows: PoteMonth[]) => rows.filter((r) => !r.pote!.archived || (showArchived && r.pote!.archived))
  const archivedCount = (categories ?? []).filter((c) => c.archived).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSwitcher value={key} onChange={setKey} min={addMonthsKey(current, -24)} max={addMonthsKey(current, 12)} />
        <Button size="sm" onClick={() => setCreating('Expense')}><Plus size={16} /> Novo pote</Button>
      </div>

      {data.budget > 0 && (
        <section className="card p-5 lg:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-muted">Potes com teto · {monthLabel(key, true)}</p>
              <p className="display num mt-1 text-3xl font-bold">{money(data.usedInBudgeted)} <span className="text-lg font-semibold text-muted">de {money(data.budget)}</span></p>
            </div>
            <p className={clsx('num text-sm font-bold', data.usedInBudgeted > data.budget ? 'text-expense-text' : 'text-good-text')}>
              {data.usedInBudgeted > data.budget ? `Passou ${money(data.usedInBudgeted - data.budget)}` : `Sobram ${money(data.budget - data.usedInBudgeted)}`}
            </p>
          </div>
          <Progress className="mt-4" height={10} value={data.usedInBudgeted / data.budget} color={data.usedInBudgeted > data.budget ? 'var(--critical)' : 'var(--accent)'} />
          {data.over.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-expense-text">
              <AlertTriangle size={15} /> Estourados: {data.over.map((r) => r.pote!.name).join(', ')}
            </p>
          )}
        </section>
      )}

      <div>
        <h2 className="display mb-3 text-lg font-semibold">Potes de despesa</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible(data.expense.rows).map((r) => <PoteCard key={r.pote!.id} row={r} share={data.totalExpense ? r.total / data.totalExpense : 0} onOpen={() => setViewing(r)} />)}
          {data.expense.none.total > 0 && <PoteCard row={data.expense.none} share={data.totalExpense ? data.expense.none.total / data.totalExpense : 0} onOpen={() => setViewing(data.expense.none)} />}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-lg font-semibold">Potes de receita</h2>
          <Button size="sm" variant="ghost" onClick={() => setCreating('Income')}><Plus size={15} /> Pote de receita</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible(data.income.rows).map((r) => <PoteCard key={r.pote!.id} row={r} share={0} income onOpen={() => setViewing(r)} />)}
        </div>
      </div>

      {archivedCount > 0 && (
        <button onClick={() => setShowArchived(!showArchived)} className="text-sm font-semibold text-muted hover:text-fg">
          {showArchived ? 'Esconder' : 'Mostrar'} arquivados ({archivedCount})
        </button>
      )}

      <Sheet open={viewing != null} onClose={() => setViewing(null)} title={viewing?.pote?.name ?? 'Sem pote'}>
        {viewing && <PoteDetail row={viewing} monthKey={key} onEdit={() => { setEditing(viewing.pote); setViewing(null) }} />}
      </Sheet>
      <Sheet open={editing != null} onClose={() => setEditing(null)} title="Editar pote">
        {editing && <PoteForm key={editing.id} pote={editing} kind={editing.kind} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={creating != null} onClose={() => setCreating(null)} title="Novo pote">
        {creating && (
          <div className="space-y-4">
            <Segmented value={creating} onChange={setCreating} options={[{ value: 'Expense', label: 'Para gastar' }, { value: 'Income', label: 'Para receber' }]} />
            <PoteForm key={creating} pote={null} kind={creating} onDone={() => setCreating(null)} />
          </div>
        )}
      </Sheet>
    </div>
  )
}

function PoteCard({ row, share, income, onOpen }: { row: PoteMonth; share: number; income?: boolean; onOpen: () => void }) {
  const { pote } = row
  const color = catColor(pote)
  const budget = pote?.budgetCents ?? null
  const use = budget ? row.total / budget : null
  const over = use != null && use > 1
  return (
    <button onClick={onOpen} className={clsx('card rise flex flex-col p-4 text-left transition hover:border-line-strong', pote?.archived && 'opacity-55')}>
      <div className="flex items-center gap-3">
        <CategoryBadge icon={pote?.icon ?? 'tag'} color={color} size={42} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{pote?.name ?? 'Sem pote'}</p>
          <p className="text-xs text-muted">{row.entries.length} lançamento(s){!income && share > 0 && ` · ${pct(share)} do mês`}</p>
        </div>
        <ChevronRight size={18} className="text-faint" />
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <p className="display num text-2xl font-bold">{money(row.total)}</p>
        {budget != null && <p className="num text-xs font-semibold text-muted">de {money(budget)}</p>}
      </div>
      {budget != null ? (
        <>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full" style={{ width: `${Math.min(100, (row.paid / budget) * 100)}%`, background: over ? 'var(--critical)' : color }} />
            <div className="h-full" style={{ width: `${Math.max(0, Math.min(100 - (row.paid / budget) * 100, (row.scheduled / budget) * 100))}%`, background: over ? 'var(--critical)' : color, opacity: 0.4 }} />
          </div>
          <p className={clsx('num mt-2 text-xs font-bold', over ? 'text-expense-text' : 'text-muted')}>
            {over ? `Passou ${money(row.total - budget)}` : `Restam ${money(budget - row.total)}`} · {pct(use)}
          </p>
        </>
      ) : (
        <p className="num mt-2 text-xs text-muted">{income ? `${money(row.paid)} recebido` : `${money(row.paid)} pago · ${money(row.scheduled)} a pagar`}{!income && pote ? ' · sem teto' : ''}</p>
      )}
    </button>
  )
}

function PoteDetail({ row, monthKey: key, onEdit }: { row: PoteMonth; monthKey: string; onEdit: () => void }) {
  const { openEntry, workspace } = useSession()
  const m = useEntryMutations(workspace.id)
  const categories = useCategories(workspace.id).data ?? []
  const today = todayISO()
  const cat = new Map(categories.map((c) => [c.id, c]))
  return (
    <div className="space-y-4 pt-1">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={row.pote?.kind === 'Income' ? 'Recebido' : 'Pago'} value={money(row.paid)} />
        <Stat label="Em aberto" value={money(row.scheduled)} />
        <Stat label={row.pote?.budgetCents ? 'Teto' : 'Total'} value={money(row.pote?.budgetCents ?? row.total)} />
      </div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{monthLabel(key, true)}</p>
      {row.entries.length === 0 ? <p className="py-4 text-sm text-muted">Nada neste pote no mês.</p> : (
        <div className="divide-y divide-line">
          {row.entries.map((e) => <EntryRow key={e.id} entry={e} category={e.categoryId ? cat.get(e.categoryId) : undefined} today={today} onOpen={() => openEntry(e)} onToggle={() => m.toggle(e)} />)}
        </div>
      )}
      {row.pote && <Button variant="soft" className="w-full" onClick={onEdit}>Editar pote</Button>}
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl bg-surface-2 p-3">
    <p className="text-[11px] font-semibold text-muted">{label}</p>
    <p className="num truncate text-sm font-bold">{value}</p>
  </div>
)

// ---------------------------------------------------------------- objetivos

function GoalsTab() {
  const { workspace } = useSession()
  const navigate = useNavigate()
  const q = useGoals(workspace.id)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const today = todayISO()

  if (q.isLoading && !q.data) return <Spinner />
  const goals = q.data ?? []
  const active = goals.filter((g) => !g.archived)
  const list = showArchived ? goals : active
  const totals = active.reduce((a, g) => ({ target: a.target + g.targetCents, paid: a.paid + g.paidCents, scheduled: a.scheduled + g.scheduledCents }), { target: 0, paid: 0, scheduled: 0 })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">Um objetivo junta tudo o que você já pagou e o que ainda vai pagar por ele — e mostra quanto falta.</p>
        <Button size="sm" onClick={() => setCreating(true)}><Plus size={16} /> Novo objetivo</Button>
      </div>

      {active.length > 0 && (
        <section className="card grid grid-cols-3 gap-3 p-4 lg:p-5">
          <div><p className="text-xs font-semibold text-muted">Metas somadas</p><p className="display num truncate text-[15px] font-bold min-[420px]:text-lg lg:text-xl">{money(totals.target)}</p></div>
          <div><p className="text-xs font-semibold text-muted">Já pago</p><p className="display num truncate text-[15px] font-bold min-[420px]:text-lg lg:text-xl">{money(totals.paid)}</p></div>
          <div><p className="text-xs font-semibold text-muted">Falta pagar</p><p className="display num truncate text-[15px] font-bold min-[420px]:text-lg lg:text-xl">{money(Math.max(0, totals.target - totals.paid))}</p></div>
        </section>
      )}

      {list.length === 0 ? (
        <div className="card">
          <Empty icon={Target} title="Nenhum objetivo ainda" hint="Casamento, carro, casa, viagem… Crie um e ligue a ele as contas que já pagou e as que vêm por aí."
            action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Criar o primeiro</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((g, i) => {
            const p = goalProgress(g, today)
            const color = `var(--cat-${g.color})`
            return (
              <button key={g.id} onClick={() => navigate(`/objetivos/${g.id}`)} style={{ animationDelay: `${i * 60}ms` }}
                className={clsx('card rise flex items-center gap-4 p-4 text-left transition hover:border-line-strong lg:p-5', g.archived && 'opacity-55')}>
                <ProgressRing paid={p.paidShare} committed={p.committedShare} color={color} size={104} stroke={11}>
                  <div>
                    <p className="display num text-xl font-bold leading-none">{pct(p.paidShare)}</p>
                    <p className="mt-0.5 text-[10px] font-semibold text-muted">pago</p>
                  </div>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <CategoryBadge icon={g.icon} color={color} size={28} />
                    <p className="truncate font-bold">{g.name}</p>
                  </div>
                  <p className="num mt-2 text-sm"><b>{money(p.paid)}</b> <span className="text-muted">de {money(g.targetCents)}</span></p>
                  <p className="num text-xs text-muted">
                    {p.toPay > 0 ? `Faltam ${money(p.toPay)}` : 'Meta atingida'}
                    {p.scheduled > 0 && ` · ${money(p.scheduled)} agendado`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusPill status={p.status} />
                    {g.targetDate && <span className="num text-[11px] text-muted">até {fullDate(g.targetDate)}{p.monthlyNeeded ? ` · ${money(p.monthlyNeeded)}/mês` : ''}</span>}
                    {g.overdueCents > 0 && <span className="text-[11px] font-bold text-expense-text">{money(g.overdueCents)} atrasado</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {goals.length > active.length && (
        <button onClick={() => setShowArchived(!showArchived)} className="text-sm font-semibold text-muted hover:text-fg">
          {showArchived ? 'Esconder' : 'Mostrar'} arquivados ({goals.length - active.length})
        </button>
      )}

      <Sheet open={creating} onClose={() => setCreating(false)} title="Novo objetivo">
        {creating && <GoalForm goal={null} onDone={(g) => { setCreating(false); if (g) navigate(`/objetivos/${g.id}`) }} />}
      </Sheet>
    </div>
  )
}
