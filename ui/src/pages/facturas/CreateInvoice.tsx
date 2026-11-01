import { useEffect, useRef, useState } from 'react'
import { Field } from '@/components/Field'
import { copy, fill } from '@/i18n'
import { isAbortError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useSalesOffer, type TaxRate } from '@/lib/sales-catalog'
import { blankLine, shortPrice, type DraftLine } from '@/lib/sales-draft'
import {
  deliveryStatusLabel,
  errorText,
  formatAmount,
  formatIsoDate,
  getPriceQuote,
  lineBase,
  listDeliveries,
  listOrders,
  orderStatusLabel,
  todayMadrid,
  type DeliveryNote,
  type SalesOrder,
} from '@/lib/sales'
import {
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  InfoTip,
  Input,
  SegmentedControl,
  Select,
  useToast,
} from '@/ui'
import { createInvoice } from '@/pages/facturas/api'
import { DATE_LABELS, money } from '@/pages/facturas/format'
import type { CreateInvoiceBody, SourceKind } from '@/pages/facturas/types'
import { CustomerPicker, type CustomerOption } from '@/pages/ventas/CustomerPicker'
import { useIssuer } from '@/pages/ventas/issuer'
import { LineEditor } from '@/pages/ventas/lines'

const SOURCES: { value: SourceKind; content: string }[] = [
  { value: 'lines', content: copy.facturas.sourceLines },
  { value: 'order', content: copy.facturas.sourceOrder },
  { value: 'notes', content: copy.facturas.sourceNotes },
]

const SOURCE_HINTS: Record<SourceKind, string> = {
  lines: copy.facturas.sourceLinesHint,
  order: copy.facturas.sourceOrderHint,
  notes: copy.facturas.sourceNotesHint,
}

/** The catalog falls back to the channel list when the customer has none; `direct` is the `final` list the API invoices at. */
const PRICE_CHANNEL = 'direct'

type Totals = { base: number; tax: number; surcharge: number; total: number }
type Priced = { quantity: string; price: string | null; discount: string | null; tax: string | null }

