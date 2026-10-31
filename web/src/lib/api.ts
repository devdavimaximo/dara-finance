import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { cashAt } from './analytics'
import { markOffline, markOnline, newId, NetworkError } from './network'
import { coreWindow, datasetKey, fetchDataset, wipeLocal, type CreateVars, type IdVars, type PayVars, type RemoveVars, type UpdateVars } from './offline'
import type {
  CdiRate, Category, EntriesResponse, Entry, EntryInput, Goal, Investment, InvestmentKind, InvestmentMove, InvestmentPlan, Me, Member, MoveKind,
  Origin, Recurrence,
  UserAccount, Workspace, WorkspaceKind,
} from './types'

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: isForm ? init.headers : { 'Content-Type': 'application/json', ...init.headers },
    })
  } catch {
    markOffline()
    throw new NetworkError()
  }
  // 502/503/504 = proxy no ar, app fora (deploy/reinício): para o usuário é o mesmo que sem rede.
  if (res.status >= 502 && res.status <= 504) { markOffline(); throw new NetworkError() }
  markOnline()
  if (!res.ok) {
    let msg = res.status === 401 ? 'Sessão expirada.' : res.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : 'Algo deu errado.'
    let code: string | undefined
    try { const body = await res.json(); if (body?.error) msg = body.error; code = body?.code } catch { /* sem corpo */ }
    throw new ApiError(res.status, msg, code)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

// ---------------------------------------------------------------- sessão

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => api<{ needsSetup: boolean }>('/auth/status') })

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try { return await api<Me>('/auth/me') } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e }
    },
    staleTime: 5 * 60_000,
  })

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api<Me>('/auth/login', json('POST', body)),
    onSuccess: async (me) => { await switchUser(qc, me.id); qc.setQueryData(['me'], me) },
  })
}

export function useSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string; workspaceName: string; workspaceKind: WorkspaceKind }) =>
      api<Me>('/auth/setup', json('POST', body)),
    onSuccess: async (me) => { await switchUser(qc, me.id); qc.setQueryData(['me'], me); qc.setQueryData(['status'], { needsSetup: false }) },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api('/auth/logout', json('POST')),
    onSuccess: async () => { await wipeLocal(qc); qc.setQueryData(['me'], null) },
  })
}

/** Troca de senha. Com senha provisória, `current` é dispensado. */
export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { current?: string; next: string }) => api<Me>('/auth/password', json('PUT', body)),
    onSuccess: (me) => qc.setQueryData(['me'], me),
  })
}

// ---------------------------------------------------------------- contas (admin)

export const useUsers = (enabled: boolean) =>
  useQuery({ queryKey: ['admin-users'], queryFn: () => api<UserAccount[]>('/admin/users'), enabled })

export function useUserMutations() {
  const qc = useQueryClient()
  const done = () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['members'] }) }
  return {
    create: useMutation({
      mutationFn: (body: { name: string; email: string; password: string; canCreateWorkspaces: boolean; grants: { workspaceId: string; role: 'Owner' | 'Member' }[] }) =>
        api<UserAccount>('/admin/users', json('POST', body)),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; active?: boolean; canCreateWorkspaces?: boolean }) => api(`/admin/users/${id}`, json('PUT', body)),
      onSuccess: done,
    }),
    reset: useMutation({
      mutationFn: ({ id, password }: { id: string; password: string }) => api(`/admin/users/${id}/reset-password`, json('POST', { password })),
      onSuccess: done,
    }),
    /** Exclusão definitiva: espaços só da pessoa somem; compartilhados ganham outro responsável. */
    remove: useMutation({
      mutationFn: (id: string) => api<{ spacesDeleted: number; spacesTransferred: number }>(`/admin/users/${id}`, json('DELETE')),
      onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['me'] }) },
    }),
  }
}

// ---------------------------------------------------------------- workspace

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; kind: WorkspaceKind; ownerUserId?: string | null }) => api<Workspace>('/workspaces', json('POST', body)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['admin-users'] }) },
  })
}

export function useUpdateWorkspace(wid: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; openingBalanceCents: number; openingBalanceDate: string }) => api<Workspace>(`/w/${wid}/`, json('PUT', body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['dataset', wid] })
      qc.invalidateQueries({ queryKey: ['entries', wid] })
    },
  })
}

