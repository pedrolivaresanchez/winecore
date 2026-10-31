import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { generateSynthetic, type SyntheticDataset, type SyntheticScale } from "../../db/synthetic";

const SCALES: SyntheticScale[] = ["test", "demo", "x10"];

const EXPECTED = {
  test: { contacts: 16, users: 6, wines: 2, products: 8, vessels: 8, lots: 6, pairs: 1, warehouses: 1 },
  demo: { contacts: 150, users: 8, wines: 8, products: 40, vessels: 30, lots: 24, pairs: 4, warehouses: 3 },
  x10: { contacts: 1500, users: 80, wines: 20, products: 400, vessels: 300, lots: 240, pairs: 40, warehouses: 30 },
} as const;

const EU = new Set(["FR", "DE", "IT", "PT", "NL", "BE", "AT", "IE"]);
const NON_EU = new Set(["GB", "US", "MX", "JP", "CH", "NO"]);
const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_LETTERS = "JABCDEFGHI";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function nifLetter(n: number): string {
  const letter = NIF_LETTERS[n % 23];
  assert(letter !== undefined, "tabla NIF");
  return letter;
}

function cifControl(body: string): { digit: string; letter: string } {
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    const ch = body[i];
    assert(ch !== undefined, "cif");
    let n = ch.charCodeAt(0) - 48;
    if (i % 2 === 0) {
      n *= 2;
      sum += Math.floor(n / 10) + (n % 10);
    } else {
      sum += n;
    }
  }
  const digit = (10 - (sum % 10)) % 10;
  const letter = CIF_LETTERS[digit];
  assert(letter !== undefined, "cif letter");
  return { digit: String(digit), letter };
}

/** Independent of the generator: NIF, NIE and CIF control characters. */
function spanishTaxIdValid(id: string): boolean {
  if (/^\d{8}[A-Z]$/.test(id)) return id[8] === nifLetter(Number(id.slice(0, 8)));
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const head = id[0] === "X" ? "0" : id[0] === "Y" ? "1" : "2";
    return id[8] === nifLetter(Number(head + id.slice(1, 8)));
  }
  if (/^[A-Z]\d{7}[0-9A-Z]$/.test(id)) {
    const org = id[0];
    const control = id[8];
    assert(org !== undefined && control !== undefined, "cif shape");
    const expected = cifControl(id.slice(1, 8));
    if ("ABEH".includes(org)) return control === expected.digit;
    if ("KPQS".includes(org)) return control === expected.letter;
    return control === expected.digit || control === expected.letter;
  }
  return false;
}

function gs1Check(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const ch = data[data.length - 1 - i];
    assert(ch !== undefined, "gs1");
    sum += (ch.charCodeAt(0) - 48) * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

function normName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?\s*l\.?|s\.?\s*a\.?|s\.?\s*coop\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function indexBy<T extends { id: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    assert(!map.has(row.id), "id duplicado");
    map.set(row.id, row);
  }
  return map;
}

function nearDuplicatePairs(ds: SyntheticDataset): number {
  const billing = new Map<string, string>();
  for (const addr of ds.contact_address) {
    if (addr.kind === "billing" && addr.is_default) billing.set(addr.contact_id, addr.postal_code);
  }
  const groups = new Map<string, string[]>();
  for (const row of ds.contact) {
    const postal = billing.get(row.id);
    assert(postal !== undefined, "contacto sin dirección fiscal");
    const key = `${normName(row.legal_name)}|${postal}`;
    const list = groups.get(key) ?? [];
    list.push(row.id);
    groups.set(key, list);
  }
  const contacts = indexBy(ds.contact);
  const persons = new Map<string, string | null>();
  for (const person of ds.contact_person) persons.set(person.contact_id, person.phone);
  let pairs = 0;
  for (const ids of groups.values()) {
    if (ids.length === 1) continue;
    assert(ids.length === 2, "un grupo de duplicados tiene más de dos contactos");
    const left = contacts.get(ids[0] ?? "");
    const right = contacts.get(ids[1] ?? "");
    assert(left !== undefined && right !== undefined, "par");
    assert(left.tax_id !== right.tax_id, "los duplicados cercanos no comparten NIF");
    assert(left.legal_name !== right.legal_name, "el par se distingue por la grafía");
    assert(persons.get(left.id) === persons.get(right.id), "el par comparte teléfono");
    pairs += 1;
  }
  return pairs;
}

