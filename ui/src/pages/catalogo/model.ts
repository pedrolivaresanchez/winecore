import { formatMl, formatQty, isPositiveDecimal, sumDecimals } from "@/pages/catalogo/money";

export type ProductKind =
  | "wine"
  | "bulk_wine"
  | "packaging_material"
  | "oenological_product"
  | "merchandise"
  | "service"
  | "gift_card"
  | "other";

export type ProductUnit = "ud" | "l" | "kg" | "h" | "month" | "service";

export type WineColor = "red" | "white" | "rose" | "orange" | "sweet" | "sparkling" | "other";
export type WineCategory = "wine" | "pgi_wine" | "pdo_wine" | "fortified" | "other";
export type Container = "bottle" | "bag_in_box" | "keg" | "other";
export type MissingData = "" | "gtin" | "nc_code" | "silicie";
export type VersionStatus = "draft" | "pending" | "active" | "retired";

export type ListPage<T> = {
  items: T[];
  next_cursor: string | null;
  total: number;
};

export type Wine = {
  id: string;
  code: string;
  name: string;
  color: WineColor;
  category: WineCategory;
  pdo_pgi_name: string | null;
  is_single_plot: boolean;
  is_organic: boolean;
  no_added_sulfites: boolean;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type Format = {
  id: string;
  code: string;
  name: string;
  container: Container;
  nominal_volume_ml: number;
  units_per_case: number;
  cases_per_pallet: number;
  unit_gross_weight_g: number | null;
  unit_net_weight_g: number | null;
  is_active: boolean;
};

export type CustomerItemCode = {
  contact_id: string;
  code: string;
  contact_name?: string | null;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  name_en: string | null;
  kind: ProductKind;
  wine_id: string | null;
  vintage: number | null;
  format_id: string | null;
  unit: ProductUnit;
  gtin: string | null;
  gtin_case: string | null;
  nc_code: string | null;
  excise_product_key: string | null;
  alcohol_pct: string | null;
  default_tax_code: string | null;
  sales_account: string | null;
  is_stock_tracked: boolean;
  requires_lot: boolean;
  is_active: boolean;
  legacy_refs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  has_movements?: boolean;
  gtin_is_current?: boolean;
  on_hand_qty?: string | null;
  is_organic?: boolean;
  customer_item_codes?: CustomerItemCode[];
  wine_code?: string | null;
  wine_name?: string | null;
  format_code?: string | null;
  format_name?: string | null;
};

export type ProductInput = {
  sku: string;
  name: string;
  name_en: string;
  kind: ProductKind;
  wine_id: string;
  vintage: string;
  format_id: string;
  unit: ProductUnit;
  gtin: string;
  gtin_case: string;
  nc_code: string;
  excise_product_key: string;
  alcohol_pct: string;
  default_tax_code: string;
  sales_account: string;
  is_stock_tracked: boolean;
  requires_lot: boolean;
  is_active: boolean;
};

export type ProductQuery = {
  q?: string;
  kind?: ProductKind | "";
  wine_id?: string;
  format_id?: string;
  vintage?: string;
  active?: "" | "true" | "false";
  organic?: boolean;
  missing?: MissingData;
  cursor?: string;
  limit?: number;
};

export type WineInput = {
  code: string;
  name: string;
  color: WineColor;
  category: WineCategory;
  pdo_pgi_name: string;
  is_single_plot: boolean;
  is_organic: boolean;
  no_added_sulfites: boolean;
  description: string;
};

export type FormatInput = {
  code: string;
  name: string;
  container: Container;
  nominal_volume_ml: string;
  units_per_case: string;
  cases_per_pallet: string;
  unit_gross_weight_g: string;
  unit_net_weight_g: string;
};

export type ProductPrice = {
  price_list_id: string;
  price_list_code?: string;
  price_list_name: string;
  version_id?: string;
  version?: number;
  currency?: string;
  tax_included?: boolean;
  unit_price: string;
  min_qty: string;
  valid_from?: string | null;
};

export type PriceList = {
  id: string;
  code: string;
  name: string;
  currency: string;
  tax_included: boolean;
  is_active: boolean;
  active_version?: number | null;
  active_valid_from?: string | null;
};

export type PriceItem = {
  id?: string;
  version_id?: string;
  product_id: string;
  product_sku?: string | null;
  product_name?: string | null;
  min_qty: string;
  unit_price: string;
};

export type PriceListVersion = {
  id: string;
  price_list_id: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  status: VersionStatus;
  notes: string | null;
  approval_request_id: string | null;
  activated_at: string | null;
  created_by: string;
  created_at: string;
  items?: PriceItem[];
};

export type MaterialPer = "unit" | "case" | "pallet";

export type FormatMaterial = {
  id: string;
  format_id: string;
  material_product_id: string;
  sku: string;
  name: string;
  per: MaterialPer;
  quantity: string;
};

export const PER_OPTIONS: { id: MaterialPer; label: string }[] = [
  { id: "unit", label: "Unidad" },
  { id: "case", label: "Caja" },
  { id: "pallet", label: "Palé" },
];

export function perLabel(per: string): string {
  return PER_OPTIONS.find((item) => item.id === per)?.label ?? per;
}

export type StockBalance = {
  location_id?: string;
  location_code?: string;
  location_name?: string;
  owner_code?: string | null;
  state?: string | null;
  lot_code?: string | null;
  qty_units?: string | null;
  qty_ml?: string | null;
  quantity?: string | null;
};

export type AuditChange = { field: string; before: unknown; after: unknown };

export type AuditEvent = {
  id: string;
  occurred_at: string;
  actor: { type: string; id: string; display_name: string };
  action: string;
  changes: AuditChange[];
};

export const KIND_OPTIONS: { id: ProductKind; label: string }[] = [
  { id: "wine", label: "Vino" },
  { id: "bulk_wine", label: "Granel" },
  { id: "packaging_material", label: "Material" },
  { id: "oenological_product", label: "Enológico" },
  { id: "merchandise", label: "Mercancía" },
  { id: "service", label: "Servicio" },
  { id: "gift_card", label: "Tarjeta" },
  { id: "other", label: "Otro" },
];

export const UNIT_OPTIONS: { id: ProductUnit; label: string }[] = [
  { id: "ud", label: "Unidades" },
  { id: "l", label: "Litros" },
  { id: "kg", label: "Kilogramos" },
  { id: "h", label: "Horas" },
  { id: "month", label: "Meses" },
  { id: "service", label: "Servicio" },
];

export const COLOR_OPTIONS: { id: WineColor; label: string }[] = [
  { id: "red", label: "Tinto" },
  { id: "white", label: "Blanco" },
  { id: "rose", label: "Rosado" },
  { id: "orange", label: "Naranja" },
  { id: "sweet", label: "Dulce" },
  { id: "sparkling", label: "Espumoso" },
  { id: "other", label: "Otro" },
];

export const CATEGORY_OPTIONS: { id: WineCategory; label: string }[] = [
  { id: "wine", label: "Vino" },
  { id: "pgi_wine", label: "IGP" },
  { id: "pdo_wine", label: "DOP" },
  { id: "fortified", label: "Generoso" },
  { id: "other", label: "Otro" },
];

export const CONTAINER_OPTIONS: { id: Container; label: string }[] = [
  { id: "bottle", label: "Botella" },
  { id: "bag_in_box", label: "Bag in box" },
  { id: "keg", label: "Barril" },
  { id: "other", label: "Otro" },
];

export const TAX_OPTIONS = [
  { id: "", label: "Sin indicar" },
  { id: "IVA21", label: "IVA 21 %" },
  { id: "IVA10", label: "IVA 10 %" },
  { id: "IVA21_RE", label: "IVA 21 % + recargo" },
  { id: "IVA21_ALQ", label: "IVA 21 % + retención" },
  { id: "EXP_E2", label: "Exportación exenta" },
  { id: "INTRA_E5", label: "Entrega intracomunitaria" },
  { id: "NS_LOC", label: "No sujeta" },
] as const;

export const VERSION_LABELS: Record<VersionStatus, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  active: "Activa",
  retired: "Retirada",
};

