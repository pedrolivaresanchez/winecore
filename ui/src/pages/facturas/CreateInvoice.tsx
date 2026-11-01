import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { useEntity } from '@/app/entity-context'
import { Combobox, type ComboOption } from '@/components/Combobox'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useMinWidth } from '@/hooks/use-media'
import { copy, fill } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { listDeliveries, listOrders, todayMadrid, formatAmount, type DeliveryNote, type SalesOrder } from '@/lib/sales'
import { useCustomers, useSalesOffer } from '@/lib/sales-catalog'
import type { Me } from '@/lib/types'
import { Button, Chip, DatePicker, Drawer, DrawerBody, DrawerHeader, InfoTip, Input, Select, useToast } from '@/ui'
import { createInvoice } from '@/pages/facturas/api'
import { DATE_LABELS, blankLine, day, entityLabel, linePayload } from '@/pages/facturas/format'
import { LineEditor } from '@/pages/facturas/lines'
import type { LineDraft, SourceKind } from '@/pages/facturas/types'

const SOURCES: { id: SourceKind; label: string }[] = [
  { id: 'lines', label: copy.facturas.sourceLines },
  { id: 'notes', label: copy.facturas.sourceNotes },
  { id: 'order', label: copy.facturas.sourceOrder },
]

export function CreateInvoice({ me }: { me: Me }) {
  const navigate = useNavigate()
  const toast = useToast()
  const desktop = useMinWidth(768)
  const { filter } = useEntity()
  useChromeTitle(copy.facturas.new)
  const [source, setSource] = useState<SourceKind>('lines')
  const [entityId, setEntityId] = useState(() => {
    if (filter === 'all') return me.entities[0]?.id ?? ''
    return me.entities.find((item) => item.code === filter)?.id ?? me.entities[0]?.id ?? ''
  })
  const [customerId, setCustomerId] = useState('')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState<'es' | 'en'>('es')
  const [noteIds, setNoteIds] = useState<string[]>([])
  const [orderId, setOrderId] = useState('')
  const [operationDate, setOperationDate] = useState<string | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)
  const [badLine, setBadLine] = useState<string | null>(null)
  const [customerBad, setCustomerBad] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState<DeliveryNote[] | null>(null)
  const [orders, setOrders] = useState<SalesOrder[] | null>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  const { customers } = useCustomers()
  const offer = useSalesOffer({ customerId: customerId || undefined, channel: 'horeca', date: todayMadrid() })

  const customerOptions = useMemo<ComboOption[]>(
    () => customers.map((item) => ({ value: item.id, label: item.name })),
    [customers],
  )
  const productOptions = useMemo<ComboOption[]>(
    () => offer.products.map((item) => ({ value: item.id, label: item.label })),
    [offer.products],
  )
  const customerNames = useMemo(() => new Map(customers.map((item) => [item.id, item.name])), [customers])
  const orderOptions = useMemo<ComboOption[]>(
    () =>
      (orders ?? []).map((order) => ({
        value: order.id,
        label: `${order.number ?? copy.facturas.draft} · ${customerNames.get(order.customer_id) ?? ''}`.replace(/ · $/, ''),
        hint: day(order.order_date),
      })),
    [customerNames, orders],
  )

  useEffect(() => {
    if (source !== 'notes' || notes) return
    const controller = new AbortController()
    listDeliveries({ invoiced: 'false', status: 'issued' }, controller.signal)
      .then((page) => setNotes(page.items))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setNotes([])
      })
    return () => controller.abort()
  }, [notes, source])

  useEffect(() => {
    if (source !== 'order' || orders) return
    const controller = new AbortController()
    listOrders({}, controller.signal)
      .then((page) => setOrders(page.items.filter((item) => item.status !== 'cancelled' && item.status !== 'draft')))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setOrders([])
      })
    return () => controller.abort()
  }, [orders, source])

  useEffect(() => {
    if (error) alertRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])

  if (!allows(me, 'billing.write')) return <NoPermission />

  function refuse(message: string, options: { customer?: boolean; line?: string | null } = {}) {
    setError(message)
    setCustomerBad(options.customer ?? false)
    setBadLine(options.line ?? null)
    if (options.customer) window.setTimeout(() => document.getElementById('cliente-factura')?.focus(), 0)
  }

  function clearRefusal() {
    setError(null)
    setBadLine(null)
    setCustomerBad(false)
  }

  function priceHint(line: LineDraft): string | null {
    if (!line.productId) return null
    const listed = offer.priceOf(line.productId)
    return listed ? fill(copy.sales.tariffPrice, { price: formatAmount(listed) }) : copy.sales.noTariff
  }

  function toggleNote(id: string) {
    clearRefusal()
    setNoteIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function submit() {
    clearRefusal()
    const used = lines.filter((line) => line.productId || line.unitPrice.trim() !== '')
    if (source === 'notes' && noteIds.length === 0) {
      refuse(copy.facturas.pickNotes)
      return
    }
    if (source === 'order' && !orderId) {
      refuse(copy.facturas.pickOrder)
      return
    }
    if (source === 'lines') {
      if (!entityId) {
        refuse(copy.facturas.pickEntity)
        return
      }
      if (!customerId) {
        refuse(copy.facturas.pickCustomer, { customer: true })
        return
      }
      const missing = used.find((line) => !line.productId) ?? (used.length === 0 ? lines[0] : undefined)
      if (missing) {
        refuse(used.length === 0 ? copy.sales.needLine : copy.facturas.pickProduct, { line: missing.key })
        return
      }
      const noQty = used.find((line) => !(Number(line.quantity.replace(',', '.')) > 0))
      if (noQty) {
        refuse(copy.sales.needQuantity, { line: noQty.key })
        return
      }
      const noPrice = used.find((line) => line.unitPrice.trim() === '' && !offer.priceOf(line.productId))
      if (noPrice) {
        refuse(copy.facturas.needPrice, { line: noPrice.key })
        return
      }
    }
    const body = {
      description: description.trim() || undefined,
      language,
      operation_date: operationDate,
      legal_entity_id: source === 'lines' ? entityId || undefined : undefined,
      customer_id: source === 'lines' ? customerId || undefined : undefined,
      from_delivery_notes: source === 'notes' ? noteIds : undefined,
      from_order: source === 'order' ? orderId : undefined,
      lines: source === 'lines' ? linePayload(used) : undefined,
    }
    setSaving(true)
    try {
      const created = await createInvoice(body)
      toast(copy.facturas.created)
      navigate(`/facturas/${created.id}`)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  const actions = (
    <div
      ref={alertRef}
      className="sticky bottom-0 z-10 grid gap-2 border-t border-border-subtle bg-surface py-3"
    >
      {error ? (
        <p role="alert" className="rounded-md border border-danger-500/30 bg-danger-50 px-3 py-2 text-label text-danger-700">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => navigate('/facturas')} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {copy.facturas.create}
        </Button>
      </div>
    </div>
  )

  const form = (
    <form
      className="grid gap-4"
      data-screen="facturas-nueva"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={copy.facturas.type}>
          {SOURCES.map((item) => (
            <Chip
              key={item.id}
              pressed={source === item.id}
              active={source === item.id}
              onClick={() => {
                setSource(item.id)
                clearRefusal()
              }}
            >
              {item.label}
            </Chip>
          ))}
        </div>
        <InfoTip label={copy.facturas.stockLabel}>{copy.facturas.stockTip}</InfoTip>
      </div>
      {source === 'lines' ? (
        <>
          <Field id="entidad-factura" label={copy.facturas.entity}>
            <Select id="entidad-factura" size="sm" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {me.entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entityLabel(entity.code)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cliente-factura" label={copy.facturas.customer}>
            <Combobox
              id="cliente-factura"
              size="sm"
              options={customerOptions}
              value={customerId}
              placeholder={copy.facturas.findCustomer}
              emptyText={copy.sales.noCustomers}
              invalid={customerBad}
              onChange={(next) => {
                setCustomerId(next)
                clearRefusal()
              }}
            />
          </Field>
        </>
      ) : null}
      <Field id="descripcion-nueva" label={copy.facturas.description}>
        <Input id="descripcion-nueva" size="sm" value={description} placeholder={copy.facturas.description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="idioma-nueva" label={copy.facturas.language}>
          <Select id="idioma-nueva" size="sm" value={language} onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'es')}>
            <option value="es">{copy.facturas.spanish}</option>
            <option value="en">{copy.facturas.english}</option>
          </Select>
        </Field>
        <Field id="operacion-nueva" label={copy.facturas.operationDate}>
          <DatePicker value={operationDate} labels={DATE_LABELS} onChange={setOperationDate} />
        </Field>
      </div>
      {source === 'notes' ? (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-label text-text-secondary">{copy.facturas.noteIds}</legend>
          {notes == null ? (
            <p className="text-label text-text-tertiary">{copy.loading}</p>
          ) : notes.length === 0 ? (
            <p className="text-label text-text-tertiary">{copy.facturas.noNotes}</p>
          ) : (
            <ul className="grid gap-1 rounded-2xl border border-border-subtle p-2">
              {notes.map((note) => (
                <li key={note.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-label text-ink-900 hover:bg-fill-hover">
                    <input
                      type="checkbox"
                      checked={noteIds.includes(note.id)}
                      onChange={() => toggleNote(note.id)}
                    />
                    <span className="font-medium">{note.number ?? copy.facturas.draft}</span>
                    <span className="min-w-0 flex-1 truncate text-text-secondary">
                      {note.customer_id ? customerNames.get(note.customer_id) ?? '' : ''}
                    </span>
                    <span className="text-caption text-text-tertiary">{day(note.issue_date)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}
      {source === 'order' ? (
        <Field id="pedido-factura" label={copy.facturas.orderId}>
          <Combobox
            id="pedido-factura"
            size="sm"
            options={orderOptions}
            value={orderId}
            placeholder={copy.facturas.orderId}
            emptyText={orders && orders.length === 0 ? copy.facturas.noOrders : copy.combobox.empty}
            onChange={(next) => {
              setOrderId(next)
              clearRefusal()
            }}
          />
        </Field>
      ) : null}
      {source === 'lines' ? (
        <div className="grid gap-3">
          <LineEditor
            lines={lines}
            showProduct
            products={productOptions}
            invalidKey={badLine}
            hint={priceHint}
            onChange={(next) => {
              setLines(next)
              clearRefusal()
            }}
          />
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setLines((current) => [...current, blankLine()])}>
              {copy.facturas.addLine}
            </Button>
          </div>
        </div>
      ) : null}
      {actions}
    </form>
  )

  if (!desktop) {
    return (
      <Drawer open onClose={() => navigate('/facturas')} labelledBy="nueva-factura" size="lg">
        <DrawerHeader titleId="nueva-factura" title={copy.facturas.new} onClose={() => navigate('/facturas')} />
        <DrawerBody>{form}</DrawerBody>
      </Drawer>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6 md:px-8">
        <header className="flex items-center gap-2">
          <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.facturas.new}</h1>
        </header>
        {form}
      </div>
    </div>
  )
}
