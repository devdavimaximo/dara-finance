import clsx from 'clsx'
import { ArrowLeft, CheckCircle2, FileUp, Link2, WifiOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Chip, Empty, Toggle } from '../components/ui'
import { catColor } from '../lib/analytics'
import { useCategories, useImport, type ImportRow } from '../lib/api'
import { fullDate, shortDate } from '../lib/dates'
import { money } from '../lib/format'
import { useOnline } from '../lib/network'
import { useSession } from '../lib/session'

interface Row extends ImportRow {
  selected: boolean
  categoryId: string | null
  /** Concilia com a conta em aberto sugerida (marca como paga) em vez de criar outra. */
  reconcile: boolean
}

type Filter = 'all' | 'new' | 'match' | 'dup'

export function ImportPage() {
  const { workspace } = useSession()
  const online = useOnline()
  const navigate = useNavigate()
  const categories = useCategories(workspace.id).data ?? []
  const imp = useImport(workspace.id)
  const [file, setFile] = useState<File | null>(null)
  const [invert, setInvert] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = (f: File, inv: boolean) => {
    setFile(f)
    imp.preview.mutate({ file: f, invert: inv }, {
      onSuccess: (r) => setRows(r.rows.map((x) => ({ ...x, selected: !x.duplicate, categoryId: x.suggestedCategoryId, reconcile: !!x.match }))),
    })
  }

  const set = (id: string, patch: Partial<Row>) => setRows((rs) => rs!.map((r) => (r.externalId === id ? { ...r, ...patch } : r)))

  const stats = useMemo(() => {
    const rs = rows ?? []
    const sel = rs.filter((r) => r.selected)
    return {
      fresh: rs.filter((r) => !r.duplicate && !r.match).length,
      matches: rs.filter((r) => r.match && !r.duplicate).length,
      dups: rs.filter((r) => r.duplicate).length,
      selected: sel.length,
      inflow: sel.filter((r) => r.kind === 'Income').reduce((a, r) => a + r.amountCents, 0),
      outflow: sel.filter((r) => r.kind === 'Expense').reduce((a, r) => a + r.amountCents, 0),
      uncategorized: sel.filter((r) => !r.categoryId && !(r.reconcile && r.match)).length,
    }
  }, [rows])

  const visible = (rows ?? []).filter((r) =>
    filter === 'all' || (filter === 'new' && !r.duplicate && !r.match) || (filter === 'match' && r.match && !r.duplicate) || (filter === 'dup' && r.duplicate))

  const commit = () => imp.commit.mutate(rows!.filter((r) => r.selected).map((r) => ({
    externalId: r.externalId, date: r.date, amountCents: r.amountCents, kind: r.kind, description: r.description,
    categoryId: r.categoryId, matchEntryId: r.reconcile && r.match ? r.match.entryId : null,
  })))

  const reset = () => { setRows(null); setFile(null); imp.preview.reset(); imp.commit.reset() }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <Link to="/lancamentos" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft size={16} /> Lançamentos</Link>
        <h1 className="display text-3xl font-bold lg:text-4xl">Importar extrato</h1>
        <p className="mt-1 text-muted">OFX ou CSV do banco. Revise antes de importar — nada entra sem você confirmar.</p>
      </header>

      {!online ? (
        <div className="card"><Empty icon={WifiOff} title="Precisa de conexão" hint="A importação lê o arquivo no servidor. Tente de novo quando estiver online." /></div>
      ) : imp.commit.data ? (
        <div className="card p-6 text-center">
          <CheckCircle2 size={44} className="mx-auto text-good" />
          <h2 className="display mt-3 text-2xl font-bold">Extrato importado</h2>
          <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-3">
            <Result label="Novos" value={imp.commit.data.created} />
            <Result label="Conciliados" value={imp.commit.data.reconciled} />
            <Result label="Ignorados" value={imp.commit.data.skipped} />
          </div>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => navigate('/lancamentos')}>Ver lançamentos</Button>
            <Button variant="soft" onClick={reset}>Importar outro</Button>
          </div>
        </div>
      ) : !rows ? (
        <div className="card space-y-5 p-5 lg:p-6">
          <label className={clsx('flex cursor-pointer flex-col items-center rounded-3xl border-2 border-dashed border-line-strong px-6 py-10 text-center transition hover:bg-surface-2', imp.preview.isPending && 'opacity-60')}>
            <input type="file" accept=".ofx,.qfx,.csv,.txt,text/csv,application/x-ofx" className="hidden" disabled={imp.preview.isPending}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f, invert); e.target.value = '' }} />
            <span className="grid size-14 place-items-center rounded-2xl bg-accent text-accent-ink"><FileUp size={26} /></span>
            <span className="display mt-4 text-lg font-semibold">{imp.preview.isPending ? 'Lendo extrato…' : 'Escolher arquivo'}</span>
            <span className="mt-1 text-sm text-muted">.ofx ou .csv · até 5 MB</span>
          </label>
          <div className="rounded-3xl border border-line px-4"><Toggle checked={invert} onChange={setInvert} label="É fatura de cartão (gastos vêm positivos)" /></div>
          {imp.preview.error && <p className="text-sm font-semibold text-expense-text">{imp.preview.error.message}</p>}
          <div className="text-sm text-muted">
            <p className="mb-2 font-bold text-fg-2">Onde exportar</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b className="text-fg-2">Nubank</b>: app → Extrato (ou Fatura) → ícone de compartilhar → exportar OFX/CSV.</li>
              <li><b className="text-fg-2">Inter, Itaú, Bradesco, BB, Caixa, Santander</b>: internet banking → Extrato → salvar como OFX (às vezes "Money" ou "Quicken").</li>
              <li>O mesmo arquivo pode ser enviado de novo: o que já foi importado é reconhecido e ignorado.</li>
            </ul>
          </div>
        </div>
      ) : (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-bold">{file?.name}</p>
              <p className="text-sm text-muted">{rows.length} transações · {stats.fresh} novas · {stats.matches} conciliam · {stats.dups} já importadas</p>
            </div>
            <div className="flex gap-2">
              <Button variant="soft" size="sm" onClick={() => { setInvert(!invert); load(file!, !invert) }}>Inverter sinais</Button>
              <Button variant="ghost" size="sm" onClick={reset}>Trocar arquivo</Button>
            </div>
          </div>

          <div className="scroll-x -mx-4 flex gap-2 px-4 sm:mx-0 sm:px-0">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Todas · {rows.length}</Chip>
            <Chip active={filter === 'new'} onClick={() => setFilter('new')}>Novas · {stats.fresh}</Chip>
            <Chip active={filter === 'match'} onClick={() => setFilter('match')}>Conciliação · {stats.matches}</Chip>
            <Chip active={filter === 'dup'} onClick={() => setFilter('dup')}>Já importadas · {stats.dups}</Chip>
            <Chip onClick={() => setRows(rows.map((r) => ({ ...r, selected: !r.duplicate })))}>Marcar todas</Chip>
            <Chip onClick={() => setRows(rows.map((r) => ({ ...r, selected: false })))}>Desmarcar</Chip>
          </div>

          <div className="card divide-y divide-line">
            {visible.map((r) => {
              const cats = categories.filter((c) => c.kind === r.kind && !c.archived)
              const cat = categories.find((c) => c.id === r.categoryId)
              return (
                <div key={r.externalId} className={clsx('flex gap-3 p-3.5 sm:p-4', (r.duplicate || !r.selected) && 'opacity-55')}>
                  <input
                    type="checkbox"
                    aria-label="Importar esta transação"
                    className="mt-1 size-5 shrink-0 accent-[var(--fg)]"
                    checked={r.selected}
                    disabled={r.duplicate}
                    onChange={(e) => set(r.externalId, { selected: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{r.description}</p>
                        <p className="text-xs text-muted">{fullDate(r.date)}{r.duplicate && ' · já importada'}</p>
                      </div>
                      <span className={clsx('num shrink-0 font-bold', r.kind === 'Income' ? 'text-income-text' : 'text-fg')}>
                        {r.kind === 'Income' ? '+' : '−'}{money(r.amountCents)}
                      </span>
                    </div>
                    {!r.duplicate && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {r.match && (
                          <button
                            onClick={() => set(r.externalId, { reconcile: !r.reconcile })}
                            className={clsx('inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-xs font-bold transition',
                              r.reconcile ? 'bg-[color-mix(in_oklab,var(--good)_16%,transparent)] text-good-text' : 'bg-surface-2 text-muted line-through')}
                            title={r.reconcile ? 'Toque para criar um lançamento novo em vez de conciliar' : 'Toque para conciliar'}
                          >
                            <Link2 size={13} className="shrink-0" />
                            <span className="truncate">Paga “{r.match.description}” · venc. {shortDate(r.match.dueDate)}</span>
                          </button>
                        )}
                        {!(r.reconcile && r.match) && (
                          <span className="relative inline-flex items-center">
                            <span className="pointer-events-none absolute left-2.5 size-2.5 rounded-full" style={{ background: catColor(cat) }} />
                            <select
                              aria-label="Pote"
                              className="h-8 rounded-full border border-line bg-surface-2 pl-7 pr-3 text-xs font-semibold"
                              value={r.categoryId ?? ''}
                              onChange={(e) => set(r.externalId, { categoryId: e.target.value || null })}
                            >
                              <option value="">Sem pote</option>
                              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {visible.length === 0 && <p className="p-6 text-center text-sm text-muted">Nada neste filtro.</p>}
          </div>

          <div className="pb-safe sticky bottom-20 z-20 lg:bottom-4">
            <div className="card flex flex-wrap items-center justify-between gap-3 p-3 pl-4 shadow-xl">
              <div className="text-sm">
                <p className="font-bold">{stats.selected} selecionada(s)</p>
                <p className="num text-xs text-muted">
                  <span className="text-income-text">+{money(stats.inflow)}</span> · −{money(stats.outflow)}
                  {stats.uncategorized > 0 && ` · ${stats.uncategorized} sem pote`}
                </p>
              </div>
              <Button loading={imp.commit.isPending} disabled={stats.selected === 0} onClick={commit}>Importar</Button>
            </div>
            {imp.commit.error && <p className="mt-2 text-sm font-semibold text-expense-text">{imp.commit.error.message}</p>}
          </div>
        </>
      )}
    </div>
  )
}

const Result = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl bg-surface-2 p-3">
    <p className="display text-2xl font-bold">{value}</p>
    <p className="text-xs font-semibold text-muted">{label}</p>
  </div>
)
