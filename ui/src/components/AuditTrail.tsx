import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import type { AuditEvent } from "@/lib/contacts";

const ACTIONS: Record<string, string> = {
  create: "Alta",
  update: "Cambio",
  archive: "Archivo",
  unarchive: "Recuperación",
};

const FIELDS: Record<string, string> = {
  legal_name: "Nombre fiscal",
  trade_name: "Nombre comercial",
  tax_id: "NIF",
  country_code: "País",
  email: "Correo",
  phone: "Teléfono",
  notes: "Notas",
  language: "Idioma",
  vat_regime: "Régimen de IVA",
  payment_method: "Forma de pago",
  payment_terms_days: "Días de pago",
  is_customer: "Cliente",
  is_supplier: "Proveedor",
  is_carrier: "Transportista",
  is_logistics_operator: "Operador logístico",
};

function show(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "—";
}

export function AuditTrail({
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
