import type { RecordDoc } from '@/pages/documents/doc-key'
import type { BadgeTone } from '@/ui'

export type DocSource = 'winecore' | 'holded'
export type InvoiceState = 'draft' | 'pending' | 'overdue' | 'paid' | 'voided'

export type OverviewInvoice = {
  source: DocSource
  id: string
  number: string | null
  issue_date: string | null
  due_date: string | null
  total: string
  pending: string
  state: InvoiceState
  status: string
  entity_code: string
  linked_by: 'contact' | 'name'
}

export type OverviewReceivable = {
  source: DocSource
  id: string
  invoice_id: string | null
  number: string | null
  issue_date: string | null
  due_date: string | null
  outstanding: string
  is_overdue: boolean
  days_overdue: number
  entity_code: string
  linked_by: 'contact' | 'name'
}

export type OverviewPayment = {
  source: DocSource
  id: string
  date: string | null
  document_date: string | null
  amount: string
  method: string | null
  reference: string | null
  entity_code: string
  documents: string[]
}

export type OverviewSalesDoc = {
  source: DocSource
  id: string
  number: string | null
  date: string | null
  status: string
  total: string | null
}

export type ContactOverview = {
  contact_id: string
  as_of: string
  year: number
  invoices: {
    kpis: {
      invoiced_ytd: string
      invoiced_prior_ytd: string
      invoiced_last_year: string
      invoiced_total: string
      invoice_count: number
      average_ticket: string | null
      first_invoice_date: string | null
      last_invoice_date: string | null
    }
    months: { month: string; total: string }[]
    total_count: number
    items: OverviewInvoice[]
  } | null
  receivables: { total: string; overdue: string; count: number; items: OverviewReceivable[] } | null
  payments: { total: string; count: number; items: OverviewPayment[] } | null
  sales: { quotes: OverviewSalesDoc[]; orders: OverviewSalesDoc[]; delivery_notes: OverviewSalesDoc[] } | null
}

export function overviewPath(id: string): string {
  return `/v1/contacts/${id}/summary`
}

export function invoiceDoc(doc: { source: DocSource; id: string | null }): RecordDoc | null {
  if (!doc.id) return null
  return { source: doc.source === 'holded' ? 'holded-invoice' : 'invoice', id: doc.id }
}

/** Orders have no modal yet, so a WineCore order keeps its page and a Holded one has nowhere to go. */
export function salesDoc(kind: 'quote' | 'order' | 'delivery', doc: OverviewSalesDoc): RecordDoc | null {
  if (kind === 'order') return null
  if (doc.source === 'holded') return { source: 'holded-document', id: doc.id }
  return { source: kind, id: doc.id }
}

export function salesHref(kind: 'quote' | 'order' | 'delivery', doc: OverviewSalesDoc): string | null {
  if (kind !== 'order' || doc.source === 'holded') return null
  return `/ventas/pedidos/${doc.id}`
}

/** Holded payments only carry invoice numbers: the invoice list filtered by number is where they are read. */
export function paymentHref(number: string | null): string | null {
  return number ? `/facturas?q=${encodeURIComponent(number)}` : null
}

export const INVOICE_STATE: Record<InvoiceState, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  pending: { label: 'Pendiente', tone: 'info' },
  overdue: { label: 'Vencida', tone: 'danger' },
  paid: { label: 'Cobrada', tone: 'success' },
  voided: { label: 'Anulada', tone: 'neutral' },
}

const SALES_STATUS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  expired: 'Caducado',
  converted: 'Convertido',
  confirmed: 'Confirmado',
  partially_delivered: 'Entrega parcial',
  delivered: 'Entregado',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
  issued: 'Emitido',
  shipped: 'Enviado',
}

export function salesStatusLabel(status: string): string {
  return SALES_STATUS[status] ?? status
}

export const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export function monthLabel(key: string): string {
  const month = Number(key.slice(5, 7))
  return MONTHS[month - 1] ?? key
}

export function amount(value: string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
