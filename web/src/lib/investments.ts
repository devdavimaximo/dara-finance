/**
 * Carteira: valor, ganho e rentabilidade de cada aplicação a partir do histórico de movimentos.
 *
 * - Valor: a última atualização ("hoje vale X") mais aportes e menos resgates feitos depois dela.
 * - Aportado: dinheiro novo (do caixa ou de fora). Proventos reinvestidos NÃO são dinheiro novo — são ganho.
 * - Ganho: valor + resgatado + proventos recebidos no caixa − aportado.
 * - Rentabilidade a.a.: TIR (XIRR) dos fluxos do investidor, que pondera cada aporte pelo tempo aplicado.
 *   Com menos de 90 dias de histórico, anualizar engana: a tela mostra o ganho "no período".
 *
 * O efeito no caixa é calculado no servidor (Domain/InvestmentMath.cs) e chega como `flows`.
 */
import { addMonthsKey, diffDays, monthEnd, monthKey, monthRange } from './dates'
import type { Investment, InvestmentKind, InvestmentMove } from './types'

export const MIN_DAYS_TO_ANNUALIZE = 90
/** Depois disso a tela pede uma atualização do valor. */
export const STALE_DAYS = 35

export const kindLabel: Record<InvestmentKind, string> = {
  Fii: 'FIIs', Stock: 'Ações', Etf: 'ETFs', Cdb: 'CDB / renda fixa', TesouroSelic: 'Tesouro Selic',
  Treasury: 'Tesouro IPCA+/Prefixado', Fund: 'Fundos', Crypto: 'Cripto', Other: 'Outros',
}

/** Slot fixo da paleta por tipo (a cor segue a entidade). */
export const kindColor: Record<InvestmentKind, number> = {
  // Os tipos mais comuns (CDB, Selic, FII, ações) ficam em slots bem distantes entre si.
  Cdb: 1, TesouroSelic: 7, Fii: 3, Stock: 5, Etf: 4, Treasury: 6, Fund: 2, Crypto: 8, Other: 2,
}

/** No mesmo dia, aportes/resgates vêm antes da atualização ("aportei 1.000 e hoje vale 1.000"). */
export const ordered = (moves: InvestmentMove[]) =>
  [...moves].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'Valuation' ? 1 : 0) - (b.kind === 'Valuation' ? 1 : 0))

const isNewMoney = (m: InvestmentMove) => m.kind === 'Contribution' && m.origin !== 'Reinvest'

export interface Flow { date: string; amount: number }

/**
 * Taxa anual r tal que Σ fluxo / (1+r)^(dias/365) = 0. Aportes negativos, retornos positivos.
 * Bisseção: lenta mas nunca diverge. Sem troca de sinal (só aporte ou só retorno) → null.
 */
export function xirr(flows: Flow[]): number | null {
  const xs = flows.filter((f) => f.amount !== 0)
  if (!xs.some((f) => f.amount < 0) || !xs.some((f) => f.amount > 0)) return null
  const t0 = xs.reduce((a, f) => (f.date < a ? f.date : a), xs[0]!.date)
  const ts = xs.map((f) => ({ t: diffDays(f.date, t0) / 365, v: f.amount }))
  if (Math.max(...ts.map((x) => x.t)) <= 0) return null
  const npv = (r: number) => ts.reduce((a, x) => a + x.v / (1 + r) ** x.t, 0)
  let lo = -0.9999, hi = 100
  let fLo = npv(lo), fHi = npv(hi)
  if (fLo * fHi > 0) return null
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    const f = npv(mid)
    if (Math.abs(f) < 1e-7 || hi - lo < 1e-10) return mid
    if (f * fLo < 0) { hi = mid; fHi = f } else { lo = mid; fLo = f }
  }
  return (lo + hi) / 2
}

