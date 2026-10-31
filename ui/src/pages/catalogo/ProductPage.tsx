import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Ellipsis } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { useMinWidth } from "@/hooks/use-media";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatDecimalMoney } from "@/lib/format";
import { allows } from "@/lib/permissions";
import type { Me } from "@/lib/types";
import { duplicateProduct, isStale, markGtinCurrent, moduleDisabled, setProductActive, updateProduct } from "@/pages/catalogo/api";
import { CatalogAudit } from "@/pages/catalogo/components/CatalogAudit";
import { SectionTabs } from "@/pages/catalogo/components/SectionTabs";
import { StockPanel } from "@/pages/catalogo/components/StockPanel";
import { cmpDecimal, formatAlcohol, formatQty } from "@/pages/catalogo/money";
import {
  formatCode,
  formatName,
  gtinCurrent,
  inputFromProduct,
  kindLabel,
  productOrganic,
  productWarnings,
  stockHeadline,
  taxLabel,
  unitLabel,
  wineName,
  type AuditEvent,
  type Format,
  type ListPage,
  type Product,
  type ProductInput,
  type ProductPrice,
  type StockBalance,
  type Wine,
} from "@/pages/catalogo/model";
import { ProductForm } from "@/pages/catalogo/ProductForm";
import { validateProduct } from "@/pages/catalogo/validate";

