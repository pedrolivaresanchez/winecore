import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { copy } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { useEntity } from "@/app/entity-context";
import { ColumnMenu } from "@/pages/existencias/components/ColumnMenu";
import { Pill } from "@/pages/existencias/components/Pills";
import { countsPath, ownerEntityId, type InventoryCount } from "@/pages/existencias/api";
import { filterCounts } from "@/pages/existencias/filters";
import { COUNT_KINDS, countKindLabel, countStatusLabel, countStatusTone, ownerLabel } from "@/pages/existencias/labels";
import { useHiddenColumns } from "@/pages/existencias/use-hidden";
import { useList } from "@/pages/existencias/use-list";

const COLUMN_IDS = ["number", "kind", "when", "status", "locations", "entity", "differences"] as const;
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  number: "Número",
  kind: "Tipo",
  when: "Fecha",
  status: "Estado",
  locations: "Ubicaciones",
  entity: "Entidad",
  differences: "Diferencias",
};

export function CountsPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const { filter, entities } = useEntity();
  const ownerId = ownerEntityId(filter, entities);
  const [params, setParams] = useSearchParams();
  const kind = params.get("kind") ?? "";
  const [q, setQ] = useState("");
  const { hidden, toggle } = useHiddenColumns("winecore.columns.stock-counts", COLUMN_IDS);
  const list = useList<InventoryCount>(countsPath(ownerId));
  const rows = useMemo(() => filterCounts(list.items, { legalEntityId: ownerId, kind, q }), [kind, list.items, ownerId, q]);
  const canCount = allows(me, "inventory.count");
  const filtersOn = Boolean(q || kind || ownerId);
  const screen = list.loading ? "aforos-cargando" : rows.length === 0 && !filtersOn ? "aforos-vacio" : "aforos";

  function assign(next: Record<string, string | null>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated);
  }

  const columns = useMemo<Column<InventoryCount>[]>(() => {
    const all: Column<InventoryCount>[] = [
      { id: "number", header: "Número", card: true, cell: (row) => row.number ?? "Sin número" },
      { id: "kind", header: "Tipo", card: true, cell: (row) => countKindLabel(row.kind) },
      { id: "when", header: "Fecha", cell: (row) => formatDateTime(row.counted_at) },
      {
        id: "status",
        header: "Estado",
        card: true,
        cell: (row) => {
          const pending = Boolean(row.approval_request_id && row.status !== "posted" && row.status !== "approved");
          return <StatusPill tone={pending ? "warning" : countStatusTone(row.status)}>{pending ? "Pendiente de aprobación" : countStatusLabel(row.status)}</StatusPill>;
        },
      },
      { id: "locations", header: "Ubicaciones", cell: (row) => row.location_codes.join(", ") || "—" },
      { id: "entity", header: "Entidad", cell: (row) => ownerLabel(row.legal_entity_code) },
      { id: "differences", header: "Diferencias", align: "end", cell: (row) => String(row.difference_count) },
    ];
    return all.filter((column) => !hidden.has(column.id));
  }, [hidden]);

  if (!allows(me, "inventory.read")) return <NoPermission />;

  return (
    <div data-screen={screen} className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Aforos"
        description="Recuentos por ubicación y recipiente. Las diferencias se contabilizan con aprobación."
        actions={
          canCount ? (
            <div className="inline-flex">
              <Button asChild className="rounded-r-none">
                <Link to="/stock/aforos/nuevo">Nuevo aforo</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-ink-foreground/20 px-2" aria-label="Más tipos de aforo">
                    <ChevronDown aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild className="min-h-11">
                    <Link to="/stock/aforos/nuevo?kind=opening">Aforo de arranque</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-11">
                    <Link to="/stock/aforos/nuevo?kind=periodic">Periódico</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-11">
                    <Link to="/stock/aforos/nuevo?kind=inspection">De inspección</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null
        }
      />
      <label className="sr-only" htmlFor="buscar-aforos">
        Buscar aforos
      </label>
      <Input id="buscar-aforos" type="search" value={q} placeholder="Número o ubicación" onChange={(event) => setQ(event.target.value)} />
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        <Pill active={!kind} onClick={() => assign({ kind: null })}>
          Todos
        </Pill>
        {COUNT_KINDS.map((item) => (
          <Pill key={item.id} active={kind === item.id} onClick={() => assign({ kind: kind === item.id ? null : item.id })}>
            {item.label}
          </Pill>
        ))}
        <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hidden} locked="number" onToggle={toggle} />
      </div>
      {list.error && rows.length === 0 ? (
        <ErrorState title={`${copy.error.load} (${list.error.code})`} detail={list.error.message} onRetry={list.reload} />
      ) : (
        <div className="grid min-w-0 grid-cols-1">
          <DataTable
            label="Aforos"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.loading}
            hasMore={Boolean(list.cursor)}
            loadingMore={list.loadingMore}
            onLoadMore={() => void list.loadMore()}
            onRowClick={(row) => navigate(`/stock/aforos/${row.id}`)}
            emptyTitle={filtersOn ? "Nada coincide con los filtros" : "Aún no hay aforos"}
            emptyDescription={filtersOn ? undefined : "El de arranque deja los saldos iniciales del 31/12/2026."}
            emptyAction={
              canCount && !filtersOn ? (
                <Button asChild>
                  <Link to="/stock/aforos/nuevo">Nuevo aforo</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
