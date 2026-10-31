import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { DURATION_QUICK, EASE_OUT, SCALE_SMALL } from '@/lib/motion'

export type TooltipRow = {
  key: string
  label: string
  color: string
  value: string
}

export function ChartTooltip({
  open,
  x,
  y,
  title,
  rows,
}: {
  open: boolean
  x: number
  y: number
  title: string
  rows: TooltipRow[]
}) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 180, height: 72 })
  const signature = `${title}|${rows.map((row) => `${row.key}:${row.value}`).join('|')}`

  useLayoutEffect(() => {
    if (!open) return
    const node = panelRef.current
    if (!node) return
    setSize({ width: node.offsetWidth, height: node.offsetHeight })
  }, [open, signature])

  const margin = 8
  let left = x + 12
  let top = y + 14
  if (typeof window !== 'undefined') {
    if (left + size.width > window.innerWidth - margin) left = x - size.width - 12
    if (top + size.height > window.innerHeight - margin) top = y - size.height - 14
    left = Math.max(margin, left)
    top = Math.max(margin, top)
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panelRef}
          role="tooltip"
          initial={reduce ? false : { opacity: 0, scale: SCALE_SMALL }}
          animate={{ opacity: 1, scale: 1, transition: reduce ? { duration: 0 } : { duration: DURATION_QUICK, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.05 } }}
          className="pointer-events-none fixed w-max min-w-44 max-w-72 overflow-hidden rounded-[10px] bg-ink-900 shadow-(--shadow-overlay)"
          style={{ zIndex: 'var(--z-tooltip)', left, top }}
        >
          <div className="bg-ink-950/40 px-3 py-2">
            <p className="truncate text-label font-medium text-ink-0">{title}</p>
          </div>
          <div className="flex flex-col gap-1 px-3 py-2">
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2">
                <span aria-hidden className="mt-1 size-2 rounded-full" style={{ background: row.color }} />
                <span className="truncate text-caption text-ink-0/75">{row.label}</span>
                <span className="text-caption tabular-nums text-ink-0">{row.value}</span>
              </div>
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
