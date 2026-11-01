import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import { acceptQuote, docPath, errorText, quoteToOrder, rejectQuote, sendQuote, type Quote } from '@/lib/sales'
import type { Me } from '@/lib/types'
import { issueInvoice, resendDelivery, validateInvoice } from '@/pages/facturas/api'
import { IssueDialog } from '@/pages/facturas/dialogs'
import { entityLabel, isOpen, money } from '@/pages/facturas/format'
import type { Invoice, ValidationResult } from '@/pages/facturas/types'
import { ReasonDialog } from '@/pages/ventas/dialogs'
import { Alert, Button, useToast } from '@/ui'

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : copy.api.generic
}

export function InvoiceActions({ me, invoice, onChanged }: { me: Me; invoice: Invoice; onChanged: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [issueOpen, setIssueOpen] = useState(false)
  const [issues, setIssues] = useState<ValidationResult | null>(null)
  const issueKey = useRef('')
  const open = isOpen(invoice.status)
  const issued = invoice.status === 'issued'
  const canIssue = open && allows(me, 'billing.issue')
  const canSend = issued && allows(me, 'billing.deliver')
  const canRectify = issued && allows(me, 'billing.write')
  if (!canIssue && !canSend && !canRectify) return null

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
      toast(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  async function confirmIssue() {
    setBusy(true)
    try {
      const result = await issueInvoice(invoice.id, issueKey.current || crypto.randomUUID())
      toast(result.number ? `${copy.facturas.issuedToast} ${result.number}` : copy.facturas.issuedToast)
      setIssueOpen(false)
      setIssues(null)
      onChanged()
    } catch (error: unknown) {
      toast(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    setBusy(true)
    try {
      await resendDelivery(invoice.id)
      toast(copy.documents.sentToast)
      onChanged()
    } catch (error: unknown) {
      toast(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {canIssue ? (
          <Button type="button" variant="primary" size="sm" loading={busy && !issueOpen} onClick={() => void preflight()}>
            {copy.facturas.issue}
          </Button>
        ) : null}
        {canSend ? (
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void send()}>
            {copy.documents.send}
          </Button>
        ) : null}
        {canRectify ? (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => navigate(`/facturas/${invoice.id}/rectificar`)}>
            {copy.documents.rectify}
          </Button>
        ) : null}
      </div>
      {issues && issues.errors.length > 0 ? (
        <Alert tone="danger">
          <ul className="grid gap-1 text-label">
            {issues.errors.map((issue) => (
              <li key={`${issue.field ?? ''}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <IssueDialog
        open={issueOpen}
        entity={entityLabel(invoice.entity_code)}
        total={money(invoice.total)}
        busy={busy}
        onClose={() => setIssueOpen(false)}
        onConfirm={() => void confirmIssue()}
      />
    </div>
  )
}

export function QuoteActions({ me, quote, onChanged }: { me: Me; quote: Quote; onChanged: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const draft = quote.status === 'draft'
  const open = draft || quote.status === 'sent'
  const canOrder = open || quote.status === 'accepted'
  if (!allows(me, 'sales.write') || !canOrder) return null

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

  return (
    <div className="flex flex-wrap gap-1.5">
      {draft ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={busy}
          onClick={() => void run(async () => { await sendQuote(quote.id); toast(copy.sales.toast.sent); onChanged() })}
        >
          {copy.documents.send}
        </Button>
      ) : null}
      {open ? (
        <Button
          type="button"
          variant={draft ? 'secondary' : 'primary'}
          size="sm"
          loading={busy}
          onClick={() => void run(async () => { await acceptQuote(quote.id); toast(copy.sales.toast.quoteAccepted); onChanged() })}
        >
          {copy.sales.accept}
        </Button>
      ) : null}
      {open ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setRejecting(true)}>
          {copy.sales.reject}
        </Button>
      ) : null}
      <Button
        type="button"
        variant={open ? 'secondary' : 'primary'}
        size="sm"
        loading={busy}
        onClick={() =>
          void run(async () => {
            const order = await quoteToOrder(quote.id)
            toast(copy.sales.toast.accepted)
            onChanged()
            navigate(`${docPath('order')}/${order.id}`)
          })
        }
      >
        {copy.documents.toOrder}
      </Button>
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
            onChanged()
          }}
        />
      ) : null}
    </div>
  )
}
