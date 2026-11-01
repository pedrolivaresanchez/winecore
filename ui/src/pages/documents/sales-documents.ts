import { api } from '@/lib/api'
import type { DocSource } from '@/pages/documents/sources'

export type SalesDocKind = 'invoice' | 'quote' | 'delivery_note'
export type SalesDirection = 'sale' | 'purchase'
export type SalesOrigin = 'holded' | 'winecore'
export type SalesSort = 'date' | 'number' | 'customer' | 'total' | 'pending'
export type VerifactuState = 'pending' | 'accepted' | 'rejected'
export type DeliveryState = 'pending' | 'sent' | 'failed' | 'no_recipient' | 'none'

export type SalesDocumentItem = {
  id: string
  origin: SalesOrigin
  kind: SalesDocKind
  number: string | null
  issue_date: string | null
  due_date: string | null
  customer: { id: string | null; name: string; match: 'contact' | 'tax_id' | 'name' | null }
  entity_code: string
  total: string | null
  pending: string | null
  currency: string
  status: string
  status_label: string
  verifactu: VerifactuState | null
  delivery: DeliveryState | null
  api_path: string
}

export type SalesFacet = { value: string; label: string; count: number }

export type SalesDocumentPage = {
  kind: SalesDocKind
  direction: SalesDirection
  as_of: string
  entity: 'PO' | 'CVPO' | 'both'
  origins: SalesOrigin[]
  items: SalesDocumentItem[]
  total: number
  limit: number
  offset: number
  sort: SalesSort
  dir: 'asc' | 'desc'
  totals: { amount: string; pending: string }
  facets: { status: SalesFacet[]; entity: SalesFacet[]; origin: SalesFacet[] }
}

export const SALES_SORTS: readonly SalesSort[] = ['date', 'number', 'customer', 'total', 'pending']
export const VERIFACTU_STATES: readonly VerifactuState[] = ['pending', 'accepted', 'rejected']
export const DELIVERY_STATES: readonly DeliveryState[] = ['pending', 'sent', 'failed', 'no_recipient', 'none']

export function listSalesDocuments(query: URLSearchParams, signal?: AbortSignal) {
  return api<SalesDocumentPage>(`/v1/sales-documents?${query}`, { signal })
}

/** The modal that reads this row. WineCore expenses have none: they open their own review page. */
export function modalSourceOf(item: Pick<SalesDocumentItem, 'origin' | 'kind'>, direction: SalesDirection): DocSource | null {
  if (item.origin === 'holded') return item.kind === 'invoice' ? 'holded-invoice' : 'holded-document'
  if (item.kind === 'quote') return 'quote'
  if (item.kind === 'delivery_note') return 'delivery'
  return direction === 'sale' ? 'invoice' : null
}