function checkIntegrity(scale: SyntheticScale, ds: SyntheticDataset): void {
  const entities = indexBy(ds.legal_entity);
  const users = indexBy(ds.app_user);
  const roles = new Set(ds.role.map((row) => row.code));
  const contacts = indexBy(ds.contact);
  const wines = indexBy(ds.wine);
  const formats = indexBy(ds.format);
  const products = indexBy(ds.product);
  const lists = indexBy(ds.price_list);
  const versions = indexBy(ds.price_list_version);
  const warehouses = indexBy(ds.tax_warehouse);
  const locations = indexBy(ds.location);
  const vessels = indexBy(ds.vessel);
  const lots = indexBy(ds.lot);

  const po = ds.legal_entity.find((row) => row.code === "PO");
  const cvpo = ds.legal_entity.find((row) => row.code === "CVPO");
  assert(po !== undefined && cvpo !== undefined, "faltan PO y CVPO");
  assert(po.person_type === "natural" && po.income_tax === "IRPF", "PO es persona física en IRPF");
  assert(cvpo.person_type === "legal" && cvpo.income_tax === "IS", "CVPO es sociedad en IS");
  assert(po.vat_id === `ES${po.tax_id}` && cvpo.vat_id === `ES${cvpo.tax_id}`, "NIF-IVA");

  assert(roles.size === 8, "roles");
  for (const link of ds.user_role) {
    assert(users.has(link.user_id), `${scale} user_role.user_id`);
    assert(roles.has(link.role_code), `${scale} role`);
    assert(link.role_code !== "agent" && link.role_code !== "mcp_client", "rol de persona");
    assert(link.legal_entity_id === null || entities.has(link.legal_entity_id), "entidad del rol");
    assert(link.granted_by === null || users.has(link.granted_by), "granted_by");
  }

  const taxIds = new Set<string>();
  for (const row of ds.contact) {
    assert(row.tax_id !== null, "tax id");
    assert(!taxIds.has(row.tax_id), `${scale} NIF repetido`);
    taxIds.add(row.tax_id);
    if (row.default_price_list_id !== null) assert(lists.has(row.default_price_list_id), "tarifa");
    if (row.gln !== null) assert(row.gln.length === 13 && gs1Check(row.gln.slice(0, 12)) === row.gln[12], "GLN");
    if (row.payment_method === "direct_debit") assert(/^\d{4}$/.test(row.iban_last4 ?? ""), "iban_last4");
  }

  const billingDefaults = new Map<string, number>();
  for (const addr of ds.contact_address) {
    assert(contacts.has(addr.contact_id), "address.contact_id");
    if (addr.kind === "billing" && addr.is_default) {
      billingDefaults.set(addr.contact_id, (billingDefaults.get(addr.contact_id) ?? 0) + 1);
    }
  }
  for (const row of ds.contact) assert(billingDefaults.get(row.id) === 1, "una dirección fiscal por defecto");

  const seenEmail = new Set<string>();
  for (const user of ds.app_user) {
    assert(user.email.endsWith("@example.com"), "email de usuario");
    assert(!seenEmail.has(user.email.toLowerCase()), "email repetido");
    seenEmail.add(user.email.toLowerCase());
  }
  const phonesByContact = new Map<string, string | null>();
  for (const person of ds.contact_person) {
    assert(contacts.has(person.contact_id), "person.contact_id");
    assert(person.email !== null && person.email.endsWith("@example.com"), "email de contacto");
    assert(!seenEmail.has(person.email.toLowerCase()), "email repetido");
    seenEmail.add(person.email.toLowerCase());
    phonesByContact.set(person.contact_id, person.phone);
  }
  assert(ds.contact_person.length === ds.contact.length, "una persona por contacto");

  const phonePattern = /^\+34 [6789]\d{2} \d{3} \d{3}$/;
  const esMobile = /(?<![\w.,/-])(?:\+34[ .-]?)?[6789]\d{2}[ .-]?\d{3}[ .-]?\d{3}(?![\w.,/-])/;
  for (const row of ds.contact) {
    const phone = phonesByContact.get(row.id);
    assert(phone !== undefined && phone !== null, "teléfono");
    if (row.country_code === "ES") assert(phonePattern.test(phone), `${scale} teléfono español`);
    else assert(!esMobile.test(phone), `${scale} teléfono extranjero parece español`);
  }

  const sku = new Set<string>();
  const wineKey = new Set<string>();
  let missingGtin = 0;
  let missingNc = 0;
  for (const row of ds.product) {
    assert(wines.has(row.wine_id), "product.wine_id");
    assert(formats.has(row.format_id), "product.format_id");
    assert(row.requires_lot && row.kind === "wine", "el vino exige lote");
    assert(!sku.has(row.sku), "sku");
    sku.add(row.sku);
    const key = `${row.wine_id}|${row.vintage}|${row.format_id}`;
    assert(!wineKey.has(key), "vino+añada+formato");
    wineKey.add(key);
    if (row.gtin === null) missingGtin += 1;
    else {
      assert(/^\d{13}$/.test(row.gtin), "gtin");
      assert(gs1Check(row.gtin.slice(0, 12)) === row.gtin[12], "dígito GTIN");
    }
    if (row.gtin_case !== null) {
      assert(/^\d{14}$/.test(row.gtin_case), "gtin14");
      assert(gs1Check(row.gtin_case.slice(0, 13)) === row.gtin_case[13], "dígito GTIN-14");
    }
    if (row.nc_code === null) missingNc += 1;
    else assert(/^\d{8}$/.test(row.nc_code), "NC");
  }
  assert(missingGtin > 0 && missingNc > 0, "avisos de catálogo sin GTIN y sin NC");

  const volumes = new Set(ds.format.map((row) => row.nominal_volume_ml));
  assert(volumes.has(375) && volumes.has(750) && volumes.has(1500), "formatos 37,5 cl, 75 cl y 150 cl");
  assert(ds.format.some((row) => row.container === "bag_in_box"), "bag-in-box");

  const activeByList = new Map<string, number>();
  for (const version of ds.price_list_version) {
    assert(lists.has(version.price_list_id), "version.price_list_id");
    if (version.status === "active") activeByList.set(version.price_list_id, (activeByList.get(version.price_list_id) ?? 0) + 1);
    if (version.valid_to !== null) assert(version.valid_to > version.valid_from, "vigencia");
  }
  for (const list of ds.price_list) assert(activeByList.get(list.id) === 1, "una versión activa");
  for (const item of ds.price_list_item) {
    assert(versions.has(item.version_id), "item.version_id");
    assert(products.has(item.product_id), "item.product_id");
    assert(/^\d+\.\d{6}$/.test(item.unit_price), "precio");
    assert(/^\d+\.\d{3}$/.test(item.min_qty), "mínimo");
  }

  for (const warehouse of ds.tax_warehouse) {
    assert(entities.has(warehouse.legal_entity_id), "cae entity");
    assert(/^ES[0-9A-Z]{11}$/.test(warehouse.cae), "CAE");
    assert(warehouse.is_test && warehouse.activity_code === "V1", "CAE de prueba");
  }
  for (const location of ds.location) {
    assert(entities.has(location.controlling_entity_id), "location entity");
    assert(location.tax_warehouse_id === null || warehouses.has(location.tax_warehouse_id), "perímetro");
    if (location.kind === "third_party_warehouse" || location.kind === "forwarder") {
      assert(location.operator_contact_id !== null && contacts.has(location.operator_contact_id), "operador");
      assert(contacts.get(location.operator_contact_id)?.is_logistics_operator === true, "operador logístico");
    }
    if (location.kind === "in_transit" || location.kind === "customer_virtual") assert(location.is_virtual, "virtual");
  }
  assert(ds.location.some((row) => row.kind === "cellar"), "bodega");
  assert(ds.location.some((row) => row.kind === "third_party_warehouse"), "almacén externo");

  for (const vessel of ds.vessel) {
    assert(locations.has(vessel.location_id), "vessel.location_id");
    assert(vessel.capacity_ml > 0, "capacidad");
    if (vessel.kind === "tank_fermenter") assert(vessel.has_cooling_jacket, "camisa de frío");
    assert(vessel.qr_token !== null && /^[A-Za-z0-9_-]{16,64}$/.test(vessel.qr_token), "qr");
  }

  const movesByVessel = new Map<string, number>();
  const lotSeen = new Set<string>();
  for (const move of ds.stock_move) {
    assert(move.vessel_id !== null && move.lot_id !== null, "granel en recipiente");
    const vessel = vessels.get(move.vessel_id);
    const lot = lots.get(move.lot_id);
    assert(vessel !== undefined && lot !== undefined, "fk lote/recipiente");
    assert(locations.has(move.location_id) && move.location_id === vessel.location_id, "ubicación del movimiento");
    assert(entities.has(move.owner_entity_id), "propietario");
    assert(move.volume_ml > 0 && move.volume_ml <= vessel.capacity_ml, `${scale} volumen ${move.volume_ml} > ${vessel.capacity_ml}`);
    assert(!lotSeen.has(lot.id), "un lote en un solo recipiente");
    lotSeen.add(lot.id);
    movesByVessel.set(vessel.id, (movesByVessel.get(vessel.id) ?? 0) + move.volume_ml);
    if (lot.kind === "must") assert(move.product_state === "must" && vessel.kind === "tank_fermenter", "mosto");
    if (lot.kind === "wine") assert(move.product_state === "wine", "vino");
    assert(lot.wine_id !== null && wines.has(lot.wine_id), "lot.wine_id");
    assert(entities.has(lot.producer_entity_id), "productor");
  }
  for (const [vesselId, total] of movesByVessel) {
    const vessel = vessels.get(vesselId);
    assert(vessel !== undefined && total <= vessel.capacity_ml, "suma de volumen");
    assert(ds.stock_move.filter((row) => row.vessel_id === vesselId).length === 1, "un lote por recipiente");
  }
  assert(lotSeen.size === ds.lot.length, "cada lote está en un recipiente");
  assert(ds.vessel.length > ds.lot.length, "hay recipientes vacíos");

  const countries = new Set(ds.contact.map((row) => row.country_code));
  assert(countries.has("ES"), "España");
  assert([...countries].some((code) => EU.has(code)), "UE");
  assert([...countries].some((code) => NON_EU.has(code)), "fuera de la UE");
  assert(ds.contact.some((row) => row.kind === "person") && ds.contact.some((row) => row.kind === "company"), "personas y empresas");
  assert(ds.contact.some((row) => row.is_customer), "clientes");
  assert(ds.contact.some((row) => row.is_supplier), "proveedores");
  assert(ds.contact.some((row) => row.is_carrier), "transportistas");
  assert(ds.contact.some((row) => row.is_logistics_operator), "operadores logísticos");
  for (const regime of ["general", "intra_eu", "export", "canary_ceuta_melilla", "equivalence_surcharge"] as const) {
    assert(ds.contact.some((row) => row.vat_regime === regime), `${scale} régimen ${regime}`);
  }
}

