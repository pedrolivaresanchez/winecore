import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { copy, fill } from '@/i18n'
import { BandLabels, CHART_FOCUS, ChartSvg, Crosshair, FoldedNote, GoalLine, GridTicks, anchorAt, keyStep, useChartWidth, useFolded } from './frame'
import { bands, curvePath, formatTick, linearY, niceTicks, pathLength, plotArea, valueText, type ChartModel } from './model'
import { ChartTooltip, type TooltipPayload } from './tooltip'

type Hover = { index: number; x: number; y: number }

/** SDR's line chart (`line` variant): a 2px monotone stroke over a soft 6px halo, crosshair and ringed dots on hover. */
export function LineChart({ model: input, height = 240, subtitle }: { model: ChartModel; height?: number; subtitle?: string }) {
  const { model, folded } = useFolded(input, 24)
  const plotHeight = height - (folded ? 18 : 0)
  const { ref, width } = useChartWidth(plotHeight)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const { ticks, domain } = useMemo(() => niceTicks(model.min, model.max), [model.min, model.max])
  const plot = plotArea(width, plotHeight, ticks, (tick) => formatTick(tick, model.measureType))
  const y = linearY(domain, plot.top, plot.height)
  const count = model.categories.length
  const band = bands(count, plot.left, plot.width, 0)
  const xAt = (index: number) => (count === 1 ? plot.left + plot.width / 2 : band.center(index))

  const lines = model.series.map((series, seriesIndex) => {
    const points = model.categories.map((category, index) => ({
      x: xAt(index),
      y: y(category.values[seriesIndex] ?? 0),
      gap: category.gaps?.[seriesIndex] ?? false,
    }))
    const runs = points
      .reduce<(typeof points)[]>((all, point) => {
        if (point.gap) all.push([])
        else all[all.length - 1].push(point)
        return all
      }, [[]])
      .filter((run) => run.length > 0)
    return { series, points, runs, length: runs.reduce((sum, run) => sum + pathLength(run), 0) }
  })

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
      })),
      total: model.series.length > 1 && !model.comparison ? { label: copy.charts.total, value: category.total } : null,
      goal: model.goal == null ? null : { label: copy.charts.goal, value: model.goals?.[hover.index] ?? model.goal },
      members: category.members ?? null,
    }
  }, [hover, model, subtitle])

  return (
    <>
      <ChartSvg
        innerRef={ref}
        svgRef={svgRef}
        width={width}
        height={plotHeight}
        label={fill(copy.charts.lineLabel, { dimension: model.categoryLabel ?? '' })}
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
          const at = anchorAt(svgRef.current, xAt(next), y(model.categories[next].total))
          if (at) setHover({ index: next, ...at })
        }}
        onBlur={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const px = event.clientX - box.left
          if (px < plot.left - 4 || px > plot.left + plot.width + 4) {
            setHover(null)
            return
          }
          const index = band.indexAt(px)
          if (index < 0) {
            setHover(null)
            return
          }
          setHover({ index, x: event.clientX, y: event.clientY })
        }}
        onPointerLeave={() => setHover(null)}
      >
        <GridTicks plot={plot} ticks={ticks} y={y} type={model.measureType} />
        {hover ? <Crosshair plot={plot} x={xAt(hover.index)} /> : null}
        {lines.map(({ series, runs, length }) => {
          const d = runs.map((run) => (run.length === 1 ? `M ${run[0].x} ${run[0].y} h 0.01` : curvePath(run))).join(' ')
          const draw = { '--chart-length': `${length}`, strokeDasharray: length, animation: 'var(--animate-chart-draw)' } as CSSProperties
          return (
            <g key={series.key}>
              <path d={d} fill="none" stroke={series.color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.1} style={draw} />
              <path d={d} fill="none" stroke={series.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={draw} />
            </g>
          )
        })}
        {hover
          ? lines.map(({ series, points }) => {
              const point = points[hover.index]
              if (!point || point.gap) return null
              return (
                <g key={`dot-${series.key}`}>
                  <circle cx={point.x} cy={point.y} r={7} fill={series.color} opacity={0.16} />
                  <circle cx={point.x} cy={point.y} r={3.5} fill="var(--color-surface)" stroke={series.color} strokeWidth={2} />
                </g>
              )
            })
          : null}
        {model.goal == null ? null : (
          <GoalLine
            plot={plot}
            y={y(model.goal)}
            points={model.goals?.map((goal, index) => [band.center(index), y(goal)] as [number, number]) ?? null}
            label={copy.charts.goal}
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
