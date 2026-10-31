import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-field";
import { copy } from "@/i18n";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { useEntity } from "@/app/entity-context";
import { MadridDateField } from "@/pages/existencias/components/AtField";
import { BookTabs } from "@/pages/existencias/components/BookTabs";
import { ColumnMenu } from "@/pages/existencias/components/ColumnMenu";
import { Notice } from "@/pages/existencias/components/Notice";
import { movesPath, ownerEntityId, type FiscalMove, type PhysicalMove } from "@/pages/existencias/api";
import { filterFiscalMoves, filterPhysicalMoves } from "@/pages/existencias/filters";
import { periodClosedText } from "@/pages/existencias/explain";
import { FISCAL_MOVE_TYPES, PHYSICAL_MOVE_TYPES } from "@/pages/existencias/labels";
import { MovePreview } from "@/pages/existencias/MovePreview";
import { fiscalView, physicalView, type MoveView } from "@/pages/existencias/move-view";
import { useHiddenColumns } from "@/pages/existencias/use-hidden";
import { useList } from "@/pages/existencias/use-list";
import { formatMl, formatUnits } from "@/pages/existencias/volume";

const COLUMN_IDS = ["when", "type", "place", "lot", "product", "volume", "units", "document", "justification", "silicie", "user"] as const;
const COLUMN_LABELS: Record<(typeof COLUMN_IDS)[number], string> = {
  when: "Fecha",
  type: "Tipo",
  place: "Dónde",
  lot: "Lote",
  product: "Producto",
  volume: "Litros",
  units: "Unidades",
  document: "Documento",
  justification: "Justificante",
  silicie: "Asiento SILICIE",
  user: "Usuario",
};

