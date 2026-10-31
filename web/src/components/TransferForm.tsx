import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { useCategories, useTransfer } from '../lib/api'
import { todayISO } from '../lib/dates'
import { money, parseMoney } from '../lib/format'
import { useSession } from '../lib/session'
import { Toggle, Button } from './ui'

/**
 * Transferência entre espaços (pró-labore, distribuição de lucro, aporte do sócio): cria a despesa na
 * origem e a receita no destino de uma vez. Exige conexão; depois cada lado é um lançamento comum.
 */
export function TransferForm({ onDone }: { onDone: () => void }) {
  const { me, workspace } = useSession()
  const t = useTransfer()
  const others = me.workspaces.filter((w) => w.id !== workspace.id)
  const [from, setFrom] = useState(workspace.id)
  const [to, setTo] = useState(others[0]?.id ?? '')
  const [description, setDescription] = useState(workspace.kind === 'Business' ? 'Pró-labore' : '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [paid, setPaid] = useState(true)
  const [fromCat, setFromCat] = useState('')
  const [toCat, setToCat] = useState('')
  const fromCats = (useCategories(from).data ?? []).filter((c) => c.kind === 'Expense' && !c.archived)
  const toCats = (useCategories(to).data ?? []).filter((c) => c.kind === 'Income' && !c.archived)
  const cents = parseMoney(amount)
  const name = (id: string) => me.workspaces.find((w) => w.id === id)?.name ?? ''

  const swap = () => { setFrom(to); setTo(from); setFromCat(''); setToCat('') }

  const save = () => t.mutate(
    { fromWorkspaceId: from, toWorkspaceId: to, description, amountCents: cents, date, paid, fromCategoryId: fromCat || null, toCategoryId: toCat || null },
    { onSuccess: onDone },
  )

  return (
    <div className="space-y-5 pt-1">
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <label className="label">De</label>
          <select className="field" value={from} onChange={(e) => { setFrom(e.target.value); setFromCat(''); if (e.target.value === to) setTo(me.workspaces.find((w) => w.id !== e.target.value)?.id ?? '') }}>
            {me.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <button type="button" onClick={swap} aria-label="Inverter" className="mb-1 grid size-10 place-items-center rounded-xl bg-surface-2 hover:bg-surface-3"><ArrowRight size={18} /></button>
        <div>
          <label className="label">Para</label>
          <select className="field" value={to} onChange={(e) => { setTo(e.target.value); setToCat('') }}>
            {me.workspaces.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Valor</label><input className="field num" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className="label">Data</label><input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div><label className="label">Descrição</label><input className="field" placeholder="Ex.: Pró-labore outubro" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Pote em {name(from)}</label>
          <select className="field" value={fromCat} onChange={(e) => setFromCat(e.target.value)}>
            <option value="">—</option>
            {fromCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Pote em {name(to)}</label>
          <select className="field" value={toCat} onChange={(e) => setToCat(e.target.value)}>
            <option value="">—</option>
            {toCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="rounded-3xl border border-line px-4"><Toggle checked={paid} onChange={setPaid} label="Já foi transferido" /></div>
      {cents > 0 && to && (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
          Cria uma <b>despesa</b> de {money(cents)} em <b>{name(from)}</b> e uma <b>receita</b> igual em <b>{name(to)}</b>{paid ? ', já pagas' : ', em aberto'}.
        </p>
      )}
      {t.error && <p className="text-sm font-semibold text-expense-text">{t.error.message}</p>}
      <Button size="lg" className="w-full" loading={t.isPending} disabled={!to || cents <= 0 || !description.trim()} onClick={save}>Transferir</Button>
    </div>
  )
}
