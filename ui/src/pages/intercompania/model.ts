import type { BadgeTone } from '@/ui'
import { copy, fill } from '@/i18n'
import { formatInteger, formatLitres, formatMoney, formatPercent } from '@/lib/format'
import type { Me } from '@/lib/types'

export type TariffStatus = 'draft' | 'active' | 'retired'

export type Tariff = {
  id: string
  seller_entity_id: string
  buyer_entity_id: string
  base_price_list_id: string
  discount_pct: string
  valid_from: string
  valid_to: string | null
  status: TariffStatus
  advisor_validation: string
  created_by: string
  created_at: string
}

export type TariffDraft = {
  discount: string
  validFrom: string | null
  validTo: string | null
  advisor: string
  baseListId: string
}

export function draftFromTariff(tariff: Tariff, validFrom?: string): TariffDraft {
  return {
    discount: discountLabel(tariff.discount_pct).replace(' %', '').replace('.', ','),
    validFrom: validFrom ?? tariff.valid_from,
    validTo: validFrom ? null : tariff.valid_to,
    advisor: tariff.advisor_validation,
    baseListId: tariff.base_price_list_id,
  }
}

export function emptyDraft(baseListId: string): TariffDraft {
  return { discount: '60', validFrom: null, validTo: null, advisor: '', baseListId }
}

export type TariffInput = {
  base_price_list_id: string
  discount_pct: string
  valid_from: string
  valid_to: string | null
  advisor_validation: string
}

export type WatcherStatus = 'open' | 'no_movements' | 'draft' | 'pending_issue' | 'overdue' | 'issued'

export type SettlementStatus = 'open' | 'closed' | 'invoiced' | 'cancelled'

export type SettlementLine = {
  id: string
  source_table: string
  source_id: string
  product_id: string
  product_name: string
  sku: string
  lot_id: string | null
  lot_code: string | null
  quantity: string
  base_unit_price: string
  discount_pct: string
  unit_price: string
  unit_cost: string | null
  below_cost: boolean
  cost_unknown: boolean
  occurred_at: string
  occurred_on: string
  document_number: string | null
  amount: string
  liters: string | null
}

export type InvoiceLine = {
  line_no: number
  product_id: string
  sku: string
  description: string
  lot_id: string | null
  lot_code: string | null
  quantity: string
  unit: string
  unit_price: string
  line_base: string
  tax_code: string
  unit_cost: string | null
}

export type InvoiceTax = {
  tax_code: string
  rate: string
  base: string
  quota: string
  surcharge_rate: string
  surcharge_quota: string
  withholding_rate: string
  withholding: string
}

export type Invoice = {
  id: string
  status: string
  series_id: string
  operation_date: string
  issue_date: string | null
  issuer_income_tax: 'IRPF' | 'IS'
  description: string
  subtotal: string
  tax_total: string
  surcharge_total: string
  withholding_total: string
  importe_total: string
  total_to_pay: string
  approval_request_id: string | null
  lines: InvoiceLine[]
  taxes: InvoiceTax[]
  dues_preview: { due_date: string; amount: string; assumed_issue_date: string }[]
}

export type Blocker = {
  code: string
  product_id: string
  product_name: string
  occurred_on?: string
  reason?: string
  unit_price?: string
  unit_cost?: string
}

