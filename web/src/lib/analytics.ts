/**
 * O motor do painel e dos relatórios. Funções puras sobre a lista de lançamentos.
 *
 * Convenções:
 * - "Previsto" (planned): tudo que vence no período (regime de competência por vencimento).
 * - "Realizado" (settled): o que, desses, já foi pago/recebido — pelo valor efetivamente pago.
 * - "Caixa": saldo pela data de pagamento (regime de caixa), a partir do saldo de abertura.
 *   Pagos por fora do caixa (`offCash`, ex.: o sócio pagou com dinheiro pessoal) contam como
 *   realizado, mas não entram no saldo. Aplicações mexem no caixa via `flows` (vindos do servidor):
 *   transferências que só afetam o saldo, nunca previsto/realizado/margem.
 */
import { addDays, addMonthsKey, daysInMonth, monthEnd, monthKey, monthRange, monthStart } from './dates'
import type { CashFlow, Category, Entry, Kind, Method } from './types'

export type Status = 'paid' | 'overdue' | 'pending'

export const status = (e: Entry, today: string): Status =>
  e.paidDate ? 'paid' : e.dueDate < today ? 'overdue' : 'pending'

export const paidValue = (e: Entry) => e.paidAmountCents ?? e.amountCents
export const signOf = (e: Entry) => (e.kind === 'Income' ? 1 : -1)
/** Pago e movimentou este caixa. */
const paidInCash = (e: Entry) => !!e.paidDate && !e.offCash
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const ratio = (a: number, b: number) => (b === 0 ? null : a / b)

export const dueIn = (entries: Entry[], from: string, to: string) =>
  entries.filter((e) => e.dueDate >= from && e.dueDate <= to)
export const dueInMonth = (entries: Entry[], key: string) => dueIn(entries, monthStart(key), monthEnd(key))

// ---------------------------------------------------------------- totais

export interface Side {
  planned: number
  settled: number
  open: number
  overdue: number
  count: number
  openCount: number
  overdueCount: number
  /** Fração do previsto já realizada (0–1). */
  progress: number | null
}

export function side(entries: Entry[], kind: Kind, today: string): Side {
  const xs = entries.filter((e) => e.kind === kind)
  const paid = xs.filter((e) => e.paidDate)
  const open = xs.filter((e) => !e.paidDate)
  const overdue = open.filter((e) => e.dueDate < today)
  const planned = sum(xs.map((e) => e.amountCents))
  const settled = sum(paid.map(paidValue))
  return {
    planned,
    settled,
    open: sum(open.map((e) => e.amountCents)),
    overdue: sum(overdue.map((e) => e.amountCents)),
    count: xs.length,
    openCount: open.length,
    overdueCount: overdue.length,
    progress: ratio(sum(paid.map((e) => e.amountCents)), planned),
  }
}

export interface Totals {
  income: Side
  expense: Side
  netPlanned: number
  netSettled: number
  /** Resultado previsto ÷ receita prevista. */
  margin: number | null
  /** Despesa prevista ÷ receita prevista: quanto da receita já está comprometido. */
  commitment: number | null
}

export function totals(entries: Entry[], today: string): Totals {
  const income = side(entries, 'Income', today)
  const expense = side(entries, 'Expense', today)
  const netPlanned = income.planned - expense.planned
  return {
    income,
    expense,
    netPlanned,
    netSettled: income.settled - expense.settled,
    margin: ratio(netPlanned, income.planned),
    commitment: ratio(expense.planned, income.planned),
  }
}

export const change = (now: number, before: number) => (before === 0 ? null : (now - before) / Math.abs(before))

// ---------------------------------------------------------------- caixa

/**
 * Saldo de caixa ao fim de `date`, dado o saldo imediatamente antes de `windowFrom`
 * e os lançamentos carregados a partir dessa data. `flows` = efeito das aplicações no caixa
 * (aporte, resgate, provento): transferências, nunca receita/despesa.
 */