function workspaceRoot(): string {
  return decodeURIComponent(new URL("../../..", import.meta.url).pathname);
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

const TEXT = new Set([".md", ".txt", ".ts", ".tsx", ".js", ".mjs", ".json", ".yaml", ".yml", ".py", ".sql", ".toml", ".xml", ".csv", ".html", ".css"]);

function isText(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && TEXT.has(path.slice(dot));
}

const PII = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  telefono_es: /(?<![\w.,/-])(?:\+34[ .-]?)?[6789]\d{2}[ .-]?\d{3}[ .-]?\d{3}(?![\w.,/-])/g,
  nif_persona: /(?<![\w-])\d{8}[A-HJ-NP-TV-Z](?![\w-])/g,
  nie: /(?<![\w-])[XYZ]\d{7}[A-HJ-NP-TV-Z](?![\w-])/g,
  iban_es: /\bES\d{2}[ ]?(?:\d{4}[ ]?){5}\b/g,
};

function collectNeedles(ds: SyntheticDataset): string[] {
  const out = new Set<string>();
  const add = (value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value.length >= 9) out.add(value);
  };
  const addId = (value: string): void => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) add(value);
  };
  const visit = (value: unknown): void => {
    if (typeof value === "string") addId(value);
    else if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value !== null && typeof value === "object") for (const item of Object.values(value)) visit(item);
  };
  visit(ds);
  for (const row of ds.legal_entity) {
    add(row.tax_id);
    add(row.vat_id);
    add(row.eori);
    add(row.gln);
  }
  for (const row of ds.app_user) add(row.email);
  for (const row of ds.contact) {
    add(row.tax_id);
    add(row.gln);
  }
  for (const row of ds.contact_person) {
    add(row.email);
    add(row.phone);
  }
  for (const row of ds.tax_warehouse) add(row.cae);
  for (const row of ds.vessel) add(row.qr_token);
  for (const row of ds.product) {
    add(row.gtin);
    add(row.gtin_case);
  }
  const json = JSON.stringify(ds);
  for (const rx of Object.values(PII)) {
    rx.lastIndex = 0;
    for (const match of json.matchAll(rx)) add(match[0]);
  }
  return [...out];
}

