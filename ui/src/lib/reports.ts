import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, apiText, isAbortError } from '@/lib/api'
import { formatCompact, formatInteger, formatLitres, formatMoney } from '@/lib/format'
import { copy } from '@/i18n'
import type { EntityChoice } from '@/lib/types'

export const GROUP_BY = ['product', 'wine', 'lot', 'year', 'month', 'customer', 'category'] as const

export type GroupBy = (typeof GROUP_BY)[number]
export type ReportName = 'sales' | 'expenses' | 'stock'
export type EntityFilter = 'PO' | 'CVPO' | 'both'
export type Measure = 'amount' | 'volume' | 'units'

export interface ReportMetrics {
  amount: string
  base: string
  tax: string
  units: string
  volume_ml: string
}

export interface ReportPoint extends ReportMetrics {
  key: string
  label: string
  as_of?: string
  previous: (ReportMetrics & { key: string }) | null
}

export interface ReportBody {
  report: ReportName
  from: string
  to: string
  entity: EntityFilter
  entities: string[]
  group_by: GroupBy
  compare: 'previous_year' | null
  currency: 'EUR'
  totals: ReportMetrics
  previous_totals: ReportMetrics | null
  series: ReportPoint[]
}

export interface ReportQuery {
  from: string
  to: string
  groupBy: GroupBy
  entity: EntityFilter
  compare: boolean
}

const FILE_NAME: Record<ReportName, string> = {
  sales: 'ventas.csv',
  expenses: 'gastos.csv',
  stock: 'existencias.csv',
}

const monthShort = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' })
const monthYear = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' })

function civil(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, ' ').replace(/\./g, '')
}

function monthDate(key: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(key)) return null
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))
  if (!year || month < 1 || month > 12) return null
  return new Date(Date.UTC(year, month - 1, 1))
}

export function entityFilter(choice: EntityChoice): EntityFilter {
  if (choice === 'PO' || choice === 'CVPO') return choice
  return 'both'
}

export function isGroupBy(value: string | null): value is GroupBy {
  return value != null && (GROUP_BY as readonly string[]).includes(value)
}

export function isIsoDate(value: string | null): value is string {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function measureFor(report: ReportName): Measure {
  return report === 'stock' ? 'volume' : 'amount'
}

export function metricNumber(metrics: ReportMetrics | null | undefined, measure: Measure): number {
  if (!metrics) return 0
  const raw = measure === 'amount' ? metrics.amount : measure === 'volume' ? metrics.volume_ml : metrics.units
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return measure === 'volume' ? parsed / 1000 : parsed
}

function formatVolume(litres: number): string {
  if (litres === 0) return '0 L'
  if (Math.abs(litres) >= 1000) return `${formatInteger(Math.round(litres))} L`
  if (Math.abs(litres) >= 10) {
    const text = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(litres)
    return `${text.replace(/[\u00a0\u202f]/g, ' ')} L`
  }
  return formatLitres(litres)
}

/** Short form for a tile that cannot hold `formatMeasure` (`176,1 mil €`). */
export function compactMeasure(value: number, measure: Measure): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1000) return formatMeasure(value, measure)
  const unit = measure === 'amount' ? '€' : measure === 'volume' ? 'L' : ''
  return formatCompact(value, unit)
}

export function formatMeasure(value: number, measure: Measure): string {
  if (!Number.isFinite(value)) return '—'
  if (measure === 'amount') return formatMoney(value)
  if (measure === 'volume') return formatVolume(value)
  const rounded = Math.round(value * 1000) / 1000
  if (Number.isInteger(rounded)) return formatInteger(rounded)
  const [whole, frac] = rounded.toFixed(3).replace(/0+$/, '').split('.')
  return frac ? `${formatInteger(Number(whole))},${frac}` : formatInteger(Number(whole))
}

export function formatAxis(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const text =
    abs < 1000
      ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: abs < 10 && !Number.isInteger(value) ? 1 : 0 }).format(value)
      : new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  return text.replace(/[\u00a0\u202f]/g, ' ')
}

