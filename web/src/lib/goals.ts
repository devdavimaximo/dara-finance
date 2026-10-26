/** Matemática dos objetivos — pura, testada em goals.test.ts. */
import { diffDays, monthKey, monthRange } from './dates'
import type { Entry, Goal } from './types'

export type GoalStatus = 'done' | 'covered' | 'on-track' | 'behind' | 'no-date'

export interface GoalProgress {
  paid: number
  scheduled: number
  /** Pago + agendado: o que já tem destino certo. */
  committed: number
  /** Meta − pago − agendado (nunca negativo): ainda sem conta lançada. */
  unplanned: number
  /** Meta − pago: o que ainda vai sair do bolso. */
  toPay: number
  paidShare: number
  committedShare: number
  daysLeft: number | null
  monthsLeft: number | null
  /** Quanto por mês, até a data, para pagar o que falta (agendado + sem conta). */
  monthlyNeeded: number | null
  status: GoalStatus
}

export function goalProgress(g: Goal, today: string): GoalProgress {
  const paid = g.paidCents
  const scheduled = g.scheduledCents
  const committed = paid + scheduled
  const target = Math.max(1, g.targetCents)
  const toPay = Math.max(0, g.targetCents - paid)
  const daysLeft = g.targetDate ? diffDays(g.targetDate, today) : null
  // Meses restantes contando o mês corrente (vence no fim do mês = ainda 1 mês).
  const monthsLeft = g.targetDate ? Math.max(1, monthRange(monthKey(today), monthKey(g.targetDate)).length) : null

  let status: GoalStatus
  if (paid >= g.targetCents) status = 'done'
  else if (committed >= g.targetCents) status = 'covered'
  else if (daysLeft == null) status = 'no-date'
  // Com data: em andamento até ela; passou da data sem quitar = atrasado.
  else status = daysLeft < 0 ? 'behind' : 'on-track'

  return {
    paid,
    scheduled,
    committed,
    unplanned: Math.max(0, g.targetCents - committed),
    toPay,
    paidShare: Math.min(1, paid / target),
    committedShare: Math.min(1, committed / target),
    daysLeft,
    monthsLeft,
    monthlyNeeded: monthsLeft && toPay > 0 && (daysLeft ?? 0) >= 0 ? Math.ceil(toPay / monthsLeft) : null,
    status,
  }
}

export interface GoalPoint {
  key: string
  /** Acumulado pago até o fim do mês (meses passados e o atual). */
  paid: number | null
  /** Acumulado comprometido (pago + agendado) — projeção a partir do mês atual. */
  projected: number | null
  monthPaid: number
  monthScheduled: number
}

/** Curva acumulada mês a mês: do primeiro lançamento até a data-alvo ou o último vencimento. */
export function goalCurve(entries: Entry[], g: Goal, today: string): GoalPoint[] {
  const xs = entries.filter((e) => e.kind === 'Expense')
  if (!xs.length) return []
  const when = (e: Entry) => monthKey(e.paidDate ?? e.dueDate)
  const cur = monthKey(today)
  const keys = [...xs.map(when), cur, ...(g.targetDate ? [monthKey(g.targetDate)] : [])].sort()
  const months = monthRange(keys[0]!, keys.at(-1)!)
  let paid = 0
  let committed = 0
  return months.map((key) => {
    const inMonth = xs.filter((e) => when(e) === key)
    const monthPaid = inMonth.filter((e) => e.paidDate).reduce((a, e) => a + (e.paidAmountCents ?? e.amountCents), 0)
    // Agendado atrasado entra no mês atual (é quando ainda precisa ser pago).
    const monthScheduled = xs.filter((e) => !e.paidDate && (key === cur ? e.dueDate.slice(0, 7) <= cur : monthKey(e.dueDate) === key && key > cur))
      .reduce((a, e) => a + e.amountCents, 0)
    paid += monthPaid
    committed += monthPaid + monthScheduled
    return {
      key,
      paid: key <= cur ? paid : null,
      projected: key >= cur ? committed : null,
      monthPaid,
      monthScheduled,
    }
  })
}