const STOCK_STATES: Record<string, string> = {
  bulk: "Granel",
  packaged_unlabeled: "Sin etiquetar",
  packaged_labeled: "Etiquetado",
};

export function kindLabel(kind: string): string {
  return KIND_OPTIONS.find((item) => item.id === kind)?.label ?? kind;
}

export function unitLabel(unit: string): string {
  return UNIT_OPTIONS.find((item) => item.id === unit)?.label ?? unit;
}

export function colorLabel(color: string): string {
  return COLOR_OPTIONS.find((item) => item.id === color)?.label ?? color;
}

export function categoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((item) => item.id === category)?.label ?? category;
}

export function containerLabel(container: string): string {
  return CONTAINER_OPTIONS.find((item) => item.id === container)?.label ?? container;
}

export function taxLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return TAX_OPTIONS.find((item) => item.id === code)?.label ?? code;
}

export function ownerLabel(code: string | null | undefined): string {
  if (!code) return "";
  if (code === "PO") return "P.O";
  return code;
}

export function stateLabel(state: string | null | undefined): string {
  if (!state) return "";
  return STOCK_STATES[state] ?? state;
}

export function versionStatus(version: PriceListVersion): VersionStatus {
  if (version.status === "pending") return "pending";
  if (version.status === "draft" && version.approval_request_id) return "pending";
  return version.status;
}

