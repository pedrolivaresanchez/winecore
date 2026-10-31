import { useNavigate } from 'react-router-dom'
import { useChromeTitle } from '@/app/shell/shell-context'
import { ErrorState } from '@/components/ErrorState'
import { Button, Card, Skeleton } from '@/ui'
import { useApi } from '@/hooks/use-api'
import { copy, fill } from '@/i18n'
import { contactQuery, type AuditEvent, type AuditPage, type ContactPage } from '@/lib/contacts'
import { formatDateTime, formatInteger } from '@/lib/format'
import { allows } from '@/lib/permissions'
import type { Me } from '@/lib/types'

const ACTIONS: Record<string, string> = {
  create: 'creó',
  update: 'cambió',
  archive: 'archivó',
  unarchive: 'reactivó',
}

function subjectOf(event: AuditEvent): string {
  const named = event.changes.find((change) => change.field === 'legal_name' || change.field === 'trade_name')
  const value = named?.after ?? named?.before
  if (typeof value === 'string' && value.trim()) return value
  return 'un contacto'
}

export function Panel({ me }: { me: Me }) {
  useChromeTitle(copy.panel.title)
  const navigate = useNavigate()
  const name = me.display_name.trim() || me.email
  const canWrite = allows(me, 'contacts.write')
  const canRead = allows(me, 'contacts.read')
  const all = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, archived: false }) : null)
  const customers = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, role: 'customer', archived: false }) : null)
  const suppliers = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, role: 'supplier', archived: false }) : null)
  const recent = useApi<AuditPage>(canRead ? '/v1/audit?table=party.contact&limit=5' : null)
  const ready = !canRead || (!all.loading && !customers.loading && !suppliers.loading && !recent.loading)

  return (
    <div data-screen={ready ? 'panel' : 'panel-cargando'} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8">
        <header>
          <h1 className="text-heading font-medium tracking-[-0.02em] text-ink-900">{copy.panel.title}</h1>
          <p className="mt-1 text-label text-text-secondary">{fill(copy.panel.hello, { name })}</p>
        </header>

        {canWrite ? (
          <section className="grid gap-3">
            <h2 className="text-label font-medium text-ink-900">{copy.panel.quick}</h2>
            <div>
              <Button type="button" variant="primary" size="sm" onClick={() => navigate('/contactos/nuevo')}>
                {copy.panel.newContact}
              </Button>
            </div>
          </section>
        ) : null}

        {canRead ? (
          <section className="grid gap-3">
            <h2 className="text-label font-medium text-ink-900">{copy.panel.kpis}</h2>
            {all.error ? (
              <ErrorState title={`${copy.error.load} (${all.error.code})`} detail={all.error.message} onRetry={all.reload} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile label="Contactos" value={all.data?.total} loading={all.loading} onOpen={() => navigate('/contactos')} />
                <Tile
                  label={copy.panel.customers}
                  value={customers.data?.total}
                  loading={customers.loading}
                  onOpen={() => navigate('/contactos?role=customer')}
                />
                <Tile
                  label={copy.panel.suppliers}
                  value={suppliers.data?.total}
                  loading={suppliers.loading}
                  onOpen={() => navigate('/contactos?role=supplier')}
                />
              </div>
            )}
          </section>
        ) : null}

        {canRead ? (
          <section className="grid gap-3">
            <h2 className="text-label font-medium text-ink-900">{copy.panel.recent}</h2>
            {recent.loading ? (
              <div className="grid gap-2" aria-busy="true">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : recent.error ? (
              <ErrorState title={`${copy.error.load} (${recent.error.code})`} detail={recent.error.message} onRetry={recent.reload} />
            ) : (recent.data?.items.length ?? 0) === 0 ? (
              <p className="text-label text-text-tertiary">{copy.panel.recentEmpty}</p>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-(--shadow-card)">
                {recent.data?.items.map((event) => (
                  <li key={event.id} className="border-b border-border-subtle last:border-b-0">
                    {event.row_id ? (
                      <button
                        type="button"
                        className="block w-full px-4 py-3 text-left hover:bg-fill-hover"
                        onClick={() => navigate(`/contactos/${event.row_id}`)}
                      >
                        <EventLine event={event} />
                      </button>
                    ) : (
                      <div className="px-4 py-3">
                        <EventLine event={event} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function EventLine({ event }: { event: AuditEvent }) {
  return (
    <>
      <p className="text-label text-ink-900">
        <span className="font-medium">{event.actor.display_name}</span> {ACTIONS[event.action] ?? event.action}{' '}
        {subjectOf(event)}
      </p>
      <p className="text-caption text-text-tertiary">{formatDateTime(event.occurred_at)}</p>
    </>
  )
}

function Tile({
  label,
  value,
  loading,
  onOpen,
}: {
  label: string
  value?: number
  loading: boolean
  onOpen: () => void
}) {
  return (
    <button type="button" onClick={onOpen} className="text-left">
      <Card className="h-full px-4 py-3 shadow-(--shadow-surface)">
        <p className="text-caption text-text-tertiary">{label}</p>
        <p className="mt-1 text-heading font-medium tabular-nums text-ink-900">
          {loading || value == null ? '…' : formatInteger(value)}
        </p>
      </Card>
    </button>
  )
}
