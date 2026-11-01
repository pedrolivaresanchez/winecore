import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Alert, Button, DatePicker, Input, MenuItem, Select, Skeleton, Textarea, useToast } from '@/ui'
import { discardInvoice, issueInvoice, patchInvoice, validateInvoice, voidInvoice } from '@/pages/facturas/api'
import {
  FactList,
  InvoiceBadges,
  LineTable,
  MoreMenu,
  RecordFrame,
  TaxBreakdown,
  Totals,
} from '@/pages/facturas/chrome'
import { DeliveryPanel } from '@/pages/facturas/DeliveryPanel'
import { IssueDialog, VoidDialog } from '@/pages/facturas/dialogs'
import { NumberingStep } from '@/pages/facturas/NumberingStep'
import { numberingNeed } from '@/pages/ajustes/numeracion/api'
import { DATE_LABELS, day, daysLabel, draftsFrom, entityLabel, invoiceTitle, isOpen, kindLabel, linePayload, methodLabel, money, paymentLabel } from '@/pages/facturas/format'
import { LineEditor } from '@/pages/facturas/lines'
import type { AuditItem, DeliveryStatus, Invoice, LineDraft, ValidationResult, VoidReason } from '@/pages/facturas/types'
import { RecordSkeleton } from '@/components/RecordSkeleton'
import { ShippingFields } from '@/pages/ventas/shipping'
import { referencesPayload, shipToDraftOf, shipToPayload, shippingRows, type ShipToDraft } from '@/lib/shipping'
import { PdfActions, PdfPreview } from '@/pages/documents/PdfPreview'
import { usePdf } from '@/pages/documents/pdf'

const TABS = [
  { id: 'factura', label: copy.facturas.lines },
  { id: 'pdf', label: copy.facturas.pdf },
  { id: 'envio', label: copy.facturas.sendTab },
  { id: 'historial', label: copy.facturas.history },
] as const

type TabId = (typeof TABS)[number]['id']

export function InvoicePage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const invoice = useApi<Invoice>(id ? `/v1/invoices/${id}` : null)
  useChromeTitle(invoice.data ? invoiceTitle(invoice.data.status, invoice.data.number) : copy.facturas.title)
  if (!allows(me, 'billing.read')) return <NoPermission />
  if (invoice.loading && !invoice.data) {
    return <RecordSkeleton />
  }
  if (invoice.error || !invoice.data) {
    return (
      <div className="p-6">
        <ErrorState title={`${copy.error.load} (${invoice.error?.code ?? 'WC_ERROR'})`} detail={invoice.error?.message} onRetry={invoice.reload} />
      </div>
    )
  }
  return <Loaded me={me} invoice={invoice.data} onReload={invoice.reload} />
}