export const useMembers = (wid: string) => useQuery({ queryKey: ['members', wid], queryFn: () => api<Member[]>(`/w/${wid}/members`) })

export function useMemberMutations(wid: string) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['members', wid] })
  return {
    /** Só contas que já existem — contas novas o admin cria em Usuários. */
    add: useMutation({
      mutationFn: (body: { email: string; role: 'Owner' | 'Member' }) => api<Member>(`/w/${wid}/members`, json('POST', body)),
      onSuccess: done,
    }),
    role: useMutation({
      mutationFn: ({ userId, role }: { userId: string; role: 'Owner' | 'Member' }) => api(`/w/${wid}/members/${userId}`, json('PUT', { role })),
      onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['me'] }) },
    }),
    /** Remover alguém, ou a si mesmo (sair do espaço). */
    remove: useMutation({
      mutationFn: (userId: string) => api(`/w/${wid}/members/${userId}`, json('DELETE')),
      onSuccess: () => { done(); qc.invalidateQueries({ queryKey: ['me'] }) },
    }),
  }
}

// ---------------------------------------------------------------- dados

/** O dataset do espaço que fica no aparelho (ver offline.ts). */
export const useDataset = (wid: string, enabled = true) =>
  useQuery({ queryKey: datasetKey(wid), queryFn: () => fetchDataset(wid), enabled, staleTime: 30_000 })

/**
 * Lançamentos que vencem OU foram pagos em [from, to], com o saldo de caixa antes de `from`.
 * Dentro da janela local, deriva do dataset (instantâneo, offline). Fora dela, busca no servidor.
 */
export function useEntries(wid: string, from: string, to: string) {
  const core = coreWindow()
  const inside = from >= core.from && to <= core.to
  const ds = useDataset(wid, inside)
  const direct = useQuery({
    queryKey: ['entries', wid, from, to],
    queryFn: () => api<EntriesResponse>(`/w/${wid}/entries?from=${from}&to=${to}`),
    enabled: !inside,
    placeholderData: (prev) => prev,
  })
  const derived = useMemo<EntriesResponse | undefined>(() => {
    if (!inside || !ds.data) return undefined
    const all = ds.data.items
    const flows = ds.data.flows ?? []
    return {
      balanceBefore: from === core.from ? ds.data.balanceBefore : cashAt(all, ds.data.balanceBefore, core.from, prevDay(from), flows),
      items: all.filter((e) => (e.dueDate >= from && e.dueDate <= to) || (e.paidDate != null && e.paidDate >= from && e.paidDate <= to)),
      flows: flows.filter((f) => f.date >= from && f.date <= to),
    }
  }, [inside, ds.data, from, to, core.from])
  return inside
    ? { data: derived, isLoading: ds.isLoading, isError: ds.isError && !ds.data }
    : { data: direct.data, isLoading: direct.isLoading, isError: direct.isError && !direct.data }
}

const prevDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export const useCategories = (wid: string) =>
  useQuery({ queryKey: ['categories', wid], queryFn: () => api<Category[]>(`/w/${wid}/categories`), staleTime: 60_000 })

export const useRecurrences = (wid: string) =>
  useQuery({ queryKey: ['recurrences', wid], queryFn: () => api<Recurrence[]>(`/w/${wid}/recurrences`) })

/**
 * Mutações de lançamento. As de dados (criar/editar/pagar/excluir) usam os defaults offline de
 * offline.ts: atualizam a tela na hora, entram na fila e sincronizam quando houver rede.
 * Comprovante e encerrar série exigem conexão.
 */
