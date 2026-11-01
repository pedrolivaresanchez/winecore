import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, isAbortError } from '@/lib/api'
import { copy } from '@/i18n'
import type { LegacyDocumentPage, LegacyInvoicePage } from '@/lib/legacy'
import type { EntityFilter } from '@/lib/reports'
import { money } from '@/pages/facturas/format'

export type HoldedLine = {
  line_no: number
  sku: string
  description: string
  quantity: string
  unit_price: string
  line_base: string
  tax_code: string
}

export type HoldedFilters = {
  status: string
  from: string
  to: string
}

export type HoldedQuery = {
  kind: string
  entity: EntityFilter
  q?: string
  cursor?: string | null
  limit?: number
  status?: string
  from?: string
  to?: string
}

type HoldedPage<T> = {
  items: T[]
  next_cursor: string | null
  total: number
}

const extraAccepted: Record<'invoices' | 'documents', boolean> = {
  invoices: true,
  documents: true,
}

function search(query: HoldedQuery, extra: boolean): string {
  const params = new URLSearchParams()
  params.set('kind', query.kind)
  params.set('entity', query.entity)
  if (query.q) params.set('q', query.q)
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('limit', String(query.limit ?? 50))
  if (extra) {
    if (query.status) params.set('status', query.status)
    if (query.from) params.set('from', query.from)
    if (query.to) params.set('to', query.to)
  }
  return params.toString()
}

function hasExtra(query: HoldedQuery): boolean {
  return Boolean(query.status || query.from || query.to)
}

async function getPage<T>(resource: 'invoices' | 'documents', query: HoldedQuery, signal?: AbortSignal): Promise<T> {
  const path = `/v1/legacy/${resource}`
  const sendExtra = hasExtra(query) && extraAccepted[resource]
  if (!sendExtra) return api<T>(`${path}?${search(query, false)}`, { signal })
  try {
    return await api<T>(`${path}?${search(query, true)}`, { signal })
  } catch (err) {
    if (isAbortError(err) || !(err instanceof ApiError) || err.status !== 422) throw err
    const page = await api<T>(`${path}?${search(query, false)}`, { signal })
    extraAccepted[resource] = false
    return page
  }
}

export function listHoldedInvoices(query: HoldedQuery, signal?: AbortSignal) {
  return getPage<LegacyInvoicePage>('invoices', query, signal)
}

export function listHoldedDocuments(query: HoldedQuery, signal?: AbortSignal) {
  return getPage<LegacyDocumentPage>('documents', query, signal)
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function linesOf(payload: unknown): HoldedLine[] {
  if (!payload || typeof payload !== 'object') return []
  const raw = (payload as { lines?: unknown }).lines
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const parsed = typeof row.line_no === 'number' ? row.line_no : Number(row.line_no)
    return [{
      line_no: Number.isFinite(parsed) ? parsed : index + 1,
      sku: asText(row.sku),
      description: asText(row.description),
      quantity: asText(row.quantity),
      unit_price: asText(row.unit_price),
      line_base: asText(row.line_base),
      tax_code: asText(row.tax_code),
    }]
  })
}

/** Estado y fechas sobre las filas ya cargadas. El abono no se aparta del libro. */
export function rowMatches(row: { status_holded: string; issue_date: string }, filters: HoldedFilters): boolean {
  if (filters.status && row.status_holded !== filters.status) return false
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(row.issue_date)?.[1]
  if (filters.from && (!day || day < filters.from)) return false
  if (filters.to && (!day || day > filters.to)) return false
  return true
}

export function statusOptions(rows: { status_holded: string }[], selected: string): string[] {
  const values = new Set<string>()
  for (const row of rows) if (row.status_holded) values.add(row.status_holded)
  if (selected) values.add(selected)
  return [...values].sort((a, b) => a.localeCompare(b, 'es'))
}

function centsOf(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(2) : '') : value.trim().replace(',', '.')
  if (!text) return 0
  const negative = text.startsWith('-')
  const raw = negative ? text.slice(1) : text
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!match) return 0
  const whole = Number(match[1])
  const frac = `${match[2] ?? ''}000`
  let cents = whole * 100 + Number(frac.slice(0, 2))
  if (frac[2] >= '5') cents += 1
  return negative ? -cents : cents
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** Suma en céntimos enteros. `money()` no parte céntimos, así que el total no pasa por un float. */
export function moneySum(values: Array<string | number | null | undefined>): string {
  let cents = 0
  for (const value of values) cents += centsOf(value)
  return money(fromCents(cents))
}

export function useHoldedPage<T>(
  load: (query: HoldedQuery, signal?: AbortSignal) => Promise<HoldedPage<T>>,
  query: HoldedQuery,
) {
  const { kind, entity, q = '', status = '', from = '', to = '' } = query
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const request = useRef(0)
  const scope = `${kind}\0${entity}`
  const [seenScope, setSeenScope] = useState(scope)
  if (seenScope !== scope) {
    setSeenScope(scope)
    setItems([])
    setCursor(null)
    setTotal(0)
    setLoading(true)
    setError(null)
  }

  useEffect(() => {
    const ticket = ++request.current
    const controller = new AbortController()
    let active = true
    load({ kind, entity, q, status, from, to, limit: 50 }, controller.signal)
      .then((page) => {
        if (!active || ticket !== request.current) return
        setItems(page.items)
        setTotal(page.total)
        setCursor(page.next_cursor)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
        setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, entity, from, kind, load, q, status, to])

  const loadMore = useCallback(async () => {
    if (!cursor) return
    const ticket = request.current
    setLoadingMore(true)
    try {
      const page = await load({ kind, entity, q, status, from, to, cursor, limit: 50 })
      if (ticket !== request.current) return
      setItems((current) => [...current, ...page.items])
      setCursor(page.next_cursor)
      setTotal(page.total)
    } catch (err: unknown) {
      if (ticket !== request.current || isAbortError(err)) return
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.error.load))
    } finally {
      if (ticket === request.current) setLoadingMore(false)
    }
  }, [cursor, entity, from, kind, load, q, status, to])

  const reload = useCallback(() => {
    setLoading(true)
    setAttempt((value) => value + 1)
  }, [])

  return { items, total, cursor, loading, loadingMore, error, loadMore, reload }
}
