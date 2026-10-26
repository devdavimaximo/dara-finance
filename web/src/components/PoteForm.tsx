import clsx from 'clsx'
import { useState } from 'react'
import { useCategoryMutations } from '../lib/api'
import { parseMoney } from '../lib/format'
import { useSession } from '../lib/session'
import type { Category, Kind } from '../lib/types'
import { Button, CategoryBadge, categoryIcons, Toggle } from './ui'

export const centsToInput = (c: number | null | undefined) => (c ? (c / 100).toFixed(2).replace('.', ',') : '')

export function ColorPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label className="label">Cor</label>
      <div className="flex flex-wrap gap-2.5">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <button key={n} type="button" aria-label={`Cor ${n}`} onClick={() => onChange(n)}
            className={clsx('size-9 rounded-full transition', value === n ? 'ring-2 ring-fg ring-offset-2 ring-offset-surface' : 'hover:scale-110')}
            style={{ background: `var(--cat-${n})` }} />
        ))}
      </div>
    </div>
  )
}

export function IconPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  return (
    <div>
      <label className="label">Ícone</label>
      <div className="grid grid-cols-8 gap-1.5">
        {Object.entries(categoryIcons).map(([k, Icon]) => (
          <button key={k} type="button" aria-label={k} onClick={() => onChange(k)}
            className={clsx('grid aspect-square place-items-center rounded-xl transition', value === k ? 'bg-fg text-bg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3')}>
            <Icon size={18} />
          </button>
        ))}
      </div>
    </div>
  )
}

/** Criar/editar pote (no código: Category). Pote de despesa pode ter teto mensal. */
export function PoteForm({ pote, kind, onDone }: { pote: Category | null; kind: Kind; onDone: () => void }) {
  const { workspace } = useSession()
  const m = useCategoryMutations(workspace.id)
  const [name, setName] = useState(pote?.name ?? '')
  const [color, setColor] = useState(pote?.color ?? 1)
  const [icon, setIcon] = useState(pote?.icon ?? 'tag')
  const [budget, setBudget] = useState(centsToInput(pote?.budgetCents))
  const [archived, setArchived] = useState(pote?.archived ?? false)
  const err = m.create.error?.message ?? m.update.error?.message
  const isExpense = (pote?.kind ?? kind) === 'Expense'

  const save = async () => {
    const body = { name, color, icon, budgetCents: parseMoney(budget) || null, archived, kind: pote?.kind ?? kind }
    if (pote) await m.update.mutateAsync({ ...pote, ...body })
    else await m.create.mutateAsync(body)
    onDone()
  }

  return (
    <div className="space-y-5 pt-1">
      <div className="flex items-center gap-3">
        <CategoryBadge icon={icon} color={`var(--cat-${color})`} size={52} />
        <input className="field" placeholder={isExpense ? 'Ex.: Contas, Lazer, Mercado' : 'Ex.: Salário, Freelas'} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <ColorPicker value={color} onChange={setColor} />
      <IconPicker value={icon} onChange={setIcon} />
      {isExpense && (
        <div>
          <label className="label">Teto por mês (opcional)</label>
          <input className="field" inputMode="decimal" placeholder="Ex.: 800,00" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <p className="mt-1.5 text-xs text-muted">Quanto cabe neste pote por mês. O app mostra quanto já saiu e avisa quando passar.</p>
        </div>
      )}
      {pote && <div className="rounded-3xl border border-line px-4"><Toggle checked={archived} onChange={setArchived} label="Arquivar (some do formulário, mantém o histórico)" /></div>}
      {err && <p className="text-sm font-semibold text-expense-text">{err}</p>}
      <Button size="lg" className="w-full" loading={m.create.isPending || m.update.isPending} onClick={save} disabled={!name.trim()}>Salvar pote</Button>
    </div>
  )
}
