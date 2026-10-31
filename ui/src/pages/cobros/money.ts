import { copy } from '@/i18n'
import { formatMoney } from '@/lib/format'
import type { Me } from '@/lib/types'
import type { AgingBucket, MoneyBuckets, ReceivableItem } from '@/lib/finance'
import type { GridAggregation, GridLabels } from '@/ui'

export function centsOf(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0
    return Math.round(value * 100)
  }
  const trimmed = value.trim().replace(',', '.')
  const negative = trimmed.startsWith('-')
  const raw = negative ? trimmed.slice(1) : trimmed
  if (!/^\d+(\.\d+)?$/.test(raw)) return 0
  const [whole, frac = ''] = raw.split('.')
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2))
  return negative ? -cents : cents
}

export function textFromCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function moneyOf(value: string | number | null | undefined): string {
  const cents = centsOf(value)
  if (value == null || value === '') return '—'
  return formatMoney(cents / 100)
}

export function todayMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function entityLabel(id: string, entities: Me['entities']): string {
  const found = entities.find((entity) => entity.id === id)
  if (!found) return '—'
  if (found.code === 'PO') return copy.entity.po
  if (found.code === 'CVPO') return copy.entity.cvpo
  return found.code
}

export function entityCode(id: string, entities: Me['entities']): string | null {
  return entities.find((entity) => entity.id === id)?.code ?? null
}

const EMPTY_BUCKETS = (): MoneyBuckets => ({
  '0-30': '0.00',
  '31-60': '0.00',
  '61-90': '0.00',
  '>90': '0.00',
  total: '0.00',
  overdue: '0.00',
})

export function sumItems(items: ReceivableItem[]): MoneyBuckets {
  const totals = { '0-30': 0, '31-60': 0, '61-90': 0, '>90': 0, total: 0, overdue: 0 }
  for (const item of items) {
    const cents = centsOf(item.outstanding)
    totals[item.aging] += cents
    totals.total += cents
    if (item.is_overdue) totals.overdue += cents
  }
  return {
    '0-30': textFromCents(totals['0-30']),
    '31-60': textFromCents(totals['31-60']),
    '61-90': textFromCents(totals['61-90']),
    '>90': textFromCents(totals['>90']),
    total: textFromCents(totals.total),
    overdue: textFromCents(totals.overdue),
  }
}

export function emptyBuckets(): MoneyBuckets {
  return EMPTY_BUCKETS()
}

export const BUCKETS: AgingBucket[] = ['0-30', '31-60', '61-90', '>90']

const AGGREGATION: Record<GridAggregation, string> = {
  sum: copy.cobros.grid.sum,
  avg: copy.cobros.grid.avg,
  min: copy.cobros.grid.min,
  max: copy.cobros.grid.max,
  count_empty: copy.cobros.grid.countEmpty,
  count_filled: copy.cobros.grid.countFilled,
  count_unique: copy.cobros.grid.countUnique,
  percent_empty: copy.cobros.grid.percentEmpty,
  percent_filled: copy.cobros.grid.percentFilled,
}

export function gridLabels(openRecord: string): GridLabels {
  return {
    addCalculation: copy.cobros.grid.addCalculation,
    aggregation: (kind) => AGGREGATION[kind],
    aggregations: copy.cobros.grid.aggregations,
    count: (count) => String(count),
    clearCalculation: copy.cobros.grid.clearCalculation,
    selectAll: copy.cobros.grid.selectAll,
    selectRow: copy.cobros.grid.selectRow,
    openRecord,
    sortAscending: copy.cobros.grid.sortAscending,
    sortDescending: copy.cobros.grid.sortDescending,
    columnOptions: copy.cobros.grid.columnOptions,
  }
}

export function scoreLabel(score: string): string {
  return score.replace('.', ',')
}

export function methodLabel(method: string): string {
  const methods = copy.cobros.methods
  if (method in methods) return methods[method as keyof typeof methods]
  return method
}

export function statusLabel(status: string): string {
  if (status === 'registered') return copy.cobros.registered
  if (status === 'reversed') return copy.cobros.reversed
  if (status === 'draft') return copy.cobros.draft
  if (status === 'pending_approval') return copy.cobros.pendingApproval
  if (status === 'file_generated') return copy.cobros.fileGenerated
  if (status === 'uploaded_by_user') return copy.cobros.uploaded
  if (status === 'cancelled') return copy.cobros.cancelled
  if (status === 'suggested') return copy.cobros.suggested
  if (status === 'matched') return copy.cobros.matched
  if (status === 'ignored') return copy.cobros.ignoredStatus
  if (status === 'unmatched') return copy.cobros.noSuggestion
  return status
}

export function kindLabel(kind: string): string {
  if (kind === 'direct_debit') return copy.cobros.directDebit
  if (kind === 'credit_transfer') return copy.cobros.creditTransfer
  return kind
}
