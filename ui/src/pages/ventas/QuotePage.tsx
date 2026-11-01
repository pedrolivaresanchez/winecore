import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { mergeProducts, productAliases, useSalesCatalog, useSalesOffer } from '@/lib/sales-catalog'
import { commercialLines, draftsFrom, type DraftLine } from '@/lib/sales-draft'
import {
  CHANNELS,
  INCOTERMS,
  acceptQuote,
  channelLabel,
  docPath,
  errorText,
  formatIsoDate,
  getPriceQuote,
  patchQuote,
  quoteStatusLabel,
  quoteToOrder,
  rejectQuote,
  sendQuote,
  todayMadrid,
  type Quote,
  type SalesOrder,
  type SalesPage,
} from '@/lib/sales'
import type { Me } from '@/lib/types'
import { Button, DatePicker, MenuItem, SegmentedControl, Select, Switch, Textarea, useToast } from '@/ui'
import { DocLink, FactList, LineTable, MoreMenu, RecordFrame, SalesHistory, StatusBadge, TotalsBox } from '@/pages/ventas/chrome'
import { ReasonDialog } from '@/pages/ventas/dialogs'
import { LineEditor } from '@/pages/ventas/lines'
import { ShippingFields } from '@/pages/ventas/shipping'
import { shipToDraftOf, shipToPayload, referencesPayload, shippingRows, type ShipToDraft } from '@/lib/shipping'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import { DocumentModal } from '@/pages/documents/DocumentModal'
import { useDocParam } from '@/pages/documents/use-doc-param'

const DATE_LABELS = { clear: 'Quitar', today: 'Hoy' }

