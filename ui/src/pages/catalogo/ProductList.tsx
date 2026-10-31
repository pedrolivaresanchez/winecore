import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, Columns3 } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError, isAbortError } from "@/lib/api";
import { allows } from "@/lib/permissions";
import { readStorage, writeStorage } from "@/lib/storage";
import type { Me } from "@/lib/types";
import { exportProducts, listProducts } from "@/pages/catalogo/api";
import { CatalogTabs } from "@/pages/catalogo/components/CatalogTabs";
import { GtinScanButton } from "@/pages/catalogo/components/GtinScan";
import { Pill } from "@/pages/catalogo/components/Pill";
import { formatAlcohol, formatQty } from "@/pages/catalogo/money";
import {
  KIND_OPTIONS,
  formatCode,
  productWarnings,
  taxLabel,
  wineName,
  type Format,
  type ListPage,
  type MissingData,
  type Product,
  type ProductKind,
  type ProductQuery,
  type Wine,
} from "@/pages/catalogo/model";
import { ProductCreateSheet } from "@/pages/catalogo/ProductCreateSheet";
import { ProductPreview } from "@/pages/catalogo/ProductPreview";

const COLUMN_KEY = "winecore.columns.products";
const COLUMN_IDS = ["sku", "name", "wine", "vintage", "format", "gtin", "nc", "tax", "alcohol", "stock", "active", "warnings"] as const;
type ColumnId = (typeof COLUMN_IDS)[number];
const COLUMN_LABELS: Record<ColumnId, string> = {
  sku: "SKU",
  name: "Nombre",
  wine: "Vino",
  vintage: "Añada",
  format: "Formato",
  gtin: "GTIN",
  nc: "NC",
  tax: "IVA",
  alcohol: "Grado",
  stock: "Existencias",
  active: "Activo",
  warnings: "Avisos",
};
const DEFAULT_HIDDEN = new Set<ColumnId>(["gtin", "nc", "tax", "alcohol"]);

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

