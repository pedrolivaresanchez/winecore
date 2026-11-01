import { api, apiBlob } from '@/lib/api'

export type AgingBucket = '0-30' | '31-60' | '61-90' | '>90'
export type TargetTable = 'billing.invoice' | 'purchasing.supplier_invoice' | 'legacy.open_item'
export type Direction = 'in' | 'out'
export type PaymentMethod = 'transfer' | 'direct_debit' | 'card' | 'cash' | 'stripe' | 'compensation' | 'other'
export type RemittanceKind = 'direct_debit' | 'credit_transfer'
export type StatementFormat = 'n43' | 'camt053'

export type MoneyBuckets = Record<AgingBucket | 'total' | 'overdue', string>

export type ReceivableItem = {
  target_table: TargetTable
  target_id: string
  /** The invoice the document viewer opens: Holded's invoice id or WineCore's own. */
  document_id: string
  legal_entity_id: string
  entity_code: string | null
  document_number: string
  /** As the document names the customer; Holded's own text when no contact matched. */
  counterparty_name: string | null
  contact_match: 'contact' | 'tax_id' | 'name' | null
  issue_date: string
  due_date: string | null
  outstanding: string
  aging: AgingBucket
  /** Days past the due date (or the issue date without one); 0 while not yet due. */
  days: number
  is_overdue: boolean
  origin: 'winecore' | 'holded'
  source_label: string | null
}

export type ReceivableGroup = {
  /** The contact, or `name:<name>` for Holded items that matched none. Unique per group. */
  key: string
  contact_id: string | null
  customer_name: string
  amounts: MoneyBuckets
  items: ReceivableItem[]
}

export type ReceivablesSummary = {
  pending_total: string
  overdue_total: string
  due_next_30: string
  collected_this_month: string
  by_entity: { entity_code: string; pending: string; overdue: string }[]
}

export type Receivables = {
  as_of: string
  status: 'clear' | 'open'
  groups: ReceivableGroup[]
  totals: MoneyBuckets
  /** Over everything open for the entity and contact asked for; the aging filter does not cut it. */
  summary: ReceivablesSummary
}

export type Allocation = {
  id: string
  target_table: TargetTable
  target_id: string
  amount: string
  document_number: string | null
  outstanding: string | null
  payment_status: string | null
}

export type Payment = {
  id: string
  legal_entity_id: string
  direction: Direction
  method: string
  amount: string
  currency: string
  value_date: string | null
  counterparty_id: string | null
  counterparty_name: string | null
  bank_account_id: string | null
  reference: string | null
  source: string
  status: string
  reversal_reason: string | null
  allocations: Allocation[]
  unallocated: string
  warnings?: string[]
}

export type PaymentPage = {
  items: Payment[]
  next_cursor: string | null
  total: number
}

export type BankAccount = {
  id: string
  legal_entity_id: string
  bank_name: string
  iban_last4: string
  bic: string | null
  sepa_creditor_id: string | null
  is_default: boolean
  is_active: boolean
}

export type Suggestion = {
  target_table: TargetTable
  target_id: string
  document_number: string
  score: string
  reason: string
}

export type StatementLine = {
  id: string
  booking_date: string | null
  value_date: string | null
  amount: string
  description: string
  counterparty_name: string | null
  reference: string | null
  status: string
  suggestions: Suggestion[]
  matched_payment_id: string | null
}

export type StatementSuggestions = {
  import_id: string
  format: string
  lines: StatementLine[]
}

export type StatementImport = {
  id: string
  bank_account_id: string
  format: string
  lines_count: number
  inserted: number
  duplicates: number
  matched: number
  suggested: number
}

export type RemittanceItem = {
  id: string
  target_table: TargetTable
  target_id: string
  counterparty_id: string
  amount: string
  mandate_ref: string | null
  end_to_end_id: string
  status: string
}

export type RemittanceSummary = {
  id: string
  legal_entity_id: string
  entity_code: string
  kind: RemittanceKind | string
  status: string
  bank_account_id: string
  execution_date: string | null
  total: string
  created_at: string | null
}