export function formatDelta(
  current: number,
  previous: number | null,
): { text: string; direction: -1 | 0 | 1 } | null {
  if (previous == null || previous === 0 || !Number.isFinite(current)) return null
  const pct = ((current - previous) / Math.abs(previous)) * 100
  if (!Number.isFinite(pct)) return null
  const direction = pct > 0.05 ? 1 : pct < -0.05 ? -1 : 0
  const digits = Math.abs(pct) >= 10 ? 0 : 1
  const raw = pct.toFixed(digits).replace('.', ',')
  return { text: `${pct > 0 ? '+' : ''}${raw} %`, direction }
}

export function yearToDate(now = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const to = `${pick('year')}-${pick('month')}-${pick('day')}`
  return { from: `${pick('year')}-01-01`, to }
}

export function displayLabel(groupBy: GroupBy, point: Pick<ReportPoint, 'key' | 'label'>): string {
  const date = groupBy === 'month' ? monthDate(point.key) : null
  if (date) return civil(monthYear.format(date))
  return point.label
}

export function axisTick(groupBy: GroupBy, point: Pick<ReportPoint, 'key' | 'label'>, short: boolean): string {
  const date = groupBy === 'month' ? monthDate(point.key) : null
  if (date) return civil((short ? monthShort : monthYear).format(date))
  if (groupBy === 'year') return point.key
  return point.label.length > 14 ? `${point.label.slice(0, 13)}…` : point.label
}

export function hasMeasure(body: ReportBody, measure: Measure): boolean {
  return body.series.some(
    (point) => metricNumber(point, measure) !== 0 || metricNumber(point.previous, measure) !== 0,
  )
}

export function chartPoints(
  body: ReportBody,
  measure: Measure,
  limit: number,
): { points: ReportPoint[]; hidden: number } {
  const temporal = body.group_by === 'month' || body.group_by === 'year'
  const ordered = temporal
    ? body.series
    : [...body.series].sort((left, right) => Math.abs(metricNumber(right, measure)) - Math.abs(metricNumber(left, measure)))
  if (temporal || ordered.length <= limit) return { points: ordered, hidden: 0 }
  return { points: ordered.slice(0, limit), hidden: ordered.length - limit }
}

function reportQueryString(query: ReportQuery): string {
  const params = new URLSearchParams()
  params.set('from', query.from)
  params.set('to', query.to)
  params.set('group_by', query.groupBy)
  params.set('entity', query.entity)
  if (query.compare) params.set('compare', 'previous_year')
  return params.toString()
}

export function fetchReport(name: ReportName, query: ReportQuery, signal?: AbortSignal) {
  return api<ReportBody>(`/v1/reports/${name}?${reportQueryString(query)}`, { signal })
}

export async function downloadReportCsv(name: ReportName, query: ReportQuery) {
  const csv = await apiText(`/v1/reports/${name}.csv?${reportQueryString(query)}`)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = FILE_NAME[name]
  link.click()
  URL.revokeObjectURL(url)
}

type ReportState = {
  key: string
  data: ReportBody | null
  error: ApiError | null
  loading: boolean
}

export function useReport(name: ReportName | null, query: ReportQuery | null, poll = false) {
  const key = name && query ? `${name}?${reportQueryString(query)}` : ''
  const nameRef = useRef(name)
  const queryRef = useRef(query)
  nameRef.current = name
  queryRef.current = query
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ReportState>({ key: '', data: null, error: null, loading: Boolean(key) })

  useEffect(() => {
    const currentName = nameRef.current
    const currentQuery = queryRef.current
    if (!key || !currentName || !currentQuery) {
      setState({ key, data: null, error: null, loading: false })
      return
    }
    const controller = new AbortController()
    let active = true
    setState((current) => ({
      key,
      data: current.key === key ? current.data : null,
      error: null,
      loading: true,
    }))
    fetchReport(currentName, currentQuery, controller.signal)
      .then((data) => {
        if (active) setState({ key, data, error: null, loading: false })
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return
        const next = error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.error.load)
        setState((current) => ({
          key,
          data: current.key === key ? current.data : null,
          error: next,
          loading: false,
        }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, key])

  useEffect(() => {
    if (!poll || !key) return
    const tick = () => setAttempt((value) => value + 1)
    const id = window.setInterval(tick, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, poll])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    loading: state.loading || state.key !== key,
    initial: (state.loading || state.key !== key) && (state.key !== key || state.data == null),
    reload,
  }
}