export function CreateInvoice({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const [source, setSource] = useState<SourceKind>('lines')
  const [customer, setCustomer] = useState<CustomerOption | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [orderId, setOrderId] = useState('')
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState<'es' | 'en'>('es')
  const [operationDate, setOperationDate] = useState<string | null>(null)
  const [customerError, setCustomerError] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const stamps = useRef<Record<string, string>>({})
  const customerId = customer?.id ?? ''
  const issuer = useIssuer(customerId, '')
  const offer = useSalesOffer({ customerId: customerId || undefined, channel: PRICE_CHANNEL, date: todayMadrid() })
  const docs = useCustomerDocs(customerId, source)
  const { priceOf, taxOf, rateOf } = offer

  useEffect(() => {
    setLines((current) =>
      current.map((line) => {
        if (!line.productId) return line
        const listed = priceOf(line.productId)
        return {
          ...line,
          quoted: listed,
          unitPrice: line.touched ? line.unitPrice : shortPrice(listed),
          taxCode: line.taxCode || taxOf(line.productId) || '',
        }
      }),
    )
  }, [priceOf, taxOf])

  const orders = docs.orders.filter((order) => order.legal_entity_id === issuer.entityId)
  const notes = docs.notes.filter((note) => note.legal_entity_id === issuer.entityId)
  const stray = source === 'order' ? docs.orders.filter((order) => order.legal_entity_id !== issuer.entityId) : source === 'notes' ? docs.notes.filter((note) => note.legal_entity_id !== issuer.entityId) : []
  const strayEntity = stray[0]?.legal_entity_id ?? null
  const pickedOrder = orders.find((order) => order.id === orderId) ?? null
  const pickedNotes = notes.filter((note) => noteIds.includes(note.id))

  const totals: Totals =
    source === 'lines'
      ? totalsOf(lines.map((line) => ({ quantity: line.quantity, price: line.unitPrice, discount: line.discount, tax: line.taxCode })), rateOf)
      : source === 'order'
        ? pickedOrder
          ? { base: Number(pickedOrder.subtotal), tax: Number(pickedOrder.tax_total), surcharge: 0, total: Number(pickedOrder.total) }
          : { base: 0, tax: 0, surcharge: 0, total: 0 }
        : totalsOf(
            pickedNotes.flatMap((note) =>
              note.lines.map((line) => ({ quantity: line.quantity, price: line.unit_price, discount: line.discount_pct, tax: line.tax_code })),
            ),
            rateOf,
          )

  let entityNote = ''
  if (source === 'lines' && issuer.preview) {
    entityNote = issuer.preview.entity_id === issuer.entityId ? issuer.preview.label : fill(copy.facturas.ruleSuggests, { entity: issuer.labelOf(issuer.preview.entity_id) })
  }

  function clearErrors() {
    setSourceError(null)
    setError(null)
  }

  function pickCustomer(next: CustomerOption | null) {
    setCustomer(next)
    setOrderId('')
    setNoteIds([])
    setCustomerError(null)
    clearErrors()
  }

  function applyListed(line: DraftLine) {
    const listed = priceOf(line.productId)
    const tax = taxOf(line.productId)
    setLines((current) =>
      current.map((item) =>
        item.key === line.key
          ? {
              ...item,
              quoted: listed,
              unitPrice: item.touched ? item.unitPrice : shortPrice(listed),
              taxCode: item.taxCode || tax || '',
            }
          : item,
      ),
    )
  }

  function reprice(line: DraftLine) {
    applyListed(line)
    if (!customerId || !line.productId || !(Number(line.quantity) > 0)) return
    const stamp = crypto.randomUUID()
    stamps.current[line.key] = stamp
    getPriceQuote({ customerId, productId: line.productId, qty: line.quantity, date: todayMadrid() })
      .then((hit) => {
        if (stamps.current[line.key] !== stamp) return
        setLines((current) =>
          current.map((item) =>
            item.key === line.key ? { ...item, quoted: hit.unit_price, unitPrice: item.touched ? item.unitPrice : shortPrice(hit.unit_price) } : item,
          ),
        )
      })
      .catch(() => undefined)
  }

  async function submit() {
    setError(null)
    if (!customer) {
      setCustomerError(copy.sales.pickCustomer)
      return
    }
    const body: CreateInvoiceBody = {
      description: description.trim() || undefined,
      language,
      operation_date: operationDate,
    }
    if (source === 'lines') {
      const problem = lineProblem(lines)
      if (problem) {
        setSourceError(problem)
        return
      }
      body.legal_entity_id = issuer.entityId
      body.customer_id = customer.id
      body.lines = lines.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity.trim(),
        unit_price: line.unitPrice.trim(),
        discount_pct: line.discount.trim() || '0',
        tax_code: line.taxCode,
        lot_id: line.lotId || undefined,
        lot_code: line.lotId ? undefined : line.lotCode.trim() || undefined,
      }))
    } else if (source === 'order') {
      if (!pickedOrder) {
        setSourceError(copy.facturas.pickOrder)
        return
      }
      body.from_order = pickedOrder.id
    } else {
      if (pickedNotes.length === 0) {
        setSourceError(copy.facturas.pickNotes)
        return
      }
      body.from_delivery_notes = pickedNotes.map((note) => note.id)
    }
    setSaving(true)
    try {
      const created = await createInvoice(body)
      toast(copy.facturas.created)
      onCreated(created.id)
    } catch (err: unknown) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="factura-nueva" size="xl">
      <DialogHeader titleId="factura-nueva" title={copy.facturas.new} description={copy.facturas.newHint} onClose={onClose} />
      <DialogBody>
        <form
          id="factura-nueva-form"
          data-screen="facturas-nueva"
          className="grid gap-5 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field id="cliente-factura" label={copy.facturas.customer} error={customerError ?? undefined}>
              <CustomerPicker id="cliente-factura" value={customer} invalid={Boolean(customerError)} onChange={pickCustomer} />
            </Field>
            <div className="grid content-start gap-1.5">
              <span className="text-label text-text-secondary">{copy.facturas.entity}</span>
              <SegmentedControl
                aria-label={copy.facturas.entity}
                value={issuer.entityId}
                options={issuer.options}
                onChange={(next) => {
                  issuer.choose(next)
                  clearErrors()
                }}
              />
              {entityNote ? <p className="max-w-64 text-caption text-text-tertiary">{entityNote}</p> : null}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                aria-label={copy.facturas.source}
                value={source}
                options={SOURCES}
                onChange={(next) => {
                  setSource(next)
                  clearErrors()
                }}
              />
              <InfoTip label={copy.facturas.stockLabel}>{copy.facturas.stockTip}</InfoTip>
            </div>
            <p className="text-caption text-text-tertiary">{SOURCE_HINTS[source]}</p>
          </div>

          {source === 'lines' ? (
            <>
              {offer.error && offer.products.length === 0 ? (
                <p role="alert" className="text-label text-danger-700">{errorText(offer.error)}</p>
              ) : null}
              <LineEditor
                lines={lines}
                products={offer.products}
                lots={offer.lots}
                locations={offer.locations}
                showLot
                freeLot
                askReason={false}
                onChange={(next) => {
                  setLines(next)
                  clearErrors()
                }}
                onPrice={reprice}
              />
            </>
          ) : !customer ? (
            <p className="text-label text-text-tertiary">{copy.facturas.customerFirst}</p>
          ) : docs.loading ? (
            <p className="text-label text-text-tertiary">{copy.facturas.loadingSource}</p>
          ) : docs.error ? (
            <p role="alert" className="text-label text-danger-700">{docs.error}</p>
          ) : source === 'order' ? (
            orders.length === 0 ? (
              <p className="text-label text-text-tertiary">{fill(copy.facturas.noOrders, { entity: issuer.label })}</p>
            ) : (
              <div role="radiogroup" aria-label={copy.facturas.sourceOrder} className="grid gap-2">
                {orders.map((order) => (
                  <OrderOption
                    key={order.id}
                    order={order}
                    checked={order.id === pickedOrder?.id}
                    onPick={() => {
                      setOrderId(order.id)
                      clearErrors()
                    }}
                  />
                ))}
              </div>
            )
          ) : notes.length === 0 ? (
            <p className="text-label text-text-tertiary">{fill(copy.facturas.noNotes, { entity: issuer.label })}</p>
          ) : (
            <ul aria-label={copy.facturas.sourceNotes} className="grid gap-2">
              {notes.map((note) => (
                <NoteOption
                  key={note.id}
                  note={note}
                  checked={noteIds.includes(note.id)}
                  onToggle={(checked) => {
                    setNoteIds((current) => (checked ? [...current, note.id] : current.filter((id) => id !== note.id)))
                    clearErrors()
                  }}
                />
              ))}
            </ul>
          )}
          {strayEntity && !docs.loading ? (
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={() => issuer.choose(strayEntity)}>
                {fill(copy.facturas.elsewhere, { n: String(stray.length), entity: issuer.labelOf(strayEntity) })}
              </Button>
            </div>
          ) : null}
          {sourceError ? (
            <p role="alert" className="text-label text-danger-700">
              {sourceError}
            </p>
          ) : null}

          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Field id="descripcion-nueva" label={copy.facturas.description}>
              <Input id="descripcion-nueva" size="sm" value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field id="idioma-nueva" label={copy.facturas.language}>
              <Select id="idioma-nueva" size="sm" className="w-full" value={language} onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'es')}>
                <option value="es">{copy.facturas.spanish}</option>
                <option value="en">{copy.facturas.english}</option>
              </Select>
            </Field>
            <Field id="operacion-nueva" label={copy.facturas.operationDate}>
              <DatePicker size="sm" value={operationDate} labels={DATE_LABELS} onChange={setOperationDate} />
            </Field>
          </div>

          <div className="grid justify-items-end gap-1">
            <dl aria-live="polite" className="grid min-w-56 grid-cols-[1fr_auto] gap-x-8 gap-y-1 text-label">
              <dt className="text-text-secondary">{copy.facturas.base}</dt>
              <dd className="text-right text-ink-900 tabular-nums">{money(totals.base)}</dd>
              <dt className="text-text-secondary">{copy.facturas.tax}</dt>
              <dd className="text-right text-ink-900 tabular-nums">{money(totals.tax)}</dd>
              {totals.surcharge ? (
                <>
                  <dt className="text-text-secondary">{copy.facturas.surcharge}</dt>
                  <dd className="text-right text-ink-900 tabular-nums">{money(totals.surcharge)}</dd>
                </>
              ) : null}
              <dt className="border-t border-border-subtle pt-1 font-medium text-ink-900">{copy.facturas.total}</dt>
              <dd className="border-t border-border-subtle pt-1 text-right font-medium text-ink-900 tabular-nums">{money(totals.total)}</dd>
            </dl>
            <p className="text-caption text-text-tertiary">{copy.facturas.estimate}</p>
          </div>

          {error ? (
            <p role="alert" className="text-label text-danger-700">
              {error}
            </p>
          ) : null}
        </form>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.facturas.cancel}
        </Button>
        <Button type="submit" form="factura-nueva-form" variant="primary" size="sm" loading={saving}>
          {copy.facturas.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

function OrderOption({ order, checked, onPick }: { order: SalesOrder; checked: boolean; onPick: () => void }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 has-focus-visible:shadow-(--shadow-focus)',
        checked ? 'border-ink-900 bg-fill-hover' : 'border-border-subtle hover:bg-fill-hover',
      )}
    >
      <input type="radio" name="pedido-factura" className="size-4 shrink-0 accent-ink-900" checked={checked} onChange={onPick} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-label font-medium text-ink-900">{order.number ?? copy.sales.draft}</span>
        <span className="truncate text-caption text-text-tertiary">
          {[formatIsoDate(order.order_date), orderStatusLabel(order.status), fill(copy.facturas.lineCount, { n: String(order.lines.length) })].join(' · ')}
        </span>
      </span>
      <span className="shrink-0 text-label text-ink-900 tabular-nums">{formatAmount(order.total)}</span>
    </label>
  )
}

