import { useCallback, useEffect, useState } from 'react'
import { copy } from '@/i18n'
import { ApiError, api, isAbortError } from '@/lib/api'
import { deliveryStatusLabel, docPath, lineBase, quoteStatusLabel, statusTone as salesTone, type DeliveryNote, type Quote } from '@/lib/sales'
import type { Me } from '@/lib/types'
import { day, entityLabel, hasAmount, invoiceTitle, money, qty, statusLabel, statusTone as invoiceTone } from '@/pages/facturas/format'
import { linesOf, moneySum } from '@/pages/facturas/holded-detail'
import type { Invoice } from '@/pages/facturas/types'
import type { BadgeTone } from '@/ui'

export type DocSource = 'holded-invoice' | 'holded-document' | 'invoice' | 'quote' | 'delivery'

type HoldedInvoiceDetail = {
  id: string
  number: string
  issue_date: string
  due_date: string | null
  counterparty_name: string
  counterparty_contact_id: string | null
  subtotal: string
  vat: string
  withholding: string | null
  total: string
  paid: string | null
  pending: string | null
  status_holded: string
  kind: string
  entity_code: string
}

type HoldedDocumentDetail = Omit<HoldedInvoiceDetail, 'paid' | 'pending' | 'kind'> & {
  kind: 'quote' | 'delivery_note'
}

export type DocRecord =
  | { source: 'holded-invoice'; data: HoldedInvoiceDetail }
  | { source: 'holded-document'; data: HoldedDocumentDetail }
  | { source: 'invoice'; data: Invoice }
  | { source: 'quote'; data: Quote }
  | { source: 'delivery'; data: DeliveryNote }

export type DocLine = { key: string; description: string; quantity: string; price: string; base: string }

export type DocView = {
  title: string
  kind: string
  holded: boolean
  entity: string
  status: { label: string; tone: BadgeTone } | null
  party: { label: string; name: string; contactId: string | null } | null
  dates: { label: string; value: string }[]
  totals: { label: string; value: string; strong?: boolean }[]
  lines: DocLine[]
  pdfPath: string | null
  pdfNote?: string
  pdfName: string
  /** The full page, where there is one. */
  record: string | null
}

const BASE: Record<DocSource, string> = {
  'holded-invoice': '/v1/legacy/invoices',
  'holded-document': '/v1/legacy/documents',
  invoice: '/v1/invoices',
  quote: '/v1/quotes',
  delivery: '/v1/delivery-notes',
}

function pathOf(source: DocSource, id: string): string {
  return `${BASE[source]}/${encodeURIComponent(id)}`
}

/** Every PDF but a WineCore invoice's exists in any state, so it can load beside the record. */
export function earlyPdfPath(source: DocSource, id: string): string | null {
  return source === 'invoice' ? null : `${pathOf(source, id)}/pdf`
}

type Loaded = { doc: string; key: string; record: DocRecord | null; error: ApiError | null }

/** Keeps the record on screen while it reloads after an action; only another document blanks it. */
export function useDocument(source: DocSource, id: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const doc = id ? `${source}\0${id}` : ''
  const key = `${doc}\0${attempt}`

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    let active = true
    api<unknown>(pathOf(source, id), { signal: controller.signal })
      .then((data) => {
        if (!active) return
        setLoaded({ doc, key, record: { source, data } as DocRecord, error: null })
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        const error = err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.documents.loadFailed)
        setLoaded({ doc, key, record: null, error })
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [doc, id, key, source])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const same = loaded != null && loaded.doc === doc
  const fresh = same && loaded.key === key
  return {
    record: same ? loaded.record : null,
    error: fresh ? loaded.error : null,
    loading: !fresh,
    reload,
  }
}

function holdedTone(status: string): BadgeTone {
  const key = status.trim().toLowerCase()
  if (key === 'pagado' || key === 'cobrado' || key === 'facturado' || key === 'aceptado') return 'success'
  if (key === 'vencido') return 'danger'
  if (key === 'pendiente') return 'warning'
  return 'neutral'
}

function negate(value: string | null): string | null {
  if (!value) return null
  return value.startsWith('-') ? value.slice(1) : `-${value}`
}

function entityOf(me: Me, legalEntityId: string | null): string {
  return entityLabel(me.entities.find((item) => item.id === legalEntityId)?.code)
}