export interface Summary {
  value: number
  /** Dinheiro novo aplicado (caixa + de fora). */
  invested: number
  withdrawn: number
  /** Proventos que caíram no caixa. */
  income: number
  /** Proventos reinvestidos (aportes com origem "Reinvest"). */
  reinvested: number
  gain: number
  /** Ganho ÷ aportado — rendimento acumulado, sem anualizar. */
  gainShare: number | null
  /** TIR anual (null quando não dá para calcular). */
  annual: number | null
  /** Histórico curto: `annual` é só uma estimativa. */
  annualReliable: boolean
  firstDate: string | null
  /** Data do último movimento (o "valor" vale para esta data). */
  asOf: string | null
  lastValuation: string | null
  /** Dias desde a última atualização de valor (null se nunca atualizou). */
  staleDays: number | null
  /** Valor zerado depois de ter tido movimento: aplicação encerrada. */
  closed: boolean
}

/** Fluxos do ponto de vista do investidor, com o valor final como "resgate" na data de referência. */
function investorFlows(moves: InvestmentMove[], value: number, asOf: string | null): Flow[] {
  const flows: Flow[] = []
  for (const m of moves) {
    if (isNewMoney(m)) flows.push({ date: m.date, amount: -m.amountCents })
    else if (m.kind === 'Withdrawal' || m.kind === 'Income') flows.push({ date: m.date, amount: m.amountCents })
  }
  if (asOf && value) flows.push({ date: asOf, amount: value })
  return flows
}

function walk(inv: Investment) {
  const moves = ordered(inv.moves)
  let value = 0, invested = 0, withdrawn = 0, income = 0, reinvested = 0
  let lastValuation: string | null = null
  for (const m of moves) {
    if (m.kind === 'Contribution') {
      value += m.amountCents
      if (m.origin === 'Reinvest') reinvested += m.amountCents
      else invested += m.amountCents
    } else if (m.kind === 'Withdrawal') { value -= m.amountCents; withdrawn += m.amountCents }
    else if (m.kind === 'Income') income += m.amountCents
    else { value = m.amountCents; lastValuation = m.date }
  }
  return { moves, value, invested, withdrawn, income, reinvested, lastValuation }
}

function finish(parts: { value: number; invested: number; withdrawn: number; income: number; reinvested: number; lastValuation: string | null; firstDate: string | null; asOf: string | null; flows: Flow[] }, today: string): Summary {
  const gain = parts.value + parts.withdrawn + parts.income - parts.invested
  const span = parts.firstDate && parts.asOf ? diffDays(parts.asOf, parts.firstDate) : 0
  return {
    value: parts.value, invested: parts.invested, withdrawn: parts.withdrawn, income: parts.income, reinvested: parts.reinvested, gain,
    gainShare: parts.invested ? gain / parts.invested : null,
    annual: xirr(parts.flows),
    annualReliable: span >= MIN_DAYS_TO_ANNUALIZE,
    firstDate: parts.firstDate, asOf: parts.asOf, lastValuation: parts.lastValuation,
    staleDays: parts.lastValuation ? diffDays(today, parts.lastValuation) : null,
    closed: parts.value === 0 && parts.firstDate != null,
  }
}

export function summarize(inv: Investment, today: string): Summary {
  const w = walk(inv)
  const firstDate = w.moves[0]?.date ?? null
  const asOf = w.moves.at(-1)?.date ?? null
  return finish({ ...w, firstDate, asOf, flows: investorFlows(w.moves, w.value, asOf) }, today)
}

