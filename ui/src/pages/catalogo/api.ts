import { ApiError, api, apiText } from "@/lib/api";
import type {
  Format,
  FormatInput,
  ListPage,
  PriceItem,
  PriceList,
  PriceListVersion,
  Product,
  ProductInput,
  ProductPrice,
  ProductQuery,
  StockBalance,
  Wine,
  WineInput,
} from "@/pages/catalogo/model";
import { formatBody, productBody, productQuery, wineBody } from "@/pages/catalogo/model";

function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asProduct(raw: Product): Product {
  return {
    ...raw,
    name_en: raw.name_en ?? null,
    wine_id: raw.wine_id ?? null,
    vintage: raw.vintage ?? null,
    format_id: raw.format_id ?? null,
    gtin: raw.gtin ?? null,
    gtin_case: raw.gtin_case ?? null,
    nc_code: raw.nc_code ?? null,
    excise_product_key: raw.excise_product_key ?? null,
    alcohol_pct: text(raw.alcohol_pct),
    default_tax_code: raw.default_tax_code ?? null,
    sales_account: raw.sales_account ?? null,
    is_stock_tracked: raw.is_stock_tracked ?? true,
    requires_lot: raw.requires_lot ?? raw.kind === "wine",
    is_active: raw.is_active ?? true,
    legacy_refs: raw.legacy_refs ?? {},
    on_hand_qty: text(raw.on_hand_qty),
    customer_item_codes: raw.customer_item_codes ?? [],
  };
}

function asPage<T>(page: ListPage<T>, map: (item: T) => T): ListPage<T> {
  return { items: page.items.map(map), next_cursor: page.next_cursor, total: page.total };
}

export function listProducts(query: ProductQuery, signal?: AbortSignal) {
  return api<ListPage<Product>>(productQuery(query), { signal }).then((page) => asPage(page, asProduct));
}

export function getProduct(id: string, signal?: AbortSignal) {
  return api<Product>(`/v1/products/${id}`, { signal }).then(asProduct);
}

export function createProduct(input: ProductInput, idempotencyKey: string) {
  return api<Product>("/v1/products", {
    method: "POST",
    body: JSON.stringify(productBody(input)),
    headers: { "Idempotency-Key": idempotencyKey },
  }).then(asProduct);
}

export function updateProduct(id: string, input: ProductInput, updatedAt: string) {
  return api<Product>(`/v1/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(productBody(input)),
    headers: { "If-Match": updatedAt },
  }).then(asProduct);
}

export function setProductActive(id: string, active: boolean, updatedAt: string) {
  return api<Product>(`/v1/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: active }),
    headers: { "If-Match": updatedAt },
  }).then(asProduct);
}

export function markGtinCurrent(id: string) {
  return api<{ gtin?: string; product_id?: string }>(`/v1/products/${id}/gtin-current`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function productPrices(id: string, signal?: AbortSignal) {
  return api<ListPage<ProductPrice>>(`/v1/products/${id}/prices`, { signal }).then((page) =>
    asPage(page, (item) => ({
      ...item,
      unit_price: text(item.unit_price) ?? "0",
      min_qty: text(item.min_qty) ?? "1",
      price_list_name: item.price_list_name || item.name,
      price_list_code: item.price_list_code || item.code,
    })),
  );
}

export function stockBalances(productId: string, signal?: AbortSignal) {
  return api<ListPage<StockBalance>>(`/v1/stock/balances?product_id=${encodeURIComponent(productId)}`, { signal }).then((page) =>
    asPage(page, (item) => ({
      ...item,
      qty_units: text(item.qty_units),
      qty_ml: text(item.qty_ml),
      quantity: text(item.quantity),
    })),
  );
}

export function listWines(signal?: AbortSignal) {
  return api<ListPage<Wine>>("/v1/wines?limit=100", { signal });
}

export function createWine(input: WineInput, idempotencyKey: string) {
  return api<Wine>("/v1/wines", {
    method: "POST",
    body: JSON.stringify(wineBody(input)),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function listFormats(signal?: AbortSignal) {
  return api<ListPage<Format>>("/v1/formats?limit=100", { signal });
}

export function createFormat(input: FormatInput, idempotencyKey: string) {
  return api<Format>("/v1/formats", {
    method: "POST",
    body: JSON.stringify(formatBody(input)),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function listPriceLists(signal?: AbortSignal) {
  return api<ListPage<PriceList>>("/v1/price-lists?limit=100", { signal });
}

export function listVersions(priceListId: string, signal?: AbortSignal) {
  return api<ListPage<PriceListVersion>>(`/v1/price-lists/${priceListId}/versions`, { signal }).then((page) =>
    asPage(page, (version) => ({
      ...version,
      items: (version.items ?? []).map((item) => ({
        ...item,
        unit_price: text(item.unit_price) ?? "0",
        min_qty: text(item.min_qty) ?? "1",
      })),
    })),
  );
}

export function createVersion(
  priceListId: string,
  body: { valid_from: string; valid_to: string | null; notes: string | null },
  idempotencyKey: string,
) {
  return api<PriceListVersion>(`/v1/price-lists/${priceListId}/versions`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function saveVersionItems(priceListId: string, version: number, items: PriceItem[]) {
  return api<ListPage<PriceItem>>(`/v1/price-lists/${priceListId}/versions/${version}/items`, {
    method: "PUT",
    body: JSON.stringify({
      items: items.map((item) => ({
        product_id: item.product_id,
        min_qty: item.min_qty,
        unit_price: item.unit_price,
      })),
    }),
  });
}

export function requestActivation(priceListId: string, version: number) {
  return api<{ id?: string; approval_request_id?: string; status?: string }>(
    `/v1/price-lists/${priceListId}/versions/${version}/request-activation`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function exportProducts(query: ProductQuery) {
  const path = productQuery(query).replace("/v1/products?", "/v1/products/export.csv?");
  const csv = await apiText(path);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "productos.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.code === "WC_STALE_VERSION";
}

export function moduleDisabled(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  return error.code === "WC_MODULE_DISABLED" || error.code === "WC_NOT_FOUND";
}

export function duplicateProduct(error: unknown): { id: string; name: string } | null {
  if (!(error instanceof ApiError) || !error.details) return null;
  if (error.status !== 409 && error.status !== 422) return null;
  const id = error.details.existing_id;
  const name = error.details.existing_name;
  if (typeof id === "string" && typeof name === "string") return { id, name };
  return null;
}
