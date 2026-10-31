import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '../lib/cn'
import { dropdownMotion, glassMenu } from '../lib/motion'
import { resolveMenuPlacement, type MenuCoords, type MenuPlacement } from './glass-menu-placement'
import { announceMenuTrigger } from './glass-menu-trigger'
import { focusFirstMenuField } from './menu'
import { useDismissOnEscape } from './dismiss-layer'
import { usePortalDocument, viewOf } from './portal-document'

export type { MenuPlacement }

/**
 * How a menu learns that one of its descendants is also on screen.
 *
 * Every panel portals to `document.body`, so a menu opened from inside another menu is not
 * a DOM descendant of it. Without this, the parent's outside-click handler sees a click on
 * the child's panel as a click on the page and closes itself and the child with it — which
 * is exactly what happens when you pick an attribute from a submenu and the whole settings
 * popover disappears under you.
 *
 * Each panel registers itself with every ancestor, so "inside" means the whole open tree
 * rather than one node. Registration is scoped to the panel being open, so the set is the
 * live tree and not a graveyard of every menu ever mounted.
 */
type MenuLayer = { addPanel: (node: HTMLElement) => () => void }

const MenuLayerContext = createContext<MenuLayer | null>(null)

type GlassMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  /** Preferred corner; flips to use open viewport space. */
  placement?: MenuPlacement
  className?: string
  panelClassName?: string
  /**
   * Stretch the panel to at least the trigger's width. Selects and field pickers want it;
   * a column header is often much wider than the menu it opens, so those pass false.
   */
  fitTrigger?: boolean
  /** `dialog` for a panel that explains rather than offers choices — a help popover. */
  role?: 'menu' | 'dialog'
}

/**
 * Frosted glass dropdown — fade + slight scale. Portals to `document.body`
 * with fixed positioning so scroll containers never clip it, and flips to
 * the side of the trigger with more open viewport space.
 */