export function cashAt(entries: Entry[], balanceBefore: number, windowFrom: string, date: string, flows: CashFlow[] = []) {
  let bal = balanceBefore
  for (const e of entries)
    if (paidInCash(e) && e.paidDate! >= windowFrom && e.paidDate! <= date) bal += signOf(e) * paidValue(e)
  for (const f of flows) if (f.date >= windowFrom && f.date <= date) bal += f.amountCents
  return bal
}

/** Caixa de hoje + tudo em aberto (inclusive atrasados) que vence até `date`. */
export function projectedAt(entries: Entry[], cashToday: number, date: string) {
  let bal = cashToday
  for (const e of entries) if (!e.paidDate && e.dueDate <= date) bal += signOf(e) * e.amountCents
  return bal
}

export interface CashPoint {
  date: string
  day: number
  realized: number | null
  projected: number | null
  inflow: number
  outflow: number
}

/** Curva diária do mês: realizado até hoje (linha cheia) e projeção daí em diante (tracejada). */
export function cashCurve(entries: Entry[], balanceBefore: number, windowFrom: string, key: string, today: string, flows: CashFlow[] = []): CashPoint[] {
  const cashToday = cashAt(entries, balanceBefore, windowFrom, today, flows)
  const n = daysInMonth(key)
  const points: CashPoint[] = []
  for (let d = 1; d <= n; d++) {
    const date = `${key}-${String(d).padStart(2, '0')}`
    const day = entries.filter((e) => (e.paidDate ?? e.dueDate) === date && !(e.paidDate && e.offCash))
    points.push({
      date,
      day: d,
      realized: date <= today ? cashAt(entries, balanceBefore, windowFrom, date, flows) : null,
      projected: date >= today ? projectedAt(entries, cashToday, date) : null,
      inflow: sum(day.filter((e) => e.kind === 'Income').map((e) => (e.paidDate ? paidValue(e) : e.amountCents))),
      outflow: sum(day.filter((e) => e.kind === 'Expense').map((e) => (e.paidDate ? paidValue(e) : e.amountCents))),
    })
  }
  return points
}

// ---------------------------------------------------------------- séries mensais

export interface MonthPoint {
  key: string
  income: number
  expense: number
  incomeSettled: number
  expenseSettled: number
  net: number
  margin: number | null
  /** Mês futuro: só previsão. */
  future: boolean
}

export function monthly(entries: Entry[], fromKey: string, toKey: string, today: string): MonthPoint[] {
  const current = monthKey(today)
  return monthRange(fromKey, toKey).map((key) => {
    const t = totals(dueInMonth(entries, key), today)
    return {
      key,
      income: t.income.planned,
      expense: t.expense.planned,
      incomeSettled: t.income.settled,
      expenseSettled: t.expense.settled,
      net: t.netPlanned,
      margin: t.margin,
      future: key > current,
    }
  })
}

// ---------------------------------------------------------------- composição

export interface Slice {
  id: string
  name: string
  /** Cor CSS — sempre a do slot da categoria (a cor segue a entidade). */
  color: string
  icon: string
  value: number
  share: number
  count: number
  previous: number
  delta: number | null
  budget: number | null
  budgetUse: number | null
}

export const catColor = (c?: Pick<Category, 'color'> | null) => (c ? `var(--cat-${c.color})` : 'var(--faint)')

/**
 * Quebra por categoria. Acima de `maxSlices` o resto é dobrado em "Outras"
 * (nunca se gera uma 9ª cor).
 */
