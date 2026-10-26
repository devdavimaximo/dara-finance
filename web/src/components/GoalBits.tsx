import clsx from 'clsx'
import { useState } from 'react'
import { useGoalMutations, type GoalInput } from '../lib/api'
import { fullDate } from '../lib/dates'
import { money, parseMoney, pct } from '../lib/format'
import type { GoalProgress, GoalStatus } from '../lib/goals'
import { useSession } from '../lib/session'
import type { Goal } from '../lib/types'
import { centsToInput, ColorPicker, IconPicker } from './PoteForm'
import { Button, CategoryBadge, Toggle } from './ui'

/**
 * Anel de progresso em duas camadas: pago (cheio) e agendado (mesma cor, mais clara).
 * O restante do anel é o que ainda não tem conta lançada.
 */
export function ProgressRing({ paid, committed, color, size = 120, stroke = 12, children }: {
  paid: number; committed: number; color: string; size?: number; stroke?: number; children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = (share: number) => `${Math.max(0, Math.min(1, share)) * c} ${c}`
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={stroke}
          strokeDasharray={arc(committed)} strokeLinecap="round" className="transition-[stroke-dasharray] duration-700" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={arc(paid)} strokeLinecap="round" className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

const statusText: Record<GoalStatus, { label: string; cls: string }> = {
  done: { label: 'Concluído', cls: 'bg-[color-mix(in_oklab,var(--good)_16%,transparent)] text-good-text' },
  covered: { label: 'Tudo agendado', cls: 'bg-[color-mix(in_oklab,var(--income)_16%,transparent)] text-income-text' },
  'on-track': { label: 'Em andamento', cls: 'bg-surface-3 text-fg-2' },
  behind: { label: 'Passou da data', cls: 'bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] text-expense-text' },
  'no-date': { label: 'Sem data', cls: 'bg-surface-3 text-muted' },
}

export const StatusPill = ({ status }: { status: GoalStatus }) => (
  <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', statusText[status].cls)}>{statusText[status].label}</span>
)

/** Barra da meta em três partes: pago | agendado | sem conta lançada — com rótulos diretos. */
export function GoalBar({ p, color, target }: { p: GoalProgress; color: string; target: number }) {
  const parts = [
    { label: 'Pago', value: p.paid, fill: color, opacity: 1 },
    { label: 'Agendado', value: p.scheduled, fill: color, opacity: 0.4 },
    { label: 'Sem conta lançada', value: p.unplanned, fill: 'var(--surface-3)', opacity: 1 },
  ]
  const total = Math.max(target, p.committed)
  return (
    <div>
      <div className="flex h-3.5 gap-[2px] overflow-hidden rounded-full">
        {parts.filter((x) => x.value > 0).map((x) => (
          <div key={x.label} className="h-full first:rounded-l-full last:rounded-r-full transition-[width] duration-700"
            style={{ width: `${(x.value / total) * 100}%`, background: x.fill, opacity: x.opacity }} title={`${x.label}: ${money(x.value)}`} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {parts.map((x) => (
          <div key={x.label} className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-muted">
              <span className="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: x.fill, opacity: x.opacity }} />{x.label}
            </p>
            <p className="num truncate text-sm font-bold">{money(x.value)}</p>
            <p className="num text-[11px] text-faint">{pct(target ? x.value / target : 0)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const suggestions = [
  { name: 'Casamento', icon: 'heart', color: 5 },
  { name: 'Carro', icon: 'car', color: 1 },
  { name: 'Casa própria', icon: 'key', color: 3 },
  { name: 'Viagem', icon: 'plane', color: 7 },
  { name: 'Reserva de emergência', icon: 'piggy-bank', color: 6 },
]

export function GoalForm({ goal, onDone, onDeleted }: { goal: Goal | null; onDone: (g?: Goal) => void; onDeleted?: () => void }) {
  const { workspace } = useSession()
  const m = useGoalMutations(workspace.id)
  const [name, setName] = useState(goal?.name ?? '')
  const [icon, setIcon] = useState(goal?.icon ?? 'target')
  const [color, setColor] = useState(goal?.color ?? 5)
  const [target, setTarget] = useState(centsToInput(goal?.targetCents))
  const [date, setDate] = useState(goal?.targetDate ?? '')
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [archived, setArchived] = useState(goal?.archived ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const err = m.create.error?.message ?? m.update.error?.message ?? m.remove.error?.message

  const save = async () => {
    const body: GoalInput = { name, icon, color, targetCents: parseMoney(target), targetDate: date || null, notes: notes || null, archived }
    const saved = goal ? await m.update.mutateAsync({ id: goal.id, ...body }) : await m.create.mutateAsync(body)
    onDone(saved)
  }

  return (
    <div className="space-y-5 pt-1">
      {!goal && (
        <div className="scroll-x -mx-5 flex gap-2 px-5">
          {suggestions.map((s) => (
            <button key={s.name} type="button" onClick={() => { setName(s.name); setIcon(s.icon); setColor(s.color) }}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line pl-1 pr-3 text-sm font-semibold hover:border-line-strong">
              <CategoryBadge icon={s.icon} color={`var(--cat-${s.color})`} size={26} /> {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <CategoryBadge icon={icon} color={`var(--cat-${color})`} size={52} />
        <input className="field" placeholder="Nome do objetivo" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!goal} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Custo total</label>
          <input className="field num" inputMode="decimal" placeholder="Ex.: 80.000,00" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label className="label">Até quando (opcional)</label>
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      {date && parseMoney(target) > 0 && <p className="-mt-2 text-xs text-muted">Meta de {money(parseMoney(target))} até {fullDate(date)}.</p>}
      <ColorPicker value={color} onChange={setColor} />
      <IconPicker value={icon} onChange={setIcon} />
      <div>
        <label className="label">Anotações</label>
        <textarea className="field min-h-20 resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional — fornecedores, combinados, links" />
      </div>
      {goal && <div className="rounded-3xl border border-line px-4"><Toggle checked={archived} onChange={setArchived} label="Arquivar (concluído ou desistiu)" /></div>}
      {err && <p className="text-sm font-semibold text-expense-text">{err}</p>}
      <Button size="lg" className="w-full" loading={m.create.isPending || m.update.isPending} disabled={!name.trim() || parseMoney(target) <= 0} onClick={save}>
        {goal ? 'Salvar objetivo' : 'Criar objetivo'}
      </Button>
      {goal && (!confirmDelete ? (
        <Button variant="ghost" className="w-full text-expense-text" onClick={() => setConfirmDelete(true)}>Excluir objetivo</Button>
      ) : (
        <div className="space-y-2 rounded-3xl border border-line p-4">
          <p className="text-sm">Os lançamentos continuam existindo — só deixam de contar para este objetivo.</p>
          <div className="flex gap-2">
            <Button variant="danger" loading={m.remove.isPending} onClick={() => m.remove.mutate(goal.id, { onSuccess: () => onDeleted?.() })}>Excluir</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
          </div>
        </div>
      ))}
    </div>
  )
}