function Loaded({ me, invoice, onReload }: { me: Me; invoice: Invoice; onReload: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const desktop = useMinWidth(768)
  const canWrite = allows(me, 'billing.write')
  const canIssue = allows(me, 'billing.issue')
  const canVoid = allows(me, 'billing.void')
  const [tab, setTab] = useState<TabId>('factura')
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null)
  const onStatus = useCallback((status: DeliveryStatus | null) => setDelivery(status), [])
  const [editing, setEditing] = useState(false)
  const [lines, setLines] = useState<LineDraft[]>(() => draftsFrom(invoice.lines))
  const [description, setDescription] = useState(invoice.description ?? '')
  const [language, setLanguage] = useState(invoice.language === 'en' ? 'en' : 'es')
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [operationDate, setOperationDate] = useState<string | null>(invoice.operation_date)
  const [shipTo, setShipTo] = useState<ShipToDraft>(() => shipToDraftOf(invoice.ship_to))
  const [references, setReferences] = useState(invoice.customer_references ?? '')
  const [issues, setIssues] = useState<ValidationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const issueKey = useRef('')
  const open = isOpen(invoice.status)
  const issued = invoice.status === 'issued' || invoice.status === 'voided'
  const history = useApi<{ items: AuditItem[]; next_cursor: string | null }>(
    tab === 'historial' ? `/v1/audit?table=billing.invoice&row_id=${invoice.id}&limit=50` : null,
  )

  useEffect(() => {
    setLines(draftsFrom(invoice.lines))
    setDescription(invoice.description ?? '')
    setLanguage(invoice.language === 'en' ? 'en' : 'es')
    setNotes(invoice.notes ?? '')
    setOperationDate(invoice.operation_date)
    setShipTo(shipToDraftOf(invoice.ship_to))
    setReferences(invoice.customer_references ?? '')
    setEditing(false)
  }, [invoice])

  async function save() {
    setBusy(true)
    try {
      await patchInvoice(invoice.id, invoice.updated_at, {
        description: description.trim(),
        language,
        notes: notes.trim() || null,
        operation_date: operationDate,
        ship_to: shipToPayload(shipTo),
        customer_references: referencesPayload(references),
        lines: linePayload(lines),
      })
      toast(copy.facturas.saved)
      setEditing(false)
      onReload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  async function validateOnly() {
    setBusy(true)
    try {
      const result = await validateInvoice(invoice.id)
      setIssues(result)
      if (result.errors.length === 0) toast(copy.facturas.validated)
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  async function preflight() {
    setBusy(true)
    try {
      const result = await validateInvoice(invoice.id)
      setIssues(result)
      if (result.errors.length === 0) {
        issueKey.current = crypto.randomUUID()
        setIssueOpen(true)
      }
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  async function confirmIssue() {
    setBusy(true)
    try {
      const issuedInvoice = await issueInvoice(invoice.id, issueKey.current || crypto.randomUUID())
      toast(issuedInvoice.number ? `${copy.facturas.issuedToast} ${issuedInvoice.number}` : copy.facturas.issuedToast)
      setIssueOpen(false)
      setIssues(null)
      onReload()
    } catch (error: unknown) {
      if (error instanceof ApiError && error.code === 'WC_INV_NUMBERING') {
        setIssueOpen(false)
        setIssues({ errors: [{ code: error.code, message: error.message, details: error.details }], warnings: [] })
        return
      }
      toast(error instanceof ApiError ? error.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  async function confirmVoid(reason: VoidReason, detail: string) {
    setBusy(true)
    try {
      const result = await voidInvoice(invoice.id, reason, detail)
      toast(result.status === 'voided' ? copy.facturas.voidedToast : copy.facturas.voidPending)
      setVoidOpen(false)
      onReload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDiscard() {
    setBusy(true)
    try {
      await discardInvoice(invoice.id, copy.facturas.discard)
      toast(copy.facturas.discardedToast)
      setDiscardOpen(false)
      onReload()
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  const errors = issues?.errors ?? []
  const numbering = errors.every((issue) => issue.code === 'WC_INV_NUMBERING')
    ? numberingNeed(errors.find((issue) => issue.code === 'WC_INV_NUMBERING')?.details)
    : null
  const blocking = numbering ? [] : errors
  const snapshot = invoice.customer_snapshot
  const facts: { label: string; value: ReactNode }[] = [
    { label: copy.facturas.entity, value: entityLabel(invoice.entity_code) },
    { label: copy.facturas.customer, value: invoice.customer_name || '—' },
    { label: copy.facturas.nif, value: snapshot?.tax_id || '—' },
    { label: copy.facturas.date, value: day(invoice.issue_date) },
    { label: copy.facturas.operationDate, value: day(invoice.operation_date) },
    { label: copy.facturas.language, value: invoice.language === 'en' ? copy.facturas.english : copy.facturas.spanish },
    { label: copy.facturas.description, value: invoice.description || '—' },
    { label: copy.facturas.payment, value: paymentLabel(invoice.payment_status) },
    { label: copy.facturas.method, value: methodLabel(invoice.payment_method) },
    { label: copy.facturas.terms, value: invoice.payment_terms_days == null ? '—' : daysLabel(invoice.payment_terms_days) },
    { label: copy.facturas.due, value: invoice.dues.map((due) => `${day(due.due_date)} · ${money(due.amount)}`).join(' · ') || '—' },
    { label: copy.facturas.paid, value: money(invoice.amount_paid) },
  ]
  if (invoice.rectification_kind) {
    facts.push({ label: copy.facturas.mode, value: kindLabel(invoice.rectification_kind) })
  }
  for (const row of invoice.rectifications) {
    facts.push({ label: copy.facturas.rectifies, value: `${row.number} · ${day(row.issue_date)}` })
  }
  if (invoice.void_reason) facts.push({ label: copy.facturas.voidReason, value: invoice.void_reason })
  if (invoice.notes) facts.push({ label: copy.facturas.notes, value: invoice.notes })
  facts.push(...shippingRows(invoice.ship_to, invoice.customer_references))

  return (
    <>
      <RecordFrame
        title={invoiceTitle(invoice.status, invoice.number)}
        subtitle={invoice.customer_name || undefined}
        badges={<InvoiceBadges invoice={invoice} delivery={delivery} />}
        tab={tab}
        onTab={(id) => setTab(id as TabId)}
        tabs={TABS.map((item) => ({ id: item.id, label: item.label }))}
        actions={
          <>
            {editing ? (
              <>
                <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void save()}>
                  {copy.facturas.save}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  {copy.facturas.cancel}
                </Button>
              </>
            ) : (
              <>
                {open && canWrite && desktop ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setLines(draftsFrom(invoice.lines)); setEditing(true); setTab('factura') }}>
                    {copy.facturas.edit}
                  </Button>
                ) : null}
                {open && canWrite && desktop ? (
                  <Button type="button" variant="secondary" size="sm" loading={busy && !issueOpen} onClick={() => void validateOnly()}>
                    {copy.facturas.validate}
                  </Button>
                ) : null}
                {open && canIssue ? (
                  <Button type="button" variant="primary" size="sm" loading={busy && !issueOpen} onClick={() => void preflight()}>
                    {copy.facturas.issue}
                  </Button>
                ) : null}
                {invoice.status === 'issued' && canWrite && desktop ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/facturas/${invoice.id}/rectificar`)}>
                    {copy.facturas.rectify}
                  </Button>
                ) : null}
                {issued ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setTab('pdf')}>
                    {copy.facturas.pdf}
                  </Button>
                ) : null}
              </>
            )}
            {(open && canWrite) || (invoice.status === 'issued' && (canWrite || canVoid)) ? (
              <MoreMenu>
                {(close) => (
                  <>
                    {open && canWrite && !desktop ? (
                      <MenuItem onClick={() => { close(); setEditing(true); setTab('factura') }}>{copy.facturas.edit}</MenuItem>
                    ) : null}
                    {open && canWrite && !desktop ? (
                      <MenuItem onClick={() => { close(); void validateOnly() }}>{copy.facturas.validate}</MenuItem>
                    ) : null}
                    {open && canWrite ? (
                      <MenuItem tone="danger" onClick={() => { close(); setDiscardOpen(true) }}>{copy.facturas.discard}</MenuItem>
                    ) : null}
                    {invoice.status === 'issued' && canWrite ? (
                      <MenuItem onClick={() => { close(); navigate(`/facturas/${invoice.id}/rectificar`) }}>{copy.facturas.rectify}</MenuItem>
                    ) : null}
                    {invoice.status === 'issued' && canVoid ? (
                      <MenuItem tone="danger" onClick={() => { close(); setVoidOpen(true) }}>{copy.facturas.void}</MenuItem>
                    ) : null}
                  </>
                )}
              </MoreMenu>
            ) : null}
          </>
        }
      >
        {tab === 'factura' ? (
          <div className="grid gap-4">
            {blocking.length > 0 ? (
              <Alert tone="danger">
                <ul className="grid gap-1 text-label">
                  {blocking.map((issue) => (
                    <li key={`${issue.field ?? ''}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {numbering && canIssue ? <NumberingStep me={me} need={numbering} onOpened={() => void preflight()} /> : null}
            {issues && issues.warnings.length > 0 ? (
              <Alert tone="warning">
                <ul className="grid gap-1 text-label">
                  {issues.warnings.map((issue) => (
                    <li key={`${issue.field ?? ''}-${issue.message}`}>{issue.message}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {editing ? (
              <div className="grid gap-3">
                <Field id="descripcion-factura" label={copy.facturas.description}>
                  <Input id="descripcion-factura" size="sm" value={description} onChange={(event) => setDescription(event.target.value)} />
                </Field>
                <Field id="idioma-factura" label={copy.facturas.language}>
                  <Select id="idioma-factura" size="sm" value={language} onChange={(event) => setLanguage(event.target.value)}>
                    <option value="es">{copy.facturas.spanish}</option>
                    <option value="en">{copy.facturas.english}</option>
                  </Select>
                </Field>
                <Field id="operacion-factura" label={copy.facturas.operationDate}>
                  <DatePicker value={operationDate} labels={DATE_LABELS} onChange={setOperationDate} />
                </Field>
                <Field id="notas-factura" label={copy.facturas.notes}>
                  <Textarea id="notas-factura" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
                <ShippingFields
                  idPrefix="factura"
                  shipTo={shipTo}
                  onShipTo={setShipTo}
                  references={references}
                  onReferences={setReferences}
                />
                <LineEditor lines={lines} onChange={setLines} />
              </div>
            ) : (
              <>
                <LineTable lines={invoice.lines} />
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="grid gap-4">
                    <FactList rows={facts} />
                    <TaxBreakdown invoice={invoice} />
                  </div>
                  <Totals invoice={invoice} />
                </div>
              </>
            )}
          </div>
        ) : null}
        {tab === 'pdf' ? <PdfPane id={invoice.id} issued={issued} number={invoice.number} /> : null}
        <div className={tab === 'envio' ? 'block' : 'hidden'}>
          <DeliveryPanel me={me} invoiceId={invoice.id} issued={invoice.status === 'issued'} onStatus={onStatus} />
        </div>
        {tab === 'historial' ? <History items={history.data?.items ?? []} loading={history.loading} error={history.error?.message} onRetry={history.reload} /> : null}
      </RecordFrame>
      <IssueDialog
        open={issueOpen}
        entity={entityLabel(invoice.entity_code)}
        total={money(invoice.total)}
        busy={busy}
        onClose={() => setIssueOpen(false)}
        onConfirm={() => void confirmIssue()}
      />
      <VoidDialog open={voidOpen} busy={busy} onClose={() => setVoidOpen(false)} onConfirm={(reason, detail) => void confirmVoid(reason, detail)} />
      <ConfirmDialog
        open={discardOpen}
        title={copy.facturas.discard}
        body={invoice.customer_name || copy.facturas.draft}
        confirmLabel={copy.facturas.discard}
        danger
        busy={busy}
        onClose={() => setDiscardOpen(false)}
        onConfirm={() => void confirmDiscard()}
      />
    </>
  )
}

function PdfPane({ id, issued, number }: { id: string; issued: boolean; number: string | null }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pdf = usePdf(issued ? `/v1/invoices/${id}/pdf` : null, number ? `${number}.pdf` : 'factura.pdf')

  if (!issued) return <p className="text-label text-text-secondary">{copy.facturas.noPdf}</p>

  return (
    <div className="grid gap-3">
      <PdfActions pdf={pdf} frameRef={frameRef} className="justify-end" />
      <div className="h-[70vh] overflow-hidden rounded-2xl border border-border-subtle bg-surface">
        <PdfPreview pdf={pdf} title={copy.facturas.pdf} frameRef={frameRef} className="h-full" />
      </div>
    </div>
  )
}

function History({
  items,
  loading,
  error,
  onRetry,
}: {
  items: AuditItem[]
  loading: boolean
  error?: string
  onRetry: () => void
}) {
  if (loading) return <Skeleton className="h-24 w-full" />
  if (error) return <ErrorState title={error} onRetry={onRetry} />
  if (items.length === 0) return <p className="text-label text-text-secondary">{copy.facturas.noHistory}</p>
  return (
    <ul className="overflow-hidden rounded-2xl border border-border-subtle">
      {items.map((item) => (
        <li key={item.id} className="grid gap-0.5 border-b border-border-subtle px-4 py-2 last:border-b-0">
          <p className="text-label text-ink-900">{item.action}</p>
          <p className="text-caption text-text-tertiary">
            {item.actor.display_name} · {formatDateTime(item.occurred_at)}
          </p>
        </li>
      ))}
    </ul>
  )
}
