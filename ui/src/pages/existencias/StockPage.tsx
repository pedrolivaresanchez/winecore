import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { copy } from "@/i18n";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { useEntity } from "@/app/entity-context";
import { AtField } from "@/pages/existencias/components/AtField";
import { BookTabs } from "@/pages/existencias/components/BookTabs";
import { LocationCards } from "@/pages/existencias/components/LocationCards";
import { Pill } from "@/pages/existencias/components/Pills";
import { StockGroups } from "@/pages/existencias/components/StockGroups";
import { groupBalances } from "@/pages/existencias/groups";
import { StockPreview } from "@/pages/existencias/components/StockPreview";
import {
  balanceKey,
  balancesPath,
  fiscalBalancesPath,
  ownerEntityId,
  type FiscalBalance,
  type StockBalance,
} from "@/pages/existencias/api";
import { filterBalances, filterFiscal } from "@/pages/existencias/filters";
import { PRODUCT_STATES, classLabel, productLabel } from "@/pages/existencias/labels";
import { summarizeFiscal, summarizePhysical } from "@/pages/existencias/summarize";
import { isBeforeStockEpoch, madridDate, STOCK_EPOCH_ISO } from "@/pages/existencias/time";
import { useList } from "@/pages/existencias/use-list";
import { formatMl, formatUnits } from "@/pages/existencias/volume";

const STATE_PILLS = PRODUCT_STATES.filter((item) => item.id === "wine" || item.id === "must" || item.id === "packaged_unlabeled" || item.id === "packaged_labeled");