function holdedLines(data: unknown): DocLine[] {
  return linesOf(data).map((line, index) => ({
    key: `${line.line_no}-${index}`,
    description: line.description || line.sku || '—',
    quantity: qty(line.quantity),
    price: money(line.unit_price),
    base: money(line.line_base),
  }))
}

function holdedTotals(data: HoldedDocumentDetail | HoldedInvoiceDetail) {
  const totals: DocView['totals'] = [
    { label: copy.documents.base, value: money(data.subtotal) },
    { label: copy.documents.tax, value: money(data.vat) },
  ]
  if (hasAmount(data.withholding)) totals.push({ label: copy.documents.withholding, value: money(data.withholding) })
  totals.push({ label: copy.documents.total, value: money(data.total), strong: true })
  return totals
}

function holdedInvoiceView(data: HoldedInvoiceDetail): DocView {
  const purchase = data.kind === 'purchase'
  const rectifying = !purchase && (/^CN/i.test(data.number) || Number(data.total) < 0)
  const totals = holdedTotals(data)
  if (data.paid != null) totals.push({ label: purchase ? copy.documents.paidOut : copy.documents.collected, value: money(data.paid) })
  if (data.pending != null) totals.push({ label: copy.documents.pending, value: money(data.pending) })
  return {
    title: data.number,
    kind: purchase ? copy.documents.kinds.purchase : rectifying ? copy.documents.kinds.rectifying : copy.documents.kinds.invoice,
    holded: true,
    entity: entityLabel(data.entity_code),
    status: data.status_holded ? { label: data.status_holded, tone: holdedTone(data.status_holded) } : null,
    party: {
      label: purchase ? copy.documents.supplier : copy.documents.customer,
      name: data.counterparty_name || '—',
      contactId: data.counterparty_contact_id,
    },
    dates: [
      { label: copy.documents.issueDate, value: day(data.issue_date) },
      ...(data.due_date ? [{ label: copy.documents.dueDate, value: day(data.due_date) }] : []),
    ],
    totals,
    lines: holdedLines(data),
    pdfPath: earlyPdfPath('holded-invoice', data.id),
    pdfName: 'factura.pdf',
    record: null,
  }
}

function holdedDocumentView(data: HoldedDocumentDetail): DocView {
  const quote = data.kind === 'quote'
  return {
    title: data.number,
    kind: quote ? copy.documents.kinds.quote : copy.documents.kinds.delivery,
    holded: true,
    entity: entityLabel(data.entity_code),
    status: data.status_holded ? { label: data.status_holded, tone: holdedTone(data.status_holded) } : null,
    party: { label: copy.documents.customer, name: data.counterparty_name || '—', contactId: data.counterparty_contact_id },
    dates: [
      { label: copy.documents.issueDate, value: day(data.issue_date) },
      ...(quote && data.due_date ? [{ label: copy.documents.validUntil, value: day(data.due_date) }] : []),
    ],
    totals: holdedTotals(data),
    lines: holdedLines(data),
    pdfPath: earlyPdfPath('holded-document', data.id),
    pdfName: quote ? 'presupuesto.pdf' : 'albaran.pdf',
    record: null,
  }
}

function invoiceView(data: Invoice): DocView {
  const issued = data.status === 'issued' || data.status === 'voided'
  const totals: DocView['totals'] = [
    { label: copy.documents.base, value: money(data.subtotal) },
    { label: copy.documents.tax, value: money(data.tax_total) },
  ]
  if (hasAmount(data.surcharge_total)) totals.push({ label: copy.documents.surcharge, value: money(data.surcharge_total) })
  if (hasAmount(data.withholding_total)) totals.push({ label: copy.documents.withholding, value: money(data.withholding_total) })
  totals.push({ label: copy.documents.total, value: money(data.total), strong: true })
  if (data.status === 'issued') {
    totals.push({ label: copy.documents.collected, value: money(data.amount_paid ?? '0') })
    totals.push({ label: copy.documents.pending, value: moneySum([data.total, negate(data.amount_paid)]) })
  }
  const due = data.dues[0]?.due_date
  return {
    title: invoiceTitle(data.status, data.number),
    kind: data.rectification_kind ? copy.documents.kinds.rectifying : copy.documents.kinds.invoice,
    holded: false,
    entity: entityLabel(data.entity_code),
    status: { label: statusLabel(data.status), tone: invoiceTone(data.status) },
    party: { label: copy.documents.customer, name: data.customer_name || '—', contactId: data.customer_id },
    dates: [
      { label: copy.documents.issueDate, value: day(data.issue_date) },
      ...(due ? [{ label: copy.documents.dueDate, value: day(due) }] : []),
    ],
    totals,
    lines: data.lines.map((line) => ({
      key: line.id,
      description: line.description || line.sku || '—',
      quantity: qty(line.quantity),
      price: money(line.unit_price),
      base: money(line.line_base),
    })),
    pdfPath: issued ? `${pathOf('invoice', data.id)}/pdf` : null,
    pdfNote: copy.facturas.noPdf,
    pdfName: data.number ? `${data.number}.pdf` : 'factura.pdf',
    record: `/facturas/${data.id}`,
  }
}

