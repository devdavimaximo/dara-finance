import { useMutationState, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, CloudUpload, WifiOff, X } from 'lucide-react'
import { useOnline } from '../lib/network'

/**
 * Faixa discreta no topo: offline (com quantas alterações esperam), sincronizando,
 * ou alterações recusadas pelo servidor (já desfeitas na tela).
 */
export function SyncBanner() {
  const online = useOnline()
  const qc = useQueryClient()
  const pending = useMutationState({ filters: { mutationKey: ['entries'], status: 'pending' } }).length
  const failed = useMutationState({
    filters: { mutationKey: ['entries'], status: 'error' },
    select: (m) => (m.state.error as Error | null)?.message ?? 'Erro',
  })

  if (online && pending === 0 && failed.length === 0) return null

  const tone = !online ? 'offline' : failed.length ? 'error' : 'sync'
  return (
    <div
      role="status"
      className={clsx('fade-in mb-4 flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold',
        tone === 'offline' && 'bg-surface-2 text-fg-2',
        tone === 'sync' && 'bg-[color-mix(in_oklab,var(--income)_14%,transparent)] text-income-text',
        tone === 'error' && 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-expense-text')}
    >
      {tone === 'offline' && <WifiOff size={17} className="shrink-0" />}
      {tone === 'sync' && <CloudUpload size={17} className="shrink-0 animate-pulse" />}
      {tone === 'error' && <AlertTriangle size={17} className="shrink-0" />}
      <span className="min-w-0 flex-1">
        {tone === 'offline' && (pending
          ? `Sem conexão · ${pending} alteraç${pending > 1 ? 'ões' : 'ão'} salva${pending > 1 ? 's' : ''} no aparelho, envio automático quando voltar.`
          : 'Sem conexão · mostrando os dados salvos no aparelho. Você pode lançar e pagar normalmente.')}
        {tone === 'sync' && `Sincronizando ${pending} alteraç${pending > 1 ? 'ões' : 'ão'}…`}
        {tone === 'error' && `${failed.length} alteraç${failed.length > 1 ? 'ões foram recusadas' : 'ão foi recusada'} pelo servidor e desfeita${failed.length > 1 ? 's' : ''}: ${failed[0]}`}
      </span>
      {tone === 'error' && (
        <button
          aria-label="Dispensar"
          onClick={() => qc.getMutationCache().findAll({ mutationKey: ['entries'], status: 'error' }).forEach((m) => qc.getMutationCache().remove(m))}
          className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-black/10"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
