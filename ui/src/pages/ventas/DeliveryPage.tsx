import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { mergeProducts, productAliases, useSalesCatalog, useSalesOffer } from '@/lib/sales-catalog'
import { commercialLines, draftsFrom, type DraftLine } from '@/lib/sales-draft'
import {
  channelLabel,
  createIncident,
  deliverDelivery,
  deliveryStatusLabel,
  dispatchDelivery,
  docPath,
  errorText,
  formatIsoDate,
  invoicingLabel,
  issueDelivery,
  kindLabel,
  markNotInvoiceable,
  patchDelivery,
  returnDelivery,
  shipCountry,
  todayMadrid,
  voidDelivery,
  type DeliveryNote,
} from '@/lib/sales'
import type { Me } from '@/lib/types'
import { Alert, Button, Input, MenuItem, useToast } from '@/ui'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import { DocumentModal } from '@/pages/documents/DocumentModal'
import { useDocParam } from '@/pages/documents/use-doc-param'
import {
  DocLink,
  EadChip,
  FactList,
  LineTable,
  MoreMenu,
  PhysicalChip,
  RecordFrame,
  SalesHistory,
  StatusBadge,
} from '@/pages/ventas/chrome'
import { IncidentDialog, ReasonDialog, ReturnDialog } from '@/pages/ventas/dialogs'
import { LineEditor } from '@/pages/ventas/lines'

