import { useState } from 'react'
import { Logo } from '../components/Layout'
import { Button, Segmented } from '../components/ui'
import { useLogout, useUpdateWorkspace } from '../lib/api'
import { todayISO } from '../lib/dates'
import { money, parseMoney } from '../lib/format'
import { useSession } from '../lib/session'

/**
 * Primeira entrada num espaço novo: quanto dinheiro existe hoje. Vira o saldo inicial, sem
 * contar como receita. Só o responsável responde; zero também é resposta.
 */
export function OpeningBalancePage() {
  const { workspace } = useSession()
  const update = useUpdateWorkspace(workspace.id)
  const logout = useLogout()
  const [amount, setAmount] = useState('')
  const [sign, setSign] = useState<'positive' | 'negative'>('positive')
  const cents = (sign === 'negative' ? -1 : 1) * parseMoney(amount.replace(/-/g, ''))
  const save = () => update.mutate({
    name: workspace.name,
    openingBalanceCents: cents,
    openingBalanceDate: todayISO(),
    reserveMonths: workspace.reserveMonths,
  })
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <div className="rise w-full max-w-sm space-y-5">
        <Logo />
        <div>
          <h1 className="display text-3xl font-bold">Quanto você tem hoje?</h1>
          <p className="mt-1.5 text-muted">
            Olhe o saldo da conta de <strong>{workspace.name}</strong> e coloque aqui. É só o ponto de partida: não conta como receita.
          </p>
        </div>
        <Segmented
          value={sign}
          onChange={setSign}
          options={[
            { value: 'positive', label: 'Tenho saldo' },
            { value: 'negative', label: 'Estou no negativo' },
          ]}
        />
        <div>
          <label className="label" htmlFor="opening">Saldo em conta (R$)</label>
          <input id="opening" className="field num" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
        {update.error && <p className="text-sm font-semibold text-expense-text">{update.error.message}</p>}
        <Button size="lg" className="w-full" loading={update.isPending} onClick={save}>
          {cents === 0 ? 'Começar do zero' : `Começar com ${money(cents)}`}
        </Button>
        <p className="text-center text-xs text-muted">Dá para corrigir depois em Ajustes.</p>
        <button type="button" onClick={() => logout.mutate()} className="w-full text-sm font-semibold text-muted hover:text-fg">Sair</button>
      </div>
    </div>
  )
}
