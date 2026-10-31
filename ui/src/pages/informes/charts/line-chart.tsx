import { useRef, useState } from 'react'
import { ChartTooltip, type TooltipRow } from '@/pages/informes/charts/tooltip'
import { formatAxis } from '@/lib/reports'
import {
  SERIES_CURRENT,
  SERIES_PREVIOUS,
  clientPoint,
  niceScale,
  plotBox,
  useElementWidth,
  yAt,
  type ChartDatum,
} from '@/lib/chart-scale'

function linePath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export function LineChart({
  points,
  height = 240,
  label,
  currentLabel,
  previousLabel,
  formatValue,
}: {
  points: ChartDatum[]
  height?: number
  label: string
  currentLabel: string
  previousLabel: string
  formatValue: (value: number) => string
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [index, setIndex] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const compare = points.some((point) => point.previous != null)
  const values = points.flatMap((point) => [point.value, point.previous ?? 0])
  const scale = niceScale(Math.min(...values, 0), Math.max(...values, 0))
  const plot = plotBox(width, height)
  const y = yAt(scale.min, scale.max, plot.top, plot.height)
  const count = Math.max(1, points.length)
  const band = plot.width / count
  const xAt = (pointIndex: number) => (count === 1 ? plot.left + plot.width / 2 : plot.left + band * pointIndex + band / 2)
  const step = band >= 48 ? 1 : band >= 28 ? 2 : Math.ceil(32 / Math.max(band, 1))
  const baseline = y(Math.max(0, scale.min))
  const current = points.map((point, pointIndex) => ({ x: xAt(pointIndex), y: y(point.value) }))
  const previous = points.map((point, pointIndex) => ({ x: xAt(pointIndex), y: y(point.previous ?? 0) }))
  const active = index != null ? points[index] : null
  const rows: TooltipRow[] = active
    ? [
        { key: 'current', label: currentLabel, color: SERIES_CURRENT, value: formatValue(active.value) },
        ...(active.previous != null
          ? [{ key: 'previous', label: previousLabel, color: SERIES_PREVIOUS, value: formatValue(active.previous) }]
          : []),
      ]
    : []
  const tip =
    pointer ??
    (active && index != null ? clientPoint(svgRef.current, xAt(index), y(active.value), width, height) : null)

  function move(next: number, point: { x: number; y: number } | null) {
    if (next < 0 || next >= points.length) {
      setIndex(null)
      setPointer(null)
      return
    }
    setIndex(next)
    setPointer(point)
  }

  return (
    <div
      ref={ref}
      role="group"
      tabIndex={0}
      aria-label={label}
      className="relative outline-none focus-visible:shadow-(--shadow-focus)"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          move(-1, null)
          return
        }
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const next = index == null ? 0 : index + (event.key === 'ArrowRight' ? 1 : -1)
        const point = clientPoint(svgRef.current, xAt(next), plot.top + plot.height / 2, width, height)
        move(next, point)
      }}
      onBlur={() => move(-1, null)}
    >
      <span className="sr-only" aria-live="polite">
        {active ? `${active.label}: ${formatValue(active.value)}` : ''}
      </span>
      {width > 0 ? (
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="presentation"
          style={{ fontFamily: 'inherit' }}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const local = ((event.clientX - box.left) / Math.max(box.width, 1)) * width
            const next = Math.round((local - plot.left - band / 2) / Math.max(band, 1))
            move(Math.max(0, Math.min(points.length - 1, next)), { x: event.clientX, y: event.clientY })
          }}
          onPointerLeave={() => move(-1, null)}
        >
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={plot.left}
                x2={plot.left + plot.width}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? 'var(--color-chart-rule)' : 'var(--color-chart-grid)'}
                strokeWidth={1}
              />
              <text
                x={plot.left - 6}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--color-chart-axis)"
                fontSize={12}
              >
                {formatAxis(tick)}
              </text>
            </g>
          ))}
          {!compare && current.length > 0 ? (
            <path d={`${linePath(current)} L ${current[current.length - 1]?.x ?? 0} ${baseline} L ${current[0]?.x ?? 0} ${baseline} Z`} fill={SERIES_CURRENT} fillOpacity={0.14} />
          ) : null}
          {compare ? (
            <path d={linePath(previous)} fill="none" stroke={SERIES_PREVIOUS} strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
          <path d={linePath(current)} fill="none" stroke={SERIES_CURRENT} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {index != null ? (
            <line x1={xAt(index)} x2={xAt(index)} y1={plot.top} y2={plot.top + plot.height} stroke="var(--color-chart-rule)" strokeWidth={1} />
          ) : null}
          {points.length === 1 ? (
            <circle cx={xAt(0)} cy={y(points[0]?.value ?? 0)} r={3.5} fill={SERIES_CURRENT} />
          ) : null}
          {index != null && points.length > 1 ? (
            <circle cx={xAt(index)} cy={y(points[index]?.value ?? 0)} r={3.5} fill="var(--color-surface)" stroke={SERIES_CURRENT} strokeWidth={1.75} />
          ) : null}
          {points.map((point, pointIndex) =>
            pointIndex % step === 0 || pointIndex === points.length - 1 ? (
              <text
                key={point.key}
                x={xAt(pointIndex)}
                y={plot.top + plot.height + 16}
                textAnchor="middle"
                fill="var(--color-chart-axis)"
                fontSize={12}
              >
                {point.axis}
              </text>
            ) : null,
          )}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <ChartTooltip open={active != null && tip != null} x={tip?.x ?? 0} y={tip?.y ?? 0} title={active?.label ?? ''} rows={rows} />
    </div>
  )
}
