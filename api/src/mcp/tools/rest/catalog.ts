import { Decimal } from "decimal.js";
import { z } from "zod";

import { domainError } from "../../../core/errors";
import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.guid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD");
const qty = z.string().regex(/^\d+(\.\d{1,3})?$/).describe("Cantidad decimal en texto, hasta 3 decimales, mayor que 0");
const price = z.string().regex(/^\d+(\.\d{1,4})?$/).describe("Precio sin IVA en texto, hasta 4 decimales");
const gtin = z.string().regex(/^(\d{8}|\d{12}|\d{13}|\d{14})$/).describe("GTIN/EAN de 8, 12, 13 o 14 dígitos con dígito de control válido");
const page = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(400).optional(),
};

const PRODUCT_KINDS = [
  "wine", "bulk_wine", "packaging_material", "oenological_product",
  "merchandise", "service", "gift_card", "other",
] as const;
const PRODUCT_UNITS = ["ud", "l", "kg", "h", "month", "service"] as const;
const WINE_COLORS = ["red", "white", "rose", "orange", "sweet", "sparkling", "other"] as const;
const WINE_CATEGORIES = ["wine", "pgi_wine", "pdo_wine", "fortified", "other"] as const;
const CONTAINERS = ["bottle", "bag_in_box", "keg", "other"] as const;
const CHANNELS = [
  "direct", "distributor", "horeca", "eci_edi", "web", "fair", "cellar_shop", "export", "institutional", "intercompany",
] as const;

const productFilters = {
  q: z.string().max(80).optional().describe("SKU, nombre o GTIN"),
  kind: z.enum(PRODUCT_KINDS).optional(),
  wine_id: id.optional(),
  format_id: id.optional(),
  vintage: z.number().int().min(1990).max(2100).optional().describe("Añada"),
  active: z.boolean().optional().describe("true solo los activos, false solo los archivados; sin indicarlo salen todos"),
  organic: z.boolean().optional().describe("Solo productos de vinos ecológicos (true) o no ecológicos (false)"),
  missing: z.enum(["gtin", "nc_code", "silicie"]).optional().describe("Productos a los que les falta el GTIN, el código NC o la clave SILICIE"),
  gtin: gtin.optional(),
};

const productSchema = {
  sku: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,39}$/).describe("Código interno en mayúsculas, p. ej. TINTO-23-75"),
  name: z.string().min(2).max(120),
  name_en: z.string().max(120).describe("Nombre en inglés"),
  kind: z.enum(PRODUCT_KINDS).describe("wine = vino embotellado; bulk_wine = granel; packaging_material = material de envasado"),
  wine_id: id.describe("Vino del catálogo (catalog_wines_list); obligatorio si kind es wine"),
  vintage: z.number().int().min(1990).max(2100).describe("Añada; obligatoria si kind es wine"),
  format_id: id.describe("Formato (catalog_formats_list); obligatorio si kind es wine"),
  unit: z.enum(PRODUCT_UNITS).describe("Unidad de venta; por defecto ud"),
  gtin,
  gtin_case: z.string().regex(/^\d{14}$/).describe("GTIN de la caja (14 dígitos)"),
  nc_code: z.string().regex(/^\d{8}$/).describe("Código NC de aduanas (8 dígitos)"),
  excise_product_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/).describe("Clave de producto SILICIE"),
  alcohol_pct: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).describe("Grado alcohólico en texto, 0 a 25, hasta 2 decimales"),
  default_tax_code: z.string().regex(/^[A-Z0-9_]{2,20}$/).describe("Código de IVA por defecto"),
  sales_account: z.string().regex(/^7\d{2,7}$/).describe("Cuenta contable de ventas (empieza por 7)"),
  is_stock_tracked: z.boolean().describe("Lleva existencias; un servicio o tarjeta regalo no"),
  requires_lot: z.boolean().describe("Exige lote; el vino siempre"),
  is_active: z.boolean().describe("false archiva el producto"),
  legacy_refs: z.record(z.string(), z.unknown()).describe("Referencias del sistema anterior"),
};

