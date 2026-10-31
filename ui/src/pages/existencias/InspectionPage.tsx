import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/button";
import { copy } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { entityName } from "@/lib/labels";
import { allows } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import type { Me } from "@/lib/types";
import { useEntity } from "@/app/entity-context";
import { Notice } from "@/pages/existencias/components/Notice";
import { groupBalances } from "@/pages/existencias/groups";
import {
  balancesPath,
  fiscalBalancesPath,
  ownerEntityId,
  type FiscalBalance,
  type StockBalance,
} from "@/pages/existencias/api";
import { explainStockError } from "@/pages/existencias/explain";
import { filterBalances, filterFiscal } from "@/pages/existencias/filters";
import { classLabel, ownerLabel, productLabel, stateLabel } from "@/pages/existencias/labels";
import { summarizeFiscal, summarizePhysical } from "@/pages/existencias/summarize";
import { isBeforeStockEpoch, madridDate } from "@/pages/existencias/time";
import { useList } from "@/pages/existencias/use-list";
import { formatMl, formatUnits } from "@/pages/existencias/volume";

export function InspectionPage({ me }: { me: Me }) {
  const { filter, entities } = useEntity();
  const ownerId = ownerEntityId(filter, entities);
  const [params] = useSearchParams();
  const [now] = useState(() => new Date().toISOString());
  const at = params.get("at") || now;
  const physical = useList<StockBalance>(balancesPath({ at, ownerEntityId: ownerId }));
  const fiscal = useList<FiscalBalance>(fiscalBalancesPath({ at: madridDate(at), legalEntityId: ownerId }));
  const rows = useMemo(() => filterBalances(physical.items, { ownerEntityId: ownerId }), [ownerId, physical.items]);
  const fiscalRows = useMemo(() => filterFiscal(fiscal.items, { legalEntityId: ownerId }), [fiscal.items, ownerId]);
  const groups = useMemo(() => groupBalances(rows), [rows]);
  const stats = useMemo(() => summarizePhysical(rows), [rows]);
  const fiscalStats = useMemo(() => summarizeFiscal(fiscalRows), [fiscalRows]);
  const [sha256, setSha256] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSha256(null);
    setHashError(null);
    api<{ hash?: string }>(`/v1/stock/inspection-report?at=${encodeURIComponent(at)}`, { signal: controller.signal })
      .then((result) => {
        if (!active) return;
        setSha256(result.hash ?? null);
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, "WC_ERROR", copy.error.load);
        setHashError(explainStockError(apiError));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [at]);

  if (!allows(me, "inventory.read")) return <NoPermission />;

  const before = isBeforeStockEpoch(at) && !physical.loading && !fiscal.loading && rows.length === 0 && fiscalRows.length === 0;
  const loading = physical.loading || fiscal.loading;
  const error = physical.error ?? fiscal.error;
  const screen = loading ? "informe-cargando" : before ? "informe-antes" : "informe";
  const entity = filter === "all" ? "Todas las entidades" : entityName(filter);

  return (
    <div data-screen={screen} aria-busy={loading ? true : undefined} className="flex min-w-0 flex-col gap-4">
      <style>{`@media print { aside, header, nav, [data-print-hide] { display: none !important; } main, #contenido { padding: 0 !important; background: white !important; } }`}</style>
      <div data-print-hide>
        <PageHeader
          title="Informe de inspección"
          description="Existencias por recipiente y por mayor, con lote y añada, listas para imprimir."
          actions={
            <>
              <Button type="button" onClick={() => window.print()}>
                Imprimir / Guardar PDF
              </Button>
              <Button asChild variant="secondary">
                <Link to={`/stock?at=${encodeURIComponent(at)}`}>Volver</Link>
              </Button>
            </>
          }
        />
      </div>
      <header className="grid gap-1">
        <p className="text-meta text-muted-foreground">WineCore · Informe de existencias</p>
        <h2 className="text-title font-semibold">A {formatDateTime(at)}</h2>
        <p className="text-compact">{entity}</p>
        {sha256 ? <p className="text-meta break-all">Huella SHA-256 {sha256}</p> : null}
        {hashError ? <p className="text-compact text-destructive">{hashError}</p> : null}
      </header>
      {before ? (
        <EmptyState title="WineCore no tiene datos antes del aforo de arranque" description="Elige una fecha a partir del 01/01/2027." />
      ) : error ? (
        <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={() => { physical.reload(); fiscal.reload(); }} />
      ) : loading ? (
        <p className="text-compact text-muted-foreground">{copy.loading}</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Granel físico" value={formatMl(stats.bulkMl)} />
            <StatTile label="Envasado físico" value={`${formatUnits(stats.formats.reduce((sum, item) => sum + item.units, 0))} ud`} />
            <StatTile label="Granel fiscal" value={formatMl(fiscalStats.bulk.volumeMl + fiscalStats.bulk_wood.volumeMl)} />
            <StatTile label="Envasado fiscal" value={`${formatUnits(fiscalStats.packaged.units)} ud`} />
          </div>
          <Notice title="Dos libros">
            El físico dice dónde está cada cosa. El fiscal es el del establecimiento con CAE y no tiene por qué coincidir: se mueve con la factura.
          </Notice>
          <section className="grid min-w-0 gap-3">
            <h3 className="text-body font-semibold">Libro físico</h3>
            {groups.length === 0 ? <p className="text-compact text-muted-foreground">Sin existencias físicas.</p> : null}
            {groups.map((group) => (
              <div key={group.id} className="min-w-0">
                <h4 className="text-compact font-medium">
                  {group.name} ({group.code}) · {formatMl(group.volumeMl)}
                </h4>
                <ul className="mt-2 divide-y border-y md:hidden">
                  {group.rows.map((row) => (
                    <li key={`${row.vessel_id}:${row.lot_id}:${row.product_state}`} className="grid gap-0.5 py-2">
                      <p className="text-compact font-medium">{row.vessel_code ?? productLabel(row)}</p>
                      <p className="text-meta text-muted-foreground break-words">
                        {row.lot_code ?? "Sin lote"}
                        {row.vintage ? ` · ${row.vintage}` : ""} · {stateLabel(row.product_state)} · {ownerLabel(row.owner_code)}
                      </p>
                      <p className="text-compact tabular-nums">{row.qty_units ? `${formatUnits(row.qty_units)} ud` : formatMl(row.volume_ml)}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 hidden overflow-x-auto border border-border md:block">
                  <table className="w-full border-collapse text-compact">
                    <thead>
                      <tr>
                        {["Recipiente", "Lote", "Añada", "Producto o vino", "Estado", "Propietario", "Litros", "Unidades"].map((header) => (
                          <th key={header} className="h-11 border border-border bg-muted px-2 text-left font-medium">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr key={`${row.vessel_id}:${row.lot_id}:${row.product_id}:${row.product_state}`}>
                          <td className="border border-border px-2 py-2">{row.vessel_code ?? "—"}</td>
                          <td className="border border-border px-2 py-2">{row.lot_code ?? "—"}</td>
                          <td className="border border-border px-2 py-2">{row.vintage ?? "—"}</td>
                          <td className="border border-border px-2 py-2">{productLabel(row)}</td>
                          <td className="border border-border px-2 py-2">{stateLabel(row.product_state)}</td>
                          <td className="border border-border px-2 py-2">{ownerLabel(row.owner_code)}</td>
                          <td className="border border-border px-2 py-2 text-right tabular-nums">{formatMl(row.volume_ml)}</td>
                          <td className="border border-border px-2 py-2 text-right tabular-nums">{row.qty_units ? formatUnits(row.qty_units) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
          <section className="grid min-w-0 gap-3">
            <h3 className="text-body font-semibold">Libro fiscal</h3>
            {fiscalRows.length === 0 ? <p className="text-compact text-muted-foreground">Sin existencias fiscales para esta entidad.</p> : null}
            <ul className="divide-y border-y md:hidden">
              {fiscalRows.map((row) => (
                <li key={`${row.product_class}:${row.lot_id}:${row.excise_product_key}`} className="grid gap-0.5 py-2">
                  <p className="text-compact font-medium">{classLabel(row.product_class)} · {row.excise_product_key ?? row.tax_warehouse_name}</p>
                  <p className="text-meta text-muted-foreground">{productLabel(row)}{row.vintage ? ` · ${row.vintage}` : ""}</p>
                  <p className="text-compact tabular-nums">{row.units ? `${formatUnits(row.units)} ud` : formatMl(row.volume_ml)}</p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto border border-border md:block">
              <table className="w-full border-collapse text-compact">
                <thead>
                  <tr>
                    {["Establecimiento", "Mayor", "Referencia", "Lote", "Añada", "Litros", "Unidades"].map((header) => (
                      <th key={header} className="h-11 border border-border bg-muted px-2 text-left font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fiscalRows.map((row) => (
                    <tr key={`${row.product_class}:${row.lot_id}:${row.excise_product_key}`}>
                      <td className="border border-border px-2 py-2">{row.tax_warehouse_name}</td>
                      <td className="border border-border px-2 py-2">{classLabel(row.product_class)}</td>
                      <td className="border border-border px-2 py-2">{row.excise_product_key ?? "—"}</td>
                      <td className="border border-border px-2 py-2">{row.lot_code ?? "—"}</td>
                      <td className="border border-border px-2 py-2">{row.vintage ?? "—"}</td>
                      <td className="border border-border px-2 py-2 text-right tabular-nums">{formatMl(row.volume_ml)}</td>
                      <td className="border border-border px-2 py-2 text-right tabular-nums">{row.units ? formatUnits(row.units) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
