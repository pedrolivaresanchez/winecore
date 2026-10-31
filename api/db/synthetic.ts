/**
 * Deterministic synthetic dataset for WineCore.
 * Tax ids, phones and IBANs are computed here at runtime (valid control
 * characters). Nothing in this file is a real person, company or identifier.
 * Lot volume lives in inventory.stock_move (opening balance): inventory.lot
 * has no volume column. One lot per vessel, volume never above capacity.
 */

export type SyntheticScale = "test" | "demo" | "x10";

export interface SyntheticOptions {
  seed: number;
  scale: SyntheticScale;
}

export interface LegalEntityRow {
  id: string;
  code: string;
  legal_name: string;
  trade_name: string | null;
  tax_id: string;
  person_type: "natural" | "legal";
  income_tax: "IRPF" | "IS";
  vat_id: string | null;
  eori: string | null;
  gln: string | null;
  gs1_company_prefix: string | null;
  registry_data: string | null;
  address_line: string;
  postal_code: string;
  city: string;
  province: string;
  country_code: string;
  default_currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoleRow {
  code: "owner" | "approver" | "admin" | "cellar" | "field" | "advisor" | "agent" | "mcp_client";
  name_es: string;
  description: string;
}

export interface AppUserRow {
  id: string;
  email: string;
  display_name: string;
  locale: "es-ES" | "en-GB";
  status: "invited" | "active" | "suspended" | "revoked";
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface UserRoleRow {
  id: string;
  user_id: string;
  role_code: RoleRow["code"];
  legal_entity_id: string | null;
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
}

export interface ContactRow {
  id: string;
  kind: "company" | "person";
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  tax_id_type: "nif" | "nie" | "vat_eu" | "passport" | "foreign_id" | "none";
  tax_id_country: string | null;
  vat_id_validated_at: string | null;
  country_code: string;
  language: "es" | "en";
  currency: string;
  is_customer: boolean;
  is_supplier: boolean;
  is_carrier: boolean;
  is_logistics_operator: boolean;
  vat_regime:
    | "general"
    | "equivalence_surcharge"
    | "export"
    | "intra_eu"
    | "canary_ceuta_melilla"
    | "exempt_other";
  default_channel: string | null;
  default_price_list_id: string | null;
  payment_method: "transfer" | "direct_debit" | "card" | "cash" | "stripe" | "other" | null;
  payment_terms_days: number;
  iban_enc: string | null;
  iban_last4: string | null;
  sepa_mandate_ref: string | null;
  sepa_mandate_date: string | null;
  excise_number: string | null;
  eori: string | null;
  gln: string | null;
  include_in_m347: boolean;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_consent_source: string | null;
  notes: string | null;
  merged_into_id: string | null;
  archived_at: string | null;
  legacy_refs: Record<string, string>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContactAddressRow {
  id: string;
  contact_id: string;
  kind: "billing" | "shipping" | "both";
  label: string | null;
  line1: string;
  line2: string | null;
  postal_code: string;
  city: string;
  province: string | null;
  country_code: string;
  gln: string | null;
  is_default: boolean;
  created_at: string;
  archived_at: string | null;
}

export interface ContactPersonRow {
  id: string;
  contact_id: string;
  full_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  receives_invoices: boolean;
  receives_dunning: boolean;
  created_at: string;
  archived_at: string | null;
}

export interface WineRow {
  id: string;
  code: string;
  name: string;
  color: "red" | "white" | "rose" | "orange" | "sweet" | "sparkling" | "other";
  category: "wine" | "pgi_wine" | "pdo_wine" | "fortified" | "other";
  pdo_pgi_name: string | null;
  is_single_plot: boolean;
  is_organic: boolean;
  no_added_sulfites: boolean;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface FormatRow {
  id: string;
  code: string;
  name: string;
  container: "bottle" | "bag_in_box" | "keg" | "other";
  nominal_volume_ml: number;
  units_per_case: number;
  cases_per_pallet: number;
  unit_gross_weight_g: number | null;
  unit_net_weight_g: number | null;
  is_active: boolean;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  name_en: string | null;
  kind: "wine";
  wine_id: string;
  vintage: number;
  format_id: string;
  unit: "ud";
  gtin: string | null;
  gtin_case: string | null;
  nc_code: string | null;
  excise_product_key: string | null;
  alcohol_pct: number;
  default_tax_code: string | null;
  sales_account: string | null;
  is_stock_tracked: boolean;
  requires_lot: boolean;
  is_active: boolean;
  legacy_refs: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface PriceListRow {
  id: string;
  code: "final" | "distributor" | "shop";
  name: string;
  currency: string;
  tax_included: boolean;
  is_active: boolean;
}

export interface PriceListVersionRow {
  id: string;
  price_list_id: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  status: "draft" | "active" | "retired";
  notes: string | null;
  approval_request_id: string | null;
  activated_at: string | null;
  created_by: string;
  created_at: string;
}

export interface PriceListItemRow {
  id: string;
  version_id: string;
  product_id: string;
  min_qty: string;
  unit_price: string;
}

export interface TaxWarehouseRow {
  id: string;
  legal_entity_id: string;
  cae: string;
  activity_code: string;
  name: string;
  is_test: boolean;
  silicie_since: string | null;
  is_active: boolean;
  created_at: string;
}

export interface LocationAddress {
  line1: string;
  postal_code: string;
  city: string;
  province: string;
  country_code: string;
}

export interface LocationRow {
  id: string;
  code: string;
  name: string;
  kind:
    | "cellar"
    | "cellar_shop"
    | "own_warehouse"
    | "third_party_warehouse"
    | "forwarder"
    | "in_transit"
    | "customer_virtual";
  tax_warehouse_id: string | null;
  operator_contact_id: string | null;
  controlling_entity_id: string;
  address: LocationAddress | null;
  is_virtual: boolean;
  is_active: boolean;
  created_at: string;
}

export interface VesselRow {
  id: string;
  code: string;
  name: string;
  kind: "tank_storage" | "tank_fermenter" | "barrel" | "demijohn" | "ibc" | "other";
  capacity_ml: number;
  has_cooling_jacket: boolean;
  material: "stainless_steel" | "oak" | "glass" | "concrete" | "plastic" | "other";
  location_id: string;
  zone: string | null;
  sisv_code: string | null;
  qr_token: string | null;
  status: "in_service" | "out_of_service" | "retired";
  notes: string | null;
  created_at: string;
}

export interface LotRow {
  id: string;
  producer_entity_id: string;
  code: string;
  kind: "grape" | "must" | "wine" | "bottled";
  wine_id: string | null;
  vintage: number | null;
  is_organic: boolean;
  status: "active" | "depleted" | "closed";
  origin: "reception" | "operation" | "opening_count" | "legacy";
  created_by_operation_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface StockMoveRow {
  id: string;
  occurred_at: string;
  move_type: "opening";
  location_id: string;
  vessel_id: string | null;
  owner_entity_id: string;
  lot_id: string | null;
  product_id: string | null;
  product_state: "grape" | "must" | "wine" | "packaged_unlabeled" | "packaged_labeled" | "goods";
  qty_units: number;
  volume_ml: number;
  mass_g: number;
  loss_kind: "authorized" | "incident" | null;
  source_table: string;
  source_id: string;
  source_line_id: string | null;
  reverses_move_id: string | null;
  created_by: string;
  created_at: string;
}

export interface SyntheticDataset {
  legal_entity: LegalEntityRow[];
  role: RoleRow[];
  app_user: AppUserRow[];
  user_role: UserRoleRow[];
  contact: ContactRow[];
  contact_address: ContactAddressRow[];
  contact_person: ContactPersonRow[];
  wine: WineRow[];
  format: FormatRow[];
  product: ProductRow[];
  price_list: PriceListRow[];
  price_list_version: PriceListVersionRow[];
  price_list_item: PriceListItemRow[];
  tax_warehouse: TaxWarehouseRow[];
  location: LocationRow[];
  vessel: VesselRow[];
  lot: LotRow[];
  stock_move: StockMoveRow[];
}

type Rng = () => number;

interface ScaleSpec {
  contacts: number;
  users: number;
  wines: number;
  products: number;
  vessels: number;
  lots: number;
  logisticsOperators: number;
  carriers: number;
  suppliers: number;
  nearDuplicatePairs: number;
  externalWarehouses: number;
}

const SCALES: Record<SyntheticScale, ScaleSpec> = {
  test: {
    contacts: 16,
    users: 6,
    wines: 2,
    products: 8,
    vessels: 8,
    lots: 6,
    logisticsOperators: 1,
    carriers: 1,
    suppliers: 2,
    nearDuplicatePairs: 1,
    externalWarehouses: 1,
  },
  demo: {
    contacts: 150,
    users: 8,
    wines: 8,
    products: 40,
    vessels: 30,
    lots: 24,
    logisticsOperators: 3,
    carriers: 4,
    suppliers: 18,
    nearDuplicatePairs: 4,
    externalWarehouses: 3,
  },
  x10: {
    contacts: 1500,
    users: 80,
    wines: 20,
    products: 400,
    vessels: 300,
    lots: 240,
    logisticsOperators: 30,
    carriers: 40,
    suppliers: 180,
    nearDuplicatePairs: 40,
    externalWarehouses: 30,
  },
};

const T0 = "2026-02-01T08:00:00.000Z";
const LOGIN_AT = "2026-10-01T09:30:00.000Z";
const OPENING_AT = "2026-01-15T10:00:00.000Z";
const ACTOR = "synthetic";

const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_LETTERS = "JABCDEFGHI";

const ROLES: RoleRow[] = [
  { code: "owner", name_es: "Dirección", description: "Todo, incluida la configuración, los aprobadores y los módulos" },
  { code: "approver", name_es: "Aprobador", description: "Aprueba emisiones en lote y envíos regulatorios de las entidades asignadas" },
  { code: "admin", name_es: "Administración", description: "Prepara documentos, facturas, compras y cobros; no aprueba envíos regulatorios" },
  { code: "cellar", name_es: "Bodega", description: "Operaciones de bodega, envasado, aforos y analíticas" },
  { code: "field", name_es: "Campo", description: "Viñedo: tratamientos, labores y controles de maduración" },
  { code: "advisor", name_es: "Asesoría", description: "Lectura y exportaciones fiscales y contables" },
  { code: "agent", name_es: "Agente", description: "Cuenta de servicio de un miembro de la workforce de Timbal (mínimo privilegio)" },
  { code: "mcp_client", name_es: "Cliente MCP", description: "Cliente MCP externo (CVBOT): lectura libre, escritura con confirmación" },
];

const HUMAN_ROLES = ["owner", "admin", "approver", "cellar", "field", "advisor"] as const;
const EXTRA_ROLES = ["admin", "cellar", "field", "advisor"] as const;

const USER_FIRST = [
  "Clara", "Marcos", "Nuria", "Iago", "Belén", "Unai", "Aitana", "Bruno", "Elena", "Hugo",
  "Marta", "Pablo", "Sofía", "Diego", "Carmen", "Andrés", "Lucía", "Javier", "Alba", "Rocío",
] as const;

const PERSON_FIRST = [
  "Lara", "Mateo", "Inés", "Gael", "Noa", "Leo", "Aina", "Bruno", "Celia", "Darío",
  "Elsa", "Félix", "Greta", "Héctor", "Iris", "Joel", "Kira", "Lorenzo", "Maia", "Nil",
] as const;

const PERSON_LAST = [
  "Cepa", "Mosto", "Bobal", "Airén", "Jarilla", "Bancal", "Lagar", "Tinaja", "Sarmiento",
  "Majuelo", "Hollejo", "Raspon", "Orujo", "Cubilla", "Verdín",
] as const;

const PREFIXES = [
  "Vinoteca", "Distribuciones", "Bodegas", "Comercial", "Exportaciones",
  "Restaurante", "Taberna", "Almacenes", "Heredad", "Casa",
] as const;

const SUPPLIER_PREFIX = ["Tonelería", "Corchos", "Envases", "Laboratorio", "Etiquetas", "Insumos"] as const;

const CORES = [
  "La Encina", "El Roble", "Los Olivos", "La Jarilla", "El Barranco", "Las Cepas",
  "La Loma", "El Secano", "La Noria", "El Huerto", "El Aljibe", "La Era",
  "El Pinar", "La Solana", "El Bancal", "La Casilla", "Los Almendros", "El Molino",
  "La Vega", "El Cerrillo", "Los Pámpanos", "La Tinaja", "El Cubillo", "La Solera",
] as const;

const QUALS = ["Norte", "Sur", "Este", "Oeste", "Centro", "Alta", "Baja", "Nueva"] as const;

const STREETS = [
  "Calle de la Encina", "Camino del Lagar", "Plaza del Mosto", "Avenida de las Cepas",
  "Travesía del Roble", "Carril de la Jarilla",
] as const;

const ES_PLACES = [
  { city: "Villarejo del Vino", province: "Albacete", prefix: "02" },
  { city: "Cerro Ejemplo", province: "Ciudad Real", prefix: "13" },
  { city: "Valle de la Jarilla", province: "Cuenca", prefix: "16" },
  { city: "Loma de la Cepa", province: "Toledo", prefix: "45" },
  { city: "Puerto del Secano", province: "Valencia", prefix: "46" },
  { city: "Aldea del Bancal", province: "Albacete", prefix: "02" },
] as const;

const EU_COUNTRIES = ["FR", "DE", "IT", "PT", "NL", "BE", "AT", "IE"] as const;
const NON_EU_COUNTRIES = ["GB", "US", "MX", "JP", "CH", "NO"] as const;

const CURRENCY: Record<string, string> = {
  ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", PT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", IE: "EUR",
  GB: "GBP", US: "USD", MX: "USD", JP: "JPY", CH: "CHF", NO: "NOK",
};

const CALLING: Record<string, string> = {
  FR: "+33", DE: "+49", IT: "+39", PT: "+351", NL: "+31", BE: "+32", AT: "+43", IE: "+353",
  GB: "+44", US: "+1", MX: "+52", JP: "+81", CH: "+41", NO: "+47",
};

const FOREIGN_PLACE: Record<string, { city: string; province: string }> = {
  FR: { city: "Lyon Ejemplo", province: "Rhone" },
  DE: { city: "Hamburgo Ejemplo", province: "Hamburgo" },
  IT: { city: "Turín Ejemplo", province: "Piamonte" },
  PT: { city: "Oporto Ejemplo", province: "Norte" },
  NL: { city: "Utrecht Ejemplo", province: "Utrecht" },
  BE: { city: "Gante Ejemplo", province: "Flandes" },
  AT: { city: "Graz Ejemplo", province: "Estiria" },
  IE: { city: "Cork Ejemplo", province: "Munster" },
  GB: { city: "Bristol Ejemplo", province: "Avon" },
  US: { city: "Oak Ejemplo", province: "California" },
  MX: { city: "Querétaro Ejemplo", province: "Querétaro" },
  JP: { city: "Kobe Ejemplo", province: "Hyogo" },
  CH: { city: "Lausana Ejemplo", province: "Vaud" },
  NO: { city: "Bergen Ejemplo", province: "Vestland" },
};

interface WineDef {
  code: string;
  name: string;
  color: WineRow["color"];
  category: WineRow["category"];
  pdo: string | null;
  single: boolean;
  organic: boolean;
  noSulfites: boolean;
}

const WINE_DEFS: WineDef[] = [
  { code: "ENCINA", name: "Tinto La Encina", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: true, organic: true, noSulfites: true },
  { code: "ROBLE", name: "Blanco El Roble", color: "white", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "JARILLA", name: "Rosado La Jarilla", color: "rose", category: "pgi_wine", pdo: "IGP Tierra del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "BARRANCO", name: "Garnacha El Barranco", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: true, organic: true, noSulfites: false },
  { code: "LOMA", name: "Airén La Loma", color: "white", category: "pgi_wine", pdo: "IGP Tierra del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "CEPAS", name: "Bobal Las Tres Cepas", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "SECANO", name: "Monastrell El Secano", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: true, organic: true, noSulfites: true },
  { code: "CUEVA", name: "Macabeo La Cueva", color: "white", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: false, noSulfites: false },
  { code: "NORIA", name: "Espumoso La Noria", color: "sparkling", category: "wine", pdo: null, single: false, organic: true, noSulfites: false },
  { code: "HUERTO", name: "Tempranillo El Huerto", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "ALJIBE", name: "Malvasía El Aljibe", color: "white", category: "pgi_wine", pdo: "IGP Tierra del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "ERA", name: "Dulce La Era", color: "sweet", category: "wine", pdo: null, single: false, organic: true, noSulfites: false },
  { code: "PINAR", name: "Naranja El Pinar", color: "orange", category: "wine", pdo: null, single: true, organic: true, noSulfites: true },
  { code: "SOLANA", name: "Mencía La Solana", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "CORRAL", name: "Parellada El Corral", color: "white", category: "pgi_wine", pdo: "IGP Tierra del Ejemplo", single: false, organic: false, noSulfites: false },
  { code: "GRACIANO", name: "Graciano La Casilla", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "VIOGNIER", name: "Viognier El Pinar", color: "white", category: "wine", pdo: null, single: true, organic: true, noSulfites: false },
  { code: "CARINENA", name: "Cariñena Los Almendros", color: "red", category: "pdo_wine", pdo: "DOP Campos del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "BANCAL", name: "Xarello El Bancal", color: "white", category: "pgi_wine", pdo: "IGP Tierra del Ejemplo", single: false, organic: true, noSulfites: false },
  { code: "MAJUELO", name: "Syrah El Majuelo", color: "red", category: "wine", pdo: null, single: false, organic: true, noSulfites: false },
];

interface FormatDef {
  code: string;
  name: string;
  container: FormatRow["container"];
  ml: number;
  unitsPerCase: number;
  casesPerPallet: number;
  gross: number;
  net: number;
}

const FORMAT_DEFS: FormatDef[] = [
  { code: "B037", name: "Botella 37,5 cl", container: "bottle", ml: 375, unitsPerCase: 12, casesPerPallet: 140, gross: 650, net: 375 },
  { code: "B050", name: "Botella 50 cl", container: "bottle", ml: 500, unitsPerCase: 12, casesPerPallet: 120, gross: 850, net: 500 },
  { code: "B075", name: "Botella 75 cl", container: "bottle", ml: 750, unitsPerCase: 6, casesPerPallet: 105, gross: 1200, net: 750 },
  { code: "B150", name: "Botella 150 cl", container: "bottle", ml: 1500, unitsPerCase: 3, casesPerPallet: 60, gross: 2300, net: 1500 },
  { code: "BIB3", name: "Bag-in-box 3 L", container: "bag_in_box", ml: 3000, unitsPerCase: 1, casesPerPallet: 48, gross: 3200, net: 3000 },
  { code: "BIB5", name: "Bag-in-box 5 L", container: "bag_in_box", ml: 5000, unitsPerCase: 1, casesPerPallet: 40, gross: 5300, net: 5000 },
];

const ABV: Record<WineRow["color"], number> = {
  red: 14,
  white: 12.5,
  rose: 13,
  orange: 13,
  sweet: 15,
  sparkling: 12,
  other: 12,
};

const COLOR_EN: Record<WineRow["color"], string> = {
  red: "Red",
  white: "White",
  rose: "Rose",
  orange: "Orange",
  sweet: "Sweet",
  sparkling: "Sparkling",
  other: "Wine",
};

const LIST_DEFS = [
  { code: "final" as const, name: "Tarifa cliente final", taxIncluded: false, factor: 100, minQty: "1.000" },
  { code: "distributor" as const, name: "Tarifa distribuidor", taxIncluded: false, factor: 62, minQty: "6.000" },
  { code: "shop" as const, name: "Tarifa tienda", taxIncluded: true, factor: 121, minQty: "1.000" },
];

type Bucket = "logistics" | "carrier" | "supplier" | "customer";

interface ProductPlan {
  wineIndex: number;
  vintage: number;
  formatCode: string;
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`synthetic: missing ${label}`);
  return value;
}

function makeRng(seed: number): Rng {
  let x = seed >>> 0;
  if (x === 0) x = 0x6d2b79f5;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function digits(rng: Rng, n: number): string {
  let out = "";
  for (let i = 0; i < n; i += 1) out += String(int(rng, 0, 9));
  return out;
}

function letters(rng: Rng, n: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < n; i += 1) out += must(alphabet[int(rng, 0, alphabet.length - 1)], "letter");
  return out;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function nifLetter(n: number): string {
  return must(NIF_LETTERS[n % 23], "nif letter");
}

function cifControlDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    let n = must(body[i], "cif digit").charCodeAt(0) - 48;
    if (i % 2 === 0) {
      n *= 2;
      sum += Math.floor(n / 10) + (n % 10);
    } else {
      sum += n;
    }
  }
  return String((10 - (sum % 10)) % 10);
}

function gs1Check(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const digit = must(data[data.length - 1 - i], "gs1").charCodeAt(0) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

function uuid(rng: Rng): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 1) bytes.push(int(rng, 0, 255));
  const b6 = must(bytes[6], "uuid");
  const b8 = must(bytes[8], "uuid");
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function takeUnique(used: Set<string>, build: () => string): string {
  for (let i = 0; i < 40; i += 1) {
    const value = build();
    if (!used.has(value)) {
      used.add(value);
      return value;
    }
  }
  throw new Error("synthetic: exhausted unique identifier space");
}

function makeNif(rng: Rng): string {
  const n = int(rng, 10_000_000, 80_000_000);
  return `${pad(n, 8)}${nifLetter(n)}`;
}

function makeNie(rng: Rng): string {
  const prefixes = ["X", "Y", "Z"] as const;
  const prefix = must(prefixes[int(rng, 0, 2)], "nie prefix");
  const mapped = prefix === "X" ? "0" : prefix === "Y" ? "1" : "2";
  const body = pad(int(rng, 0, 9_999_999), 7);
  return `${prefix}${body}${nifLetter(Number(mapped + body))}`;
}

function makeCif(rng: Rng, letter: "A" | "B"): string {
  let body = digits(rng, 7);
  if (body === "0000000") body = "0000001";
  return `${letter}${body}${cifControlDigit(body)}`;
}

function cccControl(value: string, weights: readonly number[]): string {
  let sum = 0;
  for (let i = 0; i < value.length; i += 1) {
    sum += (must(value[i], "ccc").charCodeAt(0) - 48) * must(weights[i], "weight");
  }
  const digit = 11 - (sum % 11);
  if (digit === 11) return "0";
  if (digit === 10) return "1";
  return String(digit);
}

function ibanCheckDigits(bban: string): string {
  const rearranged = `${bban}ES00`;
  let expanded = "";
  for (const ch of rearranged) {
    expanded += ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let rem = 0;
  for (const ch of expanded) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return pad(98 - rem, 2);
}

function ibanIsValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let expanded = "";
  for (const ch of rearranged) {
    expanded += ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
  }
  let rem = 0;
  for (const ch of expanded) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rem === 1;
}

const CCC_W8 = [4, 8, 5, 10, 9, 7, 3, 6] as const;
const CCC_W10 = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6] as const;

function spanishIban(rng: Rng): string {
  const bank = pad(int(rng, 1000, 9999), 4);
  const branch = pad(int(rng, 0, 9999), 4);
  const account = digits(rng, 10);
  const control = `${cccControl(bank + branch, CCC_W8)}${cccControl(account, CCC_W10)}`;
  const bban = `${bank}${branch}${control}${account}`;
  const iban = `ES${ibanCheckDigits(bban)}${bban}`;
  if (!ibanIsValid(iban)) throw new Error("synthetic: IBAN control failed");
  return iban;
}

function spanishPhone(rng: Rng): string {
  const first = must(["6", "7", "8", "9"][int(rng, 0, 3)], "phone");
  const rest = digits(rng, 8);
  const n = first + rest;
  return `+34 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

function foreignPhone(country: string, rng: Rng): string {
  const prefix = must(CALLING[country], "calling");
  const first = String(int(rng, 1, 5));
  return `${prefix} ${first}${digits(rng, 8)}`;
}

function uniqueGln(rng: Rng, used: Set<string>): string {
  return takeUnique(used, () => {
    const data = `84${digits(rng, 10)}`;
    return data + gs1Check(data);
  });
}

function gtin14(gtin13Value: string): string {
  const data = `1${gtin13Value.slice(0, 12)}`;
  return data + gs1Check(data);
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function emailFor(prefix: string, index: number, name: string): string {
  return `${prefix}.${index}.${slug(name)}@example.com`;
}

function money(micro: number): string {
  const whole = Math.trunc(micro / 1_000_000);
  const frac = pad(Math.abs(micro % 1_000_000), 6);
  return `${whole}.${frac}`;
}

function unitPrice(centsPerLiter: number, volumeMl: number, factor: number): string {
  const cents = Math.round((centsPerLiter * volumeMl) / 1000);
  const adjusted = Math.round((cents * factor) / 100);
  return money(adjusted * 10_000);
}

function companyStem(bucket: Bucket, index: number): string {
  if (bucket === "logistics" || bucket === "carrier") {
    const core = must(CORES[index % CORES.length], "core");
    const qual = must(QUALS[Math.floor(index / CORES.length) % QUALS.length], "qual");
    const serial = Math.floor(index / (CORES.length * QUALS.length));
    const tail = serial === 0 ? "" : ` ${serial + 1}`;
    const word = bucket === "logistics" ? "Logística" : "Transportes";
    return `${word} ${core} ${qual}${tail}`;
  }
  const prefixes = bucket === "supplier" ? SUPPLIER_PREFIX : PREFIXES;
  const prefix = must(prefixes[index % prefixes.length], "prefix");
  const core = must(CORES[Math.floor(index / prefixes.length) % CORES.length], "core");
  const qual = must(QUALS[Math.floor(index / (prefixes.length * CORES.length)) % QUALS.length], "qual");
  const serial = Math.floor(index / (prefixes.length * CORES.length * QUALS.length));
  const tail = serial === 0 ? "" : ` ${serial + 1}`;
  return `${prefix} ${core} ${qual}${tail}`;
}

function personName(index: number): string {
  const first = must(PERSON_FIRST[index % PERSON_FIRST.length], "first");
  const last = must(PERSON_LAST[Math.floor(index / PERSON_FIRST.length) % PERSON_LAST.length], "last");
  const serial = Math.floor(index / (PERSON_FIRST.length * PERSON_LAST.length));
  const tail = serial === 0 ? "" : ` ${serial + 1}`;
  return `${first} Ejemplo ${last}${tail}`;
}

function userName(index: number): string {
  const first = must(USER_FIRST[index % USER_FIRST.length], "user");
  const serial = Math.floor(index / USER_FIRST.length);
  return serial === 0 ? `${first} Ejemplo` : `${first} Ejemplo ${serial + 1}`;
}

function roleFor(index: number): (typeof HUMAN_ROLES)[number] {
  if (index < HUMAN_ROLES.length) return must(HUMAN_ROLES[index], "role");
  return must(EXTRA_ROLES[(index - HUMAN_ROLES.length) % EXTRA_ROLES.length], "extra role");
}

function planProducts(scale: SyntheticScale): ProductPlan[] {
  if (scale === "test") {
    const out: ProductPlan[] = [];
    for (const wineIndex of [0, 1]) {
      for (const formatCode of ["B075", "B150", "B037", "BIB3"]) {
        out.push({ wineIndex, vintage: 2025, formatCode });
      }
    }
    return out;
  }
  if (scale === "demo") {
    const out: ProductPlan[] = [];
    for (const vintage of [2024, 2025]) {
      for (let w = 0; w < 8; w += 1) out.push({ wineIndex: w, vintage, formatCode: "B075" });
    }
    for (let w = 0; w < 8; w += 1) out.push({ wineIndex: w, vintage: 2025, formatCode: "B150" });
    for (let w = 0; w < 8; w += 1) out.push({ wineIndex: w, vintage: 2025, formatCode: "B037" });
    for (let w = 0; w < 4; w += 1) out.push({ wineIndex: w, vintage: 2025, formatCode: "BIB3" });
    for (let w = 0; w < 4; w += 1) out.push({ wineIndex: w, vintage: 2024, formatCode: "B150" });
    return out;
  }
  const out: ProductPlan[] = [];
  for (const vintage of [2022, 2023, 2024, 2025]) {
    for (let w = 0; w < 20; w += 1) {
      for (const formatCode of ["B075", "B150", "B037", "BIB3", "BIB5"]) {
        out.push({ wineIndex: w, vintage, formatCode });
      }
    }
  }
  return out;
}

function vesselMix(total: number): { storage: number; fermenter: number; barrel: number; demijohn: number; ibc: number } {
  const fermenter = Math.round(total * 0.2);
  const barrel = Math.round((total * 8) / 30);
  const demijohn = Math.max(1, Math.round((total * 2) / 30));
  const ibc = Math.max(1, Math.round((total * 2) / 30));
  const storage = total - fermenter - barrel - demijohn - ibc;
  if (storage < 1) throw new Error("synthetic: vessel mix");
  return { storage, fermenter, barrel, demijohn, ibc };
}

function euVat(country: string, rng: Rng): string {
  if (country === "DE" || country === "PT") return `${country}${digits(rng, 9)}`;
  if (country === "FR") return `FR${letters(rng, 2)}${digits(rng, 9)}`;
  if (country === "IT") return `IT${digits(rng, 11)}`;
  if (country === "NL") return `NL${digits(rng, 9)}B${digits(rng, 2)}`;
  if (country === "BE") return `BE${digits(rng, 10)}`;
  if (country === "AT") return `ATU${digits(rng, 8)}`;
  if (country === "IE") return `IE${digits(rng, 7)}${letters(rng, 1)}`;
  return `${country}${digits(rng, 9)}`;
}

function bucketOf(index: number, spec: ScaleSpec): Bucket {
  if (index < spec.logisticsOperators) return "logistics";
  if (index < spec.logisticsOperators + spec.carriers) return "carrier";
  if (index < spec.logisticsOperators + spec.carriers + spec.suppliers) return "supplier";
  return "customer";
}

export function generateSynthetic(opts: SyntheticOptions): SyntheticDataset {
  const spec = SCALES[opts.scale];
  const rng = makeRng(opts.seed);
  const taxIds = new Set<string>();
  const glns = new Set<string>();
  const emails = new Set<string>();
  const phones = new Set<string>();

  const poTax = takeUnique(taxIds, () => makeNif(rng));
  const cvpoTax = takeUnique(taxIds, () => makeCif(rng, "B"));
  const poGln = uniqueGln(rng, glns);
  const cvpoGln = uniqueGln(rng, glns);
  const poId = uuid(rng);
  const cvpoId = uuid(rng);

  const legal_entity: LegalEntityRow[] = [
    {
      id: poId,
      code: "PO",
      legal_name: "Elías Ejemplo Cepa",
      trade_name: "Bodega Ejemplo",
      tax_id: poTax,
      person_type: "natural",
      income_tax: "IRPF",
      vat_id: `ES${poTax}`,
      eori: `ES${poTax}`,
      gln: poGln,
      gs1_company_prefix: poGln.slice(0, 8),
      registry_data: null,
      address_line: "Camino del Lagar 7",
      postal_code: "02240",
      city: "Villarejo del Vino",
      province: "Albacete",
      country_code: "ES",
      default_currency: "EUR",
      is_active: true,
      created_at: T0,
      updated_at: T0,
    },
    {
      id: cvpoId,
      code: "CVPO",
      legal_name: "Comercializadora Ejemplo del Vino S.L.",
      trade_name: "CVPO Ejemplo",
      tax_id: cvpoTax,
      person_type: "legal",
      income_tax: "IS",
      vat_id: `ES${cvpoTax}`,
      eori: `ES${cvpoTax}`,
      gln: cvpoGln,
      gs1_company_prefix: cvpoGln.slice(0, 8),
      registry_data: "Registro Mercantil de Valencia, hoja EJ-1, inscripción 1",
      address_line: "Avenida de las Cepas 18",
      postal_code: "46021",
      city: "Puerto del Secano",
      province: "Valencia",
      country_code: "ES",
      default_currency: "EUR",
      is_active: true,
      created_at: T0,
      updated_at: T0,
    },
  ];

  const app_user: AppUserRow[] = [];
  for (let i = 0; i < spec.users; i += 1) {
    const display_name = userName(i);
    const email = emailFor("u", i, display_name);
    if (emails.has(email)) throw new Error("synthetic: duplicate email");
    emails.add(email);
    const status: AppUserRow["status"] =
      spec.users >= 3 && i === spec.users - 1 ? "invited" : spec.users >= 4 && i === spec.users - 2 ? "suspended" : "active";
    const role = roleFor(i);
    app_user.push({
      id: uuid(rng),
      email,
      display_name,
      locale: role === "advisor" && i === 5 ? "en-GB" : "es-ES",
      status,
      created_at: T0,
      updated_at: T0,
      last_login_at: status === "invited" ? null : LOGIN_AT,
    });
  }

  const owner = must(app_user[0], "owner");
  const user_role: UserRoleRow[] = app_user.map((user, i) => {
    const role_code = roleFor(i);
    const scoped = role_code === "cellar" || role_code === "field";
    return {
      id: uuid(rng),
      user_id: user.id,
      role_code,
      legal_entity_id: scoped ? poId : null,
      granted_by: user.id === owner.id ? null : owner.id,
      granted_at: T0,
      revoked_at: null,
    };
  });

  const wine: WineRow[] = WINE_DEFS.slice(0, spec.wines).map((def) => ({
    id: uuid(rng),
    code: def.code,
    name: def.name,
    color: def.color,
    category: def.category,
    pdo_pgi_name: def.pdo,
    is_single_plot: def.single,
    is_organic: def.organic,
    no_added_sulfites: def.noSulfites,
    description: "Referencia de demostración, elaborada para datos sintéticos.",
    is_active: true,
    created_at: T0,
  }));

  const format: FormatRow[] = FORMAT_DEFS.map((def) => ({
    id: uuid(rng),
    code: def.code,
    name: def.name,
    container: def.container,
    nominal_volume_ml: def.ml,
    units_per_case: def.unitsPerCase,
    cases_per_pallet: def.casesPerPallet,
    unit_gross_weight_g: def.gross,
    unit_net_weight_g: def.net,
    is_active: true,
  }));
  const formatByCode = new Map(format.map((row) => [row.code, row]));

  const plan = planProducts(opts.scale);
  if (plan.length !== spec.products) throw new Error(`synthetic: product plan ${plan.length}`);
  const product: ProductRow[] = [];
  const seenSku = new Set<string>();
  const gtins = new Set<string>();
  plan.forEach((item, index) => {
    const wineRow = must(wine[item.wineIndex], "wine");
    const formatRow = must(formatByCode.get(item.formatCode), "format");
    const sku = `${wineRow.code}-${item.vintage}-${formatRow.code}`;
    if (seenSku.has(sku)) throw new Error(`synthetic: duplicate sku ${sku}`);
    seenSku.add(sku);
    const withGtin = index % 5 !== 4;
    const gtin = withGtin
      ? takeUnique(gtins, () => {
          const data = `84${digits(rng, 10)}`;
          return data + gs1Check(data);
        })
      : null;
    const missingNc = index % 6 === 5;
    const missingExcise = index % 7 === 6;
    product.push({
      id: uuid(rng),
      sku,
      name: `${wineRow.name} ${item.vintage} ${formatRow.name}`,
      name_en: `${COLOR_EN[wineRow.color]} ${wineRow.code} ${item.vintage} ${formatRow.nominal_volume_ml} ml`,
      kind: "wine",
      wine_id: wineRow.id,
      vintage: item.vintage,
      format_id: formatRow.id,
      unit: "ud",
      gtin,
      gtin_case: gtin === null ? null : gtin14(gtin),
      nc_code: missingNc ? null : formatRow.nominal_volume_ml <= 2000 ? "22042100" : "22042200",
      excise_product_key: missingExcise ? null : `${formatRow.code}-${wineRow.code}`,
      alcohol_pct: ABV[wineRow.color],
      default_tax_code: "IVA21",
      sales_account: "70000000",
      is_stock_tracked: true,
      requires_lot: true,
      is_active: true,
      legacy_refs: {},
      created_at: T0,
      updated_at: T0,
    });
  });

  const price_list: PriceListRow[] = LIST_DEFS.map((def) => ({
    id: uuid(rng),
    code: def.code,
    name: def.name,
    currency: "EUR",
    tax_included: def.taxIncluded,
    is_active: true,
  }));
  const listByCode = new Map(price_list.map((row) => [row.code, row]));

  const price_list_version: PriceListVersionRow[] = [];
  const price_list_item: PriceListItemRow[] = [];
  for (const listDef of LIST_DEFS) {
    const list = must(listByCode.get(listDef.code), "list");
    const versions: Array<{ version: number; from: string; to: string | null; status: PriceListVersionRow["status"]; notes: string; activated_at: string | null }> = [
      { version: 1, from: "2025-01-01", to: "2026-01-01", status: "retired", notes: "Cerrada", activated_at: "2024-12-15T10:00:00.000Z" },
      { version: 2, from: "2026-01-01", to: null, status: "active", notes: "Vigente", activated_at: "2025-12-20T10:00:00.000Z" },
      { version: 3, from: "2027-01-01", to: null, status: "draft", notes: "Borrador del año siguiente", activated_at: null },
    ];
    for (const version of versions) {
      const versionId = uuid(rng);
      price_list_version.push({
        id: versionId,
        price_list_id: list.id,
        version: version.version,
        valid_from: version.from,
        valid_to: version.to,
        status: version.status,
        notes: version.notes,
        approval_request_id: null,
        activated_at: version.activated_at,
        created_by: ACTOR,
        created_at: T0,
      });
      for (const row of product) {
        const wineRow = must(wine.find((item) => item.id === row.wine_id), "priced wine");
        const wineIndex = WINE_DEFS.findIndex((item) => item.code === wineRow.code);
        const formatRow = must(format.find((item) => item.id === row.format_id), "priced format");
        const centsPerLiter = 1600 + wineIndex * 90 + (version.version - 1) * 40;
        price_list_item.push({
          id: uuid(rng),
          version_id: versionId,
          product_id: row.id,
          min_qty: listDef.minQty,
          unit_price: unitPrice(centsPerLiter, formatRow.nominal_volume_ml, listDef.factor),
        });
      }
    }
  }

  const customerStart = spec.logisticsOperators + spec.carriers + spec.suppliers;
  const dupStart = spec.contacts - spec.nearDuplicatePairs * 2;
  if (dupStart < customerStart) throw new Error("synthetic: duplicate window overlaps roles");

  const contact: ContactRow[] = [];
  const contact_address: ContactAddressRow[] = [];
  const contact_person: ContactPersonRow[] = [];
  const logisticsIds: string[] = [];
  let nieIssued = false;

  interface KeptPlace {
    line1: string;
    postal: string;
    city: string;
    province: string;
    country: string;
    phone: string;
  }
  const kept = new Map<number, KeptPlace>();

  for (let i = 0; i < spec.contacts; i += 1) {
    const bucket = bucketOf(i, spec);
    const isTwin = i >= dupStart && (i - dupStart) % 2 === 1;
    const stemIndex = isTwin ? i - 1 : i;
    const isPerson = bucket === "customer" && i < dupStart && i % 5 === 0;
    const basePlace = isTwin ? kept.get(stemIndex) : undefined;
    if (isTwin && basePlace === undefined) throw new Error("synthetic: twin without base contact");
    let country = "ES";
    if (basePlace !== undefined) {
      country = basePlace.country;
    } else if (bucket === "supplier" && i % 3 === 0) {
      country = must(EU_COUNTRIES[i % EU_COUNTRIES.length], "eu");
    } else if (bucket === "customer") {
      const slot = i % 10;
      if (slot === 7 || slot === 8) country = must(EU_COUNTRIES[i % EU_COUNTRIES.length], "eu");
      else if (slot === 9) country = must(NON_EU_COUNTRIES[i % NON_EU_COUNTRIES.length], "non-eu");
    }
    const canary = bucket === "customer" && !isPerson && !isTwin && country === "ES" && (i % 17 === 0 || i === customerStart);
    const letter: "A" | "B" = stemIndex % 9 === 0 ? "A" : "B";
    const suffix = letter === "A" ? "S.A." : "S.L.";
    const stem = isPerson ? personName(i) : companyStem(bucket, stemIndex);
    const legal_name = isPerson ? stem : isTwin ? `${stem.toUpperCase()}, ${suffix}` : `${stem} ${suffix}`;
    const trade_name = isPerson ? null : stem;

    let tax_id: string;
    let tax_id_type: ContactRow["tax_id_type"];
    if (country === "ES") {
      if (isPerson && (i % 7 === 0 || !nieIssued)) {
        tax_id = takeUnique(taxIds, () => makeNie(rng));
        tax_id_type = "nie";
        nieIssued = true;
      } else if (isPerson) {
        tax_id = takeUnique(taxIds, () => makeNif(rng));
        tax_id_type = "nif";
      } else {
        tax_id = takeUnique(taxIds, () => makeCif(rng, letter));
        tax_id_type = "nif";
      }
    } else if ((EU_COUNTRIES as readonly string[]).includes(country)) {
      tax_id = takeUnique(taxIds, () => euVat(country, rng));
      tax_id_type = "vat_eu";
    } else {
      tax_id = takeUnique(taxIds, () => `${country}${digits(rng, 8)}${letters(rng, 1)}`);
      tax_id_type = "foreign_id";
    }

    let line1: string;
    let postal: string;
    let city: string;
    let province: string;
    if (basePlace !== undefined) {
      line1 = basePlace.line1.replace(/(\d+)$/, "nº $1");
      postal = basePlace.postal;
      city = basePlace.city;
      province = basePlace.province;
    } else if (canary) {
      const island = i % 2 === 0;
      line1 = `${must(STREETS[i % STREETS.length], "street")} ${1 + (i % 80)}`;
      postal = `${island ? "35" : "38"}${pad(100 + (i % 800), 3)}`;
      city = island ? "Puerto Ejemplo" : "Playa Ejemplo";
      province = island ? "Las Palmas" : "Santa Cruz de Tenerife";
    } else if (country === "ES") {
      const place = must(ES_PLACES[i % ES_PLACES.length], "place");
      line1 = `${must(STREETS[i % STREETS.length], "street")} ${1 + (i % 80)}`;
      postal = `${place.prefix}${pad(100 + (i % 800), 3)}`;
      city = place.city;
      province = place.province;
    } else {
      const place = must(FOREIGN_PLACE[country], "foreign");
      line1 = `${must(STREETS[i % STREETS.length], "street")} ${1 + (i % 80)}`;
      postal = String(10000 + (i % 8000));
      city = place.city;
      province = place.province;
    }

    let phone: string;
    if (basePlace !== undefined) {
      phone = basePlace.phone;
    } else if (country === "ES") {
      phone = takeUnique(phones, () => spanishPhone(rng));
    } else {
      phone = takeUnique(phones, () => foreignPhone(country, rng));
    }
    if (!isTwin) {
      kept.set(i, { line1, postal, city, province, country, phone });
    }

    const eu = (EU_COUNTRIES as readonly string[]).includes(country);
    const canaryPostal = country === "ES" && (postal.startsWith("35") || postal.startsWith("38"));
    let vat_regime: ContactRow["vat_regime"] = "general";
    if (canaryPostal) vat_regime = "canary_ceuta_melilla";
    else if (country === "ES" && bucket === "customer" && i % 11 === 0) vat_regime = "equivalence_surcharge";
    else if (eu) vat_regime = "intra_eu";
    else if (country !== "ES") vat_regime = "export";

    let default_channel: string | null = null;
    if (bucket === "customer") {
      if (country !== "ES" && !canary) default_channel = "export";
      else if (isPerson) default_channel = i % 2 === 0 ? "direct" : "horeca";
      else if (i % 4 === 0) default_channel = "distributor";
      else if (i % 4 === 1) default_channel = "cellar_shop";
      else if (i % 4 === 2) default_channel = "web";
      else default_channel = "horeca";
    }

    let default_price_list_id: string | null = null;
    if (default_channel === "distributor") default_price_list_id = must(listByCode.get("distributor"), "pl").id;
    else if (default_channel === "cellar_shop" || default_channel === "web") default_price_list_id = must(listByCode.get("shop"), "pl").id;
    else if (default_channel !== null) default_price_list_id = must(listByCode.get("final"), "pl").id;

    const directDebit = country === "ES" && bucket === "customer" && i % 3 === 0;
    const iban = directDebit ? spanishIban(rng) : null;
    const marketing = bucket === "customer" && i % 4 === 0;
    const wantsGln = !isPerson && (bucket === "logistics" || default_channel === "distributor");
    const id = uuid(rng);
    if (bucket === "logistics") logisticsIds.push(id);

    const currency = must(CURRENCY[country], "currency");
    contact.push({
      id,
      kind: isPerson ? "person" : "company",
      legal_name,
      trade_name,
      tax_id,
      tax_id_type,
      tax_id_country: country,
      vat_id_validated_at: eu ? "2026-02-15T11:00:00.000Z" : null,
      country_code: country,
      language: country === "ES" || country === "MX" ? "es" : "en",
      currency,
      is_customer: bucket === "customer" || (bucket === "supplier" && i % 13 === 0),
      is_supplier: bucket === "supplier" || bucket === "logistics" || bucket === "carrier",
      is_carrier: bucket === "carrier",
      is_logistics_operator: bucket === "logistics",
      vat_regime,
      default_channel,
      default_price_list_id,
      payment_method: directDebit ? "direct_debit" : bucket === "customer" && i % 3 === 2 ? "card" : "transfer",
      payment_terms_days: directDebit ? 0 : default_channel === "distributor" ? 60 : 30,
      iban_enc: null,
      iban_last4: iban === null ? null : iban.slice(-4),
      sepa_mandate_ref: iban === null ? null : `EJ-${pad(i + 1, 4)}`,
      sepa_mandate_date: iban === null ? null : "2025-04-15",
      excise_number: null,
      eori: null,
      gln: wantsGln ? uniqueGln(rng, glns) : null,
      include_in_m347: country === "ES",
      marketing_consent: marketing,
      marketing_consent_at: marketing ? T0 : null,
      marketing_consent_source: marketing ? "formulario" : null,
      notes: isTwin ? "Mismo nombre normalizado y código postal que otro contacto. Candidato de duplicados." : null,
      merged_into_id: null,
      archived_at: null,
      legacy_refs: {},
      created_by: ACTOR,
      created_at: T0,
      updated_at: T0,
    });

    contact_address.push({
      id: uuid(rng),
      contact_id: id,
      kind: "billing",
      label: "Fiscal",
      line1,
      line2: null,
      postal_code: postal,
      city,
      province,
      country_code: country,
      gln: null,
      is_default: true,
      created_at: T0,
      archived_at: null,
    });
    if (bucket === "customer" && i % 2 === 0) {
      contact_address.push({
        id: uuid(rng),
        contact_id: id,
        kind: "shipping",
        label: "Envío",
        line1: `${line1} nave`,
        line2: null,
        postal_code: postal,
        city,
        province,
        country_code: country,
        gln: null,
        is_default: true,
        created_at: T0,
        archived_at: null,
      });
    }

    const person = personName(i + spec.contacts);
    const personEmail = emailFor("c", i, isPerson ? legal_name : person);
    if (emails.has(personEmail)) throw new Error("synthetic: duplicate email");
    emails.add(personEmail);
    contact_person.push({
      id: uuid(rng),
      contact_id: id,
      full_name: isPerson ? legal_name : person,
      role: isPerson ? "Titular" : bucket === "logistics" || bucket === "carrier" ? "Logística" : bucket === "supplier" ? "Compras" : "Administración",
      email: personEmail,
      phone,
      receives_invoices: bucket === "customer",
      receives_dunning: bucket === "customer" && !directDebit,
      created_at: T0,
      archived_at: null,
    });
  }

  const caeBody = letters(rng, 4) + digits(rng, 7);
  const tax_warehouse: TaxWarehouseRow[] = [
    {
      id: uuid(rng),
      legal_entity_id: poId,
      cae: `ES${caeBody}`,
      activity_code: "V1",
      name: "Fábrica de vino Ejemplo",
      is_test: true,
      silicie_since: "2026-01-01",
      is_active: true,
      created_at: T0,
    },
  ];
  const warehouse = must(tax_warehouse[0], "warehouse");

  const location: LocationRow[] = [
    {
      id: uuid(rng),
      code: "BOD",
      name: "Bodega Ejemplo",
      kind: "cellar",
      tax_warehouse_id: warehouse.id,
      operator_contact_id: null,
      controlling_entity_id: poId,
      address: { line1: "Camino del Lagar 7", postal_code: "02240", city: "Villarejo del Vino", province: "Albacete", country_code: "ES" },
      is_virtual: false,
      is_active: true,
      created_at: T0,
    },
    {
      id: uuid(rng),
      code: "TIENDA",
      name: "Tienda de la bodega",
      kind: "cellar_shop",
      tax_warehouse_id: null,
      operator_contact_id: null,
      controlling_entity_id: poId,
      address: { line1: "Camino del Lagar 9", postal_code: "02240", city: "Villarejo del Vino", province: "Albacete", country_code: "ES" },
      is_virtual: false,
      is_active: true,
      created_at: T0,
    },
    {
      id: uuid(rng),
      code: "VLC",
      name: "Almacén Valencia Ejemplo",
      kind: "own_warehouse",
      tax_warehouse_id: null,
      operator_contact_id: null,
      controlling_entity_id: cvpoId,
      address: { line1: "Avenida de las Cepas 18", postal_code: "46021", city: "Puerto del Secano", province: "Valencia", country_code: "ES" },
      is_virtual: false,
      is_active: true,
      created_at: T0,
    },
  ];

  for (let i = 0; i < spec.externalWarehouses; i += 1) {
    const operator = must(contact.find((row) => row.id === must(logisticsIds[i], "operator id")), "operator");
    const billing = must(contact_address.find((row) => row.contact_id === operator.id && row.kind === "billing"), "operator address");
    location.push({
      id: uuid(rng),
      code: `ALM-${pad(i + 1, 2)}`,
      name: `Almacén de ${operator.trade_name ?? operator.legal_name}`,
      kind: "third_party_warehouse",
      tax_warehouse_id: null,
      operator_contact_id: operator.id,
      controlling_entity_id: poId,
      address: {
        line1: billing.line1,
        postal_code: billing.postal_code,
        city: billing.city,
        province: billing.province ?? "",
        country_code: billing.country_code,
      },
      is_virtual: false,
      is_active: true,
      created_at: T0,
    });
  }

  location.push(
    {
      id: uuid(rng),
      code: "TRANSITO",
      name: "En tránsito",
      kind: "in_transit",
      tax_warehouse_id: null,
      operator_contact_id: null,
      controlling_entity_id: poId,
      address: null,
      is_virtual: true,
      is_active: true,
      created_at: T0,
    },
    {
      id: uuid(rng),
      code: "CLIENTE",
      name: "Entregado a cliente",
      kind: "customer_virtual",
      tax_warehouse_id: null,
      operator_contact_id: null,
      controlling_entity_id: poId,
      address: null,
      is_virtual: true,
      is_active: true,
      created_at: T0,
    },
  );

  const bod = must(location.find((row) => row.code === "BOD"), "BOD");
  const mix = vesselMix(spec.vessels);
  const vessel: VesselRow[] = [];
  const qrUsed = new Set<string>();
  let tankNo = 0;
  let barrelNo = 0;

  function pushVessels(
    count: number,
    kind: VesselRow["kind"],
    material: VesselRow["material"],
    liters: readonly number[],
    zone: string,
    prefix: string,
    label: string,
    jacket: boolean,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const n = i + 1;
      const capacityL = must(liters[i % liters.length], "capacity");
      const code = `${prefix}-${pad(n, 3)}`;
      let sisv: string | null = null;
      if (kind === "tank_storage" || kind === "tank_fermenter") {
        tankNo += 1;
        sisv = `D${tankNo}`;
      } else if (kind === "barrel") {
        barrelNo += 1;
        sisv = `C${barrelNo}`;
      }
      const qr = takeUnique(qrUsed, () => {
        let token = "";
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let k = 0; k < 24; k += 1) token += must(alphabet[int(rng, 0, alphabet.length - 1)], "qr");
        return token;
      });
      const last = vessel.length + 1 === spec.vessels;
      vessel.push({
        id: uuid(rng),
        code,
        name: `${label} ${pad(n, 2)}`,
        kind,
        capacity_ml: capacityL * 1000,
        has_cooling_jacket: jacket,
        material,
        location_id: bod.id,
        zone,
        sisv_code: sisv,
        qr_token: qr,
        status: last ? "out_of_service" : "in_service",
        notes: last ? "Fuera de servicio" : null,
        created_at: T0,
      });
    }
  }

  pushVessels(mix.storage, "tank_storage", "stainless_steel", [5000, 8000, 10000, 15000, 20000, 25000], "Nave 1", "INOX", "Depósito de acero", false);
  pushVessels(mix.fermenter, "tank_fermenter", "stainless_steel", [8000, 10000, 12000, 15000], "Fermentación", "FERM", "Fermentador", true);
  pushVessels(mix.barrel, "barrel", "oak", [225, 300], "Crianza", "BAR", "Barrica de roble", false);
  pushVessels(mix.demijohn, "demijohn", "glass", [54, 16], "Nave 2", "DAM", "Damajuana", false);
  pushVessels(mix.ibc, "ibc", "plastic", [1000], "Embotellado", "IBC", "Contenedor IBC", false);
  if (vessel.length !== spec.vessels) throw new Error(`synthetic: vessels ${vessel.length}`);

  const queue = [
    ...vessel.filter((row) => row.kind === "tank_fermenter"),
    ...vessel.filter((row) => row.kind === "barrel"),
    ...vessel.filter((row) => row.kind === "tank_storage"),
  ];
  if (queue.length < spec.lots) throw new Error("synthetic: not enough vessels for lots");

  const lot: LotRow[] = [];
  const stock_move: StockMoveRow[] = [];
  for (let i = 0; i < spec.lots; i += 1) {
    const host = must(queue[i], "host vessel");
    if (host.status !== "in_service") throw new Error("synthetic: lot in a stopped vessel");
    const wineRow = must(wine[i % wine.length], "lot wine");
    const mustLot = host.kind === "tank_fermenter";
    const vintage = host.kind === "barrel" ? 2024 : 2025;
    const kind: LotRow["kind"] = mustLot ? "must" : "wine";
    const code = `${mustLot ? "M" : "L"}${String(vintage).slice(2)}-${wineRow.code}-${pad(i + 1, 3)}`;
    const pct = host.kind === "barrel" ? int(rng, 90, 98) : host.kind === "tank_fermenter" ? int(rng, 70, 95) : int(rng, 35, 88);
    const volume = Math.min(host.capacity_ml, Math.floor((host.capacity_ml * pct) / 100));
    if (volume < 1 || volume > host.capacity_ml) throw new Error("synthetic: volume out of capacity");
    const lotId = uuid(rng);
    lot.push({
      id: lotId,
      producer_entity_id: poId,
      code,
      kind,
      wine_id: wineRow.id,
      vintage,
      is_organic: wineRow.is_organic,
      status: "active",
      origin: "opening_count",
      created_by_operation_id: null,
      notes: mustLot ? "En fermentación" : host.kind === "barrel" ? "Crianza en roble" : "Almacenamiento",
      created_at: T0,
    });
    stock_move.push({
      id: uuid(rng),
      occurred_at: OPENING_AT,
      move_type: "opening",
      location_id: host.location_id,
      vessel_id: host.id,
      owner_entity_id: poId,
      lot_id: lotId,
      product_id: null,
      product_state: mustLot ? "must" : "wine",
      qty_units: 0,
      volume_ml: volume,
      mass_g: 0,
      loss_kind: null,
      source_table: "inventory.lot",
      source_id: lotId,
      source_line_id: null,
      reverses_move_id: null,
      created_by: ACTOR,
      created_at: T0,
    });
  }

  return {
    legal_entity,
    role: ROLES,
    app_user,
    user_role,
    contact,
    contact_address,
    contact_person,
    wine,
    format,
    product,
    price_list,
    price_list_version,
    price_list_item,
    tax_warehouse,
    location,
    vessel,
    lot,
    stock_move,
  };
}
