import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/cn'
import { DURATION_QUICK, EASE_OUT } from '@/lib/motion'
import { formatShare, formatValue, type ChartMember, type MeasureType } from './model'

export type TooltipRow = {
  key: string
  label: string
  color: string
  value: number | null
  type?: MeasureType
  share?: boolean
  active?: boolean
}

export type TooltipPayload = {
  x: number
  y: number
  title: string
  subtitle?: string
  rows: TooltipRow[]
  total?: { label: string; value: number } | null
  goal?: { label: string; value: number } | null
  members?: ChartMember[] | null
  hint?: string
  /** Formats a value of the row's type; percent rows stay SDR's. */
  format?: (value: number, type: MeasureType) => string
}

const MAX_ROWS_HEIGHT = 280
const MAX_MEMBERS = 8

function place(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options?: { gap?: number; edge?: number; minWidth?: number },
) {
  const gap = options?.gap ?? 14
  const edge = options?.edge ?? 8
  const width = size.width || (options?.minWidth ?? 208)
  const height = size.height
  const roomRight = viewport.width - edge - point.x - gap
  const flip = point.x - edge - gap >= roomRight
  const left = flip ? point.x - gap - width : point.x + gap
  return {
    left: Math.min(Math.max(edge, left), Math.max(edge, viewport.width - edge - width)),
    top: height ? Math.min(Math.max(edge, point.y - height / 2), Math.max(edge, viewport.height - edge - height)) : Math.max(edge, point.y),
    originX: flip ? ('right' as const) : ('left' as const),
  }
}

/** SDR's chart tooltip: an ink card beside the pointer, title band, swatch rows, total and goal. */
export function ChartTooltip({ payload }: { payload: TooltipPayload | null }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const open = payload !== null

  useLayoutEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return
    const read = () => {
      const next = { width: node.offsetWidth, height: node.offsetHeight }
      setSize((current) => (Math.abs(current.width - next.width) > 0.5 || Math.abs(current.height - next.height) > 0.5 ? next : current))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [open])

  const at = payload
    ? place(payload, size, {
        width: typeof window === 'undefined' ? 0 : window.innerWidth,
        height: typeof window === 'undefined' ? 0 : window.innerHeight,
      })
    : { left: 0, top: 0, originX: 'left' as const }
  const shares = !!payload?.rows.some((row) => row.share)
  const type = payload?.rows[0]?.type ?? 'number'
  const text = (value: number, rowType: MeasureType) => (payload?.format ? payload.format(value, rowType) : formatValue(value, rowType))
  const grid = cn(
    'grid w-full min-w-0 items-baseline gap-x-2 gap-y-1',
    shares ? 'grid-cols-[auto_minmax(0,1fr)_auto_auto]' : 'grid-cols-[auto_minmax(0,1fr)_auto]',
  )

  return createPortal(
    <AnimatePresence>
      {payload ? (
        <motion.div
          ref={ref}
          role="tooltip"
          aria-live="polite"
          initial={!reduce && { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1, transition: reduce ? { duration: 0 } : { duration: DURATION_QUICK, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.05, ease: EASE_OUT } }}
          className={cn(
            'pointer-events-none isolate fixed w-max min-w-52 max-w-80 overflow-hidden rounded-[10px]',
            'bg-ink-900 shadow-(--shadow-overlay)',
          )}
          style={{
            zIndex: 'var(--z-tooltip)',
            left: at.left,
            top: at.top,
            transformOrigin: at.originX === 'left' ? 'left center' : 'right center',
          }}
        >
          <div className="bg-ink-950/40 px-3 py-2">
            <p className="text-label font-medium text-ink-0">{payload.title}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2">
            {payload.subtitle ? <p className="text-caption text-ink-0/60">{payload.subtitle}</p> : null}
            <div className={cn(grid, 'scrollbar-none overflow-y-auto')} style={{ maxHeight: MAX_ROWS_HEIGHT }}>
              {payload.rows.map((row) => (
                <Row key={row.key} row={row} total={payload.total?.value} shareColumn={shares} text={text} />
              ))}
              {payload.total || payload.goal ? <div className="col-span-full mt-0.5 border-t border-ink-0/15" /> : null}
              {payload.total ? <Summary label={payload.total.label} value={text(payload.total.value, type)} shareColumn={shares} strong /> : null}
              {payload.goal ? <Summary label={payload.goal.label} value={text(payload.goal.value, type)} shareColumn={shares} mark="goal" /> : null}
            </div>
            {payload.members?.length ? (
              <div className="mt-0.5 flex flex-col gap-1 border-t border-ink-0/15 pt-1.5">
                {payload.members.slice(0, MAX_MEMBERS).map((member) => (
                  <div key={member.label} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-caption text-ink-0/60">{member.label}</span>
                    <span className="shrink-0 text-caption tabular-nums text-ink-0/75">{text(member.total, type)}</span>
                  </div>
                ))}
                {payload.members.length > MAX_MEMBERS ? (
                  <span className="text-caption tabular-nums text-ink-0/45">{`+${payload.members.length - MAX_MEMBERS}`}</span>
                ) : null}
              </div>
            ) : null}
            {payload.hint ? <p className="text-caption text-ink-0/45">{payload.hint}</p> : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

function Row({
  row,
  total,
  shareColumn,
  text,
}: {
  row: TooltipRow
  total: number | undefined
  shareColumn: boolean
  text: (value: number, type: MeasureType) => string
}) {
  return (
    <Fragment>
      <span aria-hidden className="mt-[3px] size-2 shrink-0 self-start rounded-full" style={{ background: row.color }} />
      <span className={cn('min-w-0 truncate text-caption', row.active ? 'font-medium text-ink-0' : 'text-ink-0/75')}>{row.label}</span>
      <span className={cn('shrink-0 text-right text-caption tabular-nums', row.active ? 'font-medium text-ink-0' : 'text-ink-0/90')}>
        {row.value === null ? '—' : text(row.value, row.type ?? 'number')}
      </span>
      {shareColumn ? (
        <span className="w-10 shrink-0 text-right text-caption tabular-nums text-ink-0/50">
          {row.share && total && row.value !== null ? formatShare(row.value, total) : ''}
        </span>
      ) : null}
    </Fragment>
  )
}

function Summary({ label, value, shareColumn, strong, mark }: { label: string; value: string; shareColumn: boolean; strong?: boolean; mark?: 'goal' }) {
  return (
    <Fragment>
      {mark === 'goal' ? (
        <span aria-hidden className="mt-1 h-px w-2 shrink-0 self-start bg-ink-0/40" />
      ) : (
        <span aria-hidden className="size-2 shrink-0" />
      )}
      <span className="min-w-0 truncate text-caption text-ink-0/60">{label}</span>
      <span className={cn('shrink-0 text-right text-caption tabular-nums text-ink-0', strong && 'font-medium')}>{value}</span>
      {shareColumn ? <span className="w-10 shrink-0" /> : null}
    </Fragment>
  )
}
