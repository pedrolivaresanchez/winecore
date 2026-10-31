import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ErrorState } from "@/components/ErrorState";
import { NoPermission } from "@/components/NoPermission";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, TextArea } from "@/components/ui/native-field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { useMinWidth } from "@/hooks/use-media";
import { copy } from "@/i18n";
import { ApiError } from "@/lib/api";
import { formatDate, formatDecimalMoney } from "@/lib/format";
import { allows } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Me } from "@/lib/types";
import { createVersion, saveVersionItems } from "@/pages/catalogo/api";
import { Field } from "@/components/Field";
import { cmpDecimal, normalizeDecimal, showDecimal } from "@/pages/catalogo/money";
import {
  VERSION_LABELS,
  pickVersion,
  versionEditable,
  versionStatus,
  type ListPage,
  type PriceItem,
  type PriceList,
  type PriceListVersion,
  type Product,
  type VersionStatus,
} from "@/pages/catalogo/model";
import { validateMinQty, validatePrice } from "@/pages/catalogo/validate";

type Row = { key: string; product_id: string; min_qty: string; unit_price: string };

const TONE: Record<VersionStatus, StatusTone> = {
  draft: "neutral",
  pending: "warning",
  active: "success",
  retired: "neutral",
};

export function PriceListPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const lists = useApi<ListPage<PriceList>>("/v1/price-lists?limit=100");
  const versions = useApi<ListPage<PriceListVersion>>(id ? `/v1/price-lists/${id}/versions` : null);
  const products = useApi<ListPage<Product>>("/v1/products?limit=100");
  const list = lists.data?.items.find((item) => item.id === id) ?? null;

  if (!allows(me, "catalog.read")) return <NoPermission />;
  if ((lists.loading && !lists.data) || (versions.loading && !versions.data)) {
    return (
      <div data-screen="tarifa-cargando" aria-busy="true" className="grid gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (lists.error || versions.error || !lists.data || !versions.data) {
    const error = lists.error ?? versions.error;
    return (
      <ErrorState
        title={`${copy.error.load} (${error?.code ?? "WC_ERROR"})`}
        detail={error?.message}
        onRetry={() => {
          lists.reload();
          versions.reload();
        }}
      />
    );
  }
  if (!list) return <ErrorState title="No encuentro esa tarifa" />;

  return (
    <Editor
      me={me}
      list={list}
      versions={versions.data.items}
      products={products.data?.items ?? []}
      onReload={versions.reload}
    />
  );
}

