import { describe, expect, it } from 'vitest'
import { goalCurve, goalProgress } from './goals'
import type { Entry, Goal } from './types'

const goal = (p: Partial<Goal>): Goal => ({
  id: 'g', name: 'Casamento', icon: 'heart', color: 5, targetCents: 80000_00, targetDate: '2027-10-29', notes: null, archived: false,
  paidCents: 0, scheduledCents: 0, overdueCents: 0, paidCount: 0, openCount: 0, nextDue: null, lastDue: null, ...p,
})

let n = 0
const e = (p: Partial<Entry>): Entry => ({
  id: String(++n), kind: 'Expense', description: 'x', amountCents: 1000_00, dueDate: '2026-10-10', paidDate: null, paidAmountCents: null,
  categoryId: null, counterparty: null, method: null, notes: null, recurrenceId: null, sequence: null, seriesCount: null,
  frequency: null, attachmentName: null, goalId: 'g', ...p,
})

describe('goalProgress', () => {
  it('separa pago, agendado, sem conta e calcula o mensal necessário até a data', () => {
    const p = goalProgress(goal({ paidCents: 15000_00, scheduledCents: 30000_00 }), '2026-10-26')
    expect(p.committed).toBe(45000_00)
    expect(p.unplanned).toBe(35000_00)
    expect(p.toPay).toBe(65000_00)
    expect(p.paidShare).toBeCloseTo(15 / 80)
    expect(p.monthsLeft).toBe(13) // out/26 … out/27
    expect(p.monthlyNeeded).toBe(Math.ceil(65000_00 / 13))
    expect(p.status).toBe('on-track')
  })

  it('status: concluído, coberto (tudo agendado), sem data, atrasado', () => {
    expect(goalProgress(goal({ paidCents: 80000_00 }), '2026-10-26').status).toBe('done')
    expect(goalProgress(goal({ paidCents: 50000_00, scheduledCents: 30000_00 }), '2026-10-26').status).toBe('covered')
    expect(goalProgress(goal({ targetDate: null }), '2026-10-26').status).toBe('no-date')
    const late = goalProgress(goal({ targetDate: '2026-01-01', paidCents: 100 }), '2026-10-26')
    expect(late.status).toBe('behind')
    expect(late.monthlyNeeded).toBeNull()
  })
})

describe('goalCurve', () => {
  it('acumula o pago até hoje e projeta o agendado (atrasado cai no mês atual)', () => {
    const xs = [
      e({ dueDate: '2026-08-05', paidDate: '2026-08-05', amountCents: 10000_00 }),
      e({ dueDate: '2026-09-20', amountCents: 2000_00 }), // atrasada
      e({ dueDate: '2026-11-10', amountCents: 3000_00 }),
    ]
    const c = goalCurve(xs, goal({ targetDate: '2026-12-31' }), '2026-10-26')
    expect(c.map((p) => p.key)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
    expect(c[1]!.paid).toBe(10000_00)
    expect(c[2]!.projected).toBe(12000_00) // pago + atrasado
    expect(c[3]!.projected).toBe(15000_00)
    expect(c[4]!.paid).toBeNull()
  })
})
