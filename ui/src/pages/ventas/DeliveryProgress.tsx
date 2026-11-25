import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { copy } from '@/i18n'
import { allows } from '@/lib/permissions'
import { deliverDelivery, errorText, issueDelivery, type DeliveryNote } from '@/lib/sales'
import type { Me } from '@/lib/types'
import { Check } from '@/ui/icons'
import { Button, useToast } from '@/ui'
import { cn } from '@/lib/cn'
import { iconStroke } from '@/lib/motion'
import { DocLink } from '@/pages/ventas/chrome'
import { deliveryPrimaryAction, deliveryStage, deliverySteps } from '@/pages/ventas/delivery-stage'
import { openInvoiceFromNotes } from '@/pages/ventas/invoice-from-notes'

export function DeliveryStageBar({ note }: { note: DeliveryNote }) {
  const stage = deliveryStage({
    status: note.status,
    invoicingStatus: note.invoicing_status,
    kind: note.kind,
    customerId: note.customer_id,
  })
  const steps = deliverySteps(note.status)
  const issued = note.invoice?.status === 'issued' && note.invoice.number
  return (
    <nav aria-label={copy.sales.stageLabel} data-delivery-stage={stage.id} className="rounded-2xl border border-border-subtle bg-surface px-4 py-3">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const done = stage.index > index
          const current = stage.index === index
          const reached = done || current
          return (
            <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2" aria-current={current ? 'step' : undefined}>
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full text-caption',
                  reached ? 'bg-ink-900 text-ink-0' : 'border border-border text-text-tertiary',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={iconStroke} /> : index + 1}
              </span>
              <span className={cn('truncate text-caption', current ? 'font-medium text-ink-900' : 'text-text-tertiary')}>
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span className={cn('h-px min-w-2 flex-1', stage.index > index ? 'bg-ink-900' : 'bg-border')} />
              ) : null}
            </li>
          )
        })}
      </ol>
      {stage.id === 'invoiced' && issued && note.invoice ? (
        <p className="mt-3 border-t border-border-subtle pt-3 text-label text-text-secondary">
          {copy.sales.invoiceOf}{' '}
          <DocLink to={`/facturas/${note.invoice.id}`}>{note.invoice.number}</DocLink>
        </p>
      ) : null}
    </nav>
  )
}

export function DeliveryPrimaryButton({ me, note, onDone }: { me: Me; note: DeliveryNote; onDone: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmIssue, setConfirmIssue] = useState(false)
  const action = deliveryPrimaryAction(stageInput(note), {
    write: allows(me, 'sales.write'),
    billing: allows(me, 'billing.write'),
  })
  if (!action) return null

  async function run(task: () => Promise<void>) {
    setBusy(true)
    try {
      await task()
    } catch (error: unknown) {
      toast(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const label = action === 'issue' ? copy.sales.issue : action === 'deliver' ? copy.sales.markDelivered : copy.sales.invoiceNote

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        loading={busy}
        onClick={() => {
          if (action === 'issue') {
            setConfirmIssue(true)
            return
          }
          if (action === 'deliver') {
            void run(async () => {
              await deliverDelivery(note.id)
              toast(copy.sales.toast.delivered)
              onDone()
            })
            return
          }
          void run(async () => {
            const id = await openInvoiceFromNotes({
              noteIds: [note.id],
              legalEntityId: note.legal_entity_id,
              customerId: note.customer_id ?? undefined,
              existingInvoiceId: note.invoice && note.invoice.status !== 'issued' ? note.invoice.id : null,
            })
            if (!note.invoice || note.invoice.id !== id) toast(copy.facturas.created)
            navigate(`/facturas/${id}`)
          })
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={confirmIssue}
        title={copy.sales.issueTitle}
        body={copy.sales.issueBody}
        confirmLabel={copy.sales.issue}
        busy={busy}
        onClose={() => { if (!busy) setConfirmIssue(false) }}
        onConfirm={() => {
          setBusy(true)
          void issueDelivery(note.id)
            .then(() => {
              toast(copy.sales.toast.issued)
              setConfirmIssue(false)
              onDone()
            })
            .catch((error: unknown) => toast(errorText(error)))
            .finally(() => setBusy(false))
        }}
      />
    </>
  )
}

function stageInput(note: DeliveryNote) {
  return {
    status: note.status,
    invoicingStatus: note.invoicing_status,
    kind: note.kind,
    customerId: note.customer_id,
  }
}