function Editor({
  me,
  list,
  versions,
  products,
  onReload,
}: {
  me: Me;
  list: PriceList;
  versions: PriceListVersion[];
  products: Product[];
  onReload: () => void;
}) {
  const desktop = useMinWidth(768);
  const canWrite = allows(me, "catalog.write") && desktop;
  const ordered = useMemo(() => [...versions].sort((a, b) => b.version - a.version), [versions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chosen = ordered.find((version) => version.id === selectedId) ?? pickVersion(ordered);
  const [rows, setRows] = useState<Row[]>([]);
  const [baseline, setBaseline] = useState("");
  const rowsRef = useRef(rows);
  const baselineRef = useRef(baseline);
  const loadedVersionRef = useRef<string | null>(null);
  rowsRef.current = rows;
  baselineRef.current = baseline;
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [find, setFind] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!chosen) return;
    const next = (chosen.items ?? []).map((item) => ({
      key: item.id ?? `${item.product_id}-${item.min_qty}`,
      product_id: item.product_id,
      min_qty: showDecimal(item.min_qty),
      unit_price: showDecimal(item.unit_price),
    }));
    const serialized = JSON.stringify(next);
    const dirty = baselineRef.current !== "" && JSON.stringify(rowsRef.current) !== baselineRef.current;
    if (dirty && loadedVersionRef.current === chosen.id) return;
    loadedVersionRef.current = chosen.id;
    setRows(next);
    setBaseline(serialized);
    setRowErrors({});
    setBanner(null);
    setImportNotes([]);
    setShowDiff(false);
  }, [chosen]);

  const editable = Boolean(chosen && versionEditable(chosen) && canWrite);
  const status = chosen ? versionStatus(chosen) : null;
  const dirty = JSON.stringify(rows) !== baseline;
  const previous = chosen ? ordered.find((version) => version.version < chosen.version) : undefined;
  const missing = missingPrices(rows, products);
  const visible = rows.filter((row) => matches(row, find, products, chosen?.items ?? []));

  function productLabel(productId: string): string {
    const product = products.find((item) => item.id === productId);
    if (product) return `${product.sku} · ${product.name}`;
    const item = chosen?.items?.find((entry) => entry.product_id === productId);
    return item?.product_name || item?.product_sku || productId || "Elige un producto";
  }

  async function save() {
    if (!chosen) return;
    const errors: Record<string, string> = {};
    const items: PriceItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.product_id) {
        errors[row.key] = "Elige un producto.";
        continue;
      }
      const priceError = validatePrice(row.unit_price);
      const minError = validateMinQty(row.min_qty);
      if (priceError || minError) {
        errors[row.key] = priceError ?? minError ?? "Revisa el precio.";
        continue;
      }
      const price = normalizeDecimal(row.unit_price, 4).value;
      const min = normalizeDecimal(row.min_qty, 3).value;
      const key = `${row.product_id}|${min}`;
      if (seen.has(key)) {
        errors[row.key] = "Ese mínimo ya está en el producto.";
        continue;
      }
      seen.add(key);
      items.push({ product_id: row.product_id, min_qty: min, unit_price: price });
    }
    setRowErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setBanner(null);
    try {
      await saveVersionItems(list.id, chosen.version, items);
      const saved = JSON.stringify(rows);
      baselineRef.current = saved;
      setBaseline(saved);
      toast("Precios guardados");
      onReload();
    } catch (error: unknown) {
      const message = error instanceof ApiError ? error.message : "No se han podido guardar los precios.";
      setBanner(error instanceof ApiError && error.code === "WC050" ? `WC050. ${message}` : message);
    } finally {
      setSaving(false);
    }
  }

  function readCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""), products);
      setImportNotes(parsed.notes);
      if (parsed.rows.length > 0) {
        setRows((current) => mergeRows(current, parsed.rows));
        toast(parsed.rows.length === 1 ? "1 precio leído" : `${parsed.rows.length} precios leídos`);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div data-screen="tarifa" data-version={status ?? "none"} className="flex flex-col gap-4">
      <Link to="/catalogo/tarifas" className="text-compact text-muted-foreground">
        ← Tarifas
      </Link>
      <PageHeader
        title={list.name}
        description={`${list.code} · ${list.currency} · ${list.tax_included ? "IVA incluido" : "IVA aparte"}`}
        actions={
          canWrite ? (
            <Button type="button" onClick={() => setCreating(true)}>
              Nueva versión
            </Button>
          ) : undefined
        }
      />

      {ordered.length === 0 ? (
        <p className="text-compact text-muted-foreground">Esta tarifa todavía no tiene versiones.</p>
      ) : chosen && status ? (
        <>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Versiones">
            {ordered.map((version) => {
              const current = versionStatus(version);
              const selected = version.id === chosen.id;
              return (
                <button
                  key={version.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    "h-11 shrink-0 rounded-full px-3 text-compact md:h-8",
                    selected ? "bg-ink font-medium text-ink-foreground" : "bg-muted",
                  )}
                  onClick={() => setSelectedId(version.id)}
                >
                  v{version.version} · {VERSION_LABELS[current]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status === "pending" && chosen.approval_request_id ? (
              <Link to={`/aprobaciones/${chosen.approval_request_id}`}>
                <StatusPill tone="warning">Pendiente de aprobación</StatusPill>
              </Link>
            ) : (
              <StatusPill tone={TONE[status]}>{VERSION_LABELS[status]}</StatusPill>
            )}
            <p className="text-compact text-muted-foreground">
              {formatDate(chosen.valid_from)} → {chosen.valid_to ? formatDate(chosen.valid_to) : "abierta"}
            </p>
          </div>
          {chosen.notes ? <p className="text-compact">{chosen.notes}</p> : null}
          {status === "draft" ? (
            <p className="text-compact text-muted-foreground">Disponible al activar Aprobaciones</p>
          ) : null}
          {status === "active" || status === "retired" ? (
            <p role="status" className="text-compact text-muted-foreground">
              WC050. Versión de tarifa no editable. Crea una versión nueva.
            </p>
          ) : null}
          {banner ? (
            <p role="alert" className="text-compact text-destructive">
              {banner}
            </p>
          ) : null}
          {editable && missing.length > 0 ? (
            <p className="rounded-xl border border-status-warning bg-status-warning/40 px-3 py-2 text-compact text-status-warning-fg">
              {missing.length === 1
                ? `${missing[0]?.name ?? "Un producto"} no tiene precio en esta versión.`
                : `${missing.length} productos activos sin precio en esta versión.`}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="buscar-precio">
              Buscar producto
            </label>
            <Input
              id="buscar-precio"
              type="search"
              value={find}
              placeholder="Buscar producto"
              className="max-w-xs"
              onChange={(event) => setFind(event.target.value)}
            />
            {editable ? (
              <>
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                  Importar CSV
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) readCsv(file);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setRows((current) => [
                      ...current,
                      { key: crypto.randomUUID(), product_id: "", min_qty: "1", unit_price: "" },
                    ])
                  }
                >
                  Añadir precio
                </Button>
                <Button type="button" variant={dirty ? "primary" : "secondary"} onClick={() => void save()} disabled={saving || !dirty}>
                  {saving ? "Guardando…" : "Guardar precios"}
                </Button>
              </>
            ) : null}
          </div>
          {importNotes.length > 0 ? (
            <ul className="grid gap-1 text-compact text-destructive">
              {importNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <div className="hidden overflow-x-auto border md:block">
            <table className="w-full text-compact">
              <caption className="sr-only">Precios de la versión {chosen.version}</caption>
              <thead className="bg-muted">
                <tr>
                  <th className="h-11 border px-2 text-left font-medium">Producto</th>
                  <th className="h-11 border px-2 text-right font-medium">Precio</th>
                  <th className="h-11 border px-2 text-right font-medium">Mínimo</th>
                  {editable ? <th className="h-11 border px-2 font-medium"> </th> : null}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={editable ? 4 : 3} className="border px-3 py-6 text-center text-muted-foreground">
                      {rows.length === 0 ? "Sin precios en esta versión." : "Ningún producto coincide."}
                    </td>
                  </tr>
                ) : (
                  visible.map((row) => (
                    <tr key={row.key}>
                      <td className="border px-2 py-1.5">
                        {editable ? (
                          <NativeSelect
                            aria-label="Producto"
                            value={row.product_id}
                            onChange={(event) => updateRow(setRows, row.key, { product_id: event.target.value })}
                          >
                            <option value="">Elige un producto</option>
                            {optionsFor(row, products, chosen.items ?? []).map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect>
                        ) : (
                          productLabel(row.product_id)
                        )}
                        {rowErrors[row.key] ? <p className="mt-1 text-meta text-destructive">{rowErrors[row.key]}</p> : null}
                      </td>
                      <td className="w-36 border px-2 py-1.5">
                        <Input
                          aria-label="Precio"
                          inputMode="decimal"
                          className="text-right tabular-nums"
                          value={row.unit_price}
                          disabled={!editable}
                          onChange={(event) => updateRow(setRows, row.key, { unit_price: event.target.value })}
                        />
                      </td>
                      <td className="w-28 border px-2 py-1.5">
                        <Input
                          aria-label="Mínimo"
                          inputMode="decimal"
                          className="text-right tabular-nums"
                          value={row.min_qty}
                          disabled={!editable}
                          onChange={(event) => updateRow(setRows, row.key, { min_qty: event.target.value })}
                        />
                      </td>
                      {editable ? (
                        <td className="border px-2 py-1.5 text-right">
                          <button
                            type="button"
                            className="h-9 px-2 text-compact text-muted-foreground underline"
                            onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                          >
                            Quitar
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-3 md:hidden">
            {visible.length === 0 ? (
              <li className="rounded-xl border border-dashed px-4 py-8 text-center text-compact text-muted-foreground">
                {rows.length === 0 ? "Sin precios en esta versión." : "Ningún producto coincide."}
              </li>
            ) : (
              visible.map((row) => (
                <li key={row.key} className="rounded-xl border bg-card p-3">
                  <p className="text-body font-medium">{productLabel(row.product_id)}</p>
                  <p className="mt-1 text-compact tabular-nums">{priceText(row.unit_price)}</p>
                  <p className="text-meta text-muted-foreground">Mínimo {row.min_qty}</p>
                </li>
              ))
            )}
          </ul>

          {previous ? (
            <div className="grid gap-2">
              <button type="button" className="h-11 text-left text-compact underline md:h-8" onClick={() => setShowDiff((current) => !current)}>
                {showDiff ? "Ocultar cambios" : `Ver cambios respecto a v${previous.version}`}
              </button>
              {showDiff ? <Diff rows={rows} previous={previous.items ?? []} products={products} /> : null}
            </div>
          ) : null}
        </>
      ) : null}

      <VersionSheet
        open={creating}
        onOpenChange={setCreating}
        onCreate={async (body) => {
          const created = await createVersion(list.id, body, crypto.randomUUID());
          if (created.id) setSelectedId(created.id);
          onReload();
        }}
      />
    </div>
  );
}

function VersionSheet({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (body: { valid_from: string; valid_to: string | null; notes: string | null }) => Promise<void>;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFrom("");
    setTo("");
    setNotes("");
    setError(null);
  }, [open]);

  async function onSubmit() {
    if (!from) {
      setError("Indica desde cuándo vale la versión.");
      return;
    }
    if (to && to <= from) {
      setError("El fin tiene que ser posterior al inicio.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate({ valid_from: from, valid_to: to || null, notes: notes.trim() || null });
      toast("Versión creada");
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "No se ha podido crear la versión.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nueva versión</SheetTitle>
        </SheetHeader>
        <form
          className="grid gap-4 px-4 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <p className="text-compact text-muted-foreground">Se copia la versión vigente como borrador.</p>
          <Field id="valid_from" label="Vigente desde" error={error && !from ? error : undefined}>
            <Input id="valid_from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field id="valid_to" label="Hasta" hint="No incluida. Vacío si la vigencia sigue abierta." error={to && error ? error : undefined}>
            <Input id="valid_to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field id="version_notes" label="Notas">
            <TextArea id="version_notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          {error && from ? <p className="text-meta text-destructive">{error}</p> : null}
          <Button type="submit" disabled={saving}>
            {saving ? "Creando…" : "Crear borrador"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Diff({ rows, previous, products }: { rows: Row[]; previous: PriceItem[]; products: Product[] }) {
  const lines = useMemo(() => diffRows(rows, previous, products), [products, previous, rows]);
  if (lines.length === 0) return <p className="text-compact text-muted-foreground">Sin cambios de precio respecto a la versión anterior.</p>;
  return (
    <div className="overflow-x-auto border">
      <table className="w-full text-compact">
        <thead className="bg-muted">
          <tr>
            <th className="h-11 border px-2 text-left font-medium">Producto</th>
            <th className="h-11 border px-2 text-right font-medium">Antes</th>
            <th className="h-11 border px-2 text-right font-medium">Ahora</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <td className="border px-2 py-2">{line.name}</td>
              <td className="border px-2 py-2 text-right tabular-nums">{line.before}</td>
              <td className="border px-2 py-2 text-right tabular-nums">{line.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function diffRows(rows: Row[], previous: PriceItem[], products: Product[]) {
  const before = new Map(
    previous.map((item) => [`${item.product_id}|${normalizeDecimal(item.min_qty, 3).value || item.min_qty}`, item]),
  );
  const seen = new Set<string>();
  const lines: { key: string; name: string; before: string; after: string }[] = [];
  for (const row of rows) {
    const min = normalizeDecimal(row.min_qty, 3).value;
    const price = normalizeDecimal(row.unit_price, 4).value;
    if (!row.product_id || !min || !price) continue;
    const key = `${row.product_id}|${min}`;
    seen.add(key);
    const prev = before.get(key);
    const name = labelOf(row.product_id, products, previous);
    if (!prev) lines.push({ key, name, before: "—", after: formatDecimalMoney(price) });
    else if (cmpDecimal(prev.unit_price, price) !== 0) {
      lines.push({ key, name, before: formatDecimalMoney(prev.unit_price), after: formatDecimalMoney(price) });
    }
  }
  for (const item of previous) {
    const min = normalizeDecimal(item.min_qty, 3).value || item.min_qty;
    const key = `${item.product_id}|${min}`;
    if (seen.has(key)) continue;
    lines.push({
      key,
      name: item.product_name || labelOf(item.product_id, products, previous),
      before: formatDecimalMoney(item.unit_price),
      after: "—",
    });
  }
  return lines;
}

function labelOf(productId: string, products: Product[], items: PriceItem[]): string {
  const product = products.find((item) => item.id === productId);
  if (product) return product.name;
  return items.find((item) => item.product_id === productId)?.product_name || productId;
}

function optionsFor(row: Row, products: Product[], items: PriceItem[]) {
  const options = products.map((product) => ({ id: product.id, label: `${product.sku} · ${product.name}` }));
  if (row.product_id && !options.some((option) => option.id === row.product_id)) {
    const item = items.find((entry) => entry.product_id === row.product_id);
    options.unshift({ id: row.product_id, label: item?.product_name || item?.product_sku || row.product_id });
  }
  return options;
}

function updateRow(setRows: (value: (current: Row[]) => Row[]) => void, key: string, patch: Partial<Row>) {
  setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
}

function matches(row: Row, find: string, products: Product[], items: PriceItem[]): boolean {
  const needle = find.trim().toLowerCase();
  if (!needle) return true;
  const product = products.find((item) => item.id === row.product_id);
  const item = items.find((entry) => entry.product_id === row.product_id);
  const haystack = [product?.name, product?.sku, item?.product_name, item?.product_sku].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(needle);
}

function missingPrices(rows: Row[], products: Product[]) {
  const priced = new Set(rows.map((row) => row.product_id));
  return products
    .filter((product) => product.is_active && (product.kind === "wine" || product.kind === "bulk_wine") && !priced.has(product.id))
    .map((product) => ({ id: product.id, name: product.name }));
}

function priceText(value: string): string {
  const parsed = normalizeDecimal(value, 4);
  return parsed.value ? formatDecimalMoney(parsed.value) : value || "—";
}

function parseCsv(text: string, products: Product[]): { rows: Row[]; notes: string[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], notes: ["El archivo está vacío."] };
  const delimiter = (lines[0] ?? "").includes(";") ? ";" : ",";
  let start = 0;
  const header = (lines[0] ?? "").toLowerCase();
  if (header.includes("sku") || header.includes("precio") || header.includes("producto")) start = 1;
  const rows: Row[] = [];
  const notes: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const cells = (lines[index] ?? "").split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const sku = cells[0] ?? "";
    const price = cells[1] ?? "";
    const min = cells[2] || "1";
    const product = products.find((item) => item.sku.toLowerCase() === sku.toLowerCase() || item.id === sku);
    if (!product) {
      notes.push(`Fila ${index + 1}: no encuentro el SKU ${sku}.`);
      continue;
    }
    const parsedPrice = normalizeDecimal(price, 4);
    const parsedMin = normalizeDecimal(min, 3);
    if (!parsedPrice.value || parsedPrice.error) {
      notes.push(`Fila ${index + 1}: ${parsedPrice.error ?? "precio vacío"}.`);
      continue;
    }
    if (!parsedMin.value || parsedMin.error || cmpDecimal(parsedMin.value, "0") !== 1) {
      notes.push(`Fila ${index + 1}: el mínimo no es válido.`);
      continue;
    }
    rows.push({
      key: crypto.randomUUID(),
      product_id: product.id,
      min_qty: showDecimal(parsedMin.value),
      unit_price: showDecimal(parsedPrice.value),
    });
  }
  if (rows.length === 0 && notes.length === 0) notes.push("No hay filas de precio.");
  return { rows, notes };
}

function mergeRows(current: Row[], incoming: Row[]): Row[] {
  const next = [...current];
  for (const row of incoming) {
    const min = normalizeDecimal(row.min_qty, 3).value;
    const index = next.findIndex((item) => item.product_id === row.product_id && normalizeDecimal(item.min_qty, 3).value === min);
    if (index >= 0) next[index] = { ...next[index], unit_price: row.unit_price, key: next[index]?.key ?? row.key };
    else next.push(row);
  }
  return next;
}
