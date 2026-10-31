import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import {
  byKind, cdiIndex, nextPlan, outsideCashValueAt, pendingPlan, plannedFlows, planOccurrences, portfolio, summarize, valueAt, valueSeries, xirr,
} from './investments'
import type { CdiRate, Investment, InvestmentMove } from './types'

let n = 0
const mv = (kind: InvestmentMove['kind'], date: string, amountCents: number, extra: Partial<InvestmentMove> = {}): InvestmentMove => ({
  id: `m${n++}`, kind, date, amountCents, origin: kind === 'Contribution' ? 'Cash' : null, toCash: kind === 'Withdrawal', notes: null, planDate: null, ...extra,
})
const inv = (moves: InvestmentMove[], extra: Partial<Investment> = {}): Investment => ({
  id: `i${n++}`, name: 'CDB', kind: 'Cdb', institution: null, color: 2, countsInCash: false, notes: null, archived: false,
  goalId: null, plan: null, moves, ...extra,
})

/** Uma taxa por dia (todo dia, para a conta ficar redonda). */
function rates(from: string, to: string, rate: number): CdiRate[] {
  const out: CdiRate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, rate })
  return out
}

describe('xirr', () => {
  it('pondera cada aporte pelo tempo aplicado', () => {
    // 10 mil em jan, 5 mil em jul, vale 16 mil em dez: simples daria 6,7%; de verdade ~8% a.a.
    const r = xirr([{ date: '2026-01-01', amount: -10000_00 }, { date: '2026-07-01', amount: -5000_00 }, { date: '2026-12-31', amount: 16000_00 }])
    expect(r).toBeCloseTo(0.08, 2)
  })
  it('um ano exato devolve o próprio rendimento', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000_00 }, { date: '2026-01-01', amount: 1120_00 }])).toBeCloseTo(0.12, 4)
  })
  it('perda dá taxa negativa; sem retorno não há taxa', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000_00 }, { date: '2026-01-01', amount: 900_00 }])).toBeCloseTo(-0.1, 4)
    expect(xirr([{ date: '2025-01-01', amount: -1000_00 }])).toBeNull()
  })
})

describe('summarize', () => {
  it('valor = última atualização + aportes depois dela; ganho exclui o dinheiro novo', () => {
    const s = summarize(inv([
      mv('Contribution', '2025-01-01', 1000_00),
      mv('Valuation', '2025-12-31', 1100_00),
      mv('Contribution', '2026-01-10', 500_00, { origin: 'External' }),
    ]), '2026-01-20')
    expect(s.value).toBe(1600_00)
    expect(s.invested).toBe(1500_00)
    expect(s.gain).toBe(100_00)
    expect(s.lastValuation).toBe('2025-12-31')
    expect(s.staleDays).toBe(20)
    expect(s.annualReliable).toBe(true)
  })

  it('provento reinvestido é ganho, não aporte, e não muda a TIR', () => {
    const base = [mv('Contribution', '2025-01-01', 1000_00), mv('Valuation', '2026-01-01', 1100_00)]
    const plain = summarize(inv(base), '2026-01-01')
    const withReinvest = summarize(inv([...base.slice(0, 1), mv('Contribution', '2025-06-01', 40_00, { origin: 'Reinvest' }), base[1]!]), '2026-01-01')
    expect(withReinvest.invested).toBe(1000_00)
    expect(withReinvest.reinvested).toBe(40_00)
    expect(withReinvest.gain).toBe(100_00)
    expect(withReinvest.annual).toBeCloseTo(plain.annual!, 6)
    expect(plain.annual).toBeCloseTo(0.1, 4)
  })

  it('provento no caixa e resgate contam como retorno', () => {
    const s = summarize(inv([
      mv('Contribution', '2025-01-01', 1000_00),
      mv('Income', '2025-07-01', 50_00),
      mv('Withdrawal', '2026-01-01', 1030_00),
      mv('Valuation', '2026-01-01', 0),
    ]), '2026-01-05')
    expect(s.gain).toBe(80_00)
    expect(s.closed).toBe(true)
    expect(s.annual).toBeGreaterThan(0.07)
  })

  it('histórico curto não é anualizado com confiança', () => {
    const s = summarize(inv([mv('Contribution', '2026-10-01', 1000_00), mv('Valuation', '2026-10-31', 1010_00)]), '2026-10-31')
    expect(s.gainShare).toBeCloseTo(0.01, 6)
    expect(s.annualReliable).toBe(false)
  })
})

