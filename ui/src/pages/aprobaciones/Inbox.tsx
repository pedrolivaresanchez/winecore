import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChromeTitle } from "@/app/shell/shell-context";
import { useEntity } from "@/app/entity-context";
import { FRAME_GUTTER, FRAME_STRIP_SCROLL } from "@/ui/frame";
import { Check, Search, SearchX } from "@/ui/icons";
import { copy, fill } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { iconStroke } from "@/lib/motion";
import type { Me } from "@/lib/types";
import { listApprovals } from "@/pages/aprobaciones/api";
import {
  APPROVAL_KINDS,
  entityLabel,
  expiryLabel,
  kindLabel,
  requestedByMe,
  statusMeta,
  type ApprovalSummary,
} from "@/pages/aprobaciones/model";
import { Alert, Badge, Button, EmptyState, Input, SegmentedControl, Select, Skeleton } from "@/ui";

type Tab = "pending" | "decided" | "mine";

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function tabOf(value: string | null): Tab {
  if (value === "decididas") return "decided";
  if (value === "mias") return "mine";
  return "pending";
}

export function ApprovalInbox({ me }: { me: Me }) {
  useChromeTitle(copy.approvals.title);
  const { entityCode } = useEntity();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabOf(searchParams.get("estado"));
  const kind = searchParams.get("tipo") ?? "";
  const [search, setSearch] = useState("");
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
      status: (tab === "decided" ? "decided" : tab === "mine" ? "all" : "pending") as "pending" | "decided" | "all",
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

  const needle = search.trim().toLocaleLowerCase("es");
  const visible = useMemo(() => {
    return items.filter((item) => {
      if (tab === "mine" && !requestedByMe(item, me)) return false;
      if (!needle) return true;
      const hay = `${item.title} ${item.summary} ${item.requested_by.display_name} ${kindLabel(item.kind)}`.toLocaleLowerCase("es");
      return hay.includes(needle);
    });
  }, [items, me, needle, tab]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
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

  const filtered = Boolean(kind || needle);
  const empty = !loading && visible.length === 0;
  const screen = loading
    ? "aprobaciones-cargando"
    : empty && !filtered && tab === "pending"
      ? "aprobaciones-vacio"
      : "aprobaciones";
  const listQuery = searchParams.toString();
  const suffix = listQuery ? `?${listQuery}` : "";

  const emptyCopy = filtered
    ? { title: copy.approvals.emptyFiltered, hint: copy.approvals.emptyFilteredHint }
    : tab === "decided"
      ? { title: copy.approvals.emptyDecided, hint: copy.approvals.emptyDecidedHint }
      : tab === "mine"
        ? { title: copy.approvals.emptyMine, hint: copy.approvals.emptyMineHint }
        : { title: copy.approvals.emptyPending, hint: copy.approvals.emptyPendingHint };

  const filters = (
    <>
      <SegmentedControl
        size="sm"
        className="shrink-0"
        aria-label={copy.approvals.title}
        value={tab}
        onChange={(value) => setParam("estado", value === "pending" ? "" : value === "decided" ? "decididas" : "mias")}
        options={[
          { value: "pending", content: copy.approvals.pending },
          { value: "decided", content: copy.approvals.decided },
          { value: "mine", content: copy.approvals.mine },
        ]}
      />
      <Select
        id="aprobaciones-tipo"
        size="sm"
        aria-label={copy.approvals.kind}
        value={kind}
        className="w-44 shrink-0"
        onChange={(event) => setParam("tipo", event.target.value)}
      >
        <option value="">{copy.approvals.allKinds}</option>
        {APPROVAL_KINDS.map((id) => (
          <option key={id} value={id}>
            {kindLabel(id)}
          </option>
        ))}
      </Select>
    </>
  );

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className={cn("hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex", FRAME_GUTTER)}>
        <Check className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.approvals.title}</h1>
        {tab === "pending" && !loading && total > 0 ? (
          <Badge tone="warning" dot size="sm">
            {fill(copy.approvals.pendingCount, { n: String(total) })}
          </Badge>
        ) : null}
      </header>
      <div className={cn("flex h-11 shrink-0 items-center gap-1.5 border-b border-border-subtle", FRAME_GUTTER)}>
        <div className={FRAME_STRIP_SCROLL}>
          <Input
            id="buscar-aprobaciones"
            type="search"
            size="sm"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.approvals.search}
            aria-label={copy.approvals.search}
            className="w-56 shrink-0"
            prefix={<Search className="size-3.5" strokeWidth={iconStroke} />}
          />
        </div>
      </div>
      <div className={cn("flex h-10 shrink-0 items-center gap-1.5 border-b border-border-subtle bg-surface-subtle", FRAME_GUTTER)}>
        <div className={cn(FRAME_STRIP_SCROLL, "[&>*]:shrink-0")}>{filters}</div>
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3 p-4">
          <Alert tone="danger">{`${copy.error.load} (${error.code})`}</Alert>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {copy.error.retry}
          </Button>
        </div>
      ) : loading && items.length === 0 ? (
        <div aria-busy="true">
          <p className="sr-only">{copy.loading}</p>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-12 items-center gap-3 border-b border-border-subtle px-3 sm:px-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="mt-1.5 h-3 w-1/3" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            size="sm"
            framed={false}
            icon={filtered ? <SearchX strokeWidth={iconStroke} /> : <Check strokeWidth={iconStroke} />}
            title={emptyCopy.title}
            description={emptyCopy.hint}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setParam("tipo", "");
                  }}
                >
                  {copy.approvals.clear}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul>
            {visible.map((item) => (
              <RequestRow key={item.id} item={item} now={now} href={`/aprobaciones/${item.id}${suffix}`} />
            ))}
          </ul>
          {cursor ? (
            <div className="p-3">
              <Button type="button" variant="secondary" size="sm" loading={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? copy.approvals.loadingMore : copy.approvals.loadMore}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RequestRow({ item, now, href }: { item: ApprovalSummary; now: number; href: string }) {
  const expiry = expiryLabel(item.expires_at, item.status, now);
  const status = statusMeta(item.status);
  return (
    <li className="border-b border-border-subtle">
      <Link to={href} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-fill-hover sm:px-4">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-medium text-ink-900">
            {item.title}
            <span className="font-normal text-text-tertiary"> · {entityLabel(item.legal_entity_code)}</span>
          </span>
          <span className="mt-0.5 block truncate text-caption text-text-secondary">
            {kindLabel(item.kind)}
            {item.summary ? ` · ${item.summary}` : ""}
          </span>
        </span>
        {item.status === "pending" ? (
          <span className={cn("shrink-0 pt-0.5 text-caption tabular-nums", expiry.urgent ? "font-medium text-danger-600" : "text-text-tertiary")}>
            {expiry.text}
          </span>
        ) : (
          <Badge tone={status.tone} size="sm" dot>
            {status.label}
          </Badge>
        )}
      </Link>
    </li>
  );
}
