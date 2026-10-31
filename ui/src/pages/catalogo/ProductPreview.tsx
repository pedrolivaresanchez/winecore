import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { SlideOver } from "@/components/SlideOver";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { setProductActive } from "@/pages/catalogo/api";
import { formatAlcohol, formatQty, isPositiveDecimal } from "@/pages/catalogo/money";
import {
  formatCode,
  kindLabel,
  productWarnings,
  taxLabel,
  wineName,
  type Format,
  type Product,
  type Wine,
} from "@/pages/catalogo/model";

export function ProductPreview({
  id,
  ids,
  index,
  wines,
  formats,
  canWrite,
  onOpenChange,
  onSelect,
  onChanged,
}: {
  id: string | null;
  ids: string[];
  index: number;
  wines: Wine[];
  formats: Format[];
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const product = useApi<Product>(id ? `/v1/products/${id}` : null);
  const ready = Boolean(id && product.data && product.data.id === id);

  return (
    <SlideOver
      open={Boolean(id)}
      onOpenChange={onOpenChange}
      title={ready && product.data ? product.data.name : "Producto"}
      description={ready && product.data ? product.data.sku : undefined}
      onPrev={index > 0 ? () => onSelect(ids[index - 1] ?? "") : undefined}
      onNext={index >= 0 && index < ids.length - 1 ? () => onSelect(ids[index + 1] ?? "") : undefined}
      prevDisabled={index <= 0}
      nextDisabled={index < 0 || index >= ids.length - 1}
      screen="producto-preview"
    >
      {!id ? null : product.loading || product.data?.id !== id ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : product.error || !product.data ? (
        <ErrorState title={`${copy.error.load} (${product.error?.code ?? "WC_ERROR"})`} detail={product.error?.message} onRetry={product.reload} />
      ) : (
        <PreviewBody
          product={product.data}
          wines={wines}
          formats={formats}
          canWrite={canWrite}
          onChanged={() => {
            product.reload();
            onChanged();
          }}
        />
      )}
    </SlideOver>
  );
}

function PreviewBody({
  product,
  wines,
  formats,
  canWrite,
  onChanged,
}: {
  product: Product;
  wines: Wine[];
  formats: Format[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const warnings = productWarnings(product);
  const hasStock = isPositiveDecimal(product.on_hand_qty);

  async function toggleActive() {
    setBusy(true);
    try {
      await setProductActive(product.id, !product.is_active, product.updated_at);
      setConfirm(false);
      toast(product.is_active ? "Producto desactivado" : "Producto activado");
      onChanged();
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : "No se ha podido cambiar el estado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Button asChild className="w-full">
        <Link to={`/catalogo/${product.id}`}>Abrir ficha</Link>
      </Button>
      <dl className="grid gap-2 text-compact">
        <Row label="SKU" value={product.sku} />
        <Row label="Tipo" value={kindLabel(product.kind)} />
        <Row label="Vino" value={wineName(product, wines)} />
        <Row label="Añada" value={product.vintage == null ? "—" : String(product.vintage)} />
        <Row label="Formato" value={formatCode(product, formats)} />
        <Row label="GTIN" value={product.gtin || "—"} />
        <Row label="NC" value={product.nc_code || "—"} />
        <Row label="Grado" value={formatAlcohol(product.alcohol_pct)} />
        <Row label="IVA" value={taxLabel(product.default_tax_code)} />
        <Row label="Existencias" value={product.on_hand_qty ? `${formatQty(product.on_hand_qty)} ud` : "—"} />
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <StatusPill tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "Activo" : "Inactivo"}</StatusPill>
        {product.gtin_is_current ? <StatusPill tone="info">GTIN vigente</StatusPill> : null}
        {warnings.map((warning) => (
          <StatusPill key={warning} tone="warning">
            {warning}
          </StatusPill>
        ))}
      </div>
      {canWrite ? (
        <Button
          type="button"
          variant={product.is_active ? "danger" : "secondary"}
          onClick={() => {
            if (product.is_active && hasStock) setConfirm(true);
            else void toggleActive();
          }}
        >
          {product.is_active ? "Desactivar" : "Activar"}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirm}
        title="Desactivar producto"
        body={`${product.name} tiene existencias. Dejará de ofrecerse en pedidos, pero no se borra.`}
        confirmLabel="Desactivar"
        danger
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => void toggleActive()}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right break-words">{value}</dd>
    </div>
  );
}
