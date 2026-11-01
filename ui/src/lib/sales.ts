import { ApiError, api } from '@/lib/api'
import { copy } from '@/i18n'
import { formatMoney } from '@/lib/format'

export type DocKind = 'quote' | 'order' | 'delivery'

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted'
export type OrderStatus = 'draft' | 'confirmed' | 'partially_delivered' | 'delivered' | 'closed' | 'cancelled'
export type DeliveryStatus = 'draft' | 'issued' | 'shipped' | 'delivered' | 'cancelled'
export type InvoicingStatus = 'not_invoiced' | 'partially_invoiced' | 'invoiced' | 'not_invoiceable'
export type DeliveryKind = 'sale' | 'consignment' | 'transfer' | 'return' | 'sample'
export type ChannelCode = keyof typeof copy.sales.channels
export type SourceCode = 'manual' | 'edi' | 'web' | 'mcp' | 'import'

export type SalesLine = {
  id: string
  line_no: number
  product_id: string | null
  description: string
  quantity: string
  unit_price: string | null
  discount_pct: string
  tax_code: string | null
  lot_id?: string | null
  order_line_id?: string | null
  external_line_ref?: string | null
  unit?: string | null
}

export type Quote = {
  id: string
  legal_entity_id: string
  series_id: string | null
  number: string | null
  status: QuoteStatus
  customer_id: string
  channel: string
  issue_date: string | null
  valid_until: string | null
  currency: string
  language: string
  is_proforma: boolean
  incoterm: string | null
  notes: string | null
  ship_to?: unknown
  customer_references?: string | null
  subtotal: string
  tax_total: string
  total: string
  lines: SalesLine[]
}

export type IssuingPreview = {
  entity_id: string
  entity_code: string
  matched_scope: string
  rule_id: string
  rule_set_id: string
  version: number
  label: string
}

export type SalesOrder = {
  id: string
  number: string | null
  status: OrderStatus
  invoicing_status: InvoicingStatus
  legal_entity_id: string | null
  entity_code: string | null
  source: string
  channel: string
  customer_id: string
  customer_order_ref: string | null
  customer_department: string | null
  customer_cost_center: string | null
  external_ref: string | null
  order_date: string
  requested_date: string | null
  ship_to: unknown
  incoterm: string | null
  quote_id: string | null
  billing_rule_set_id: string | null
  billing_rule_id: string | null
  rule_label: string | null
  issuing_preview: IssuingPreview | null
  currency: string
  notes: string | null
  customer_references?: string | null
  subtotal: string
  tax_total: string
  total: string
  lines: SalesLine[]
}

export type DeliveryNote = {
  id: string
  number: string | null
  kind: DeliveryKind
  status: DeliveryStatus
  invoicing_status: InvoicingStatus
  legal_entity_id: string
  customer_id: string | null
  sales_order_id: string | null
  channel: string | null
  issue_date: string | null
  from_location_id: string
  to_location_id: string | null
  ship_to: unknown
  customer_references?: string | null
  incoterm: string | null
  is_valued: boolean
  tracking_ref: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_reason: string | null
  source_delivery_note_id: string | null
  notes: string | null
  lines: SalesLine[]
}

export type SalesPage<T> = { items: T[]; next_cursor: string | null }

export type PriceQuote = {
  product_id: string
  currency: string
  unit_price: string
  price_list_id: string
  version_id: string
  min_qty: string
}

export type LineInput = {
  product_id?: string
  quantity: string
  discount_pct?: string
  unit_price?: string
  price_reason?: string
  tax_code?: string
  description?: string
  lot_id?: string
  order_line_id?: string
  unit?: string
}

export const CHANNELS = Object.keys(copy.sales.channels) as ChannelCode[]
export const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'] as const
export const TAX_CODES = Object.keys(copy.sales.taxes) as (keyof typeof copy.sales.taxes)[]
export const DELIVERY_KINDS: DeliveryKind[] = ['sale', 'consignment', 'transfer', 'return', 'sample']
export const QUOTE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'converted', 'accepted', 'rejected', 'expired']
export const ORDER_STATUSES: OrderStatus[] = ['draft', 'confirmed', 'partially_delivered', 'delivered', 'closed', 'cancelled']
export const DELIVERY_STATUSES: DeliveryStatus[] = ['draft', 'issued', 'shipped', 'delivered', 'cancelled']

const QUOTE_LABEL: Record<QuoteStatus, string> = {
  draft: copy.sales.draft,
  sent: copy.sales.sent,
  accepted: copy.sales.accepted,
  rejected: copy.sales.rejected,
  expired: copy.sales.expired,
  converted: copy.sales.converted,
}

const ORDER_LABEL: Record<OrderStatus, string> = {
  draft: copy.sales.draft,
  confirmed: copy.sales.confirmed,
  partially_delivered: copy.sales.partial,
  delivered: copy.sales.served,
  closed: copy.sales.closed,
  cancelled: copy.sales.cancelled,
}

