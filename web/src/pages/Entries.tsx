import { FileUp, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { EntryRow } from '../components/EntryRow'
import { Chip, Empty, MonthSwitcher, Spinner } from '../components/ui'
import { dueInMonth, side, status } from '../lib/analytics'
import { useCategories, useEntries, useEntryMutations } from '../lib/api'
import { addMonthsKey, dayLabel, monthEnd, monthKey, monthStart, todayISO } from '../lib/dates'
import { money } from '../lib/format'
import { useSession } from '../lib/session'
import type { Entry } from '../lib/types'

type Filter = 'all' | 'pay' | 'receive' | 'open' | 'overdue' | 'paid' | 'recurring'

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pay', label: 'A pagar' },
  { value: 'receive', label: 'A receber' },
  { value: 'open', label: 'Em aberto' },
  { value: 'overdue', label: 'Atrasados' },
  { value: 'paid', label: 'Pagos' },
  { value: 'recurring', label: 'Recorrentes' },
]

export function EntriesPage() {
  const { workspace, openEntry } = useSession()
  const today = todayISO()
  const current = monthKey(today)
  const [key, setKey] = useState(current)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const q = useEntries(workspace.id, monthStart(key), monthEnd(key))
  const categories = useCategories(workspace.id).data ?? []
  const m = useEntryMutations(workspace.id)
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const month = useMemo(() => dueInMonth(q.data?.items ?? [], key), [q.data, key])
  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return month.filter((e) => {
      const st = status(e, today)
      const ok =
        filter === 'all' ||
        (filter === 'pay' && e.kind === 'Expense' && st !== 'paid') ||
        (filter === 'receive' && e.kind === 'Income' && st !== 'paid') ||
        (filter === 'open' && st !== 'paid') ||
        (filter === 'overdue' && st === 'overdue') ||
        (filter === 'paid' && st === 'paid') ||
        (filter === 'recurring' && !!e.recurrenceId)
      if (!ok) return false
      if (!s) return true
      const cat = e.categoryId ? catMap.get(e.categoryId)?.name : ''
      return [e.description, e.counterparty, e.notes, cat].some((x) => x?.toLowerCase().includes(s))
    })
  }, [month, filter, search, today, catMap])

  const groups = useMemo(() => {
    const g = new Map<string, Entry[]>()
    for (const e of list) g.set(e.dueDate, [...(g.get(e.dueDate) ?? []), e])
    return [...g.entries()]
  }, [list])

  const exp = side(month, 'Expense', today)
  const inc = side(month, 'Income', today)
  const toggle = m.toggle

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Contas a pagar e a receber</p>
          <h1 className="display text-3xl font-bold lg:text-4xl">Lançamentos</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/importar" className="inline-flex h-[42px] items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 text-sm font-bold hover:border-line-strong"><FileUp size={17} /> <span className="hidden sm:inline">Importar extrato</span><span className="sm:hidden">Importar</span></Link>
          <MonthSwitcher value={key} onChange={setKey} min={addMonthsKey(current, -60)} max={addMonthsKey(current, 24)} />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="A receber (aberto)" value={money(inc.open)} sub={`${inc.openCount} de ${inc.count}`} color="var(--income)" />
        <Summary label="A pagar (aberto)" value={money(exp.open)} sub={`${exp.openCount} de ${exp.count}`} color="var(--expense)" />
        <Summary label="Recebido" value={money(inc.settled)} sub={`de ${money(inc.planned)}`} color="var(--income)" muted />
        <Summary label="Pago" value={money(exp.settled)} sub={`de ${money(exp.planned)}`} color="var(--expense)" muted />
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
          <input className="field pl-11" placeholder="Buscar por descrição, pote, fornecedor…" value={search} onChange={(e) => setSearch(e.target.value)} type="search" />
        </div>
        <div className="scroll-x -mx-4 flex gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {filters.map((f) => <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</Chip>)}
        </div>
      </div>

      {q.isLoading ? <Spinner /> : groups.length === 0 ? (
        <div className="card"><Empty title="Nenhum lançamento" hint={month.length ? 'Nada com esse filtro.' : 'Use o botão + para lançar uma conta.'} /></div>
      ) : (
        <div className="space-y-4">
          {groups.map(([date, items]) => {
            const net = items.reduce((a, e) => a + (e.kind === 'Income' ? 1 : -1) * e.amountCents, 0)
            return (
              <section key={date} className="card px-4 py-2 lg:px-5">
                <div className="flex items-center justify-between border-b border-line py-2 text-sm">
                  <span className={date === today ? 'font-bold text-accent-text' : 'font-bold capitalize text-fg-2'}>{date === today ? 'Hoje' : dayLabel(date)}</span>
                  <span className="num text-xs font-semibold text-muted">{net >= 0 ? '+' : '−'}{money(Math.abs(net))}</span>
                </div>
                <div className="divide-y divide-line">
                  {items.map((e) => (
                    <EntryRow key={e.id} entry={e} category={e.categoryId ? catMap.get(e.categoryId) : undefined} today={today} onOpen={() => openEntry(e)} onToggle={() => toggle(e)} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Summary({ label, value, sub, color, muted }: { label: string; value: string; sub: string; color: string; muted?: boolean }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: color, opacity: muted ? 0.4 : 1 }} />
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="display num mt-1 truncate text-xl font-bold">{value}</p>
      <p className="num text-xs text-faint">{sub}</p>
    </div>
  )
}
