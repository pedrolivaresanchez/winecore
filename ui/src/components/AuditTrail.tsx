import { ErrorState } from '@/components/ErrorState'
import { EmptyState, Skeleton } from '@/ui'
import { formatDateTime } from '@/lib/format'
import type { AuditEvent } from '@/lib/contacts'

const ACTIONS: Record<string, string> = {
  create: 'Alta',
  update: 'Cambio',
  archive: 'Archivo',
  unarchive: 'Recuperación',
}

const FIELDS: Record<string, string> = {
  legal_name: 'Nombre fiscal',
  trade_name: 'Nombre comercial',
  tax_id: 'NIF',
  country_code: 'País',
  email: 'Correo',
  phone: 'Teléfono',
  notes: 'Notas',
  language: 'Idioma',
  vat_regime: 'Régimen de IVA',
  payment_method: 'Forma de pago',
  payment_terms_days: 'Días de pago',
  is_customer: 'Cliente',
  is_supplier: 'Proveedor',
  is_carrier: 'Transportista',
  is_logistics_operator: 'Operador logístico',
}

function show(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  return '—'
}

export function AuditTrail({
  items,
  loading,
  error,
  onRetry,
}: {
  items: AuditEvent[]
  loading: boolean
  error?: string
  onRetry?: () => void
}) {
  if (loading) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  if (error) return <ErrorState title={error} onRetry={onRetry} />
  if (items.length === 0) return <EmptyState size="sm" title="Sin cambios" description="Aquí queda el historial del contacto." />

  return (
    <ol className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-(--shadow-card)">
      {items.map((event) => (
        <li key={event.id} className="border-b border-border-subtle px-4 py-3 last:border-b-0">
          <p className="text-label font-medium text-ink-900">
            {ACTIONS[event.action] ?? event.action}
            <span className="font-normal text-text-tertiary"> · {event.actor.display_name}</span>
          </p>
          <p className="text-caption text-text-tertiary">{formatDateTime(event.occurred_at)}</p>
          {event.changes.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {event.changes.map((change) => (
                <li key={change.field} className="text-label break-words text-text-secondary">
                  <span className="text-text-tertiary">{FIELDS[change.field] ?? change.field}: </span>
                  {show(change.before)} → {show(change.after)}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