const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  draft: copy.sales.draft,
  issued: copy.sales.issued,
  shipped: copy.sales.shipped,
  delivered: copy.sales.delivered,
  cancelled: copy.sales.cancelled,
}

const INVOICE_LABEL: Record<InvoicingStatus, string> = {
  not_invoiced: copy.sales.notInvoiced,
  partially_invoiced: copy.sales.partiallyInvoiced,
  invoiced: copy.sales.invoiced,
  not_invoiceable: copy.sales.notInvoiceableStatus,
}

const KIND_LABEL: Record<DeliveryKind, string> = {
  sale: copy.sales.sale,
  consignment: copy.sales.consignment,
  transfer: copy.sales.transfer,
  return: copy.sales.returnKind,
  sample: copy.sales.sample,
}

const SOURCE_LABEL: Record<string, string> = {
  manual: copy.sales.manual,
  edi: copy.sales.edi,
  web: copy.sales.web,
  mcp: copy.sales.mcp,
  import: copy.sales.importSource,
}

export function channelLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return code in copy.sales.channels ? copy.sales.channels[code as ChannelCode] : code
}

export function quoteStatusLabel(status: string): string {
  return QUOTE_LABEL[status as QuoteStatus] ?? status
}

export function orderStatusLabel(status: string): string {
  return ORDER_LABEL[status as OrderStatus] ?? status
}

export function deliveryStatusLabel(status: string): string {
  return DELIVERY_LABEL[status as DeliveryStatus] ?? status
}

export function invoicingLabel(status: string): string {
  return INVOICE_LABEL[status as InvoicingStatus] ?? status
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind as DeliveryKind] ?? kind
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'sent' || status === 'confirmed' || status === 'issued') return 'info'
  if (status === 'accepted' || status === 'converted' || status === 'delivered' || status === 'invoiced') return 'success'
  if (status === 'partially_delivered' || status === 'shipped' || status === 'partially_invoiced' || status === 'expired') return 'warning'
  if (status === 'rejected' || status === 'cancelled') return 'danger'
  return 'neutral'
}

export function taxLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return code in copy.sales.taxes ? copy.sales.taxes[code as keyof typeof copy.sales.taxes] : code
}

export function docPath(doc: DocKind): string {
  if (doc === 'quote') return '/ventas/presupuestos'
  if (doc === 'order') return '/ventas/pedidos'
  return '/ventas/albaranes'
}

export function docTitle(doc: DocKind): string {
  if (doc === 'quote') return copy.sales.quotes
  if (doc === 'order') return copy.sales.orders
  return copy.sales.deliveries
}

export function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

export function shipCountry(value: unknown): string {
  const record = asRecord(value)
  const code = record?.country_code
  return typeof code === 'string' ? code.toUpperCase() : ''
}

export function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

export function formatQty(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  const [whole, frac = ''] = n.toFixed(3).split('.')
  const trimmed = frac.replace(/0+$/, '')
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return trimmed ? `${grouped},${trimmed}` : grouped
}

export function formatAmount(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
  return formatMoney(n)
}

/** Display-only line base. The document totals come from the API. */
export function lineBase(quantity: string, price: string | null | undefined, discount: string | null | undefined): number | null {
  if (price == null || price === '') return null
  const qty = Number(quantity)
  const unit = Number(price)
  const disc = Number(discount || '0')
  if (![qty, unit, disc].every((n) => Number.isFinite(n))) return null
  return Math.round(qty * unit * (1 - disc / 100) * 100) / 100
}

export function pricesDiffer(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left == null || left === '' || right == null || right === '') return false
  const a = Number(left)
  const b = Number(right)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return left !== right
  return Math.abs(a - b) > 0.0000005
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'WC_RULES_INACTIVE' || /conjunto de reglas activo|regla de entidad facturadora/i.test(error.message)) {
      return copy.sales.rulesInactive
    }
    if (error.code === 'WC010' || /serie inexistente|serie activa/i.test(error.message)) return copy.sales.seriesMissing
    if (/no hay precio de tarifa/i.test(error.message)) return copy.sales.noTariffServer
    const extra = error.fields ? Object.values(error.fields).filter(Boolean).join(' ') : ''
    return extra ? `${error.message} ${extra}` : error.message
  }
  return copy.sales.toast.failed
}

export function listQuotes(cursor?: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '100' })
  if (cursor) params.set('cursor', cursor)
  return api<SalesPage<Quote>>(`/v1/quotes?${params}`, { signal })
}

export function getQuote(id: string) {
  return api<Quote>(`/v1/quotes/${id}`)
}

export function createQuote(body: Record<string, unknown>) {
  return api<Quote>('/v1/quotes', { method: 'POST', body: JSON.stringify(body) })
}

export function sendQuote(id: string) {
  return api<Quote>(`/v1/quotes/${id}/send`, { method: 'POST', body: '{}' })
}

