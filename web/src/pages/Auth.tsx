import { Building2, User } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Logo } from '../components/Layout'
import { Button, Segmented } from '../components/ui'
import { useChangePassword, useLogin, useLogout, useSetup } from '../lib/api'
import type { WorkspaceKind } from '../lib/types'

export function AuthPage({ mode }: { mode: 'login' | 'setup' }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          {mode === 'login' ? <LoginForm /> : <SetupForm />}
        </div>
      </div>
    </div>
  )
}

function LoginForm() {
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate({ email, password }) }
  return (
    <form onSubmit={submit} className="rise space-y-5">
      <div>
        <h1 className="display text-3xl font-bold">Bem-vindo de volta</h1>
        <p className="mt-1.5 text-muted">Entre para ver para onde o dinheiro está indo.</p>
      </div>
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input id="email" className="field" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="pw">Senha</label>
        <input id="pw" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {login.error && <p className="text-sm font-semibold text-expense-text">{login.error.message}</p>}
      <Button type="submit" size="lg" className="w-full" loading={login.isPending}>Entrar</Button>
    </form>
  )
}

function SetupForm() {
  const setup = useSetup()
  const [f, setF] = useState({ name: '', email: '', password: '', workspaceName: '', workspaceKind: 'Business' as WorkspaceKind })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const submit = (e: FormEvent) => { e.preventDefault(); setup.mutate(f) }
  return (
    <form onSubmit={submit} className="rise space-y-5">
      <div>
        <h1 className="display text-3xl font-bold">Primeiro acesso</h1>
        <p className="mt-1.5 text-muted">Crie a conta de administrador e o primeiro espaço. Depois você cria os outros (ex.: Pessoal) em Ajustes.</p>
      </div>
      <div>
        <label className="label">Seu nome</label>
        <input className="field" value={f.name} onChange={set('name')} autoComplete="name" required />
      </div>
      <div>
        <label className="label">E-mail</label>
        <input className="field" type="email" inputMode="email" value={f.email} onChange={set('email')} autoComplete="email" required />
      </div>
      <div>
        <label className="label">Senha (mín. 8)</label>
        <input className="field" type="password" minLength={8} value={f.password} onChange={set('password')} autoComplete="new-password" required />
      </div>
      <div className="rounded-3xl border border-line p-4">
        <label className="label">Primeiro espaço</label>
        <Segmented
          className="mb-3"
          value={f.workspaceKind}
          onChange={(v) => setF({ ...f, workspaceKind: v })}
          options={[
            { value: 'Business', label: <span className="inline-flex items-center gap-1.5"><Building2 size={15} /> Empresa</span> },
            { value: 'Personal', label: <span className="inline-flex items-center gap-1.5"><User size={15} /> Pessoal</span> },
          ]}
        />
        <input className="field" placeholder={f.workspaceKind === 'Business' ? 'Ex.: Metup' : 'Ex.: Minhas finanças'} value={f.workspaceName} onChange={set('workspaceName')} required />
      </div>
      {setup.error && <p className="text-sm font-semibold text-expense-text">{setup.error.message}</p>}
      <Button type="submit" size="lg" className="w-full" loading={setup.isPending}>Criar e entrar</Button>
    </form>
  )
}

/** Painel de marca (desktop): a logo sobre o mesmo preto dela, nos dois temas. */
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden border-r border-line p-12 lg:flex lg:flex-col" style={{ background: '#080707', color: '#f2f0eb' }}>
      <span className="display text-xl font-bold">dara</span>
      <div className="my-auto flex justify-center">
        <img src="/icon-512.png" alt="Logo da dara" width={512} height={512} className="rise w-full max-w-sm" />
      </div>
      <div>
        <p className="display max-w-md text-4xl font-bold leading-[1.05]">Contas a pagar, a receber e o que elas dizem sobre você.</p>
        <p className="mt-4 max-w-md" style={{ color: '#9c9a93' }}>Empresa e vida pessoal em espaços separados. Potes, objetivos, recorrências e um painel que mostra o caixa de hoje e o de amanhã.</p>
      </div>
    </div>
  )
}

/** Primeiro login com senha provisória (ou senha redefinida pelo admin): cria a própria antes de entrar. */
export function ForcePasswordPage() {
  const change = useChangePassword()
  const logout = useLogout()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (next.length < 8) return setErr('Use ao menos 8 caracteres.')
    if (next !== confirm) return setErr('As senhas não conferem.')
    change.mutate({ next })
  }
  return (
    <div className="grid min-h-dvh place-items-center px-5 py-10">
      <form onSubmit={submit} className="rise w-full max-w-sm space-y-5">
        <Logo />
        <div>
          <h1 className="display text-3xl font-bold">Crie sua senha</h1>
          <p className="mt-1.5 text-muted">Você entrou com uma senha provisória. Escolha a sua — só você vai saber qual é.</p>
        </div>
        <div>
          <label className="label" htmlFor="np">Nova senha</label>
          <input id="np" className="field" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoFocus required />
        </div>
        <div>
          <label className="label" htmlFor="nc">Repita a senha</label>
          <input id="nc" className="field" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {(err ?? change.error?.message) && <p className="text-sm font-semibold text-expense-text">{err ?? change.error?.message}</p>}
        <Button type="submit" size="lg" className="w-full" loading={change.isPending}>Salvar e entrar</Button>
        <button type="button" onClick={() => logout.mutate()} className="w-full text-sm font-semibold text-muted hover:text-fg">Sair</button>
      </form>
    </div>
  )
}
