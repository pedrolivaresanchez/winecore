import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from './icons'
import { cn } from '../lib/cn'
import {
  iconStroke,
  modalMotion,
  overlayFade,
  sheetMotion,
} from '../lib/motion'
import { OverlayScrim } from './overlay-scrim'
import { useDismissOnEscape } from './dismiss-layer'
import { useUiLabels } from './ui-labels'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'screen'

const sizes: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
  /** A records table opened over a chart — needs the columns, not a reading column. */
  full: 'max-w-[min(96vw,80rem)]',
  /** A document beside its record: 24px off every edge, the whole screen on a phone. */
  screen: 'max-w-none',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Below Tailwind's `sm`: a phone held upright. */
const SHEET_QUERY = '(max-width: 639px)'

function subscribeSheet(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(SHEET_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function sheetLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(SHEET_QUERY).matches
}

/**
 * Modal dialog — scrim on `z-overlay-backdrop`, panel on `z-modal` with a
 * 5px ink-900/20 ring and `shadow-float`. Focus moves into the panel on
 * open, stays trapped while open and returns to the trigger on close.
 * Escape dismisses through the shared overlay stack, so it still works
 * before focus lands and peels only this dialog when another overlay sits
 * on top. Open/close animate via variants so the exit run finishes before unmount.
 *
 * On a phone a centred card is a form floating 12px off every edge with its actions in
 * the middle of the glass, so it docks to the bottom instead: full width, top corners
 * only, the footer where the thumb already is — and it travels on the sheet recipe,
 * because that is what it has become. A palette (`align="top"`) keeps its place: it is
 * read from the top, under the keyboard's reach rather than over it.
 */
export function Dialog({
  open,
  onClose,
  size = 'md',
  align = 'center',
  labelledBy,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  size?: DialogSize
  /** `top` anchors the panel near the top — command palettes, search. */
  align?: 'center' | 'top'
  /** id of the element naming the dialog (usually the DialogHeader title). */
  labelledBy?: string
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const bodyLocked = useRef(false)
  useDismissOnEscape(open, onClose)

  const unlockBody = () => {
    if (!bodyLocked.current) return
    bodyLocked.current = false
    document.body.style.overflow = ''
  }

  useEffect(() => {
    if (!open) return

    restoreRef.current = document.activeElement as HTMLElement | null
    if (!bodyLocked.current) {
      bodyLocked.current = true
      document.body.style.overflow = 'hidden'
    }

    const focusId = requestAnimationFrame(() => panelRef.current?.focus())

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(focusId)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => () => unlockBody(), [])

  const onExitComplete = () => {
    unlockBody()
    restoreRef.current?.focus?.()
    restoreRef.current = null
  }

  const narrow = useSyncExternalStore(subscribeSheet, sheetLayout, () => false)
  const screen = size === 'screen'
  const docked = narrow && align === 'center'
  const sheet = docked && !screen
  const fade = reduce ? { duration: 0 } : overlayFade
  const modal = docked
    ? sheetMotion(reduce, { edge: 'bottom' })
    : modalMotion(reduce, { from: align === 'top' ? 'above' : 'below' })

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <motion.div
          key="dialog"
          role="presentation"
          className={cn(
            'fixed inset-0 flex justify-center',
            screen
              ? 'items-stretch sm:p-6'
              : sheet
                ? 'items-end pt-6'
                : [
                    'p-3 sm:p-4',
                    align === 'top' ? 'items-start pt-[10vh] sm:pt-[14vh]' : 'items-center',
                  ],
          )}
          style={{ zIndex: 'var(--z-modal)' }}
          initial="closed"
          animate="open"
          exit="closed"
          variants={{
            open: { transition: { when: 'beforeChildren' } },
            closed: { transition: { when: 'afterChildren' } },
          }}
        >
          <OverlayScrim onClick={onClose} transition={fade} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            variants={{
              open: modal.animate,
              closed: modal.exit ?? modal.initial,
            }}
            data-sheet={sheet ? '' : undefined}
            className={cn(
              'relative flex w-full flex-col overflow-hidden border-[5px] border-ink-900/20 bg-surface shadow-(--shadow-float) outline-none',
              screen
                ? 'h-full border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:rounded-2xl sm:border-[5px] sm:pt-0 sm:pb-0'
                : sheet
                  ? 'max-h-[92dvh] rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]'
                  : ['rounded-2xl', size === 'full' ? 'max-h-[90dvh]' : 'max-h-[85dvh]'],
              sizes[size],
              className,
            )}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function DialogHeader({
  title,
  titleId,
  description,
  actions,
  onClose,
}: {
  title: ReactNode
  /** Pair with the Dialog's `labelledBy`. */
  titleId?: string
  description?: ReactNode
  /**
   * Controls that belong to the whole dialog — undo and redo over everything in it — sit at
   * the top right beside the close, where a window keeps them, rather than in the title.
   */
  actions?: ReactNode
  onClose?: () => void
}) {
  const labels = useUiLabels()
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-3 pt-4 sm:gap-4 sm:px-6 sm:pb-4 sm:pt-5">
      <div className="min-w-0 flex-1 pr-2">
        <h2 id={titleId} className="text-body font-medium text-ink-900">
          {title}
        </h2>
        {/* A div rather than a paragraph: this slot takes a node, and the ones that
            hand it a row of chips or a control were producing invalid markup. */}
        {description && (
          <div className="mt-1 text-label leading-5 text-text-tertiary">{description}</div>
        )}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      {onClose && (
        <button
          type="button"
          aria-label={labels.close}
          onClick={onClose}
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md text-control outline-none sm:size-7',
            'transition-colors hover:bg-fill-hover hover:text-ink-700 focus-visible:shadow-(--shadow-focus)',
          )}
        >
          <X className="size-4" strokeWidth={iconStroke} />
        </button>
      )}
    </div>
  )
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-1 sm:px-6', className)}>
      {children}
    </div>
  )
}

export function DialogFooter({
  children,
  className,
  error,
}: {
  children: ReactNode
  className?: string
  /**
   * A refusal belongs where the button that caused it is. The body scrolls, so a message at
   * the end of the form is out of sight exactly when the person has pressed Create.
   */
  error?: string | null
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 pb-4 pt-3 sm:px-6 sm:pb-5 sm:pt-4',
        className,
      )}
    >
      {error ? (
        <p
          role="alert"
          className="mb-1 w-full rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-label text-danger-700"
        >
          {error}
        </p>
      ) : null}
      {children}
    </div>
  )
}
