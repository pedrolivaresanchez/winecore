import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Columns3 } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copy } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import {
  COUNTRIES,
  countryLabel,
  exportContacts,
  listContacts,
  roleLabels,
  type ContactKind,
  type ContactQuery,
  type ContactRole,
  type ContactSummary,
} from "@/lib/contacts";
import { formatDate } from "@/lib/format";
import { allows } from "@/lib/permissions";
import { readStorage, writeStorage } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";
import { ContactPreview } from "@/pages/contactos/ContactPreview";
import { NoPermission } from "@/components/NoPermission";

const COLUMN_KEY = "winecore.columns.contacts";
const COLUMN_IDS = ["legal_name", "trade_name", "tax_id", "country", "city", "email", "roles", "updated"] as const;
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  legal_name: "Nombre fiscal",
  trade_name: "Nombre comercial",
  tax_id: "NIF",
  country: "País",
  city: "Población",
  email: "Correo",
  roles: "Papel",
  updated: "Actualizado",
};
type ColumnId = (typeof COLUMN_IDS)[number];
const DEFAULT_HIDDEN = new Set<ColumnId>(["trade_name", "email", "updated"]);

function readHidden(): Set<ColumnId> {
  const raw = readStorage(COLUMN_KEY);
  if (!raw) return new Set(DEFAULT_HIDDEN);
  try {
    const parsed = JSON.parse(raw) as ColumnId[];
    return new Set(parsed.filter((id) => COLUMN_IDS.includes(id)));
  } catch {
    return new Set(DEFAULT_HIDDEN);
  }
}

const KIND_PILLS: { id: "" | ContactKind; label: string }[] = [
  { id: "", label: "Todos" },
  { id: "company", label: "Empresas" },
  { id: "person", label: "Personas" },
];

const ROLE_PILLS: { id: ContactRole; label: string }[] = [
  { id: "customer", label: "Clientes" },
  { id: "supplier", label: "Proveedores" },
  { id: "carrier", label: "Transportistas" },
  { id: "logistics_operator", label: "Operadores logísticos" },
];

function clip(value: string) {
  return <span className="block max-w-full min-w-0 whitespace-normal break-words">{value}</span>;
}

function Pill({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-filter-active={active ? "true" : undefined}
      className={cn(
        "h-11 shrink-0 rounded-full px-3 text-compact whitespace-nowrap md:h-8",
        active ? "bg-ink font-medium text-ink-foreground" : "bg-muted text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function useFilterRail(activeKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const desktop = window.matchMedia("(min-width: 768px)");

    const reveal = () => {
      if (desktop.matches) return;
      const rail = el.getBoundingClientRect();
      const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-filter-active='true']"));
      const target = nodes.find((node) => {
        const box = node.getBoundingClientRect();
        return box.left < rail.left + 4 || box.right > rail.right - 4;
      });
      if (!target) return;
      const box = target.getBoundingClientRect();
      const delta = box.left - rail.left - (el.clientWidth - box.width) / 2;
      el.scrollLeft = Math.max(0, el.scrollLeft + delta);
    };

    const measure = () => {
      if (desktop.matches) {
        setFade({ left: false, right: false });
        return;
      }
      const max = el.scrollWidth - el.clientWidth;
      setFade({ left: el.scrollLeft > 8, right: max - el.scrollLeft > 8 });
    };

    reveal();
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(() => {
      reveal();
      measure();
    });
    observer.observe(el);
    desktop.addEventListener("change", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
      desktop.removeEventListener("change", measure);
    };
  }, [activeKey]);

  return { ref, fade };
}

