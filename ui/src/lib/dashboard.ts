import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, isAbortError } from '@/lib/api'
import { copy } from '@/i18n'
import type { EntityFilter } from '@/lib/reports'

export interface AttentionItem {
  id: string
  title: string
  detail: string | null
  href: string | null
  daysLeft: number | null
}

export interface AttentionBlock {
  count: number
  items: AttentionItem[]
}

export interface MoneyBucket {
  key: string
  label: string
  amount: string
  count: number
}

export interface ReceivablesBlock {
  amount: string
  count: number
  buckets: MoneyBucket[]
}

export interface VerifactuBlock {
  count: number
  since: string | null
}

export interface Dashboard {
  approvals: AttentionBlock | null
  deadlines: AttentionBlock | null
  receivables: ReceivablesBlock | null
  verifactu: VerifactuBlock | null
  submissions: AttentionBlock | null
  cellar: AttentionBlock | null
  stock: AttentionBlock | null
}

export const attentionHref = {
  approvals: '/aprobaciones',
  deadlines: '/regulatorio',
  receivables: '/cobros',
  verifactu: '/facturas/verifactu',
  submissions: '/regulatorio',
  cellar: '/bodega/depositos',
  stock: '/stock/conciliacion',
} as const

function emptyBlock(): AttentionBlock {
  return { count: 0, items: [] }
}

export function emptyDashboard(): Dashboard {
  return {
    approvals: emptyBlock(),
    deadlines: emptyBlock(),
    receivables: { amount: '0.00', count: 0, buckets: [] },
    verifactu: { count: 0, since: null },
    submissions: emptyBlock(),
    cellar: emptyBlock(),
    stock: emptyBlock(),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function amount(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return '0.00'
}

function countOf(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function itemsOf(value: unknown): AttentionItem[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 3).map((row, index) => {
    const record = asRecord(row) ?? {}
    const days = record.days_left ?? record.days
    const daysLeft = typeof days === 'number' ? days : typeof days === 'string' && Number.isFinite(Number(days)) ? Number(days) : null
    return {
      id: text(record.id) ?? String(index),
      title: text(record.title) ?? text(record.label) ?? text(record.summary) ?? '—',
      detail: text(record.detail) ?? text(record.subtitle),
      href: text(record.href),
      daysLeft,
    }
  })
}

function blockOf(value: unknown): AttentionBlock | null {
  if (value === null) return null
  const record = asRecord(value)
  if (record && record.enabled === false) return null
  const items = itemsOf(record?.items)
  return { count: countOf(record?.count, items.length), items }
}

function bucketsOf(value: unknown): MoneyBucket[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row, index) => {
    const record = asRecord(row)
    if (!record) return []
    return [
      {
        key: text(record.key) ?? String(index),
        label: text(record.label) ?? '—',
        amount: amount(record.amount),
        count: countOf(record.count, 0),
      },
    ]
  })
}

function moduleOn(raw: Record<string, unknown>, name: string): boolean {
  const modules = asRecord(raw.modules)
  if (!modules || !(name in modules)) return true
  return modules[name] !== false
}

export function parseDashboard(raw: unknown): Dashboard {
  const record = asRecord(raw) ?? {}
  const receivables = asRecord(record.receivables_overdue) ?? asRecord(record.receivables)
  const verifactu = asRecord(record.verifactu_pending) ?? asRecord(record.verifactu)
  return {
    approvals: moduleOn(record, 'approvals') ? blockOf(record.approvals_pending ?? record.approvals ?? {}) : null,
    deadlines: moduleOn(record, 'regulatory') ? blockOf(record.deadlines_next_30d ?? record.deadlines ?? {}) : null,
    receivables: moduleOn(record, 'finance')
      ? {
          amount: amount(receivables?.amount),
          count: countOf(receivables?.count, 0),
          buckets: bucketsOf(receivables?.buckets),
        }
      : null,
    verifactu: moduleOn(record, 'verifactu')
      ? {
          count: countOf(verifactu?.count, 0),
          since: text(verifactu?.since) ?? text(verifactu?.since_at) ?? text(verifactu?.oldest_at),
        }
      : null,
    submissions: moduleOn(record, 'regulatory') ? blockOf(record.submissions_failed ?? record.submissions ?? {}) : null,
    cellar: moduleOn(record, 'cellar') ? blockOf(record.cellar_alerts ?? record.cellar ?? {}) : null,
    stock: moduleOn(record, 'inventory') ? blockOf(record.stock_alerts ?? record.stock ?? {}) : null,
  }
}

export async function loadDashboard(entity: EntityFilter, signal?: AbortSignal): Promise<Dashboard> {
  try {
    const raw = await api<unknown>(`/v1/dashboard?entity=${entity}`, { signal })
    return parseDashboard(raw)
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'WC_NOT_FOUND')) return emptyDashboard()
    throw error
  }
}

export function verifactuClock(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Madrid',
  })
    .format(date)
    .replace(/[\u00a0\u202f]/g, ' ')
}

type DashState = {
  key: string
  data: Dashboard | null
  error: ApiError | null
  loading: boolean
}

export function useDashboard(entity: EntityFilter) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<DashState>({ key: '', data: null, error: null, loading: true })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState((current) => ({
      key: entity,
      data: current.key === entity ? current.data : null,
      error: null,
      loading: true,
    }))
    loadDashboard(entity, controller.signal)
      .then((data) => {
        if (active) setState({ key: entity, data, error: null, loading: false })
      })
      .catch((error: unknown) => {
        if (!active || isAbortError(error)) return
        const next = error instanceof ApiError ? error : new ApiError(0, 'WC_ERROR', copy.error.load)
        setState((current) => ({
          key: entity,
          data: current.key === entity ? current.data : null,
          error: next,
          loading: false,
        }))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, entity])

  useEffect(() => {
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
  }, [entity])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const ready = state.key === entity
  return {
    data: ready ? state.data : null,
    error: ready ? state.error : null,
    loading: state.loading || !ready,
    initial: (state.loading || !ready) && (!ready || state.data == null),
    reload,
  }
}
