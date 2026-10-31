import { ApiError, api, apiText } from '@/lib/api'
import { copy } from '@/i18n'
import type {
  AuditItem,
  BatchResult,
  CreateInvoiceBody,
  DeliveryPackage,
  Invoice,
  InvoicePageResult,
  InvoiceQuery,
  PendingDelivery,
  ValidationResult,
  VoidResult,
} from '@/pages/facturas/types'

function queryString(query: InvoiceQuery): string {
  const params = new URLSearchParams()
  if (query.status) params.set('status', query.status)
  if (query.entity) params.set('entity', query.entity)
  if (query.customerId) params.set('customer_id', query.customerId)
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.cursor) params.set('cursor', query.cursor)
  params.set('limit', String(query.limit ?? 50))
  return params.toString()
}

export function listInvoices(query: InvoiceQuery, signal?: AbortSignal) {
  return api<InvoicePageResult>(`/v1/invoices?${queryString(query)}`, { signal })
}

export function getInvoice(id: string, signal?: AbortSignal) {
  return api<Invoice>(`/v1/invoices/${id}`, { signal })
}

export function createInvoice(body: CreateInvoiceBody) {
  return api<Invoice>('/v1/invoices', { method: 'POST', body: JSON.stringify(body) })
}

export function patchInvoice(id: string, version: string, body: Record<string, unknown>) {
  return api<Invoice>(`/v1/invoices/${id}`, {
    method: 'PATCH',
    headers: { 'If-Match': version },
    body: JSON.stringify(body),
  })
}

export function validateInvoice(id: string) {
  return api<ValidationResult>(`/v1/invoices/${id}/validate`, { method: 'POST', body: '{}' })
}

export function issueInvoice(id: string, key: string) {
  return api<{ number: string | null }>(`/v1/invoices/${id}/issue`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: '{}',
  })
}

export function voidInvoice(id: string, reasonCode: string, reasonText: string) {
  return api<VoidResult>(`/v1/invoices/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason_code: reasonCode, reason_text: reasonText }),
  })
}

export function discardInvoice(id: string, reason: string) {
  return api<Invoice>(`/v1/invoices/${id}/discard`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export function requestBatch(invoiceIds: string[]) {
  return api<BatchResult>('/v1/invoices/batch-issue-request', {
    method: 'POST',
    body: JSON.stringify({ invoice_ids: invoiceIds }),
  })
}

export function exportBook(entity: string, from: string, to: string) {
  const params = new URLSearchParams({ entity, from, to })
  return apiText(`/v1/invoices/export?${params}`)
}

export async function listPendingDeliveries(signal?: AbortSignal): Promise<PendingDelivery[]> {
  const items: PendingDelivery[] = []
  let cursor: string | null = null
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const body = await api<{ items: PendingDelivery[]; next_cursor: string | null }>(
      `/v1/invoices/deliveries/pending?${params}`,
      { signal },
    )
    items.push(...body.items)
    cursor = body.next_cursor
    if (!cursor) break
  }
  return items
}

export function getDelivery(id: string, signal?: AbortSignal) {
  return api<DeliveryPackage>(`/v1/invoices/${id}/delivery`, { signal })
}

export function resendDelivery(id: string) {
  return api<{ invoice_id: string; attempt: number; status: string }>(`/v1/invoices/${id}/delivery/resend`, {
    method: 'POST',
    body: '{}',
  })
}

export function listAudit(table: string, rowId: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ table, limit: '100' })
  if (rowId) params.set('row_id', rowId)
  return api<{ items: AuditItem[]; next_cursor: string | null }>(`/v1/audit?${params}`, { signal })
}

export async function fetchInvoicePdf(id: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(`/api/v1/invoices/${id}/pdf`, {
      headers: { Accept: 'application/pdf' },
      signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'WC_NETWORK', copy.api.offline)
  }
  if (!response.ok) {
    let message = copy.api.generic
    let code = 'WC_ERROR'
    try {
      const body = (await response.json()) as { code?: string; message?: string }
      if (typeof body.message === 'string') message = body.message
      if (typeof body.code === 'string') code = body.code
    } catch {
      message = copy.api.generic
    }
    throw new ApiError(response.status, code, message)
  }
  return response.blob()
}
