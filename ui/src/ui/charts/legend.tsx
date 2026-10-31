import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { type ChartModel, type ChartSeries, type MeasureType, valueText } from './model'

/** SDR's series legend: swatch + name chips; a click hides a series, Alt-click or a double click keeps only it. */
export function ChartLegend({
  series,
  hidden,
  onToggle,
  onIsolate,
  values,
  measureType,
  model,
  className,
}: {
  series: ChartSeries[]
  hidden: Set<string>
  onToggle: (key: string) => void
  onIsolate?: (key: string) => void
  values?: Record<string, number>
  measureType?: MeasureType
  model?: Pick<ChartModel, 'format'>
  className?: string
}) {
  if (series.length <= 1) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {series.map((entry) => {
        const off = hidden.has(entry.key)
        return (
          <button
            key={entry.key}
            type="button"
            onClick={(event) => {
              if (onIsolate && (event.altKey || event.detail >= 2)) onIsolate(entry.key)
              else onToggle(entry.key)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !event.altKey || !onIsolate) return
              event.preventDefault()
              onIsolate(entry.key)
            }}
            aria-pressed={!off}
            title={fill(off ? copy.charts.legendShow : copy.charts.legendHide, { name: entry.label })}
            className={cn(
              'group flex max-w-52 items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-caption',
              'transition-[background-color,opacity] duration-(--duration-quick) ease-(--ease-smooth-out)',
              'hover:bg-fill-hover',
              off ? 'opacity-45' : 'opacity-100',
            )}
          >
            <span
              aria-hidden
              className={cn('size-2 shrink-0 rounded-full', off && 'ring-1 ring-inset ring-border-strong')}
              style={{ background: off ? 'transparent' : entry.color }}
            />
            <span className={cn('min-w-0 truncate', off ? 'text-text-tertiary line-through' : 'text-text-secondary')}>{entry.label}</span>
            {values && entry.key in values && !off ? (
              <span className="shrink-0 tabular-nums text-text-tertiary">{valueText(model ?? {}, values[entry.key] ?? 0, measureType ?? 'number')}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Hides legend-toggled series from a model, keeping at least one. */
export function visibleModel(model: ChartModel, hidden: Set<string>): ChartModel {
  if (hidden.size === 0) return model
  const keep = model.series.map((entry, index) => ({ entry, index })).filter(({ entry }) => !hidden.has(entry.key))
  if (keep.length === 0) return model
  const categories = model.categories.map((category) => {
    const values = keep.map(({ index }) => category.values[index] ?? 0)
    return {
      ...category,
      values,
      gaps: category.gaps ? keep.map(({ index }) => category.gaps?.[index] ?? false) : undefined,
      total: values.reduce((sum, value) => sum + value, 0),
    }
  })
  const all = categories.flatMap((category) => (model.stacked ? [category.total, ...category.values] : category.values))
  return {
    ...model,
    series: keep.map(({ entry }) => entry),
    categories,
    max: Math.max(0, ...all, model.goal ?? 0),
    min: Math.min(0, ...all),
  }
}
