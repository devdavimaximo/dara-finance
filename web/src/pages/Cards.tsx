import clsx from 'clsx'
import { ChevronRight, CreditCard, Pencil, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EntryRow } from '../components/EntryRow'
import { ColorPicker } from '../components/PoteForm'
import { Button, Empty, SectionTitle, Sheet, Spinner } from '../components/ui'
import { useCardMutations, useCards, useCategories, useEntries, useEntryMutations, type CardInput } from '../lib/api'
import { invoices, type Invoice } from '../lib/cards'
import { fullDate, relativeDay, shortDate, todayISO } from '../lib/dates'
import { money } from '../lib/format'
import { coreWindow } from '../lib/offline'
import { useSession } from '../lib/session'
import type { Card } from '../lib/types'

const statusLabel: Record<Invoice['status'], { label: string; cls: string }> = {
  open: { label: 'Aberta', cls: 'bg-surface-3 text-fg-2' },
  closed: { label: 'Fechada', cls: 'bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] text-[var(--warning)]' },
  paid: { label: 'Paga', cls: 'bg-[color-mix(in_oklab,var(--good)_16%,transparent)] text-good-text' },
}

/**
 * Faturas por cartão, a partir do dataset local (funciona offline). Pagar a fatura = pagar cada compra
 * dela pela fila offline normal; cada compra continua no seu pote.
 */