export function StockPage({ me }: { me: Me }) {
  const { filter, entities } = useEntity();
  const ownerId = ownerEntityId(filter, entities);
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => new Date().toISOString());
  const at = params.get("at") || now;
  const book = params.get("book") === "fiscal" ? "fiscal" : "physical";
  const locationId = params.get("location") ?? "";
  const state = params.get("state") ?? "";
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const canCount = allows(me, "inventory.count");

  const physicalPath = book !== "physical" ? null : balancesPath({ at, locationId, ownerEntityId: ownerId, state });
  const fiscalPath = book !== "fiscal" ? null : fiscalBalancesPath({ at: madridDate(at), legalEntityId: ownerId });
  const physical = useList<StockBalance>(physicalPath);
  const fiscal = useList<FiscalBalance>(fiscalPath);
  const loading = book === "physical" ? physical.loading : fiscal.loading;
  const error = book === "physical" ? physical.error : fiscal.error;
  const reload = book === "physical" ? physical.reload : fiscal.reload;

  function assign(next: Record<string, string | null>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated);
  }

  const physicalRows = useMemo(
    () => filterBalances(physical.items, { ownerEntityId: ownerId, locationId, state, q }),
    [locationId, ownerId, physical.items, q, state],
  );
  const fiscalRows = useMemo(() => filterFiscal(fiscal.items, { legalEntityId: ownerId, q }), [fiscal.items, ownerId, q]);
  const stats = useMemo(() => summarizePhysical(physicalRows), [physicalRows]);
  const fiscalStats = useMemo(() => summarizeFiscal(fiscalRows), [fiscalRows]);
  const groups = useMemo(() => groupBalances(physicalRows), [physicalRows]);
  const locations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of physical.items) seen.set(row.location_id, `${row.location_code} · ${row.location_name}`);
    return [...seen.entries()];
  }, [physical.items]);
  const cards = groups.map((group) => ({
    id: group.id,
    code: group.code,
    name: group.name,
    volumeMl: group.volumeMl,
    units: group.units,
  }));

  const filtersOn = Boolean(q || locationId || state || ownerId);
  const visibleCount = book === "physical" ? physicalRows.length : fiscalRows.length;
  const before = isBeforeStockEpoch(at) && !loading && visibleCount === 0 && !filtersOn;
  const screen = loading
    ? "existencias-cargando"
    : before
      ? "existencias-antes"
      : visibleCount === 0 && !filtersOn
        ? "existencias-vacio"
        : book === "fiscal"
          ? "existencias-fiscal"
          : "existencias-physical";

  const selectedRow = physicalRows.find((row) => balanceKey(row) === selected) ?? null;
  const selectedIndex = physicalRows.findIndex((row) => balanceKey(row) === selected);

  if (!allows(me, "inventory.read")) return <NoPermission />;

  const informeTo = `/stock/informe?at=${encodeURIComponent(at)}`;

  return (
    <div data-screen={screen} className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Existencias"
        description="Qué hay, dónde y de quién, a la fecha que elijas. El físico se mueve con el albarán; el fiscal, con la factura."
        actions={
          <>
            <Button asChild>
              <Link to={informeTo}>Informe de inspección</Link>
            </Button>
            {canCount ? (
              <div className="inline-flex">
                <Button asChild variant="secondary" className="rounded-r-none">
                  <Link to="/stock/aforos/nuevo">Iniciar aforo</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" className="rounded-l-none border-l border-border px-2" aria-label="Más formas de aforar">
                      <ChevronDown aria-hidden className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild className="min-h-11">
                      <Link to="/stock/aforos/nuevo?kind=opening">Aforo de arranque</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="min-h-11">
                      <Link to="/stock/aforos/nuevo?kind=inspection">Aforo de inspección</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <AtField iso={at} onChange={(value) => assign({ at: value })} />
        <BookTabs value={book} onChange={(value) => assign({ book: value === "physical" ? null : value })} />
      </div>

      {before ? (
        <EmptyState
          title="WineCore no tiene datos antes del aforo de arranque"
          description="El arranque es el 31/12/2026. A partir del 01/01/2027 puedes consultar existencias e imprimir el informe."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => assign({ at: STOCK_EPOCH_ISO })}>
                Ver el 01/01/2027
              </Button>
              <Button asChild variant="secondary">
                <Link to="/stock/aforos?kind=opening">Aforo de arranque</Link>
              </Button>
            </div>
          }
        />
      ) : error && visibleCount === 0 ? (
        <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={reload} />
      ) : loading ? (
        <div aria-busy="true" className="grid gap-3">
          <p className="sr-only">{copy.loading}</p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : book === "physical" ? (
        <>
          {physicalRows.length > 0 ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <StatTile label="Granel" value={formatMl(stats.bulkMl)} />
                {stats.formats.map((item) => (
                  <StatTile key={item.nominal} label={item.label} value={`${formatUnits(item.units)} ud`} />
                ))}
              </div>
              <LocationCards items={cards} selectedId={locationId} onSelect={(id) => assign({ location: id || null })} />
            </>
          ) : null}
          <div className="grid min-w-0 gap-3">
            <label className="sr-only" htmlFor="buscar-existencias">
              Buscar existencias
            </label>
            <Input id="buscar-existencias" type="search" value={q} placeholder="Buscar lote, recipiente o vino" onChange={(event) => setQ(event.target.value)} />
            <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              <Pill active={!state} onClick={() => assign({ state: null })}>
                Todos
              </Pill>
              {STATE_PILLS.map((item) => (
                <Pill key={item.id} active={state === item.id} onClick={() => assign({ state: state === item.id ? null : item.id })}>
                  {item.label}
                </Pill>
              ))}
              <label className="sr-only" htmlFor="filtro-ubicacion">
                Ubicación
              </label>
              <NativeSelect id="filtro-ubicacion" className="h-11 w-auto shrink-0 rounded-full md:h-8" value={locationId} onChange={(event) => assign({ location: event.target.value || null })}>
                <option value="">Ubicación</option>
                {locations.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {physicalRows.length === 0 ? (
            <EmptyState title={filtersOn ? "Nada coincide con los filtros" : "No hay existencias a esta fecha"} description={filtersOn ? undefined : "Prueba otra fecha o revisa el aforo de arranque."} />
          ) : (
            <StockGroups
              groups={groups}
              selectedKey={selected ?? undefined}
              onOpen={(row) => setSelected(balanceKey(row))}
            />
          )}
          <StockPreview
            row={selectedRow}
            index={selectedIndex}
            total={physicalRows.length}
            onOpenChange={(open) => {
              if (!open) setSelected(null);
            }}
            onPrev={selectedIndex > 0 ? () => setSelected(balanceKey(physicalRows[selectedIndex - 1]!)) : undefined}
            onNext={selectedIndex >= 0 && selectedIndex < physicalRows.length - 1 ? () => setSelected(balanceKey(physicalRows[selectedIndex + 1]!)) : undefined}
          />
        </>
      ) : (
        <>
          {fiscalRows.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <StatTile label="Granel" value={formatMl(fiscalStats.bulk.volumeMl)} />
              <StatTile label="Granel en madera" value={formatMl(fiscalStats.bulk_wood.volumeMl)} />
              <StatTile label="Envasado" value={`${formatUnits(fiscalStats.packaged.units)} ud`} hint={formatMl(fiscalStats.packaged.volumeMl)} />
            </div>
          ) : null}
          <label className="sr-only" htmlFor="buscar-fiscal">
            Buscar en el libro fiscal
          </label>
          <Input id="buscar-fiscal" type="search" value={q} placeholder="Buscar mayor, lote o vino" onChange={(event) => setQ(event.target.value)} />
          {fiscalRows.length === 0 ? (
            <EmptyState
              title={filter === "CVPO" ? "CVPO no tiene libro fiscal" : filtersOn ? "Nada coincide con los filtros" : "No hay existencias fiscales a esta fecha"}
              description={filter === "CVPO" ? "El establecimiento con CAE es el de P.O. Cambia a Todas o a P.O para ver el libro fiscal." : undefined}
            />
          ) : (
            <FiscalTable rows={fiscalRows} />
          )}
        </>
      )}
    </div>
  );
}

