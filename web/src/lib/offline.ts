/**
 * Offline-first.
 *
 * 1. Leitura: cada espaço tem um "dataset" (24 meses para trás, 13 para frente) guardado no
 *    IndexedDB. Painel, lançamentos e relatórios filtram dele — abre instantâneo e funciona sem rede.
 * 2. Escrita: criar/editar/pagar/excluir vira uma mutação na fila (serial, persistida). A tela é
 *    atualizada na hora (otimista); quando a conexão volta, a fila é enviada em ordem.
 *    Lançamentos criados offline já nascem com o id definitivo (o servidor aceita e é idempotente).
 */
import type { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import { ApiError, api } from './api'
import { addMonthsKey, monthEnd, monthKey, monthStart, todayISO } from './dates'
import { isNetworkError } from './network'
import type { EntriesResponse, Entry, EntryInput, Goal } from './types'

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (k) => get<string>(k).then((v) => v ?? null),
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
  key: 'razao-cache',
  throttleTime: 1500,
})

/**
 * 21 dias. Também é o gcTime das consultas, e timers do navegador estouram acima de ~24,8 dias
 * (2^31 ms): um valor maior faz o setTimeout disparar na hora e o cache restaurado some.
 */
export const CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 21

/** Janela que fica no aparelho. Fora dela, as telas buscam direto do servidor (só online). */
export function coreWindow(today = todayISO()) {
  const cur = monthKey(today)
  return { from: monthStart(addMonthsKey(cur, -24)), to: monthEnd(addMonthsKey(cur, 13)) }
}

export const datasetKey = (wid: string) => ['dataset', wid, coreWindow().from] as const

export const fetchDataset = (wid: string) => {
  const { from, to } = coreWindow()
  return api<EntriesResponse>(`/w/${wid}/entries?from=${from}&to=${to}`)
}

// ---------------------------------------------------------------- mutações

export interface CreateVars { wid: string; body: EntryInput & { id: string } }
export interface UpdateVars { wid: string; id: string; body: EntryInput; scope: 'single' | 'future' }
export interface PayVars { wid: string; id: string; paidDate?: string; paidAmountCents?: number; offCash?: boolean; offCashSource?: string }
export interface IdVars { wid: string; id: string }
export interface RemoveVars { wid: string; id: string; scope: 'single' | 'future' }

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

/** Todos os lançamentos em cache do espaço (dataset, intervalos avulsos e listas de objetivos), por id. */
function cachedEntries(qc: QueryClient, wid: string) {
  const byId = new Map<string, Entry>()
  for (const key of [['dataset', wid], ['entries', wid]])
    for (const [, d] of qc.getQueriesData<EntriesResponse>({ queryKey: key })) d?.items.forEach((e) => byId.set(e.id, e))
  for (const [, list] of qc.getQueriesData<Entry[]>({ queryKey: ['goal-entries', wid] })) list?.forEach((e) => byId.set(e.id, e))
  return byId
}

/**
 * Aplica `patch` em todas as listas de lançamentos em cache desse espaço e ajusta os totais
 * dos objetivos afetados (pago/agendado) — assim a tela do objetivo também reage offline.
 */