describe("generateSynthetic", () => {
  test("same seed produces identical output", () => {
    for (const scale of SCALES) {
      const left = generateSynthetic({ seed: 42, scale });
      const right = generateSynthetic({ seed: 42, scale });
      expect(left).toEqual(right);
    }
  });

  test("different seeds differ", () => {
    const left = generateSynthetic({ seed: 1, scale: "test" });
    const right = generateSynthetic({ seed: 2, scale: "test" });
    expect(left).not.toEqual(right);
    expect(left.legal_entity[0]?.tax_id).not.toEqual(right.legal_entity[0]?.tax_id);
  });

  test("referential integrity across generated records", () => {
    for (const scale of SCALES) checkIntegrity(scale, generateSynthetic({ seed: 7, scale }));
  });

  test("every Spanish tax id has a valid control character", () => {
    for (const scale of SCALES) {
      const ds = generateSynthetic({ seed: 11, scale });
      for (const row of ds.legal_entity) {
        assert(spanishTaxIdValid(row.tax_id), `${scale} entidad ${row.code}`);
      }
      for (const row of ds.contact) {
        if (row.tax_id_country !== "ES") continue;
        assert(row.tax_id !== null && spanishTaxIdValid(row.tax_id), `${scale} contacto ${row.tax_id_type}`);
        assert(row.tax_id_type === "nif" || row.tax_id_type === "nie", "tipo fiscal español");
      }
      assert(ds.contact.some((row) => row.tax_id_type === "nie"), "hay NIE");
      assert(ds.contact.some((row) => row.tax_id_type === "vat_eu"), "hay NIF-IVA");
      assert(ds.contact.some((row) => row.tax_id_type === "foreign_id"), "hay id extranjero");
    }
  });

  test("emails are unique and on example.com", () => {
    for (const scale of SCALES) {
      const ds = generateSynthetic({ seed: 3, scale });
      const emails: string[] = [];
      for (const row of ds.app_user) emails.push(row.email.toLowerCase());
      for (const row of ds.contact_person) {
        assert(row.email !== null, "email");
        emails.push(row.email.toLowerCase());
      }
      assert(new Set(emails).size === emails.length, `${scale} emails repetidos`);
      assert(emails.every((email) => email.endsWith("@example.com")), "dominio");
    }
  });

  test("lots fit their vessels", () => {
    for (const scale of SCALES) {
      const ds = generateSynthetic({ seed: 9, scale });
      const vessels = indexBy(ds.vessel);
      const used = new Map<string, number>();
      for (const move of ds.stock_move) {
        assert(move.vessel_id !== null, "sin recipiente");
        const vessel = vessels.get(move.vessel_id);
        assert(vessel !== undefined, "recipiente");
        assert(move.volume_ml > 0, "volumen");
        assert(move.volume_ml <= vessel.capacity_ml, `${scale} ${vessel.code} ${move.volume_ml} mL > ${vessel.capacity_ml} mL`);
        used.set(vessel.id, (used.get(vessel.id) ?? 0) + move.volume_ml);
      }
      for (const [id, total] of used) {
        const vessel = vessels.get(id);
        assert(vessel !== undefined && total <= vessel.capacity_ml, "capacidad agregada");
      }
      assert(ds.lot.length === ds.stock_move.length, "cada lote tiene volumen");
    }
  });

  test("counts per scale", () => {
    assert(EXPECTED.x10.contacts === EXPECTED.demo.contacts * 10, "x10 contactos");
    assert(EXPECTED.x10.products === EXPECTED.demo.products * 10, "x10 productos");
    assert(EXPECTED.x10.vessels === EXPECTED.demo.vessels * 10, "x10 recipientes");
    assert(EXPECTED.x10.lots === EXPECTED.demo.lots * 10, "x10 lotes");
    assert(EXPECTED.x10.users === EXPECTED.demo.users * 10, "x10 usuarios");
    for (const scale of SCALES) {
      const expected = EXPECTED[scale];
      const ds = generateSynthetic({ seed: 4, scale });
      expect(ds.legal_entity.length).toBe(2);
      expect(ds.role.length).toBe(8);
      expect(ds.app_user.length).toBe(expected.users);
      expect(ds.user_role.length).toBe(expected.users);
      expect(ds.contact.length).toBe(expected.contacts);
      expect(ds.wine.length).toBe(expected.wines);
      expect(ds.format.length).toBe(6);
      expect(ds.product.length).toBe(expected.products);
      expect(ds.price_list.length).toBe(3);
      expect(ds.price_list_version.length).toBe(9);
      expect(ds.price_list_item.length).toBe(expected.products * 9);
      expect(ds.vessel.length).toBe(expected.vessels);
      expect(ds.lot.length).toBe(expected.lots);
      expect(ds.stock_move.length).toBe(expected.lots);
      expect(ds.location.length).toBe(5 + expected.warehouses);
      expect(nearDuplicatePairs(ds)).toBe(expected.pairs);
    }
  });

  test("demo dataset values are not written to disk", () => {
    const root = workspaceRoot();
    assert(statSync(join(root, "docs/11-tests.md")).size > 0, "raíz del worktree");
    const files = listFiles(root);
    const before = files.map((path) => ({ path, mtimeMs: statSync(path).mtimeMs, size: statSync(path).size }));
    const ds = generateSynthetic({ seed: 20261031, scale: "demo" });
    const after = listFiles(root);
    assert(after.length === files.length, "el generador ha creado ficheros");
    for (const row of before) {
      const st = statSync(row.path);
      assert(st.mtimeMs === row.mtimeMs && st.size === row.size, `modificado ${row.path}`);
    }

    const source = readFileSync(join(root, "api/db/synthetic.ts"), "utf8");
    assert(!/from ["']node:fs["']|writeFile|appendFile|Bun\.write|createWriteStream/.test(source), "el generador no escribe en disco");

    const needles = collectNeedles(ds);
    assert(needles.length > 100, "agujas");
    const texts = files.filter(isText).map((path) => ({ path, text: readFileSync(path, "utf8") }));
    const snapshot = JSON.stringify(ds);
    for (const file of texts) {
      assert(!file.text.includes(snapshot), `instantánea en ${file.path}`);
      if (!file.path.includes("/api/")) continue;
      for (const [kind, rx] of Object.entries(PII)) {
        rx.lastIndex = 0;
        for (const match of file.text.matchAll(rx)) {
          const value = match[0];
          const lower = value.toLowerCase();
          if (kind === "email" && (lower.endsWith("@example.com") || lower.endsWith("@winecore.test"))) continue;
          if (kind === "nif_persona" && value === "00000000T") continue;
          throw new Error(`${file.path} contiene un literal ${kind}: ${value}`);
        }
      }
    }
    for (const needle of needles) {
      for (const file of texts) {
        if (file.text.includes(needle)) throw new Error(`${file.path} contiene un valor generado (${needle})`);
      }
    }
  });
});