export function ProductList({ me }: { me: Me }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canWrite = allows(me, "catalog.write");
  const kind = (params.get("kind") ?? "") as "" | ProductKind;
  const wineId = params.get("wine_id") ?? "";
  const formatId = params.get("format_id") ?? "";
  const vintage = params.get("vintage") ?? "";
  const active = (params.get("active") ?? "") as "" | "true" | "false";
  const organic = params.get("organic") === "true";
  const missing = (params.get("missing") ?? "") as MissingData;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q.trim());
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState(readHidden);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const wines = useApi<ListPage<Wine>>("/v1/wines?limit=100");
  const formats = useApi<ListPage<Format>>("/v1/formats?limit=100");
  const wineRows = useMemo(() => wines.data?.items ?? [], [wines.data]);
  const formatRows = useMemo(() => formats.data?.items ?? [], [formats.data]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  const query = useMemo<ProductQuery>(
    () => ({
      q: debounced,
      kind,
      wine_id: wineId,
      format_id: formatId,
      vintage,
      active,
      organic,
      missing,
      limit: 50,
    }),
    [active, debounced, formatId, kind, missing, organic, vintage, wineId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    listProducts(query, controller.signal)
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setCursor(page.next_cursor);
        setTotal(page.total);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!live || isAbortError(err)) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
        setLoading(false);
      });
    return () => {
      live = false;
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
      const page = await listProducts({ ...query, cursor });
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor);
      setTotal(page.total);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err : new ApiError(0, "WC_ERROR", copy.error.load));
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleColumn(id: ColumnId) {
    if (id === "name") return;
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(COLUMN_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const columns = useMemo<Column<Product>[]>(() => {
    const all: Column<Product>[] = [
      { id: "sku", header: "SKU", cell: (row) => row.sku },
      {
        id: "name",
        header: "Nombre",
        card: true,
        cell: (row) => {
          const warnings = productWarnings(row);
          return (
            <span className="block max-w-[280px]">
              <span className="block truncate font-medium" title={row.name}>
                {row.name}
              </span>
              <span className="mt-0.5 block text-meta text-muted-foreground md:hidden">{row.sku}</span>
              {warnings.length > 0 ? (
                <span className="mt-1 flex flex-wrap gap-1 md:hidden">
                  {warnings.map((warning) => (
                    <StatusPill key={warning} tone="warning">
                      {warning}
                    </StatusPill>
                  ))}
                </span>
              ) : null}
            </span>
          );
        },
      },
      { id: "wine", header: "Vino", cell: (row) => wineName(row, wineRows) },
      { id: "vintage", header: "Añada", cell: (row) => (row.vintage == null ? "—" : String(row.vintage)) },
      { id: "format", header: "Formato", cell: (row) => formatCode(row, formatRows) },
      { id: "gtin", header: "GTIN", cell: (row) => row.gtin || "—" },
      { id: "nc", header: "NC", cell: (row) => row.nc_code || "—" },
      { id: "tax", header: "IVA", cell: (row) => taxLabel(row.default_tax_code) },
      { id: "alcohol", header: "Grado", align: "end", cell: (row) => formatAlcohol(row.alcohol_pct) },
      {
        id: "stock",
        header: "Existencias",
        align: "end",
        card: true,
        cell: (row) => {
          if (!row.is_stock_tracked) return "—";
          return (
            <Link to={`/stock?product_id=${row.id}`} className="underline" onClick={(event) => event.stopPropagation()}>
              {row.on_hand_qty ? formatQty(row.on_hand_qty) : "Ver"}
            </Link>
          );
        },
      },
      {
        id: "active",
        header: "Activo",
        cell: (row) => <StatusPill tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Activo" : "Inactivo"}</StatusPill>,
      },
      {
        id: "warnings",
        header: "Avisos",
        cell: (row) => {
          const warnings = productWarnings(row);
          if (warnings.length === 0) return "—";
          return (
            <span className="flex flex-wrap gap-1">
              {warnings.map((warning) => (
                <StatusPill key={warning} tone="warning">
                  {warning}
                </StatusPill>
              ))}
            </span>
          );
        },
      },
    ];
    return all.filter((column) => !hidden.has(column.id as ColumnId));
  }, [formatRows, hidden, wineRows]);

  const filtersActive = Boolean(debounced || kind || wineId || formatId || vintage || active || organic || missing);
  const sheetFilters = [kind, wineId, formatId, vintage].filter(Boolean).length;
  const selectedIndex = items.findIndex((item) => item.id === selected);
  if (!allows(me, "catalog.read")) return <NoPermission />;

  const screen = loading ? "catalogo-cargando" : items.length === 0 && !filtersActive ? "catalogo-vacio" : "catalogo";

  return (
    <div data-screen={screen} className="flex flex-col gap-4">
      <CatalogTabs />
      <PageHeader
        title="Productos"
        description="Vino por añada y formato, granel, mercancía y servicios."
        actions={
          canWrite ? (
            <div className="inline-flex">
              <Button type="button" className="rounded-r-none" onClick={() => setCreateOpen(true)}>
                Nuevo producto
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-ink-foreground/20 px-2" aria-label="Más acciones">
                    <ChevronDown aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="min-h-11" onSelect={() => navigate("/catalogo/vinos?crear=vino")}>
                    Nuevo vino
                  </DropdownMenuItem>
                  <DropdownMenuItem className="min-h-11" onSelect={() => navigate("/catalogo/vinos?crear=formato")}>
                    Nuevo formato
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11"
                    onSelect={() => {
                      void exportProducts(query).catch(() => toast("No se ha podido exportar."));
                    }}
                  >
                    Exportar CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void exportProducts(query).catch(() => toast("No se ha podido exportar."));
              }}
            >
              Exportar CSV
            </Button>
          )
        }
      />

      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 bg-background px-4 py-2 md:static md:mx-0 md:px-0">
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="buscar-productos">
            Buscar por nombre, SKU o GTIN
          </label>
          <Input
            id="buscar-productos"
            className="min-w-0 flex-1"
            type="search"
            value={q}
            placeholder="Buscar por nombre, SKU o GTIN"
            onChange={(event) => setQ(event.target.value)}
          />
          <GtinScanButton onCode={setQ} />
        </div>
      </div>

      <div className="-mx-4 flex items-center gap-2 px-4 md:mx-0 md:px-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
          <Pill active={kind === ""} onClick={() => setFilter("kind", "")}>
            Todos
          </Pill>
          {KIND_OPTIONS.map((option) => (
            <Pill key={option.id} active={kind === option.id} onClick={() => setFilter("kind", kind === option.id ? "" : option.id)}>
              {option.label}
            </Pill>
          ))}
          <label className="sr-only" htmlFor="filtro-vino">
            Vino
          </label>
          <select
            id="filtro-vino"
            className="hidden h-8 shrink-0 rounded-full bg-muted px-3 text-compact whitespace-nowrap md:inline-block"
            value={wineId}
            onChange={(event) => setFilter("wine_id", event.target.value)}
          >
            <option value="">Vino</option>
            {wineRows.map((wine) => (
              <option key={wine.id} value={wine.id}>
                {wine.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="filtro-formato">
            Formato
          </label>
          <select
            id="filtro-formato"
            className="hidden h-8 shrink-0 rounded-full bg-muted px-3 text-compact whitespace-nowrap md:inline-block"
            value={formatId}
            onChange={(event) => setFilter("format_id", event.target.value)}
          >
            <option value="">Formato</option>
            {formatRows.map((format) => (
              <option key={format.id} value={format.id}>
                {format.code}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="filtro-anada">
            Añada
          </label>
          <Input
            id="filtro-anada"
            inputMode="numeric"
            value={vintage}
            placeholder="Añada"
            className="hidden h-8 w-24 shrink-0 rounded-full md:inline-block"
            onChange={(event) => setFilter("vintage", event.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <Pill active={active === "true"} onClick={() => setFilter("active", active === "true" ? "" : "true")}>
            Activos
          </Pill>
          <Pill active={organic} onClick={() => setFilter("organic", organic ? "" : "true")}>
            Ecológico
          </Pill>
          <span className="shrink-0 text-meta whitespace-nowrap text-muted-foreground">Faltan datos</span>
          <Pill active={missing === "gtin"} onClick={() => setFilter("missing", missing === "gtin" ? "" : "gtin")}>
            GTIN
          </Pill>
          <Pill active={missing === "nc_code"} onClick={() => setFilter("missing", missing === "nc_code" ? "" : "nc_code")}>
            NC
          </Pill>
          <Pill active={missing === "silicie"} onClick={() => setFilter("missing", missing === "silicie" ? "" : "silicie")}>
            SILICIE
          </Pill>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary" size="md" className="hidden shrink-0 md:inline-flex">
                <Columns3 aria-hidden className="size-4" />
                Columnas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {COLUMN_IDS.map((id) => (
                <DropdownMenuItem
                  key={id}
                  className="min-h-11"
                  disabled={id === "name"}
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
        <Button type="button" variant={sheetFilters > 0 ? "primary" : "secondary"} size="md" className="mb-1 shrink-0 md:hidden" onClick={() => setFiltersOpen(true)}>
          {sheetFilters > 0 ? `Filtros · ${sheetFilters}` : "Filtros"}
        </Button>
      </div>

      {!loading && items.length > 0 ? <p className="text-meta text-muted-foreground">{total} productos</p> : null}

      {error && items.length === 0 ? (
        <ErrorState
          title={`${copy.error.load} (${error.code})`}
          detail={error.message}
          onRetry={() => {
            setLoading(true);
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <DataTable
          label="Productos"
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          loading={loading}
          hasMore={Boolean(cursor)}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          onRowClick={(row) => setSelected(row.id)}
          selectedKey={selected ?? undefined}
          emptyTitle={filtersActive ? "Nada coincide con los filtros" : "Aún no hay productos"}
          emptyDescription={filtersActive ? undefined : "Crea el vino, el formato y el producto que se vende."}
          emptyAction={
            canWrite && !filtersActive ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                Nuevo producto
              </Button>
            ) : undefined
          }
        />
      )}

      <ProductPreview
        id={selected}
        ids={items.map((item) => item.id)}
        index={selectedIndex}
        wines={wineRows}
        formats={formatRows}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onSelect={setSelected}
      />
      <ProductCreateSheet open={createOpen} wines={wineRows} formats={formatRows} onOpenChange={setCreateOpen} />
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" data-screen="catalogo-filtros">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <div className="grid gap-4 px-4 pb-6">
            <label className="grid gap-1.5 text-compact" htmlFor="filtro-tipo">
              Tipo
              <NativeSelect id="filtro-tipo" value={kind} onChange={(event) => setFilter("kind", event.target.value)}>
                <option value="">Todos</option>
                {KIND_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1.5 text-compact" htmlFor="filtro-vino-hoja">
              Vino
              <NativeSelect id="filtro-vino-hoja" value={wineId} onChange={(event) => setFilter("wine_id", event.target.value)}>
                <option value="">Todos</option>
                {wineRows.map((wine) => (
                  <option key={wine.id} value={wine.id}>
                    {wine.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1.5 text-compact" htmlFor="filtro-formato-hoja">
              Formato
              <NativeSelect id="filtro-formato-hoja" value={formatId} onChange={(event) => setFilter("format_id", event.target.value)}>
                <option value="">Todos</option>
                {formatRows.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.code}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="grid gap-1.5 text-compact" htmlFor="filtro-anada-hoja">
              Añada
              <Input
                id="filtro-anada-hoja"
                inputMode="numeric"
                value={vintage}
                placeholder="2025"
                onChange={(event) => setFilter("vintage", event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
            <fieldset className="grid gap-2">
              <legend className="text-compact font-medium">Columnas</legend>
              <div className="flex flex-wrap gap-2">
                {COLUMN_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={!hidden.has(id)}
                    disabled={id === "name"}
                    className={`h-11 rounded-full px-3 text-compact disabled:opacity-60 ${hidden.has(id) ? "bg-muted" : "bg-ink font-medium text-ink-foreground"}`}
                    onClick={() => toggleColumn(id)}
                  >
                    {COLUMN_LABELS[id]}
                  </button>
                ))}
              </div>
            </fieldset>
            <Button type="button" onClick={() => setFiltersOpen(false)}>
              Ver productos
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
