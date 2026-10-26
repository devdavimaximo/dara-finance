import clsx from 'clsx'
import { Building2, Check, Copy, KeyRound, LogOut, RefreshCw, Repeat, Trash2, User, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useOnline } from '../lib/network'
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from '../lib/push'
import { Button, Segmented, Sheet, Spinner, Toggle } from '../components/ui'
import {
  useChangePassword, useCreateWorkspace, useEntryMutations, useLogout, useMemberMutations,
  useMembers, useNotifyMutations, useNotifySettings, useRecurrences, useUpdateWorkspace, useUserMutations, useUsers,
} from '../lib/api'
import { fullDate } from '../lib/dates'
import { frequencyLabel, initials, money, parseMoney } from '../lib/format'
import { getTheme, setTheme, useSession, type Theme } from '../lib/session'
import type { Kind, UserAccount, WorkspaceKind } from '../lib/types'

export function SettingsPage() {
  const { me, workspace } = useSession()
  const owner = workspace.role === 'Owner'
  const online = useOnline()
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-sm font-semibold text-muted">{workspace.name}</p>
        <h1 className="display text-3xl font-bold lg:text-4xl">Ajustes</h1>
      </header>
      {!online && <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm font-semibold text-fg-2">Sem conexão: os ajustes ficam só para leitura até a rede voltar.</p>}
      <NotificationsCard />
      {owner && <WorkspaceCard />}
      <RecurrencesCard />
      <MembersCard />
      {me.canCreateWorkspaces && <NewWorkspaceCard />}
      {me.isAdmin && <UsersCard />}
      <AccountCard />
    </div>
  )
}