export type Remittance = {
  id: string
  legal_entity_id: string
  kind: RemittanceKind | string
  status: string
  bank_account_id: string
  execution_date: string | null
  total: string
  file_sha256: string | null
  file_attachment_id: string | null
  content_sha256?: string | null
  items: RemittanceItem[]
}

function idempotent(path: string, body: unknown) {
  return api<Payment>(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

export function receivablesPath(entity: string | null, aging: string | null, contactId?: string | null) {
  const params = new URLSearchParams()
  if (entity) params.set('entity', entity)
  if (aging) params.set('aging', aging)
  if (contactId) params.set('contact_id', contactId)
  const qs = params.toString()
  return `/v1/receivables${qs ? `?${qs}` : ''}`
}

export function paymentsPath(
  query: { entity?: string | null; direction?: string | null; from?: string | null; to?: string | null },
  cursor?: string | null,
  limit = 100,
) {
  const params = new URLSearchParams()
  if (query.entity) params.set('entity', query.entity)
  if (query.direction) params.set('direction', query.direction)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', cursor)
  return `/v1/payments?${params.toString()}`
}

export function accountsPath(entity: string | null) {
  return entity ? `/v1/bank-accounts?entity=${encodeURIComponent(entity)}` : '/v1/bank-accounts'
}

export function createPayment(body: {
  direction: Direction
  method: PaymentMethod
  amount: string
  value_date: string
  counterparty_id: string
  legal_entity_id: string
  reference?: string | null
  bank_account_id?: string | null
  allocations: { target_table: TargetTable; target_id: string; amount: string }[]
}) {
  return idempotent('/v1/payments', body)
}

export function reversePayment(id: string, reason: string) {
  return idempotent(`/v1/payments/${id}/reverse`, { reason })
}

export function createBankAccount(body: {
  legal_entity_id: string
  bank_name: string
  iban: string
  bic?: string | null
  is_default?: boolean
}) {
  return api<BankAccount>('/v1/bank-accounts', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

export function uploadStatement(body: {
  bank_account_id: string
  format: StatementFormat
  filename: string
  content_base64: string
}) {
  return api<StatementImport>('/v1/bank-statements', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

export function confirmLine(
  importId: string,
  lineId: string,
  allocation: { target_table: TargetTable; target_id: string; amount: string },
) {
  return api<{ line_id: string; status: string }>(`/v1/bank-statements/${importId}/lines/${lineId}/confirm`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      allocations: [allocation],
    }),
  })
}

export function ignoreLine(importId: string, lineId: string, reason: string) {
  return api<{ id: string; status: string }>(`/v1/bank-statements/${importId}/lines/${lineId}/ignore`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ reason }),
  })
}

export function createRemittance(body: {
  legal_entity_id: string
  kind: RemittanceKind
  bank_account_id: string
  execution_date: string
  items: { target_table: TargetTable; target_id: string; amount?: string }[]
}) {
  return api<Remittance>('/v1/remittances', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  })
}

export function requestRemittanceApproval(id: string) {
  return api<Remittance>(`/v1/remittances/${id}/request-approval`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: '{}',
  })
}

export function generateRemittance(id: string) {
  return api<Remittance>(`/v1/remittances/${id}/generate`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: '{}',
  })
}

export function markRemittanceSubmitted(id: string) {
  return api<Remittance>(`/v1/remittances/${id}/submitted`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: '{}',
  })
}

export async function downloadRemittance(id: string) {
  const file = await apiBlob(`/v1/remittances/${id}/file`)
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename ?? 'remesa.xml'
  link.click()
  URL.revokeObjectURL(url)
}

export function listRemittances(
  query: { entity?: string | null; kind?: string | null; cursor?: string | null; limit: number },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: String(query.limit) })
  if (query.entity) params.set('entity', query.entity)
  if (query.kind) params.set('kind', query.kind)
  if (query.cursor) params.set('cursor', query.cursor)
  return api<{ items: RemittanceSummary[]; next_cursor: string | null; total: number }>(`/v1/remittances?${params}`, { signal })
}
