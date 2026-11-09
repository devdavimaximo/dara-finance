import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { wipeLocal } from './offline'

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }))

describe('wipeLocal', () => {
  it('mantém o App observando a sessão: login/logout trocam a tela sem recarregar', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['me'], { id: 'ana' })
    const observer = new QueryObserver(qc, { queryKey: ['me'], enabled: false })
    const seen: unknown[] = []
    const stop = observer.subscribe((r) => seen.push(r.data))

    await wipeLocal(qc)
    qc.setQueryData(['me'], null)
    await vi.waitFor(() => expect(seen.at(-1)).toBeNull())
    stop()
  })

  it('apaga os dados do aparelho', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['dataset', 'w1'], { items: [1] })
    qc.setQueryData(['goals', 'w1'], [1])

    await wipeLocal(qc)

    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
})
