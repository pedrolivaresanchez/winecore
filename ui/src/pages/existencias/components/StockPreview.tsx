import { Link } from "react-router-dom";
import { SlideOver } from "@/components/SlideOver";
import { Button } from "@/components/ui/button";
import type { StockBalance } from "@/pages/existencias/api";
import { ownerLabel, productLabel, stateLabel } from "@/pages/existencias/labels";
import { formatMl, formatPercentCapacity, formatUnits } from "@/pages/existencias/volume";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-compact break-words">{value}</dd>
    </div>
  );
}

export function StockPreview({
  row,
  index,
  total,
  onOpenChange,
  onPrev,
  onNext,
}: {
  row: StockBalance | null;
  index: number;
  total: number;
  onOpenChange: (open: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const title = row ? (row.vessel_code ?? productLabel(row)) : "Existencia";
  return (
    <SlideOver
      open={Boolean(row)}
      onOpenChange={onOpenChange}
      title={title}
      description={row ? `${row.location_name} · ${stateLabel(row.product_state)}` : undefined}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={index <= 0}
      nextDisabled={index < 0 || index >= total - 1}
      screen="existencia-preview"
    >
      {row ? (
        <div className="grid gap-4">
          <dl>
            <Row label="Ubicación" value={`${row.location_name} (${row.location_code})`} />
            <Row label="Recipiente" value={row.vessel_code ?? "—"} />
            <Row label="Lote" value={row.lot_code ?? "—"} />
            <Row label="Producto o vino" value={productLabel(row)} />
            <Row label="Estado" value={stateLabel(row.product_state)} />
            <Row label="Propietario" value={ownerLabel(row.owner_code)} />
            <Row label="Litros" value={formatMl(row.volume_ml)} />
            <Row label="Unidades" value={row.qty_units ? formatUnits(row.qty_units) : "—"} />
            {row.vessel_capacity_ml ? <Row label="Llenado" value={formatPercentCapacity(row.volume_ml, row.vessel_capacity_ml)} /> : null}
          </dl>
          <div className="grid gap-2">
            {row.lot_code ? (
              <Button asChild variant="secondary">
                <Link to={`/bodega/lotes/${row.lot_code}`}>Ver trazabilidad del lote</Link>
              </Button>
            ) : null}
            {row.vessel_code ? (
              <Button asChild variant="secondary">
                <Link to={`/bodega/depositos/${row.vessel_code}`}>Abrir el recipiente</Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </SlideOver>
  );
}
