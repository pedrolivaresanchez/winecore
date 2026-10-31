import { gtinWithCheck } from "../../src/pages/catalogo/gtin.ts";

if (gtinWithCheck("840000000050") !== "8400000000505") {
  throw new Error("El dígito de control GS1 no cuadra con el ejemplo 8400000000505");
}

function gtin(seed: number): string {
  const code = gtinWithCheck(`840${String(seed).padStart(9, "0")}`);
  if (!code) throw new Error(`GTIN ${seed}`);
  return code;
}

function gtin14(seed: number): string {
  const code = gtinWithCheck(`1840${String(seed).padStart(9, "0")}`);
  if (!code) throw new Error(`GTIN-14 ${seed}`);
  return code;
}

export const healthOk = {
  status: "ok",
  sha: "abc1234def56789",
  schema_version: "0004",
  db: "local",
  writer: "leader",
};

export const meOk = {
  email: "ana@winecore.test",
  display_name: "Ana Rivas",
  roles: [{ role: "owner", legal_entity_code: "PO" }],
  entities: [
    { id: "po", code: "PO", legal_name: "Entidad de prueba P.O" },
    { id: "cvpo", code: "CVPO", legal_name: "Entidad de prueba CVPO" },
  ],
  permissions: ["catalog.read", "catalog.write", "contacts.read", "contacts.write"],
};

const stamp = "2026-10-12T08:00:00Z";

export const wines = [
  {
    id: "w-enebro",
    code: "ENEBRO",
    name: "Alto del Enebro",
    color: "red",
    category: "pdo_wine",
    pdo_pgi_name: "DOP de prueba",
    is_single_plot: true,
    is_organic: true,
    no_added_sulfites: false,
    description: null,
    is_active: true,
    created_at: stamp,
  },
  {
    id: "w-cera",
    code: "CERA",
    name: "Ladera de Cera",
    color: "white",
    category: "pgi_wine",
    pdo_pgi_name: "IGP de prueba",
    is_single_plot: false,
    is_organic: true,
    no_added_sulfites: true,
    description: null,
    is_active: true,
    created_at: stamp,
  },
  {
    id: "w-bruma",
    code: "BRUMA",
    name: "Bruma del Soto",
    color: "rose",
    category: "wine",
    pdo_pgi_name: null,
    is_single_plot: false,
    is_organic: false,
    no_added_sulfites: false,
    description: null,
    is_active: true,
    created_at: stamp,
  },
];

export const formats = [
  {
    id: "f-b075",
    code: "B075",
    name: "Botella 0,75 L",
    container: "bottle",
    nominal_volume_ml: 750,
    units_per_case: 6,
    cases_per_pallet: 100,
    unit_gross_weight_g: 1200,
    unit_net_weight_g: 750,
    is_active: true,
  },
  {
    id: "f-b150",
    code: "B150",
    name: "Mágnum 1,5 L",
    container: "bottle",
    nominal_volume_ml: 1500,
    units_per_case: 3,
    cases_per_pallet: 60,
    unit_gross_weight_g: 2400,
    unit_net_weight_g: 1500,
    is_active: true,
  },
  {
    id: "f-bib5",
    code: "BIB5",
    name: "Bag in box 5 L",
    container: "bag_in_box",
    nominal_volume_ml: 5000,
    units_per_case: 1,
    cases_per_pallet: 48,
    unit_gross_weight_g: 5300,
    unit_net_weight_g: 5000,
    is_active: true,
  },
];

type Product = {
  id: string;
  sku: string;
  name: string;
  name_en: string | null;
  kind: string;
  wine_id: string | null;
  vintage: number | null;
  format_id: string | null;
  unit: string;
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
  legacy_refs: Record<string, never>;
  created_at: string;
  updated_at: string;
  has_movements: boolean;
  gtin_is_current: boolean;
  on_hand_qty: string | null;
  is_organic: boolean;
  customer_item_codes: { contact_id: string; contact_name: string; code: string }[];
  wine_code: string | null;
  wine_name: string | null;
  format_code: string | null;
  format_name: string | null;
};