export function useEntryMutations(wid: string) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['dataset', wid] })
    qc.invalidateQueries({ queryKey: ['entries', wid] })
    qc.invalidateQueries({ queryKey: ['recurrences', wid] })
  }
  const create = useMutation<Entry, Error, CreateVars>({ mutationKey: ['entries', 'create'] })
  const update = useMutation<Entry, Error, UpdateVars>({ mutationKey: ['entries', 'update'] })
  const pay = useMutation<Entry, Error, PayVars>({ mutationKey: ['entries', 'pay'] })
  const unpay = useMutation<Entry, Error, IdVars>({ mutationKey: ['entries', 'unpay'] })
  const remove = useMutation<unknown, Error, RemoveVars>({ mutationKey: ['entries', 'remove'] })
  return {
    /** Devolve o id (definitivo) já na hora, mesmo offline. */
    create: (body: EntryInput) => {
      const id = newId()
      const promise = create.mutateAsync({ wid, body: { ...body, id } })
      promise.catch(() => {}) // erro aparece no banner de sincronização
      return { id, promise }
    },
    update: (id: string, body: EntryInput, scope: 'single' | 'future') => { update.mutate({ wid, id, body, scope }) },
    pay: (id: string, paidDate?: string, paidAmountCents?: number) => { pay.mutate({ wid, id, paidDate, paidAmountCents }) },
    unpay: (id: string) => { unpay.mutate({ wid, id }) },
    toggle: (e: Entry) => (e.paidDate ? unpay.mutate({ wid, id: e.id }) : pay.mutate({ wid, id: e.id })),
    remove: (id: string, scope: 'single' | 'future') => { remove.mutate({ wid, id, scope }) },
    attach: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => {
        const fd = new FormData()
        fd.append('file', file)
        return api(`/w/${wid}/entries/${id}/attachment`, { method: 'POST', body: fd })
      },
      onSuccess: done,
    }),
    detach: useMutation({ mutationFn: (id: string) => api(`/w/${wid}/entries/${id}/attachment`, json('DELETE')), onSuccess: done }),
    stopSeries: useMutation({ mutationFn: (id: string) => api(`/w/${wid}/recurrences/${id}/stop`, json('POST')), onSuccess: done }),
  }
}

export function useCategoryMutations(wid: string) {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['categories', wid] })
  return {
    create: useMutation({ mutationFn: (c: Partial<Category>) => api<Category>(`/w/${wid}/categories`, json('POST', c)), onSuccess: done }),
    update: useMutation({ mutationFn: (c: Category) => api<Category>(`/w/${wid}/categories/${c.id}`, json('PUT', c)), onSuccess: done }),
  }
}

// ---------------------------------------------------------------- avisos (push)

export interface NotifySettings { enabled: boolean; hour: number; daysAhead: number; devices: number }

export const useNotifySettings = () =>
  useQuery({ queryKey: ['push-settings'], queryFn: () => api<NotifySettings>('/push/settings') })

export function useNotifyMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['push-settings'] })
  return {
    save: useMutation({ mutationFn: (s: NotifySettings) => api('/push/settings', json('PUT', s)), onSuccess: done }),
    test: useMutation({ mutationFn: () => api<{ title: string; body: string }>('/push/test', json('POST')) }),
    done,
  }
}

// ---------------------------------------------------------------- importação de extrato

export interface ImportRow {
  externalId: string
  date: string
  amountCents: number
  kind: 'Expense' | 'Income'
  description: string
  duplicate: boolean
  match: { entryId: string; description: string; dueDate: string; amountCents: number } | null
  suggestedCategoryId: string | null
}

export function useImport(wid: string) {
  const qc = useQueryClient()
  return {
    preview: useMutation({
      mutationFn: ({ file, invert }: { file: File; invert: boolean }) => {
        const fd = new FormData()
        fd.append('file', file)
        return api<{ rows: ImportRow[] }>(`/w/${wid}/import/preview?invert=${invert}`, { method: 'POST', body: fd })
      },
    }),
    commit: useMutation({
      mutationFn: (rows: { externalId: string; date: string; amountCents: number; kind: string; description: string; categoryId: string | null; matchEntryId: string | null }[]) =>
        api<{ created: number; reconciled: number; skipped: number }>(`/w/${wid}/import/commit`, json('POST', { rows })),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['dataset', wid] })
        qc.invalidateQueries({ queryKey: ['entries', wid] })
      },
    }),
  }
}

/**
 * Entrou outra conta neste aparelho (sem ter clicado em Sair antes — ex.: sessão expirou):
 * apaga o cache offline e a fila da conta anterior antes de mostrar qualquer coisa.
 */
async function switchUser(qc: ReturnType<typeof useQueryClient>, userId: string) {
  let last: string | null = null
  try { last = localStorage.getItem('razao.user') } catch { /* modo privado */ }
  if (last && last !== userId) await wipeLocal(qc)
  try { localStorage.setItem('razao.user', userId) } catch { /* modo privado */ }
}

// ---------------------------------------------------------------- objetivos

export const useGoals = (wid: string) =>
  useQuery({ queryKey: ['goals', wid], queryFn: () => api<Goal[]>(`/w/${wid}/goals`) })