export type Settlement = {
  id: string | null
  seller_entity_id: string
  buyer_entity_id: string
  period: string
  period_start: string
  period_end: string
  status: SettlementStatus
  operation_date: string
  issue_deadline: string
  warn_from: string
  watcher_status: WatcherStatus
  pending_issue: boolean
  watcher_message: string
  tariff_id: string | null
  lines: SettlementLine[]
  totals: { units: string; liters: string | null; amount: string }
  blockers: Blocker[]
  invoice: Invoice | null
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

export function isOwner(me: Me): boolean {
  return me.roles.some((role) => role.role === 'owner')
}

export function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function shiftPeriod(period: string, delta: number): string {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function periodWindow(current: string, back: number): string[] {
  const periods: string[] = []
  for (let index = 0; index <= back; index += 1) periods.push(shiftPeriod(current, -index))
  return periods
}

export function isPeriod(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return false
  const month = Number(match[2])
  return month >= 1 && month <= 12
}

export function periodTitle(period: string): string {
  const month = MONTHS[Number(period.slice(5, 7)) - 1]
  const name = month ?? period
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${period.slice(0, 4)}`
}

export function formatCivil(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return '—'
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function windowLabel(tariff: Pick<Tariff, 'valid_from' | 'valid_to'>): string {
  const from = formatCivil(tariff.valid_from)
  if (!tariff.valid_to) return `${copy.intercompany.validFrom} ${from}`
  return `${from} – ${formatCivil(tariff.valid_to)}`
}

function grouped(value: number, digits: number): string {
  const sign = value < 0 ? '−' : ''
  const [whole, frac] = Math.abs(value).toFixed(digits).split('.')
  const groupedWhole = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return digits > 0 ? `${sign}${groupedWhole},${frac}` : `${sign}${groupedWhole}`
}

export function formatQty(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n - Math.round(n)) < 1e-9) return formatInteger(Math.round(n))
  return grouped(n, 3)
}

export function formatUnitPrice(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const trimmed = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  const fraction = trimmed.split('.')[1]?.length ?? 0
  return `${grouped(n, Math.max(2, Math.min(4, fraction)))} €`
}

export function formatAmount(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value)
  return formatMoney(n)
}

export function formatSignedAmount(value: string): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return formatMoney(0)
  return `−${formatMoney(Math.abs(n))}`
}

export function tariffStatusLabel(status: TariffStatus): string {
  if (status === 'active') return copy.intercompany.activeOne
  if (status === 'retired') return copy.intercompany.retiredOne
  return copy.intercompany.draft
}

export function tariffTone(status: TariffStatus): BadgeTone {
  if (status === 'active') return 'success'
  return 'neutral'
}

export function watcherLabel(status: WatcherStatus): string {
  switch (status) {
    case 'open':
      return copy.intercompany.open
    case 'no_movements':
      return copy.intercompany.noMovements
    case 'draft':
      return copy.intercompany.draft
    case 'pending_issue':
      return copy.intercompany.pendingIssue
    case 'overdue':
      return copy.intercompany.overdueOne
    case 'issued':
      return copy.intercompany.issued
    default:
      return status
  }
}

export function watcherTone(status: WatcherStatus): BadgeTone {
  switch (status) {
    case 'pending_issue':
      return 'warning'
    case 'overdue':
      return 'danger'
    case 'issued':
      return 'success'
    case 'draft':
      return 'info'
    default:
      return 'neutral'
  }
}

export function settlementStatusLabel(status: SettlementStatus): string {
  switch (status) {
    case 'open':
      return copy.intercompany.open
    case 'closed':
      return copy.intercompany.closed
    case 'invoiced':
      return copy.intercompany.invoiced
    case 'cancelled':
      return copy.intercompany.cancelled
    default:
      return status
  }
}

export function invoiceStatusLabel(status: string): string {
  if (status === 'draft') return copy.intercompany.draft
  if (status === 'pending_approval') return copy.intercompany.pendingApproval
  if (status === 'issued') return copy.intercompany.issued
  if (status === 'voided') return copy.intercompany.voided
  return status
}

export function invoiceTone(status: string): BadgeTone {
  if (status === 'pending_approval') return 'warning'
  if (status === 'issued') return 'success'
  if (status === 'voided') return 'danger'
  return 'neutral'
}

export function sourceLabel(line: Pick<SettlementLine, 'source_table' | 'document_number'>): string {
  const note = line.source_table === 'sales.delivery_note_line'
  const name = note ? copy.intercompany.sourceNote : copy.intercompany.sourceOwnership
  return line.document_number ? `${name} ${line.document_number}` : name
}

export function blockerText(blocker: Blocker): string {
  if (blocker.code === 'WC_IC_TARIFF_MISSING') {
    const template = blocker.reason === 'base_price' ? copy.intercompany.missingPrice : copy.intercompany.missingTariff
    return fill(template, { product: blocker.product_name })
  }
  if (blocker.code === 'WC_INV_LOT_REQUIRED') return fill(copy.intercompany.missingLot, { product: blocker.product_name })
  if (blocker.code === 'WC_IC_BELOW_COST') return `${blocker.product_name} · ${copy.intercompany.belowCost}`
  return blocker.product_name
}

export function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? '9999-12-31'
  const bEnd = bTo ?? '9999-12-31'
  return aFrom < bEnd && bFrom < aEnd
}

export function overlappingActive(tariff: Tariff, all: readonly Tariff[]): Tariff | null {
  if (tariff.status === 'retired') return null
  return (
    all.find(
      (other) =>
        other.id !== tariff.id &&
        other.status === 'active' &&
        rangesOverlap(tariff.valid_from, tariff.valid_to, other.valid_from, other.valid_to),
    ) ?? null
  )
}

export function parseDiscount(raw: string): { value: string } | { error: string } {
  const text = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Usa hasta 2 decimales' }
  const n = Number(text)
  if (n < 0 || n >= 100) return { error: 'Tiene que ser menor que 100' }
  return { value: n.toFixed(2) }
}

export function discountLabel(value: string): string {
  return formatPercent(Number(value))
}

export type SettlementIndexItem = {
  id: string
  period: string
  status: string
  seller_entity_id: string
  buyer_entity_id: string
  totals: { units: string; liters: string | null; amount: string }
  deadline: string
}

export type SettlementRow = {
  id: string
  period: string
  status: SettlementStatus
  totals: { units: string; liters: string | null; amount: string }
  issue_deadline: string
  watcher_status: WatcherStatus
}

function shiftIso(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match?.[1] || !match[2] || !match[3]) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return date.toISOString().slice(0, 10)
}

function settlementStatus(value: string): SettlementStatus {
  if (value === 'closed' || value === 'invoiced' || value === 'cancelled' || value === 'open') return value
  return 'open'
}

export function watcherFromIndex(item: Pick<SettlementIndexItem, 'status' | 'totals' | 'deadline'>, today: string): WatcherStatus {
  if (item.status === 'invoiced') return 'issued'
  if (item.status === 'cancelled') return 'no_movements'
  const units = Number(item.totals.units)
  const hasLines = Number.isFinite(units) && units > 0
  const closed = item.status === 'closed'
  if (!hasLines && closed) return 'no_movements'
  if (hasLines && today > item.deadline) return 'overdue'
  const warn = shiftIso(item.deadline, -3)
  if (hasLines && warn && today >= warn) return 'pending_issue'
  if (closed) return 'draft'
  return 'open'
}

export function rowFromIndex(item: SettlementIndexItem, today: string): SettlementRow {
  return {
    id: item.id,
    period: item.period,
    status: settlementStatus(item.status),
    totals: item.totals,
    issue_deadline: item.deadline,
    watcher_status: watcherFromIndex(item, today),
  }
}

export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function sumAmounts(lines: readonly { amount: string }[]): number {
  return lines.reduce((sum, line) => sum + Number(line.amount), 0)
}

export function costTotal(lines: readonly SettlementLine[]): number | null {
  if (lines.length === 0) return null
  if (lines.some((line) => line.unit_cost == null)) return null
  return lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_cost), 0)
}

export function litersLabel(value: string | null): string {
  if (value == null) return '—'
  return formatLitres(Number(value))
}

export function sharedDiscount(lines: readonly SettlementLine[]): string | null {
  const values = [...new Set(lines.map((line) => line.discount_pct))]
  return values.length === 1 ? (values[0] ?? null) : null
}

export function withholdingRate(invoice: Invoice): string | null {
  const tax = invoice.taxes.find((item) => Number(item.withholding_rate) > 0)
  return tax ? tax.withholding_rate : null
}

export function baseListOptions(tariffs: readonly Tariff[]): string[] {
  return [...new Set(tariffs.map((tariff) => tariff.base_price_list_id))]
}

export const GRID_LABELS = {
  addCalculation: copy.intercompany.addCalculation,
  aggregation: () => copy.intercompany.calculation,
  aggregations: copy.intercompany.calculations,
  count: (n: number) => `${n}`,
  clearCalculation: copy.intercompany.clearCalculation,
  selectAll: copy.intercompany.selectAll,
  selectRow: copy.intercompany.selectRow,
  openRecord: copy.intercompany.openRecord,
  sortAscending: copy.intercompany.sortAsc,
  sortDescending: copy.intercompany.sortDesc,
  columnOptions: copy.intercompany.columnOptions,
}

export const DATE_LABELS = { clear: copy.intercompany.clearDate, today: copy.intercompany.today }