function product(partial: Partial<Product> & Pick<Product, "id" | "sku" | "name" | "kind">): Product {
  return {
    name_en: null,
    wine_id: null,
    vintage: null,
    format_id: null,
    unit: "ud",
    gtin: null,
    gtin_case: null,
    nc_code: null,
    excise_product_key: null,
    alcohol_pct: null,
    default_tax_code: "IVA21",
    sales_account: null,
    is_stock_tracked: true,
    requires_lot: partial.kind === "wine",
    is_active: true,
    legacy_refs: {},
    created_at: stamp,
    updated_at: "2026-10-28T09:00:00Z",
    has_movements: false,
    gtin_is_current: false,
    on_hand_qty: null,
    is_organic: false,
    customer_item_codes: [],
    wine_code: null,
    wine_name: null,
    format_code: null,
    format_name: null,
    ...partial,
  };
}

export const products: Product[] = [
  product({
    id: "p-enebro-25",
    sku: "ENEBRO-2025-B075",
    name: "Alto del Enebro 2025 0,75 L",
    name_en: "Alto del Enebro 2025 0.75 L",
    kind: "wine",
    wine_id: "w-enebro",
    vintage: 2025,
    format_id: "f-b075",
    gtin: gtin(1),
    gtin_case: gtin14(1),
    nc_code: "22042180",
    excise_product_key: "B075-ENEBRO",
    alcohol_pct: "14.50",
    sales_account: "70000000",
    has_movements: true,
    gtin_is_current: true,
    on_hand_qty: "1240",
    is_organic: true,
    customer_item_codes: [{ contact_id: "c-encina", contact_name: "Vinoteca La Encina S.L.", code: "ECI-44021" }],
    wine_code: "ENEBRO",
    wine_name: "Alto del Enebro",
    format_code: "B075",
    format_name: "Botella 0,75 L",
  }),
  product({
    id: "p-enebro-24",
    sku: "ENEBRO-2024-B075",
    name: "Alto del Enebro 2024 0,75 L",
    kind: "wine",
    wine_id: "w-enebro",
    vintage: 2024,
    format_id: "f-b075",
    nc_code: "22042180",
    excise_product_key: "B075-ENEBRO",
    alcohol_pct: "14.00",
    on_hand_qty: "86",
    is_organic: true,
    wine_code: "ENEBRO",
    wine_name: "Alto del Enebro",
    format_code: "B075",
    format_name: "Botella 0,75 L",
  }),
  product({
    id: "p-cera-25",
    sku: "CERA-2025-B075",
    name: "Ladera de Cera 2025 0,75 L",
    kind: "wine",
    wine_id: "w-cera",
    vintage: 2025,
    format_id: "f-b075",
    gtin: gtin(2),
    gtin_case: gtin14(2),
    excise_product_key: "B075-CERA",
    alcohol_pct: "12.50",
    on_hand_qty: "430",
    is_organic: true,
    wine_code: "CERA",
    wine_name: "Ladera de Cera",
    format_code: "B075",
    format_name: "Botella 0,75 L",
  }),
  product({
    id: "p-bruma-25",
    sku: "BRUMA-2025-B075",
    name: "Bruma del Soto 2025 0,75 L",
    kind: "wine",
    wine_id: "w-bruma",
    vintage: 2025,
    format_id: "f-b075",
    gtin: gtin(3),
    nc_code: "22042180",
    alcohol_pct: "13.00",
    on_hand_qty: "210",
    wine_code: "BRUMA",
    wine_name: "Bruma del Soto",
    format_code: "B075",
    format_name: "Botella 0,75 L",
  }),
  product({
    id: "p-enebro-mag",
    sku: "ENEBRO-2025-B150",
    name: "Alto del Enebro 2025 1,5 L",
    kind: "wine",
    wine_id: "w-enebro",
    vintage: 2025,
    format_id: "f-b150",
    gtin: gtin(4),
    gtin_case: gtin14(4),
    nc_code: "22042180",
    excise_product_key: "B150-ENEBRO",
    alcohol_pct: "14.50",
    on_hand_qty: "64",
    is_organic: true,
    wine_code: "ENEBRO",
    wine_name: "Alto del Enebro",
    format_code: "B150",
    format_name: "Mágnum 1,5 L",
  }),
  product({
    id: "p-cera-bib",
    sku: "CERA-2025-BIB5",
    name: "Ladera de Cera 2025 5 L",
    kind: "wine",
    wine_id: "w-cera",
    vintage: 2025,
    format_id: "f-bib5",
    gtin: gtin(5),
    nc_code: "22042180",
    excise_product_key: "BIB5-CERA",
    alcohol_pct: "12.50",
    on_hand_qty: "36",
    is_organic: true,
    wine_code: "CERA",
    wine_name: "Ladera de Cera",
    format_code: "BIB5",
    format_name: "Bag in box 5 L",
  }),
  product({
    id: "p-granel",
    sku: "ENEBRO-GRANEL",
    name: "Alto del Enebro a granel",
    kind: "bulk_wine",
    wine_id: "w-enebro",
    vintage: 2025,
    unit: "l",
    nc_code: "22042180",
    excise_product_key: "GRANEL-ENEBRO",
    alcohol_pct: "14.20",
    on_hand_qty: "820",
    is_organic: true,
    wine_code: "ENEBRO",
    wine_name: "Alto del Enebro",
  }),
  product({
    id: "p-caja",
    sku: "CAJA-REGALO",
    name: "Caja de madera de regalo",
    kind: "merchandise",
    on_hand_qty: "40",
    requires_lot: false,
  }),
  product({
    id: "p-visita",
    sku: "VISITA-BODEGA",
    name: "Visita a la bodega",
    kind: "service",
    unit: "service",
    is_stock_tracked: false,
    requires_lot: false,
    default_tax_code: "IVA21",
  }),
  product({
    id: "p-enebro-23",
    sku: "ENEBRO-2023-B075",
    name: "Alto del Enebro 2023 0,75 L",
    kind: "wine",
    wine_id: "w-enebro",
    vintage: 2023,
    format_id: "f-b075",
    gtin: gtin(6),
    nc_code: "22042180",
    excise_product_key: "B075-ENEBRO",
    alcohol_pct: "14.00",
    is_active: false,
    on_hand_qty: "0",
    is_organic: true,
    wine_code: "ENEBRO",
    wine_name: "Alto del Enebro",
    format_code: "B075",
    format_name: "Botella 0,75 L",
  }),
];

