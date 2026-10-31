import { describe, expect, it } from 'vitest'
import { byCategory, cashAt, cashCurve, fixedVsVariable, indicators, netWorth, projectedAt, reserveStatus, status, totals } from './analytics'
import { parseMoney } from './format'
import type { Category, Entry } from './types'

let seq = 0
const e = (p: Partial<Entry>): Entry => ({
  id: String(++seq), kind: 'Expense', description: 'x', amountCents: 100_00, dueDate: '2026-10-10',
  paidDate: null, paidAmountCents: null, offCash: false, offCashSource: null, categoryId: null, counterparty: null, method: null, notes: null,
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
  it('pago por fora do caixa conta como realizado, mas não mexe no saldo', () => {
    const designer = e({ amountCents: 300_00, dueDate: '2026-10-09', paidDate: '2026-10-09', paidAmountCents: 300_00, offCash: true })
    const ys = [...xs, designer]
    expect(cashAt(ys, 200_00, '2026-10-01', today)).toBe(800_00)
    expect(cashCurve(ys, 200_00, '2026-10-01', '2026-10', today)[8]!.outflow).toBe(400_00) // dia 9: só a despesa do caixa
    expect(totals(ys, today).expense.settled).toBe(700_00)
  })
  it('aplicações mexem no saldo (até a data), nunca no realizado', () => {
    const flows = [
      { investmentId: 'cdb', date: '2026-10-06', amountCents: -500_00 }, // aporte do caixa
      { investmentId: 'cdb', date: '2026-10-20', amountCents: 30_00 }, // depois de hoje: fora do realizado
    ]
    expect(cashAt(xs, 200_00, '2026-10-01', today, flows)).toBe(300_00)
    const c = cashCurve(xs, 200_00, '2026-10-01', '2026-10', today, flows)
    expect(c[5]!.realized).toBe(700_00)
    expect(c[5]!.outflow).toBe(0) // transferência não é despesa
    expect(totals(xs, today).expense.settled).toBe(400_00)
  })
  it('aporte programado só entra na projeção, a partir da data dele', () => {
    const planned = [{ investmentId: 'tesouro', date: '2026-10-20', amountCents: -100_00 }]
    expect(projectedAt(xs, 800_00, '2026-10-19', planned)).toBe(800_00 - 100_00)
    expect(projectedAt(xs, 800_00, '2026-10-20', planned)).toBe(800_00 - 100_00 - 100_00)
    const c = cashCurve(xs, 200_00, '2026-10-01', '2026-10', today, [], planned)
    expect(c[14]!.realized).toBe(800_00)
    expect(c[30]!.projected).toBe(500_00 - 100_00)
  })
})

describe('reserva e patrimônio', () => {
  it('reserva: fôlego contra a meta, com tom e quanto falta', () => {
    const r = reserveStatus({ runwayMonths: 2, avgExpense3: 1000_00, cashToday: 2000_00 }, 6)!
    expect(r.share).toBeCloseTo(1 / 3)
    expect(r.tone).toBe('bad')
    expect(r.missing).toBe(4000_00)
    expect(reserveStatus({ runwayMonths: 4, avgExpense3: 1000_00, cashToday: 4000_00 }, 6)!.tone).toBe('warn')
    expect(reserveStatus({ runwayMonths: 7, avgExpense3: 1000_00, cashToday: 7000_00 }, 6)).toMatchObject({ tone: 'good', missing: 0 })
    expect(reserveStatus({ runwayMonths: 2, avgExpense3: 1000_00, cashToday: 2000_00 }, 0)).toBeNull()
    expect(reserveStatus({ runwayMonths: null, avgExpense3: 0, cashToday: 0 }, 6)).toBeNull()
  })

  it('patrimônio: caixa no fim do mês + carteira fora do caixa, com variação', () => {
    const xs = [
      e({ kind: 'Income', amountCents: 1000_00, dueDate: '2026-09-05', paidDate: '2026-09-05' }),
      e({ amountCents: 300_00, dueDate: '2026-10-08', paidDate: '2026-10-08' }),
      e({ amountCents: 999_00, dueDate: '2026-10-30' }), // em aberto: não é patrimônio ainda
    ]
    const flows = [{ investmentId: 'fii', date: '2026-09-20', amountCents: -500_00 }] // aporte saiu do caixa
    const investedAt = (d: string) => (d >= '2026-09-20' ? (d >= '2026-10-01' ? 520_00 : 500_00) : 0)
    const w = netWorth(xs, 0, '2026-08-01', ['2026-08', '2026-09', '2026-10', '2026-11'], today, flows, investedAt)
    expect(w.map((p) => [p.key, p.cash, p.invested, p.total, p.change])).toEqual([
      ['2026-08', 0, 0, 0, null],
      ['2026-09', 500_00, 500_00, 1000_00, 1000_00], // aportar não muda o patrimônio
      ['2026-10', 200_00, 520_00, 720_00, -280_00], // −300 de despesa +20 de rendimento
    ])
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
