import type { CashPoint, Indicators, Slice, Totals } from './analytics'
import { change } from './analytics'
import { shortDate } from './dates'
import { money, pct } from './format'
import type { Entry } from './types'

export type Tone = 'good' | 'warn' | 'bad' | 'info'
export interface Insight { tone: Tone; title: string; text: string }

/**
 * Frases curtas que leem os números pelo usuário. Ordenadas por gravidade;
 * o painel mostra as primeiras. Cada regra só dispara quando há base para comparar.
 */
export function buildInsights(args: {
  now: Totals
  prev: Totals
  curve: CashPoint[]
  ind: Indicators
  expenseCats: Slice[]
  upcoming: Entry[]
  overdue: Entry[]
  isCurrent: boolean
  isBusiness: boolean
}): Insight[] {
  const { now, prev, curve, ind, expenseCats, upcoming, overdue, isCurrent, isBusiness } = args
  const out: (Insight & { w: number })[] = []

  const negative = curve.find((p) => p.projected != null && p.realized == null && p.projected < 0)
  if (negative)
    out.push({ w: 100, tone: 'bad', title: 'Caixa no vermelho', text: `No ritmo previsto, o saldo fica negativo em ${shortDate(negative.date)} (${money(negative.projected!)}).` })

  const overdueExp = overdue.filter((e) => e.kind === 'Expense')
  const overdueInc = overdue.filter((e) => e.kind === 'Income')
  if (overdueExp.length)
    out.push({ w: 90, tone: 'bad', title: 'Contas atrasadas', text: `${overdueExp.length} conta(s) a pagar vencida(s), somando ${money(overdueExp.reduce((a, e) => a + e.amountCents, 0))}.` })
  if (overdueInc.length)
    out.push({ w: 85, tone: 'warn', title: 'Recebimentos atrasados', text: `${overdueInc.length} recebimento(s) em atraso: ${money(overdueInc.reduce((a, e) => a + e.amountCents, 0))} para cobrar.` })

  for (const c of expenseCats.filter((c) => c.budgetUse != null && c.budgetUse > 1).slice(0, 2))
    out.push({ w: 80, tone: 'bad', title: 'Pote estourado', text: `O pote ${c.name} está em ${pct(c.budgetUse)} do teto mensal (${money(c.value)} de ${money(c.budget!)}).` })

  const expChange = change(now.expense.planned, prev.expense.planned)
  if (expChange != null && Math.abs(expChange) >= 0.1) {
    const driver = [...expenseCats].filter((c) => c.id !== '_other').sort((a, b) => (b.value - b.previous) * Math.sign(expChange) - (a.value - a.previous) * Math.sign(expChange))[0]
    const diff = driver ? driver.value - driver.previous : 0
    const why = driver && Math.sign(diff) === Math.sign(expChange) && diff !== 0 ? `, puxadas por ${driver.name} (${diff > 0 ? '+' : '−'}${money(Math.abs(diff))})` : ''
    out.push({
      w: expChange > 0 ? 70 : 40, tone: expChange > 0 ? 'warn' : 'good', title: expChange > 0 ? 'Despesas subiram' : 'Despesas caíram',
      text: `Despesas ${pct(Math.abs(expChange))} ${expChange > 0 ? 'acima' : 'abaixo'} do mês anterior${why}.`,
    })
  }

  if (now.commitment != null && now.commitment > 0.9)
    out.push({ w: 65, tone: now.commitment > 1 ? 'bad' : 'warn', title: 'Receita comprometida', text: `As despesas previstas consomem ${pct(now.commitment)} da receita do mês.` })

  if (isCurrent && upcoming.length) {
    const pay = upcoming.filter((e) => e.kind === 'Expense')
    if (pay.length)
      out.push({ w: 60, tone: 'info', title: 'Próximos 7 dias', text: `${pay.length} conta(s) para pagar, total de ${money(pay.reduce((a, e) => a + e.amountCents, 0))}.` })
  }

  if (ind.runwayMonths != null && isCurrent) {
    const r = ind.runwayMonths
    const who = isBusiness ? 'a empresa se sustenta' : 'você se sustenta'
    out.push({
      w: r < 2 ? 75 : 30, tone: r < 2 ? 'warn' : r >= 6 ? 'good' : 'info', title: 'Fôlego de caixa',
      text: `Com o caixa de hoje, ${who} por ${r.toFixed(1).replace('.', ',')} ${r >= 1 && r < 2 ? 'mês' : 'meses'} sem nenhuma receita.`,
    })
  }

  if (now.margin != null && now.income.planned > 0 && now.margin >= 0.2)
    out.push({ w: 35, tone: 'good', title: isBusiness ? 'Margem saudável' : 'Sobrando dinheiro', text: `${pct(now.margin)} da receita prevista vira resultado este mês (${money(now.netPlanned)}).` })

  if (now.income.progress != null && now.income.progress >= 1 && now.income.planned > 0)
    out.push({ w: 25, tone: 'good', title: 'Tudo recebido', text: 'Todas as receitas previstas do mês já entraram.' })

  if (!out.length)
    out.push({ w: 0, tone: 'info', title: 'Tudo calmo', text: 'Sem alertas para este mês. Lance contas a pagar e a receber para ver projeções.' })

  return out.sort((a, b) => b.w - a.w).map(({ w: _w, ...i }) => i)
}
