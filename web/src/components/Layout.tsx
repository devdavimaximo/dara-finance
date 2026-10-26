import clsx from 'clsx'
import { BarChart3, Building2, Check, ChevronsUpDown, LayoutDashboard, ListChecks, PiggyBank, Plus, Settings, User } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { initials } from '../lib/format'
import { useSession } from '../lib/session'
import type { Workspace } from '../lib/types'
import { EntrySheet } from './EntrySheet'
import { SyncBanner } from './SyncBanner'
import { Sheet } from './ui'

const nav = [
  { to: '/', label: 'Painel', icon: LayoutDashboard },
  { to: '/lancamentos', label: 'Lançamentos', icon: ListChecks },
  { to: '/potes', label: 'Potes', icon: PiggyBank },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
]

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      {/* A marca tem fundo preto próprio: vira um "ícone de app" igual nos dois temas. */}
      <img src="/logo-mark.png" alt="" width={32} height={32} className="size-8 rounded-[9px]" />
      <span className="display text-xl font-bold">dara</span>
    </span>
  )
}

const KindIcon = ({ w, size = 16 }: { w: Workspace; size?: number }) =>
  w.kind === 'Business' ? <Building2 size={size} /> : <User size={size} />

function WorkspaceSwitcher({ compact }: { compact?: boolean }) {
  const { me, workspace, setWorkspace } = useSession()
  const [open, setOpen] = useState(false)
  const many = me.workspaces.length > 1
  return (
    <>
      <button
        onClick={() => many && setOpen(true)}
        className={clsx(
          'flex min-w-0 items-center gap-2.5 rounded-2xl border border-line bg-surface text-left transition',
          many && 'hover:border-line-strong',
          compact ? 'h-11 px-3' : 'h-14 w-full px-3.5',
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink"><KindIcon w={workspace} size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold leading-tight">{workspace.name}</span>
          {!compact && <span className="block text-xs text-muted">{workspace.kind === 'Business' ? 'Empresa' : 'Pessoal'}</span>}
        </span>
        {many && <ChevronsUpDown size={16} className="shrink-0 text-muted" />}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Trocar de espaço">
        <p className="mb-4 text-sm text-muted">Cada espaço tem lançamentos, potes, objetivos e relatórios totalmente separados.</p>
        <div className="space-y-2">
          {me.workspaces.map((w) => (
            <button
              key={w.id}
              onClick={() => { setWorkspace(w.id); setOpen(false) }}
              className={clsx('flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition',
                w.id === workspace.id ? 'border-fg bg-surface-2' : 'border-line hover:border-line-strong')}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-surface-3"><KindIcon w={w} size={18} /></span>
              <span className="flex-1">
                <span className="block font-bold">{w.name}</span>
                <span className="text-sm text-muted">{w.kind === 'Business' ? 'Empresa' : 'Pessoal'} · {w.role === 'Owner' ? 'responsável' : 'membro'}</span>
              </span>
              {w.id === workspace.id && <Check size={18} />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

/** Objetivos ficam dentro de Potes: o item Potes segue destacado na tela de um objetivo. */
const inSection = (pathname: string, to: string) => to === '/potes' && pathname.startsWith('/objetivos')

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { me, openEntry, workspace } = useSession()
  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop: barra lateral */}
      <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r border-line px-5 py-6 lg:flex">
        <Logo className="mb-7 px-1" />
        <WorkspaceSwitcher />
        <button
          onClick={() => openEntry()}
          className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent font-bold text-accent-ink transition hover:brightness-105 active:scale-[0.98]"
        >
          <Plus size={20} strokeWidth={2.5} /> Novo lançamento
        </button>
        <nav className="mt-6 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => clsx('flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition',
                isActive || inSection(pathname, to) ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg-2')}
            >
              <Icon size={19} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 rounded-2xl px-1">
          <span className="grid size-9 place-items-center rounded-full bg-surface-3 text-xs font-bold">{initials(me.name)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{me.name}</span>
            <span className="block truncate text-xs text-muted">{me.email}</span>
          </span>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile: topo */}
        <header className="pt-safe sticky top-0 z-30 border-b border-line/60 bg-bg/85 backdrop-blur-xl lg:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-4">
            <Logo />
            <div className="flex min-w-0 items-center gap-1">
              <WorkspaceSwitcher compact />
              <NavLink to="/ajustes" aria-label="Ajustes" className={({ isActive }) => clsx('grid size-11 shrink-0 place-items-center rounded-2xl transition', isActive ? 'bg-surface-3 text-fg' : 'text-fg-2 hover:bg-surface-2')}>
                <Settings size={20} />
              </NavLink>
            </div>
          </div>
        </header>

        <main key={workspace.id} className="mx-auto w-full max-w-7xl px-4 pb-32 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8"><SyncBanner />{children}</main>
      </div>

      {/* Mobile: navegação inferior com botão central */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid h-[68px] max-w-md grid-cols-5 items-center px-2">
          {nav.slice(0, 2).map((n) => <TabLink key={n.to} {...n} />)}
          <div className="grid place-items-center">
            <button
              onClick={() => openEntry()}
              aria-label="Novo lançamento"
              className="-mt-7 grid size-[60px] place-items-center rounded-[22px] bg-accent text-accent-ink shadow-[0_10px_30px_-8px_color-mix(in_oklab,var(--accent)_70%,transparent)] transition active:scale-95"
            >
              <Plus size={28} strokeWidth={2.5} />
            </button>
          </div>
          {nav.slice(2, 4).map((n) => <TabLink key={n.to} {...n} />)}
        </div>
      </nav>

      <EntrySheet />
    </div>
  )
}

function TabLink({ to, label, icon: Icon }: (typeof nav)[number]) {
  const { pathname } = useLocation()
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => clsx('flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition', isActive || inSection(pathname, to) ? 'text-fg' : 'text-faint')}
    >
      {({ isActive: a }) => { const isActive = a || inSection(pathname, to); return (
        <>
          <span className={clsx('grid h-7 w-12 place-items-center rounded-full transition', isActive && 'bg-surface-3')}><Icon size={20} /></span>
          {label}
        </>
      ) }}
    </NavLink>
  )
}