export function DeliveryPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const note = useApi<DeliveryNote>(id ? `/v1/delivery-notes/${id}` : null)
  useChromeTitle(note.data?.number || copy.sales.deliveries)
  if (!allows(me, 'sales.read')) return <NoPermission />
  if (note.loading && !note.data) {
    return <RecordSkeleton />
  }
  if (note.error || !note.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${note.error?.code ?? 'WC_ERROR'})`} detail={note.error?.message} onRetry={note.reload} />
      </div>
    )
  }
  return <Loaded me={me} note={note.data} onReload={note.reload} />
}

function Loaded({ me, note, onReload }: { me: Me; note: DeliveryNote; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const opened = useDocParam()
  const aliases = productAliases(note.lines)
  const catalog = useSalesCatalog(aliases)
  const offer = useSalesOffer({
    customerId: note.customer_id ?? undefined,
    channel: note.channel ?? undefined,
    date: note.issue_date ?? todayMadrid(),
  })
  const products = mergeProducts(offer.products, aliases)
  const places = offer.locations.length > 0 ? offer.locations : catalog.locations
  const [tab, setTab] = useState('lines')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<DraftLine[]>(() => draftsFrom(note.lines))
  const [tracking, setTracking] = useState(note.tracking_ref ?? '')
  const [dialog, setDialog] = useState<null | 'issue' | 'void' | 'return' | 'incident' | 'skip'>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const canWrite = allows(me, 'sales.write')
  const canManage = allows(me, 'sales.manage')
  const draft = note.status === 'draft'
  const moved = note.status === 'issued' || note.status === 'shipped' || note.status === 'delivered'
  const customer = catalog.customers.find((item) => item.id === note.customer_id)
  const abroad = note.channel === 'export' || (shipCountry(note.ship_to) !== '' && shipCountry(note.ship_to) !== 'ES') || (customer != null && customer.country !== 'ES')
  const needsEad = (note.kind === 'sale' || note.kind === 'sample') && abroad
  const from = places.find((item) => item.id === note.from_location_id)?.code ?? note.from_location_id.slice(0, 8)
  const to = note.to_location_id ? places.find((item) => item.id === note.to_location_id)?.code ?? '—' : catalog.customerName(note.customer_id)

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
      await patchDelivery(note.id, built.ok)
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
      backTo={docPath('delivery')}
      backLabel={copy.sales.deliveries}
      title={note.number ?? copy.sales.draft}
      subtitle={`${kindLabel(note.kind)} · ${catalog.customerName(note.customer_id)}`}
      badges={
        <>
          <StatusBadge status={note.status} label={deliveryStatusLabel(note.status)} />
          <StatusBadge status={note.invoicing_status === 'invoiced' ? 'invoiced' : 'draft'} label={invoicingLabel(note.invoicing_status)} />
          {moved ? <PhysicalChip /> : null}
          {needsEad && note.status === 'issued' ? <EadChip /> : null}
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
                <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                  {copy.sales.cancel}
                </Button>
              </>
            ) : (
              <>
                {draft ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setLines(draftsFrom(note.lines)); setEditing(true); setTab('lines') }}>
                    {copy.sales.edit}
                  </Button>
                ) : null}
                {draft ? (
                  <Button type="button" variant="primary" size="sm" onClick={() => { setIssueError(null); setDialog('issue') }}>
                    {copy.sales.issue}
                  </Button>
                ) : null}
                {note.status === 'issued' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => void run(async () => { await dispatchDelivery(note.id, tracking.trim() || undefined); toast(copy.sales.toast.shipped); onReload() })}
                  >
                    {copy.sales.dispatch}
                  </Button>
                ) : null}
                {note.status === 'shipped' ? (
                  <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void run(async () => { await deliverDelivery(note.id); toast(copy.sales.toast.delivered); onReload() })}>
                    {copy.sales.deliver}
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" size="sm" onClick={() => opened.open(note.id)}>
                  {copy.sales.pdf}
                </Button>
              </>
            )}
            {((draft || note.status === 'issued') && canManage) || moved ? (
              <MoreMenu>
                {(close) => (
                  <>
                    {(draft || note.status === 'issued') && canManage ? (
                      <MenuItem tone="danger" onClick={() => { close(); setDialog('void') }}>{copy.sales.voidDoc}</MenuItem>
                    ) : null}
                    {moved ? <MenuItem onClick={() => { close(); setDialog('return') }}>{copy.sales.returnDoc}</MenuItem> : null}
                    {moved ? <MenuItem onClick={() => { close(); setDialog('incident') }}>{copy.sales.incident}</MenuItem> : null}
                    {moved && canManage && note.invoicing_status !== 'not_invoiceable' ? (
                      <MenuItem onClick={() => { close(); setDialog('skip') }}>{copy.sales.notInvoiceable}</MenuItem>
                    ) : null}
                  </>
                )}
              </MoreMenu>
            ) : null}
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => opened.open(note.id)}>
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
        editing ? (
          <LineEditor
            lines={lines}
            products={products}
            lots={offer.lots}
            locations={places}
            showLot
            locationId={note.from_location_id}
            onChange={setLines}
            onPrice={() => undefined}
          />
        ) : (
          <LineTable
            lines={note.lines}
            lotName={(id) => offer.lots.find((lot) => lot.id === id)?.code ?? id.slice(0, 8)}
          />
        )
      ) : null}
      {tab === 'summary' ? (
        <div className="grid gap-4">
          {note.status === 'issued' ? (
            <Field id="seguimiento" label={copy.sales.tracking}>
              <Input id="seguimiento" value={tracking} onChange={(event) => setTracking(event.target.value)} />
            </Field>
          ) : null}
          <FactList
            rows={[
              { label: copy.sales.kind, value: kindLabel(note.kind) },
              { label: copy.sales.customer, value: catalog.customerName(note.customer_id) },
              { label: copy.sales.channel, value: channelLabel(note.channel) },
              { label: copy.sales.from, value: from },
              { label: copy.sales.to, value: to },
              { label: copy.sales.date, value: formatIsoDate(note.issue_date) },
              { label: copy.sales.incoterm, value: note.incoterm || '—' },
              { label: copy.sales.tracking, value: note.tracking_ref || '—' },
              { label: copy.sales.notes, value: note.notes || '—' },
              {
                label: copy.sales.relatedOrder,
                value: note.sales_order_id ? <DocLink to={`${docPath('order')}/${note.sales_order_id}`}>{copy.sales.orders}</DocLink> : '—',
              },
            ]}
          />
        </div>
      ) : null}
      {tab === 'history' ? <SalesHistory table="sales.delivery_note" id={note.id} /> : null}

      <ConfirmDialog
        open={dialog === 'issue'}
        title={copy.sales.issueTitle}
        body={
          <div data-screen="ventas-emitir" className="grid gap-3">
            <span>{copy.sales.issueBody}</span>
            {issueError ? <Alert tone="danger">{issueError}</Alert> : null}
          </div>
        }
        confirmLabel={copy.sales.issue}
        busy={busy}
        onClose={() => {
          if (busy) return
          setDialog(null)
          setIssueError(null)
        }}
        onConfirm={() => {
          setBusy(true)
          setIssueError(null)
          void issueDelivery(note.id)
            .then(() => {
              toast(copy.sales.toast.issued)
              setDialog(null)
              onReload()
            })
            .catch((error: unknown) => setIssueError(errorText(error)))
            .finally(() => setBusy(false))
        }}
      />
      {dialog === 'void' ? (
        <ReasonDialog
          title={copy.sales.voidTitle}
          body={copy.sales.voidBody}
          confirmLabel={copy.sales.voidDoc}
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await voidDelivery(note.id, reason)
            toast(copy.sales.toast.voided)
            setDialog(null)
            onReload()
          }}
        />
      ) : null}
      {dialog === 'skip' ? (
        <ReasonDialog
          title={copy.sales.notInvoiceTitle}
          body={copy.sales.notInvoiceBody}
          confirmLabel={copy.sales.notInvoiceable}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await markNotInvoiceable(note.id, reason)
            toast(copy.sales.toast.notInvoiceable)
            setDialog(null)
            onReload()
          }}
        />
      ) : null}
      {dialog === 'return' ? (
        <ReturnDialog
          lines={note.lines.map((line) => ({ id: line.id, description: line.description, quantity: line.quantity }))}
          locations={places}
          onClose={() => setDialog(null)}
          onConfirm={async (toLocationId, rows) => {
            const created = await returnDelivery(note.id, { to_location_id: toLocationId, lines: rows })
            toast(copy.sales.toast.returned)
            navigate(`${docPath('delivery')}/${created.id}`)
          }}
        />
      ) : null}
      {dialog === 'incident' ? (
        <IncidentDialog
          onClose={() => setDialog(null)}
          onConfirm={async (body) => {
            await createIncident(note.id, body)
            toast(copy.sales.toast.incident)
            setDialog(null)
          }}
        />
      ) : null}
      <DocumentModal me={me} source="delivery" id={opened.id} onClose={opened.close} onChanged={onReload} />
    </RecordFrame>
  )
}