export function ContactList({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const canWrite = allows(me, "contacts.write");
  const kind = (params.get("kind") ?? "") as "" | ContactKind;
  const role = (params.get("role") ?? "") as "" | ContactRole;
  const country = params.get("country") ?? "";
  const archived = params.get("archived") === "true";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [items, setItems] = useState<ContactSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState(readHidden);
  const filters = useFilterRail(`${kind}|${role}|${country}|${archived}`);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const query = useMemo<ContactQuery>(
    () => ({ q: debounced, kind, role, country, archived, limit: 50 }),
    [archived, country, debounced, kind, role],
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    listContacts(query, controller.signal)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.next_cursor);
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
  }, [query, attempt]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setLoading(true);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listContacts({ ...query, cursor });
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleColumn(id: ColumnId) {
    if (id === "legal_name") return;
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(COLUMN_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const columns = useMemo<Column<ContactSummary>[]>(() => {
    const all: Column<ContactSummary>[] = [
      { id: "legal_name", header: "Nombre fiscal", card: true, cell: (row) => clip(row.legal_name) },
      { id: "trade_name", header: "Nombre comercial", cell: (row) => clip(row.trade_name || "—") },
      { id: "tax_id", header: "NIF", card: true, cell: (row) => clip(row.tax_id || "—") },
      { id: "country", header: "País", cell: (row) => clip(countryLabel(row.country_code)) },
      { id: "city", header: "Población", card: true, cell: (row) => clip(row.city || "—") },
      { id: "email", header: "Correo", cell: (row) => clip(row.email || "—") },
      { id: "roles", header: "Papel", cell: (row) => clip(roleLabels(row).join(" · ") || "—") },
      { id: "updated", header: "Actualizado", cell: (row) => clip(formatDate(row.updated_at)) },
    ];
    return all.filter((column) => !hidden.has(column.id as ColumnId));
  }, [hidden]);

  const selectedIndex = items.findIndex((item) => item.id === selected);
  const filtersActive = Boolean(debounced || kind || role || country || archived);
  const emptyTitle = filtersActive ? copy.contacts.noMatch : copy.contacts.empty;

  if (!allows(me, "contacts.read")) {
    return (
      <div data-screen="contactos-sin-permiso">
        <NoPermission />
      </div>
    );
  }

  return (
    <div data-screen={loading ? "contactos-cargando" : items.length === 0 && !filtersActive ? "contactos-vacio" : "contactos"} className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={copy.contacts.title}
        description={copy.contacts.description}
        actions={
          canWrite ? (
            <div className="inline-flex">
              <Button asChild className="rounded-r-none">
                <Link to="/contactos/nuevo">{copy.contacts.new}</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-ink-foreground/20 px-2" aria-label="Más acciones">
                    <ChevronDown aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={() => {
                      void exportContacts(query).catch(() => toast("No se ha podido exportar."));
                    }}
                  >
                    {copy.contacts.export}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void exportContacts(query).catch(() => toast("No se ha podido exportar."));
              }}
            >
              {copy.contacts.export}
            </Button>
          )
        }
      />

      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 bg-background px-4 py-2 md:static md:mx-0 md:px-0">
        <label className="sr-only" htmlFor="buscar-contactos">
          {copy.contacts.search}
        </label>
        <Input
          id="buscar-contactos"
          type="search"
          value={q}
          placeholder={copy.contacts.search}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative -mx-4 w-[calc(100%+2rem)] min-w-0 md:mx-0 md:w-full">
          <div
            id="filtros-contactos"
            ref={filters.ref}
            data-filters-fade={filters.fade.right ? "right" : filters.fade.left ? "left" : undefined}
            className={cn(
              "flex w-full flex-nowrap items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden",
              filters.fade.left && filters.fade.right && "max-md:[mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-20px),transparent)]",
              filters.fade.right && !filters.fade.left && "max-md:[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]",
              filters.fade.left && !filters.fade.right && "max-md:[mask-image:linear-gradient(to_right,transparent,black_16px)]",
            )}
          >
            {KIND_PILLS.map((pill) => (
              <Pill key={pill.label} active={kind === pill.id} onClick={() => setFilter("kind", pill.id)}>
                {pill.label}
              </Pill>
            ))}
            {ROLE_PILLS.map((pill) => (
              <Pill key={pill.id} active={role === pill.id} onClick={() => setFilter("role", role === pill.id ? "" : pill.id)}>
                {pill.label}
              </Pill>
            ))}
            <label className="sr-only" htmlFor="filtro-pais">
              País
            </label>
            <select
              id="filtro-pais"
              data-filter-active={country ? "true" : undefined}
              className="h-11 shrink-0 rounded-full bg-muted px-3 text-compact whitespace-nowrap md:h-8"
              value={country}
              onChange={(event) => setFilter("country", event.target.value)}
            >
              <option value="">País</option>
              {COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            <Pill active={archived} onClick={() => setFilter("archived", archived ? "" : "true")}>
              {copy.contacts.archived}
            </Pill>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="md" className="hidden h-11 shrink-0 md:inline-flex md:h-8">
              <Columns3 aria-hidden className="size-4" />
              {copy.contacts.columns}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {COLUMN_IDS.map((id) => (
              <DropdownMenuItem
                key={id}
                className="min-h-11"
                disabled={id === "legal_name"}
                onSelect={(event) => {
                  event.preventDefault();
                  toggleColumn(id);
                }}
              >
                <input type="checkbox" readOnly checked={!hidden.has(id)} className="size-4" aria-hidden />
                {COLUMN_LABELS[id]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && items.length === 0 ? (
        <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} />
      ) : (
        <DataTable
          label={copy.contacts.title}
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          loading={loading}
          hasMore={Boolean(cursor)}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          onRowClick={(row) => setSelected(row.id)}
          selectedKey={selected ?? undefined}
          emptyTitle={emptyTitle}
          emptyDescription={filtersActive ? undefined : copy.contacts.emptyHint}
          emptyAction={
            canWrite && !filtersActive ? (
              <Button asChild>
                <Link to="/contactos/nuevo">{copy.contacts.new}</Link>
              </Button>
            ) : undefined
          }
        />
      )}

      <ContactPreview
        id={selected}
        ids={items.map((item) => item.id)}
        index={selectedIndex}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onSelect={setSelected}
      />
    </div>
  );
}
