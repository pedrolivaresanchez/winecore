import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useChromeTitle } from "@/app/shell/shell-context";
import { useEntity } from "@/app/entity-context";
import { FRAME_GUTTER } from "@/ui/frame";
import { Check, DownloadSimple, SearchX } from "@/ui/icons";
import { copy, fill } from "@/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { downloadCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format";
import { iconStroke } from "@/lib/motion";
import { listApprovals, type ApprovalsQuery } from "@/pages/aprobaciones/api";
import {
  APPROVAL_KINDS,
  entityLabel,
  expiryLabel,
  kindLabel,
  statusMeta,
  type ApprovalSummary,
} from "@/pages/aprobaciones/model";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FilterBar,
  Pagination,
  SegmentedControl,
  Skeleton,
  StatusPill,
  useCursorPages,
  useToast,
  type FilterDef,
  type FilterValue,
  type SelectionAction,
} from "@/ui";

type Tab = "pending" | "decided" | "mine";

const FILTERS: FilterDef[] = [
  {
    id: "tipo",
    label: copy.approvals.kind,
    kind: "single",
    display: "menu",
    options: APPROVAL_KINDS.map((id) => ({ value: id, label: kindLabel(id) })),
  },
];

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

export function ApprovalInbox() {
  useChromeTitle(copy.approvals.title);
  const toast = useToast();
  const { entityCode } = useEntity();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabOf(searchParams.get("estado"));
  const kind = searchParams.get("tipo") ?? "";
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const now = useNow();

  const query = useMemo<ApprovalsQuery>(
    () => ({
      status: tab === "decided" ? "decided" : tab === "mine" ? "all" : "pending",
      kind: kind || undefined,
      entity: entityCode ?? undefined,
      mine: tab === "mine",
    }),
    [entityCode, kind, tab],
  );
  const pages = useCursorPages<ApprovalSummary>({
    queryKey: JSON.stringify(query),
    storageKey: "approvals",
    fetchPage: ({ cursor, limit, signal }) => listApprovals({ ...query, cursor: cursor ?? undefined, limit }, signal),
  });
  const items = pages.items;
  const loading = pages.loading && items.length === 0;
  const error = pages.error ? (pages.error instanceof ApiError ? pages.error : new ApiError(0, "WC_ERROR", copy.error.load)) : null;

  useEffect(() => {
    setPicked(new Set());
  }, [pages.pageKey]);

  const needle = search.trim().toLocaleLowerCase("es");
  const visible = useMemo(() => {
    if (!needle) return items;
    return items.filter((item) => {
      const hay = `${item.title} ${item.summary} ${item.requested_by.display_name} ${kindLabel(item.kind)}`.toLocaleLowerCase("es");
      return hay.includes(needle);
    });
  }, [items, needle]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function clearFilters() {
    setSearch("");
    setParam("tipo", "");
  }

  function togglePick(id: string, on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
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

  const chosen = visible.filter((item) => picked.has(item.id));
  const actions: SelectionAction[] = [
    {
      id: "export",
      label: copy.lists.bulk.exportCsv,
      icon: DownloadSimple,
      onRun: () => {
        const columns = copy.lists.approvals;
        downloadCsv(
          "aprobaciones-seleccion.csv",
          [columns.request, columns.entity, copy.approvals.kind, columns.summary, copy.approvals.requester, columns.requestedAt, columns.status],
          chosen.map((item) => [
            item.title,
            entityLabel(item.legal_entity_code),
            kindLabel(item.kind),
            item.summary,
            item.requested_by.display_name,
            formatDateTime(item.requested_at),
            statusMeta(item.status).label,
          ]),
        );
        toast(fill(copy.lists.bulk.exported, { n: String(chosen.length) }));
      },
    },
  ];

  return (
    <div data-screen={screen} className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className={cn("hidden h-12 shrink-0 items-center gap-2 border-b border-border-subtle md:flex", FRAME_GUTTER)}>
        <Check className="size-4 shrink-0 text-icon" strokeWidth={iconStroke} />
        <h1 className="min-w-0 truncate text-label font-medium text-ink-900">{copy.approvals.title}</h1>
        {tab === "pending" && !loading && pages.total ? (
          <StatusPill tone="warning" dot>
            {fill(copy.approvals.pendingCount, { n: String(pages.total) })}
          </StatusPill>
        ) : null}
      </header>
      <FilterBar
        controls={
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
        }
        search={{ id: "buscar-aprobaciones", value: search, onChange: setSearch, placeholder: copy.approvals.search }}
        filters={FILTERS}
        values={{ tipo: kind }}
        onChange={(_id: string, value: FilterValue) => setParam("tipo", typeof value === "string" ? value : "")}
        onClear={clearFilters}
        selection={{
          count: picked.size,
          pageCount: visible.length,
          onSelectAll: () => setPicked(new Set(visible.map((item) => item.id))),
          onClear: () => setPicked(new Set()),
          actions,
        }}
      />

      {error ? (
        <div className="flex flex-col items-start gap-3 p-4">
          <Alert tone="danger">{`${copy.error.load} (${error.code})`}</Alert>
          <Button type="button" variant="secondary" size="sm" onClick={pages.reload}>
            {copy.error.retry}
          </Button>
        </div>
      ) : loading ? (
        <div aria-busy="true" className="min-h-0 flex-1">
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
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {copy.approvals.clear}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className={cn("min-h-0 flex-1 overflow-y-auto", pages.loading && "opacity-60")}>
          <ul>
            {visible.map((item) => (
              <RequestRow
                key={item.id}
                item={item}
                now={now}
                href={`/aprobaciones/${item.id}${suffix}`}
                picked={picked.has(item.id)}
                onPick={(on) => togglePick(item.id, on)}
              />
            ))}
          </ul>
        </div>
      )}
      {error ? null : <Pagination {...pages.pagination} />}
    </div>
  );
}

function RequestRow({
  item,
  now,
  href,
  picked,
  onPick,
}: {
  item: ApprovalSummary;
  now: number;
  href: string;
  picked: boolean;
  onPick: (on: boolean) => void;
}) {
  const expiry = expiryLabel(item.expires_at, item.status, now);
  const status = statusMeta(item.status);
  return (
    <li className={cn("flex items-center border-b border-border-subtle", picked && "bg-fill-selected")}>
      <span className="flex shrink-0 items-center pl-3 sm:pl-4">
        <Checkbox size="sm" checked={picked} onChange={onPick} ariaLabel={fill(copy.lists.selection.selectRow, { name: item.title })} />
      </span>
      <Link to={href} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-3 py-2 hover:bg-fill-hover sm:px-4">
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
