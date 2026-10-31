import clsx from 'clsx'
import { Paperclip, Repeat, Target, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCategories, useEntryMutations, useGoals } from '../lib/api'
import { useOnline } from '../lib/network'
import { catColor } from '../lib/analytics'
import { addDays, fullDate, todayISO } from '../lib/dates'
import { frequencyLabel, methodLabel, money, parseMoney } from '../lib/format'
import { useSession, type EntryPreset } from '../lib/session'
import type { Entry, EntryInput, Frequency, Kind, Method } from '../lib/types'
import { Button, CategoryBadge, Segmented, Sheet, Toggle } from './ui'

type RepeatMode = 'once' | 'recurring' | 'installments'

const centsToInput = (c: number) => (c ? (c / 100).toFixed(2).replace('.', ',') : '')

export function EntrySheet() {
  const { entrySheet, closeEntry } = useSession()
  // Remonta a cada abertura para o formulário começar limpo.
  const [nonce, setNonce] = useState(0)
  useEffect(() => { if (entrySheet.open) setNonce((n) => n + 1) }, [entrySheet.open])
  return (
    <Sheet open={entrySheet.open} onClose={closeEntry} title={entrySheet.entry ? 'Editar lançamento' : 'Novo lançamento'}>
      <EntryForm key={nonce} entry={entrySheet.entry} initialKind={entrySheet.kind} preset={entrySheet.preset} onDone={closeEntry} />
    </Sheet>
  )
}