function FiscalTable({ rows }: { rows: FiscalBalance[] }) {
  return (
    <div className="grid min-w-0 grid-cols-1">
      <div className="hidden min-w-0 overflow-x-auto border border-border md:block">
        <table className="w-full border-collapse text-compact">
          <caption className="sr-only">Existencias fiscales</caption>
          <thead>
            <tr>
              {["Establecimiento", "Mayor", "Referencia", "Lote", "Producto o vino", "Litros", "Unidades"].map((header) => (
                <th key={header} className={`h-11 border border-border bg-muted px-2 text-left font-medium ${header === "Litros" || header === "Unidades" ? "text-right" : ""}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.product_class}:${row.excise_product_key}:${row.lot_id}`}>
                <td className="border border-border px-2 py-2">{row.tax_warehouse_name}</td>
                <td className="border border-border px-2 py-2">{classLabel(row.product_class)}</td>
                <td className="border border-border px-2 py-2">{row.excise_product_key ?? "—"}</td>
                <td className="border border-border px-2 py-2">{row.lot_code ?? "—"}</td>
                <td className="border border-border px-2 py-2">{productLabel(row)}</td>
                <td className="border border-border px-2 py-2 text-right tabular-nums">{formatMl(row.volume_ml)}</td>
                <td className="border border-border px-2 py-2 text-right tabular-nums">{row.units ? formatUnits(row.units) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={`${row.product_class}:${row.excise_product_key}:${row.lot_id}`} className="rounded-xl border bg-card p-4 card-shadow">
            <p className="text-body font-medium">{classLabel(row.product_class)}</p>
            <p className="text-compact text-muted-foreground">{productLabel(row)}</p>
            <p className="mt-2 text-compact font-medium tabular-nums">{row.units ? `${formatUnits(row.units)} ud` : formatMl(row.volume_ml)}</p>
            <p className="text-meta text-muted-foreground break-words">{row.lot_code ?? row.excise_product_key ?? row.tax_warehouse_name}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
