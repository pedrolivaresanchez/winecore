import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { SlideOver } from "@/components/SlideOver";
import { Button } from "@/components/ui/button";
import { periodClosedText } from "@/pages/existencias/explain";
import type { MoveView } from "@/pages/existencias/move-view";
import { formatMl, formatSignedUnits } from "@/pages/existencias/volume";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-compact break-words">{value}</dd>
    </div>
  );
}

export function MovePreview({
  row,
  index,
  total,
  onOpenChange,
  onPrev,
  onNext,
}: {
  row: MoveView | null;
  index: number;
  total: number;
  onOpenChange: (open: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <SlideOver
      open={Boolean(row)}
      onOpenChange={onOpenChange}
      title={row?.moveType ?? "Movimiento"}
      description={row?.document}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={index <= 0}
      nextDisabled={index < 0 || index >= total - 1}
      screen="movimiento-preview"
    >
      {row ? (
        <div className="grid gap-4">
          {row.locked ? (
            <p className="flex items-start gap-2 text-compact">
              <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{periodClosedText(row.lockedUntil)}</span>
            </p>
          ) : (
            <p className="text-compact text-muted-foreground">Los movimientos no se modifican. Para corregir uno, rectifica el documento de origen.</p>
          )}
          <dl>
            <Row label="Fecha" value={row.when} />
            {row.whenDetail ? <Row label="Otra fecha" value={row.whenDetail} /> : null}
            <Row label="Tipo" value={row.moveType} />
            <Row label={row.book === "fiscal" ? "Mayor" : "Dónde"} value={row.place} />
            <Row label="Lote" value={row.lot} />
            <Row label="Producto" value={row.product} />
            <Row label="Litros" value={formatMl(row.volumeMl)} />
            <Row label="Unidades" value={row.units ? formatSignedUnits(row.units) : "—"} />
            <Row label="Documento" value={row.document} />
            <Row label="Justificante" value={row.justification} />
            <Row label="Asiento SILICIE" value={row.silicie} />
            <Row label="Usuario" value={row.user} />
          </dl>
          {row.href ? (
            <Button asChild variant="secondary">
              <Link to={row.href}>Abrir el documento</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </SlideOver>
  );
}
