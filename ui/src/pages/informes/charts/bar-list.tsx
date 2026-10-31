import { useState } from 'react'
import { cn } from '@/lib/cn'
import { SERIES_CURRENT, SERIES_PREVIOUS, type ChartDatum } from '@/lib/chart-scale'
import { ChartTooltip, type TooltipRow } from '@/pages/informes/charts/tooltip'

export function BarList({
  points,
  label,
  currentLabel,
  previousLabel,
  formatValue,
  color = SERIES_CURRENT,
}: {
  points: ChartDatum[]
  label: string
  currentLabel: string
  previousLabel: string
  formatValue: (value: number) => string
  /** The current series. Defaults to the chart ink; a subject passes its `SERIES_TONE`. */
  color?: string
}) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const max = Math.max(1, ...points.map((point) => Math.max(Math.abs(point.value), Math.abs(point.previous ?? 0))))
  const active = hover ? points[hover.index] : null
  const rows: TooltipRow[] = active
    ? [
        { key: 'current', label: currentLabel, color, value: formatValue(active.value) },
        ...(active.previous != null
          ? [{ key: 'previous', label: previousLabel, color: SERIES_PREVIOUS, value: formatValue(active.previous) }]
          : []),
      ]
    : []

  return (
    <div role="list" aria-label={label} className="flex flex-col">
      {points.map((point, index) => {
        const dim = hover != null && hover.index !== index
        return (
          <div
            key={point.key}
            role="listitem"
            tabIndex={0}
            aria-label={`${point.label}: ${formatValue(point.value)}`}
            className="flex items-center gap-3 rounded-[6px] px-1.5 py-1 outline-none focus-visible:shadow-(--shadow-focus)"
            onPointerMove={(event) => setHover({ index, x: event.clientX, y: event.clientY })}
            onPointerLeave={() => setHover(null)}
            onFocus={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              setHover({ index, x: box.left + box.width / 2, y: box.top })
            }}
            onBlur={() => setHover(null)}
          >
            <span className={cn('w-28 shrink-0 truncate text-caption sm:w-44', dim ? 'text-text-tertiary' : 'text-text-secondary')} title={point.label}>
              {point.label}
            </span>
            <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-(--color-chart-track)">
              {point.previous != null ? (
                <span
                  className="absolute inset-y-0 left-0 rounded-[4px] opacity-45"
                  style={{ width: `${Math.max(point.previous === 0 ? 0 : 2, (Math.abs(point.previous) / max) * 100)}%`, background: SERIES_PREVIOUS }}
                />
              ) : null}
              <span
                className="absolute inset-y-1 left-0 rounded-[3px]"
                style={{
                  width: `${Math.max(point.value === 0 ? 0 : 2, (Math.abs(point.value) / max) * 100)}%`,
                  background: color,
                  opacity: dim ? 0.45 : 1,
                }}
              />
            </span>
            <span className={cn('w-24 shrink-0 text-right text-caption tabular-nums sm:w-28', dim ? 'text-text-tertiary' : 'font-medium text-ink-900')}>
              {formatValue(point.value)}
            </span>
          </div>
        )
      })}
      <ChartTooltip open={active != null && hover != null} x={hover?.x ?? 0} y={hover?.y ?? 0} title={active?.label ?? ''} rows={rows} />
    </div>
  )
}