export function patchQuote(id: string, body: Record<string, unknown>) {
  return api<Quote>(`/v1/quotes/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function acceptQuote(id: string) {
  return api<Quote>(`/v1/quotes/${id}/accept`, { method: 'POST', body: '{}' })
}

export function rejectQuote(id: string, reason?: string) {
  const trimmed = reason?.trim() ?? ''
  return api<Quote>(`/v1/quotes/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(trimmed ? { reason: trimmed } : {}),
  })
}

export function quoteToOrder(id: string) {
  return api<SalesOrder>(`/v1/quotes/${id}/to-order`, { method: 'POST', body: '{}' })
}

export function listOrders(
  query: { status?: string; entity?: string; channel?: string; customer?: string; cursor?: string | null },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: '100' })
  if (query.status) params.set('status', query.status)
  if (query.entity) params.set('entity', query.entity)
  if (query.channel) params.set('channel', query.channel)
  if (query.customer) params.set('customer_id', query.customer)
  if (query.cursor) params.set('cursor', query.cursor)
  return api<SalesPage<SalesOrder>>(`/v1/sales-orders?${params}`, { signal })
}

export function getOrder(id: string) {
  return api<SalesOrder>(`/v1/sales-orders/${id}`)
}

export function createOrder(body: Record<string, unknown>) {
  return api<SalesOrder>('/v1/sales-orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

export function patchOrder(id: string, body: Record<string, unknown>) {
  return api<SalesOrder>(`/v1/sales-orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function confirmOrder(id: string) {
  return api<SalesOrder>(`/v1/sales-orders/${id}/confirm`, { method: 'POST', body: '{}' })
}

export function cancelOrder(id: string, reason: string) {
  return api<SalesOrder>(`/v1/sales-orders/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function closeOrder(id: string, reason: string) {
  return api<SalesOrder>(`/v1/sales-orders/${id}/close`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function setEntityException(id: string, legalEntityId: string, reason: string) {
  return api<SalesOrder>(`/v1/sales-orders/${id}/entity-exception`, {
    method: 'POST',
    body: JSON.stringify({ legal_entity_id: legalEntityId, reason }),
  })
}

export function createDeliveryFromOrder(orderId: string, body: Record<string, unknown>) {
  return api<DeliveryNote>(`/v1/sales-orders/${orderId}/delivery-notes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listDeliveries(
  query: { kind?: string; status?: string; invoiced?: string; customer?: string; cursor?: string | null },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: '100' })
  if (query.kind) params.set('kind', query.kind)
  if (query.status) params.set('status', query.status)
  if (query.invoiced) params.set('invoiced', query.invoiced)
  if (query.customer) params.set('customer_id', query.customer)
  if (query.cursor) params.set('cursor', query.cursor)
  return api<SalesPage<DeliveryNote>>(`/v1/delivery-notes?${params}`, { signal })
}

export function getDelivery(id: string) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}`)
}

export function createDelivery(body: Record<string, unknown>) {
  return api<DeliveryNote>('/v1/delivery-notes', { method: 'POST', body: JSON.stringify(body) })
}

export function patchDelivery(id: string, lines: LineInput[] | null, header: Record<string, unknown> = {}) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(lines ? { ...header, lines } : header),
  })
}

export function issueDelivery(id: string) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}/issue`, { method: 'POST', body: '{}' })
}

export function dispatchDelivery(id: string, tracking?: string) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}/dispatch`, {
    method: 'POST',
    body: JSON.stringify(tracking ? { tracking_ref: tracking } : {}),
  })
}

export function deliverDelivery(id: string) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}/deliver`, { method: 'POST', body: '{}' })
}

export function voidDelivery(id: string, reason: string) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function returnDelivery(id: string, body: Record<string, unknown>) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}/return`, { method: 'POST', body: JSON.stringify(body) })
}

export function markNotInvoiceable(id: string, reason: string) {
  return api<DeliveryNote>(`/v1/delivery-notes/${id}/not-invoiceable`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function createIncident(id: string, body: Record<string, unknown>) {
  return api<Record<string, unknown>>(`/v1/delivery-notes/${id}/incidents`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getPriceQuote(
  query: { customerId: string; productId: string; qty: string; date?: string; channel?: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    customer_id: query.customerId,
    product_id: query.productId,
    qty: query.qty || '1',
  })
  if (query.date) params.set('date', query.date)
  if (query.channel) params.set('channel', query.channel)
  return api<PriceQuote>(`/v1/price-quote?${params}`, { signal })
}

export function resolveIssuing(customerId: string, channel: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ customer_id: customerId, channel })
  return api<IssuingPreview | null>(`/v1/billing-rules/resolve?${params}`, { signal }).then((hit) => hit ?? null)
}

export type StockItem = {
  location_id: string
  location_code: string | null
  lot_id: string | null
  lot_code: string | null
  product_id: string | null
  product_sku: string | null
  qty_units: number
  product_state: string
}

export function listStock(signal?: AbortSignal) {
  return api<{ items: StockItem[] }>('/v1/stock/inspection-report?limit=500', { signal })
}
