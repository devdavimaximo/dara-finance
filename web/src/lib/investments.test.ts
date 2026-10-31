import { describe, expect, it } from 'vitest'
import { byKind, portfolio, summarize, valueSeries, xirr } from './investments'
import type { Investment, InvestmentMove } from './types'

let n = 0
const mv = (kind: InvestmentMove['kind'], date: string, amountCents: number, extra: Partial<InvestmentMove> = {}): InvestmentMove => ({
  id: `m${n++}`, kind, date, amountCents, origin: kind === 'Contribution' ? 'Cash' : null, toCash: kind === 'Withdrawal', notes: null, ...extra,
})
const inv = (moves: InvestmentMove[], extra: Partial<Investment> = {}): Investment => ({
  id: `i${n++}`, name: 'CDB', kind: 'Cdb', institution: null, color: 2, countsInCash: false, notes: null, archived: false, moves, ...extra,
})

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
      { key: '2026-08', value: 1000_00, net: 1000_00 },
      { key: '2026-09', value: 1020_00, net: 1000_00 },
      { key: '2026-10', value: 820_00, net: 800_00 },
    ])
  })
})