export const balances = [
  { location_id: "loc-bod", location_code: "BOD", location_name: "Bodega", owner_code: "PO", state: "packaged_labeled", lot_code: "L25-010", qty_units: "860", qty_ml: null },
  { location_id: "loc-bod", location_code: "BOD", location_name: "Bodega", owner_code: "PO", state: "packaged_unlabeled", lot_code: "L25-011", qty_units: "240", qty_ml: null },
  { location_id: "loc-tienda", location_code: "TIENDA", location_name: "Tienda", owner_code: "PO", state: "packaged_labeled", lot_code: "L25-010", qty_units: "48", qty_ml: null },
  { location_id: "loc-vlc", location_code: "VLC", location_name: "Valencia", owner_code: "CVPO", state: "packaged_labeled", lot_code: "L25-010", qty_units: "92", qty_ml: null },
];

export function productPrices(id: string) {
  if (id !== "p-enebro-25") return [];
  return [
    { price_list_id: "pl-final", price_list_code: "final", price_list_name: "Cliente final", version: 2, currency: "EUR", tax_included: true, unit_price: "12.5000", min_qty: "1", valid_from: "2026-01-01" },
    { price_list_id: "pl-dist", price_list_code: "distributor", price_list_name: "Distribuidor", version: 2, currency: "EUR", tax_included: false, unit_price: "7.9000", min_qty: "6", valid_from: "2026-01-01" },
    { price_list_id: "pl-shop", price_list_code: "shop", price_list_name: "Tienda", version: 1, currency: "EUR", tax_included: true, unit_price: "11.0000", min_qty: "1", valid_from: "2026-01-01" },
  ];
}

export const priceLists = [
  { id: "pl-final", code: "final", name: "Cliente final", currency: "EUR", tax_included: true, is_active: true, active_version: 2, active_valid_from: "2026-01-01" },
  { id: "pl-dist", code: "distributor", name: "Distribuidor", currency: "EUR", tax_included: false, is_active: true, active_version: 2, active_valid_from: "2026-01-01" },
  { id: "pl-shop", code: "shop", name: "Tienda", currency: "EUR", tax_included: true, is_active: true, active_version: 1, active_valid_from: "2026-01-01" },
];

function item(productId: string, price: string, min = "1") {
  const row = products.find((entry) => entry.id === productId);
  return {
    id: `i-${productId}-${min}`,
    product_id: productId,
    product_sku: row?.sku ?? null,
    product_name: row?.name ?? null,
    min_qty: min,
    unit_price: price,
  };
}