export function versionEditable(version: PriceListVersion): boolean {
  return version.status === "draft" && !version.approval_request_id;
}

export function productWarnings(product: Product): string[] {
  const warnings: string[] = [];
  if (!product.gtin) warnings.push("Sin GTIN");
  if (!product.nc_code) warnings.push("Sin código NC");
  if (!product.excise_product_key && (product.kind === "wine" || product.kind === "bulk_wine")) {
    warnings.push("Sin mayor SILICIE");
  }
  return warnings;
}

export function wineName(product: Product, wines: Wine[]): string {
  if (product.wine_name) return product.wine_name;
  return wines.find((wine) => wine.id === product.wine_id)?.name ?? "—";
}

export function formatCode(product: Product, formats: Format[]): string {
  if (product.format_code) return product.format_code;
  return formats.find((format) => format.id === product.format_id)?.code ?? "—";
}

export function formatName(product: Product, formats: Format[]): string {
  if (product.format_name) return product.format_name;
  const format = formats.find((item) => item.id === product.format_id);
  return format ? `${format.name}` : "—";
}

export function productOrganic(product: Product, wines: Wine[]): boolean {
  if (product.is_organic != null) return product.is_organic;
  return wines.find((wine) => wine.id === product.wine_id)?.is_organic ?? false;
}

export function emptyProductInput(): ProductInput {
  return {
    sku: "",
    name: "",
    name_en: "",
    kind: "wine",
    wine_id: "",
    vintage: "",
    format_id: "",
    unit: "ud",
    gtin: "",
    gtin_case: "",
    nc_code: "",
    excise_product_key: "",
    alcohol_pct: "",
    default_tax_code: "IVA21",
    sales_account: "",
    is_stock_tracked: true,
    requires_lot: true,
    is_active: true,
  };
}

export function inputFromProduct(product: Product): ProductInput {
  return {
    sku: product.sku,
    name: product.name,
    name_en: product.name_en ?? "",
    kind: product.kind,
    wine_id: product.wine_id ?? "",
    vintage: product.vintage == null ? "" : String(product.vintage),
    format_id: product.format_id ?? "",
    unit: product.unit,
    gtin: product.gtin ?? "",
    gtin_case: product.gtin_case ?? "",
    nc_code: product.nc_code ?? "",
    excise_product_key: product.excise_product_key ?? "",
    alcohol_pct: product.alcohol_pct ?? "",
    default_tax_code: product.default_tax_code ?? "",
    sales_account: product.sales_account ?? "",
    is_stock_tracked: product.is_stock_tracked,
    requires_lot: product.requires_lot,
    is_active: product.is_active,
  };
}

export function emptyWineInput(): WineInput {
  return {
    code: "",
    name: "",
    color: "red",
    category: "pdo_wine",
    pdo_pgi_name: "",
    is_single_plot: false,
    is_organic: true,
    no_added_sulfites: false,
    description: "",
  };
}

export function emptyFormatInput(): FormatInput {
  return {
    code: "",
    name: "",
    container: "bottle",
    nominal_volume_ml: "",
    units_per_case: "6",
    cases_per_pallet: "100",
    unit_gross_weight_g: "",
    unit_net_weight_g: "",
  };
}

function nullIfEmpty(value: string): string | null {
  const next = value.trim();
  return next ? next : null;
}

