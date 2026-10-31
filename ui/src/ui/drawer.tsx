import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '../lib/cn'
import { drawerFade, iconStroke, sheetMotion } from '../lib/motion'
import { OverlayScrim } from './overlay-scrim'
import { useDismissOnEscape } from './dismiss-layer'
import { X } from './icons'
import { useUiLabels } from './ui-labels'

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl'

const sizes: Record<DrawerSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  /* For a drawer holding a list of rows rather than a form. At `lg` a person's name, their
     title and the company they work at do not fit on one line, and a list where every row
     wraps to two is a list you cannot scan. */
  xl: 'max-w-2xl',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Below Tailwind's `sm`: a phone held upright. Same query the dialog uses for its sheet. */
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
 * Side drawer — same chrome as Dialog (scrim wash, 5px ink-900/20 ring,
 * `shadow-float`) but docks to an edge with radius only on the open corners.
 * Focus traps and restores like Dialog. Escape goes through the same overlay
 * stack as Dialog, so a drawer under a palette or menu does not steal the key.
 *
 * `modal={false}` is the floating form: no scrim, the page behind stays readable
 * and scrollable, no focus trap and no body lock — the rep reads the transcript
 * on the record while filling the three fields (the Unqualified form, LEAD-25b).
 * Escape and the close button still dismiss it; focus is restored on close.
 *
 * `panelWidth` is the pixel width when the caller owns the size (a seam on the
 * Unqualified form). It drops the size class so a drag can grow past `max-w-sm`.
 */
export function Drawer({
  open,
  onClose,
  size = 'md',
  side = 'right',
  modal = true,
  labelledBy,
  children,
  className,
  panelWidth,
  mobileSheet = false,
}: {
  open: boolean
  onClose: () => void
  size?: DrawerSize
  side?: 'left' | 'right'
  modal?: boolean
  labelledBy?: string
  children: ReactNode
  className?: string
  panelWidth?: number
  /** On a phone, dock to the bottom instead of covering the screen. */
  mobileSheet?: boolean
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
    if (modal && !bodyLocked.current) {
      bodyLocked.current = true
      document.body.style.overflow = 'hidden'
    }

    const focusId = requestAnimationFrame(() => panelRef.current?.focus())

    if (!modal) {
      return () => cancelAnimationFrame(focusId)
    }

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
  }, [open, modal])

  useEffect(() => () => unlockBody(), [])

  const onExitComplete = () => {
    unlockBody()
    restoreRef.current?.focus?.()
    restoreRef.current = null
  }

  const fade = reduce ? { duration: 0 } : drawerFade
  const narrow = useSyncExternalStore(subscribeSheet, sheetLayout, () => false)
  const dockBottom = mobileSheet && narrow
  const sheet = sheetMotion(reduce, { edge: dockBottom ? 'bottom' : side })
  const sized = panelWidth != null && !dockBottom

  return createPortal(
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <motion.div
          key="drawer"
          role="presentation"
          className={cn('fixed inset-0', !modal && 'pointer-events-none')}
          style={{ zIndex: 'var(--z-modal)' }}
          initial="closed"
          animate="open"
          exit="closed"
          variants={{
            open: { transition: { when: 'beforeChildren' } },
            closed: { transition: { when: 'afterChildren' } },
          }}
        >
          {modal ? <OverlayScrim onClick={onClose} transition={fade} /> : null}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal={modal ? 'true' : 'false'}
            aria-labelledby={labelledBy}
            tabIndex={-1}
            data-sheet={dockBottom ? '' : undefined}
            variants={{
              open: sheet.animate,
              closed: sheet.exit ?? sheet.initial,
            }}
            style={sized ? { width: panelWidth } : undefined}
            className={cn(
              'absolute flex flex-col overflow-hidden',
              'border-[5px] border-ink-900/20 bg-surface shadow-(--shadow-float) outline-none',
              !modal && 'pointer-events-auto',
              dockBottom
                ? 'inset-x-0 bottom-0 h-auto max-h-[92dvh] w-full rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)]'
                : [
                    'inset-y-0 h-full',
                    side === 'left'
                      ? 'left-0 rounded-tr-2xl rounded-br-2xl'
                      : 'right-0 rounded-tl-2xl rounded-bl-2xl',
                    sized ? null : 'w-full',
                    sized ? null : sizes[size],
                    /* On a phone the drawer is the screen: a rounded edge 6px off the glass reads
                       as a card that slipped, not as a place. */
                    sized ? null : 'max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)]',
                  ],
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

/** Sticky drawer header — mirrors `DialogHeader` chrome. */
export function DrawerHeader({
  title,
  titleId,
  description,
  onClose,
}: {
  title: ReactNode
  /** Pair with the Drawer's `labelledBy`. */
  titleId?: string
  description?: ReactNode
  onClose?: () => void
}) {
  const labels = useUiLabels()
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 pb-3 pt-4 sm:gap-4 sm:px-6 sm:pb-4 sm:pt-5">
      <div className="min-w-0 flex-1 pr-2">
        <h2 id={titleId} className="text-body font-medium text-ink-900">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-label leading-5 text-text-tertiary">{description}</p>
        )}
      </div>
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

export function DrawerBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5', className)}>
      {children}
    </div>
  )
}
