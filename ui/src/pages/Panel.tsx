import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy, fill } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import { contactAudit, contactQuery, listContacts, type AuditEvent, type ContactPage } from "@/lib/contacts";
import { formatDateTime, formatInteger } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";

const ACTIONS: Record<string, string> = {
  create: "creó",
  update: "cambió",
  archive: "archivó",
  unarchive: "recuperó",
};

function useRecent() {
  const [items, setItems] = useState<{ id: string; contactId: string; name: string; event: AuditEvent }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    listContacts({ limit: 8, archived: false }, controller.signal)
      .then(async (page) => {
        const top = [...page.items].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4);
        const audits = await Promise.all(
          top.map(async (contact) => ({ contact, audit: await contactAudit(contact.id, controller.signal) })),
        );
        if (!active) return;
        const rows = audits.flatMap(({ contact, audit }) =>
          audit.items.slice(0, 2).map((event) => ({
            id: event.id,
            contactId: contact.id,
            name: contact.legal_name,
            event,
          })),
        );
        rows.sort((a, b) => b.event.occurred_at.localeCompare(a.event.occurred_at));
        setItems(rows.slice(0, 6));
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setError(err instanceof ApiError ? err.message : copy.error.load);
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  return {
    items,
    loading,
    error,
    reload: () => {
      setLoading(true);
      setAttempt((value) => value + 1);
    },
  };
}

export function Panel({ me }: { me: Me }) {
  const name = me.display_name.trim() || me.email;
  const canWrite = allows(me, "contacts.write");
  const canRead = allows(me, "contacts.read");
  const all = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, archived: false }) : null);
  const customers = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, role: "customer", archived: false }) : null);
  const suppliers = useApi<ContactPage>(canRead ? contactQuery({ limit: 1, role: "supplier", archived: false }) : null);
  const recent = useRecent();
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
            <ErrorState title={recent.error} onRetry={recent.reload} />
          ) : recent.items.length === 0 ? (
            <p className="text-compact text-muted-foreground">{copy.panel.recentEmpty}</p>
          ) : (
            <ul className="grid gap-2">
              {recent.items.map((item) => (
                <li key={item.id}>
                  <Link to={`/contactos/${item.contactId}`} className="block rounded-xl border bg-card p-3 hover:bg-accent">
                    <p className="text-body">
                      <span className="font-medium">{item.event.actor.display_name}</span>{" "}
                      {ACTIONS[item.event.action] ?? item.event.action} {item.name}
                    </p>
                    <p className="text-meta text-muted-foreground">{formatDateTime(item.event.occurred_at)}</p>
                  </Link>
                </li>
              ))}
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
