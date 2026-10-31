import { useEffect, useState } from 'react'
import { ErrorState } from '@/components/ErrorState'
import { copy } from '@/i18n'
import { ApiError, isAbortError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'
import { Button, EmptyState, Skeleton } from '@/ui'
import { getDelivery, listAudit, listPendingDeliveries, resendDelivery } from '@/pages/facturas/api'
import { FactList } from '@/pages/facturas/chrome'
import { attemptLabel, deliveryLabel } from '@/pages/facturas/format'
import type { AuditItem, DeliveryPackage, DeliveryStatus } from '@/pages/facturas/types'

type Attempt = {
  attempt: number
  status: string
  at: string
}

export function DeliveryPanel({
  me,
  invoiceId,
  issued,
  onStatus,
}: {
  me: Me
  invoiceId: string
  issued: boolean
  onStatus: (status: DeliveryStatus | null) => void
}) {
  const [pack, setPack] = useState<DeliveryPackage | null>(null)
  const [status, setStatus] = useState<DeliveryStatus | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const canDeliver = allows(me, 'billing.deliver')

  useEffect(() => {
    if (!issued || !canDeliver) {
      setLoading(false)
      onStatus(null)
      return
    }
    const controller = new AbortController()
    let active = true
    setLoading(true)
    Promise.all([
      getDelivery(invoiceId, controller.signal).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }),
      listPendingDeliveries(controller.signal).catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return []
        throw err
      }),
      listAudit('billing.invoice_delivery', null, controller.signal).catch(() => ({ items: [] as AuditItem[] })),
    ])
      .then(([delivery, pending, audit]) => {
        if (!active) return
        const hit = pending.find((item) => item.invoice_id === invoiceId)
        const next = hit?.delivery_status ?? (delivery ? 'sent' : null)
        setPack(delivery)
        setStatus(next)
        onStatus(next)
        setAttempts(attemptsOf(audit.items, invoiceId, delivery, next))
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return
        setError(err instanceof ApiError ? err.message : copy.error.load)
        onStatus(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, canDeliver, invoiceId, issued, onStatus])

  async function resend() {
    setBusy(true)
    try {
      await resendDelivery(invoiceId)
      setAttempt((value) => value + 1)
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : copy.api.generic)
    } finally {
      setBusy(false)
    }
  }

  if (!canDeliver) return <EmptyState size="sm" title={copy.facturas.noDelivery} description={copy.facturas.noDeliveryHint} />
  if (!issued) return <EmptyState size="sm" title={copy.facturas.noDelivery} description={copy.facturas.noDeliveryHint} />
  if (loading) return <Skeleton className="h-40 w-full" />
  if (error && !pack) return <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} />
  if (!pack || !status) return <EmptyState size="sm" title={copy.facturas.noDelivery} description={copy.facturas.noDeliveryHint} />

  const canResend = status !== 'pending'

  return (
    <div className="grid gap-4">
      {error ? <ErrorState title={error} onRetry={() => setAttempt((value) => value + 1)} /> : null}
      <FactList
        rows={[
          { label: copy.facturas.delivery, value: deliveryLabel(status) },
          { label: copy.facturas.recipients, value: pack.to.length > 0 ? pack.to.join(' · ') : '—' },
          { label: copy.facturas.subject, value: pack.subject_es || '—' },
          { label: copy.facturas.attempts, value: attemptLabel(pack.attempt) },
        ]}
      />
      <section className="overflow-hidden rounded-2xl border border-border-subtle">
        <h2 className="border-b border-border-subtle px-4 py-2 text-caption text-text-tertiary">{copy.facturas.attempts}</h2>
        {attempts.length === 0 ? (
          <p className="px-4 py-3 text-label text-text-secondary">{copy.facturas.noHistory}</p>
        ) : (
          <ul>
            {attempts.map((row) => (
              <li key={`${row.attempt}-${row.at}`} className="flex items-baseline justify-between gap-3 border-b border-border-subtle px-4 py-2 last:border-b-0">
                <span className="text-label text-ink-900">
                  {attemptLabel(row.attempt)} · {deliveryLabel(asDelivery(row.status))}
                </span>
                <span className="text-caption text-text-tertiary">{formatDateTime(row.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canResend ? (
        <div className="flex justify-end">
          <Button type="button" variant="primary" size="sm" loading={busy} onClick={() => void resend()}>
            {copy.facturas.resend}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function asDelivery(status: string): DeliveryStatus | null {
  if (status === 'pending' || status === 'sent' || status === 'failed' || status === 'no_recipient') return status
  return null
}

function attemptsOf(
  items: AuditItem[],
  invoiceId: string,
  pack: DeliveryPackage | null,
  status: DeliveryStatus | null,
): Attempt[] {
  const rows: Attempt[] = []
  for (const item of items) {
    const invoice = item.changes.find((change) => change.field === 'invoice_id')
    if (String(invoice?.after ?? '') !== invoiceId) continue
    const attemptChange = item.changes.find((change) => change.field === 'attempt')
    const statusChange = item.changes.find((change) => change.field === 'status')
    rows.push({
      attempt: Number(attemptChange?.after ?? 0),
      status: String(statusChange?.after ?? ''),
      at: item.occurred_at,
    })
  }
  rows.sort((left, right) => left.attempt - right.attempt || left.at.localeCompare(right.at))
  if (pack && status) {
    const current = rows.find((row) => row.attempt === pack.attempt)
    if (current) current.status = status
    else rows.push({ attempt: pack.attempt, status, at: '' })
  }
  return rows
}
