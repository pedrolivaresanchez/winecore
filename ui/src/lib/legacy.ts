import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, isAbortError } from '@/lib/api'
import { copy } from '@/i18n'
import type { EntityFilter } from '@/lib/reports'

export type LegacyInvoice = {
  id: string
  number: string
  issue_date: string
  counterparty_name: string
  total: string
  pending: string | null
  status_holded: string
  kind: string
  entity_code: string
}

export type LegacyOverview = {
  entity: EntityFilter
  year: number
  kpis: {
    sales_this_year: string
    sales_last_year: string
    pending_receivables: string
    pending_receivables_count: number
    contacts: number
    open_payables: string
    open_payables_count: number
  }
  recent_invoices: LegacyInvoice[]
  top_customers: { name: string; total: string; invoices: number }[]
  months: { month: number; total: string }[]
  has_imported: boolean
}

export type LegacyInvoicePage = {
  items: LegacyInvoice[]
  next_cursor: string | null
  total: number
  kind: 'sale' | 'purchase'
  entity: EntityFilter
}

export type LegacyProduct = {
  id: string
  name: string
  sku: string | null
  description: string | null
  stock: string | null
  cost: string | null
  sale_value: string | null
  tax_label: string | null
  warehouse_label: string | null
  entity_code: string
  source: 'holded'
}

export type LegacyProductPage = {
  items: LegacyProduct[]
  next_cursor: string | null
  total: number
  catalog_total: number
  entity: EntityFilter
}

export function legacyOverviewPath(entity: EntityFilter): string {
  return `/v1/legacy/overview?entity=${encodeURIComponent(entity)}`
}

export function listLegacyInvoices(
  query: { kind: 'sale' | 'purchase'; entity: EntityFilter; q?: string; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  params.set('kind', query.kind)
  params.set('entity', query.entity)
  if (query.q) params.set('q', query.q)
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('limit', String(query.limit ?? 50))
  return api<LegacyInvoicePage>(`/v1/legacy/invoices?${params.toString()}`, { signal })
}

export function listLegacyProducts(
  query: { entity: EntityFilter; q?: string; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  params.set('entity', query.entity)
  if (query.q) params.set('q', query.q)
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('limit', String(query.limit ?? 100))
  return api<LegacyProductPage>(`/v1/legacy/products?${params.toString()}`, { signal })
}

export function useLegacyOverview(entity: EntityFilter, enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [data, setData] = useState<LegacyOverview | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setData(null)
      setError(null)
      return
    }
    const controller = new AbortController()
    let active = true
    setLoading(true)
    api<LegacyOverview>(legacyOverviewPath(entity), { signal: controller.signal })
      .then((next) => {
        if (!active) return
        setData(next)
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
  }, [attempt, enabled, entity])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  return {
    data: enabled ? data : null,
    error: enabled ? error : null,
    initial: enabled && loading && data == null,
    reload,
  }
}