export function byCategory(
  entries: Entry[],
  previous: Entry[],
  kind: Kind,
  categories: Category[],
  maxSlices = 6,
): Slice[] {
  const map = new Map(categories.map((c) => [c.id, c]))
  const groups = new Map<string, { value: number; count: number; prev: number }>()
  const bump = (id: string, value: number, count: number, prev: number) => {
    const g = groups.get(id) ?? { value: 0, count: 0, prev: 0 }
    g.value += value; g.count += count; g.prev += prev
    groups.set(id, g)
  }
  for (const e of entries) if (e.kind === kind) bump(e.categoryId ?? '_none', e.amountCents, 1, 0)
  for (const e of previous) if (e.kind === kind) bump(e.categoryId ?? '_none', 0, 0, e.amountCents)

  const total = sum([...groups.values()].map((g) => g.value))
  const rows: Slice[] = [...groups.entries()]
    .filter(([, g]) => g.value > 0)
    .map(([id, g]) => {
      const c = map.get(id)
      const budget = kind === 'Expense' ? (c?.budgetCents ?? null) : null
      return {
        id,
        name: c?.name ?? 'Sem pote',
        color: catColor(c),
        icon: c?.icon ?? 'tag',
        value: g.value,
        share: total ? g.value / total : 0,
        count: g.count,
        previous: g.prev,
        delta: change(g.value, g.prev),
        budget,
        budgetUse: budget ? g.value / budget : null,
      }
    })
    .sort((a, b) => b.value - a.value)

  if (rows.length <= maxSlices) return rows
  const head = rows.slice(0, maxSlices - 1)
  const tail = rows.slice(maxSlices - 1)
  const value = sum(tail.map((r) => r.value))
  const prev = sum(tail.map((r) => r.previous))
  return [
    ...head,
    {
      id: '_other', name: `Outras (${tail.length})`, color: 'var(--faint)', icon: 'more-horizontal',
      value, share: total ? value / total : 0, count: sum(tail.map((r) => r.count)), previous: prev,
      delta: change(value, prev), budget: null, budgetUse: null,
    },
  ]
}

/** Despesa fixa (vem de série recorrente) × variável (lançamento avulso). */
export function fixedVsVariable(entries: Entry[], kind: Kind = 'Expense') {
  const xs = entries.filter((e) => e.kind === kind)
  const fixed = sum(xs.filter((e) => e.recurrenceId).map((e) => e.amountCents))
  const variable = sum(xs.filter((e) => !e.recurrenceId).map((e) => e.amountCents))
  return { fixed, variable, fixedShare: ratio(fixed, fixed + variable) }
}

export interface Ranked {
  name: string
  value: number
  share: number
  count: number
}