function patchAll(qc: QueryClient, wid: string, patch: (items: Entry[]) => Entry[]) {
  const before = cachedEntries(qc, wid)
  for (const key of [['dataset', wid], ['entries', wid]])
    qc.setQueriesData<EntriesResponse>({ queryKey: key }, (old) => (old ? { ...old, items: patch(old.items) } : old))
  // A lista de um objetivo recebe o resultado do patch filtrado ao objetivo (inclusive entradas novas).
  for (const [key, list] of qc.getQueriesData<Entry[]>({ queryKey: ['goal-entries', wid] })) {
    if (!list) continue
    const gid = key[2] as string
    const merged = patch([...new Map([...list, ...before.values()].map((e) => [e.id, e])).values()])
    qc.setQueryData(key, merged.filter((e) => e.goalId === gid).sort((a, b) => a.dueDate.localeCompare(b.dueDate)))
  }
  const after = cachedEntries(qc, wid)
  const today = todayISO()
  const delta = new Map<string, { paid: number; scheduled: number; overdue: number; paidCount: number; openCount: number }>()
  const add = (e: Entry | undefined, sign: 1 | -1) => {
    if (!e?.goalId || e.kind !== 'Expense') return
    const d = delta.get(e.goalId) ?? { paid: 0, scheduled: 0, overdue: 0, paidCount: 0, openCount: 0 }
    if (e.paidDate) { d.paid += sign * (e.paidAmountCents ?? e.amountCents); d.paidCount += sign }
    else { d.scheduled += sign * e.amountCents; d.openCount += sign; if (e.dueDate < today) d.overdue += sign * e.amountCents }
    delta.set(e.goalId, d)
  }
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id), a = after.get(id)
    if (b === a) continue
    add(b, -1); add(a, 1)
  }
  if (delta.size)
    qc.setQueryData<Goal[]>(['goals', wid], (goals) => goals?.map((g) => {
      const d = delta.get(g.id)
      return d ? { ...g, paidCents: g.paidCents + d.paid, scheduledCents: g.scheduledCents + d.scheduled, overdueCents: g.overdueCents + d.overdue,
        paidCount: g.paidCount + d.paidCount, openCount: g.openCount + d.openCount } : g
    }))
}

function snapshot(qc: QueryClient, wid: string) {
  return [
    ...qc.getQueriesData<unknown>({ queryKey: ['dataset', wid] }), ...qc.getQueriesData<unknown>({ queryKey: ['entries', wid] }),
    ...qc.getQueriesData<unknown>({ queryKey: ['goals', wid] }), ...qc.getQueriesData<unknown>({ queryKey: ['goal-entries', wid] }),
  ]
}

function entryFromInput(id: string, b: EntryInput): Entry {
  return {
    id, kind: b.kind, description: b.description.trim(), amountCents: b.amountCents, dueDate: b.dueDate,
    paidDate: b.paid ? (b.paidDate ?? todayISO()) : null,
    paidAmountCents: b.paid ? (b.paidAmountCents || b.amountCents) : null,
    offCash: b.paid && b.offCash,
    offCashSource: (b.paid && b.offCash && b.offCashSource?.trim()) || null,
    categoryId: b.categoryId, counterparty: b.counterparty?.trim() || null, method: b.method, notes: b.notes?.trim() || null,
    recurrenceId: b.repeat ? `pending:${id}` : null, sequence: b.repeat ? 1 : null, seriesCount: b.repeat?.count ?? null,
    frequency: b.repeat?.frequency ?? null, attachmentName: null, goalId: b.goalId ?? null,
    cardId: b.cardId ?? null, purchaseDate: b.cardId ? (b.purchaseDate ?? null) : null, transferId: null,
  }
}

type Ctx = { snap: ReturnType<typeof snapshot> }

