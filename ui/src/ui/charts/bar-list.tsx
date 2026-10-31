import { useState } from 'react'
import { copy } from '@/i18n'
import { cn } from '@/lib/cn'
import { FoldedNote, useFolded } from './frame'
import { fillFor, formatShare, valueText, type ChartModel } from './model'
import { ChartTooltip, type TooltipPayload } from './tooltip'

type Hover = { index: number; x: number; y: number }

/** SDR's ranked bar list: label, a 16px bar on the track, the figure and its share. */
export function BarList({
  model: input,
  subtitle,
  hideEmpty = false,
  showShare = true,
  max = 20,
  className,
}: {
  model: ChartModel
  subtitle?: string
  hideEmpty?: boolean
  showShare?: boolean
  max?: number
  className?: string
}) {
  const { model, folded } = useFolded(input, max)
  const [hover, setHover] = useState<Hover | null>(null)
  const rows = model.categories.map((category, index) => ({ category, index })).filter(({ category }) => !hideEmpty || category.total !== 0)
  const peak = Math.max(1, ...model.categories.map((category) => Math.abs(category.total)))
  const sum = model.categories.reduce((total, category) => total + category.total, 0)
  const multi = model.series.length > 1

  let payload: TooltipPayload | null = null
  const hovered = hover ? model.categories[hover.index] : null
  if (hover && hovered) {
    payload = {
      x: hover.x,
      y: hover.y,
      title: hovered.label || copy.charts.unassigned,
      subtitle,
      format: (value, type) => valueText(model, value, type),
      rows: multi
        ? model.series.map((series, index) => ({
            key: series.key,
            label: series.label,
            color: series.color,
            value: hovered.values[index] ?? 0,
            type: series.type,
            share: !model.comparison,
          }))
        : [
            {
              key: 'value',
              label: model.series[0]?.label ?? copy.charts.value,
              color: fillFor(model, hovered),
              value: model.series.length === 1 && hovered.gaps?.[0] ? null : hovered.total,
              type: model.measureType,
            },
          ],
      total: multi && !model.comparison ? { label: copy.charts.total, value: hovered.total } : null,
      members: hovered.members ?? null,
    }
  }

  return (
    <>
      <div className={cn('flex flex-col', className)}>
        {rows.map(({ category, index }) => {
          const ratio = Math.abs(category.total) / peak
          const dimmed = hover !== null && hover.index !== index
          return (
            <div
              key={`${category.key}-${index}`}
              onPointerMove={(event) => setHover({ index, x: event.clientX, y: event.clientY })}
              onPointerLeave={() => setHover(null)}
              className={cn(
                'group flex items-center gap-3 rounded-[6px] px-1.5 py-1 text-left',
                'transition-colors duration-(--duration-quick) ease-(--ease-smooth-out)',
              )}
            >
              <span className={cn('w-32 shrink-0 truncate text-caption sm:w-40', dimmed ? 'text-text-tertiary' : 'text-text-secondary')} title={category.label}>
                {category.label || copy.charts.unassigned}
              </span>
              <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-[4px] bg-(--color-chart-track)">
                <span
                  className="absolute inset-y-0 left-0 flex overflow-hidden rounded-[4px] transition-[width,opacity] duration-(--duration-slow) ease-(--ease-smooth-out)"
                  style={{ width: `${Math.max(category.total === 0 ? 0 : 1.5, ratio * 100)}%`, opacity: dimmed ? 0.5 : 1 }}
                >
                  {multi ? (
                    model.series.map((series, seriesIndex) => {
                      const value = category.values[seriesIndex] ?? 0
                      if (value <= 0) return null
                      return <span key={series.key} className="h-full" style={{ background: series.color, width: `${(value / Math.max(1, category.total)) * 100}%` }} />
                    })
                  ) : (
                    <span className="h-full w-full" style={{ background: fillFor(model, category) }} />
                  )}
                </span>
              </span>
              <span className={cn('w-16 shrink-0 text-right text-caption tabular-nums sm:w-20', dimmed ? 'text-text-tertiary' : 'font-medium text-ink-900')}>
                {valueText(model, category.total, model.measureType)}
              </span>
              {showShare && sum > 0 ? (
                <span className="hidden w-10 shrink-0 text-right text-caption tabular-nums text-text-tertiary sm:block">{formatShare(category.total, sum)}</span>
              ) : null}
            </div>
          )
        })}
      </div>
      <FoldedNote folded={folded} model={model} />
      <ChartTooltip payload={payload} />
    </>
  )
}
