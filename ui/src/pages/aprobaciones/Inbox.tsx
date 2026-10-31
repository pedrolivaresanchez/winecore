import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEntity } from "@/app/entity-context";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { copy } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listApprovals } from "@/pages/aprobaciones/api";
import {
  APPROVAL_KINDS,
  entityLabel,
  expiryLabel,
  kindLabel,
  shortHash,
  statusMeta,
  type ApprovalSummary,
} from "@/pages/aprobaciones/model";

type Tab = "pending" | "decided";

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function ApprovalInbox() {
  const navigate = useNavigate();
  const { entityCode } = useEntity();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("estado") === "decididas" ? "decided" : "pending";
  const kind = params.get("tipo") ?? "";
  const now = useNow();
  const [items, setItems] = useState<ApprovalSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const query = useMemo(
    () => ({
      status: tab,
      kind: kind || undefined,
      entity: entityCode ?? undefined,
    }),
    [entityCode, kind, tab],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    listApprovals(query, controller.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setTotal(page.total);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || isAbortError(err)) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, query]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listApprovals({ ...query, cursor });
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor);
      setTotal(page.total);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = Boolean(kind);
  const empty = !loading && items.length === 0;
  const screen = loading ? "aprobaciones-cargando" : empty && !filtered && tab === "pending" ? "aprobaciones-vacio" : "aprobaciones";

  return (
    <div data-screen={screen} className="flex flex-col gap-4">
      <PageHeader title="Aprobaciones" description="Aprueba o rechaza exactamente lo que se va a ejecutar." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div role="tablist" aria-label="Estado" className="flex gap-2">
          <TabButton
            selected={tab === "pending"}
            label={tab === "pending" && !loading && total > 0 ? `Pendientes ${total}` : "Pendientes"}
            onClick={() => setParam("estado", "")}
          />
          <TabButton
            selected={tab === "decided"}
            label={tab === "decided" && !loading && total > 0 ? `Decididas ${total}` : "Decididas"}
            onClick={() => setParam("estado", "decididas")}
          />
        </div>
        <label className="grid gap-1 text-meta text-muted-foreground sm:w-64" htmlFor="aprobaciones-tipo">
          Tipo
          <NativeSelect
            id="aprobaciones-tipo"
            value={kind}
            onChange={(event) => setParam("tipo", event.target.value)}
          >
            <option value="">Todos</option>
            {APPROVAL_KINDS.map((id) => (
              <option key={id} value={id}>
                {kindLabel(id)}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      {error ? (
        <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => setAttempt((value) => value + 1)} />
      ) : null}
      {loading ? <InboxSkeleton /> : null}
      {!loading && !error && empty ? (
        <EmptyState
          title={filtered ? "Nada coincide con el filtro" : tab === "pending" ? "No hay nada pendiente" : "No hay decisiones"}
          description={tab === "pending" && !filtered ? "Cuando haya algo que firmar, aparecerá aquí." : undefined}
        />
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <>
          <div className="hidden md:block">
            <div className="overflow-x-auto border border-border">
              <Table>
                <caption className="sr-only">Solicitudes</caption>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {["Qué se aprueba", "Tipo", "Entidad", "Solicitante", "Plazo", "Hash"].map((header) => (
                      <TableHead key={header} className="h-11 border border-border bg-muted text-compact font-medium">
                        {header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const expiry = expiryLabel(item.expires_at, item.status, now);
                    const status = statusMeta(item.status);
                    return (
                      <TableRow
                        key={item.id}
                        tabIndex={0}
                        className="cursor-pointer"
                        onClick={() => navigate(`/aprobaciones/${item.id}`)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(`/aprobaciones/${item.id}`);
                          }
                        }}
                      >
                        <TableCell className="border border-border whitespace-normal text-compact">
                          <p className="font-medium break-words">{item.title}</p>
                          <p className="mt-0.5 break-words text-muted-foreground">{item.summary}</p>
                        </TableCell>
                        <TableCell className="border border-border whitespace-normal text-compact">{kindLabel(item.kind)}</TableCell>
                        <TableCell className="border border-border text-compact">{entityLabel(item.legal_entity_code)}</TableCell>
                        <TableCell className="border border-border whitespace-normal text-compact">
                          <p className="break-words">{item.requested_by.display_name}</p>
                          <p className="text-meta text-muted-foreground">{formatDateTime(item.requested_at)}</p>
                        </TableCell>
                        <TableCell className="border border-border whitespace-normal text-compact">
                          {item.status === "pending" ? (
                            <span className={cn(expiry.urgent && "font-medium text-destructive")}>{expiry.text}</span>
                          ) : (
                            <StatusPill tone={status.tone}>{status.label}</StatusPill>
                          )}
                        </TableCell>
                        <TableCell className="border border-border font-mono text-meta" title={item.payload_sha256}>
                          {shortHash(item.payload_sha256)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
          <ul className="grid gap-3 md:hidden">
            {items.map((item) => (
              <li key={item.id}>
                <ApprovalCard item={item} now={now} />
              </li>
            ))}
          </ul>
          {cursor ? (
            <Button type="button" variant="secondary" className="w-full sm:w-auto sm:self-center" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? copy.table.loading : copy.table.loadMore}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TabButton({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cn(
        "h-11 shrink-0 rounded-full px-3 text-compact whitespace-nowrap md:h-8",
        selected ? "bg-ink font-medium text-ink-foreground" : "bg-muted text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ApprovalCard({ item, now }: { item: ApprovalSummary; now: number }) {
  const expiry = expiryLabel(item.expires_at, item.status, now);
  const status = statusMeta(item.status);
  return (
    <Link to={`/aprobaciones/${item.id}`} className="block rounded-xl border bg-card p-4 card-shadow">
      <div className="flex items-start justify-between gap-3">
        <p className="text-meta text-muted-foreground">
          {kindLabel(item.kind)} · {entityLabel(item.legal_entity_code)}
        </p>
        {item.status === "pending" ? (
          <p className={cn("shrink-0 text-meta", expiry.urgent ? "font-medium text-destructive" : "text-muted-foreground")}>{expiry.text}</p>
        ) : (
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        )}
      </div>
      <p className="mt-1 text-body font-medium break-words">{item.title}</p>
      <p className="mt-1 text-compact break-words text-muted-foreground">{item.summary}</p>
      <p className="mt-3 text-meta text-muted-foreground">
        <span className="font-mono">{shortHash(item.payload_sha256)}</span>
        {" · "}
        {item.requested_by.display_name}
      </p>
    </Link>
  );
}

function InboxSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only">{copy.loading}</p>
      <div className="hidden gap-2 md:grid">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
      <ul className="grid gap-3 md:hidden">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="rounded-xl border p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
