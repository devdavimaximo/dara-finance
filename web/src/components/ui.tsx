import clsx from 'clsx'
import {
  ArrowDownRight, ArrowUpRight, Briefcase, Car, ChevronLeft, ChevronRight, Cpu, GraduationCap, HeartPulse, Home, Landmark,
  Laptop, Loader2, Megaphone, MessagesSquare, Minus, MoreHorizontal, PartyPopper, PiggyBank, Plane, Plus, Receipt, Repeat,
  Scale, Server, ShoppingBag, Shirt, Tag, TrendingUp, User, Users, Utensils, Wallet, Wifi, X, Zap, Gift, Dog, Baby, Fuel,
  Smartphone, Dumbbell, BookOpen, Building2, Coffee, Target, Heart, Gem, Sparkles, KeyRound, Camera, TreePalm, type LucideIcon,
} from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { monthLabel } from '../lib/dates'
import { signedPct } from '../lib/format'

// ---------------------------------------------------------------- ícones de categoria

export const categoryIcons: Record<string, LucideIcon> = {
  tag: Tag, cpu: Cpu, megaphone: Megaphone, landmark: Landmark, user: User, scale: Scale, server: Server, users: Users,
  home: Home, utensils: Utensils, car: Car, 'heart-pulse': HeartPulse, 'party-popper': PartyPopper, 'graduation-cap': GraduationCap,
  repeat: Repeat, briefcase: Briefcase, 'messages-square': MessagesSquare, plus: Plus, wallet: Wallet, laptop: Laptop,
  'trending-up': TrendingUp, 'more-horizontal': MoreHorizontal, plane: Plane, 'shopping-bag': ShoppingBag, shirt: Shirt,
  receipt: Receipt, wifi: Wifi, zap: Zap, gift: Gift, dog: Dog, baby: Baby, fuel: Fuel, smartphone: Smartphone,
  dumbbell: Dumbbell, 'book-open': BookOpen, building: Building2, coffee: Coffee, 'piggy-bank': PiggyBank,
  target: Target, heart: Heart, gem: Gem, sparkles: Sparkles, key: KeyRound, camera: Camera, 'tree-palm': TreePalm,
}

export function CategoryBadge({ icon, color, size = 40 }: { icon?: string; color: string; size?: number }) {
  const Icon = categoryIcons[icon ?? 'tag'] ?? Tag
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-[30%]"
      style={{ width: size, height: size, background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}
    >
      <Icon size={size * 0.48} strokeWidth={2} />
    </span>
  )
}

export const Dot = ({ color, className }: { color: string; className?: string }) => (
  <span className={clsx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />
)

// ---------------------------------------------------------------- botões

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  loading?: boolean
  size?: 'md' | 'lg' | 'sm'
}

export function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        size === 'lg' && 'h-14 px-6 text-base',
        size === 'md' && 'h-12 px-5 text-[15px]',
        size === 'sm' && 'h-9 rounded-xl px-3 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-105',
        variant === 'soft' && 'bg-surface-2 text-fg hover:bg-surface-3',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-2',
        variant === 'danger' && 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-expense-text hover:brightness-110',
        className,
      )}
    >
      {loading && <Loader2 size={18} className="animate-spin" />}
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={clsx('grid size-11 place-items-center rounded-2xl text-fg-2 transition hover:bg-surface-2 active:scale-95', className)}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- segmentado / chips

export function Segmented<T extends string>({
  value, onChange, options, className,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={clsx('flex rounded-2xl bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'min-w-0 flex-1 truncate whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-semibold transition',
            value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition',
        active ? 'border-transparent bg-fg text-bg' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span className="text-[15px] font-medium">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-surface-3')}
      >
        <span className={clsx('absolute top-1 size-5 rounded-full shadow transition-all', checked ? 'left-6 bg-accent-ink' : 'left-1 bg-fg-2')} />
      </button>
    </label>
  )
}

// ---------------------------------------------------------------- métricas

/** Variação percentual com seta. `goodWhenUp=false` para despesas (subir é ruim). */
export function Delta({ value, goodWhenUp = true, className }: { value: number | null; goodWhenUp?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={clsx('text-xs text-faint', className)}>sem base</span>
  const flat = Math.abs(value) < 0.005
  const good = flat ? null : value > 0 === goodWhenUp
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold num',
        good === null && 'bg-surface-2 text-muted',
        good === true && 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-good-text',
        good === false && 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-expense-text',
        className,
      )}
    >
      <Icon size={13} strokeWidth={2.5} />
      {signedPct(value)}
    </span>
  )
}

export function Progress({ value, color = 'var(--fg)', track = 'var(--surface-3)', className, height = 6 }: { value: number | null; color?: string; track?: string; className?: string; height?: number }) {
  const v = Math.max(0, Math.min(1, value ?? 0))
  return (
    <div className={clsx('w-full overflow-hidden rounded-full', className)} style={{ background: track, height }}>
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  )
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <h2 className="display text-lg font-semibold leading-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

export function MonthSwitcher({ value, onChange, min, max }: { value: string; onChange: (k: string) => void; min?: string; max?: string }) {
  const step = (n: number) => {
    const [y, m] = value.split('-').map(Number)
    const d = new Date(Date.UTC(y!, m! - 1 + n, 1))
    const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    if ((min && k < min) || (max && k > max)) return
    onChange(k)
  }
  return (
    <div className="inline-flex items-center rounded-2xl border border-line bg-surface">
      <IconButton label="Mês anterior" onClick={() => step(-1)} className="size-10"><ChevronLeft size={18} /></IconButton>
      <span className="min-w-32 text-center text-sm font-bold capitalize">{monthLabel(value, true)}</span>
      <IconButton label="Próximo mês" onClick={() => step(1)} className="size-10"><ChevronRight size={18} /></IconButton>
    </div>
  )
}

// ---------------------------------------------------------------- sheet / modal

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="sheet-in relative flex max-h-[94dvh] w-full flex-col rounded-t-[28px] border border-line bg-surface shadow-2xl sm:max-w-lg sm:rounded-[28px]"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-surface-3 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <h2 className="display text-xl font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose}><X size={20} /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="pb-safe border-t border-line px-5 pt-3 [&>*]:mb-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Empty({ icon: Icon = Receipt, title, hint, action }: { icon?: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-3xl bg-surface-2 text-muted"><Icon size={26} /></span>
      <p className="display text-lg font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const Spinner = ({ className }: { className?: string }) => (
  <div className={clsx('grid place-items-center py-16 text-muted', className)}><Loader2 className="animate-spin" /></div>
)
