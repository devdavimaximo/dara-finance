import type { Frequency, Method } from './types'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

export const money = (cents: number) => brl.format(cents / 100)

/** "R$ 12,4 mil" — para eixos e rótulos apertados. */
export const moneyShort = (cents: number) => {
  const v = cents / 100
  if (Math.abs(v) < 1000) return `R$ ${Math.round(v)}`
  return `R$ ${brlCompact.format(v)}`
}

/** Eixos de gráfico: "33 mil", "1,2 mi", "-800" — sem "R$" para caber numa linha. */
export const axisMoney = (cents: number) => {
  const v = cents / 100
  return Math.abs(v) < 1000 ? String(Math.round(v)) : brlCompact.format(v)
}

export const signedMoney = (cents: number) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + money(Math.abs(cents))

export const pct = (ratio: number | null | undefined, digits = 0) =>
  ratio == null || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(digits).replace('.', ',')}%`

export const signedPct = (ratio: number | null | undefined, digits = 0) =>
  ratio == null || !Number.isFinite(ratio) ? '—' : `${ratio > 0 ? '+' : ratio < 0 ? '−' : ''}${pct(Math.abs(ratio), digits)}`

/** Converte "1.234,56" / "1234.56" / "1234" em centavos. */
export function parseMoney(input: string): number {
  const clean = input.replace(/[^\d,.-]/g, '')
  if (!clean) return 0
  const lastSep = Math.max(clean.lastIndexOf(','), clean.lastIndexOf('.'))
  if (lastSep === -1 || clean.length - lastSep - 1 > 2) return Math.round(Number(clean.replace(/[.,]/g, '')) * 100)
  const int = clean.slice(0, lastSep).replace(/[.,]/g, '')
  const dec = clean.slice(lastSep + 1).padEnd(2, '0')
  return Number(int || '0') * 100 + Number(dec)
}

export const methodLabel: Record<Method, string> = {
  Pix: 'Pix', Boleto: 'Boleto', CreditCard: 'Cartão de crédito', DebitCard: 'Cartão de débito',
  Transfer: 'Transferência', Cash: 'Dinheiro', Other: 'Outro',
}

export const frequencyLabel = (f: Frequency, interval = 1) => {
  if (interval <= 1) return { Weekly: 'Semanal', Monthly: 'Mensal', Yearly: 'Anual' }[f]
  return { Weekly: `A cada ${interval} semanas`, Monthly: `A cada ${interval} meses`, Yearly: `A cada ${interval} anos` }[f]
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