/** Todas as despesas ligadas ao objetivo, de qualquer época. */
export const useGoalEntries = (wid: string, goalId: string) =>
  useQuery({ queryKey: ['goal-entries', wid, goalId], queryFn: () => api<Entry[]>(`/w/${wid}/goals/${goalId}/entries`) })

export interface GoalInput { name: string; icon: string; color: number; targetCents: number; targetDate: string | null; notes: string | null; archived: boolean }

export function useGoalMutations(wid: string) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['goals', wid] })
    qc.invalidateQueries({ queryKey: ['goal-entries', wid] })
  }
  return {
    create: useMutation({ mutationFn: (g: GoalInput) => api<Goal>(`/w/${wid}/goals`, json('POST', g)), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...g }: GoalInput & { id: string }) => api<Goal>(`/w/${wid}/goals/${id}`, json('PUT', g)), onSuccess: done }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/w/${wid}/goals/${id}`, json('DELETE')),
      onSuccess: () => {
        done()
        qc.invalidateQueries({ queryKey: ['dataset', wid] })
        qc.invalidateQueries({ queryKey: ['entries', wid] })
      },
    }),
  }
}

// ---------------------------------------------------------------- investimentos

/** Aplicações com o histórico inteiro (pequeno). Fica no cache do aparelho para leitura offline. */
export const useInvestments = (wid: string) =>
  useQuery({ queryKey: ['investments', wid], queryFn: () => api<Investment[]>(`/w/${wid}/investments`), staleTime: 30_000 })

export interface InvestmentInput {
  name: string; kind: InvestmentKind; institution: string | null; color: number; countsInCash: boolean; notes: string | null; archived: boolean
  goalId: string | null; plan: InvestmentPlan | null
}
export interface MoveInput {
  kind: MoveKind; date: string; amountCents: number; origin: Origin | null; toCash: boolean; notes: string | null; closeOut?: boolean
  planDate?: string | null
}

/**
 * CDI diário desde `from` (referência pública). Muda uma vez por dia; fica no aparelho.
 * Falha (sem rede, BCB fora do ar) = sem comparação, nunca erro na tela.
 */
export const useCdi = (from: string | null) =>
  useQuery({
    queryKey: ['cdi', from],
    queryFn: () => api<CdiRate[]>(`/cdi?from=${from}`),
    enabled: !!from,
    staleTime: 6 * 60 * 60_000,
    retry: 1,
  })

/**
 * Escritas de investimento exigem conexão (como objetivos). Toda mudança mexe no caixa,
 * então o dataset do painel é recarregado junto.
 */
export function useInvestmentMutations(wid: string) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['investments', wid] })
    qc.invalidateQueries({ queryKey: ['dataset', wid] })
    qc.invalidateQueries({ queryKey: ['entries', wid] })
    qc.invalidateQueries({ queryKey: ['goals', wid] }) // "guardado" dos objetivos ligados
  }
  return {
    create: useMutation({ mutationFn: (b: InvestmentInput) => api<Investment>(`/w/${wid}/investments`, json('POST', b)), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...b }: InvestmentInput & { id: string }) => api<Investment>(`/w/${wid}/investments/${id}`, json('PUT', b)), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/w/${wid}/investments/${id}`, json('DELETE')), onSuccess: done }),
    addMove: useMutation({ mutationFn: ({ investmentId, ...b }: MoveInput & { investmentId: string }) => api<InvestmentMove>(`/w/${wid}/investments/${investmentId}/moves`, json('POST', b)), onSuccess: done }),
    updateMove: useMutation({ mutationFn: ({ investmentId, id, ...b }: MoveInput & { investmentId: string; id: string }) => api<InvestmentMove>(`/w/${wid}/investments/${investmentId}/moves/${id}`, json('PUT', b)), onSuccess: done }),
    removeMove: useMutation({ mutationFn: ({ investmentId, id }: { investmentId: string; id: string }) => api(`/w/${wid}/investments/${investmentId}/moves/${id}`, json('DELETE')), onSuccess: done }),
  }
}

/** O que acontece se a conta for excluída (mostrado antes de confirmar). */
export const useDeletionImpact = (userId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['deletion-impact', userId],
    queryFn: () => api<{ spacesDeleted: number; spacesTransferred: number }>(`/admin/users/${userId}/deletion-impact`),
    enabled,
    staleTime: 0,
  })
