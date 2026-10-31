import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { copy } from "@/i18n";
import { formatMl, formatQty, isPositiveDecimal, scaleDecimal } from "@/pages/catalogo/money";
import { groupStock, warehouseQty, type StockBalance, type WarehouseStock } from "@/pages/catalogo/model";

export function StockPanel({
  productId,
  tracked,
  rows,
  loading,
  error,
  disabled,
  onRetry,
}: {
  productId: string;
  tracked: boolean;
  rows: StockBalance[];
  loading: boolean;
  error: ApiError | null;
  disabled: boolean;
  onRetry: () => void;
}) {
  if (!tracked) {
    return <EmptyState title="Este producto no controla existencias" />;
  }
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-busy="true">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (disabled) {
    return (
      <div data-stock="off">
        <EmptyState
          title="El stock por almacén aparecerá cuando se active Existencias"
          description="La ficha del producto ya se puede completar. Las unidades por bodega se mostrarán aquí."
        />
      </div>
    );
  }
  if (error) {
    return <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={onRetry} />;
  }
  const warehouses = groupStock(rows);
  if (warehouses.length === 0) {
    return (
      <div data-stock="empty">
        <EmptyState title="No hay existencias de este producto" />
      </div>
    );
  }

  return (
    <div data-stock="ready" className="grid gap-4 lg:grid-cols-5">
      <ul className="order-2 grid gap-3 sm:grid-cols-2 lg:order-1 lg:col-span-3 lg:grid-cols-2">
        {warehouses.map((warehouse) => (
          <li key={warehouse.key} className="rounded-xl border bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-body font-medium">{warehouse.name}</p>
              <p className="text-meta text-muted-foreground">{warehouse.code}</p>
            </div>
            <p className="mt-1 text-title font-semibold tabular-nums">{warehouseQty(warehouse)}</p>
            <p className="text-meta text-muted-foreground">{warehouse.owners.join(" · ") || "Sin propietario"}</p>
            <ul className="mt-2 grid gap-1">
              {warehouse.lots.slice(0, 3).map((lot, index) => (
                <li key={`${lot.code}-${index}`} className="text-meta break-words text-muted-foreground">
                  {[lot.code, lot.state, lotLine(lot)].filter(Boolean).join(" · ")}
                </li>
              ))}
              {warehouse.lots.length > 3 ? (
                <li className="text-meta text-muted-foreground">y {warehouse.lots.length - 3} más</li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
      <div className="order-1 rounded-xl border bg-card p-3 lg:order-2 lg:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-compact font-medium">Reparto por almacén</h3>
          <Link to={`/stock?product_id=${productId}`} className="text-meta text-muted-foreground underline">
            Existencias
          </Link>
        </div>
        <div className="mt-3 grid gap-3" aria-label="Unidades por almacén">
          {warehouses.map((warehouse) => (
            <div key={warehouse.key}>
              <div className="flex items-baseline justify-between gap-3 text-meta">
                <span className="min-w-0 truncate">{warehouse.name}</span>
                <span className="shrink-0 tabular-nums">{warehouseQty(warehouse)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-muted">
                <div
                  className="h-2 min-w-2 rounded-full bg-ink"
                  style={{ width: barWidth(warehouse, warehouses) }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function lotLine(lot: { units: string; ml: string }): string {
  if (isPositiveDecimal(lot.units)) return `${formatQty(lot.units)} ud`;
  if (isPositiveDecimal(lot.ml)) return formatMl(lot.ml);
  return "";
}

function barWidth(row: WarehouseStock, rows: WarehouseStock[]): string {
  const values = rows.map((item) => measure(item));
  const max = values.reduce((best, value) => (value > best ? value : best), 0n);
  const current = measure(row);
  if (max <= 0n || current <= 0n) return "0%";
  const pct = (current * 1000n) / max;
  const whole = pct / 10n;
  const frac = pct % 10n;
  return `${whole}.${frac}%`;
}

function measure(row: WarehouseStock): bigint {
  const units = scaleDecimal(row.units, 3);
  if (units !== null && units > 0n) return units;
  const ml = scaleDecimal(row.ml, 3);
  return ml ?? 0n;
}
