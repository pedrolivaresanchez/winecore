import { Link } from 'react-router-dom'
import { Skeleton } from '@/ui'
import { ErrorState } from '@/components/ErrorState'
import { ApiError } from '@/lib/api'
import { copy } from '@/i18n'
import { formatMl, formatQty, isPositiveDecimal, scaleDecimal } from '@/pages/catalogo/money'
import { groupStock, warehouseQty, type StockBalance, type WarehouseStock } from '@/pages/catalogo/model'

export function StockPanel({
  productId,
  tracked,
  rows,
  loading,
  error,
  disabled,
  onRetry,
}: {
  productId: string
  tracked: boolean
  rows: StockBalance[]
  loading: boolean
  error: ApiError | null
  disabled: boolean
  onRetry: () => void
}) {
  if (!tracked) return <Quiet title="Este producto no controla existencias" />
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    )
  }
  if (disabled) {
    return (
      <div data-stock="off">
        <Quiet title="El stock por almacén no está activo." />
      </div>
    )
  }
  if (error) return <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={onRetry} />
  const warehouses = groupStock(rows)
  if (warehouses.length === 0) {
    return (
      <div data-stock="empty">
        <Quiet title="No hay existencias de este producto." />
      </div>
    )
  }

  return (
    <div data-stock="ready" className="grid gap-4">
      <ul className="grid gap-3 sm:grid-cols-2">
        {warehouses.map((warehouse) => (
          <li key={warehouse.key} className="rounded-2xl border border-border-subtle bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-label font-medium text-ink-900">{warehouse.name}</p>
              <p className="font-mono text-caption text-text-tertiary">{warehouse.code}</p>
            </div>
            <p className="mt-1 text-body font-medium text-ink-900 tabular-nums">{warehouseQty(warehouse)}</p>
            <p className="text-caption text-text-tertiary">{warehouse.owners.join(' · ') || 'Sin propietario'}</p>
            <ul className="mt-2 grid gap-1">
              {warehouse.lots.slice(0, 3).map((lot, index) => (
                <li key={`${lot.code}-${index}`} className="text-caption break-words text-text-tertiary">
                  {[lot.code, lot.state, lotLine(lot)].filter(Boolean).join(' · ')}
                </li>
              ))}
              {warehouse.lots.length > 3 ? <li className="text-caption text-text-tertiary">y {warehouse.lots.length - 3} más</li> : null}
            </ul>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl border border-border-subtle bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-label font-medium text-ink-900">Reparto</h3>
          <Link to={`/stock?product_id=${productId}`} className="text-caption text-text-tertiary underline max-sm:-my-3.5 max-sm:py-3.5">
            Existencias
          </Link>
        </div>
        <div className="mt-3 grid gap-3" aria-label="Unidades por almacén">
          {warehouses.map((warehouse) => (
            <div key={warehouse.key}>
              <div className="flex items-baseline justify-between gap-3 text-caption">
                <span className="min-w-0 truncate text-text-secondary">{warehouse.name}</span>
                <span className="shrink-0 tabular-nums text-ink-900">{warehouseQty(warehouse)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-subtle">
                <div className="h-1.5 min-w-1 rounded-full bg-ink-900" style={{ width: barWidth(warehouse, warehouses) }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Quiet({ title }: { title: string }) {
  return <p className="rounded-2xl border border-border-subtle px-4 py-3 text-label text-text-tertiary">{title}</p>
}

function lotLine(lot: { units: string; ml: string }): string {
  if (isPositiveDecimal(lot.units)) return `${formatQty(lot.units)} ud`
  if (isPositiveDecimal(lot.ml)) return formatMl(lot.ml)
  return ''
}

function barWidth(row: WarehouseStock, rows: WarehouseStock[]): string {
  const values = rows.map((item) => measure(item))
  const max = values.reduce((best, value) => (value > best ? value : best), 0n)
  const current = measure(row)
  if (max <= 0n || current <= 0n) return '0%'
  const pct = (current * 1000n) / max
  const whole = pct / 10n
  const frac = pct % 10n
  return `${whole}.${frac}%`
}

function measure(row: WarehouseStock): bigint {
  const units = scaleDecimal(row.units, 3)
  if (units !== null && units > 0n) return units
  const ml = scaleDecimal(row.ml, 3)
  return ml ?? 0n
}