const productCreate = z.object({
  sku: productSchema.sku,
  name: productSchema.name,
  kind: productSchema.kind,
  name_en: productSchema.name_en.optional(),
  wine_id: productSchema.wine_id.optional(),
  vintage: productSchema.vintage.optional(),
  format_id: productSchema.format_id.optional(),
  unit: productSchema.unit.optional(),
  gtin: productSchema.gtin.optional(),
  gtin_case: productSchema.gtin_case.optional(),
  nc_code: productSchema.nc_code.optional(),
  excise_product_key: productSchema.excise_product_key.optional(),
  alcohol_pct: productSchema.alcohol_pct.optional(),
  default_tax_code: productSchema.default_tax_code.optional(),
  sales_account: productSchema.sales_account.optional(),
  is_stock_tracked: productSchema.is_stock_tracked.optional(),
  requires_lot: productSchema.requires_lot.optional(),
  is_active: productSchema.is_active.optional(),
  legacy_refs: productSchema.legacy_refs.optional(),
}).strict();

const productChanges = z.object({
  sku: productSchema.sku.optional(),
  name: productSchema.name.optional(),
  kind: productSchema.kind.optional(),
  name_en: productSchema.name_en.nullable().optional(),
  wine_id: productSchema.wine_id.nullable().optional(),
  vintage: productSchema.vintage.nullable().optional(),
  format_id: productSchema.format_id.nullable().optional(),
  unit: productSchema.unit.optional(),
  gtin: productSchema.gtin.nullable().optional(),
  gtin_case: productSchema.gtin_case.nullable().optional(),
  nc_code: productSchema.nc_code.nullable().optional(),
  excise_product_key: productSchema.excise_product_key.nullable().optional(),
  alcohol_pct: productSchema.alcohol_pct.nullable().optional(),
  default_tax_code: productSchema.default_tax_code.nullable().optional(),
  sales_account: productSchema.sales_account.nullable().optional(),
  is_stock_tracked: productSchema.is_stock_tracked.optional(),
  requires_lot: productSchema.requires_lot.optional(),
  is_active: productSchema.is_active.optional(),
  legacy_refs: productSchema.legacy_refs.optional(),
}).strict();

const wineSchema = {
  code: z.string().regex(/^[A-Z0-9-]{2,20}$/).describe("Código en mayúsculas, dígitos o guion, p. ej. TINTO-RES"),
  name: z.string().min(1).max(120),
  color: z.enum(WINE_COLORS),
  category: z.enum(WINE_CATEGORIES).describe("pdo_wine = DOP, pgi_wine = IGP; por defecto wine"),
  pdo_pgi_name: z.string().max(120).describe("Nombre de la DOP o IGP"),
  is_single_plot: z.boolean().describe("Vino de parcela"),
  is_organic: z.boolean().describe("Ecológico; por defecto true"),
  no_added_sulfites: z.boolean().describe("Sin sulfitos añadidos"),
  description: z.string().max(4000),
  is_active: z.boolean().describe("false archiva el vino"),
};

const wineCreate = z.object({
  code: wineSchema.code,
  name: wineSchema.name,
  color: wineSchema.color,
  category: wineSchema.category.optional(),
  pdo_pgi_name: wineSchema.pdo_pgi_name.optional(),
  is_single_plot: wineSchema.is_single_plot.optional(),
  is_organic: wineSchema.is_organic.optional(),
  no_added_sulfites: wineSchema.no_added_sulfites.optional(),
  description: wineSchema.description.optional(),
  is_active: wineSchema.is_active.optional(),
}).strict();

const wineChanges = z.object({
  code: wineSchema.code.optional(),
  name: wineSchema.name.optional(),
  color: wineSchema.color.optional(),
  category: wineSchema.category.optional(),
  pdo_pgi_name: wineSchema.pdo_pgi_name.nullable().optional(),
  is_single_plot: wineSchema.is_single_plot.optional(),
  is_organic: wineSchema.is_organic.optional(),
  no_added_sulfites: wineSchema.no_added_sulfites.optional(),
  description: wineSchema.description.nullable().optional(),
  is_active: wineSchema.is_active.optional(),
}).strict();

