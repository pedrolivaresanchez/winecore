import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from 'react'
import { ChartBar, Info } from '@/ui/icons'
import { Tooltip } from '@/ui/tooltip'
import { copy, fill } from '@/i18n'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { foldModel, formatTick, truncateLabel, valueText, type Bands, type ChartModel, type Folded, type MeasureType, type PlotArea } from './model'

export const CHART_FOCUS = 'rounded-[6px] outline-none focus-visible:shadow-(--shadow-focus)'

export function useChartWidth(height: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const measure = useCallback(() => {
    const node = ref.current
    if (node) setWidth(node.clientWidth)
  }, [])
  useEffect(() => {
    const node = ref.current
    if (!node) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [measure])
  return { ref, width, height, ready: width > 0 }
}

export function useFolded(model: ChartModel, limit: number) {
  return useMemo(() => foldModel(model, limit, (count) => fill(copy.charts.otherCount, { count: String(count) })), [limit, model])
}

/** Arrow keys walk the categories; Enter activates; Escape clears. */
export function keyStep(key: string, current: number | null, count: number): number | null | 'activate' | undefined {
  if (count <= 0) return undefined
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return current === null ? 0 : Math.min(count - 1, current + 1)
    case 'ArrowLeft':
    case 'ArrowUp':
      return current === null ? count - 1 : Math.max(0, current - 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'Enter':
    case ' ':
      return current === null ? undefined : 'activate'
    case 'Escape':
      return current === null ? undefined : null
    default:
      return undefined
  }
}

export function anchorAt(svg: SVGSVGElement | null, x: number, y: number): { x: number; y: number } | null {
  if (!svg) return null
  const box = svg.getBoundingClientRect()
  return { x: box.left + x, y: box.top + y }
}

export function ChartSvg({
  innerRef,
  svgRef,
  height,
  width,
  children,
  onPointerMove,
  onPointerLeave,
  onKeyDown,
  onBlur,
  tabIndex,
  label,
  className,
  svgClassName,
}: {
  innerRef: Ref<HTMLDivElement>
  svgRef?: Ref<SVGSVGElement>
  height: number
  width: number
  children: ReactNode
  onPointerMove?: (event: PointerEvent<SVGSVGElement>) => void
  onPointerLeave?: () => void
  onKeyDown?: (event: KeyboardEvent<SVGSVGElement>) => void
  onBlur?: () => void
  tabIndex?: number
  label: string
  className?: string
  svgClassName?: string
}) {
  return (
    <div ref={innerRef} className={cn('w-full', className)} style={{ height }}>
      {width > 0 ? (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={tabIndex}
          className={cn('overflow-visible', svgClassName)}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        >
          {children}
        </svg>
      ) : null}
    </div>
  )
}

export function GridTicks({ plot, ticks, y, type }: { plot: PlotArea; ticks: number[]; y: (value: number) => number; type: MeasureType }) {
  const top = ticks.length ? Math.max(...ticks) : null
  return (
    <g aria-hidden>
      {ticks.map((tick) => {
        const at = y(tick)
        const zero = tick === 0
        return (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={plot.left + plot.width}
              y1={at}
              y2={at}
              stroke={zero ? 'var(--color-chart-rule)' : 'var(--color-chart-grid)'}
              strokeWidth={1}
              strokeDasharray={zero ? undefined : '2 4'}
              opacity={!zero && tick === top ? 0.5 : 1}
              shapeRendering="crispEdges"
            />
            <text
              x={plot.left - 8}
              y={at}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-(--color-chart-axis) text-chart-tick tabular-nums"
            >
              {formatTick(tick, type)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export function BandLabels({ plot, band, labels }: { plot: PlotArea; band: Bands; labels: string[] }) {
  if (labels.length === 0) return null
  const widest = labels.reduce((max, label) => Math.max(max, label.length), 1) * 5.8 + 10
  const every = Math.max(1, Math.ceil(widest / Math.max(1, band.band)))
  return (
    <g aria-hidden>
      {labels.map((label, index) => {
        const last = index === labels.length - 1
        if ((every > 1 && index % every !== 0 && !last) || (every > 1 && !last && index + every > labels.length - 1)) return null
        return (
          <text key={`${label}-${index}`} x={band.center(index)} y={plot.bottom + 14} textAnchor="middle" className="fill-(--color-chart-axis) text-chart-tick">
            {truncateLabel(label, Math.max(4, Math.floor((band.band * every) / 5.8)))}
          </text>
        )
      })}
    </g>
  )
}

export function GoalLine({
  plot,
  y,
  points,
  label,
  hideLabel,
}: {
  plot: PlotArea
  y: number
  points: [number, number][] | null
  label: string
  hideLabel?: boolean
}) {
  const path = points && points.length > 1 ? points : null
  if (!path && (y < plot.top || y > plot.bottom)) return null
  const end = path ? path[path.length - 1][1] : y
  return (
    <g aria-hidden>
      {path ? (
        <polyline points={path.map(([x, at]) => `${x},${at}`).join(' ')} fill="none" stroke="var(--color-chart-goal)" strokeWidth={1} strokeDasharray="4 3" />
      ) : (
        <line x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} stroke="var(--color-chart-goal)" strokeWidth={1} strokeDasharray="4 3" />
      )}
      {hideLabel ? null : (
        <text x={plot.left + plot.width - 4} y={Math.max(plot.top + 10, end - 5)} textAnchor="end" className="fill-(--color-chart-axis) text-chart-tick">
          {label}
        </text>
      )}
    </g>
  )
}

export function HoverBand({ plot, x, width }: { plot: PlotArea; x: number; width: number }) {
  return <rect aria-hidden x={x} y={plot.top} width={width} height={Math.max(0, plot.bottom - plot.top)} fill="var(--color-chart-band)" rx={4} />
}

export function Crosshair({ plot, x }: { plot: PlotArea; x: number }) {
  return (
    <line
      aria-hidden
      x1={x}
      x2={x}
      y1={plot.top}
      y2={plot.bottom}
      stroke="var(--color-border-strong)"
      strokeWidth={1}
      strokeDasharray="3 3"
      shapeRendering="crispEdges"
    />
  )
}

export function FoldedNote({ folded, model, action, className }: { folded: Folded | null; model: ChartModel; action?: ReactNode; className?: string }) {
  if (!folded) return null
  return (
    <p className={cn('flex min-w-0 items-center gap-1.5 px-1 text-caption text-text-tertiary', className)}>
      <Tooltip label={copy.charts.foldedHint}>
        <span tabIndex={0} role="note" aria-label={copy.charts.foldedHint} className="shrink-0 rounded-[6px] outline-none focus-visible:shadow-(--shadow-focus)">
          <Info className="size-3" strokeWidth={iconStroke} aria-hidden />
        </span>
      </Tooltip>
      <span className="min-w-0 truncate">
        {fill(copy.charts.folded, { count: String(folded.count), total: valueText(model, folded.total, model.measureType) })}
      </span>
      {action}
    </p>
  )
}

export function ChartEmpty({ height, message, className }: { height?: number; message?: string; className?: string }) {
  return (
    <div
      className={cn('flex min-h-24 flex-1 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface-subtle px-4 py-6 text-center', className)}
      style={height ? { height } : undefined}
    >
      <ChartBar className="size-4 text-icon-muted" strokeWidth={iconStroke} aria-hidden />
      <p className="text-caption text-text-tertiary">{message ?? copy.charts.noData}</p>
    </div>
  )
}
