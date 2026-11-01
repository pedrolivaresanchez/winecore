import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Combobox, type ComboOption } from '@/components/Combobox'
import { Field } from '@/components/Field'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { COUNTRIES } from '@/lib/contacts'
import { useSalesOffer, type CatalogCustomer, type CatalogLocation, type CatalogLot } from '@/lib/sales-catalog'
import { blankLine, commercialLines, type DraftLine } from '@/lib/sales-draft'
import {
  CHANNELS,
  INCOTERMS,
  channelLabel,
  createDelivery,
  createOrder,
  createQuote,
  errorText,
  kindLabel,
  resolveIssuing,
  todayMadrid,
  getPriceQuote,
  type ChannelCode,
  type DeliveryKind,
  type IssuingPreview,
  type SalesOrder,
} from '@/lib/sales'
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
} from '@/ui'
import { LineEditor } from '@/pages/ventas/lines'

const DATE_LABELS = { clear: 'Quitar', today: 'Hoy' }

export function CreateDocument({
  doc,
  customers,
  onClose,
  onCreated,
}: {
  doc: 'quote' | 'order'
  customers: CatalogCustomer[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [channel, setChannel] = useState<ChannelCode>('horeca')
  const [language, setLanguage] = useState('es')
  const [proforma, setProforma] = useState(false)
  const [incoterm, setIncoterm] = useState('')
  const [validUntil, setValidUntil] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [orderDate, setOrderDate] = useState(todayMadrid())
  const [requested, setRequested] = useState<string | null>(null)
  const [department, setDepartment] = useState('')
  const [costCenter, setCostCenter] = useState('')
  const [ship, setShip] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [preview, setPreview] = useState<IssuingPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [badLine, setBadLine] = useState<string | null>(null)
  const [customerBad, setCustomerBad] = useState(false)
  const [saving, setSaving] = useState(false)
  const stamps = useRef<Record<string, string>>({})
  const offerDate = doc === 'order' ? orderDate : todayMadrid()
  const offer = useSalesOffer({ customerId: customerId || undefined, channel, date: offerDate })

  const customerOptions = useMemo<ComboOption[]>(
    () => customers.map((item) => ({ value: item.id, label: item.name, hint: item.country === 'ES' ? undefined : item.country })),
    [customers],
  )

  useEffect(() => {
    if (!customerId || !channel) {
      setPreview(null)
      return
    }
    const controller = new AbortController()
    resolveIssuing(customerId, channel, controller.signal)
      .then(setPreview)
      .catch(() => {
        if (!controller.signal.aborted) setPreview(null)
      })
    return () => controller.abort()
  }, [channel, customerId])

  function applyListed(line: DraftLine) {
    const listed = offer.priceOf(line.productId)
    if (!listed) return
    setLines((current) =>
      current.map((item) =>
        item.key === line.key ? { ...item, quoted: listed, unitPrice: item.touched ? item.unitPrice : listed } : item,
      ),
    )
  }

  function reprice(line: DraftLine, nextCustomer = customerId, date = orderDate) {
    applyListed(line)
    if (!nextCustomer || !line.productId || !(Number(line.quantity) > 0)) return
    const stamp = crypto.randomUUID()
    stamps.current[line.key] = stamp
    getPriceQuote({ customerId: nextCustomer, productId: line.productId, qty: line.quantity, date: date || undefined })
      .then((hit) => {
        if (stamps.current[line.key] !== stamp) return
        setLines((current) =>
          current.map((item) =>
            item.key === line.key
              ? { ...item, quoted: hit.unit_price, unitPrice: item.touched ? item.unitPrice : hit.unit_price }
              : item,
          ),
        )
      })
      .catch((err: unknown) => {
        if (stamps.current[line.key] !== stamp) return
        if (err instanceof ApiError && (err.status === 404 || err.status === 422)) {
          setLines((current) => current.map((item) => (item.key === line.key ? { ...item, quoted: null } : item)))
          return
        }
        setError(errorText(err))
      })
  }

  function changeLines(next: DraftLine[]) {
    setLines(next)
    setError(null)
    setBadLine(null)
  }

  function pickCustomer(next: string) {
    setCustomerId(next)
    setCustomerBad(false)
    setError(null)
    if (next) lines.forEach((line) => reprice(line, next))
  }

  function refuse(message: string, customer = false, line: string | null = null) {
    setError(message)
    setCustomerBad(customer)
    setBadLine(line)
    window.setTimeout(() => {
      const target = customer
        ? document.getElementById('cliente')
        : document.querySelector<HTMLElement>('[data-line-invalid="true"]')
      target?.scrollIntoView?.({ block: 'center' })
      if (customer) target?.focus()
    }, 0)
  }

  async function submit() {
    setError(null)
    setBadLine(null)
    setCustomerBad(false)
    if (!customerId) {
      refuse(copy.sales.pickCustomer, true)
      return
    }
    if (doc === 'order' && channel === 'eci_edi' && (!department.trim() || !costCenter.trim())) {
      refuse(copy.sales.needDepartment)
      return
    }
    if (doc === 'order' && ship && ship !== 'ES' && !incoterm) {
      refuse(copy.sales.needIncoterm)
      return
    }
    const built = commercialLines(lines)
    if (built.error) {
      refuse(built.error, false, built.badKey)
      return
    }
    setSaving(true)
    try {
      if (doc === 'quote') {
        const created = await createQuote({
          customer_id: customerId,
          channel,
          language,
          is_proforma: proforma,
          incoterm: incoterm || null,
          valid_until: validUntil,
          notes: notes || null,
          lines: built.ok,
        })
        onCreated(created.id)
      } else {
        const created = await createOrder({
          customer_id: customerId,
          channel,
          source: 'manual',
          order_date: orderDate,
          requested_date: requested,
          customer_department: department || null,
          customer_cost_center: costCenter || null,
          incoterm: incoterm || null,
          notes: notes || null,
          ship_to: ship ? { country_code: ship } : null,
          lines: built.ok,
        })
        onCreated(created.id)
      }
    } catch (err: unknown) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="venta-nueva" size="lg">
      <DialogHeader
        titleId="venta-nueva"
        title={doc === 'quote' ? copy.sales.newQuote : copy.sales.newOrder}
        onClose={onClose}
      />
      <DialogBody>
        <form
          id="venta-nueva-form"
          data-screen="ventas-dialogo"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field id="cliente" label={copy.sales.customer} hint={copy.sales.createHint}>
            <Combobox
              id="cliente"
              options={customerOptions}
              value={customerId}
              placeholder={copy.sales.findCustomer}
              emptyText={copy.sales.noCustomers}
              invalid={customerBad}
              onChange={pickCustomer}
            />
          </Field>
          <Field id="canal" label={copy.sales.channel}>
            <Select id="canal" className="w-full" value={channel} onChange={(event) => setChannel(event.target.value as ChannelCode)}>
              {CHANNELS.map((code) => (
                <option key={code} value={code}>
                  {channelLabel(code)}
                </option>
              ))}
            </Select>
          </Field>
          {preview ? (
            <p className="text-label text-text-secondary">
              <span className="font-medium text-ink-900">{copy.sales.invoiceAs.replace('{entity}', preview.entity_code)}</span>
              {' · '}
              {preview.label}
            </p>
          ) : customerId ? (
            <p className="text-label text-text-tertiary">{copy.sales.ruleMissing}</p>
          ) : null}
          {offer.error && offer.products.length === 0 ? (
            <p role="alert" className="text-label text-danger-700">{errorText(offer.error)}</p>
          ) : null}
          <LineEditor
            lines={lines}
            products={offer.products}
            lots={offer.lots}
            locations={offer.locations}
            onChange={changeLines}
            onPrice={(line) => reprice(line)}
            invalidKey={badLine}
          />
          {doc === 'quote' ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-label text-text-secondary">{copy.sales.language}</span>
                <SegmentedControl
                  aria-label={copy.sales.language}
                  size="sm"
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: 'es', content: copy.sales.spanish },
                    { value: 'en', content: copy.sales.english },
                  ]}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span id="proforma-label" className="text-label text-text-secondary">{copy.sales.proforma}</span>
                <Switch checked={proforma} aria-label={copy.sales.proforma} onChange={setProforma} />
              </div>
              <Field id="valido" label={copy.sales.validUntil}>
                <DatePicker value={validUntil} onChange={setValidUntil} labels={DATE_LABELS} timeZone="Europe/Madrid" />
              </Field>
            </>
          ) : (
            <>
              <Field id="fecha-pedido" label={copy.sales.orderDate}>
                <DatePicker value={orderDate} onChange={(next) => setOrderDate(next ?? todayMadrid())} labels={DATE_LABELS} timeZone="Europe/Madrid" />
              </Field>
              <Field id="fecha-entrega" label={copy.sales.requestedDate}>
                <DatePicker value={requested} onChange={setRequested} labels={DATE_LABELS} timeZone="Europe/Madrid" />
              </Field>
              <Field id="pais-entrega" label={copy.sales.shipCountry}>
                <Select id="pais-entrega" className="w-full" value={ship} onChange={(event) => setShip(event.target.value)}>
                  <option value="">{copy.sales.none}</option>
                  {COUNTRIES.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {channel === 'eci_edi' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="departamento" label={copy.sales.department}>
                    <Input id="departamento" value={department} onChange={(event) => setDepartment(event.target.value)} />
                  </Field>
                  <Field id="centro" label={copy.sales.costCenter}>
                    <Input id="centro" value={costCenter} onChange={(event) => setCostCenter(event.target.value)} />
                  </Field>
                </div>
              ) : null}
            </>
          )}
          <Field id="incoterm" label={copy.sales.incoterm}>
            <Select id="incoterm" className="w-full" value={incoterm} onChange={(event) => setIncoterm(event.target.value)}>
              <option value="">{copy.sales.none}</option>
              {INCOTERMS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="notas" label={copy.sales.notes}>
            <Textarea id="notas" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </form>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button type="submit" form="venta-nueva-form" variant="primary" size="sm" loading={saving}>
          {saving ? copy.sales.creating : copy.sales.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function CreateDelivery({
  customers,
  onClose,
  onCreated,
}: {
  customers: CatalogCustomer[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [kind, setKind] = useState<DeliveryKind>('sale')
  const [customerId, setCustomerId] = useState('')
  const [channel, setChannel] = useState<ChannelCode>('horeca')
  const [fromChoice, setFromChoice] = useState<string | null>(null)
  const [toId, setToId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [error, setError] = useState<string | null>(null)
  const [badLine, setBadLine] = useState<string | null>(null)
  const [customerBad, setCustomerBad] = useState(false)
  const [saving, setSaving] = useState(false)
  const customerOptions = useMemo<ComboOption[]>(
    () => customers.map((item) => ({ value: item.id, label: item.name, hint: item.country === 'ES' ? undefined : item.country })),
    [customers],
  )
  const offer = useSalesOffer({
    customerId: customerId || undefined,
    channel,
    date: todayMadrid(),
  })
  const locations = offer.locations
  const fromId = fromChoice ?? locations.find((item) => item.code === 'BOD')?.id ?? locations[0]?.id ?? ''
  const needsCustomer = kind === 'sale' || kind === 'sample'
  const needsTo = kind === 'consignment' || kind === 'transfer' || kind === 'return'

  function refuse(message: string, customer = false, line: string | null = null) {
    setError(message)
    setCustomerBad(customer)
    setBadLine(line)
    window.setTimeout(() => {
      const target = customer
        ? document.getElementById('cliente-albaran')
        : document.querySelector<HTMLElement>('[data-line-invalid="true"]')
      target?.scrollIntoView?.({ block: 'center' })
      if (customer) target?.focus()
    }, 0)
  }

  async function submit() {
    setError(null)
    setBadLine(null)
    setCustomerBad(false)
    if (!fromId) {
      refuse(copy.sales.pickOrigin)
      return
    }
    if (needsCustomer && !customerId) {
      refuse(copy.sales.pickCustomer, true)
      return
    }
    if (needsTo && !toId) {
      refuse(copy.sales.pickDestination)
      return
    }
    const built = commercialLines(lines)
    if (built.error) {
      refuse(built.error, false, built.badKey)
      return
    }
    setSaving(true)
    try {
      const created = await createDelivery({
        kind,
        customer_id: needsCustomer ? customerId : null,
        channel,
        from_location_id: fromId,
        to_location_id: needsTo ? toId : null,
        lines: built.ok,
      })
      onCreated(created.id)
    } catch (err: unknown) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="albaran-nuevo" size="lg">
      <DialogHeader titleId="albaran-nuevo" title={copy.sales.newDelivery} onClose={onClose} />
      <DialogBody>
        <form
          id="albaran-nuevo"
          data-screen="ventas-dialogo"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field id="tipo-albaran" label={copy.sales.kind}>
            <Select id="tipo-albaran" className="w-full" value={kind} onChange={(event) => setKind(event.target.value as DeliveryKind)}>
              {(['sale', 'consignment', 'transfer', 'return', 'sample'] as const).map((value) => (
                <option key={value} value={value}>
                  {kindLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="canal-albaran" label={copy.sales.channel}>
            <Select id="canal-albaran" className="w-full" value={channel} onChange={(event) => setChannel(event.target.value as ChannelCode)}>
              {CHANNELS.map((code) => (
                <option key={code} value={code}>
                  {channelLabel(code)}
                </option>
              ))}
            </Select>
          </Field>
          {needsCustomer ? (
            <Field id="cliente-albaran" label={copy.sales.customer}>
              <Combobox
                id="cliente-albaran"
                options={customerOptions}
                value={customerId}
                placeholder={copy.sales.findCustomer}
                emptyText={copy.sales.noCustomers}
                invalid={customerBad}
                onChange={(next) => {
                  setCustomerId(next)
                  setCustomerBad(false)
                  setError(null)
                }}
              />
            </Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="origen" label={copy.sales.from}>
              <Select id="origen" className="w-full" value={fromId} onChange={(event) => setFromChoice(event.target.value)}>
                {locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.code}
                  </option>
                ))}
              </Select>
            </Field>
            {needsTo ? (
              <Field id="destino" label={copy.sales.to}>
                <Select id="destino" className="w-full" value={toId} onChange={(event) => setToId(event.target.value)}>
                  <option value="">{copy.sales.to}</option>
                  {locations.filter((item) => item.id !== fromId).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {offer.error && offer.products.length === 0 ? (
            <p role="alert" className="text-label text-danger-700">{errorText(offer.error)}</p>
          ) : null}
          <LineEditor
            lines={lines}
            products={offer.products}
            lots={offer.lots}
            locations={locations}
            showLot
            locationId={fromId}
            onChange={(next) => {
              setLines(next)
              setError(null)
              setBadLine(null)
            }}
            onPrice={() => undefined}
            invalidKey={badLine}
          />
        </form>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button type="submit" form="albaran-nuevo" variant="primary" size="sm" loading={saving}>
          {saving ? copy.sales.creating : copy.sales.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function DeliveryFromOrder({
  order,
  lots,
  locations,
  productName,
  onClose,
  onCreated,
}: {
  order: SalesOrder
  lots: CatalogLot[]
  locations: CatalogLocation[]
  productName: (id: string) => string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [fromChoice, setFromChoice] = useState<string | null>(null)
  const [rows, setRows] = useState(() =>
    order.lines.map((line) => ({ id: line.id, productId: line.product_id ?? '', quantity: String(Number(line.quantity)), lotId: '' })),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fromId = fromChoice ?? locations.find((item) => item.code === 'BOD')?.id ?? locations[0]?.id ?? ''

  async function submit() {
    setError(null)
    if (!fromId) {
      setError(copy.sales.from)
      return
    }
    setSaving(true)
    try {
      const created = await createDelivery({
        kind: 'sale',
        sales_order_id: order.id,
        from_location_id: fromId,
        lines: rows
          .filter((row) => Number(row.quantity) > 0)
          .map((row) => ({
            order_line_id: row.id,
            quantity: row.quantity,
            lot_id: row.lotId || undefined,
          })),
      })
      onCreated(created.id)
    } catch (err: unknown) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="albaran-pedido" size="lg">
      <DialogHeader titleId="albaran-pedido" title={copy.sales.createDelivery} onClose={onClose} />
      <DialogBody>
        <form
          id="albaran-pedido"
          className="grid gap-4 pb-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field id="origen-pedido" label={copy.sales.from}>
            <Select id="origen-pedido" className="w-full" value={fromId} onChange={(event) => setFromChoice(event.target.value)}>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          <ul className="grid gap-3">
            {rows.map((row) => {
              const choices = lots.filter((lot) => lot.productId === row.productId && lot.locationId === fromId)
              return (
                <li key={row.id} className="grid gap-2 rounded-2xl border border-border-subtle p-3">
                  <p className="text-label text-ink-900">{productName(row.productId)}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field id={`qty-${row.id}`} label={copy.sales.quantity}>
                      <Input
                        id={`qty-${row.id}`}
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(event) =>
                          setRows((current) => current.map((item) => (item.id === row.id ? { ...item, quantity: event.target.value } : item)))
                        }
                      />
                    </Field>
                    <Field id={`lote-${row.id}`} label={copy.sales.lot}>
                      <Select
                        id={`lote-${row.id}`}
                        className="w-full"
                        value={row.lotId}
                        onChange={(event) =>
                          setRows((current) => current.map((item) => (item.id === row.id ? { ...item, lotId: event.target.value } : item)))
                        }
                      >
                        <option value="">{choices[0] ? copy.sales.lot : copy.sales.noLots}</option>
                        {choices.map((lot, index) => (
                          <option key={lot.id} value={lot.id}>
                            {lot.code}
                            {index === 0 ? ` · ${copy.sales.suggested}` : ''} · {lot.qty}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </li>
              )
            })}
          </ul>
        </form>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button type="submit" form="albaran-pedido" variant="primary" size="sm" loading={saving}>
          {saving ? copy.sales.creating : copy.sales.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function ReasonDialog({
  title,
  body,
  confirmLabel,
  danger,
  min = 3,
  optional = false,
  fieldLabel,
  extra,
  onClose,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  min?: number
  optional?: boolean
  fieldLabel?: string
  extra?: ReactNode
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    const text = reason.trim()
    if (text.length < min && !(optional && text.length === 0)) {
      setError(copy.sales.reasonRequired)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
    } catch (err: unknown) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} labelledBy="motivo-titulo" size="sm">
      <DialogHeader titleId="motivo-titulo" title={title} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3 pb-2">
          <p className="text-label text-text-secondary">{body}</p>
          {extra}
          <Field id="motivo" label={fieldLabel ?? copy.sales.reason}>
            <Textarea id="motivo" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button type="button" variant={danger ? 'danger' : 'primary'} size="sm" loading={saving} onClick={() => void submit()}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function ReturnDialog({
  lines,
  locations,
  onClose,
  onConfirm,
}: {
  lines: { id: string; description: string; quantity: string }[]
  locations: CatalogLocation[]
  onClose: () => void
  onConfirm: (toLocationId: string, rows: { line_id: string; quantity: string }[]) => Promise<void>
}) {
  const [toId, setToId] = useState(locations.find((item) => item.code === 'BOD')?.id ?? locations[0]?.id ?? '')
  const [rows, setRows] = useState(lines.map((line) => ({ id: line.id, quantity: String(Number(line.quantity)) })))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  return (
    <Dialog open onClose={onClose} labelledBy="devolucion" size="md">
      <DialogHeader titleId="devolucion" title={copy.sales.returnTitle} description={copy.sales.returnBody} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3 pb-2">
          <Field id="destino-dev" label={copy.sales.to}>
            <Select id="destino-dev" className="w-full" value={toId} onChange={(event) => setToId(event.target.value)}>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </Select>
          </Field>
          {lines.map((line) => (
            <Field key={line.id} id={`dev-${line.id}`} label={line.description}>
              <Input
                id={`dev-${line.id}`}
                inputMode="decimal"
                value={rows.find((row) => row.id === line.id)?.quantity ?? ''}
                onChange={(event) =>
                  setRows((current) => current.map((row) => (row.id === line.id ? { ...row, quantity: event.target.value } : row)))
                }
              />
            </Field>
          ))}
        </div>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={saving}
          onClick={() => {
            setSaving(true)
            setError(null)
            void onConfirm(
              toId,
              rows.filter((row) => Number(row.quantity) > 0).map((row) => ({ line_id: row.id, quantity: row.quantity })),
            ).catch((err: unknown) => {
              setError(errorText(err))
              setSaving(false)
            })
          }}
        >
          {copy.sales.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function IncidentDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (body: { kind: string; description: string; units_affected?: number }) => Promise<void>
}) {
  const [kind, setKind] = useState('breakage')
  const [description, setDescription] = useState('')
  const [units, setUnits] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  return (
    <Dialog open onClose={onClose} labelledBy="incidencia" size="sm">
      <DialogHeader titleId="incidencia" title={copy.sales.incidentTitle} onClose={onClose} />
      <DialogBody>
        <div className="grid gap-3 pb-2">
          <Field id="tipo-incidencia" label={copy.sales.kind}>
            <Select id="tipo-incidencia" className="w-full" value={kind} onChange={(event) => setKind(event.target.value)}>
              {(Object.keys(copy.sales.incidents) as (keyof typeof copy.sales.incidents)[]).map((value) => (
                <option key={value} value={value}>
                  {copy.sales.incidents[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="texto-incidencia" label={copy.sales.description}>
            <Textarea id="texto-incidencia" value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field id="uds-incidencia" label={copy.sales.units}>
            <Input id="uds-incidencia" inputMode="numeric" value={units} onChange={(event) => setUnits(event.target.value)} />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter error={error}>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          {copy.sales.cancel}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={saving}
          onClick={() => {
            setSaving(true)
            const parsed = units.trim() === '' ? undefined : Number(units)
            void onConfirm({ kind, description, units_affected: parsed }).catch((err: unknown) => {
              setError(errorText(err))
              setSaving(false)
            })
          }}
        >
          {copy.sales.create}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