const grams = z.number().int().min(1).max(2147483647);
const formatSchema = {
  code: z.string().regex(/^[A-Z0-9]{2,10}$/).describe("Código en mayúsculas o dígitos, p. ej. B75"),
  name: z.string().min(1).max(120),
  container: z.enum(CONTAINERS),
  nominal_volume_ml: z.number().int().min(1).max(2147483647).describe("Volumen nominal en mililitros (750 = botella de 0,75 L)"),
  units_per_case: z.number().int().min(1).max(32767).describe("Unidades por caja; por defecto 6"),
  cases_per_pallet: z.number().int().min(1).max(32767).describe("Cajas por palé; por defecto 112"),
  unit_gross_weight_g: grams.describe("Peso bruto por unidad en gramos"),
  unit_net_weight_g: grams.describe("Peso neto por unidad en gramos; no puede superar al bruto"),
  is_active: z.boolean().describe("false archiva el formato"),
};

const formatCreate = z.object({
  code: formatSchema.code,
  name: formatSchema.name,
  container: formatSchema.container,
  nominal_volume_ml: formatSchema.nominal_volume_ml,
  units_per_case: formatSchema.units_per_case.optional(),
  cases_per_pallet: formatSchema.cases_per_pallet.optional(),
  unit_gross_weight_g: formatSchema.unit_gross_weight_g.optional(),
  unit_net_weight_g: formatSchema.unit_net_weight_g.optional(),
  is_active: formatSchema.is_active.optional(),
}).strict();

const formatChanges = z.object({
  code: formatSchema.code.optional(),
  name: formatSchema.name.optional(),
  container: formatSchema.container.optional(),
  nominal_volume_ml: formatSchema.nominal_volume_ml.optional(),
  units_per_case: formatSchema.units_per_case.optional(),
  cases_per_pallet: formatSchema.cases_per_pallet.optional(),
  unit_gross_weight_g: formatSchema.unit_gross_weight_g.nullable().optional(),
  unit_net_weight_g: formatSchema.unit_net_weight_g.nullable().optional(),
  is_active: formatSchema.is_active.optional(),
}).strict();

const materialFields = z.object({
  material_product_id: id.describe("Producto de tipo packaging_material, activo y con existencias"),
  per: z.enum(["unit", "case", "pallet"]).describe("Base de la cantidad: por botella, por caja o por palé"),
  quantity: qty,
}).strict();

const priceListName = z.string().min(1).max(120);
const priceListFlags = {
  currency: z.literal("EUR").optional(),
  tax_included: z.boolean().optional().describe("Los precios incluyen IVA"),
  is_active: z.boolean().optional().describe("false archiva la tarifa"),
};

const priceItem = z.object({
  product_id: id,
  min_qty: qty.describe("Cantidad mínima desde la que aplica el precio (1 para el precio base)"),
  unit_price: price,
}).strict();
const priceKey = z.object({ product_id: id, min_qty: qty }).strict();

type PriceItem = z.infer<typeof priceItem>;
type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(body: unknown): string | null {
  return isRecord(body) && typeof body.id === "string" ? body.id : null;
}

function productLabel(current: unknown): string {
  if (!isRecord(current)) return "";
  return [current.sku, current.name].filter((part) => typeof part === "string" && part !== "").join(" · ");
}

function versionOf(current: unknown, version: number): Fields | null {
  const versions = isRecord(current) && Array.isArray(current.items) ? current.items : [];
  const found = versions.find((item) => isRecord(item) && item.version === version);
  return isRecord(found) ? found : null;
}

function itemKey(productId: string, minQty: string): string {
  return `${productId.toLowerCase()}|${new Decimal(minQty).toFixed(3)}`;
}

interface ItemsInput {
  version: number;
  items?: PriceItem[];
  upsert?: PriceItem[];
  remove?: { product_id: string; min_qty: string }[];
}

