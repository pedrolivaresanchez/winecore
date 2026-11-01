import { useState, type ReactNode } from 'react'
import { X, type IconComponent } from './icons'
import { ConfirmDialog } from './confirm-dialog'
import { LIST_BAR } from './frame'
import { useUiLabels } from './ui-labels'
import { cn } from '../lib/cn'
import { iconStroke } from '../lib/motion'

export type SelectionAction = {
  id: string
  label: string
  icon?: IconComponent
  /** `danger` is drawn in red and is always asked first. */
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** Asked before running. A `danger` action without one is asked with its own label. */
  confirm?: { title: string; body: ReactNode; confirmLabel?: string }
  onRun: () => void | Promise<unknown>
}

export type SelectionBarProps = {
  count: number
  /** Rows on this page. While some are unticked the bar offers to tick them all. */
  pageCount?: number
  onSelectAll?: () => void
  onClear: () => void
  actions?: SelectionAction[]
  className?: string
}

/**
 * What to do with the ticked rows, in the strip the filters were in.
 *
 * It takes the `FilterBar`'s row rather than floating over the grid: the same 44px, so
 * nothing below moves when the first box is ticked, and the verbs sit where the reader's
 * eye already is. The face is SDR's selection dock — ink, an azure count, quiet verbs — so
 * it reads as a mode of the list, not as one more strip of chrome.
 */
export function SelectionBar({ count, pageCount, onSelectAll, onClear, actions = [], className }: SelectionBarProps) {
  const labels = useUiLabels().lists.selection
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<SelectionAction | null>(null)
  const allTicked = pageCount != null && count >= pageCount

  async function run(action: SelectionAction) {
    setBusy(action.id)
    try {
      await action.onRun()
    } catch {
      /* The page says what went wrong; the bar only has to come back. */
    } finally {
      setBusy(null)
      setAsking(null)
    }
  }

  function press(action: SelectionAction) {
    if (action.confirm || action.tone === 'danger') setAsking(action)
    else void run(action)
  }

  return (
    <div role="toolbar" aria-label={`${count} ${labels.label}`} data-selection-bar="" className={cn(LIST_BAR, className)}>
      <div className="scrollbar-none flex min-w-0 items-center gap-1 overflow-x-auto rounded-[10px] bg-ink-900 p-1 text-ink-0 shadow-(--shadow-float)">
        <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] bg-ink-0/10 pr-1 pl-1.5">
          <span className="rounded-md bg-azure-500 px-1.5 text-caption font-medium tabular-nums text-white">{count}</span>
          <span className="text-label text-ink-0/70">{labels.label}</span>
          {onSelectAll && pageCount != null && pageCount > 1 ? (
            <>
              <span aria-hidden className="h-3.5 w-px shrink-0 bg-ink-0/15" />
              <button
                type="button"
                onClick={allTicked ? onClear : onSelectAll}
                className={cn(
                  'flex h-6 items-center rounded-md px-1.5 text-caption font-medium text-ink-0 outline-none',
                  'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
                  'hover:bg-ink-0/10 focus-visible:bg-ink-0/10',
                )}
              >
                {allTicked ? labels.clear : labels.selectAll}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={onClear}
            title={labels.clear}
            aria-label={labels.clear}
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-md text-ink-0/60 outline-none',
              'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
              'hover:bg-ink-0/10 hover:text-ink-0 focus-visible:bg-ink-0/10',
            )}
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        </span>
        {actions.length > 0 ? <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-ink-0/15" /> : null}
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.id}
              type="button"
              data-action={action.id}
              onClick={() => press(action)}
              disabled={action.disabled || busy !== null}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-label outline-none',
                'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
                'focus-visible:bg-ink-0/10 disabled:opacity-40',
                action.tone === 'danger'
                  ? 'text-danger-500 hover:bg-danger-500/15'
                  : 'text-ink-0/80 hover:bg-ink-0/10 hover:text-ink-0',
              )}
            >
              {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={iconStroke} /> : null}
              <span className="whitespace-nowrap">{action.label}</span>
            </button>
          )
        })}
      </div>
      <ConfirmDialog
        open={asking !== null}
        title={asking?.confirm?.title ?? asking?.label ?? ''}
        body={asking?.confirm?.body ?? null}
        confirmLabel={asking?.confirm?.confirmLabel ?? asking?.label ?? ''}
        danger={asking?.tone === 'danger'}
        busy={asking !== null && busy === asking.id}
        onConfirm={() => {
          if (asking) void run(asking)
        }}
        onClose={() => {
          if (busy === null) setAsking(null)
        }}
      />
    </div>
  )
}
