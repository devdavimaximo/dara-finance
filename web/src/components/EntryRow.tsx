import clsx from 'clsx'
import { AlertCircle, Check, Paperclip, Repeat } from 'lucide-react'
import { catColor, status } from '../lib/analytics'
import { relativeDay, shortDate } from '../lib/dates'
import { money } from '../lib/format'
import type { Category, Entry } from '../lib/types'
import { CategoryBadge } from './ui'

export function EntryRow({
  entry, category, today, onOpen, onToggle, busy, showDate = true,
}: {
  entry: Entry
  category?: Category
  today: string
  onOpen: () => void
  onToggle: () => void
  busy?: boolean
  showDate?: boolean
}) {
  const st = status(entry, today)
  const income = entry.kind === 'Income'
  return (
    <div className="flex items-center gap-2.5 py-2.5">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <CategoryBadge icon={category?.icon} color={catColor(category)} size={36} />
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate font-semibold', st === 'paid' && 'text-fg-2')}>{entry.description}</span>
          <span className="flex items-center gap-1.5 truncate text-[13px] text-muted">
            {st === 'overdue' && <AlertCircle size={13} className="shrink-0 text-critical" />}
            {showDate && (
              <span className={clsx(st === 'overdue' && 'font-semibold text-expense-text')}>
                {st === 'paid' ? `${income ? 'recebido' : 'pago'} ${shortDate(entry.paidDate!)}` : `${st === 'overdue' ? 'venceu' : 'vence'} ${relativeDay(entry.dueDate, today)}`}
              </span>
            )}
            {category && <><span aria-hidden>·</span><span className="truncate">{category.name}</span></>}
            {entry.recurrenceId && (
              <span className="inline-flex shrink-0 items-center gap-0.5"><Repeat size={12} />{entry.seriesCount ? `${entry.sequence}/${entry.seriesCount}` : ''}</span>
            )}
            {entry.attachmentName && <Paperclip size={12} className="shrink-0" />}
          </span>
        </span>
        <span className="text-right">
          <span className={clsx('num block font-bold', income ? 'text-income-text' : 'text-fg', st === 'paid' && 'opacity-70')}>
            {income ? '+' : '−'}{money(entry.paidAmountCents ?? entry.amountCents)}
          </span>
          {entry.counterparty && <span className="hidden max-w-28 truncate text-xs text-muted sm:block">{entry.counterparty}</span>}
        </span>
      </button>
      <button
        onClick={onToggle}
        disabled={busy}
        aria-label={st === 'paid' ? 'Marcar como em aberto' : income ? 'Marcar como recebido' : 'Marcar como pago'}
        title={st === 'paid' ? 'Desfazer' : income ? 'Recebi' : 'Paguei'}
        className={clsx('grid size-10 shrink-0 place-items-center rounded-full border-2 transition active:scale-90 disabled:opacity-40',
          st === 'paid' ? 'border-transparent bg-good text-white' : 'border-line-strong text-transparent hover:border-good hover:text-good')}
      >
        <Check size={18} strokeWidth={3} />
      </button>
    </div>
  )
}