export function productBody(input: ProductInput): Record<string, unknown> {
  const kind = input.kind;
  const wineKind = kind === "wine" || kind === "bulk_wine";
  const vintage = input.vintage.trim();
  return {
    sku: input.sku.trim().toUpperCase(),
    name: input.name.trim(),
    name_en: nullIfEmpty(input.name_en),
    kind,
    wine_id: wineKind ? input.wine_id || null : null,
    vintage: vintage ? Number(vintage) : null,
    format_id: kind === "wine" ? input.format_id || null : input.format_id || null,
    unit: input.unit,
    gtin: nullIfEmpty(input.gtin),
    gtin_case: nullIfEmpty(input.gtin_case),
    nc_code: nullIfEmpty(input.nc_code),
    excise_product_key: nullIfEmpty(input.excise_product_key.toUpperCase()),
    alcohol_pct: nullIfEmpty(input.alcohol_pct.replace(",", ".")),
    default_tax_code: nullIfEmpty(input.default_tax_code),
    sales_account: nullIfEmpty(input.sales_account),
    is_stock_tracked: kind === "service" || kind === "gift_card" ? false : input.is_stock_tracked,
    requires_lot: kind === "wine" ? true : input.requires_lot,
    is_active: input.is_active,
  };
}

export function wineBody(input: WineInput): Record<string, unknown> {
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    color: input.color,
    category: input.category,
    pdo_pgi_name: nullIfEmpty(input.pdo_pgi_name),
    is_single_plot: input.is_single_plot,
    is_organic: input.is_organic,
    no_added_sulfites: input.no_added_sulfites,
    description: nullIfEmpty(input.description),
    is_active: true,
  };
}

export function formatBody(input: FormatInput): Record<string, unknown> {
  const optional = (value: string) => {
    const next = value.trim();
    return next ? Number(next) : null;
  };
  return {
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    container: input.container,
    nominal_volume_ml: Number(input.nominal_volume_ml),
    units_per_case: Number(input.units_per_case),
    cases_per_pallet: Number(input.cases_per_pallet),
    unit_gross_weight_g: optional(input.unit_gross_weight_g),
    unit_net_weight_g: optional(input.unit_net_weight_g),
    is_active: true,
  };
}

export function productQuery(query: ProductQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind) params.set("kind", query.kind);
  if (query.wine_id) params.set("wine_id", query.wine_id);
  if (query.format_id) params.set("format_id", query.format_id);
  if (query.vintage) params.set("vintage", query.vintage);
  if (query.active) params.set("active", query.active);
  if (query.organic) params.set("organic", "true");
  if (query.missing) params.set("missing", query.missing);
  if (query.cursor) params.set("cursor", query.cursor);
  params.set("limit", String(query.limit ?? 50));
  return `/v1/products?${params.toString()}`;
}

export type WarehouseStock = {
  key: string;
  code: string;
  name: string;
  units: string;
  ml: string;
  owners: string[];
  lots: { code: string; state: string; units: string; ml: string; owner: string }[];
};

export function groupStock(rows: StockBalance[]): WarehouseStock[] {
  const map = new Map<string, WarehouseStock>();
  for (const row of rows) {
    const code = row.location_code || "—";
    const key = row.location_id || code;
    const current = map.get(key) ?? {
      key,
      code,
      name: row.location_name || code,
      units: "0",
      ml: "0",
      owners: [],
      lots: [],
    };
    const units = decimalText(row.qty_units ?? row.quantity);
    const ml = decimalText(row.qty_ml);
    if (units) current.units = sumDecimals([current.units, units]);
    if (ml) current.ml = sumDecimals([current.ml, ml]);
    const owner = ownerLabel(row.owner_code);
    if (owner && !current.owners.includes(owner)) current.owners.push(owner);
    current.lots.push({
      code: row.lot_code || "Sin lote",
      state: stateLabel(row.state),
      units: units ?? "",
      ml: ml ?? "",
      owner,
    });
    map.set(key, current);
  }
  return [...map.values()];
}

export function stockHeadline(rows: StockBalance[]): string {
  const units = sumDecimals(rows.map((row) => decimalText(row.qty_units ?? row.quantity)));
  const ml = sumDecimals(rows.map((row) => decimalText(row.qty_ml)));
  if (isPositiveDecimal(units)) return `${formatQty(units)} ud`;
  if (isPositiveDecimal(ml)) return formatMl(ml);
  if (rows.length === 0) return "—";
  return "0 ud";
}

export function warehouseQty(row: WarehouseStock): string {
  if (isPositiveDecimal(row.units)) return `${formatQty(row.units)} ud`;
  if (isPositiveDecimal(row.ml)) return formatMl(row.ml);
  return "0 ud";
}

function decimalText(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

export function pickVersion(versions: PriceListVersion[]): PriceListVersion | null {
  const editable = versions.find((version) => versionEditable(version));
  if (editable) return editable;
  const pending = versions.find((version) => versionStatus(version) === "pending");
  if (pending) return pending;
  const active = versions.find((version) => version.status === "active");
  return active ?? versions[0] ?? null;
}
