/** Aritmética de datas 'YYYY-MM-DD' em UTC — sem surpresas de fuso. */

const pad = (n: number) => String(n).padStart(2, '0')

export const toISO = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
export const fromISO = (s: string) => new Date(`${s}T00:00:00Z`)

/** Hoje no relógio do aparelho (o usuário está no Brasil; o servidor usa America/Sao_Paulo). */
export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const monthKey = (iso: string) => iso.slice(0, 7)
export const monthStart = (key: string) => `${key}-01`
export const daysInMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}
export const monthEnd = (key: string) => `${key}-${pad(daysInMonth(key))}`

export const addMonthsKey = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export const addDays = (iso: string, n: number) => {
  const d = fromISO(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toISO(d)
}

export const diffDays = (a: string, b: string) => Math.round((fromISO(a).getTime() - fromISO(b).getTime()) / 86_400_000)

export const monthRange = (from: string, to: string) => {
  const keys: string[] = []
  for (let k = from; k <= to; k = addMonthsKey(k, 1)) keys.push(k)
  return keys
}

const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthNamesLong = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export const monthLabel = (key: string, long = false) => {
  const [y, m] = key.split('-').map(Number)
  return long ? `${monthNamesLong[m! - 1]} ${y}` : `${monthNames[m! - 1]}/${String(y).slice(2)}`
}
export const shortMonth = (key: string) => monthNames[Number(key.slice(5, 7)) - 1]!

export const dayLabel = (iso: string) => {
  const d = fromISO(iso)
  return `${weekdays[d.getUTCDay()]}, ${d.getUTCDate()} ${monthNames[d.getUTCMonth()]}`
}
export const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
export const fullDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export const weekday = (iso: string) => fromISO(iso).getUTCDay()

/** "hoje", "amanhã", "em 4 dias", "há 2 dias". */
export const relativeDay = (iso: string, today: string) => {
  const d = diffDays(iso, today)
  if (d === 0) return 'hoje'
  if (d === 1) return 'amanhã'
  if (d === -1) return 'ontem'
  return d > 0 ? `em ${d} dias` : `há ${-d} dias`
}