/** The route replaces every price of the draft: `upsert`/`remove` are applied to the draft's current prices. */
function priceItemsBody(input: ItemsInput, current: unknown): { items: PriceItem[] } {
  const changes = input.upsert !== undefined || input.remove !== undefined;
  if (input.items) {
    if (changes) throw domainError("WC_VALIDATION", { items: "Manda la lista completa o los cambios, no las dos cosas" });
    return { items: input.items };
  }
  if (!changes) throw domainError("WC_VALIDATION", { items: "Manda items, upsert o remove" });
  const version = versionOf(current, input.version);
  if (!version) {
    throw domainError("WC_VALIDATION", { version: "No está entre las 50 versiones más recientes: manda la lista completa en items" });
  }
  const merged = new Map<string, PriceItem>();
  for (const item of Array.isArray(version.items) ? version.items : []) {
    if (!isRecord(item)) continue;
    const productId = String(item.product_id);
    const minQty = String(item.min_qty);
    merged.set(itemKey(productId, minQty), { product_id: productId, min_qty: minQty, unit_price: String(item.unit_price) });
  }
  for (const key of input.remove ?? []) {
    if (!merged.delete(itemKey(key.product_id, key.min_qty))) {
      throw domainError("WC_VALIDATION", { remove: `El producto ${key.product_id} no tiene precio desde ${key.min_qty} en esta versión` });
    }
  }
  for (const item of input.upsert ?? []) merged.set(itemKey(item.product_id, item.min_qty), item);
  return { items: [...merged.values()] };
}

const productLink = (input: { id: string }) => `/catalogo/${input.id}`;
const formatLink = (input: { id: string }) => `/catalogo/formatos/${input.id}`;
const priceListLink = (input: { id: string }) => `/catalogo/tarifas/${input.id}`;

