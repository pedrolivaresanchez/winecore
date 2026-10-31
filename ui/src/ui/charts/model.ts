/**
 * SDR's chart model and geometry (closer-ui `charts`): one shape for every chart, nice
 * ticks, band and linear scales, the monotone curve and the round-topped bar.
 */

export type MeasureType = 'number' | 'currency' | 'percent' | 'duration'

export type ChartSeries = { key: string; label: string; color: string; type?: MeasureType }

export type ChartMember = { label: string; total: number }

export type ChartCategory = {
  key: string
  label: string
  values: number[]
  total: number
  color?: string
  gaps?: boolean[]
  folded?: boolean
  members?: ChartMember[]
}

export type ChartModel = {
  categoryLabel?: string
  categories: ChartCategory[]
  series: ChartSeries[]
  measureType: MeasureType
  stacked?: boolean
  temporal?: boolean
  goal?: number | null
  goals?: number[] | null
  max: number
  min: number
  /** WineCore figures carry a unit (€, L); without it SDR's plain formatter is used. */
  format?: (value: number) => string
  /** Series are the same figure in two periods: no total, no share of it. */
  comparison?: boolean
}

export type Folded = { count: number; total: number }

export const CHART_INK = 'var(--color-chart-ink)'
export const CHART_TRACK = 'var(--color-chart-track)'
export const OTHER_KEY = '__other'

export const SERIES_PALETTE = [
  'var(--color-chart-1)',
  'var(--color-chart-3)',
  'var(--color-chart-12)',
  'var(--color-chart-15)',
  'var(--color-chart-14)',
  'var(--color-chart-2)',
  'var(--color-chart-5)',
  'var(--color-chart-7)',
  'var(--color-chart-13)',
  'var(--color-chart-16)',
  'var(--color-chart-10)',
  'var(--color-chart-8)',
  'var(--color-chart-6)',
  'var(--color-chart-9)',
  'var(--color-chart-4)',
  'var(--color-chart-11)',
] as const

export function seriesColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length]
}

export function chartModel(input: Omit<ChartModel, 'max' | 'min'>): ChartModel {
  const all = input.categories.flatMap((category) => (input.stacked ? [category.total, ...category.values] : category.values))
  return {
    ...input,
    max: Math.max(0, ...all, input.goal ?? 0),
    min: Math.min(0, ...all),
  }
}

/** Single-series categorical bars take the category's colour; otherwise the series'. */
export function fillFor(model: ChartModel, category: ChartCategory, series = 0): string {
  if (model.series.length === 1 && !model.temporal) return category.color ?? CHART_INK
  return model.series[series]?.color ?? CHART_INK
}

export function foldModel(model: ChartModel, limit: number, otherLabel: (count: number) => string): { model: ChartModel; folded: Folded | null } {
  if (model.temporal || model.measureType === 'percent' || limit < 2 || model.categories.length <= limit) {
    return { model, folded: null }
  }
  const ranked = model.categories
    .map((category, index) => ({ category, index }))
    .sort((left, right) => Math.abs(right.category.total) - Math.abs(left.category.total))
  const keep = new Set(ranked.slice(0, limit - 1).map((entry) => entry.index))
  const kept: ChartCategory[] = []
  const rest: ChartCategory[] = []
  model.categories.forEach((category, index) => (keep.has(index) ? kept : rest).push(category))
  const values = model.series.map((_, index) => rest.reduce((sum, category) => sum + (category.values[index] ?? 0), 0))
  const total = rest.reduce((sum, category) => sum + category.total, 0)
  const other: ChartCategory = {
    key: OTHER_KEY,
    label: otherLabel(rest.length),
    values,
    total,
    color: CHART_TRACK,
    folded: true,
    members: [...rest]
      .sort((left, right) => Math.abs(right.total) - Math.abs(left.total))
      .map((category) => ({ label: category.label, total: category.total })),
  }
  const categories = [...kept, other]
  const all = categories.flatMap((category) => (model.stacked ? [category.total, ...category.values] : category.values))
  return {
    model: { ...model, categories, max: Math.max(0, ...all, model.goal ?? 0), min: Math.min(0, ...all) },
    folded: { count: rest.length, total },
  }
}

export function niceTicks(min: number, max: number, count = 4): { ticks: number[]; domain: { min: number; max: number } } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || (min === 0 && max === 0)) {
    return { ticks: [0, 1], domain: { min: 0, max: 1 } }
  }
  const low = Math.min(0, min)
  const high = Math.max(0, max)
  const raw = (high - low || Math.abs(high) || 1) / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const residual = raw / magnitude
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude
  const start = Math.floor(low / step) * step
  const end = Math.ceil(high / step) * step
  const ticks: number[] = []
  const steps = Math.round((end - start) / step)
  for (let index = 0; index <= steps; index += 1) ticks.push(clean(start + index * step))
  return { ticks, domain: { min: start, max: end } }
}

function clean(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e9) / 1e9
}

export function linearY(domain: { min: number; max: number }, top: number, height: number) {
  const span = domain.max - domain.min || 1
  return (value: number) => top + height - ((value - domain.min) / span) * height
}

export type Bands = {
  band: number
  barWidth: number
  bandStart: (index: number) => number
  barStart: (index: number) => number
  center: (index: number) => number
  indexAt: (x: number) => number
}