function quoteView(data: Quote, me: Me, partyName: string | null): DocView {
  return {
    title: data.number ?? copy.sales.draft,
    kind: data.is_proforma ? copy.documents.kinds.proforma : copy.documents.kinds.quote,
    holded: false,
    entity: entityOf(me, data.legal_entity_id),
    status: { label: quoteStatusLabel(data.status), tone: salesTone(data.status) },
    party: { label: copy.documents.customer, name: partyName ?? '—', contactId: data.customer_id },
    dates: [
      { label: copy.documents.issueDate, value: day(data.issue_date) },
      { label: copy.documents.validUntil, value: day(data.valid_until) },
    ],
    totals: [
      { label: copy.documents.base, value: money(data.subtotal) },
      { label: copy.documents.tax, value: money(data.tax_total) },
      { label: copy.documents.total, value: money(data.total), strong: true },
    ],
    lines: data.lines.map((line) => ({
      key: line.id,
      description: line.description || '—',
      quantity: qty(line.quantity),
      price: money(line.unit_price),
      base: money(lineBase(line.quantity, line.unit_price, line.discount_pct)),
    })),
    pdfPath: earlyPdfPath('quote', data.id),
    pdfName: data.number ? `presupuesto-${data.number}.pdf` : 'presupuesto.pdf',
    record: `${docPath('quote')}/${data.id}`,
  }
}

function deliveryView(data: DeliveryNote, me: Me, partyName: string | null): DocView {
  const valued = data.lines.some((line) => line.unit_price != null && line.unit_price !== '')
  return {
    title: data.number ?? copy.sales.draft,
    kind: copy.documents.kinds.delivery,
    holded: false,
    entity: entityOf(me, data.legal_entity_id),
    status: { label: deliveryStatusLabel(data.status), tone: salesTone(data.status) },
    party: data.customer_id ? { label: copy.documents.customer, name: partyName ?? '—', contactId: data.customer_id } : null,
    dates: [{ label: copy.documents.issueDate, value: day(data.issue_date) }],
    totals: [],
    lines: data.lines.map((line) => ({
      key: line.id,
      description: line.description || '—',
      quantity: qty(line.quantity),
      price: valued ? money(line.unit_price) : '',
      base: valued ? money(lineBase(line.quantity, line.unit_price, line.discount_pct)) : '',
    })),
    pdfPath: earlyPdfPath('delivery', data.id),
    pdfName: data.number ? `albaran-${data.number}.pdf` : 'albaran.pdf',
    record: `${docPath('delivery')}/${data.id}`,
  }
}

/** The contact a WineCore quote or delivery note points at; the record carries only its id. */
export function partyIdOf(record: DocRecord | null): string | null {
  if (record?.source === 'quote') return record.data.customer_id
  if (record?.source === 'delivery') return record.data.customer_id
  return null
}

export function viewOf(record: DocRecord, me: Me, partyName: string | null): DocView {
  switch (record.source) {
    case 'holded-invoice':
      return holdedInvoiceView(record.data)
    case 'holded-document':
      return holdedDocumentView(record.data)
    case 'invoice':
      return invoiceView(record.data)
    case 'quote':
      return quoteView(record.data, me, partyName)
    case 'delivery':
      return deliveryView(record.data, me, partyName)
  }
}
