import { describe, expect, it } from 'vitest'
import { byCategory, cashAt, cashCurve, fixedVsVariable, indicators, projectedAt, status, totals } from './analytics'
import { parseMoney } from './format'
import type { Category, Entry } from './types'

let seq = 0
const e = (p: Partial<Entry>): Entry => ({
  id: String(++seq), kind: 'Expense', description: 'x', amountCents: 100_00, dueDate: '2026-10-10',
  paidDate: null, paidAmountCents: null, categoryId: null, counterparty: null, method: null, notes: null,
  recurrenceId: null, sequence: null, seriesCount: null, frequency: null, attachmentName: null, goalId: null, ...p,
})

const today = '2026-10-15'

describe('status', () => {
  it('distingue pago, atrasado e pendente', () => {
    expect(status(e({ paidDate: '2026-10-01' }), today)).toBe('paid')
    expect(status(e({ dueDate: '2026-10-14' }), today)).toBe('overdue')
    expect(status(e({ dueDate: '2026-10-15' }), today)).toBe('pending')
  })
})

describe('totals', () => {
  it('separa previsto, realizado, aberto e atrasado; margem sobre a receita', () => {
    const xs = [
      e({ kind: 'Income', amountCents: 1000_00, paidDate: '2026-10-05', paidAmountCents: 1000_00 }),
      e({ kind: 'Income', amountCents: 500_00, dueDate: '2026-10-20' }),
      e({ amountCents: 300_00, paidDate: '2026-10-02', paidAmountCents: 310_00 }),
      e({ amountCents: 200_00, dueDate: '2026-10-01' }),
    ]
    const t = totals(xs, today)
    expect(t.income.planned).toBe(1500_00)
    expect(t.income.settled).toBe(1000_00)
    expect(t.expense.settled).toBe(310_00) // valor efetivamente pago, com juros
    expect(t.expense.overdue).toBe(200_00)
    expect(t.expense.overdueCount).toBe(1)
    expect(t.netPlanned).toBe(1000_00)
    expect(t.margin).toBeCloseTo(1000 / 1500)
    expect(t.commitment).toBeCloseTo(500 / 1500)
  })
})

describe('caixa', () => {
  const xs = [
    e({ kind: 'Income', amountCents: 1000_00, dueDate: '2026-10-05', paidDate: '2026-10-05', paidAmountCents: 1000_00 }),
    e({ amountCents: 400_00, dueDate: '2026-10-08', paidDate: '2026-10-09', paidAmountCents: 400_00 }),
    e({ amountCents: 100_00, dueDate: '2026-10-12' }), // atrasada
    e({ amountCents: 250_00, dueDate: '2026-10-25' }),
    e({ kind: 'Income', amountCents: 50_00, dueDate: '2026-10-30' }),
  ]
  it('acumula pelo pagamento a partir do saldo anterior', () => {
    expect(cashAt(xs, 200_00, '2026-10-01', today)).toBe(800_00)
  })
  it('projeta com atrasados e futuros até a data', () => {
    expect(projectedAt(xs, 800_00, '2026-10-31')).toBe(800_00 - 100_00 - 250_00 + 50_00)
  })
  it('curva: realizado até hoje, projetado a partir de hoje', () => {
    const c = cashCurve(xs, 200_00, '2026-10-01', '2026-10', today)
    expect(c).toHaveLength(31)
    expect(c[13]!.projected).toBeNull()
    expect(c[14]!.realized).toBe(800_00)
    expect(c[14]!.projected).toBe(700_00) // hoje já desconta o atrasado
    expect(c[30]!.realized).toBeNull()
    expect(c[30]!.projected).toBe(500_00)
  })
})

describe('byCategory', () => {
  const cats: Category[] = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`, name: `Cat ${i}`, kind: 'Expense', color: i + 1, icon: 'tag', budgetCents: i === 0 ? 200_00 : null, archived: false,
  }))
  it('dobra a cauda em "Outras" e mede orçamento e variação', () => {
    const xs = cats.map((c, i) => e({ categoryId: c.id, amountCents: (8 - i) * 100_00 }))
    const prev = [e({ categoryId: 'c0', amountCents: 400_00 })]
    const rows = byCategory(xs, prev, 'Expense', cats, 6)
    expect(rows).toHaveLength(6)
    expect(rows[5]!.id).toBe('_other')
    expect(rows[0]!.color).toBe('var(--cat-1)')
    expect(rows[0]!.budgetUse).toBe(4)
    expect(rows[0]!.delta).toBe(1)
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1)
  })
})

describe('indicadores', () => {
  it('runway = caixa ÷ despesa média de 3 meses', () => {
    const xs = [
      e({ dueDate: '2026-08-10', amountCents: 300_00, paidDate: '2026-08-10' }),
      e({ dueDate: '2026-09-10', amountCents: 300_00, paidDate: '2026-09-12' }),
      e({ dueDate: '2026-10-10', amountCents: 300_00, paidDate: '2026-10-10' }),
    ]
    const ind = indicators(xs, 1800_00, '2026-08-01', '2026-10', today)
    expect(ind.cashToday).toBe(900_00)
    expect(ind.runwayMonths).toBeCloseTo(3)
    expect(ind.onTimeExpense).toBeCloseTo(2 / 3)
  })
})

describe('fixedVsVariable', () => {
  it('fixo = vem de série recorrente', () => {
    const r = fixedVsVariable([e({ recurrenceId: 'r', amountCents: 300_00 }), e({ amountCents: 100_00 })])
    expect(r.fixedShare).toBe(0.75)
  })
})

describe('parseMoney', () => {
  it('aceita formatos brasileiros e internacionais', () => {
    expect(parseMoney('1.234,56')).toBe(123456)
    expect(parseMoney('1234.5')).toBe(123450)
    expect(parseMoney('R$ 89')).toBe(8900)
    expect(parseMoney('1.234')).toBe(123400)
  })
})
