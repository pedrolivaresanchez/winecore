import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/StatTile";
import { StatusPill } from "@/components/StatusPill";
import { useApi } from "@/hooks/use-api";
import { copy, fill } from "@/i18n";
import { entityName, roleLabel } from "@/lib/labels";
import type { EntityCode, Health, Me } from "@/lib/types";

function versionOf(sha: string) {
  const clean = sha.trim();
  return clean ? clean.slice(0, 7) : "—";
}

function databaseLabel(db: string) {
  if (db === "local") return copy.panel.dbLocal;
  if (db === "timbal") return copy.panel.dbTimbal;
  return db;
}

function writerLabel(writer: string) {
  if (writer === "leader") return copy.panel.writerLeader;
  if (writer === "standby") return copy.panel.writerStandby;
  return writer;
}

function rolesFor(me: Me, code: EntityCode | null) {
  return [...new Set(me.roles.filter((role) => role.legal_entity_code === code).map((role) => role.role))];
}

export function Panel({ me }: { me: Me }) {
  const health = useApi<Health>("/health");
  const name = me.display_name.trim() || me.email;
  const groupRoles = rolesFor(me, null);
  const settled = !health.loading;

  return (
    <div data-screen={settled ? "panel" : "panel-cargando"} className="flex flex-col gap-4">
      <PageHeader title={copy.panel.title} description={fill(copy.panel.hello, { name })} />

      <section aria-labelledby="estado-sistema" className="rounded-xl border bg-card p-4 card-shadow">
        <div className="flex items-center justify-between gap-3">
          <h2 id="estado-sistema" className="text-body font-semibold">
            {copy.panel.system}
          </h2>
          {health.data && health.data.status !== "ok" ? (
            <StatusPill tone="warning">{copy.panel.incident}</StatusPill>
          ) : null}
        </div>

        {health.loading ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
            <p className="sr-only">{copy.loading}</p>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11 sm:h-24" />
            ))}
          </div>
        ) : health.error ? (
          <div className="mt-3" data-health="error">
            <ErrorState
              framed={false}
              title={`${copy.error.load} (${health.error.code})`}
              detail={health.error.message}
              onRetry={health.reload}
            />
          </div>
        ) : health.data ? (
          <div className="mt-1 divide-y divide-border sm:mt-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:divide-y-0 lg:grid-cols-4" data-health="ok">
            <StatTile label={copy.panel.version} value={versionOf(health.data.sha)} hint={health.data.sha} />
            <StatTile label={copy.panel.schema} value={health.data.schema_version || "—"} />
            <StatTile label={copy.panel.database} value={databaseLabel(health.data.db)} />
            <StatTile label={copy.panel.writer} value={writerLabel(health.data.writer)} />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="entidades" className="flex flex-col gap-3">
        <h2 id="entidades" className="text-body font-semibold">
          {copy.panel.entities}
        </h2>
        {me.entities.length === 0 && groupRoles.length === 0 ? (
          <EmptyState title={copy.panel.noEntities} />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {groupRoles.length > 0 ? (
              <li className="rounded-xl border bg-card p-3 card-shadow md:p-4">
                <h3 className="text-body font-semibold">{copy.entity.all}</h3>
                <p className="mt-0.5 text-meta text-muted-foreground">{copy.panel.group}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {groupRoles.map((role) => (
                    <StatusPill key={role}>{roleLabel(role)}</StatusPill>
                  ))}
                </div>
              </li>
            ) : null}
            {me.entities.map((entity) => {
              const roles = rolesFor(me, entity.code);
              const label = entityName(entity.code);
              return (
                <li key={entity.id} className="rounded-xl border bg-card p-3 card-shadow md:p-4">
                  <h3 className="text-body font-semibold">{label}</h3>
                  {entity.legal_name && entity.legal_name !== label ? (
                    <p className="mt-0.5 text-meta break-words text-muted-foreground">{entity.legal_name}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {roles.length > 0 ? (
                      roles.map((role) => <StatusPill key={role}>{roleLabel(role)}</StatusPill>)
                    ) : (
                      <p className="text-compact text-muted-foreground">{copy.panel.noRole}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
