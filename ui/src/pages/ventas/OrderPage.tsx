import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { COUNTRIES } from '@/lib/contacts'
import { allows } from '@/lib/permissions'
import { mergeProducts, productAliases, useSalesCatalog, useSalesOffer } from '@/lib/sales-catalog'
import { commercialLines, draftsFrom, type DraftLine } from '@/lib/sales-draft'
import {
  CHANNELS,
  INCOTERMS,
  cancelOrder,
  channelLabel,
  closeOrder,
  confirmOrder,
  docPath,
  errorText,
  formatIsoDate,
  getPriceQuote,
  invoicingLabel,
  orderStatusLabel,
  patchOrder,
  setEntityException,
  shipCountry,
  sourceLabel,
  todayMadrid,
  type DeliveryNote,
  type SalesOrder,
  type SalesPage,
} from '@/lib/sales'
import type { Me } from '@/lib/types'
import { Button, DatePicker, Input, MenuItem, Select, Textarea, useToast } from '@/ui'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import {
  DocLink,
  FactList,
  LineTable,
  MoreMenu,
  RecordFrame,
  RuleLine,
  SalesHistory,
  StatusBadge,
  TotalsBox,
} from '@/pages/ventas/chrome'
import { DeliveryFromOrder, ReasonDialog } from '@/pages/ventas/dialogs'
import { LineEditor } from '@/pages/ventas/lines'

const DATE_LABELS = { clear: 'Quitar', today: 'Hoy' }