function rank(entries: Entry[], kind: Kind, keyOf: (e: Entry) => string, limit: number): Ranked[] {
  const g = new Map<string, { value: number; count: number }>()
  for (const e of entries) {
    if (e.kind !== kind) continue
    const k = keyOf(e)
    const v = g.get(k) ?? { value: 0, count: 0 }
    v.value += e.amountCents; v.count++
    g.set(k, v)
  }
  const total = sum([...g.values()].map((v) => v.value))
  return [...g.entries()]
    .map(([name, v]) => ({ name, value: v.value, count: v.count, share: total ? v.value / total : 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

export const byCounterparty = (entries: Entry[], kind: Kind, limit = 6) =>
  rank(entries, kind, (e) => e.counterparty?.trim() || 'Não informado', limit)

export const byMethod = (entries: Entry[], kind: Kind, label: (m: Method) => string) =>
  rank(entries, kind, (e) => (e.method ? label(e.method) : 'Não informado'), 8)

// ---------------------------------------------------------------- calendário

export interface CalendarDay {
  date: string
  day: number
  expense: number
  income: number
  count: number
  overdue: number
}

export function calendar(entries: Entry[], key: string, today: string): CalendarDay[] {
  const out: CalendarDay[] = []
  for (let d = 1; d <= daysInMonth(key); d++) {
    const date = `${key}-${String(d).padStart(2, '0')}`
    const xs = entries.filter((e) => e.dueDate === date)
    out.push({
      date,
      day: d,
      expense: sum(xs.filter((e) => e.kind === 'Expense').map((e) => e.amountCents)),
      income: sum(xs.filter((e) => e.kind === 'Income').map((e) => e.amountCents)),
      count: xs.length,
      overdue: xs.filter((e) => status(e, today) === 'overdue').length,
    })
  }
  return out
}

// ---------------------------------------------------------------- indicadores

export interface Indicators {
  cashToday: number
  projectedMonthEnd: number
  avgExpense3: number
  avgIncome3: number
  /** Quantos meses o caixa de hoje paga a despesa média, sem nenhuma receita. */
  runwayMonths: number | null
  margin12: number | null
  onTimeExpense: number | null
  onTimeIncome: number | null
  biggestExpense: Entry | null
  ytd: Totals
  /** Média diária de despesa realizada no mês (até hoje). */
  dailyBurn: number | null
}

export function indicators(
  entries: Entry[],
  balanceBefore: number,
  windowFrom: string,
  key: string,
  today: string,
  flows: CashFlow[] = [],
): Indicators {
  const cashToday = cashAt(entries, balanceBefore, windowFrom, today, flows)
  const last3 = monthly(entries, addMonthsKey(key, -2), key, today)
  const last12 = monthly(entries, addMonthsKey(key, -11), key, today)
  const avgExpense3 = sum(last3.map((m) => m.expense)) / 3
  const avgIncome3 = sum(last3.map((m) => m.income)) / 3

  const year = key.slice(0, 4)
  const ytd = totals(dueIn(entries, `${year}-01-01`, monthEnd(key)), today)

  const yearAgo = addDays(today, -365)
  const paidRecently = entries.filter((e) => e.paidDate && e.paidDate >= yearAgo && e.paidDate <= today)
  const onTime = (kind: Kind) => {
    const xs = paidRecently.filter((e) => e.kind === kind)
    return ratio(xs.filter((e) => e.paidDate! <= e.dueDate).length, xs.length)
  }

  const month = dueInMonth(entries, key)
  const biggestExpense = month.filter((e) => e.kind === 'Expense').sort((a, b) => b.amountCents - a.amountCents)[0] ?? null

  const isCurrent = key === monthKey(today)
  const spentSoFar = sum(month.filter((e) => e.kind === 'Expense' && e.paidDate && e.paidDate <= today).map(paidValue))

  return {
    cashToday,
    // Mês já fechado: o "fim do mês" é o caixa realizado naquela data.
    projectedMonthEnd: monthEnd(key) < today
      ? cashAt(entries, balanceBefore, windowFrom, monthEnd(key), flows)
      : projectedAt(entries, cashToday, monthEnd(key)),
    avgExpense3,
    avgIncome3,
    runwayMonths: avgExpense3 > 0 ? Math.max(0, cashToday) / avgExpense3 : null,
    margin12: ratio(sum(last12.map((m) => m.net)), sum(last12.map((m) => m.income))),
    onTimeExpense: onTime('Expense'),
    onTimeIncome: onTime('Income'),
    biggestExpense,
    ytd,
    dailyBurn: isCurrent ? spentSoFar / Number(today.slice(8, 10)) : null,
  }
}

// ---------------------------------------------------------------- listas

export const overdueList = (entries: Entry[], today: string) =>
  entries.filter((e) => !e.paidDate && e.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))

export const upcomingList = (entries: Entry[], today: string, days = 7) =>
  entries
    .filter((e) => !e.paidDate && e.dueDate >= today && e.dueDate <= addDays(today, days))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amountCents - a.amountCents)

// ---------------------------------------------------------------- relatórios

export interface MatrixRow {
  id: string
  name: string
  color: string
  total: number
  share: number
  avg: number
  perMonth: Record<string, number>
}

/** Categoria × mês, para a tabela de evolução. */
export function categoryMatrix(entries: Entry[], kind: Kind, categories: Category[], months: string[]): MatrixRow[] {
  const map = new Map(categories.map((c) => [c.id, c]))
  const rows = new Map<string, MatrixRow>()
  for (const e of entries) {
    if (e.kind !== kind) continue
    const id = e.categoryId ?? '_none'
    const c = map.get(id)
    const row = rows.get(id) ?? { id, name: c?.name ?? 'Sem pote', color: catColor(c), total: 0, share: 0, avg: 0, perMonth: {} }
    const k = monthKey(e.dueDate)
    row.perMonth[k] = (row.perMonth[k] ?? 0) + e.amountCents
    row.total += e.amountCents
    rows.set(id, row)
  }
  const total = sum([...rows.values()].map((r) => r.total))
  return [...rows.values()]
    .map((r) => ({ ...r, share: total ? r.total / total : 0, avg: months.length ? r.total / months.length : 0 }))
    .sort((a, b) => b.total - a.total)
}