function NoteOption({ note, checked, onToggle }: { note: DeliveryNote; checked: boolean; onToggle: (checked: boolean) => void }) {
  const base = note.lines.reduce((sum, line) => sum + (lineBase(line.quantity, line.unit_price, line.discount_pct) ?? 0), 0)
  const detail = [
    formatIsoDate(note.issue_date),
    deliveryStatusLabel(note.status),
    fill(copy.facturas.lineCount, { n: String(note.lines.length) }),
    note.is_valued ? `${copy.facturas.base} ${money(base)}` : '',
  ]
  return (
    <li className={cn('rounded-xl border px-3 py-2.5', checked ? 'border-ink-900 bg-fill-hover' : 'border-border-subtle')}>
      <Checkbox
        checked={checked}
        onChange={onToggle}
        label={note.number ?? copy.sales.draft}
        description={detail.filter(Boolean).join(' · ')}
        className="w-full"
      />
    </li>
  )
}

function useCustomerDocs(customerId: string, source: SourceKind) {
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [notes, setNotes] = useState<DeliveryNote[]>([])
  const [loaded, setLoaded] = useState('')
  const [error, setError] = useState<string | null>(null)
  const key = customerId && source !== 'lines' ? `${source}:${customerId}` : ''

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const done = () => {
      setError(null)
      setLoaded(key)
    }
    const fail = (err: unknown) => {
      if (isAbortError(err)) return
      setError(errorText(err))
      setLoaded(key)
    }
    if (source === 'order') {
      listOrders({ customer: customerId }, controller.signal)
        .then((page) => {
          setOrders(page.items.filter(invoiceableOrder))
          done()
        })
        .catch(fail)
    } else {
      listDeliveries({ customer: customerId, invoiced: 'false' }, controller.signal)
        .then((page) => {
          setNotes(page.items.filter(invoiceableNote))
          done()
        })
        .catch(fail)
    }
    return () => controller.abort()
  }, [customerId, key, source])

  return { orders, notes, loading: Boolean(key) && loaded !== key, error }
}

