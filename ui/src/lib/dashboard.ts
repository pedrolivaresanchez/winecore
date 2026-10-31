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
  alerts: AttentionBlock | null
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
    alerts: emptyBlock(),
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

function hasKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/** A missing key or an explicit null means the seat cannot see that section. */
function pickBlock(record: Record<string, unknown>, key: string, legacy?: string): AttentionBlock | null {
  if (hasKey(record, key)) return blockOf(record[key])
  if (legacy && hasKey(record, legacy)) return blockOf(record[legacy])
  return null
}

function pickReceivables(record: Record<string, unknown>): ReceivablesBlock | null {
  const key = hasKey(record, 'receivables_overdue') ? 'receivables_overdue' : hasKey(record, 'receivables') ? 'receivables' : null
  if (!key || record[key] === null) return null
  const receivables = asRecord(record[key])
  return {
    amount: amount(receivables?.amount),
    count: countOf(receivables?.count, 0),
    buckets: bucketsOf(receivables?.buckets),
  }
}

function pickVerifactu(record: Record<string, unknown>): VerifactuBlock | null {
  const key = hasKey(record, 'verifactu_pending') ? 'verifactu_pending' : hasKey(record, 'verifactu') ? 'verifactu' : null
  if (!key || record[key] === null) return null
  const verifactu = asRecord(record[key])
  return {
    count: countOf(verifactu?.count, 0),
    since: text(verifactu?.since) ?? text(verifactu?.since_at) ?? text(verifactu?.oldest_at),
  }
}

export function parseDashboard(raw: unknown): Dashboard {
  const record = asRecord(raw) ?? {}
  return {
    approvals: pickBlock(record, 'approvals_pending', 'approvals'),
    deadlines: pickBlock(record, 'deadlines_next_30d', 'deadlines'),
    receivables: pickReceivables(record),
    alerts: pickBlock(record, 'alerts'),
    verifactu: pickVerifactu(record),
    submissions: pickBlock(record, 'submissions_failed', 'submissions'),
    cellar: pickBlock(record, 'cellar_alerts', 'cellar'),
    stock: pickBlock(record, 'stock_alerts', 'stock'),
  }
}

export async function loadDashboard(entity: EntityFilter, signal?: AbortSignal): Promise<Dashboard> {
  const raw = await api<unknown>(`/v1/dashboard?entity=${encodeURIComponent(entity)}`, { signal })
  return parseDashboard(raw)
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