export const versions: Record<string, object[]> = {
  "pl-final": [
    {
      id: "v-final-2",
      price_list_id: "pl-final",
      version: 2,
      valid_from: "2026-01-01",
      valid_to: null,
      status: "active",
      notes: null,
      approval_request_id: null,
      activated_at: "2026-01-01T00:00:00Z",
      created_by: "Ana Rivas",
      created_at: stamp,
      items: [item("p-enebro-25", "12.5000"), item("p-cera-25", "11.0000")],
    },
  ],
  "pl-dist": [
    {
      id: "v-dist-3",
      price_list_id: "pl-dist",
      version: 3,
      valid_from: "2027-03-01",
      valid_to: null,
      status: "draft",
      notes: "Campaña de primavera.",
      approval_request_id: null,
      activated_at: null,
      created_by: "Ana Rivas",
      created_at: "2026-10-20T10:00:00Z",
      items: [
        item("p-enebro-25", "8.2000", "6"),
        item("p-enebro-24", "7.4000", "6"),
        item("p-cera-25", "7.1000", "6"),
        item("p-enebro-mag", "16.4000", "3"),
        item("p-cera-bib", "24.0000", "1"),
      ],
    },
    {
      id: "v-dist-2",
      price_list_id: "pl-dist",
      version: 2,
      valid_from: "2026-01-01",
      valid_to: "2027-03-01",
      status: "active",
      notes: null,
      approval_request_id: null,
      activated_at: "2025-12-15T00:00:00Z",
      created_by: "Ana Rivas",
      created_at: stamp,
      items: [item("p-enebro-25", "7.9000", "6"), item("p-cera-25", "6.8000", "6"), item("p-bruma-25", "6.5000", "6")],
    },
    {
      id: "v-dist-1",
      price_list_id: "pl-dist",
      version: 1,
      valid_from: "2025-01-01",
      valid_to: "2026-01-01",
      status: "retired",
      notes: null,
      approval_request_id: null,
      activated_at: "2024-12-01T00:00:00Z",
      created_by: "Ana Rivas",
      created_at: "2024-12-01T00:00:00Z",
      items: [item("p-enebro-24", "7.1000", "6")],
    },
  ],
  "pl-shop": [
    {
      id: "v-shop-2",
      price_list_id: "pl-shop",
      version: 2,
      valid_from: "2027-06-01",
      valid_to: null,
      status: "pending",
      notes: null,
      approval_request_id: "apr-tienda",
      activated_at: null,
      created_by: "Ana Rivas",
      created_at: "2026-10-25T12:00:00Z",
      items: [item("p-enebro-25", "11.5000"), item("p-cera-25", "10.5000")],
    },
    {
      id: "v-shop-1",
      price_list_id: "pl-shop",
      version: 1,
      valid_from: "2026-01-01",
      valid_to: null,
      status: "active",
      notes: null,
      approval_request_id: null,
      activated_at: "2026-01-01T00:00:00Z",
      created_by: "Ana Rivas",
      created_at: stamp,
      items: [item("p-enebro-25", "11.0000"), item("p-cera-25", "10.0000")],
    },
  ],
};

export const auditEvents = [
  {
    id: "aud-1",
    occurred_at: "2026-10-20T09:30:00Z",
    actor: { type: "user", id: "ana", display_name: "Ana Rivas" },
    action: "update",
    changes: [{ field: "alcohol_pct", before: "14.00", after: "14.50" }],
  },
  {
    id: "aud-2",
    occurred_at: "2026-04-02T11:00:00Z",
    actor: { type: "user", id: "ana", display_name: "Ana Rivas" },
    action: "create",
    changes: [],
  },
];

export function filterProducts(url: URL): Product[] {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const kind = url.searchParams.get("kind");
  const wineId = url.searchParams.get("wine_id");
  const formatId = url.searchParams.get("format_id");
  const vintage = url.searchParams.get("vintage");
  const active = url.searchParams.get("active");
  const organic = url.searchParams.get("organic");
  const missing = url.searchParams.get("missing");
  return products.filter((row) => {
    if (q) {
      const haystack = [row.name, row.sku, row.gtin, row.wine_name].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (kind && row.kind !== kind) return false;
    if (wineId && row.wine_id !== wineId) return false;
    if (formatId && row.format_id !== formatId) return false;
    if (vintage && String(row.vintage ?? "") !== vintage) return false;
    if (active === "true" && !row.is_active) return false;
    if (active === "false" && row.is_active) return false;
    if (organic === "true" && !row.is_organic) return false;
    if (missing === "gtin" && row.gtin) return false;
    if (missing === "nc_code" && row.nc_code) return false;
    if (missing === "silicie" && row.excise_product_key) return false;
    return true;
  });
}
