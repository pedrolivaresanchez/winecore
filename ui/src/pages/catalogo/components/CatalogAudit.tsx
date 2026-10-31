import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import type { AuditEvent } from "@/pages/catalogo/model";

const ACTIONS: Record<string, string> = {
  create: "Alta",
  update: "Cambio",
  archive: "Archivo",
};

const FIELDS: Record<string, string> = {
  sku: "SKU",
  name: "Nombre",
  name_en: "Nombre en inglés",
  kind: "Tipo",
  wine_id: "Vino",
  vintage: "Añada",
  format_id: "Formato",
  unit: "Unidad",
  gtin: "GTIN",
  gtin_case: "GTIN caja",
  nc_code: "Código NC",
  excise_product_key: "Mayor SILICIE",
  alcohol_pct: "Grado",
  default_tax_code: "IVA",
  sales_account: "Cuenta de ventas",
  is_stock_tracked: "Controla existencias",
  requires_lot: "Requiere lote",
  is_active: "Activo",
};

function show(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "—";
}

export function CatalogAudit({
  items,
  loading,
  error,
  onRetry,
}: {
  items: AuditEvent[];
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (error) return <ErrorState title={error} onRetry={onRetry} />;
  if (items.length === 0) return <EmptyState title="Sin cambios registrados" />;

  return (
    <ol className="grid gap-3">
      {items.map((event) => (
        <li key={event.id} className="rounded-xl border bg-card p-3">
          <p className="text-body font-medium">
            {ACTIONS[event.action] ?? event.action}
            <span className="font-normal text-muted-foreground"> · {event.actor.display_name}</span>
          </p>
          <p className="text-meta text-muted-foreground">{formatDateTime(event.occurred_at)}</p>
          {event.changes.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {event.changes.map((change) => (
                <li key={change.field} className="text-compact break-words">
                  <span className="text-muted-foreground">{FIELDS[change.field] ?? change.field}: </span>
                  {show(change.before)} → {show(change.after)}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
