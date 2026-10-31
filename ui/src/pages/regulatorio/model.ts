import { copy, fill } from '@/i18n'
import { formatDate, formatLitres } from '@/lib/format'
import { entityName } from '@/lib/labels'
import { allows } from '@/lib/permissions'
import type { BadgeTone } from '@/ui'
import type { Me } from '@/lib/types'
import type { Submission } from '@/pages/regulatorio/api'

export const DATE_LABELS = { clear: copy.regulatorio.dateClear, today: copy.regulatorio.dateToday }

export const REGULATORY_VIEWS = [
  { id: 'presentaciones', label: copy.regulatorio.presentaciones, path: '/regulatorio' },
  { id: 'calendario', label: copy.regulatorio.calendario, path: '/regulatorio/calendario' },
  { id: 'mayores', label: copy.regulatorio.mayores, path: '/regulatorio/mayores' },
] as const

export type RegulatoryView = (typeof REGULATORY_VIEWS)[number]['id']

export type DeadlineBand = 'd30' | 'd7' | 'd1' | 'overdue'

export type WarehouseOption = {
  id: string
  name: string
  entityId: string
}

const REF = /^[A-Za-z0-9][A-Za-z0-9./_-]{3,39}$/
const ADVISOR = /^[A-Za-z0-9 .:_-]{3,80}$/

export function canPrepare(me: Me): boolean {
  return allows(me, 'regulatory.prepare')
}

/** El propietario y el asesor validan el mayor; la API también acepta quien prepara. */
export function canValidateLedger(me: Me): boolean {
  if (me.roles.some((role) => role.role === 'owner' || role.role === 'advisor')) return true
  return allows(me, 'regulatory.prepare')
}

export function madridToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function madridMonth(now = new Date()): string {
  return madridToday(now).slice(0, 7)
}

export function daysUntil(today: string, due: string): number {
  const start = Date.parse(`${today.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${due.slice(0, 10)}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export function deadlineBand(today: string, due: string): DeadlineBand | null {
  const days = daysUntil(today, due)
  if (days < 0) return 'overdue'
  if (days <= 1) return 'd1'
  if (days <= 7) return 'd7'
  if (days <= 30) return 'd30'
  return null
}

export function bandLabel(band: DeadlineBand, count: number): string {
  const one = count === 1
  if (band === 'overdue') return one ? copy.regulatorio.overdueOne : fill(copy.regulatorio.overdueMany, { n: String(count) })
  if (band === 'd1') return one ? copy.regulatorio.d1One : fill(copy.regulatorio.d1Many, { n: String(count) })
  if (band === 'd7') return one ? copy.regulatorio.d7One : fill(copy.regulatorio.d7Many, { n: String(count) })
  return one ? copy.regulatorio.d30One : fill(copy.regulatorio.d30Many, { n: String(count) })
}

export function shiftMonth(ym: string, delta: number): string {
  const [year, month] = ym.split('-').map(Number) as [number, number]
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthTitle(ym: string): string {
  const [year, month] = ym.split('-').map(Number) as [number, number]
  const raw = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )
  return raw.charAt(0).toLocaleUpperCase('es-ES') + raw.slice(1)
}

export function dayMonth(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace('.', '')
}

export function isoWeek(iso: string): number {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

function monthStamp(iso: string): string {
  const [year, month] = iso.slice(0, 10).split('-').map(Number) as [number, number]
  return new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace('.', '')
    .replace(' de ', ' ')
}

export function periodTitle(start: string | null, end: string | null): string {
  if (!start && !end) return copy.regulatorio.filing
  if (start && end) {
    const from = monthStamp(start)
    const to = monthStamp(end)
    return from === to ? from : `${from} – ${to}`
  }
  return monthStamp(start ?? end ?? '')
}

export function periodRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`
  if (start || end) return formatDate(start ?? end ?? '')
  return '—'
}

export function litresLabel(value: string): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value || '—'
  return formatLitres(amount)
}

export function shortHash(hex: string): string {
  const clean = hex.trim()
  if (clean.length <= 12) return clean.toUpperCase()
  return `${clean.slice(0, 4).toUpperCase()}…${clean.slice(-4).toUpperCase()}`
}

export function entityLabel(entities: Me['entities'], id: string): string {
  const found = entities.find((entity) => entity.id === id)
  return found ? entityName(found.code) : '—'
}

export function caeOf(files: { filename: string }[]): string | null {
  for (const file of files) {
    const match = /^IES(?:A1V2|X4)-(ES[0-9A-Z]{11})-/.exec(file.filename)
    if (match?.[1]) return match[1]
  }
  return null
}

