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

export function ColumnChart({
  points,
  height = 240,
  label,
  currentLabel,
  previousLabel,
  formatValue,
  color = SERIES_CURRENT,
}: {
  points: ChartDatum[]
  height?: number
  label: string
  currentLabel: string
  previousLabel: string
  formatValue: (value: number) => string
  /** The current series. Defaults to the chart ink; a subject passes its `SERIES_TONE`. */
  color?: string
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
  const series = compare ? 2 : 1
  const inner = Math.max(2, band * (count > 16 ? 0.72 : 0.62))
  const barWidth = Math.max(1, (inner - (series - 1) * 2) / series)
  const step = band >= 48 ? 1 : band >= 28 ? 2 : Math.ceil(32 / Math.max(band, 1))
  const zero = y(0)
  const active = index != null ? points[index] : null

  function move(next: number, point: { x: number; y: number } | null) {
    if (next < 0 || next >= points.length) {
      setIndex(null)
      setPointer(null)
      return
    }
    setIndex(next)
    setPointer(point)
  }

  const rows: TooltipRow[] = active
    ? [
        { key: 'current', label: currentLabel, color, value: formatValue(active.value) },
        ...(active.previous != null
          ? [{ key: 'previous', label: previousLabel, color: SERIES_PREVIOUS, value: formatValue(active.previous) }]
          : []),
      ]
    : []

  const announced = active ? `${active.label}: ${formatValue(active.value)}` : ''
  const tip = pointer ?? (active && index != null ? clientPoint(svgRef.current, plot.left + band * index + band / 2, y(active.value), width, height) : null)

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
        const point = clientPoint(svgRef.current, plot.left + band * next + band / 2, plot.top + plot.height / 2, width, height)
        move(next, point)
      }}
      onBlur={() => move(-1, null)}
    >
      <span className="sr-only" aria-live="polite">
        {announced}
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
            const next = Math.floor((local - plot.left) / Math.max(band, 1))
            move(next, { x: event.clientX, y: event.clientY })
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
          {index != null ? (
            <rect
              x={plot.left + band * index}
              y={plot.top}
              width={band}
              height={plot.height}
              fill="var(--color-chart-band)"
            />
          ) : null}
          {points.map((point, pointIndex) => {
            const origin = plot.left + band * pointIndex + (band - inner) / 2
            const bars = compare ? [point.value, point.previous ?? 0] : [point.value]
            return (
              <g key={point.key}>
                {bars.map((value, seriesIndex) => {
                  const top = Math.min(zero, y(value))
                  const barHeight = Math.max(value === 0 ? 0 : 1, Math.abs(y(value) - zero))
                  if (barHeight <= 0) return null
                  return (
                    <rect
                      key={seriesIndex}
                      x={origin + seriesIndex * (barWidth + 2)}
                      y={top}
                      width={barWidth}
                      height={barHeight}
                      rx={2}
                      fill={seriesIndex === 0 ? color : SERIES_PREVIOUS}
                    />
                  )
                })}
                {pointIndex % step === 0 || pointIndex === points.length - 1 ? (
                  <text
                    x={plot.left + band * pointIndex + band / 2}
                    y={plot.top + plot.height + 16}
                    textAnchor="middle"
                    fill="var(--color-chart-axis)"
                    fontSize={12}
                  >
                    {point.axis}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <ChartTooltip open={active != null && tip != null} x={tip?.x ?? 0} y={tip?.y ?? 0} title={active?.label ?? ''} rows={rows} />
    </div>
  )
}
