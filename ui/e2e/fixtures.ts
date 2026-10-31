export const healthOk = {
  status: "ok",
  sha: "abc1234def56789",
  schema_version: "0004",
  db: "local",
  writer: "leader",
} as const;

export const meOk = {
  email: "ana@winecore.test",
  display_name: "Ana Rivas",
  roles: [
    { role: "owner", legal_entity_code: "PO" },
    { role: "admin", legal_entity_code: "PO" },
    { role: "approver", legal_entity_code: "CVPO" },
  ],
  entities: [
    { id: "po", code: "PO", legal_name: "Entidad de prueba P.O" },
    { id: "cvpo", code: "CVPO", legal_name: "Entidad de prueba CVPO" },
  ],
  permissions: ["contacts.read", "contacts.write"],
} as const;

export const meForbidden = {
  code: "WC_NO_ACCESS",
  message: "No tienes acceso a WineCore",
} as const;

function cif(seed: number): string {
  const digits = String(seed).padStart(7, "0");
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    if (index % 2 === 0) {
      const doubled = digit * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += digit;
    }
  }
  const control = (10 - (sum % 10)) % 10;
  return `B${digits}${control}`;
}

type Summary = {
  id: string;
  kind: "company" | "person";
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  tax_id_type: string | null;
  country_code: string;
  is_customer: boolean;
  is_supplier: boolean;
  is_carrier: boolean;
  is_logistics_operator: boolean;
  city: string | null;
  province: string | null;
  email: string | null;
  phone: null;
  archived_at: string | null;
  updated_at: string;
};

const base = {
  phone: null,
  archived_at: null,
} as const;

export const contacts: Summary[] = [
  {
    ...base,
    id: "c-encina",
    kind: "company",
    legal_name: "Vinoteca La Encina S.L.",
    trade_name: "La Encina",
    tax_id: "B00000000",
    tax_id_type: "cif",
    country_code: "ES",
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    city: "Haro",
    province: "La Rioja",
    email: "pedidos@example.com",
    updated_at: "2026-10-28T09:15:00Z",
  },
  {
    ...base,
    id: "c-nora",
    kind: "person",
    legal_name: "Nora Vidal",
    trade_name: null,
    tax_id: "00000000T",
    tax_id_type: "nif",
    country_code: "ES",
    is_customer: false,
    is_supplier: true,
    is_carrier: false,
    is_logistics_operator: false,
    city: "Reus",
    province: "Tarragona",
    email: "nora@example.com",
    updated_at: "2026-10-27T16:00:00Z",
  },
  {
    ...base,
    id: "c-ebro",
    kind: "company",
    legal_name: "Transportes del Ebro S.L.",
    trade_name: "Ebro",
    tax_id: cif(12),
    tax_id_type: "cif",
    country_code: "ES",
    is_customer: false,
    is_supplier: false,
    is_carrier: true,
    is_logistics_operator: false,
    city: "Logroño",
    province: "La Rioja",
    email: "ruta@example.com",
    updated_at: "2026-10-26T11:00:00Z",
  },
  {
    ...base,
    id: "c-duero",
    kind: "company",
    legal_name: "Logística del Duero S.L.",
    trade_name: null,
    tax_id: cif(18),
    tax_id_type: "cif",
    country_code: "ES",
    is_customer: false,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: true,
    city: "Zamora",
    province: "Zamora",
    email: "muelle@example.com",
    updated_at: "2026-10-25T08:30:00Z",
  },
  {
    ...base,
    id: "c-montsec",
    kind: "company",
    legal_name: "Bodega del Montsec S.L.",
    trade_name: "Montsec",
    tax_id: cif(24),
    tax_id_type: "cif",
    country_code: "ES",
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    city: "Tremp",
    province: "Lleida",
    email: "celler@example.com",
    updated_at: "2026-10-20T12:00:00Z",
  },
  {
    ...base,
    id: "c-penedes",
    kind: "company",
    legal_name: "Cristalería del Penedès S.L.",
    trade_name: null,
    tax_id: cif(31),
    tax_id_type: "cif",
    country_code: "ES",
    is_customer: false,
    is_supplier: true,
    is_carrier: false,
    is_logistics_operator: false,
    city: "Vilafranca",
    province: "Barcelona",
    email: "botellas@example.com",
    updated_at: "2026-10-18T15:40:00Z",
  },
  {
    ...base,
    id: "c-archivo",
    kind: "company",
    legal_name: "Cliente Archivado S.L.",
    trade_name: null,
    tax_id: null,
    tax_id_type: null,
    country_code: "FR",
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    city: "Perpiñán",
    province: null,
    email: "archivo@example.com",
    archived_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  },
];

export function contactDetail(id: string) {
  const summary = contacts.find((item) => item.id === id) ?? contacts[0];
  return {
    ...summary,
    language: "es",
    vat_regime: "general",
    payment_method: "transfer",
    payment_terms_days: 30,
    notes: id === "c-encina" ? "Entrega en muelle por la mañana." : null,
    excise_number: null,
    eori: null,
    tax_id_warning: null,
    created_at: "2026-01-15T10:00:00Z",
    addresses:
      id === "c-encina"
        ? [
            {
              id: "a-encina",
              kind: "both",
              label: "Bodega",
              line1: "Calle de la Encina 12",
              line2: null,
              postal_code: "26200",
              city: "Haro",
              province: "La Rioja",
              country_code: "ES",
              is_default: true,
            },
          ]
        : [],
    persons:
      id === "c-encina"
        ? [
            {
              id: "p-luis",
              full_name: "Luis Encina",
              role: "Compras",
              email: "luis@example.com",
              phone: null,
              receives_invoices: true,
              receives_dunning: false,
            },
          ]
        : [],
  };
}

export const auditEvents = [
  {
    id: "ev-1",
    row_id: "c-encina",
    occurred_at: "2026-10-28T09:15:00Z",
    actor: { type: "user", id: "u-ana", display_name: "Ana Rivas" },
    action: "update",
    changes: [{ field: "trade_name", before: "Encina", after: "La Encina" }],
  },
  {
    id: "ev-2",
    row_id: "c-nora",
    occurred_at: "2026-10-27T16:00:00Z",
    actor: { type: "user", id: "u-ana", display_name: "Ana Rivas" },
    action: "create",
    changes: [{ field: "legal_name", before: null, after: "Nora Vidal" }],
  },
  {
    id: "ev-3",
    row_id: "c-ebro",
    occurred_at: "2026-10-26T11:00:00Z",
    actor: { type: "user", id: "u-ana", display_name: "Ana Rivas" },
    action: "update",
    changes: [{ field: "is_carrier", before: false, after: true }],
  },
];

export function filterContacts(url: URL) {
  const archived = url.searchParams.get("archived") === "true";
  const kind = url.searchParams.get("kind");
  const role = url.searchParams.get("role");
  const country = url.searchParams.get("country");
  const q = (url.searchParams.get("q") ?? "").toLocaleLowerCase("es");
  return contacts.filter((item) => {
    if (archived ? !item.archived_at : item.archived_at) return false;
    if (kind && item.kind !== kind) return false;
    if (role === "customer" && !item.is_customer) return false;
    if (role === "supplier" && !item.is_supplier) return false;
    if (role === "carrier" && !item.is_carrier) return false;
    if (role === "logistics_operator" && !item.is_logistics_operator) return false;
    if (country && item.country_code !== country) return false;
    if (q) {
      const haystack = `${item.legal_name} ${item.trade_name ?? ""} ${item.tax_id ?? ""}`.toLocaleLowerCase("es");
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