export function QuotePage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const quote = useApi<Quote>(id ? `/v1/quotes/${id}` : null)
  useChromeTitle(quote.data?.number || copy.sales.quotes)
  if (!allows(me, 'sales.read')) return <NoPermission />
  if (quote.loading && !quote.data) return <Loading />
  if (quote.error || !quote.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${quote.error?.code ?? 'WC_ERROR'})`} detail={quote.error?.message} onRetry={quote.reload} />
      </div>
    )
  }
  return <Loaded me={me} quote={quote.data} onReload={quote.reload} />
}

function Loaded({ me, quote, onReload }: { me: Me; quote: Quote; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const opened = useDocParam()
  const showPdf = () => opened.open(quote.id)
  const catalog = useSalesCatalog()
  const [tab, setTab] = useState('lines')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>(() => draftsFrom(quote.lines))
  const [customerId, setCustomerId] = useState(quote.customer_id)
  const [channel, setChannel] = useState(quote.channel)
  const [language, setLanguage] = useState(quote.language === 'en' ? 'en' : 'es')
  const [proforma, setProforma] = useState(quote.is_proforma)
  const [incoterm, setIncoterm] = useState(quote.incoterm ?? '')
  const [validUntil, setValidUntil] = useState<string | null>(quote.valid_until)
  const [notesText, setNotesText] = useState(quote.notes ?? '')
  const [shipTo, setShipTo] = useState<ShipToDraft>(() => shipToDraftOf(quote.ship_to))
  const [references, setReferences] = useState(quote.customer_references ?? '')
  const stamps = useRef<Record<string, string>>({})
  const canWrite = allows(me, 'sales.write')
  const draft = quote.status === 'draft'
  const open = quote.status === 'draft' || quote.status === 'sent'
  const canOrder = quote.status === 'draft' || quote.status === 'sent' || quote.status === 'accepted'
  const offerDate = quote.issue_date ?? todayMadrid()
  const offer = useSalesOffer({
    customerId: editing ? customerId : quote.customer_id,
    channel: editing ? channel : quote.channel,
    date: offerDate,
  })
  const products = mergeProducts(offer.products, productAliases(quote.lines))
  const orders = useApi<SalesPage<SalesOrder>>(quote.status === 'converted' ? '/v1/sales-orders?limit=100' : null)
  const child = orders.data?.items.find((item) => item.quote_id === quote.id)
  const title = quote.number ?? copy.sales.draft
  const customers = catalog.customers.some((item) => item.id === customerId)
    ? catalog.customers
    : [{ id: quote.customer_id, name: catalog.customerName(quote.customer_id), country: '' }, ...catalog.customers]

  function reprice(line: DraftLine) {
    const listed = offer.priceOf(line.productId)
    if (listed) {
      setLines((current) =>
        current.map((item) =>
          item.key === line.key ? { ...item, quoted: listed, unitPrice: item.touched ? item.unitPrice : listed } : item,
        ),
      )
    }
    if (!customerId || !line.productId || !(Number(line.quantity) > 0)) return
    const stamp = crypto.randomUUID()
    stamps.current[line.key] = stamp
    getPriceQuote({ customerId, productId: line.productId, qty: line.quantity, date: offerDate, channel })
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

  function beginEdit() {
    setLines(draftsFrom(quote.lines))
    setCustomerId(quote.customer_id)
    setChannel(quote.channel)
    setLanguage(quote.language === 'en' ? 'en' : 'es')
    setProforma(quote.is_proforma)
    setIncoterm(quote.incoterm ?? '')
    setValidUntil(quote.valid_until)
    setNotesText(quote.notes ?? '')
    setShipTo(shipToDraftOf(quote.ship_to))
    setReferences(quote.customer_references ?? '')
    setEditing(true)
    setTab('lines')
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
    if (built.error) {
      toast(built.error)
      return
    }
    setBusy(true)
    try {
      await patchQuote(quote.id, {
        customer_id: customerId,
        channel,
        language,
        is_proforma: proforma,
        incoterm: incoterm || null,
        valid_until: validUntil,
        notes: notesText || null,
        ship_to: shipToPayload(shipTo),
        customer_references: referencesPayload(references),
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
      backTo={docPath('quote')}
      backLabel={copy.sales.quotes}
      title={title}
      subtitle={catalog.customerName(editing ? customerId : quote.customer_id)}
      badges={
        <>
          <StatusBadge status={quote.status} label={quoteStatusLabel(quote.status)} />
          {(editing ? proforma : quote.is_proforma) ? <StatusBadge status="sent" label={copy.sales.proforma} /> : null}
          {(editing ? language : quote.language) === 'en' ? <StatusBadge status="draft" label={copy.sales.english} /> : null}
        </>
      }
      actions={
        canWrite ? (
          editing ? (
            <>
              <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void save()}>
                {busy ? copy.sales.saving : copy.sales.save}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                {copy.sales.cancel}
              </Button>
            </>
          ) : (
            <>
              {draft ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => void run(async () => { await sendQuote(quote.id); toast(copy.sales.toast.sent); onReload() })}
                >
                  {copy.sales.send}
                </Button>
              ) : null}
              {open ? (
                <Button
                  type="button"
                  variant={draft ? 'secondary' : 'primary'}
                  size="sm"
                  loading={busy}
                  onClick={() => void run(async () => { await acceptQuote(quote.id); toast(copy.sales.toast.quoteAccepted); onReload() })}
                >
                  {copy.sales.accept}
                </Button>
              ) : null}
              {open ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setRejecting(true)}>
                  {copy.sales.reject}
                </Button>
              ) : null}
              {canOrder && !open ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const order = await quoteToOrder(quote.id)
                      toast(copy.sales.toast.accepted)
                      navigate(`${docPath('order')}/${order.id}`)
                    })
                  }
                >
                  {copy.sales.toOrder}
                </Button>
              ) : null}
              <MoreMenu>
                {(close) => (
                  <>
                    <MenuItem onClick={() => { close(); showPdf() }}>{copy.sales.pdf}</MenuItem>
                    {draft ? <MenuItem onClick={() => { close(); beginEdit() }}>{copy.sales.edit}</MenuItem> : null}
                    {canOrder && open ? (
                      <MenuItem
                        onClick={() => {
                          close()
                          void run(async () => {
                            const order = await quoteToOrder(quote.id)
                            toast(copy.sales.toast.accepted)
                            navigate(`${docPath('order')}/${order.id}`)
                          })
                        }}
                      >
                        {copy.sales.toOrder}
                      </MenuItem>
                    ) : null}
                  </>
                )}
              </MoreMenu>
            </>
          )
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={showPdf}>
            {copy.sales.pdf}
          </Button>
        )
      }
      tabs={[
        { id: 'lines', label: copy.sales.lines },
        { id: 'summary', label: copy.sales.summary },
        { id: 'history', label: copy.sales.history },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {tab === 'lines' ? (
        <div className="grid gap-4">
          {editing ? (
            <LineEditor lines={lines} products={products} lots={[]} locations={[]} onChange={setLines} onPrice={reprice} />
          ) : (
            <LineTable lines={quote.lines} />
          )}
          <TotalsBox subtotal={quote.subtotal} tax={quote.tax_total} total={quote.total} />
        </div>
      ) : null}
      {tab === 'summary' ? (
        <div className="grid gap-4">
          {editing ? (
            <div className="grid gap-3">
              <Field id="cliente-presupuesto" label={copy.sales.customer}>
                <Select id="cliente-presupuesto" className="w-full" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  {customers.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </Select>
              </Field>
              <Field id="canal-presupuesto" label={copy.sales.channel}>
                <Select id="canal-presupuesto" className="w-full" value={channel} onChange={(event) => setChannel(event.target.value)}>
                  {CHANNELS.map((code) => (
                    <option key={code} value={code}>{channelLabel(code)}</option>
                  ))}
                </Select>
              </Field>
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
                <span className="text-label text-text-secondary">{copy.sales.proforma}</span>
                <Switch checked={proforma} aria-label={copy.sales.proforma} onChange={setProforma} />
              </div>
              <Field id="valido-presupuesto" label={copy.sales.validUntil}>
                <DatePicker value={validUntil} onChange={setValidUntil} labels={DATE_LABELS} timeZone="Europe/Madrid" />
              </Field>
              <Field id="incoterm-presupuesto" label={copy.sales.incoterm}>
                <Select id="incoterm-presupuesto" className="w-full" value={incoterm} onChange={(event) => setIncoterm(event.target.value)}>
                  <option value="">{copy.sales.none}</option>
                  {INCOTERMS.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </Select>
              </Field>
              <Field id="notas-presupuesto" label={copy.sales.notes}>
                <Textarea id="notas-presupuesto" value={notesText} onChange={(event) => setNotesText(event.target.value)} />
              </Field>
              <ShippingFields
                idPrefix="presupuesto"
                shipTo={shipTo}
                onShipTo={setShipTo}
                references={references}
                onReferences={setReferences}
              />
            </div>
          ) : (
            <FactList
              rows={[
                { label: copy.sales.customer, value: catalog.customerName(quote.customer_id) },
                { label: copy.sales.channel, value: channelLabel(quote.channel) },
                { label: copy.sales.language, value: quote.language === 'en' ? copy.sales.english : copy.sales.spanish },
                { label: copy.sales.incoterm, value: quote.incoterm || '—' },
                { label: copy.sales.validUntil, value: formatIsoDate(quote.valid_until) },
                { label: copy.sales.date, value: formatIsoDate(quote.issue_date) },
                { label: copy.sales.notes, value: quote.notes || '—' },
                ...shippingRows(quote.ship_to, quote.customer_references),
                {
                  label: copy.sales.relatedOrder,
                  value: child ? <DocLink to={`${docPath('order')}/${child.id}`}>{child.number ?? copy.sales.draft}</DocLink> : '—',
                },
              ]}
            />
          )}
        </div>
      ) : null}
      {tab === 'history' ? <SalesHistory table="sales.quote" id={quote.id} /> : null}
      {rejecting ? (
        <ReasonDialog
          title={copy.sales.rejectTitle}
          body={copy.sales.rejectBody}
          confirmLabel={copy.sales.reject}
          danger
          optional
          fieldLabel={copy.sales.reasonOptional}
          onClose={() => setRejecting(false)}
          onConfirm={async (reason) => {
            await rejectQuote(quote.id, reason)
            toast(copy.sales.toast.quoteRejected)
            setRejecting(false)
            onReload()
          }}
        />
      ) : null}
      <DocumentModal me={me} source="quote" id={opened.id} onClose={opened.close} onChanged={onReload} />
    </RecordFrame>
  )
}

function Loading() {
  return <RecordSkeleton />
}
