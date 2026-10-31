import { describe, expect, it } from 'vitest'
import { closingOfDue, invoiceDue, invoices } from './cards'
import type { Card, Entry } from './types'

const nubank: Card = { id: 'nu', name: 'Nubank', closingDay: 3, dueDay: 10, color: 7, archived: false }
const late: Card = { id: 'late', name: 'X', closingDay: 25, dueDay: 5, color: 1, archived: false }

let n = 0
const e = (p: Partial<Entry>): Entry => ({
  id: String(++n), kind: 'Expense', description: 'x', amountCents: 100_00, dueDate: '2026-11-10', paidDate: null, paidAmountCents: null,
  offCash: false, offCashSource: null, categoryId: null, counterparty: null, method: 'CreditCard', notes: null, recurrenceId: null,
  sequence: null, seriesCount: null, frequency: null, attachmentName: null, goalId: null, cardId: 'nu', ...p,
})

describe('fatura (igual ao CardMath do servidor)', () => {
  it('compra antes do fechamento fica na fatura do mês; no dia ou depois, na próxima', () => {
    expect(invoiceDue(nubank, '2026-10-02')).toBe('2026-10-10')
    expect(invoiceDue(nubank, '2026-10-03')).toBe('2026-11-10')
    expect(invoiceDue(nubank, '2026-12-15')).toBe('2027-01-10')
    expect(invoiceDue(late, '2026-10-24')).toBe('2026-11-05')
    expect(invoiceDue(late, '2026-10-25')).toBe('2026-12-05')
    expect(invoiceDue({ closingDay: 20, dueDay: 31 }, '2027-02-10')).toBe('2027-02-28')
  })

  it('fechamento a partir do vencimento', () => {
    expect(closingOfDue(nubank, '2026-11-10')).toBe('2026-11-03')
    expect(closingOfDue(late, '2026-12-05')).toBe('2026-11-25')
  })

  it('agrupa por vencimento, com total, em aberto e situação', () => {
    const xs = [
      e({ dueDate: '2026-11-10', amountCents: 200_00 }),
      e({ dueDate: '2026-11-10', amountCents: 50_00 }),
      e({ dueDate: '2026-10-10', amountCents: 80_00, paidDate: '2026-10-10', paidAmountCents: 80_00 }),
      e({ dueDate: '2026-12-10', amountCents: 30_00 }),
      e({ dueDate: '2026-11-10', cardId: 'outro' }),
    ]
    const inv = invoices(xs, nubank, '2026-11-05')
    expect(inv.map((i) => [i.due, i.total, i.open, i.status])).toEqual([
      ['2026-12-10', 30_00, 30_00, 'open'],
      ['2026-11-10', 250_00, 250_00, 'closed'], // fechou dia 3, vence dia 10
      ['2026-10-10', 80_00, 0, 'paid'],
    ])
  })
})