describe('carteira', () => {
  const a = inv([mv('Contribution', '2025-01-01', 1000_00), mv('Valuation', '2026-01-01', 1100_00)], { kind: 'Cdb' })
  const b = inv([mv('Contribution', '2025-01-01', 3000_00), mv('Valuation', '2026-01-01', 3300_00)], { kind: 'Fii' })

  it('soma tudo e a TIR combinada fica entre as individuais', () => {
    const p = portfolio([a, b], '2026-01-01')
    expect(p.value).toBe(4400_00)
    expect(p.gain).toBe(400_00)
    expect(p.annual).toBeCloseTo(0.1, 4)
  })

  it('composição por tipo, maior primeiro', () => {
    const rows = byKind([a, b], '2026-01-01')
    expect(rows.map((r) => r.kind)).toEqual(['Fii', 'Cdb'])
    expect(rows[0]!.share).toBeCloseTo(0.75)
  })

  it('série mensal: valor e líquido aplicado no fim de cada mês', () => {
    const s = valueSeries([inv([mv('Contribution', '2026-08-05', 1000_00), mv('Valuation', '2026-09-30', 1020_00), mv('Withdrawal', '2026-10-10', 200_00)])], '2026-10-31')
    expect(s).toEqual([
      { key: '2026-08', value: 1000_00, net: 1000_00, cdi: null },
      { key: '2026-09', value: 1020_00, net: 1000_00, cdi: null },
      { key: '2026-10', value: 820_00, net: 800_00, cdi: null },
    ])
  })
})

describe('CDI', () => {
  const cdi = cdiIndex(rates('2026-01-01', '2026-12-31', 0.05))!

  it('fator acumulado do período (taxas em [de, até))', () => {
    expect(cdi.factor('2026-03-01', '2026-03-03')).toBeCloseTo(1.0005 ** 2, 12)
    expect(cdi.factor('2026-03-01', '2026-03-01')).toBe(1)
    expect(cdi.factor('2025-12-01', '2026-03-01')).toBeNull() // antes das taxas
  })

  it('aplicação que rendeu igual ao CDI dá 100% do CDI', () => {
    const f = cdi.factor('2026-02-01', '2026-08-01')!
    const s = summarize(inv([mv('Contribution', '2026-02-01', 1000_00), mv('Valuation', '2026-08-01', Math.round(1000_00 * f))]), '2026-08-01', cdi)
    expect(s.cdi!.pct).toBeCloseTo(1, 2)
    expect(s.cdi!.annual).toBeCloseTo(s.annual!, 3)
  })

  it('rendeu o dobro do ganho do CDI → 200%; resgate para de render no CDI', () => {
    const f = cdi.factor('2026-02-01', '2026-08-01')!
    const cdiGain = 1000_00 * (f - 1)
    const s = summarize(inv([mv('Contribution', '2026-02-01', 1000_00), mv('Valuation', '2026-08-01', Math.round(1000_00 + 2 * cdiGain))]), '2026-08-01', cdi)
    expect(s.cdi!.pct).toBeCloseTo(2, 2)

    // Resgatou tudo em maio: depois disso o "no CDI" fica parado (só o que sobrou continuaria rendendo).
    const w = summarize(inv([mv('Contribution', '2026-02-01', 1000_00), mv('Withdrawal', '2026-05-01', 1030_00), mv('Valuation', '2026-05-01', 0)]), '2026-08-01', cdi)
    const atMay = 1000_00 * cdi.factor('2026-02-01', '2026-05-01')!
    expect(w.cdi!.value).toBe(Math.round((atMay - 1030_00) * cdi.factor('2026-05-01', '2026-05-01')!))
  })

  it('sem taxas para o período, sem comparação; histórico curto, sem %', () => {
    expect(summarize(inv([mv('Contribution', '2025-06-01', 1000_00)]), '2026-08-01', cdi).cdi).toBeNull()
    const short = summarize(inv([mv('Contribution', '2026-07-20', 1000_00), mv('Valuation', '2026-08-01', 1005_00)]), '2026-08-01', cdi)
    expect(short.cdi).not.toBeNull()
    expect(short.cdi!.pct).toBeNull()
  })

  it('série mensal ganha a linha "se estivesse no CDI"', () => {
    const s = valueSeries([inv([mv('Contribution', '2026-08-01', 1000_00), mv('Valuation', '2026-09-30', 1010_00)])], '2026-10-15', cdi)
    expect(s[0]!.cdi).toBe(Math.round(1000_00 * cdi.factor('2026-08-01', '2026-08-31')!))
    expect(s.at(-1)!.cdi).toBe(Math.round(1000_00 * cdi.factor('2026-08-01', '2026-10-15')!))
  })
})