export function OrderPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const order = useApi<SalesOrder>(id ? `/v1/sales-orders/${id}` : null)
  useChromeTitle(order.data?.number || copy.sales.orders)
  if (!allows(me, 'sales.read')) return <NoPermission />
  if (order.loading && !order.data) return <Loading />
  if (order.error || !order.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${order.error?.code ?? 'WC_ERROR'})`} detail={order.error?.message} onRetry={order.reload} />
      </div>
    )
  }
  return <Loaded me={me} order={order.data} onReload={order.reload} />
}

function Loaded({ me, order, onReload }: { me: Me; order: SalesOrder; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const notes = useApi<SalesPage<DeliveryNote>>('/v1/delivery-notes?limit=100')
  const related = (notes.data?.items ?? []).filter((item) => item.sales_order_id === order.id)
  const aliases = productAliases(order.lines)
  const catalog = useSalesCatalog(aliases)
  const [tab, setTab] = useState('lines')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>(() => draftsFrom(order.lines))
  const [channel, setChannel] = useState(order.channel)
  const [notesText, setNotesText] = useState(order.notes ?? '')
  const [incoterm, setIncoterm] = useState(order.incoterm ?? '')
  const [orderDate, setOrderDate] = useState(order.order_date)
  const [requested, setRequested] = useState<string | null>(order.requested_date)
  const [department, setDepartment] = useState(order.customer_department ?? '')
  const [costCenter, setCostCenter] = useState(order.customer_cost_center ?? '')
  const [ship, setShip] = useState(shipCountry(order.ship_to))
  const [dialog, setDialog] = useState<null | 'cancel' | 'close' | 'exception' | 'delivery'>(null)
  const [entityId, setEntityId] = useState(me.entities[0]?.id ?? '')
  const stamps = useRef<Record<string, string>>({})
  const canWrite = allows(me, 'sales.write')
  const canManage = allows(me, 'sales.manage')
  const draft = order.status === 'draft'
  const servable = order.status === 'confirmed' || order.status === 'partially_delivered'
  const ruleCode = order.entity_code ?? order.issuing_preview?.entity_code ?? null
  const ruleLabel = order.rule_label ?? order.issuing_preview?.label ?? null
  const offer = useSalesOffer({
    customerId: order.customer_id,
    channel,
    date: orderDate || todayMadrid(),
  })
  const products = mergeProducts(offer.products, aliases)
  const places = offer.locations.length > 0 ? offer.locations : catalog.locations

  function reprice(line: DraftLine) {
    const listed = offer.priceOf(line.productId)
    if (listed) {
      setLines((current) =>
        current.map((item) =>
          item.key === line.key ? { ...item, quoted: listed, unitPrice: item.touched ? item.unitPrice : listed } : item,
        ),
      )
    }
    if (!line.productId || !(Number(line.quantity) > 0)) return
    const stamp = crypto.randomUUID()
    stamps.current[line.key] = stamp
    getPriceQuote({ customerId: order.customer_id, productId: line.productId, qty: line.quantity, date: orderDate, channel })
      .then((hit) => {
        if (stamps.current[line.key] !== stamp) return
        setLines((current) =>
          current.map((item) =>
            item.key === line.key ? { ...item, quoted: hit.unit_price, unitPrice: item.touched ? item.unitPrice : hit.unit_price } : item,
          ),
        )
      })
      .catch(() => undefined)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (error: unknown) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const built = commercialLines(lines)
    if (built.error || built.ok.length !== order.lines.length) {
      toast(built.error ?? copy.sales.lineLock)
      return
    }
    setBusy(true)
    try {
      await patchOrder(order.id, {
        customer_id: order.customer_id,
        channel,
        order_date: orderDate,
        requested_date: requested,
        customer_department: department || null,
        customer_cost_center: costCenter || null,
        incoterm: incoterm || null,
        notes: notesText || null,
        ship_to: ship ? { country_code: ship } : null,
        lines: built.ok,
      })
      toast(copy.sales.toast.saved)
      setEditing(false)
      onReload()
    } catch (error: unknown) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <RecordFrame
      backTo={docPath('order')}
      backLabel={copy.sales.orders}
      title={order.number ?? copy.sales.draft}
      subtitle={catalog.customerName(order.customer_id)}
      badges={
        <>
          <StatusBadge status={order.status} label={orderStatusLabel(order.status)} />
          <StatusBadge status={order.invoicing_status === 'invoiced' ? 'invoiced' : 'draft'} label={invoicingLabel(order.invoicing_status)} />
          {order.entity_code ? <StatusBadge status="draft" label={order.entity_code} /> : null}
        </>
      }
      actions={
        canWrite ? (
          <>
            {editing ? (
              <>
                <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void save()}>
                  {busy ? copy.sales.saving : copy.sales.save}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  {copy.sales.cancel}
                </Button>
              </>
            ) : (
              <>
                {draft ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setLines(draftsFrom(order.lines)); setEditing(true); setTab('lines') }}>
                    {copy.sales.edit}
                  </Button>
                ) : null}
                {draft ? (
                  <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void run(async () => { await confirmOrder(order.id); toast(copy.sales.toast.confirmed); onReload() })}>
                    {copy.sales.confirm}
                  </Button>
                ) : null}
                {servable ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => setDialog('delivery')}>
                    {copy.sales.createDelivery}
                  </Button>
                ) : null}
              </>
            )}
            {(draft && canManage) || ((draft || order.status === 'confirmed') && canWrite) || (order.status === 'partially_delivered' && canManage) ? (
              <MoreMenu>
                {(close) => (
                  <>
                    {draft && canManage ? (
                      <MenuItem onClick={() => { close(); setDialog('exception') }}>{copy.sales.exception}</MenuItem>
                    ) : null}
                    {(draft || order.status === 'confirmed') && canWrite ? (
                      <MenuItem tone="danger" onClick={() => { close(); setDialog('cancel') }}>{copy.sales.voidDoc}</MenuItem>
                    ) : null}
                    {order.status === 'partially_delivered' && canManage ? (
                      <MenuItem onClick={() => { close(); setDialog('close') }}>{copy.sales.closeRest}</MenuItem>
                    ) : null}
                  </>
                )}
              </MoreMenu>
            ) : null}
          </>
        ) : null
      }
      tabs={[
        { id: 'lines', label: copy.sales.lines },
        { id: 'summary', label: copy.sales.summary },
        { id: 'history', label: copy.sales.history },
      ]}
      tab={tab}
      onTab={setTab}
    >
      <RuleLine code={ruleCode} label={ruleLabel} />
      {tab === 'lines' ? (
        <div className="grid gap-4">
          {editing ? (
            <LineEditor
              lines={lines}
              products={products}
              lots={offer.lots}
              locations={places}
              lockCount
              onChange={setLines}
              onPrice={reprice}
            />
          ) : (
            <LineTable lines={order.lines} />
          )}
          <TotalsBox subtotal={order.subtotal} tax={order.tax_total} total={order.total} />
        </div>
      ) : null}
      {tab === 'summary' ? (
        <div className="grid gap-4">
          {editing ? (
            <div className="grid gap-3">
              <Field id="canal-pedido" label={copy.sales.channel}>
                <Select id="canal-pedido" className="w-full" value={channel} onChange={(event) => setChannel(event.target.value)}>
                  {CHANNELS.map((code) => (
                    <option key={code} value={code}>{channelLabel(code)}</option>
                  ))}
                </Select>
              </Field>
              <Field id="fecha-pedido" label={copy.sales.orderDate}>
                <DatePicker value={orderDate} onChange={(next) => setOrderDate(next ?? todayMadrid())} labels={DATE_LABELS} timeZone="Europe/Madrid" />
              </Field>
              <Field id="entrega-pedido" label={copy.sales.requestedDate}>
                <DatePicker value={requested} onChange={setRequested} labels={DATE_LABELS} timeZone="Europe/Madrid" />
              </Field>
              <Field id="pais-pedido" label={copy.sales.shipCountry}>
                <Select id="pais-pedido" className="w-full" value={ship} onChange={(event) => setShip(event.target.value)}>
                  <option value="">{copy.sales.none}</option>
                  {COUNTRIES.map((item) => (
                    <option key={item.code} value={item.code}>{item.label}</option>
                  ))}
                </Select>
              </Field>
              <Field id="incoterm-pedido" label={copy.sales.incoterm}>
                <Select id="incoterm-pedido" className="w-full" value={incoterm} onChange={(event) => setIncoterm(event.target.value)}>
                  <option value="">{copy.sales.none}</option>
                  {INCOTERMS.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </Select>
              </Field>
              {channel === 'eci_edi' ? (
                <>
                  <Field id="dep-pedido" label={copy.sales.department}>
                    <Input id="dep-pedido" value={department} onChange={(event) => setDepartment(event.target.value)} />
                  </Field>
                  <Field id="cc-pedido" label={copy.sales.costCenter}>
                    <Input id="cc-pedido" value={costCenter} onChange={(event) => setCostCenter(event.target.value)} />
                  </Field>
                </>
              ) : null}
              <Field id="notas-pedido" label={copy.sales.notes}>
                <Textarea id="notas-pedido" value={notesText} onChange={(event) => setNotesText(event.target.value)} />
              </Field>
            </div>
          ) : (
            <FactList
              rows={[
                { label: copy.sales.customer, value: catalog.customerName(order.customer_id) },
                { label: copy.sales.channel, value: channelLabel(order.channel) },
                { label: copy.sales.source, value: sourceLabel(order.source) },
                { label: copy.sales.date, value: formatIsoDate(order.order_date) },
                { label: copy.sales.requestedDate, value: formatIsoDate(order.requested_date) },
                { label: copy.sales.incoterm, value: order.incoterm || '—' },
                { label: copy.sales.shipCountry, value: shipCountry(order.ship_to) || '—' },
                { label: copy.sales.notes, value: order.notes || '—' },
                {
                  label: copy.sales.relatedQuote,
                  value: order.quote_id ? <DocLink to={`${docPath('quote')}/${order.quote_id}`}>{copy.sales.quotes}</DocLink> : '—',
                },
                {
                  label: copy.sales.relatedNotes,
                  value: related.length === 0 ? '—' : (
                    <span className="flex flex-col gap-1">
                      {related.map((note) => (
                        <DocLink key={note.id} to={`${docPath('delivery')}/${note.id}`}>
                          {note.number ?? copy.sales.draft}
                        </DocLink>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      ) : null}
      {tab === 'history' ? <SalesHistory table="sales.sales_order" id={order.id} /> : null}
      {dialog === 'delivery' ? (
        <DeliveryFromOrder
          order={order}
          lots={offer.lots}
          locations={places}
          productName={(id) => order.lines.find((line) => line.product_id === id)?.description ?? products.find((item) => item.id === id)?.label ?? id.slice(0, 8)}
          onClose={() => setDialog(null)}
          onCreated={(id) => navigate(`${docPath('delivery')}/${id}`)}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <ReasonDialog
          title={copy.sales.cancelOrderTitle}
          body={copy.sales.cancelOrderBody}
          confirmLabel={copy.sales.voidDoc}
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await cancelOrder(order.id, reason)
            toast(copy.sales.toast.voided)
            setDialog(null)
            onReload()
          }}
        />
      ) : null}
      {dialog === 'close' ? (
        <ReasonDialog
          title={copy.sales.closeTitle}
          body={copy.sales.closeBody}
          confirmLabel={copy.sales.closeRest}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await closeOrder(order.id, reason)
            toast(copy.sales.toast.closed)
            setDialog(null)
            onReload()
          }}
        />
      ) : null}
      {dialog === 'exception' ? (
        <ReasonDialog
          title={copy.sales.exceptionTitle}
          body={copy.sales.exceptionBody}
          confirmLabel={copy.sales.save}
          min={5}
          extra={
            <Field id="entidad-excepcion" label={copy.sales.entity}>
              <Select id="entidad-excepcion" className="w-full" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
                {me.entities.map((item) => (
                  <option key={item.id} value={item.id}>{item.code}</option>
                ))}
              </Select>
            </Field>
          }
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await setEntityException(order.id, entityId, reason)
            toast(copy.sales.toast.exception)
            setDialog(null)
            onReload()
          }}
        />
      ) : null}
    </RecordFrame>
  )
}

function Loading() {
  return <RecordSkeleton />
}
