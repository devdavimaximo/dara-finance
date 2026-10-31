export type Kind = 'Expense' | 'Income'
export type Frequency = 'Weekly' | 'Monthly' | 'Yearly'
export type Method = 'Pix' | 'Boleto' | 'CreditCard' | 'DebitCard' | 'Transfer' | 'Cash' | 'Other'
export type WorkspaceKind = 'Business' | 'Personal'
export type Role = 'Owner' | 'Member'

/** Datas sempre como 'YYYY-MM-DD' (DateOnly no servidor). Valores sempre em centavos. */
export interface Entry {
  id: string
  kind: Kind
  description: string
  amountCents: number
  dueDate: string
  paidDate: string | null
  paidAmountCents: number | null
  /** Pago/recebido por fora deste caixa (ex.: aporte do sócio): realizado, mas não mexe no saldo. */
  offCash: boolean
  /** De onde saiu o dinheiro quando `offCash` (ex.: "Conta pessoal Nubank"). */
  offCashSource: string | null
  categoryId: string | null
  counterparty: string | null
  method: Method | null
  notes: string | null
  recurrenceId: string | null
  sequence: number | null
  seriesCount: number | null
  frequency: Frequency | null
  attachmentName: string | null
  /** Objetivo ao qual esta despesa contribui. */
  goalId: string | null
}

export interface Category {
  id: string
  name: string
  kind: Kind
  color: number
  icon: string
  budgetCents: number | null
  archived: boolean
}

export interface Workspace {
  id: string
  name: string
  kind: WorkspaceKind
  role: Role
  openingBalanceCents: number
  openingBalanceDate: string
}

export interface Me {
  id: string
  name: string
  email: string
  isAdmin: boolean
  /** Admin ou usuário autorizado a criar espaços próprios. */
  canCreateWorkspaces: boolean
  /** Senha provisória: precisa criar a própria antes de usar o app. */
  mustChangePassword: boolean
  workspaces: Workspace[]
}

/** Visão do admin sobre uma conta (sem nada do conteúdo dos espaços). */
export interface UserAccount {
  id: string
  name: string
  email: string
  isAdmin: boolean
  active: boolean
  canCreateWorkspaces: boolean
  mustChangePassword: boolean
  workspaces: number
  createdAt: string
}

export interface Member {
  userId: string
  name: string
  email: string
  role: Role
}

export interface Recurrence {
  id: string
  kind: Kind
  description: string
  amountCents: number
  categoryId: string | null
  counterparty: string | null
  frequency: Frequency
  interval: number
  startDate: string
  endDate: string | null
  count: number | null
  finished: boolean
  paidCount: number
  openCount: number
  nextDue: string | null
}

export interface EntryInput {
  kind: Kind
  description: string
  amountCents: number
  dueDate: string
  categoryId: string | null
  counterparty: string | null
  method: Method | null
  notes: string | null
  paid: boolean
  paidDate: string | null
  paidAmountCents: number | null
  offCash: boolean
  offCashSource: string | null
  repeat: { frequency: Frequency; interval: number; count: number | null; endDate: string | null } | null
  goalId: string | null
}

export interface EntriesResponse {
  balanceBefore: number
  items: Entry[]
  /** Efeito das aplicações no caixa dentro do período (calculado no servidor). Caches antigos não têm. */
  flows?: CashFlow[]
}

/** Quanto o caixa mudou num dia por causa de uma aplicação (aporte, resgate, provento, rendimento). */
export interface CashFlow {
  investmentId: string
  date: string
  amountCents: number
}

export type InvestmentKind = 'Fii' | 'Stock' | 'Etf' | 'Cdb' | 'TesouroSelic' | 'Treasury' | 'Fund' | 'Crypto' | 'Other'
/** Contribution = aporte · Withdrawal = resgate · Income = provento no caixa · Valuation = "hoje vale X". */
export type MoveKind = 'Contribution' | 'Withdrawal' | 'Income' | 'Valuation'
/** De onde veio o aporte: caixa deste espaço, dinheiro de fora, ou proventos reinvestidos. */
export type Origin = 'Cash' | 'External' | 'Reinvest'

export interface InvestmentMove {
  id: string
  kind: MoveKind
  date: string
  amountCents: number
  origin: Origin | null
  /** Resgate que voltou para o caixa deste espaço. */
  toCash: boolean
  notes: string | null
  /** Aporte que confirmou a ocorrência do aporte programado desta data. */
  planDate: string | null
}

/** Aporte programado: todo mês no dia `day` (ajustado ao fim do mês), a partir de `start`. */
export interface InvestmentPlan {
  amountCents: number
  day: number
  start: string
}

/** CDI de um dia útil, em % ao dia (como o Banco Central publica). */
export interface CdiRate {
  date: string
  rate: number
}

export interface Investment {
  id: string
  name: string
  kind: InvestmentKind
  institution: string | null
  color: number
  /** O valor conta como caixa: aporte/resgate só trocam de lugar e o rendimento aparece no saldo. */
  countsInCash: boolean
  notes: string | null
  archived: boolean
  /** Objetivo que este dinheiro está guardando. */
  goalId: string | null
  plan: InvestmentPlan | null
  moves: InvestmentMove[]
}

/**
 * Objetivo (casamento, carro…). Totais de todo o histórico, calculados no servidor:
 * pago = despesas ligadas já pagas; agendado = ligadas em aberto (atrasado ⊂ agendado).
 */
export interface Goal {
  id: string
  name: string
  icon: string
  color: number
  targetCents: number
  targetDate: string | null
  notes: string | null
  archived: boolean
  paidCents: number
  scheduledCents: number
  overdueCents: number
  paidCount: number
  openCount: number
  nextDue: string | null
  lastDue: string | null
  /** Valor atual das aplicações ligadas: dinheiro já guardado para o que falta pagar. */
  savedCents: number
}
