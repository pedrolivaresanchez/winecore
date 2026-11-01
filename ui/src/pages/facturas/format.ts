import { copy, fill } from '@/i18n'
import { formatMoney } from '@/lib/format'
import type { DeliveryStatus, InvoiceLine, InvoiceStatus, LineDraft, VoidReason } from '@/pages/facturas/types'

export function money(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  return formatMoney(n)
}

export function hasAmount(value: string | number | null | undefined): boolean {
  if (value == null || value === '') return false
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n !== 0
}

export function day(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function entityLabel(code: string | null | undefined): string {
  if (!code) return '—'
  if (code === 'PO') return copy.entity.po
  if (code === 'CVPO') return copy.entity.cvpo
  return code
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: copy.facturas.draft,
    pending_approval: copy.facturas.pendingApproval,
    issued: copy.facturas.issued,
    voided: copy.facturas.voided,
    discarded: copy.facturas.discarded,
  }
  return labels[status] ?? status
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'issued') return 'success'
  if (status === 'voided') return 'danger'
  if (status === 'pending_approval') return 'warning'
  return 'neutral'
}

export function deliveryLabel(status: DeliveryStatus | null): string {
  if (status === 'pending') return copy.facturas.deliveryPending
  if (status === 'sent') return copy.facturas.deliverySent
  if (status === 'failed') return copy.facturas.deliveryFailed
  if (status === 'no_recipient') return copy.facturas.deliveryNone
  return '—'
}

export function deliveryTone(status: DeliveryStatus | null): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'sent') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'pending') return 'warning'
  return 'neutral'
}

export function paymentLabel(status: string): string {
  if (status === 'unpaid') return copy.facturas.unpaid
  if (status === 'partially_paid') return copy.facturas.partial
  if (status === 'paid') return copy.facturas.paidStatus
  if (status === 'uncollectible') return copy.facturas.uncollectible
  return status || '—'
}

export function methodLabel(method: string | null | undefined): string {
  if (method === 'transfer') return copy.facturas.payTransfer
  if (method === 'direct_debit') return copy.facturas.payDebit
  if (method === 'card') return copy.facturas.payCard
  if (method === 'cash') return copy.facturas.payCash
  if (method === 'stripe') return copy.facturas.payStripe
  if (method === 'other') return copy.facturas.payOther
  return method || '—'
}

export function verifactuLabel(recordId: string | null | undefined): string {
  return recordId ? copy.facturas.verifactuAccepted : copy.facturas.verifactuPending
}

export function reasonLabel(reason: VoidReason): string {
  if (reason === 'duplicate') return copy.facturas.reasonDuplicate
  if (reason === 'wrong_entity') return copy.facturas.reasonEntity
  return copy.facturas.reasonCustomer
}

export function kindLabel(kind: 'S' | 'I' | null): string {
  if (kind === 'I') return copy.facturas.kindDiff
  if (kind === 'S') return copy.facturas.kindSub
  return '—'
}

export function invoiceTitle(status: string, number: string | null): string {
  if (number) return number
  if (status === 'draft' || status === 'pending_approval') return copy.facturas.draft
  return copy.facturas.title
}

export function isOpen(status: string): status is Extract<InvoiceStatus, 'draft' | 'pending_approval'> {
  return status === 'draft' || status === 'pending_approval'
}

export function qty(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const [whole, frac = ''] = Math.abs(n).toFixed(3).split('.')
  const trimmed = frac.replace(/0+$/, '')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return trimmed ? `${sign}${grouped},${trimmed}` : `${sign}${grouped}`
}

export function draftsFrom(lines: InvoiceLine[]): LineDraft[] {
  return lines.map((line) => ({
    key: line.id,
    productId: line.product_id ?? '',
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unit_price,
    discountPct: line.discount_pct,
    taxCode: line.tax_code,
    lotCode: line.lot_code ?? '',
    deliveryNoteLineId: line.delivery_note_line_id,
    orderLineId: line.order_line_id,
  }))
}

export function stepLabel(n: number): string {
  return fill(copy.facturas.step, { n: String(n) })
}

export function attemptLabel(n: number): string {
  return fill(copy.facturas.attempt, { n: String(n) })
}

export function daysLabel(n: number): string {
  return fill(copy.facturas.days, { n: String(n) })
}

export const DATE_LABELS = { clear: copy.facturas.clearDate, today: copy.facturas.today }

export function linePayload(lines: LineDraft[]) {
  return lines.map((line) => ({
    product_id: line.productId.trim(),
    description: line.description || undefined,
    quantity: line.quantity.trim(),
    unit_price: line.unitPrice.trim() || undefined,
    discount_pct: line.discountPct.trim() || undefined,
    tax_code: line.taxCode || undefined,
    lot_code: line.lotCode.trim() || undefined,
    delivery_note_line_id: line.deliveryNoteLineId || undefined,
    order_line_id: line.orderLineId || undefined,
  }))
}