/** A carteira inteira como se fosse uma aplicação só (cada valor final na sua própria data). */
export function portfolio(invs: Investment[], today: string): Summary {
  const parts = { value: 0, invested: 0, withdrawn: 0, income: 0, reinvested: 0, lastValuation: null as string | null, firstDate: null as string | null, asOf: null as string | null, flows: [] as Flow[] }
  for (const inv of invs) {
    const w = walk(inv)
    if (!w.moves.length) continue
    const asOf = w.moves.at(-1)!.date
    parts.value += w.value; parts.invested += w.invested; parts.withdrawn += w.withdrawn; parts.income += w.income; parts.reinvested += w.reinvested
    if (w.lastValuation && (!parts.lastValuation || w.lastValuation < parts.lastValuation)) parts.lastValuation = w.lastValuation // a mais velha
    if (!parts.firstDate || w.moves[0]!.date < parts.firstDate) parts.firstDate = w.moves[0]!.date
    if (!parts.asOf || asOf > parts.asOf) parts.asOf = asOf
    parts.flows.push(...investorFlows(w.moves, w.value, asOf))
  }
  return finish(parts, today)
}

export interface ValuePoint {
  key: string
  /** Valor no fim do mês. */
  value: number
  /** Aportado − resgatado até o fim do mês (o "dinheiro que é seu" lá dentro). */
  net: number
}

/** Evolução mês a mês: valor × dinheiro líquido aplicado. Um ponto por mês, do primeiro movimento até hoje. */
export function valueSeries(invs: Investment[], today: string): ValuePoint[] {
  const all = invs.flatMap((i) => i.moves.map((m) => ({ ...m, inv: i.id })))
  if (!all.length) return []
  const first = all.reduce((a, m) => (m.date < a ? m.date : a), all[0]!.date)
  const keys = monthRange(monthKey(first), monthKey(today))
  const start = keys.length > 36 ? keys.slice(-36) : keys
  const states = new Map(invs.map((i) => [i.id, { moves: ordered(i.moves), idx: 0, value: 0, net: 0 }]))
  const points: ValuePoint[] = []
  for (const key of keys) {
    const end = key === monthKey(today) ? today : monthEnd(key)
    for (const s of states.values()) {
      while (s.idx < s.moves.length && s.moves[s.idx]!.date <= end) {
        const m = s.moves[s.idx++]!
        if (m.kind === 'Contribution') { s.value += m.amountCents; if (m.origin !== 'Reinvest') s.net += m.amountCents }
        else if (m.kind === 'Withdrawal') { s.value -= m.amountCents; s.net -= m.amountCents }
        else if (m.kind === 'Valuation') s.value = m.amountCents
      }
    }
    if (start.includes(key)) {
      let value = 0, net = 0
      for (const s of states.values()) { value += s.value; net += s.net }
      points.push({ key, value, net })
    }
  }
  // Um mês só vira um ponto solto: começa no mês anterior, zerado, para a linha ter de onde subir.
  return points.length === 1 ? [{ key: addMonthsKey(points[0]!.key, -1), value: 0, net: 0 }, ...points] : points
}

/** Valor por tipo (para a composição da carteira), maior primeiro. */
export function byKind(invs: Investment[], today: string) {
  const g = new Map<InvestmentKind, { value: number; count: number }>()
  for (const i of invs) {
    const s = summarize(i, today)
    if (s.value <= 0) continue
    const row = g.get(i.kind) ?? { value: 0, count: 0 }
    row.value += s.value
    row.count++
    g.set(i.kind, row)
  }
  const total = [...g.values()].reduce((a, r) => a + r.value, 0)
  return [...g.entries()]
    // Formato de Slice (rosca do painel); sem comparação com período anterior nem teto.
    .map(([kind, r]) => ({
      id: kind, kind, name: kindLabel[kind], icon: 'trending-up', color: `var(--cat-${kindColor[kind]})`, value: r.value, count: r.count,
      share: total ? r.value / total : 0, previous: 0, delta: null, budget: null, budgetUse: null,
    }))
    .sort((a, b) => b.value - a.value)
}

/** Quanto do valor de hoje conta no caixa (aplicações marcadas "conta no caixa"). */
export const valueInCash = (invs: Investment[], today: string) =>
  invs.filter((i) => i.countsInCash).reduce((a, i) => a + summarize(i, today).value, 0)
