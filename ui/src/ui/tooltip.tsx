import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '../lib/cn'
import { DURATION_MICRO, DURATION_QUICK, EASE_OUT, SCALE_SMALL } from '../lib/motion'
import { usePortalDocument, viewOf } from './portal-document'

/** `right` is for a vertical rail of icons, where above or below would cover the neighbour. */
type TooltipPlacement = 'top' | 'bottom' | 'right'

type Position = { x: number; y: number; side: TooltipPlacement }

interface TriggerProps {
  ref?: Ref<HTMLElement>
  'aria-describedby'?: string
  onMouseEnter?: (e: never) => void
  onMouseLeave?: (e: never) => void
  onFocus?: (e: never) => void
  onBlur?: (e: never) => void
}

const GAP = 6
const EDGE = 8
/** Intent gate: long enough that a cursor crossing the icon does not trigger it. */
export const INTENT_DELAY_MS = DURATION_MICRO * 1000
/** Dismissal is instant — never delay or ease a close. */
const OUT = { duration: 0.05, ease: EASE_OUT }

/** Where the panel opens against its anchor, flipped when the preferred side would leave the viewport. */
function place(rect: DOMRect, placement: TooltipPlacement, viewportHeight: number): Position {
  const side: TooltipPlacement =
    placement === 'right'
      ? 'right'
      : placement === 'top'
        ? rect.top > 44
          ? 'top'
          : 'bottom'
        : rect.bottom < viewportHeight - 44
          ? 'bottom'
          : 'top'
  return {
    x: side === 'right' ? rect.right + GAP : rect.left + rect.width / 2,
    /* y is refined after paint once the panel height is known. */
    y: side === 'right' ? rect.top + rect.height / 2 : side === 'top' ? rect.top - GAP : rect.bottom + GAP,
    side,
  }
}

/**
 * The tooltip's panel on its own: portaled on `z-tooltip` so scroll containers never clip
 * it, anchored to an element and clamped into the viewport. `Tooltip` drives it from its
 * trigger; `OverflowTips` from whatever truncated text the pointer rests on.
 */
export function TooltipPanel({
  id,
  anchorRef,
  open,
  placement = 'top',
  label,
  content,
  ariaHidden = false,
  className,
}: {
  id?: string
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  placement?: TooltipPlacement
  label: ReactNode
  /** Rich body. When set, the panel is a mini card instead of the ink label. */
  content?: ReactNode
  /** For a panel that repeats text already in the DOM, so a screen reader does not hear it twice. */
  ariaHidden?: boolean
  className?: string
}) {
  const reduce = useReducedMotion()
  const doc = usePortalDocument()
  const [pos, setPos] = useState<Position | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) setPos(place(rect, placement, viewOf(doc).innerHeight))
  }, [open, label, content, placement, anchorRef, doc])

  /* After paint, clamp into the viewport. Centering alone pushes wide labels
     (suspect reasons, etc.) past the edge; wrapping also changes height. */
  useLayoutEffect(() => {
    if (!open || !pos) return
    const panel = panelRef.current
    const trigger = anchorRef.current
    if (!panel || !trigger) return

    const width = panel.offsetWidth
    const height = panel.offsetHeight
    const triggerRect = trigger.getBoundingClientRect()
    const view = viewOf(doc)

    if (pos.side === 'right') {
      const halfHeight = height / 2
      const minY = EDGE + halfHeight
      const maxY = view.innerHeight - EDGE - halfHeight
      const rightX = triggerRect.right + GAP
      const rightY = Math.min(
        Math.max(triggerRect.top + triggerRect.height / 2, minY),
        Math.max(minY, maxY),
      )
      if (Math.abs(rightX - pos.x) > 0.5 || Math.abs(rightY - pos.y) > 0.5) {
        setPos((prev) => (prev ? { ...prev, x: rightX, y: rightY } : prev))
      }
      return
    }

    const half = width / 2
    const minX = EDGE + half
    const maxX = view.innerWidth - EDGE - half
    const nextX = Math.min(Math.max(pos.x, minX), Math.max(minX, maxX))
    const nextY =
      pos.side === 'top'
        ? triggerRect.top - GAP - height
        : triggerRect.bottom + GAP

    if (Math.abs(nextX - pos.x) > 0.5 || Math.abs(nextY - pos.y) > 0.5) {
      setPos((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev))
    }
  }, [open, pos, anchorRef, doc])

  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={panelRef}
          id={id}
          role="tooltip"
          aria-hidden={ariaHidden || undefined}
          /* Anchored to its trigger, so it scales rather than travels, and it grows out
             of the edge it sits on. */
          initial={reduce ? false : { opacity: 0, scale: SCALE_SMALL }}
          animate={{
            opacity: 1,
            scale: 1,
            transition: reduce ? { duration: 0 } : { duration: DURATION_QUICK, ease: EASE_OUT },
          }}
          exit={{
            opacity: 0,
            scale: reduce ? 1 : SCALE_SMALL,
            transition: reduce ? { duration: 0 } : OUT,
          }}
          className={cn(
            'pointer-events-none fixed w-max break-words shadow-(--shadow-overlay)',
            content
              ? 'rounded-[10px] bg-surface p-1.5 text-label text-ink-900'
              : 'max-w-60 rounded-md bg-ink-900 px-2 py-1 text-caption font-medium text-ink-0',
            className,
          )}
          style={{
            zIndex: 'var(--z-tooltip)',
            left: pos.x,
            top: pos.y,
            x: pos.side === 'right' ? 0 : '-50%',
            y: pos.side === 'right' ? '-50%' : 0,
            transformOrigin:
              pos.side === 'right'
                ? 'left center'
                : pos.side === 'top'
                  ? 'bottom center'
                  : 'top center',
          }}
        >
          {content ?? label}
        </motion.div>
      )}
    </AnimatePresence>,
    doc.body,
  )
}

/**
 * Hover/focus label for icon-only controls. A string `label` is the ink chip; `content`
 * is a mini card — still non-interactive, still this recipe.
 */
export function Tooltip({
  label,
  content,
  placement = 'top',
  delay = INTENT_DELAY_MS,
  disabled = false,
  children,
  className,
}: {
  label: string
  /** Rich body. When set, the panel is a mini card instead of the ink label. */
  content?: ReactNode
  placement?: TooltipPlacement
  /** ms before showing on hover — focus shows immediately. */
  delay?: number
  /** Stays shut — while the popover the same trigger pinned is open, for one. */
  disabled?: boolean
  /** A single focusable element. */
  children: ReactElement<TriggerProps>
  className?: string
}) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const show = useCallback(
    (immediate: boolean) => {
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(
        () => {
          if (triggerRef.current) setVisible(true)
        },
        immediate ? 0 : delay,
      )
    },
    [delay],
  )

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
    },
    'aria-describedby': visible ? id : undefined,
    onMouseEnter: () => {
      if (!disabled) show(false)
    },
    onMouseLeave: hide,
    onFocus: () => {
      if (!disabled) show(true)
    },
    onBlur: hide,
  })

  return (
    <>
      {trigger}
      <TooltipPanel
        id={id}
        anchorRef={triggerRef}
        open={visible}
        placement={placement}
        label={label}
        content={content}
        className={className}
      />
    </>
  )
}