export function warehouseLabel(warehouses: WarehouseOption[], id: string | null, files: { filename: string }[]): string {
  if (!id) return '—'
  const found = warehouses.find((item) => item.id === id)
  if (found) return found.name
  return caeOf(files) ?? '—'
}

export function flowLabel(flow: string): string {
  if (flow === 'silicie') return 'SILICIE'
  return flow.toUpperCase()
}

export function classLabel(value: string): string {
  const classes = copy.regulatorio.classes as Record<string, string>
  return classes[value] ?? value
}

export function statusMeta(status: string, phase: string): { label: string; tone: BadgeTone } {
  if (phase === 'corrected' || status === 'rectified') return { label: copy.regulatorio.statuses.corrected, tone: 'info' }
  switch (status) {
    case 'draft':
      return { label: copy.regulatorio.statuses.draft, tone: 'neutral' }
    case 'validated':
      return { label: copy.regulatorio.statuses.validated, tone: 'info' }
    case 'pending_approval':
      return { label: copy.regulatorio.statuses.pending_approval, tone: 'warning' }
    case 'approved':
    case 'submitting':
      return { label: copy.regulatorio.statuses.approved, tone: 'success' }
    case 'submitted':
      return { label: copy.regulatorio.statuses.submitted, tone: 'info' }
    case 'accepted':
      return { label: copy.regulatorio.statuses.accepted, tone: 'success' }
    case 'accepted_with_errors':
      return { label: copy.regulatorio.statuses.accepted_with_errors, tone: 'warning' }
    case 'rejected':
      return { label: copy.regulatorio.statuses.rejected, tone: 'danger' }
    case 'cancelled':
      return { label: copy.regulatorio.statuses.cancelled, tone: 'neutral' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

export function stepIndex(status: string, phase: string): number {
  if (phase === 'corrected' || status === 'rectified') return 5
  if (status === 'accepted' || status === 'rejected' || status === 'accepted_with_errors') return 5
  if (status === 'submitted') return 4
  if (status === 'approved' || status === 'submitting') return 3
  if (status === 'pending_approval') return 2
  if (status === 'validated') return 1
  return 0
}

export function resultStepLabel(status: string, phase: string): string {
  if (phase === 'corrected' || status === 'rectified') return copy.regulatorio.statuses.corrected
  if (status === 'accepted') return copy.regulatorio.statuses.accepted
  if (status === 'rejected') return copy.regulatorio.statuses.rejected
  if (status === 'accepted_with_errors') return copy.regulatorio.statuses.accepted_with_errors
  return copy.regulatorio.statuses.result
}

export type PrimaryAction = 'validate' | 'request' | 'approval' | 'register' | 'result' | 'correct'

export function primaryAction(item: Pick<Submission, 'status' | 'phase' | 'ready_for_approval'>): PrimaryAction | null {
  if (item.phase === 'corrected') return null
  if (item.status === 'draft') return 'validate'
  if (item.status === 'validated' && item.ready_for_approval) return 'request'
  if (item.status === 'pending_approval') return 'approval'
  if (item.status === 'approved' || item.status === 'submitting') return 'register'
  if (item.status === 'submitted') return 'result'
  if (item.status === 'accepted' || item.status === 'rejected' || item.status === 'accepted_with_errors') return 'correct'
  return null
}

export function entryStatusMeta(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case 'accepted':
      return { label: copy.regulatorio.entryStatuses.accepted, tone: 'success' }
    case 'rejected':
      return { label: copy.regulatorio.entryStatuses.rejected, tone: 'danger' }
    case 'in_submission':
      return { label: copy.regulatorio.entryStatuses.in_submission, tone: 'info' }
    case 'annulled':
      return { label: copy.regulatorio.entryStatuses.annulled, tone: 'neutral' }
    default:
      return { label: copy.regulatorio.entryStatuses.pending, tone: 'neutral' }
  }
}

export function validRef(value: string): boolean {
  return REF.test(value.trim())
}

export function validAdvisorRef(value: string): boolean {
  return ADVISOR.test(value.trim())
}

export function matchesStatus(item: Pick<Submission, 'status' | 'phase'>, filter: string): boolean {
  if (!filter) return true
  if (filter === 'corrected') return item.phase === 'corrected' || item.status === 'rectified'
  if (filter === 'approved') return item.status === 'approved' || item.status === 'submitting'
  return item.status === filter
}

export const STATUS_FILTERS = [
  '',
  'draft',
  'validated',
  'pending_approval',
  'approved',
  'submitted',
  'accepted',
  'accepted_with_errors',
  'rejected',
  'corrected',
] as const

export function filterLabel(id: (typeof STATUS_FILTERS)[number]): string {
  if (!id) return copy.regulatorio.all
  if (id === 'corrected') return copy.regulatorio.statuses.corrected
  return statusMeta(id, '').label
}
