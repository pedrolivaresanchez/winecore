import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Field } from '@/components/Field'
import { NoPermission } from '@/components/NoPermission'
import { useApi } from '@/hooks/use-api'
import { useMinWidth } from '@/hooks/use-media'
import { copy } from '@/i18n'
import { ApiError } from '@/lib/api'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Button, Checkbox, EmptyState, InfoTip, Input, Skeleton } from '@/ui'
import { cn } from '@/lib/cn'
import { createInvoice } from '@/pages/facturas/api'
import { BackLink } from '@/pages/facturas/chrome'
import { draftsFrom, invoiceTitle, linePayload, stepLabel } from '@/pages/facturas/format'
import { LineEditor } from '@/pages/facturas/lines'
import type { Invoice, LineDraft } from '@/pages/facturas/types'

const CAUSES = [
  { id: 'R4', label: copy.facturas.r4 },
  { id: 'R1', label: copy.facturas.r1 },
  { id: 'R2', label: copy.facturas.r2 },
  { id: 'R3', label: copy.facturas.r3 },
] as const

type Cause = (typeof CAUSES)[number]['id']
type Mode = 'I' | 'S'

export function RectifyPage({ me }: { me: Me }) {
  const { id = '' } = useParams()
  const invoice = useApi<Invoice>(id ? `/v1/invoices/${id}` : null)
  useChromeTitle(copy.facturas.rectify)
  const desktop = useMinWidth(768)
  if (!allows(me, 'billing.write')) return <NoPermission />
  if (!desktop) {
    return (
      <div data-screen="facturas-rectificar" className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
          <BackLink />
          <span className="text-label text-text-tertiary">{copy.facturas.title}</span>
        </header>
        <div className="p-4">
          <EmptyState size="sm" title={copy.facturas.desktopOnly} description={copy.facturas.desktopHint} />
        </div>
      </div>
    )
  }
  if (invoice.loading && !invoice.data) {
    return (
      <div aria-busy="true" className="grid gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (invoice.error || !invoice.data || invoice.data.status !== 'issued') {
    return (
      <div className="p-6">
        <ErrorState
          title={`${copy.error.load} (${invoice.error?.code ?? 'WC_ERROR'})`}
          detail={invoice.error?.message}
          onRetry={invoice.reload}
        />
      </div>
    )
  }
  return <Wizard invoice={invoice.data} />
}

function Wizard({ invoice }: { invoice: Invoice }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [cause, setCause] = useState<Cause>('R4')
  const [mode, setMode] = useState<Mode>('I')
  const [lines, setLines] = useState<LineDraft[]>(() => negate(draftsFrom(invoice.lines)))
  const [noReturn, setNoReturn] = useState(true)
  const [returnNote, setReturnNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const title = invoiceTitle(invoice.status, invoice.number)

  function chooseMode(next: Mode) {
    setMode(next)
    setLines(next === 'I' ? negate(draftsFrom(invoice.lines)) : draftsFrom(invoice.lines))
  }

  async function submit() {
    setError(null)
    const reason = CAUSES.find((item) => item.id === cause)?.label ?? cause
    const note = cause === 'R4'
      ? noReturn
        ? copy.facturas.noReturn
        : returnNote.trim()
          ? `${copy.facturas.returnNote} ${returnNote.trim()}`
          : undefined
      : undefined
    setSaving(true)
    try {
      const created = await createInvoice({
        legal_entity_id: invoice.legal_entity_id,
        customer_id: invoice.customer_id ?? undefined,
        invoice_type: cause,
        rectification_kind: mode,
        reason,
        description: reason,
        language: invoice.language === 'en' ? 'en' : 'es',
        notes: note,
        lines: linePayload(lines),
        rectifies: [{ invoice_id: invoice.id }],
      })
      navigate(`/facturas/${created.id}`)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-screen="facturas-rectificar" className="min-h-0 flex-1 overflow-y-auto">
      <header className="flex h-11 items-center gap-2 border-b border-border-subtle px-4">
        <BackLink />
        <span className="min-w-0 truncate text-label text-text-tertiary">{title}</span>
      </header>
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-6 md:px-8">
        <header className="flex items-center gap-2">
          <h1 className="text-heading font-medium tracking-tight text-ink-900">{copy.facturas.rectify}</h1>
          <InfoTip label={copy.facturas.mode}>{copy.facturas.diffHint}</InfoTip>
        </header>
        <p className="text-caption text-text-tertiary">{stepLabel(step)}</p>
        {step === 1 ? (
          <div className="grid gap-2" role="radiogroup" aria-label={copy.facturas.cause}>
            {CAUSES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={cause === item.id}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-label outline-none focus-visible:shadow-(--shadow-focus)',
                  cause === item.id ? 'border-ink-900 bg-fill-selected text-ink-900' : 'border-border-subtle text-ink-900 hover:bg-fill-hover',
                )}
                onClick={() => setCause(item.id)}
              >
                {item.label}
                <span className="ml-2 text-caption text-text-tertiary">{item.id}</span>
              </button>
            ))}
          </div>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-2" role="radiogroup" aria-label={copy.facturas.mode}>
            {(['I', 'S'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={mode === item}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-label outline-none focus-visible:shadow-(--shadow-focus)',
                  mode === item ? 'border-ink-900 bg-fill-selected text-ink-900' : 'border-border-subtle text-ink-900 hover:bg-fill-hover',
                )}
                onClick={() => chooseMode(item)}
              >
                {item === 'I' ? copy.facturas.differences : copy.facturas.substitution}
              </button>
            ))}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="grid gap-4">
            <LineEditor lines={lines} onChange={setLines} />
            {cause === 'R4' ? (
              <div className="grid gap-3">
                <Checkbox checked={noReturn} onChange={setNoReturn} label={copy.facturas.noReturn} />
                {noReturn ? null : (
                  <Field id="albaran-devolucion" label={copy.facturas.returnNote}>
                    <Input id="albaran-devolucion" size="sm" value={returnNote} onChange={(event) => setReturnNote(event.target.value)} />
                  </Field>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-label text-danger-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-1.5">
          {step > 1 ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setStep((value) => value - 1)}>
              {copy.facturas.back}
            </Button>
          ) : null}
          {step < 3 ? (
            <Button type="button" variant="primary" size="sm" onClick={() => setStep((value) => value + 1)}>
              {copy.facturas.next}
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" loading={saving} onClick={() => void submit()}>
              {copy.facturas.create}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function negate(lines: LineDraft[]): LineDraft[] {
  return lines.map((line) => {
    const value = Number(line.quantity)
    if (!Number.isFinite(value)) return line
    return { ...line, quantity: String(-Math.abs(value)) }
  })
}