describe('valor numa data', () => {
  it('carteira fora do caixa: só o que aconteceu até a data; quem conta no caixa fica de fora', () => {
    const a = inv([mv('Contribution', '2026-01-10', 1000_00), mv('Valuation', '2026-03-31', 1030_00), mv('Withdrawal', '2026-05-02', 200_00)])
    const b = inv([mv('Contribution', '2026-01-10', 5000_00)], { countsInCash: true })
    expect(valueAt(a, '2026-01-09')).toBe(0)
    expect(valueAt(a, '2026-02-28')).toBe(1000_00)
    expect(valueAt(a, '2026-04-30')).toBe(1030_00)
    expect(outsideCashValueAt([a, b], '2026-05-31')).toBe(830_00)
  })
})

describe('aporte programado', () => {
  const plan = { amountCents: 500_00, day: 31, start: '2026-01-15' }

  it('dia 31 vira o último dia de cada mês, sem passar do início', () => {
    expect(planOccurrences(plan, '2026-01-01', '2026-03-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(planOccurrences({ ...plan, day: 10 }, '2026-01-01', '2026-02-28')).toEqual(['2026-02-10'])
  })

  it('pendente só no mês corrente; confirmar tira da lista', () => {
    const p = { amountCents: 500_00, day: 5, start: '2026-01-01' }
    expect(pendingPlan(inv([], { plan: p }), '2026-10-04')).toBeNull()
    expect(pendingPlan(inv([], { plan: p }), '2026-10-05')).toBe('2026-10-05')
    expect(pendingPlan(inv([mv('Contribution', '2026-10-06', 500_00, { planDate: '2026-10-05' })], { plan: p }), '2026-10-20')).toBeNull()
    expect(nextPlan(inv([mv('Contribution', '2026-10-06', 500_00, { planDate: '2026-10-05' })], { plan: p }), '2026-10-20')).toBe('2026-11-05')
  })

  it('projeção: pendente conta hoje; quem conta no caixa fica de fora', () => {
    const p = { amountCents: 500_00, day: 5, start: '2026-01-01' }
    const flows = plannedFlows([inv([], { plan: p }), inv([], { plan: p, countsInCash: true })], '2026-10-20', '2026-12-31')
    expect(flows.map((f) => [f.date, f.amountCents])).toEqual([['2026-10-20', -500_00], ['2026-11-05', -500_00], ['2026-12-05', -500_00]])
  })
})