function csvCell(value: string): string {
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function MovesPage({ me }: { me: Me }) {
  const { filter, entities } = useEntity();
  const ownerId = ownerEntityId(filter, entities);
  const [params, setParams] = useSearchParams();
  const book = params.get("book") === "fiscal" ? "fiscal" : "physical";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const moveType = params.get("move_type") ?? "";
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { hidden, toggle } = useHiddenColumns("winecore.columns.stock-moves", COLUMN_IDS, ["user"]);

  const path = movesPath({
    book,
    from,
    to,
    moveType,
    ownerEntityId: book === "physical" ? ownerId : undefined,
    legalEntityId: book === "fiscal" ? ownerId : undefined,
  });
  const physical = useList<PhysicalMove>(book === "physical" ? path : null);
  const fiscal = useList<FiscalMove>(book === "fiscal" ? path : null);
  const loading = book === "physical" ? physical.loading : fiscal.loading;
  const error = book === "physical" ? physical.error : fiscal.error;
  const reload = book === "physical" ? physical.reload : fiscal.reload;

  const views = useMemo<MoveView[]>(() => {
    if (book === "physical") return filterPhysicalMoves(physical.items, { ownerEntityId: ownerId, from, to, moveType, q }).map(physicalView);
    return filterFiscalMoves(fiscal.items, { legalEntityId: ownerId, from, to, moveType, q }).map(fiscalView);
  }, [book, fiscal.items, from, moveType, ownerId, physical.items, q, to]);

  const lockedUntil = views.find((row) => row.locked)?.lockedUntil ?? null;
  const filtersOn = Boolean(q || from || to || moveType || ownerId);
  const screen = loading ? "movimientos-cargando" : views.length === 0 && !filtersOn ? "movimientos-vacio" : book === "fiscal" ? "movimientos-fiscal" : "movimientos-physical";

  function assign(next: Record<string, string | null>) {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) updated.set(key, value);
      else updated.delete(key);
    }
    setParams(updated);
    setSelected(null);
  }

  const columns = useMemo<Column<MoveView>[]>(() => {
    const all: Column<MoveView>[] = [
      {
        id: "when",
        header: "Fecha",
        card: true,
        cell: (row) => (
          <span className="inline-flex items-start gap-1">
            {row.locked ? <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null}
            <span>
              {row.when}
              {row.locked ? <span className="sr-only"> Periodo cerrado</span> : null}
              {row.whenDetail ? <span className="mt-0.5 block text-meta text-muted-foreground">{row.whenDetail}</span> : null}
              <span className="mt-0.5 block font-medium tabular-nums md:hidden">{formatMl(row.volumeMl)}</span>
            </span>
          </span>
        ),
      },
      { id: "type", header: "Tipo", card: true, cell: (row) => row.moveType },
      { id: "place", header: book === "fiscal" ? "Mayor" : "Dónde", cell: (row) => row.place },
      { id: "lot", header: "Lote", cell: (row) => row.lot },
      { id: "product", header: "Producto", cell: (row) => row.product },
      { id: "volume", header: "Litros", align: "end", cell: (row) => formatMl(row.volumeMl) },
      { id: "units", header: "Unidades", align: "end", cell: (row) => (row.units ? formatUnits(row.units) : "—") },
      { id: "document", header: "Documento", card: true, cell: (row) => row.document },
      { id: "justification", header: "Justificante", cell: (row) => row.justification },
      { id: "silicie", header: "Asiento SILICIE", cell: (row) => row.silicie },
      { id: "user", header: "Usuario", cell: (row) => row.user },
    ];
    return all.filter((column) => !hidden.has(column.id));
  }, [book, hidden]);

  const index = views.findIndex((row) => row.id === selected);
  const types = book === "fiscal" ? FISCAL_MOVE_TYPES : PHYSICAL_MOVE_TYPES;

  if (!allows(me, "inventory.read")) return <NoPermission />;

  function exportCsv() {
    const header = COLUMN_IDS.map((id) => COLUMN_LABELS[id]);
    const lines = views.map((row) =>
      [row.when, row.moveType, row.place, row.lot, row.product, formatMl(row.volumeMl), row.units ? formatUnits(row.units) : "", row.document, row.justification, row.silicie, row.user].map(csvCell).join(";"),
    );
    const blob = new Blob([`\uFEFF${[header.join(";"), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `movimientos-${book}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast("CSV descargado");
  }

  return (
    <div data-screen={screen} className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Movimientos"
        description="Los movimientos no se editan. Para corregir uno, rectifica el documento de origen."
        actions={
          <Button type="button" variant="secondary" onClick={exportCsv} disabled={views.length === 0}>
            Exportar CSV
          </Button>
        }
      />
      <BookTabs value={book} onChange={(value) => assign({ book: value === "physical" ? null : value, move_type: null })} />
      {views.some((row) => row.locked) ? <Notice tone="warning" title="Periodo cerrado">{periodClosedText(lockedUntil)}</Notice> : null}
      <div className="grid min-w-0 gap-3">
        <label className="sr-only" htmlFor="buscar-movimientos">
          Buscar movimientos
        </label>
        <Input id="buscar-movimientos" type="search" value={q} placeholder="Documento, lote o asiento" onChange={(event) => setQ(event.target.value)} />
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          <MadridDateField id="mov-desde" label="Desde" value={from} onChange={(value) => assign({ from: value || null })} />
          <MadridDateField id="mov-hasta" label="Hasta" value={to} onChange={(value) => assign({ to: value || null })} />
          <NativeSelect aria-label="Tipo de movimiento" className="h-11 w-auto shrink-0 rounded-full md:h-8" value={moveType} onChange={(event) => assign({ move_type: event.target.value || null })}>
            <option value="">Tipo</option>
            {types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
          <ColumnMenu ids={COLUMN_IDS} labels={COLUMN_LABELS} hidden={hidden} locked="when" onToggle={toggle} />
        </div>
      </div>
      {error && views.length === 0 ? (
        <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={reload} />
      ) : (
        <div className="grid min-w-0 grid-cols-1">
          <DataTable
            label="Movimientos"
            columns={columns}
            rows={views}
            rowKey={(row) => row.id}
            loading={loading}
            hasMore={Boolean(book === "physical" ? physical.cursor : fiscal.cursor)}
            loadingMore={book === "physical" ? physical.loadingMore : fiscal.loadingMore}
            onLoadMore={() => void (book === "physical" ? physical.loadMore() : fiscal.loadMore())}
            onRowClick={(row) => setSelected(row.id)}
            selectedKey={selected ?? undefined}
            emptyTitle={filtersOn ? "Nada coincide con los filtros" : "No hay movimientos en este libro"}
            emptyDescription={filtersOn ? undefined : "Cuando se confirme una operación, un albarán o una factura, el movimiento aparecerá aquí."}
          />
        </div>
      )}
      <MovePreview
        row={views.find((row) => row.id === selected) ?? null}
        index={index}
        total={views.length}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onPrev={index > 0 ? () => setSelected(views[index - 1]?.id ?? null) : undefined}
        onNext={index >= 0 && index < views.length - 1 ? () => setSelected(views[index + 1]?.id ?? null) : undefined}
      />
    </div>
  );
}
