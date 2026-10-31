import { ErrorState } from '@/components/ErrorState'
import { EmptyState, Skeleton } from '@/ui'
import { formatDateTime } from '@/lib/format'
import type { AuditEvent } from '@/pages/catalogo/model'

const ACTIONS: Record<string, string> = {
  create: 'Alta',
  INSERT: 'Alta',
  update: 'Cambio',
  UPDATE: 'Cambio',
  archive: 'Archivo',
  DELETE: 'Baja',
}

const FIELDS: Record<string, string> = {
  sku: 'SKU',
  name: 'Nombre',
  name_en: 'Nombre en inglés',
  kind: 'Tipo',
  wine_id: 'Vino',
  vintage: 'Añada',
  format_id: 'Formato',
  unit: 'Unidad',
  gtin: 'GTIN',
  gtin_case: 'GTIN caja',
  nc_code: 'Código NC',
  excise_product_key: 'Mayor SILICIE',
  alcohol_pct: 'Grado',
  default_tax_code: 'IVA',
  sales_account: 'Cuenta de ventas',
  is_stock_tracked: 'Controla existencias',
  requires_lot: 'Requiere lote',
  is_active: 'Activo',
}

function show(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  return '—'
}

export function CatalogAudit({
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
  if (items.length === 0) return <EmptyState size="sm" title="Sin cambios" description="Aquí queda el historial del producto." />

  return (
    <ol className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
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