function Card({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-5 lg:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="display text-lg font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

const Msg = ({ ok, err }: { ok?: string | false; err?: string | null }) =>
  err ? <p className="text-sm font-semibold text-expense-text">{err}</p> : ok ? <p className="text-sm font-semibold text-good-text">{ok}</p> : null

// ---------------------------------------------------------------- avisos

function NotificationsCard() {
  const q = useNotifySettings()
  const { save, test, done } = useNotifyMutations()
  const online = useOnline()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const supported = pushSupported()
  const iosNeedsInstall = isIos() && !isStandalone()

  useEffect(() => { currentSubscription().then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false)) }, [])

  const toggleDevice = async (on: boolean) => {
    setBusy(true); setErr(null)
    try {
      if (on) await enablePush(); else await disablePush()
      setSubscribed(on)
      done()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const s = q.data
  const update = (patch: Partial<NonNullable<typeof s>>) => s && save.mutate({ ...s, ...patch })

  return (
    <Card title="Avisos de vencimento" hint="Um resumo por dia no celular: o que vence hoje e nos próximos dias, de todos os seus espaços.">
      {!supported ? (
        <p className="text-sm text-muted">Este navegador não suporta notificações.</p>
      ) : iosNeedsInstall ? (
        <p className="rounded-2xl bg-surface-2 p-4 text-sm text-fg-2">No iPhone, primeiro instale o app: Safari → <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b> (iOS 16.4+). Depois abra pelo ícone e volte aqui.</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-3xl border border-line px-4">
            <Toggle checked={!!subscribed} onChange={(v) => !busy && online && toggleDevice(v)} label={busy ? 'Configurando…' : 'Receber neste aparelho'} />
          </div>
          {s && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Horário</label>
                <select className="field" value={s.hour} disabled={!online} onChange={(e) => update({ hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
              <div>
                <label className="label">Antecedência</label>
                <select className="field" value={s.daysAhead} disabled={!online} onChange={(e) => update({ daysAhead: Number(e.target.value) })}>
                  <option value={0}>Só no dia</option>
                  <option value={1}>1 dia antes</option>
                  <option value={3}>3 dias antes</option>
                  <option value={7}>1 semana antes</option>
                </select>
              </div>
            </div>
          )}
          {s && <div className="rounded-3xl border border-line px-4"><Toggle checked={s.enabled} onChange={(v) => online && update({ enabled: v })} label="Avisos ligados (todos os aparelhos)" /></div>}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="soft" disabled={!subscribed || !online} loading={test.isPending} onClick={() => test.mutate()}>Enviar teste agora</Button>
            {s && <span className="text-xs text-muted">{s.devices} aparelho(s) inscrito(s)</span>}
          </div>
          <Msg ok={test.isSuccess && `Enviado: “${test.data.title}”`} err={err ?? test.error?.message ?? null} />
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- espaço

function WorkspaceCard() {
  const { workspace } = useSession()
  const update = useUpdateWorkspace(workspace.id)
  const [name, setName] = useState(workspace.name)
  const [balance, setBalance] = useState((workspace.openingBalanceCents / 100).toFixed(2).replace('.', ','))
  const [date, setDate] = useState(workspace.openingBalanceDate)
  const negative = balance.trim().startsWith('-')
  return (
    <Card title="Espaço" hint="O saldo inicial é o que havia na conta na data escolhida. Daí em diante o caixa é calculado pelos pagamentos.">
      <div className="space-y-4">
        <div><label className="label">Nome</label><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Saldo inicial (R$)</label><input className="field" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></div>
          <div><label className="label">Na data</label><input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-3">
          <Button loading={update.isPending} onClick={() => update.mutate({ name, openingBalanceCents: (negative ? -1 : 1) * parseMoney(balance), openingBalanceDate: date })}>Salvar</Button>
          <Msg ok={update.isSuccess && 'Salvo.'} err={update.error?.message} />
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- recorrências

function RecurrencesCard() {
  const { workspace } = useSession()
  const q = useRecurrences(workspace.id)
  const m = useEntryMutations(workspace.id)
  const [confirm, setConfirm] = useState<string | null>(null)
  const active = (q.data ?? []).filter((r) => !r.finished)
  const done = (q.data ?? []).filter((r) => r.finished)
  const monthlyLoad = (k: Kind) => active.filter((r) => r.kind === k).reduce((a, r) => {
    const perMonth = r.frequency === 'Monthly' ? 1 / r.interval : r.frequency === 'Weekly' ? 52 / 12 / r.interval : 1 / 12 / r.interval
    return a + r.amountCents * perMonth
  }, 0)
  return (
    <Card title="Recorrências e parcelamentos" hint={`Ativas custam ~${money(monthlyLoad('Expense'))}/mês e rendem ~${money(monthlyLoad('Income'))}/mês.`}>
      {q.isLoading ? <Spinner /> : active.length + done.length === 0 ? <p className="text-sm text-muted">Nenhuma ainda. Ao lançar, escolha "Recorrente" ou "Parcelada".</p> : (
        <div className="divide-y divide-line">
          {[...active, ...done].map((r) => (
            <div key={r.id} className={clsx('flex items-center gap-3 py-3', r.finished && 'opacity-55')}>
              <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', r.kind === 'Income' ? 'bg-[color-mix(in_oklab,var(--income)_16%,transparent)] text-income-text' : 'bg-[color-mix(in_oklab,var(--expense)_16%,transparent)] text-expense-text')}><Repeat size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.description}</p>
                <p className="truncate text-xs text-muted">
                  {r.count ? `${r.count}× parcelas` : frequencyLabel(r.frequency, r.interval)} · {r.paidCount} pagas · {r.openCount} em aberto
                  {r.nextDue ? ` · próxima ${fullDate(r.nextDue)}` : ''}{r.finished ? ' · encerrada' : ''}
                </p>
              </div>
              <span className={clsx('num shrink-0 font-bold', r.kind === 'Income' && 'text-income-text')}>{money(r.amountCents)}</span>
              {!r.finished && (confirm === r.id ? (
                <Button size="sm" variant="danger" loading={m.stopSeries.isPending} onClick={() => m.stopSeries.mutate(r.id, { onSuccess: () => setConfirm(null) })}>Encerrar</Button>
              ) : (
                <button aria-label="Encerrar série" title="Encerrar (apaga as futuras em aberto)" onClick={() => setConfirm(r.id)} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-2"><Trash2 size={16} /></button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- pessoas

function MembersCard() {
  const { workspace, me, setWorkspace } = useSession()
  const owner = workspace.role === 'Owner'
  const q = useMembers(workspace.id)
  const { add, role, remove } = useMemberMutations(workspace.id)
  const [email, setEmail] = useState('')
  const [newRole, setNewRole] = useState<'Owner' | 'Member'>('Member')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const members = q.data ?? []
  const owners = members.filter((m) => m.role === 'Owner').length
  const meAsMember = members.find((m) => m.userId === me.id)
  const lastOwner = meAsMember?.role === 'Owner' && owners <= 1
  const error = add.error?.message ?? role.error?.message ?? remove.error?.message

  const leave = () => remove.mutate(me.id, {
    onSuccess: () => { const other = me.workspaces.find((w) => w.id !== workspace.id); if (other) setWorkspace(other.id) },
  })

  return (
    <Card title="Pessoas com acesso" hint={`Só quem está aqui enxerga os dados de ${workspace.name}. Todo espaço tem ao menos um responsável.`}>
      <div className="mb-5 divide-y divide-line">
        {members.map((p) => (
          <div key={p.userId} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.name}{p.userId === me.id && <span className="text-muted"> (você)</span>}</p>
              <p className="truncate text-xs text-muted">{p.email}</p>
            </div>
            {owner ? (
              <select
                aria-label={`Papel de ${p.name}`}
                className="h-9 rounded-xl border border-line bg-surface-2 px-2 text-sm font-semibold"
                value={p.role}
                disabled={role.isPending}
                onChange={(e) => role.mutate({ userId: p.userId, role: e.target.value as 'Owner' | 'Member' })}
              >
                <option value="Owner">Responsável</option>
                <option value="Member">Membro</option>
              </select>
            ) : (
              <span className="text-xs font-semibold text-muted">{p.role === 'Owner' ? 'responsável' : 'membro'}</span>
            )}
            {owner && p.userId !== me.id && (
              <button aria-label={`Remover ${p.name}`} onClick={() => remove.mutate(p.userId)} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-2"><Trash2 size={16} /></button>
            )}
          </div>
        ))}
      </div>

      {owner && (
        <div className="mb-4 space-y-3 rounded-3xl border border-line p-4">
          <p className="text-sm font-bold">Dar acesso a uma conta existente</p>
          <input className="field" type="email" placeholder="E-mail da pessoa" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Segmented value={newRole} onChange={setNewRole} options={[{ value: 'Member', label: 'Membro' }, { value: 'Owner', label: 'Responsável' }]} />
          <p className="text-xs text-muted">{me.isAdmin ? 'Conta nova? Crie em Usuários (abaixo) e dê o acesso por lá ou aqui.' : 'A conta precisa existir — contas novas são criadas pelo administrador.'}</p>
          <Button loading={add.isPending} disabled={!email} onClick={() => add.mutate({ email, role: newRole }, { onSuccess: () => setEmail('') })}>Adicionar</Button>
        </div>
      )}

      <Msg err={error} />
      {meAsMember && (
        lastOwner ? (
          <p className="mt-2 text-xs text-muted">Para sair deste espaço, primeiro torne outra pessoa responsável.</p>
        ) : !confirmLeave ? (
          <Button variant="ghost" className="mt-1 text-expense-text" onClick={() => setConfirmLeave(true)}><LogOut size={16} /> Sair deste espaço</Button>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Você perde o acesso a {workspace.name}.</span>
            <Button variant="danger" size="sm" loading={remove.isPending} onClick={leave}>Sair</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(false)}>Cancelar</Button>
          </div>
        )
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- novo espaço

function NewWorkspaceCard() {
  const { me, setWorkspace } = useSession()
  const create = useCreateWorkspace()
  const users = useUsers(me.isAdmin).data ?? []
  const [name, setName] = useState('')
  const [kind, setKind] = useState<WorkspaceKind>('Personal')
  const [ownerId, setOwnerId] = useState('')
  const [createdFor, setCreatedFor] = useState<string | null>(null)
  const forOther = !!ownerId && ownerId !== me.id
  const ownerName = users.find((u) => u.id === ownerId)?.name

  const submit = () => create.mutate({ name, kind, ownerUserId: forOther ? ownerId : null }, {
    onSuccess: (w) => {
      setCreatedFor(forOther ? (ownerName ?? 'a pessoa') : null)
      setName(''); setOwnerId('')
      if (!forOther) setWorkspace(w.id)
    },
  })

  return (
    <Card title="Novo espaço" hint="Separação total: lançamentos, potes, objetivos, pessoas e relatórios próprios. Crie quantos quiser.">
      <div className="space-y-3">
        <Segmented value={kind} onChange={setKind} options={[
          { value: 'Personal', label: <span className="inline-flex items-center gap-1.5"><User size={15} /> Pessoal</span> },
          { value: 'Business', label: <span className="inline-flex items-center gap-1.5"><Building2 size={15} /> Empresa</span> },
        ]} />
        <input className="field" placeholder="Nome do espaço" value={name} onChange={(e) => setName(e.target.value)} />
        {me.isAdmin && users.length > 1 && (
          <div>
            <label className="label">Responsável</label>
            <select className="field" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Eu</option>
              {users.filter((u) => u.id !== me.id && u.active).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
            {forOther && <p className="mt-1.5 text-xs text-muted">O espaço será só de {ownerName}: você não terá acesso a ele.</p>}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button loading={create.isPending} disabled={!name.trim()} onClick={submit}>{forOther ? 'Criar para a pessoa' : 'Criar e abrir'}</Button>
          <Msg ok={createdFor != null && `Espaço criado para ${createdFor}.`} err={create.error?.message} />
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- usuários (admin)

/** Senha provisória legível: sem caracteres ambíguos (0/O, 1/l/I). */
function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function Credentials({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false)
  const text = `Acesso ao dara\nE-mail: ${email}\nSenha provisória: ${password}\nNo primeiro acesso você vai criar a sua senha.`
  return (
    <div className="space-y-3 rounded-3xl bg-[color-mix(in_oklab,var(--good)_12%,transparent)] p-4">
      <p className="text-sm font-bold text-good-text">Envie para a pessoa (só aparece agora):</p>
      <div className="num rounded-2xl bg-surface p-3 text-sm">
        <p>E-mail: <b>{email}</b></p>
        <p>Senha provisória: <b className="tracking-wide">{password}</b></p>
      </div>
      <Button variant="soft" size="sm" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true))}>
        {copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar mensagem</>}
      </Button>
    </div>
  )
}

function UsersCard() {
  const { me } = useSession()
  const q = useUsers(true)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<UserAccount | null>(null)
  return (
    <Card
      title="Usuários"
      hint="Só você (admin) cria contas. Cada pessoa entra com uma senha provisória e cria a própria no primeiro acesso."
      right={<Button size="sm" variant="soft" onClick={() => setCreating(true)}><UserPlus size={16} /> Nova conta</Button>}
    >
      <div className="divide-y divide-line">
        {(q.data ?? []).map((u) => (
          <button key={u.id} onClick={() => u.id !== me.id && setSelected(u)} className={clsx('flex w-full items-center gap-3 py-2.5 text-left', !u.active && 'opacity-55')}>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-bold">{initials(u.name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{u.name}{u.id === me.id && <span className="text-muted"> (você)</span>}</span>
              <span className="block truncate text-xs text-muted">{u.email} · {u.workspaces} espaço(s)</span>
            </span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              {u.isAdmin && <Badge>admin</Badge>}
              {!u.active && <Badge tone="bad">desativada</Badge>}
              {u.active && u.mustChangePassword && <Badge tone="warn">senha provisória</Badge>}
              {!u.isAdmin && u.canCreateWorkspaces && <Badge>cria espaços</Badge>}
            </span>
          </button>
        ))}
      </div>
      <Sheet open={creating} onClose={() => setCreating(false)} title="Nova conta">
        {creating && <NewUserForm onClose={() => setCreating(false)} />}
      </Sheet>
      <Sheet open={selected != null} onClose={() => setSelected(null)} title={selected?.name ?? ''}>
        {selected && <UserActions key={selected.id} user={(q.data ?? []).find((u) => u.id === selected.id) ?? selected} />}
      </Sheet>
    </Card>
  )
}

function Badge({ children, tone }: { children: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold',
      tone === 'bad' ? 'bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] text-expense-text'
        : tone === 'warn' ? 'bg-[color-mix(in_oklab,var(--warning)_20%,transparent)] text-fg'
          : 'bg-surface-3 text-fg-2')}>
      {children}
    </span>
  )
}

function NewUserForm({ onClose }: { onClose: () => void }) {
  const { me } = useSession()
  const { create } = useUserMutations()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(tempPassword)
  const [canCreate, setCanCreate] = useState(false)
  const ownedSpaces = me.workspaces.filter((w) => w.role === 'Owner')
  const [grants, setGrants] = useState<Record<string, '' | 'Owner' | 'Member'>>({})
  const done = create.data

  if (done) return (
    <div className="space-y-4 pt-1">
      <Credentials email={done.email} password={password} />
      <Button className="w-full" onClick={onClose}>Concluir</Button>
    </div>
  )

  const submit = () => create.mutate({
    name, email, password, canCreateWorkspaces: canCreate,
    grants: Object.entries(grants).filter(([, r]) => r).map(([workspaceId, role]) => ({ workspaceId, role: role as 'Owner' | 'Member' })),
  })

  return (
    <div className="space-y-4 pt-1">
      <div><label className="label">Nome</label><input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      <div><label className="label">E-mail (é o login)</label><input className="field" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div>
        <label className="label">Senha provisória</label>
        <div className="flex gap-2">
          <input className="field num" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="soft" type="button" onClick={() => setPassword(tempPassword())} aria-label="Gerar outra"><RefreshCw size={16} /></Button>
        </div>
      </div>
      <div className="rounded-3xl border border-line px-4">
        <Toggle checked={canCreate} onChange={setCanCreate} label="Pode criar espaços próprios (ex.: o pessoal dele)" />
      </div>
      {ownedSpaces.length > 0 && (
        <div>
          <label className="label">Acesso inicial (opcional)</label>
          <div className="space-y-2">
            {ownedSpaces.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 py-1.5 pl-4 pr-1.5">
                <span className="truncate text-sm font-semibold">{w.name}</span>
                <select className="h-9 rounded-xl border border-line bg-surface px-2 text-sm font-semibold" value={grants[w.id] ?? ''}
                  onChange={(e) => setGrants({ ...grants, [w.id]: e.target.value as '' | 'Owner' | 'Member' })}>
                  <option value="">Sem acesso</option>
                  <option value="Member">Membro</option>
                  <option value="Owner">Responsável</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
      <Msg err={create.error?.message} />
      <Button size="lg" className="w-full" loading={create.isPending} disabled={!name.trim() || !email.includes('@') || password.length < 8} onClick={submit}>Criar conta</Button>
    </div>
  )
}

function UserActions({ user }: { user: UserAccount }) {
  const { update, reset } = useUserMutations()
  const [newPassword, setNewPassword] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const err = update.error?.message ?? reset.error?.message

  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm text-muted">{user.email} · {user.workspaces} espaço(s){user.mustChangePassword && ' · ainda não criou a própria senha'}</p>

      {!user.isAdmin && (
        <div className="rounded-3xl border border-line px-4">
          <Toggle checked={user.canCreateWorkspaces} onChange={(v) => update.mutate({ id: user.id, canCreateWorkspaces: v })} label="Pode criar espaços próprios" />
        </div>
      )}

      <div className="space-y-3 rounded-3xl border border-line p-4">
        <p className="text-sm font-bold">Esqueceu a senha?</p>
        <p className="text-xs text-muted">Gera uma senha provisória nova. As sessões abertas da pessoa caem e ela cria outra senha ao entrar.</p>
        {newPassword ? <Credentials email={user.email} password={newPassword} /> : (
          <Button variant="soft" loading={reset.isPending} onClick={() => { const p = tempPassword(); reset.mutate({ id: user.id, password: p }, { onSuccess: () => setNewPassword(p) }) }}>
            <KeyRound size={16} /> Redefinir senha
          </Button>
        )}
      </div>

      {!user.isAdmin && (
        user.active ? (
          !confirmDeactivate ? (
            <Button variant="danger" className="w-full" onClick={() => setConfirmDeactivate(true)}><UserX size={16} /> Desativar conta</Button>
          ) : (
            <div className="space-y-2 rounded-3xl border border-line p-4">
              <p className="text-sm">A pessoa sai na hora de todos os aparelhos e não consegue mais entrar. Os lançamentos ficam.</p>
              <div className="flex gap-2">
                <Button variant="danger" loading={update.isPending} onClick={() => update.mutate({ id: user.id, active: false }, { onSuccess: () => setConfirmDeactivate(false) })}>Desativar</Button>
                <Button variant="ghost" onClick={() => setConfirmDeactivate(false)}>Cancelar</Button>
              </div>
            </div>
          )
        ) : (
          <Button variant="soft" className="w-full" loading={update.isPending} onClick={() => update.mutate({ id: user.id, active: true })}><UserCheck size={16} /> Reativar conta</Button>
        )
      )}
      <Msg err={err} />
    </div>
  )
}

// ---------------------------------------------------------------- conta

function AccountCard() {
  const { me } = useSession()
  const logout = useLogout()
  const pw = useChangePassword()
  const [theme, setT] = useState<Theme>(getTheme())
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  return (
    <Card title="Sua conta" hint={`${me.name} · ${me.email}`}>
      <div className="space-y-5">
        <div>
          <label className="label">Tema</label>
          <Segmented value={theme} onChange={(t) => { setT(t); setTheme(t) }} options={[{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]} />
        </div>
        <div className="space-y-3">
          <label className="label">Trocar senha</label>
          <div className="grid grid-cols-2 gap-3">
            <input className="field" type="password" placeholder="Atual" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className="field" type="password" placeholder="Nova (mín. 8)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="soft" loading={pw.isPending} disabled={!cur || !next} onClick={() => pw.mutate({ current: cur, next }, { onSuccess: () => { setCur(''); setNext('') } })}>Trocar</Button>
            <Msg ok={pw.isSuccess && 'Senha alterada.'} err={pw.error?.message} />
          </div>
        </div>
        <Button variant="danger" className="w-full" loading={logout.isPending} onClick={() => logout.mutate()}><LogOut size={17} /> Sair</Button>
      </div>
    </Card>
  )
}
