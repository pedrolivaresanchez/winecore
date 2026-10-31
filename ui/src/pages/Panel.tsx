import { Link } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy, fill } from "@/i18n";
import { contactQuery, type AuditEvent, type AuditPage, type ContactPage } from "@/lib/contacts";
import { formatDateTime, formatInteger } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";

const ACTIONS: Record<string, string> = {
  create: "creó",
  update: "cambió",
  archive: "archivó",
  unarchive: "reactivó",
};

function subjectOf(event: AuditEvent): string {
  const named = event.changes.find((change) => change.field === "legal_name" || change.field === "trade_name");
  const value = named?.after ?? named?.before;
  if (typeof value === "string" && value.trim()) return value;
  return "un contacto";
}

export function Panel({ me }: { me: Me }) {
  const name = me.display_name.trim() || me.email;
  const canWrite = allows(me, "contacts.write");
  const canRead = allows(me, "contacts.read");
  const all = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, archived: false }) : null);
  const customers = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, role: "customer", archived: false }) : null);
  const suppliers = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, role: "supplier", archived: false }) : null);
  const recent = useApi<AuditPage>(canRead ? "/v1/audit?table=party.contact&limit=5" : null);
  const ready = !canRead || (!all.loading && !customers.loading && !suppliers.loading && !recent.loading);

  return (
    <div data-screen={ready ? "panel" : "panel-cargando"} className="flex flex-col gap-6">
      <PageHeader title={copy.panel.title} description={fill(copy.panel.hello, { name })} />
      <p className="text-body text-muted-foreground">{copy.panel.lead}</p>

      {canWrite ? (
        <section className="grid gap-3">
          <h2 className="text-body font-semibold">{copy.panel.quick}</h2>
          <div>
            <Button asChild>
              <Link to="/contactos/nuevo">{copy.panel.newContact}</Link>
            </Button>
          </div>
        </section>
      ) : null}

      {canRead ? (
        <section className="grid gap-3">
          <h2 className="text-body font-semibold">{copy.panel.kpis}</h2>
          {all.error ? (
            <ErrorState title={`${copy.error.load} (${all.error.code})`} detail={all.error.message} onRetry={all.reload} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Link to="/contactos" className="rounded-xl focus-visible:outline">
                <Tile label="Contactos" value={all.data?.total} loading={all.loading} />
              </Link>
              <Link to="/contactos?role=customer" className="rounded-xl">
                <Tile label={copy.panel.customers} value={customers.data?.total} loading={customers.loading} />
              </Link>
              <Link to="/contactos?role=supplier" className="rounded-xl">
                <Tile label={copy.panel.suppliers} value={suppliers.data?.total} loading={suppliers.loading} />
              </Link>
            </div>
          )}
        </section>
      ) : null}

      {canRead ? (
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-body font-semibold">{copy.panel.recent}</h2>
          </div>
          {recent.loading ? (
            <div className="grid gap-2" aria-busy="true">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : recent.error ? (
            <ErrorState title={`${copy.error.load} (${recent.error.code})`} detail={recent.error.message} onRetry={recent.reload} />
          ) : (recent.data?.items.length ?? 0) === 0 ? (
            <p className="text-compact text-muted-foreground">{copy.panel.recentEmpty}</p>
          ) : (
            <ul className="grid gap-2">
              {recent.data?.items.map((event) => {
                const body = (
                  <>
                    <p className="text-body">
                      <span className="font-medium">{event.actor.display_name}</span>{" "}
                      {ACTIONS[event.action] ?? event.action} {subjectOf(event)}
                    </p>
                    <p className="text-meta text-muted-foreground">{formatDateTime(event.occurred_at)}</p>
                  </>
                );
                return (
                  <li key={event.id}>
                    {event.row_id ? (
                      <Link to={`/contactos/${event.row_id}`} className="block rounded-xl border bg-card p-3 hover:bg-accent">
                        {body}
                      </Link>
                    ) : (
                      <div className="rounded-xl border bg-card p-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Tile({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  if (loading || value == null) return <StatTile label={label} value="…" />;
  return <StatTile label={label} value={formatInteger(value)} />;
}
