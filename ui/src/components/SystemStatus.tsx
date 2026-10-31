import { ErrorState } from "@/components/ErrorState";
import { StatTile } from "@/components/StatTile";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import type { Health } from "@/lib/types";

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

export function SystemStatus() {
  const health = useApi<Health>("/health");
  return (
    <section aria-labelledby="estado-sistema" className="rounded-xl border bg-card p-4 card-shadow" data-health={health.error ? "error" : health.data ? "ok" : "loading"}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="estado-sistema" className="text-body font-semibold">
          {copy.panel.system}
        </h2>
        {health.data && health.data.status !== "ok" ? <StatusPill tone="warning">{copy.panel.incident}</StatusPill> : null}
      </div>
      {health.loading ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-11" />
          ))}
        </div>
      ) : health.error ? (
        <div className="mt-3">
          <ErrorState
            framed={false}
            title={`${copy.error.load} (${health.error.code})`}
            detail={health.error.message}
            onRetry={health.reload}
          />
        </div>
      ) : health.data ? (
        <div className="mt-1 divide-y divide-border sm:mt-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:divide-y-0">
          <StatTile label={copy.panel.version} value={versionOf(health.data.sha)} hint={health.data.sha} />
          <StatTile label={copy.panel.schema} value={health.data.schema_version || "—"} />
          <StatTile label={copy.panel.database} value={databaseLabel(health.data.db)} />
          <StatTile label={copy.panel.writer} value={writerLabel(health.data.writer)} />
        </div>
      ) : null}
    </section>
  );
}