export function GlassMenu({
  open,
  onOpenChange,
  trigger,
  children,
  placement = 'top-start',
  className,
  panelClassName,
  fitTrigger = true,
  role = 'menu',
}: GlassMenuProps) {
  const reduce = useReducedMotion()
  const doc = usePortalDocument()
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<MenuCoords | null>(null)

  const parentLayer = useContext(MenuLayerContext)
  const descendants = useRef(new Set<HTMLElement>())
  const focusedField = useRef(false)
  /* Escape lives on the overlay stack, not on this panel: a menu opened over a
     dialog or under Cmd-K has to peel one layer per press, and a React handler
     here would miss the key whenever the caret is not in the menu. */
  useDismissOnEscape(open, () => onOpenChange(false))

  /* Registering with the parent as well as with this menu is what makes the check work at
     any depth: a picker three menus down is "inside" all three. */
  const layer = useMemo<MenuLayer>(
    () => ({
      addPanel: (node) => {
        descendants.current.add(node)
        const detachFromParent = parentLayer?.addPanel(node)
        return () => {
          descendants.current.delete(node)
          detachFromParent?.()
        }
      },
    }),
    [parentLayer],
  )

  /* `coords` is in the deps as a retry, not because position matters: it lands one commit
     after the panel mounts, so if the ref was somehow not attached on the first pass this
     runs again once it certainly is. */
  useEffect(() => {
    if (!open || !parentLayer) return
    const node = panelRef.current
    if (!node) return
    return parentLayer.addPanel(node)
  }, [open, parentLayer, coords])

  const reposition = useCallback(() => {
    const root = rootRef.current
    const panel = panelRef.current
    if (!root || !panel) return
    const triggerRect = root.getBoundingClientRect()
    const view = viewOf(doc)
    /* scrollHeight stays accurate while maxHeight caps the visible box. */
    const next = resolveMenuPlacement(
      triggerRect,
      panel.offsetWidth,
      panel.scrollHeight,
      placement,
      { width: view.innerWidth, height: view.innerHeight },
    )
    setCoords((prev) => {
      if (
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.placement === next.placement &&
        prev.maxHeight === next.maxHeight
      ) {
        return prev
      }
      return next
    })
  }, [placement, doc])

  /* Keep the last coords through the close. Clearing them on `open === false`
     jumps the panel to 0,0 and hides it (`visibility`) before the exit scale
     can play — which is why menus used to snap shut instead of shrinking. */
  useLayoutEffect(() => {
    if (!open) return
    reposition()
  }, [open, reposition, children])

  /* The search field is why you opened a long catalog, so the caret should already be
     in it. HTML autoFocus runs on the first mount, while this panel is still hidden
     for measure, and a hidden input cannot take focus — so we try again once `coords`
     have made it visible. Once per open: a later resize must not yank the caret back
     out of a row somebody arrowed to. */
  useLayoutEffect(() => {
    if (!open) {
      focusedField.current = false
      return
    }
    if (!coords || focusedField.current) return
    if (focusFirstMenuField(panelRef.current)) {
      focusedField.current = true
      return
    }
    /* A hidden input cannot take focus; the paint after `visibility: visible` can.
       Under reduced motion the global 0.01ms transition also covers the inherited
       `visibility`, which lands a frame or two later — hence retries for a short window. */
    let frame = 0
    const until = performance.now() + 250
    const retry = () => {
      if (focusedField.current) return
      if (focusFirstMenuField(panelRef.current)) focusedField.current = true
      else if (performance.now() < until) frame = requestAnimationFrame(retry)
    }
    frame = requestAnimationFrame(retry)
    return () => cancelAnimationFrame(frame)
  }, [open, coords])

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const onReposition = () => reposition()
    const view = viewOf(doc)
    view.addEventListener('resize', onReposition)
    doc.addEventListener('scroll', onReposition, true)
    /* Nested accordions animate height — keep the panel pinned as it grows. */
    const ro = new ResizeObserver(onReposition)
    ro.observe(panel)
    return () => {
      view.removeEventListener('resize', onReposition)
      doc.removeEventListener('scroll', onReposition, true)
      ro.disconnect()
    }
  }, [open, reposition, doc])

  /* The trigger says whether the menu is open. On the DOM, after every render of the trigger,
     because the element handed in is often a wrapper — see glass-menu-trigger.ts — and a
     trigger re-rendered by its parent must not forget. */
  useEffect(() => {
    announceMenuTrigger(rootRef.current, open)
  }, [open, trigger])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      for (const node of descendants.current) if (node.contains(target)) return
      onOpenChange(false)
    }
    doc.addEventListener('mousedown', onDoc)
    return () => doc.removeEventListener('mousedown', onDoc)
  }, [open, onOpenChange, doc])

  const triggerWidth = rootRef.current?.offsetWidth
  const stretchToTrigger = panelClassName?.includes('w-full')

  /* The panel grows out of the trigger, so its origin is the trigger's own corner — the
     resolved one, not the preferred one, or a menu that flipped upward would still grow
     downward. Scale and opacity only: travel on an anchored surface reads as a sheet that
     happens to be nearby, which is the mismatch the motion contract exists to remove. */
  const [side, align] = (coords?.placement ?? placement).split('-') as [
    'top' | 'bottom' | 'left' | 'right',
    'start' | 'end',
  ]
  const anchored = dropdownMotion(reduce, { side, align })

  return (
    <div ref={rootRef} className={cn('relative w-fit', className)} style={className?.includes('w-full') ? { width: '100%' } : undefined}>
      {trigger}
      {createPortal(
        <AnimatePresence onExitComplete={() => setCoords(null)}>
          {open && (
            <motion.div
              key="glass-menu"
              ref={panelRef}
              role={role}
              initial={anchored.initial}
              animate={anchored.animate}
              exit={anchored.exit}
              className={cn(
                /* 10px outer over 4px padding and 6px rows — the nesting rule, run at the
                   documented menu radius rather than the card one. A 16px panel reads as a
                   floating card; a menu is chrome and should sit closer to its trigger's
                   own corner than to a settings panel's. */
                'fixed overflow-x-hidden overflow-y-auto overscroll-contain rounded-[10px] p-1',
                glassMenu,
                panelClassName,
              )}
              style={{
                ...anchored.style,
                top: coords?.top ?? 0,
                left: coords?.left ?? 0,
                zIndex: 'var(--z-dropdown)',
                visibility: coords ? 'visible' : 'hidden',
                maxHeight: coords?.maxHeight,
                minWidth: fitTrigger ? triggerWidth : undefined,
                ...(stretchToTrigger && triggerWidth ? { width: triggerWidth } : null),
              }}
            >
              <MenuLayerContext.Provider value={layer}>{children}</MenuLayerContext.Provider>
            </motion.div>
          )}
        </AnimatePresence>,
        doc.body,
      )}
    </div>
  )
}

export function useMenuOpen(initial = false) {
  const [open, setOpen] = useState(initial)
  const toggle = useCallback(() => setOpen((v) => !v), [])
  const close = useCallback(() => setOpen(false), [])
  return { open, setOpen, toggle, close } as const
}
