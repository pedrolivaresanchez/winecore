export type InvoiceStatus = 'draft' | 'pending_approval' | 'issued' | 'voided' | 'discarded'

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'no_recipient'

export type InvoiceListItem = {
  id: string
  number: string | null
  issue_date: string | null
  legal_entity_id: string
  entity_code: string
  customer_id: string | null
  customer_name: string | null
  subtotal: string | null
  total: string | null
  amount_paid: string | null
  first_due_date: string | null
  payment_status: string
  status: InvoiceStatus | string
  invoice_type: string
  series_id: string
  verifactu_record_id: string | null
  updated_at: string
}

export type InvoicePageResult = {
  items: InvoiceListItem[]
  next_cursor: string | null
  total: number
}

export type InvoiceLine = {
  id: string
  line_no: number
  product_id: string | null
  sku: string | null
  description: string
  lot_id: string | null
  lot_code: string | null
  quantity: string
  unit: string
  unit_price: string
  discount_pct: string
  line_base: string | null
  tax_code: string
  delivery_note_line_id: string | null
  order_line_id: string | null
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

export type InvoiceDue = {
  seq: number
  due_date: string
  amount: string
}

export type InvoiceRectification = {
  id: string
  rectified_invoice_id: string | null
  number: string
  issue_date: string
  issuer_tax_id: string
  base_rectified: string | null
  quota_rectified: string | null
  surcharge_rectified: string | null
  reason: string
}

export type CustomerSnapshot = {
  name?: string
  tax_id?: string | null
  trade_name?: string | null
}

export type Invoice = {
  id: string
  legal_entity_id: string
  entity_code: string
  series_id: string
  number: string | null
  status: InvoiceStatus | string
  invoice_type: string
  rectification_kind: 'S' | 'I' | null
  issue_date: string | null
  operation_date: string | null
  customer_id: string | null
  customer_name: string | null
  customer_snapshot: CustomerSnapshot | null
  ship_to: Record<string, unknown> | null
  customer_references: string | null
  channel: string | null
  sales_order_id: string | null
  currency: string
  language: string
  description: string | null
  notes: string | null
  subtotal: string | null
  tax_total: string | null
  surcharge_total: string | null
  withholding_total: string | null
  importe_total: string | null
  total: string | null
  amount_paid: string | null
  payment_status: string
  payment_method: string | null
  payment_terms_days: number | null
  issued_at: string | null
  verifactu_record_id: string | null
  voided_at: string | null
  void_reason: string | null
  updated_at: string
  lines: InvoiceLine[]
  taxes: InvoiceTax[]
  dues: InvoiceDue[]
  rectifications: InvoiceRectification[]
}

export type LineDraft = {
  key: string
  productId: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
  discountPct: string
  taxCode: string
  lotCode: string
  deliveryNoteLineId: string | null
  orderLineId: string | null
}

export type ValidationIssue = {
  code?: string
  message: string
  field?: string
  details?: Record<string, unknown>
}

export type ValidationResult = {
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export type PendingDelivery = {
  invoice_id: string
  number: string
  entity: string
  customer: string
  issue_date: string
  total: { amount: string; currency: string }
  delivery_status: Exclude<DeliveryStatus, 'sent'>
  attempt: number
  pending_since: string
}

export type DeliveryPackage = {
  filename: string
  mime: string
  to: string[]
  subject_es: string
  body_es: string
  attempt: number
}

export type AuditChange = {
  field: string
  before: unknown
  after: unknown
}

export type AuditItem = {
  id: number
  occurred_at: string
  actor: { display_name: string }
  action: string
  changes: AuditChange[]
}

export type InvoiceQuery = {
  status?: string
  entity?: string
  customerId?: string
  from?: string
  to?: string
  verifactuStatus?: string
  cursor?: string | null
  limit?: number
}

export type CreateInvoiceBody = {
  legal_entity_id?: string
  customer_id?: string
  invoice_type?: string
  rectification_kind?: 'S' | 'I'
  description?: string
  language?: 'es' | 'en'
  operation_date?: string | null
  notes?: string | null
  from_delivery_notes?: string[]
  from_order?: string
  ship_to?: Record<string, string> | null
  customer_references?: string | null
  lines?: {
    product_id: string
    description?: string
    quantity: string
    unit?: string
    unit_price?: string
    discount_pct?: string
    tax_code?: string
    lot_id?: string
    lot_code?: string
    delivery_note_line_id?: string
    order_line_id?: string
  }[]
  rectifies?: { invoice_id: string }[]
  reason?: string
}

export type VoidResult =
  | { status: 'pending'; approval_request_id: string; invoice_id: string }
  | { status: 'voided'; id: string; number: string; void_reason: string; voided_at: string }

export type BatchResult = {
  approval_request_id: string
  status: 'pending' | 'approved'
}

export type SourceKind = 'notes' | 'order' | 'lines'

export const TAX_CODES = ['IVA21', 'IVA21_RE', 'IVA21_ALQ', 'EXP_E2', 'INTRA_E5'] as const

export const VOID_REASONS = ['duplicate', 'wrong_entity', 'wrong_customer'] as const

export type VoidReason = (typeof VOID_REASONS)[number]