export function registerMutationDefaults(qc: QueryClient) {
  const common = <V extends { wid: string }>(optimistic: (v: V) => (items: Entry[]) => Entry[]) => ({
    // Serial: "criar" e depois "pagar" o mesmo lançamento chegam ao servidor nessa ordem.
    scope: { id: 'entries' },
    networkMode: 'online' as const,
    // Erro de rede não é falha: a mutação espera a conexão voltar e tenta de novo.
    retry: (n: number, e: Error) => isNetworkError(e) || (e instanceof ApiError && e.status >= 500 && n < 3),
    retryDelay: (n: number) => Math.min(1000 * 2 ** n, 15000),
    onMutate: async (v: V): Promise<Ctx> => {
      await qc.cancelQueries({ queryKey: ['dataset', v.wid] })
      await qc.cancelQueries({ queryKey: ['entries', v.wid] })
      await qc.cancelQueries({ queryKey: ['goals', v.wid] })
      await qc.cancelQueries({ queryKey: ['goal-entries', v.wid] })
      const snap = snapshot(qc, v.wid)
      patchAll(qc, v.wid, optimistic(v))
      return { snap }
    },
    // O servidor recusou (validação, 404): desfaz o otimista.
    onError: (_e: Error, _v: V, ctx: Ctx | undefined) => ctx?.snap.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: (_d: unknown, _e: Error | null, v: V) => {
      // Só recarrega quando a fila esvaziar — evita N recargas ao sincronizar várias alterações.
      if (qc.isMutating({ mutationKey: ['entries'] }) <= 1) {
        qc.invalidateQueries({ queryKey: ['dataset', v.wid] })
        qc.invalidateQueries({ queryKey: ['entries', v.wid] })
        qc.invalidateQueries({ queryKey: ['recurrences', v.wid] })
        qc.invalidateQueries({ queryKey: ['goals', v.wid] })
        qc.invalidateQueries({ queryKey: ['goal-entries', v.wid] })
      }
    },
  })

  qc.setMutationDefaults(['entries', 'create'], {
    mutationFn: (v: CreateVars) => api<Entry>(`/w/${v.wid}/entries`, json('POST', v.body)),
    ...common<CreateVars>((v) => (items) => (items.some((e) => e.id === v.body.id) ? items : [...items, entryFromInput(v.body.id, v.body)])),
  })

  qc.setMutationDefaults(['entries', 'update'], {
    mutationFn: (v: UpdateVars) => api<Entry>(`/w/${v.wid}/entries/${v.id}?scope=${v.scope}`, json('PUT', v.body)),
    ...common<UpdateVars>((v) => (items) => {
      const target = items.find((e) => e.id === v.id)
      if (!target) return items
      const next = entryFromInput(v.id, v.body)
      return items.map((e) => {
        if (e.id === v.id)
          return { ...next, recurrenceId: e.recurrenceId, sequence: e.sequence, seriesCount: e.seriesCount, frequency: e.frequency, attachmentName: e.attachmentName,
            transferId: e.transferId ?? null, paidDate: v.body.paid ? (v.body.paidDate ?? e.paidDate ?? todayISO()) : null }
        if (v.scope === 'future' && target.recurrenceId && e.recurrenceId === target.recurrenceId && !e.paidDate && e.dueDate > target.dueDate)
          return { ...e, description: next.description, amountCents: next.amountCents, categoryId: next.categoryId, goalId: next.goalId,
            cardId: next.cardId, counterparty: next.counterparty, method: next.method }
        return e
      })
    }),
  })

  qc.setMutationDefaults(['entries', 'pay'], {
    mutationFn: (v: PayVars) => api<Entry>(`/w/${v.wid}/entries/${v.id}/pay`, json('POST', { paidDate: v.paidDate, paidAmountCents: v.paidAmountCents, offCash: !!v.offCash, offCashSource: v.offCashSource })),
    ...common<PayVars>((v) => (items) => items.map((e) => e.id === v.id
      ? { ...e, paidDate: v.paidDate ?? todayISO(), paidAmountCents: v.paidAmountCents || e.amountCents, offCash: !!v.offCash,
        offCashSource: (v.offCash && v.offCashSource?.trim()) || null } : e)),
  })

  qc.setMutationDefaults(['entries', 'unpay'], {
    mutationFn: (v: IdVars) => api<Entry>(`/w/${v.wid}/entries/${v.id}/unpay`, json('POST')),
    ...common<IdVars>((v) => (items) => items.map((e) => (e.id === v.id ? { ...e, paidDate: null, paidAmountCents: null, offCash: false, offCashSource: null } : e))),
  })

  qc.setMutationDefaults(['entries', 'remove'], {
    mutationFn: (v: RemoveVars) => api(`/w/${v.wid}/entries/${v.id}?scope=${v.scope}`, json('DELETE')),
    ...common<RemoveVars>((v) => (items) => {
      const target = items.find((e) => e.id === v.id)
      return items.filter((e) => e.id !== v.id && !(v.scope === 'future' && target?.recurrenceId &&
        e.recurrenceId === target.recurrenceId && !e.paidDate && e.dueDate >= target.dueDate))
    }),
  })
}

/** Ao sair da conta: some tudo do aparelho (privacidade). */
export async function wipeLocal(qc: QueryClient) {
  qc.getMutationCache().clear()
  qc.clear()
  await persister.removeClient()
}