export function CardsPage() {
  const { workspace } = useSession()
  const today = todayISO()
  const cardsQ = useCards(workspace.id)
  const { from, to } = coreWindow()
  const q = useEntries(workspace.id, from, to)
  const [editing, setEditing] = useState<Card | 'new' | null>(null)

  const all = useMemo(() => (cardsQ.data ?? []).filter((c) => !c.archived), [cardsQ.data])
  const byCard = useMemo(() => all.map((c) => ({ card: c, list: invoices(q.data?.items ?? [], c, today) })), [all, q.data, today])

  if (cardsQ.isLoading && !cardsQ.data) return <Spinner />

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">{workspace.name}</p>
          <h1 className="display text-3xl font-bold lg:text-4xl">Cartões</h1>
        </div>
        <Button size="sm" onClick={() => setEditing('new')}><Plus size={16} /> Novo cartão</Button>
      </header>

      {all.length === 0 ? (
        <div className="card">
          <Empty icon={CreditCard} title="Fatura no lugar certo"
            hint="Cadastre o cartão com os dias de fechamento e vencimento. Ao lançar uma compra nele, ela cai na fatura certa — e só sai do caixa quando a fatura vence."
            action={<Button onClick={() => setEditing('new')}><Plus size={16} /> Cadastrar cartão</Button>} />
        </div>
      ) : byCard.map(({ card, list }) => (
        <CardSection key={card.id} card={card} list={list} today={today} onEdit={() => setEditing(card)} />
      ))}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo cartão' : 'Editar cartão'}>
        {editing && <CardForm card={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  )
}

function CardSection({ card, list, today, onEdit }: { card: Card; list: Invoice[]; today: string; onEdit: () => void }) {
  const { workspace, openEntry } = useSession()
  const categories = useCategories(workspace.id).data ?? []
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const m = useEntryMutations(workspace.id)
  const [open, setOpen] = useState<string | null>(null)
  const [showPaid, setShowPaid] = useState(false)
  const pending = list.filter((i) => i.status !== 'paid')
  const paid = list.filter((i) => i.status === 'paid')
  const shown = showPaid ? list : pending
  const color = `var(--cat-${card.color})`

  // Paga cada compra em aberto da fatura na data escolhida (fila offline normal).
  const pay = (inv: Invoice) => inv.items.filter((e) => !e.paidDate).forEach((e) => m.pay(e.id, today <= inv.due ? today : inv.due))

  return (
    <section className="card p-5 lg:p-6">
      <SectionTitle
        title={card.name}
        hint={`Fecha dia ${card.closingDay} · vence dia ${card.dueDay}${pending.length ? ` · ${money(pending.reduce((a, i) => a + i.open, 0))} em aberto` : ''}`}
        right={<Button variant="soft" size="sm" onClick={onEdit}><Pencil size={15} /> Editar</Button>}
      />
      {shown.length === 0 ? <p className="py-4 text-center text-sm text-muted">Nenhuma fatura em aberto. Lance uma compra escolhendo este cartão.</p> : (
        <div className="space-y-2">
          {shown.map((inv) => (
            <div key={inv.due} className="rounded-2xl border border-line">
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === inv.due ? null : inv.due)}>
                <span className="inline-block h-9 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-bold">Vence {fullDate(inv.due)}</span>
                    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', statusLabel[inv.status].cls)}>{statusLabel[inv.status].label}</span>
                  </span>
                  <span className="block text-xs text-muted">
                    {inv.items.length} compra(s) · {inv.status === 'open' ? `fecha ${relativeDay(inv.closing, today)} (${shortDate(inv.closing)})` : inv.status === 'closed' ? `vence ${relativeDay(inv.due, today)}` : 'quitada'}
                  </span>
                </span>
                <span className="num shrink-0 text-right font-bold">{money(inv.status === 'paid' ? inv.total : inv.open)}</span>
                <ChevronRight size={16} className={clsx('shrink-0 text-muted transition', open === inv.due && 'rotate-90')} />
              </button>
              {open === inv.due && (
                <div className="border-t border-line px-2 pb-3">
                  <div className="divide-y divide-line">
                    {inv.items.map((e) => (
                      <EntryRow key={e.id} entry={e} category={e.categoryId ? catMap.get(e.categoryId) : undefined} today={today}
                        onOpen={() => openEntry(e)} onToggle={() => m.toggle(e)} />
                    ))}
                  </div>
                  {inv.status !== 'paid' && (
                    <Button className="mt-3 w-full" onClick={() => pay(inv)}>Pagar fatura · {money(inv.open)}</Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {paid.length > 0 && (
        <button className="mt-3 text-sm font-semibold text-muted hover:text-fg" onClick={() => setShowPaid((v) => !v)}>
          {showPaid ? 'Esconder faturas pagas' : `Ver faturas pagas · ${paid.length}`}
        </button>
      )}
    </section>
  )
}

function CardForm({ card, onDone }: { card: Card | null; onDone: () => void }) {
  const { workspace } = useSession()
  const m = useCardMutations(workspace.id)
  const [name, setName] = useState(card?.name ?? '')
  const [closing, setClosing] = useState(String(card?.closingDay ?? ''))
  const [due, setDue] = useState(String(card?.dueDay ?? ''))
  const [color, setColor] = useState(card?.color ?? 7)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const err = m.create.error?.message ?? m.update.error?.message ?? m.remove.error?.message
  const days = (s: string) => s.replace(/\D/g, '').slice(0, 2)
  const valid = name.trim() && Number(closing) >= 1 && Number(closing) <= 31 && Number(due) >= 1 && Number(due) <= 31

  const save = async () => {
    const body: CardInput = { name, closingDay: Number(closing), dueDay: Number(due), color, archived: false }
    if (card) await m.update.mutateAsync({ id: card.id, ...body })
    else await m.create.mutateAsync(body)
    onDone()
  }

  return (
    <div className="space-y-5 pt-1">
      <input className="field" placeholder="Nome (ex.: Nubank, Inter)" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!card} />
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Dia do fechamento</label><input className="field num" inputMode="numeric" value={closing} onChange={(e) => setClosing(days(e.target.value))} /></div>
        <div><label className="label">Dia do vencimento</label><input className="field num" inputMode="numeric" value={due} onChange={(e) => setDue(days(e.target.value))} /></div>
      </div>
      <p className="-mt-2 text-xs text-muted">Compras feitas no dia do fechamento ou depois vão para a fatura seguinte. Mudar os dias vale para compras novas.</p>
      <ColorPicker value={color} onChange={setColor} />
      {err && <p className="text-sm font-semibold text-expense-text">{err}</p>}
      <Button size="lg" className="w-full" disabled={!valid} loading={m.create.isPending || m.update.isPending} onClick={save}>{card ? 'Salvar' : 'Cadastrar cartão'}</Button>
      {card && (!confirmDelete ? (
        <Button variant="ghost" className="w-full text-expense-text" onClick={() => setConfirmDelete(true)}>Excluir cartão</Button>
      ) : (
        <div className="space-y-2 rounded-3xl border border-line p-4">
          <p className="text-sm">As compras continuam lançadas, com o mesmo vencimento — só deixam de aparecer como fatura deste cartão.</p>
          <div className="flex gap-2">
            <Button variant="danger" loading={m.remove.isPending} onClick={() => m.remove.mutate(card.id, { onSuccess: onDone })}>Excluir</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
          </div>
        </div>
      ))}
    </div>
  )
}