function EntryForm({ entry, initialKind, preset, onDone }: { entry: Entry | null; initialKind: Kind; preset?: EntryPreset; onDone: () => void }) {
  const { workspace } = useSession()
  const categories = useCategories(workspace.id).data ?? []
  const goals = useGoals(workspace.id).data ?? []
  const m = useEntryMutations(workspace.id)
  const today = todayISO()

  const [kind, setKind] = useState<Kind>(entry?.kind ?? initialKind)
  const [amount, setAmount] = useState(centsToInput(entry?.amountCents ?? 0))
  const [description, setDescription] = useState(entry?.description ?? preset?.description ?? '')
  const [dueDate, setDueDate] = useState(entry?.dueDate ?? today)
  const [categoryId, setCategoryId] = useState<string | null>(entry?.categoryId ?? preset?.categoryId ?? null)
  const [goalId, setGoalId] = useState<string | null>(entry?.goalId ?? preset?.goalId ?? null)
  const [counterparty, setCounterparty] = useState(entry?.counterparty ?? '')
  const [method, setMethod] = useState<Method | ''>(entry?.method ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [paid, setPaid] = useState(entry ? !!entry.paidDate : !!preset?.paid)
  const [paidDate, setPaidDate] = useState(entry?.paidDate ?? today)
  const [paidAmount, setPaidAmount] = useState(centsToInput(entry?.paidAmountCents ?? 0))
  const [offCash, setOffCash] = useState(!!entry?.offCash)
  const [offCashSource, setOffCashSource] = useState(entry?.offCashSource ?? '')
  const [repeat, setRepeat] = useState<RepeatMode>('once')
  const [frequency, setFrequency] = useState<Frequency>('Monthly')
  const [interval, setInterval] = useState(1)
  const [count, setCount] = useState(12)
  const [endDate, setEndDate] = useState('')
  const [scope, setScope] = useState<'single' | 'future'>('single')
  const [file, setFile] = useState<File | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cats = useMemo(() => categories.filter((c) => c.kind === kind && (!c.archived || c.id === categoryId)), [categories, kind, categoryId])
  const amountCents = parseMoney(amount)
  const isSeries = !!entry?.recurrenceId && !entry.recurrenceId.startsWith('pending:')
  const online = useOnline()
  const [busy, setBusy] = useState(false)

  const switchKind = (k: Kind) => { setKind(k); setCategoryId(null) }

  const submit = async () => {
    setError(null)
    if (!description.trim()) return setError('Dê um nome ao lançamento.')
    if (amountCents <= 0) return setError('Informe o valor.')
    if (!entry && repeat === 'recurring' && endDate && endDate < dueDate) return setError('O fim da recorrência é antes do primeiro vencimento.')
    const body: EntryInput = {
      kind, description, amountCents, dueDate, categoryId, goalId: kind === 'Expense' ? goalId : null,
      counterparty: counterparty || null, method: method || null, notes: notes || null,
      paid, paidDate: paid ? paidDate : null, paidAmountCents: paid ? parseMoney(paidAmount) || null : null,
      offCash: paid && offCash,
      offCashSource: paid && offCash ? offCashSource.trim() || null : null,
      repeat: entry || repeat === 'once' ? null : {
        frequency: repeat === 'installments' ? 'Monthly' : frequency,
        interval: repeat === 'installments' ? 1 : interval,
        count: repeat === 'installments' ? count : null,
        endDate: repeat === 'recurring' && endDate ? endDate : null,
      },
    }
    // Otimista: a tela já mostra o lançamento; a fila envia (agora ou quando a rede voltar).
    let id = entry?.id
    let synced: Promise<unknown> = Promise.resolve()
    if (entry) m.update(entry.id, body, scope)
    else { const r = m.create(body); id = r.id; synced = r.promise }
    if (!file) return onDone()

    // Comprovante precisa do lançamento já no servidor.
    setBusy(true)
    try {
      await synced
      await m.attach.mutateAsync({ id: id!, file })
      onDone()
    } catch (e) {
      setError(`Lançamento salvo, mas o comprovante falhou: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = (s: 'single' | 'future') => {
    if (!entry) return
    m.remove(entry.id, s)
    onDone()
  }

  const accent = kind === 'Income' ? 'var(--income)' : 'var(--expense)'

  return (
    <div className="space-y-5 pt-1">
      <Segmented
        value={kind}
        onChange={switchKind}
        options={[{ value: 'Expense', label: 'Despesa · a pagar' }, { value: 'Income', label: 'Receita · a receber' }]}
      />

      {/* Valor em destaque */}
      <div className="rounded-3xl p-5 text-center" style={{ background: `color-mix(in oklab, ${accent} 10%, transparent)` }}>
        <label htmlFor="amount" className="text-xs font-bold uppercase tracking-wider text-muted">Valor</label>
        <div className="mt-1 flex items-baseline justify-center gap-1.5">
          <span className="display text-2xl font-semibold text-muted">R$</span>
          <input
            id="amount"
            inputMode="decimal"
            autoFocus={!entry}
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d,.]/g, ''))}
            onBlur={() => amountCents && setAmount(centsToInput(amountCents))}
            style={{ width: `${Math.max(4, amount.length) + 0.5}ch` }}
            className="display num max-w-[11ch] bg-transparent text-left text-5xl font-bold outline-none placeholder:text-faint"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="desc">Descrição</label>
        <input id="desc" className="field" placeholder={kind === 'Expense' ? 'Ex.: Aluguel, Figma, Mercado' : 'Ex.: Projeto site X, Salário'} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="due">{isSeries || repeat !== 'once' ? '1º vencimento' : 'Vencimento'}</label>
          <input id="due" type="date" className="field" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Atalhos</label>
          <div className="flex h-12 gap-1.5">
            {[['Hoje', 0], ['+7d', 7], ['+30d', 30]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => setDueDate(addDays(today, d as number))} className="flex-1 rounded-xl bg-surface-2 text-sm font-semibold text-fg-2 hover:bg-surface-3">{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Pote */}
      <div>
        <label className="label">Pote</label>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
              className={clsx('inline-flex h-10 items-center gap-2 rounded-full border pl-1 pr-3.5 text-sm font-semibold transition',
                categoryId === c.id ? 'border-fg bg-surface-2' : 'border-line hover:border-line-strong')}
            >
              <CategoryBadge icon={c.icon} color={catColor(c)} size={30} />
              {c.name}
            </button>
          ))}
          {cats.length === 0 && <p className="text-sm text-muted">Nenhum pote ainda — crie em Potes.</p>}
        </div>
      </div>

      {/* Objetivo (só despesas) */}
      {kind === 'Expense' && goals.some((g) => !g.archived || g.id === goalId) && (
        <div>
          <label className="label flex items-center gap-1.5"><Target size={13} /> Conta para um objetivo?</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setGoalId(null)}
              className={clsx('h-10 rounded-full border px-3.5 text-sm font-semibold transition', !goalId ? 'border-fg bg-surface-2' : 'border-line hover:border-line-strong')}>
              Nenhum
            </button>
            {goals.filter((g) => !g.archived || g.id === goalId).map((g) => (
              <button key={g.id} type="button" onClick={() => setGoalId(goalId === g.id ? null : g.id)}
                className={clsx('inline-flex h-10 items-center gap-2 rounded-full border pl-1 pr-3.5 text-sm font-semibold transition',
                  goalId === g.id ? 'border-fg bg-surface-2' : 'border-line hover:border-line-strong')}>
                <CategoryBadge icon={g.icon} color={`var(--cat-${g.color})`} size={30} />
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Repetição (só na criação) */}
      {!entry && (
        <div className="rounded-3xl border border-line p-4">
          <label className="label flex items-center gap-1.5"><Repeat size={13} /> Repetição</label>
          <Segmented
            value={repeat}
            onChange={setRepeat}
            options={[{ value: 'once', label: 'Única' }, { value: 'recurring', label: 'Recorrente' }, { value: 'installments', label: 'Parcelada' }]}
          />
          {repeat === 'recurring' && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Frequência</label>
                <select className="field" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                  <option value="Weekly">Semanal</option>
                  <option value="Monthly">Mensal</option>
                  <option value="Yearly">Anual</option>
                </select>
              </div>
              <div>
                <label className="label">A cada</label>
                <input type="number" min={1} max={24} className="field" value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} />
              </div>
              <div className="col-span-2">
                <label className="label">Termina em (opcional)</label>
                <input type="date" className="field" value={endDate} min={dueDate} onChange={(e) => setEndDate(e.target.value)} />
                <p className="mt-1.5 text-xs text-muted">{frequencyLabel(frequency, interval)}{endDate ? ` até ${fullDate(endDate)}` : ', sem data para acabar'}. Geramos os próximos 12 meses automaticamente.</p>
              </div>
            </div>
          )}
          {repeat === 'installments' && (
            <div className="mt-4">
              <label className="label">Número de parcelas (mensais)</label>
              <input type="number" min={2} max={600} className="field" value={count} onChange={(e) => setCount(Math.max(2, Number(e.target.value) || 2))} />
              {amountCents > 0 && <p className="mt-1.5 text-xs text-muted">{count}× de {money(amountCents)} = <b className="text-fg-2">{money(amountCents * count)}</b></p>}
            </div>
          )}
        </div>
      )}

      {isSeries && (
        <div className="rounded-3xl border border-line p-4">
          <label className="label flex items-center gap-1.5"><Repeat size={13} /> Parte de uma série {entry?.seriesCount ? `· ${entry.sequence}/${entry.seriesCount}` : ''}</label>
          <Segmented value={scope} onChange={setScope} options={[{ value: 'single', label: 'Só esta' }, { value: 'future', label: 'Esta e as próximas' }]} />
        </div>
      )}

      <div className="rounded-3xl border border-line px-4 py-1">
        <Toggle checked={paid} onChange={setPaid} label={kind === 'Expense' ? 'Já está paga' : 'Já foi recebida'} />
        {paid && (
          <div className="grid grid-cols-2 gap-3 pb-4">
            <div>
              <label className="label">Data</label>
              <input type="date" className="field" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Valor efetivo</label>
              <input inputMode="decimal" className="field" placeholder={centsToInput(amountCents) || '0,00'} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
            </div>
          </div>
        )}
        {paid && (
          <div className="border-t border-line pb-3">
            <Toggle checked={offCash} onChange={setOffCash} label={kind === 'Expense' ? 'Paga com dinheiro de fora' : 'Recebida em outra conta'} />
            <p className="-mt-1 text-xs text-muted">
              {offCash
                ? kind === 'Expense'
                  ? `Conta como paga, mas não sai do caixa de ${workspace.name} (ex.: você pagou do seu bolso).`
                  : `Conta como recebida, mas não entra no caixa de ${workspace.name}.`
                : kind === 'Expense' ? `Sai do caixa de ${workspace.name}.` : `Entra no caixa de ${workspace.name}.`}
            </p>
            {offCash && (
              <div className="mt-3">
                <label className="label" htmlFor="offcash-source">{kind === 'Expense' ? 'De onde saiu o dinheiro?' : 'Em qual conta caiu?'}</label>
                <input id="offcash-source" className="field" maxLength={120} value={offCashSource} onChange={(e) => setOffCashSource(e.target.value)}
                  placeholder="Opcional · ex.: Conta pessoal Nubank" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{kind === 'Expense' ? 'Fornecedor' : 'Cliente / fonte'}</label>
          <input className="field" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Opcional" />
        </div>
        <div>
          <label className="label">Forma</label>
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value as Method | '')}>
            <option value="">—</option>
            {(Object.keys(methodLabel) as Method[]).map((k) => <option key={k} value={k}>{methodLabel[k]}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="label">Observações</label>
        <textarea className="field min-h-20 resize-none" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </div>

      {/* Comprovante */}
      <div>
        <label className="label">Comprovante / recibo</label>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {entry?.attachmentName && !file ? (
          <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-2 pl-4">
            <Paperclip size={16} className="text-muted" />
            <a className="flex-1 truncate text-sm font-semibold underline-offset-2 hover:underline" href={`/api/w/${workspace.id}/entries/${entry.id}/attachment`} target="_blank" rel="noreferrer">{entry.attachmentName}</a>
            <Button variant="ghost" size="sm" type="button" onClick={() => fileRef.current?.click()}>Trocar</Button>
            <Button variant="ghost" size="sm" type="button" onClick={() => m.detach.mutate(entry.id)} aria-label="Remover comprovante"><X size={16} /></Button>
          </div>
        ) : (
          <button type="button" disabled={!online} onClick={() => fileRef.current?.click()} className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 text-sm font-semibold text-fg-2 hover:bg-surface-2 disabled:opacity-50">
            <Paperclip size={16} /> {file ? file.name : online ? 'Anexar foto ou PDF' : 'Comprovante precisa de conexão'}
            {file && <X size={16} className="ml-auto" onClick={(e) => { e.stopPropagation(); setFile(null) }} />}
          </button>
        )}
      </div>

      {error && <p className="rounded-2xl bg-[color-mix(in_oklab,var(--critical)_12%,transparent)] px-4 py-3 text-sm font-semibold text-expense-text">{error}</p>}

      <div className="sticky bottom-0 -mx-5 space-y-2 bg-surface px-5 pb-1 pt-2">
        <Button size="lg" className="w-full" loading={busy} onClick={submit}>{entry ? 'Salvar alterações' : 'Adicionar lançamento'}</Button>
        {entry && !confirmDelete && (
          <Button variant="ghost" className="w-full text-expense-text" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Excluir</Button>
        )}
        {entry && confirmDelete && (
          <div className={clsx('grid gap-2', isSeries ? 'grid-cols-2' : 'grid-cols-1')}>
            <Button variant="danger" onClick={() => remove('single')}>{isSeries ? 'Excluir só esta' : 'Confirmar exclusão'}</Button>
            {isSeries && <Button variant="danger" onClick={() => remove('future')}>Esta e as próximas</Button>}
          </div>
        )}
      </div>
    </div>
  )
}