export const catalogRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "catalog_products_list",
    module: "catalog",
    scope: "catalog.read",
    title: "Lista de productos",
    description: "La lista de Catálogo con todos sus filtros (tipo, vino, formato, añada, archivados, ecológico, datos que faltan, GTIN), con los ids que piden las demás herramientas. Paginada con next_cursor.",
    input: z.object({ ...productFilters, ...page }).strict(),
    route: "GET /v1/products",
    web: () => "/catalogo",
  }),
  defineRestRead({
    name: "catalog_products_export_csv",
    module: "catalog",
    scope: "catalog.read",
    title: "Exportar productos (CSV)",
    description: "El CSV de productos que descarga la app, con los mismos filtros que la lista. Devuelve el texto del fichero.",
    input: z.object(productFilters).strict(),
    route: "GET /v1/products/export.csv",
  }),
  defineRestRead({
    name: "catalog_product_detail_get",
    module: "catalog",
    scope: "catalog.read",
    title: "Ficha completa del producto",
    description: "El producto tal como lo ve la app: SKU, tipo, vino, añada, formato, GTIN, código NC, clave SILICIE, grado, IVA, cuenta de ventas y si está archivado.",
    input: z.object({ id }).strict(),
    route: "GET /v1/products/:id",
    web: productLink,
  }),
  defineRestRead({
    name: "catalog_product_prices_list",
    module: "catalog",
    scope: "catalog.read",
    title: "Precios vigentes del producto",
    description: "Los precios de hoy del producto en cada tarifa activa, con la cantidad mínima de cada escalón.",
    input: z.object({ id, ...page }).strict(),
    route: "GET /v1/products/:id/prices",
    web: productLink,
  }),
  defineRestWrite({
    name: "catalog_product_create",
    module: "catalog",
    scope: "catalog.write",
    title: "Crear producto",
    description: "Da de alta un producto en el catálogo. Un vino embotellado (kind wine) necesita vino, añada y formato; no puede repetirse la misma combinación.",
    input: productCreate,
    route: "POST /v1/products",
    summary: (input) => `Crear el producto ${input.sku} · ${input.name}. ¿Confirmas?`,
    web: (_input, body) => {
      const created = idOf(body);
      return created ? `/catalogo/${created}` : "/catalogo";
    },
  }),
  defineRestWrite({
    name: "catalog_product_update",
    module: "catalog",
    scope: "catalog.write",
    title: "Editar producto",
    description: "Cambia datos del producto; solo hace falta mandar lo que cambia (null borra un dato opcional). Para archivarlo manda is_active false y para recuperarlo true. Con movimientos de stock, el vino, la añada y el formato ya no se cambian.",
    input: z.object({ id, changes: productChanges }).strict(),
    route: "PATCH /v1/products/:id",
    current: { route: "GET /v1/products/:id" },
    send: (input) => input.changes,
    summary: (input, current) => {
      const label = productLabel(current);
      if (input.changes.is_active === false) {
        return `Archivar el producto ${label}: deja de ofrecerse en ventas y en los selectores; su historial y su stock se conservan. ¿Confirmas?`;
      }
      if (input.changes.is_active === true) return `Recuperar el producto archivado ${label}. ¿Confirmas?`;
      return `Editar producto: ${label}. ¿Confirmas?`;
    },
    web: productLink,
  }),
  defineRestWrite({
    name: "catalog_product_gtin_current_mark",
    module: "catalog",
    scope: "catalog.write",
    title: "Marcar GTIN vigente",
    description: "Cuando varios productos comparten un GTIN (por ejemplo, añadas distintas con la misma etiqueta), marca este como el que sale al leer el código de barras.",
    input: z.object({ id, gtin: gtin.optional().describe("Debe ser el GTIN del producto; por defecto el suyo") }).strict(),
    route: "POST /v1/products/:id/gtin-current",
    current: { route: "GET /v1/products/:id" },
    summary: (_input, current) => `El código de barras de ${productLabel(current)} pasará a identificar este producto. ¿Confirmas?`,
    web: productLink,
  }),
  defineRestRead({
    name: "catalog_wines_list",
    module: "catalog",
    scope: "catalog.read",
    title: "Vinos",
    description: "Los vinos del catálogo (la marca, sin añada ni formato) con su color, categoría, DOP/IGP y si son ecológicos.",
    input: z.object({
      active: z.boolean().optional().describe("true solo los activos, false solo los archivados; sin indicarlo salen todos"),
      ...page,
    }).strict(),
    route: "GET /v1/wines",
    web: () => "/catalogo/vinos",
  }),
  defineRestWrite({
    name: "catalog_wine_create",
    module: "catalog",
    scope: "catalog.write",
    title: "Crear vino",
    description: "Da de alta un vino (la marca). Después se crean sus productos por añada y formato con catalog_product_create.",
    input: wineCreate,
    route: "POST /v1/wines",
    summary: (input) => `Crear el vino ${input.code} · ${input.name}. ¿Confirmas?`,
    web: () => "/catalogo/vinos",
  }),
  defineRestWrite({
    name: "catalog_wine_update",
    module: "catalog",
    scope: "catalog.write",
    title: "Editar vino",
    description: "Cambia datos del vino; solo hace falta mandar lo que cambia. Para archivarlo manda is_active false. El código no se cambia si ya está en uso.",
    input: z.object({ id, changes: wineChanges }).strict(),
    route: "PATCH /v1/wines/:id",
    send: (input) => input.changes,
    summary: (input) => input.changes.is_active === false
      ? "Archivar el vino: deja de ofrecerse al crear productos; sus productos y su historial se conservan. ¿Confirmas?"
      : "Editar vino. ¿Confirmas?",
    web: () => "/catalogo/vinos",
  }),
  defineRestWrite({
    name: "catalog_format_create",
    module: "catalog",
    scope: "catalog.write",
    title: "Crear formato",
    description: "Da de alta un formato de envase (botella, bag-in-box, barril…) con su volumen, unidades por caja, cajas por palé y pesos.",
    input: formatCreate,
    route: "POST /v1/formats",
    summary: (input) => `Crear el formato ${input.code} · ${input.name} (${input.nominal_volume_ml} ml). ¿Confirmas?`,
    web: (_input, body) => {
      const created = idOf(body);
      return created ? `/catalogo/formatos/${created}` : "/catalogo/formatos";
    },
  }),
  defineRestWrite({
    name: "catalog_format_update",
    module: "catalog",
    scope: "catalog.write",
    title: "Editar formato",
    description: "Cambia datos del formato; solo hace falta mandar lo que cambia (null borra un peso). Para archivarlo manda is_active false.",
    input: z.object({ id, changes: formatChanges }).strict(),
    route: "PATCH /v1/formats/:id",
    send: (input) => input.changes,
    summary: (input) => input.changes.is_active === false
      ? "Archivar el formato: deja de ofrecerse al crear productos; los productos que lo usan se conservan. ¿Confirmas?"
      : "Editar formato. ¿Confirmas?",
    web: formatLink,
  }),
  defineRestRead({
    name: "catalog_format_materials_list",
    module: "catalog",
    scope: "catalog.read",
    title: "Materiales del formato",
    description: "Lo que consume cada botella, caja o palé de este formato (corcho, cápsula, etiqueta, caja…), con el id de cada línea para editarla o quitarla.",
    input: z.object({ id }).strict(),
    route: "GET /v1/formats/:id/materials",
    web: formatLink,
  }),
  defineRestWrite({
    name: "catalog_format_material_add",
    module: "catalog",
    scope: "catalog.write",
    title: "Añadir material al formato",
    description: "Añade un material de envasado a la lista del formato: cuánto se gasta por botella, por caja o por palé.",
    input: z.object({ id, material: materialFields }).strict(),
    route: "POST /v1/formats/:id/materials",
    current: { route: "GET /v1/formats/:id/materials" },
    send: (input) => input.material,
    web: formatLink,
  }),
  defineRestWrite({
    name: "catalog_format_material_update",
    module: "catalog",
    scope: "catalog.write",
    title: "Editar material del formato",
    description: "Cambia una línea de materiales del formato (el id sale en catalog_format_materials_list). Solo hace falta mandar lo que cambia.",
    input: z.object({ id, material_id: id, changes: materialFields.partial().strict() }).strict(),
    route: "PATCH /v1/formats/:id/materials/:materialId",
    params: { materialId: "material_id" },
    current: { route: "GET /v1/formats/:id/materials" },
    send: (input) => input.changes,
    web: formatLink,
  }),
  defineRestWrite({
    name: "catalog_format_material_remove",
    module: "catalog",
    scope: "catalog.write",
    title: "Quitar material del formato",
    description: "Quita una línea de la lista de materiales del formato (el id sale en catalog_format_materials_list).",
    input: z.object({ id, material_id: id }).strict(),
    route: "DELETE /v1/formats/:id/materials/:materialId",
    params: { materialId: "material_id" },
    current: { route: "GET /v1/formats/:id/materials" },
    summary: (input, current) => {
      const items = isRecord(current) && Array.isArray(current.items) ? current.items : [];
      const line = items.find((item) => isRecord(item) && item.id === input.material_id);
      const label = isRecord(line) ? ` ${String(line.sku)} · ${String(line.name)}` : "";
      return `Quitar el material${label} de la lista del formato: el envasado dejará de descontarlo. ¿Confirmas?`;
    },
    web: formatLink,
  }),
  defineRestWrite({
    name: "catalog_price_list_create",
    module: "catalog",
    scope: "catalog.write",
    title: "Crear tarifa",
    description: "Da de alta una tarifa de precios en euros. Los precios se cargan después en una versión (catalog_price_list_version_create y catalog_price_list_items_set).",
    input: z.object({
      code: z.string().regex(/^(?:final|distributor|shop|custom-[a-z0-9-]{2,30})$/)
        .describe("final, distributor, shop o custom-<nombre> en minúsculas"),
      name: priceListName,
      ...priceListFlags,
    }).strict(),
    route: "POST /v1/price-lists",
    summary: (input) => `Crear la tarifa ${input.code} · ${input.name}. ¿Confirmas?`,
    web: (_input, body) => {
      const created = idOf(body);
      return created ? `/catalogo/tarifas/${created}` : "/catalogo/tarifas";
    },
  }),
  defineRestWrite({
    name: "catalog_price_list_update",
    module: "catalog",
    scope: "catalog.write",
    title: "Editar tarifa",
    description: "Cambia el nombre de la tarifa, si incluye IVA o si está activa (is_active false la archiva). El código no se cambia.",
    input: z.object({
      id,
      changes: z.object({ name: priceListName.optional(), ...priceListFlags }).strict(),
    }).strict(),
    route: "PATCH /v1/price-lists/:id",
    send: (input) => input.changes,
    summary: (input) => input.changes.is_active === false
      ? "Archivar la tarifa: deja de aplicarse a clientes y canales. ¿Confirmas?"
      : "Editar tarifa. ¿Confirmas?",
    web: priceListLink,
  }),
  defineRestRead({
    name: "catalog_price_list_versions_list",
    module: "catalog",
    scope: "catalog.read",
    title: "Versiones de una tarifa",
    description: "Las versiones de la tarifa, de la más reciente a la más antigua, con sus fechas, su estado (draft = borrador, active = vigente) y todos sus precios.",
    input: z.object({ id, ...page }).strict(),
    route: "GET /v1/price-lists/:id/versions",
    web: priceListLink,
  }),
  defineRestWrite({
    name: "catalog_price_list_version_create",
    module: "catalog",
    scope: "catalog.write",
    title: "Nueva versión de tarifa",
    description: "Crea un borrador de la tarifa que empieza a valer en valid_from, con una copia de los precios vigentes para editarlos. No cambia ningún precio hasta que se activa.",
    input: z.object({
      id,
      valid_from: date,
      valid_to: date.nullable().optional().describe("Último día exclusivo; sin fecha, hasta la siguiente versión"),
      notes: z.string().max(4000).nullable().optional(),
    }).strict(),
    route: "POST /v1/price-lists/:id/versions",
    summary: (input) => `Crear un borrador de la tarifa que empieza el ${input.valid_from}, con los precios vigentes copiados. ¿Confirmas?`,
    web: priceListLink,
  }),
  defineRestWrite({
    name: "catalog_price_list_items_set",
    module: "catalog",
    scope: "catalog.write",
    title: "Precios de un borrador de tarifa",
    description: "Cambia los precios de una versión en borrador. Manda upsert (precios nuevos o cambiados) y remove (los que se quitan) para tocar solo esos, o items con la lista completa, que sustituye a la actual.",
    input: z.object({
      id,
      version: z.number().int().min(1).max(100_000).describe("Número de la versión en borrador"),
      items: z.array(priceItem).max(2000).optional().describe("Lista completa: sustituye a todos los precios del borrador"),
      upsert: z.array(priceItem).max(2000).optional().describe("Precios que se añaden o cambian; el resto se queda igual"),
      remove: z.array(priceKey).max(2000).optional().describe("Precios que se quitan (producto y cantidad mínima)"),
    }).strict(),
    route: "PUT /v1/price-lists/:id/versions/:version/items",
    current: { route: "GET /v1/price-lists/:id/versions" },
    send: (input, current) => priceItemsBody(input, current),
    summary: (input, current) => {
      const before = versionOf(current, input.version);
      const count = before && Array.isArray(before.items) ? before.items.length : null;
      const now = priceItemsBody(input, current).items.length;
      const was = count === null ? "" : ` (ahora tiene ${count})`;
      return `La versión ${input.version} de la tarifa quedará con ${now} precios${was}. Sigue en borrador hasta que se active. ¿Confirmas?`;
    },
    web: priceListLink,
  }),
  defineRestWrite({
    name: "catalog_price_list_version_activation_request",
    module: "catalog",
    scope: "catalog.write",
    title: "Pedir la activación de una tarifa",
    description: "Pide la aprobación para activar una versión en borrador. Los precios no cambian hasta que se aprueba; el enlace de la aprobación sale en approvals_list_pending.",
    input: z.object({ id, version: z.number().int().min(1).max(100_000) }).strict(),
    route: "POST /v1/price-lists/:id/versions/:version/request-activation",
    current: { route: "GET /v1/price-lists/:id/versions" },
    summary: (input, current) => {
      const version = versionOf(current, input.version);
      const from = version && typeof version.valid_from === "string" ? ` desde el ${version.valid_from}` : "";
      return `Pedir la aprobación para activar la versión ${input.version} de la tarifa${from}. Al aprobarse, sus precios pasan a aplicarse. ¿Confirmas?`;
    },
    web: priceListLink,
  }),
  defineRestRead({
    name: "catalog_customer_price_get",
    module: "catalog",
    scope: "catalog.read",
    title: "Precio de un producto para un cliente",
    description: "El precio unitario que aplicaría a un cliente para una cantidad de un producto en una fecha, según su tarifa o el canal, como al hacer un presupuesto. No guarda nada.",
    input: z.object({
      customer_id: id,
      product_id: id,
      qty,
      date: date.optional().describe("Por defecto, hoy"),
      channel: z.enum(CHANNELS).optional().describe("Canal del documento; si el cliente no tiene tarifa propia elige la del canal"),
    }).strict(),
    route: "GET /v1/price-quote",
  }),
];