function invoiceableOrder(order: SalesOrder): boolean {
  return ['confirmed', 'partially_delivered', 'delivered', 'closed'].includes(order.status) && order.invoicing_status === 'not_invoiced'
}

function invoiceableNote(note: DeliveryNote): boolean {
  return (
    ['issued', 'shipped', 'delivered'].includes(note.status)
    && ['sale', 'consignment', 'sample'].includes(note.kind)
    && note.invoicing_status === 'not_invoiced'
  )
}

function lineProblem(lines: DraftLine[]): string | null {
  for (const [index, line] of lines.entries()) {
    const n = String(index + 1)
    if (!line.productId) return fill(copy.facturas.lineProduct, { n })
    if (!(Number(line.quantity) > 0)) return fill(copy.facturas.lineQuantity, { n })
    if (line.unitPrice.trim() === '' || !Number.isFinite(Number(line.unitPrice))) return fill(copy.facturas.linePrice, { n })
    if (!line.taxCode) return fill(copy.facturas.lineTax, { n })
  }
  return null
}

function totalsOf(rows: Priced[], rateOf: (code: string) => TaxRate | null): Totals {
  let base = 0
  let tax = 0
  let surcharge = 0
  for (const row of rows) {
    const amount = lineBase(row.quantity, row.price, row.discount)
    if (amount == null) continue
    const rate = row.tax ? rateOf(row.tax) : null
    base += amount
    tax += rate ? Math.round(amount * rate.rate) / 100 : 0
    surcharge += rate ? Math.round(amount * rate.surcharge) / 100 : 0
  }
  return { base, tax, surcharge, total: base + tax + surcharge }
}