const TABS = [
  { id: "general", label: "General" },
  { id: "precios", label: "Precios" },
  { id: "fiscal", label: "Fiscal y aduanas" },
  { id: "edi", label: "EDI" },
  { id: "existencias", label: "Existencias" },
  { id: "historial", label: "Historial" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const FISCAL_FIELDS = new Set(["nc_code", "excise_product_key", "alcohol_pct", "sales_account", "default_tax_code"]);
const EDI_FIELDS = new Set(["gtin", "gtin_case"]);

export function ProductPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const product = useApi<Product>(id ? `/v1/products/${id}` : null);
  const wines = useApi<ListPage<Wine>>("/v1/wines?limit=100");
  const formats = useApi<ListPage<Format>>("/v1/formats?limit=100");

  if (!allows(me, "catalog.read")) return <NoPermission />;
  if (product.loading && !product.data) {
    return (
      <div data-screen="producto-cargando" aria-busy="true" className="grid gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (product.error || !product.data) {
    return (
      <ErrorState
        title={`${copy.error.load} (${product.error?.code ?? "WC_ERROR"})`}
        detail={product.error?.message}
        onRetry={product.reload}
      />
    );
  }

  return (
    <Loaded
      me={me}
      product={product.data}
      wines={wines.data?.items ?? []}
      formats={formats.data?.items ?? []}
      onReload={product.reload}
    />
  );
}

function Loaded({
  me,
  product,
  wines,
  formats,
  onReload,
}: {
  me: Me;
  product: Product;
  wines: Wine[];
  formats: Format[];
  onReload: () => void;
}) {
  const desktop = useMinWidth(768);
  const canWrite = allows(me, "catalog.write");
  const [tab, setTab] = useState<TabId>("general");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<ProductInput>(() => inputFromProduct(product));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmGtin, setConfirmGtin] = useState(false);
  const stock = useApi<ListPage<StockBalance>>(product.is_stock_tracked ? `/v1/stock/balances?product_id=${product.id}` : null);
  const prices = useApi<ListPage<ProductPrice>>(`/v1/products/${product.id}/prices`);
  const history = useApi<{ items: AuditEvent[]; next_cursor: string | null }>(
    tab === "historial" ? `/v1/audit?table=catalog.product&row_id=${product.id}` : null,
  );
  const stockOff = moduleDisabled(stock.error);
  const warnings = productWarnings(product);

  useEffect(() => {
    if (!editing) setValue(inputFromProduct(product));
  }, [editing, product]);

  async function save() {
    const found = validateProduct(value);
    setErrors(found);
    setDuplicate(null);
    const keys = Object.keys(found);
    if (keys.length > 0) {
      if (keys.some((key) => FISCAL_FIELDS.has(key))) setTab("fiscal");
      else if (keys.some((key) => EDI_FIELDS.has(key))) setTab("edi");
      else setTab("general");
      return;
    }
    setSaving(true);
    setStale(false);
    try {
      await updateProduct(product.id, value, product.updated_at);
      toast("Cambios guardados");
      setEditing(false);
      onReload();
    } catch (error: unknown) {
      if (isStale(error)) setStale(true);
      else if (duplicateProduct(error)) {
        setDuplicate(duplicateProduct(error));
        setTab("general");
      } else if (error instanceof ApiError && error.fields) setErrors(error.fields);
      else toast(error instanceof ApiError ? error.message : "No se ha podido guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setSaving(true);
    try {
      await setProductActive(product.id, !product.is_active, product.updated_at);
      setConfirmOff(false);
      onReload();
    } catch (error: unknown) {
      if (isStale(error)) setStale(true);
      else toast(error instanceof ApiError ? error.message : "No se ha podido cambiar el estado.");
    } finally {
      setSaving(false);
    }
  }

  async function makeCurrent() {
    setSaving(true);
    try {
      await markGtinCurrent(product.id);
      setConfirmGtin(false);
      toast("Este GTIN queda como el vigente");
      onReload();
    } catch (error: unknown) {
      toast(error instanceof ApiError ? error.message : "No se ha podido marcar el GTIN.");
    } finally {
      setSaving(false);
    }
  }

  const stockValue = !product.is_stock_tracked ? "—" : stock.loading ? "…" : stockOff || !stock.data ? "—" : stockHeadline(stock.data.items);
  const hasStock = stock.data ? stockHeadline(stock.data.items) !== "0 ud" && stockHeadline(stock.data.items) !== "—" : false;

  return (
    <div data-screen="producto" data-tab={tab} data-stock={stockOff ? "off" : stock.data ? "ready" : "loading"} className="flex flex-col gap-4">
      <Link to="/catalogo" className="text-compact text-muted-foreground">
        ← Productos
      </Link>
      <PageHeader
        title={product.name}
        description={`${kindLabel(product.kind)} · ${product.sku}`}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              {editing ? (
                <>
                  <Button type="button" onClick={() => void save()} disabled={saving}>
                    {saving ? "Guardando…" : "Guardar"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setEditing(false);
                      setErrors({});
                      setDuplicate(null);
                      setValue(inputFromProduct(product));
                    }}
                    disabled={saving}
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="secondary" size="icon" aria-label="Más acciones">
                    <Ellipsis aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="min-h-11"
                    variant={product.is_active ? "destructive" : "default"}
                    onSelect={() => setConfirmOff(true)}
                  >
                    {product.is_active ? "Desactivar" : "Reactivar"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : undefined
        }
      />
      <div className="flex flex-wrap gap-1.5">
        <StatusPill tone={product.is_active ? "success" : "neutral"}>{product.is_active ? "Activo" : "Inactivo"}</StatusPill>
        <StatusPill>{kindLabel(product.kind)}</StatusPill>
        {productOrganic(product, wines) ? <StatusPill tone="success">Ecológico</StatusPill> : null}
        {gtinCurrent(product) ? <StatusPill tone="info">GTIN vigente</StatusPill> : null}
        {warnings.map((warning) => (
          <StatusPill key={warning} tone="warning">
            {warning}
          </StatusPill>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-muted/70 px-3">
          <StatTile label="Existencias" value={stockValue} />
        </div>
        <div className="rounded-xl bg-muted/70 px-3">
          <StatTile label="GTIN" value={product.gtin || "Sin GTIN"} />
        </div>
        <div className="hidden rounded-xl bg-muted/70 px-3 md:block">
          <StatTile label="Formato" value={formatCode(product, formats)} />
        </div>
        <div className="hidden rounded-xl bg-muted/70 px-3 md:block">
          <StatTile label="Grado" value={formatAlcohol(product.alcohol_pct)} />
        </div>
      </div>
      {stale ? (
        <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-3">
          <p className="text-compact">WC_STALE_VERSION. El registro ha cambiado; vuelve a cargarlo.</p>
          <Button type="button" className="mt-3" onClick={onReload}>
            Recargar
          </Button>
        </div>
      ) : null}
      <SectionTabs id="producto-seccion" label="Secciones" tabs={[...TABS]} value={tab} onChange={setTab} />

      {tab === "general" ? (
        <div className="grid gap-4">
          <div className={editing ? "order-1" : "order-2"}>
            {editing ? (
              <ProductForm
                section="general"
                value={value}
                onChange={setValue}
                errors={errors}
                wines={wines}
                formats={formats}
                locked={Boolean(product.has_movements)}
                disabled={saving}
                duplicate={duplicate}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
                <Fact label="SKU" value={product.sku} />
                <Fact label="Vino" value={wineName(product, wines)} />
                <Fact label="Añada" value={product.vintage == null ? "—" : String(product.vintage)} />
                <Fact label="Formato" value={formatName(product, formats)} />
                <Fact label="Unidad" value={unitLabel(product.unit)} />
                <Fact label="Lote" value={product.requires_lot ? "Obligatorio" : "No"} />
                <Fact label="Inglés" value={product.name_en || "—"} />
                <Fact label="IVA" value={taxLabel(product.default_tax_code)} />
              </dl>
            )}
          </div>
          <div className={`grid gap-4 xl:grid-cols-5 ${editing ? "order-2" : "order-1"}`}>
            <section className="grid gap-3 xl:col-span-3">
              <h2 className="text-body font-semibold">Existencias por almacén</h2>
              <StockPanel
                productId={product.id}
                tracked={product.is_stock_tracked}
                rows={stock.data?.items ?? []}
                loading={stock.loading}
                error={stock.error}
                disabled={stockOff}
                onRetry={stock.reload}
              />
            </section>
            <div className="xl:col-span-2">
              <PricePanel prices={prices.data?.items ?? []} loading={prices.loading} error={prices.error} onRetry={prices.reload} />
            </div>
          </div>
        </div>
      ) : null}

      {tab === "precios" ? (
        <PricePanel prices={prices.data?.items ?? []} loading={prices.loading} error={prices.error} onRetry={prices.reload} />
      ) : null}

      {tab === "fiscal" ? (
        editing ? (
          <ProductForm section="fiscal" value={value} onChange={setValue} errors={errors} wines={wines} formats={formats} disabled={saving} />
        ) : (
          <dl className="max-w-xl">
            <Line label="IVA por defecto" value={taxLabel(product.default_tax_code)} />
            <Line label="Código NC" value={product.nc_code || "—"} />
            <Line label="Mayor SILICIE" value={product.excise_product_key || "—"} />
            <Line label="Grado declarado" value={formatAlcohol(product.alcohol_pct)} />
            <Line label="Cuenta de ventas" value={product.sales_account || "—"} />
          </dl>
        )
      ) : null}

      {tab === "edi" ? (
        <div className="grid max-w-xl gap-4">
          {editing ? (
            <ProductForm section="edi" value={value} onChange={setValue} errors={errors} wines={wines} formats={formats} disabled={saving} />
          ) : (
            <dl>
              <Line label="GTIN unidad" value={product.gtin || "—"} />
              <Line label="GTIN-14 caja" value={product.gtin_case || "—"} />
              <Line label="GTIN vigente" value={gtinCurrent(product) ? "Este producto" : "No"} />
            </dl>
          )}
          {canWrite && desktop ? (
            <div>
              <Button type="button" variant="secondary" disabled={!product.gtin || saving} onClick={() => setConfirmGtin(true)}>
                Marcar GTIN vigente
              </Button>
              {!product.gtin ? <p className="mt-2 text-meta text-muted-foreground">Primero indica el GTIN de la unidad.</p> : null}
            </div>
          ) : null}
          <CustomerCodes codes={product.customer_item_codes ?? []} />
        </div>
      ) : null}

      {tab === "existencias" ? (
        <section className="grid gap-3">
          <h2 className="text-body font-semibold">Existencias por almacén</h2>
          <StockPanel
            productId={product.id}
            tracked={product.is_stock_tracked}
            rows={stock.data?.items ?? []}
            loading={stock.loading}
            error={stock.error}
            disabled={stockOff}
            onRetry={stock.reload}
          />
        </section>
      ) : null}

      {tab === "historial" ? (
        <CatalogAudit
          items={history.data?.items ?? []}
          loading={history.loading}
          error={history.error ? `${copy.error.load} (${history.error.code})` : undefined}
          onRetry={history.reload}
        />
      ) : null}

      <ConfirmDialog
        open={confirmOff}
        title={product.is_active ? "Desactivar producto" : "Reactivar producto"}
        body={
          product.is_active
            ? hasStock
              ? `${product.name} tiene existencias. Dejará de ofrecerse en pedidos, pero no se borra.`
              : `${product.name} dejará de ofrecerse en pedidos. No se borra.`
            : `${product.name} volverá a ofrecerse en pedidos.`
        }
        confirmLabel={product.is_active ? "Desactivar" : "Reactivar"}
        danger={product.is_active}
        busy={saving}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => void toggleActive()}
      />
      <ConfirmDialog
        open={confirmGtin}
        title="Marcar GTIN vigente"
        body="Los pedidos de El Corte Inglés con este GTIN irán a esta añada."
        confirmLabel="Marcar vigente"
        busy={saving}
        onClose={() => setConfirmGtin(false)}
        onConfirm={() => void makeCurrent()}
      />
    </div>
  );
}

function PricePanel({
  prices,
  loading,
  error,
  onRetry,
}: {
  prices: ProductPrice[];
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (error) return <ErrorState title={`${copy.error.load} (${error.code})`} detail={error.message} onRetry={onRetry} />;
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <h2 className="text-body font-semibold">Precios vigentes</h2>
        <Link to="/catalogo/tarifas" className="text-compact text-muted-foreground underline">
          Tarifas
        </Link>
      </div>
      {prices.length === 0 ? (
        <p className="border-t px-3 py-4 text-compact text-muted-foreground">Sin precio en las tarifas activas.</p>
      ) : (
        <ul>
          {prices.map((price) => (
            <li key={`${price.price_list_id}-${price.min_qty}`} className="flex items-baseline justify-between gap-3 border-t px-3 py-2">
              <div className="min-w-0">
                <Link to={`/catalogo/tarifas/${price.price_list_id}`} className="text-compact font-medium">
                  {price.price_list_name || price.name || "Tarifa"}
                </Link>
                <p className="text-meta text-muted-foreground">
                  {price.tax_included ? "IVA incluido" : "IVA aparte"}
                  {price.min_qty && cmpDecimal(price.min_qty, "1") === 1 ? ` · desde ${formatQty(price.min_qty)}` : ""}
                  {price.version ? ` · v${price.version}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-compact font-medium tabular-nums">{formatDecimalMoney(price.unit_price)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t px-3 py-2 text-meta text-muted-foreground">Los precios se cambian en la tarifa, no en la ficha.</p>
    </section>
  );
}

function CustomerCodes({ codes }: { codes: Product["customer_item_codes"] }) {
  const rows = codes ?? [];
  return (
    <section>
      <h3 className="text-body font-semibold">Códigos de artículo del cliente</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-compact text-muted-foreground">Sin códigos de artículo de cliente.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {rows.map((row) => (
            <li key={`${row.contact_id}-${row.code}`} className="flex items-baseline justify-between gap-3 rounded-xl border px-3 py-2">
              <span className="min-w-0 truncate text-compact">{row.contact_name || row.contact_id}</span>
              <span className="text-compact font-medium">{row.code}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b py-2">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="truncate text-compact font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2">
      <dt className="text-compact text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-compact break-words">{value}</dd>
    </div>
  );
}
