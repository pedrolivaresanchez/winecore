import { useEffect, useState, type ReactNode } from 'react'
import { Field } from '@/components/Field'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { ApiError, fieldError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { day } from '@/pages/facturas/format'
import { Alert, Input, Skeleton } from '@/ui'
import { openNumbering, proposalPath, type NumberingNeed, type NumberingProposal, type Series } from './api'

type Choice = 'holded' | 'fresh'

/**
 * Continue Holded's numbering or start the plan's series, for one entity, fiscal document and
 * year. The caller renders the submit button with `form={formId}`.
 */
export function NumberingChoice({
  need,
  formId,
  onBusy,
  onReady,
  onOpened,
}: {
  need: NumberingNeed
  formId: string
  onBusy: (busy: boolean) => void
  onReady?: (ready: boolean) => void
  onOpened: (series: Series | null) => void
}) {
  const proposal = useApi<NumberingProposal>(proposalPath(need))
  const [choice, setChoice] = useState<Choice>('holded')
  const [first, setFirst] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const data = proposal.data
  const holded = data?.holded ?? null

  useEffect(() => {
    setChoice(holded ? 'holded' : 'fresh')
    setFirst(holded ? String(holded.next_value) : '')
    setError(null)
  }, [holded])

  useEffect(() => {
    onReady?.(Boolean(data))
  }, [data, onReady])

  async function submit() {
    if (!data) return
    if (data.active) {
      onOpened(null)
      return
    }
    const typed = Number(first)
    const nextValue = choice === 'holded' && holded && Number.isInteger(typed) && typed !== holded.next_value ? typed : undefined
    onBusy(true)
    setError(null)
    try {
      onOpened(await openNumbering({ ...need, choice, next_value: nextValue }))
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'WC_ERROR', copy.api.generic))
    } finally {
      onBusy(false)
    }
  }

  if (proposal.loading && !data) return <Skeleton className="h-28 w-full" />
  if (proposal.error || !data) {
    return <Alert tone="danger">{proposal.error?.message ?? copy.error.load}</Alert>
  }

  const typedFirst = holded && /^\d+$/.test(first) ? `${holded.prefix}${first.padStart(holded.padding, '0')}` : holded?.first_number
  const firstError = fieldError(error, 'next_value')

  return (
    <form
      id={formId}
      data-screen="numeracion-eleccion"
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {data.active ? (
        <Alert tone="info">{fill(copy.numbering.active, { number: data.active.next_number })}</Alert>
      ) : (
        <>
          <Option
            name={`${formId}-opcion`}
            checked={choice === 'holded'}
            disabled={!holded}
            title={copy.numbering.holded}
            onPick={() => setChoice('holded')}
          >
            {holded ? (
              <>
                <span className="block">{fill(copy.numbering.holdedLast, { number: holded.last_number, date: day(holded.last_date) })}</span>
                <span className="block">
                  {`${fill(copy.numbering.range, { first: typedFirst ?? holded.first_number, limit: holded.limit_number })}${holded.verifactu ? ` ${copy.numbering.verifactu}` : ''}`}
                </span>
              </>
            ) : (
              copy.numbering.holdedNone
            )}
          </Option>
          {choice === 'holded' && holded ? (
            <div className="pl-10">
              <Field id={`${formId}-primero`} label={copy.numbering.firstNumber} hint={firstError ? undefined : copy.numbering.firstHint} error={firstError}>
                <Input
                  id={`${formId}-primero`}
                  size="sm"
                  className="w-32"
                  inputMode="numeric"
                  value={first}
                  invalid={Boolean(firstError)}
                  onChange={(event) => setFirst(event.target.value.replace(/\D/g, ''))}
                />
              </Field>
            </div>
          ) : null}
          <Option
            name={`${formId}-opcion`}
            checked={choice === 'fresh'}
            title={copy.numbering.fresh}
            onPick={() => setChoice('fresh')}
          >
            {`${fill(copy.numbering.range, { first: data.fresh.first_number, limit: data.fresh.limit_number })}${data.fresh.verifactu ? ` ${copy.numbering.verifactu}` : ''}`}
          </Option>
        </>
      )}
      {error && !firstError ? <Alert tone="danger">{error.message}</Alert> : null}
    </form>
  )
}

function Option({
  name,
  checked,
  disabled = false,
  title,
  onPick,
  children,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  title: string
  onPick: () => void
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-xl border px-3 py-2.5 has-focus-visible:shadow-(--shadow-focus)',
        disabled ? 'cursor-not-allowed border-border-subtle opacity-60' : 'cursor-pointer',
        !disabled && (checked ? 'border-ink-900 bg-fill-hover' : 'border-border-subtle hover:bg-fill-hover'),
      )}
    >
      <input
        type="radio"
        name={name}
        className="mt-0.5 size-4 shrink-0 accent-ink-900"
        checked={checked}
        disabled={disabled}
        onChange={onPick}
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-label font-medium text-ink-900">{title}</span>
        <span className="text-caption text-text-secondary">{children}</span>
      </span>
    </label>
  )
}
