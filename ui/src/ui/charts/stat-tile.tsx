import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Info } from '@/ui/icons'
import { Tooltip } from '@/ui/tooltip'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { useChartWidth } from './frame'
import { curvePath, deltaOf, formatValue, type MeasureType } from './model'

export type Polarity = 'neutral' | 'up-good' | 'down-good'

/** SDR's KPI tile: caption label, 24px figure, the change against the previous period and an optional sparkline. */
export function StatTile({
  label,
  value,
  type = 'number',
  formatted,
  previous,
  previousText,
  spark,
  polarity = 'neutral',
  hint,
  explain,
  onClick,
  href,
  className,
}: {
  label: string
  value: number
  type?: MeasureType
  formatted?: ReactNode
  previous?: number | null
  previousText?: string
  spark?: number[]
  polarity?: Polarity
  hint?: ReactNode
  explain?: string
  onClick?: () => void
  href?: string
  className?: string
}) {
  const delta = previous == null ? null : deltaOf(value, previous)
  const good = delta === null || delta.direction === 0 || polarity === 'neutral' ? null : polarity === 'up-good' ? delta.direction === 1 : delta.direction === -1
  const interactive = !!(onClick || href)
  const face = cn(
    'flex min-w-0 flex-col gap-1 rounded-[10px] border border-border-subtle bg-surface-subtle px-3 py-2.5 text-left',
    interactive &&
      'outline-none transition-colors duration-(--duration-quick) ease-(--ease-smooth-out) hover:border-border hover:bg-surface focus-visible:shadow-(--shadow-focus)',
    className,
  )
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1 text-caption text-text-tertiary">
        <span className="truncate" title={label}>
          {label}
        </span>
        {explain ? (
          <Tooltip label={explain} placement="top">
            <span
              tabIndex={0}
              role="note"
              aria-label={explain}
              className="-m-1 shrink-0 cursor-help rounded-[6px] p-1 text-text-tertiary outline-none transition-colors duration-(--duration-quick) hover:text-ink-900 focus-visible:shadow-(--shadow-focus)"
            >
              <Info className="size-3" strokeWidth={iconStroke} />
            </span>
          </Tooltip>
        ) : null}
      </span>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 text-heading font-medium leading-none tabular-nums text-ink-900">{formatted ?? formatValue(value, type)}</span>
        {delta ? (
          <span
            className={cn(
              'flex shrink-0 items-center gap-0.5 text-caption font-medium tabular-nums',
              good === null ? 'text-text-tertiary' : good ? 'text-success-700' : 'text-danger-700',
            )}
            title={fill(copy.charts.vsPrevious, { value: previousText ?? formatValue(previous ?? 0, type) })}
          >
            {delta.direction === 1 ? <ArrowUp className="size-3" strokeWidth={iconStroke} /> : delta.direction === -1 ? <ArrowDown className="size-3" strokeWidth={iconStroke} /> : null}
            {delta.text}
          </span>
        ) : null}
      </div>
      {spark && spark.length >= 3 ? <Sparkline values={spark} /> : null}
      {hint ? <span className="truncate text-caption text-text-tertiary">{hint}</span> : null}
    </>
  )
  if (href) {
    return (
      <Link to={href} className={face}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={face}>
        {body}
      </button>
    )
  }
  return <div className={face}>{body}</div>
}

export function Sparkline({ values }: { values: number[] }) {
  const { ref, width } = useChartWidth(24)
  if (width === 0) return <div ref={ref} style={{ height: 24 }} />
  const high = Math.max(...values)
  const low = Math.min(...values, 0)
  const span = high - low || 1
  const points = values.map((value, index) => ({ x: (index / Math.max(1, values.length - 1)) * width, y: 22 - ((value - low) / span) * 20 }))
  const last = points[points.length - 1]
  return (
    <div ref={ref} className="w-full" style={{ height: 24 }}>
      <svg width={width} height={24} aria-hidden className="overflow-visible">
        <path d={curvePath(points)} fill="none" stroke="var(--color-chart-ink)" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={2} fill="var(--color-chart-ink-hover)" />
      </svg>
    </div>
  )
}