export function bands(count: number, left: number, width: number, padding = 0.2): Bands {
  const band = count > 0 ? width / count : width
  const barWidth = band * (1 - padding)
  return {
    band,
    barWidth,
    bandStart: (index) => left + index * band,
    barStart: (index) => left + index * band + (band - barWidth) / 2,
    center: (index) => left + index * band + band / 2,
    indexAt: (x) => {
      if (count <= 0) return -1
      const index = Math.floor((x - left) / band)
      return Math.min(count - 1, Math.max(0, index))
    },
  }
}

export type Point = { x: number; y: number }

export function curvePath(points: Point[], smooth = true): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  if (!smooth || points.length === 2) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  }
  const tangents = monotoneTangents(points)
  let path = `M ${points[0].x} ${points[0].y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    const third = (to.x - from.x) / 3
    path += ` C ${from.x + third} ${from.y + tangents[index] * third} ${to.x - third} ${to.y - tangents[index + 1] * third} ${to.x} ${to.y}`
  }
  return path
}

function monotoneTangents(points: Point[]): number[] {
  const count = points.length
  const slopes: number[] = []
  for (let index = 0; index < count - 1; index += 1) {
    const dx = points[index + 1].x - points[index].x
    slopes.push(dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx)
  }
  const tangents = [slopes[0]]
  for (let index = 1; index < count - 1; index += 1) {
    tangents.push(slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2)
  }
  tangents.push(slopes[count - 2])
  for (let index = 0; index < count - 1; index += 1) {
    if (slopes[index] === 0) {
      tangents[index] = 0
      tangents[index + 1] = 0
      continue
    }
    const alpha = tangents[index] / slopes[index]
    const beta = tangents[index + 1] / slopes[index]
    const norm = alpha * alpha + beta * beta
    if (norm > 9) {
      const scale = 3 / Math.sqrt(norm)
      tangents[index] = scale * alpha * slopes[index]
      tangents[index + 1] = scale * beta * slopes[index]
    }
  }
  return tangents
}

export function pathLength(points: Point[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)
  }
  return Math.ceil(length * 1.06) || 1
}

export function roundedTopBar(x: number, y: number, width: number, height: number, radius: number): string {
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  const r = Math.max(0, Math.min(radius, w / 2, h))
  if (r === 0) return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
  return [`M ${x} ${y + r}`, `A ${r} ${r} 0 0 1 ${x + r} ${y}`, `H ${x + w - r}`, `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`, `V ${y + h}`, `H ${x}`, 'Z'].join(' ')
}

export type PlotArea = { left: number; top: number; width: number; height: number; bottom: number }

export function plotArea(width: number, height: number, ticks: number[], format: (value: number) => string, options: { titles?: boolean; axis?: boolean } = {}): PlotArea {
  const longest = ticks.reduce((max, tick) => Math.max(max, format(tick).length), 1)
  const left = Math.min(72, Math.max(26, longest * 6.2 + 8)) + (options.titles ? 17 : 0)
  const below = (options.axis === false ? 0 : 22) + (options.titles ? 17 : 0)
  return {
    left,
    top: 10,
    width: Math.max(0, width - left),
    height: Math.max(0, height - 10 - below),
    bottom: Math.max(0, height - below),
  }
}

export function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Axis tick: compact (`12k`, `1,5M`), a percent or a duration. */
export function formatTick(value: number, type: MeasureType = 'number'): string {
  if (!Number.isFinite(value)) return '—'
  if (type === 'percent') return `${round(value, 0)}%`
  if (type === 'duration') return formatDuration(value)
  const abs = Math.abs(value)
  if (abs < 1e3) return String(round(value, Number(abs < 10)))
  for (const [unit, suffix] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ] as const) {
    if (abs >= unit) {
      const scaled = value / unit
      return `${round(scaled, Number(Math.abs(scaled) < 10))}${suffix}`
    }
  }
  return String(round(value, 0))
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const days = seconds / 86400
  if (days >= 1) return `${round(days, days >= 10 ? 0 : 1)}d`
  const hours = seconds / 3600
  if (hours >= 1) return `${round(hours, hours >= 10 ? 0 : 1)}h`
  const minutes = seconds / 60
  return minutes >= 1 ? `${Math.round(minutes)}m` : `${Math.round(seconds)}s`
}

/** Full value: grouped digits, a percent to one decimal or a duration. */
export function formatValue(value: number | null, type: MeasureType = 'number'): string {
  if (value == null || !Number.isFinite(value)) return '—'
  switch (type) {
    case 'currency':
      return value.toLocaleString('es-ES', { maximumFractionDigits: 0 })
    case 'percent':
      return `${round(value, 1)}%`
    case 'duration':
      return formatDuration(value)
    default:
      return value.toLocaleString('es-ES', { maximumFractionDigits: 2 })
  }
}

export function formatShare(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) return '0%'
  const share = (value / total) * 100
  return `${round(share, Number(share < 10 && share > 0))}%`
}

export type Delta = { text: string; direction: -1 | 0 | 1 }

export function deltaOf(current: number, previous: number): Delta | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  const pct = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(pct) < 0.5) return { text: '0%', direction: 0 }
  return {
    text: `${pct > 0 ? '+' : '−'}${round(Math.abs(pct), Number(Math.abs(pct) < 10))}%`,
    direction: pct > 0 ? 1 : -1,
  }
}

/** A model value in its unit: the model's own formatter, or SDR's for percent and the rest. */
export function valueText(model: Pick<ChartModel, 'format'>, value: number | null, type: MeasureType = 'number'): string {
  if (value == null) return '—'
  if (model.format && type !== 'percent') return model.format(value)
  return formatValue(value, type)
}
