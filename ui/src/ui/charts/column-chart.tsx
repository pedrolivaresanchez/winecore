import { useMemo, useRef, useState } from 'react'
import { copy, fill } from '@/i18n'
import { BandLabels, CHART_FOCUS, ChartSvg, FoldedNote, GoalLine, GridTicks, HoverBand, anchorAt, keyStep, useChartWidth, useFolded } from './frame'
import { bands, fillFor, formatTick, linearY, niceTicks, plotArea, roundedTopBar, valueText, type ChartModel } from './model'
import { ChartTooltip, type TooltipPayload } from './tooltip'

type Hover = { index: number; series: number | null; x: number; y: number }

/** SDR's column chart: grouped or stacked round-topped columns, dashed grid, band hover, ink tooltip. */
export function ColumnChart({ model: input, height = 240, subtitle, goalLabel }: { model: ChartModel; height?: number; subtitle?: string; goalLabel?: string }) {
  const { model, folded } = useFolded(input, 24)
  const plotHeight = height - (folded ? 18 : 0)
  const { ref, width } = useChartWidth(plotHeight)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const { ticks, domain } = useMemo(() => niceTicks(model.min, model.max), [model.min, model.max])
  const plot = plotArea(width, plotHeight, ticks, (tick) => formatTick(tick, model.measureType))
  const y = linearY(domain, plot.top, plot.height)
  const zero = y(0)
  const count = model.categories.length
  const padding = count > 40 ? 0.12 : count > 20 ? 0.18 : 0.3
  const band = bands(count, plot.left, plot.width, padding)
  const barWidth = model.stacked ? band.barWidth : band.barWidth / Math.max(1, model.series.length)
  const totals = model.stacked ? count <= 24 && band.barWidth >= 18 : false

  const payload = useMemo<TooltipPayload | null>(() => {
    if (!hover) return null
    const category = model.categories[hover.index]
    if (!category) return null
    return {
      x: hover.x,
      y: hover.y,
      title: category.label || copy.charts.unassigned,
      subtitle,
      format: (value, type) => valueText(model, value, type),
      rows: model.series.map((series, index) => ({
        key: series.key,
        label: series.label,
        color: series.color,
        value: category.gaps?.[index] ? null : (category.values[index] ?? 0),
        type: series.type,
        share: model.series.length > 1 && !model.comparison && series.type !== 'percent',
        active: hover.series === index,
      })),
      total: model.series.length > 1 && !model.comparison ? { label: copy.charts.total, value: category.total } : null,
      goal: model.goal == null ? null : { label: goalLabel ?? copy.charts.goal, value: model.goals?.[hover.index] ?? model.goal },
      members: category.members ?? null,
    }
  }, [goalLabel, hover, model, subtitle])

  function stackAt(index: number, pointerY: number): number | null {
    const category = model.categories[index]
    if (!category || !model.stacked) return null
    let base = 0
    for (let series = 0; series < model.series.length; series += 1) {
      const value = category.values[series] ?? 0
      if (value <= 0) continue
      const top = y(base + value)
      const bottom = y(base)
      if (pointerY >= top && pointerY <= bottom) return series
      base += value
    }
    return null
  }

  return (
    <>
      <ChartSvg
        innerRef={ref}
        svgRef={svgRef}
        width={width}
        height={plotHeight}
        label={fill(copy.charts.columnLabel, { dimension: model.categoryLabel ?? '' })}
        svgClassName={CHART_FOCUS}
        tabIndex={0}
        onKeyDown={(event) => {
          const next = keyStep(event.key, hover?.index ?? null, count)
          if (next === undefined || next === 'activate') return
          event.preventDefault()
          if (next === null) {
            setHover(null)
            return
          }
          const at = anchorAt(svgRef.current, band.center(next), plot.top)
          if (at) setHover({ index: next, series: null, ...at })
        }}
        onBlur={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const px = event.clientX - box.left
          const py = event.clientY - box.top
          if (px < plot.left || px > plot.left + plot.width) {
            setHover(null)
            return
          }
          const index = band.indexAt(px)
          if (index < 0) {
            setHover(null)
            return
          }
          setHover({ index, series: stackAt(index, py), x: event.clientX, y: event.clientY })
        }}
        onPointerLeave={() => setHover(null)}
      >
        <GridTicks plot={plot} ticks={ticks} y={y} type={model.measureType} />
        {hover ? <HoverBand plot={plot} x={band.bandStart(hover.index)} width={band.band} /> : null}
        <g style={{ transformOrigin: `0px ${zero}px`, animation: 'var(--animate-chart-rise)' }}>
          {model.categories.map((category, index) => {
            let base = 0
            return (
              <g key={`${category.key}-${index}`}>
                {model.series.map((series, seriesIndex) => {
                  const value = category.values[seriesIndex] ?? 0
                  if (value === 0) return null
                  let top: number
                  let size: number
                  let left: number
                  if (model.stacked) {
                    const from = base
                    const to = base + value
                    base = to
                    top = y(Math.max(from, to))
                    size = Math.abs(y(to) - y(from))
                    left = band.barStart(index)
                  } else {
                    top = value >= 0 ? y(value) : zero
                    size = Math.abs(y(value) - zero)
                    left = band.barStart(index) + seriesIndex * barWidth
                  }
                  const capped = !model.stacked || model.series.every((_, other) => other <= seriesIndex || (category.values[other] ?? 0) === 0)
                  const dimmed = hover !== null && hover.index !== index
                  return (
                    <path
                      key={series.key}
                      d={roundedTopBar(left, top, Math.max(1, barWidth), size, capped ? 3 : 0)}
                      fill={fillFor(model, category, seriesIndex)}
                      className="transition-opacity duration-(--duration-quick) ease-(--ease-smooth-out)"
                      opacity={dimmed ? 0.45 : 1}
                    />
                  )
                })}
              </g>
            )
          })}
        </g>
        {totals
          ? model.categories.map((category, index) =>
              category.total === 0 ? null : (
                <text
                  key={`label-${category.key}-${index}`}
                  x={band.center(index)}
                  y={y(category.total) - 4}
                  textAnchor="middle"
                  className="fill-(--color-chart-axis) text-chart-annotation tabular-nums"
                >
                  {formatTick(category.total, model.measureType)}
                </text>
              ),
            )
          : null}
        {model.goal == null ? null : (
          <GoalLine
            plot={plot}
            y={y(model.goal)}
            points={model.goals?.map((goal, index) => [band.center(index), y(goal)] as [number, number]) ?? null}
            label={goalLabel ?? copy.charts.goal}
            hideLabel={hover !== null}
          />
        )}
        <BandLabels plot={plot} band={band} labels={model.categories.map((category) => category.label)} />
      </ChartSvg>
      <FoldedNote folded={folded} model={model} />
      <ChartTooltip payload={payload} />
    </>
  )
}
