/**
 * Cartão de crédito. Cada compra é um lançamento normal (pote, objetivo, parcelas) cujo vencimento é o
 * da fatura — então caixa, previsto e projeção já caem no mês em que a fatura é paga.
 * Fatura = compras do mesmo cartão com o mesmo vencimento. Espelho de Domain/CardMath.cs.
 */
import { addMonthsKey, daysInMonth, monthKey } from './dates'
import type { Card, Entry } from './types'

const day = (key: string, d: number) => `${key}-${String(Math.min(d, daysInMonth(key))).padStart(2, '0')}`

/** Fechamento da fatura da compra: antes do dia de fechamento fica neste mês; no dia ou depois, no próximo. */
export function closingFor(card: Pick<Card, 'closingDay'>, purchase: string) {
  const thisMonth = day(monthKey(purchase), card.closingDay)
  return purchase < thisMonth ? thisMonth : day(addMonthsKey(monthKey(purchase), 1), card.closingDay)
}

/** Vencimento da fatura da compra: no mês do fechamento se o vencimento vem depois; senão no seguinte. */
export function invoiceDue(card: Pick<Card, 'closingDay' | 'dueDay'>, purchase: string) {
  const closing = monthKey(closingFor(card, purchase))
  return day(card.dueDay > card.closingDay ? closing : addMonthsKey(closing, 1), card.dueDay)
}

/** Fechamento da fatura que vence em `due` (inverso de invoiceDue). */
export function closingOfDue(card: Pick<Card, 'closingDay' | 'dueDay'>, due: string) {
  const key = card.dueDay > card.closingDay ? monthKey(due) : addMonthsKey(monthKey(due), -1)
  return day(key, card.closingDay)
}

export interface Invoice {
  due: string
  closing: string
  total: number
  /** Ainda a pagar (pelo valor das compras em aberto). */
  open: number
  items: Entry[]
  /** aberta = ainda recebe compras · fechada = esperando pagamento · paga = nada em aberto. */
  status: 'open' | 'closed' | 'paid'
}

/** Faturas do cartão, da mais recente para a mais antiga. */
export function invoices(entries: Entry[], card: Card, today: string): Invoice[] {
  const byDue = new Map<string, Entry[]>()
  for (const e of entries) if (e.cardId === card.id) byDue.set(e.dueDate, [...(byDue.get(e.dueDate) ?? []), e])
  return [...byDue.entries()].map(([due, items]) => {
    const closing = closingOfDue(card, due)
    const open = items.filter((e) => !e.paidDate).reduce((a, e) => a + e.amountCents, 0)
    return {
      due, closing, items: items.sort((a, b) => (b.purchaseDate ?? b.dueDate).localeCompare(a.purchaseDate ?? a.dueDate)),
      total: items.reduce((a, e) => a + (e.paidDate ? (e.paidAmountCents ?? e.amountCents) : e.amountCents), 0),
      open,
      status: open === 0 ? 'paid' as const : today < closing ? 'open' as const : 'closed' as const,
    }
  }).sort((a, b) => b.due.localeCompare(a.due))
}
