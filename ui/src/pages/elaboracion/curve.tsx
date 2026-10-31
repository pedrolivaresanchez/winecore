import { useRef, useState } from 'react'
import { copy } from '@/i18n'
import { SERIES_CURRENT, clientPoint, plotBox, useElementWidth, yAt } from '@/lib/chart-scale'
import { formatDateTime } from '@/lib/format'
import { showDecimal, type CurvePoint } from '@/pages/elaboracion/model'
import { ChartTooltip, type TooltipRow } from '@/pages/informes/charts/tooltip'

const TEMPERATURE = 'var(--color-chart-4)'

function dataScale(values: number[]): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || Math.abs(hi) * 0.05 || 1
  const rough = (span * 1.2) / 3
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / (magnitude || 1)
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * (magnitude || 1)
  const safe = step || span
  const start = Math.floor((lo - span * 0.08) / safe) * safe
  const end = Math.ceil((hi + span * 0.08) / safe) * safe
  const ticks: number[] = []
  for (let value = start; value <= end + safe * 0.001 && ticks.length < 6; value += safe) {
    ticks.push(Number(value.toFixed(4)))
  }
  if (ticks.length < 2) return { min: lo - span * 0.2, max: hi + span * 0.2, ticks: [lo, hi] }
  return { ticks, min: ticks[0] ?? start, max: ticks[ticks.length - 1] ?? end }
}

function axisLabel(at: string): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

function SeriesChart({
  points,
  color,
  digits,
  unit,
  label,
}: {
  points: { at: string; value: number }[]
  color: string
  digits: number
  unit: string
  label: string
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [index, setIndex] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const height = 160
  const scale = dataScale(points.map((point) => point.value))
  const base = plotBox(width, height)
  const plot = { ...base, width: Math.max(0, base.width - 20) }
  const y = yAt(scale.min, scale.max, plot.top, plot.height)
  const count = Math.max(1, points.length)
  const xAt = (pointIndex: number) => (count === 1 ? plot.left + plot.width / 2 : plot.left + (plot.width * pointIndex) / Math.max(1, count - 1))
  const step = count <= 6 ? 1 : Math.ceil(count / 4)
  const active = index != null ? points[index] : null
  const rows: TooltipRow[] = active
    ? [{ key: 'value', label, color, value: `${showDecimal(active.value, digits)} ${unit}`.trim() }]
    : []
  const tip = pointer ?? (active && index != null ? clientPoint(svgRef.current, xAt(index), y(active.value), width, height) : null)
  const path = points.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${xAt(pointIndex)} ${y(point.value)}`).join(' ')

  return (
    <div
      ref={ref}
      role="group"
      tabIndex={0}
      aria-label={label}
      className="relative outline-none focus-visible:shadow-(--shadow-focus)"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setIndex(null)
          setPointer(null)
          return
        }
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        event.preventDefault()
        const next = index == null ? 0 : index + (event.key === 'ArrowRight' ? 1 : -1)
        if (next < 0 || next >= points.length) return
        setIndex(next)
        setPointer(clientPoint(svgRef.current, xAt(next), y(points[next]?.value ?? 0), width, height))
      }}
      onBlur={() => {
        setIndex(null)
        setPointer(null)
      }}
    >
      <p className="mb-1 text-caption text-text-tertiary">{label}</p>
      {width > 0 ? (
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={label}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const local = ((event.clientX - box.left) / Math.max(box.width, 1)) * width
            const ratio = plot.width <= 0 ? 0 : (local - plot.left) / plot.width
            const next = Math.round(ratio * Math.max(0, count - 1))
            const clamped = Math.max(0, Math.min(points.length - 1, next))
            setIndex(clamped)
            setPointer({ x: event.clientX, y: event.clientY })
          }}
          onPointerLeave={() => {
            setIndex(null)
            setPointer(null)
          }}
        >
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={plot.left} x2={plot.left + plot.width} y1={y(tick)} y2={y(tick)} stroke="var(--color-chart-grid)" strokeWidth={1} />
              <text x={plot.left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle" fill="var(--color-chart-axis)" fontSize={12}>
                {showDecimal(tick, digits)}
              </text>
            </g>
          ))}
          <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((point, pointIndex) => (
            <circle key={point.at} cx={xAt(pointIndex)} cy={y(point.value)} r={index === pointIndex ? 3.5 : 2.5} fill={color} />
          ))}
          {points.map((point, pointIndex) =>
            pointIndex % step === 0 || pointIndex === points.length - 1 ? (
              <text key={`${point.at}-axis`} x={xAt(pointIndex)} y={plot.top + plot.height + 16} textAnchor="middle" fill="var(--color-chart-axis)" fontSize={12}>
                {axisLabel(point.at)}
              </text>
            ) : null,
          )}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <ChartTooltip open={active != null && tip != null} x={tip?.x ?? 0} y={tip?.y ?? 0} title={active ? formatDateTime(active.at) : ''} rows={rows} />
    </div>
  )
}

export function FermentationCurve({ points }: { points: CurvePoint[] }) {
  const density = points.flatMap((point) => (point.density == null ? [] : [{ at: point.at, value: Number(point.density) }])).filter((point) => Number.isFinite(point.value))
  const temperature = points
    .flatMap((point) => (point.temperature_c == null ? [] : [{ at: point.at, value: Number(point.temperature_c) }]))
    .filter((point) => Number.isFinite(point.value))
  if (density.length === 0 && temperature.length === 0) return null
  return (
    <div data-screen="elaboracion-curva" className="grid gap-4">
      <h2 className="text-label font-medium text-ink-900">{copy.elaboracion.curve}</h2>
      {density.length > 0 ? (
        <SeriesChart points={density} color={SERIES_CURRENT} digits={4} unit="" label={copy.elaboracion.densitySeries} />
      ) : null}
      {temperature.length > 0 ? (
        <SeriesChart points={temperature} color={TEMPERATURE} digits={1} unit="°C" label={copy.elaboracion.temperatureSeries} />
      ) : null}
    </div>
  )
}
