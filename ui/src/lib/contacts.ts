import { ApiError, api, apiBlob } from "@/lib/api";

export type ContactKind = "company" | "person";
export type ContactRole = "customer" | "supplier" | "carrier" | "logistics_operator";
export type AddressKind = "billing" | "shipping" | "both";

export type ContactSummary = {
  id: string;
  kind: ContactKind;
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
  phone: string | null;
  archived_at: string | null;
  updated_at: string;
};

export type Address = {
  id: string;
  kind: AddressKind;
  label: string | null;
  line1: string;
  line2: string | null;
  postal_code: string | null;
  city: string;
  province: string | null;
  country_code: string;
  is_default: boolean;
};

export type ContactPerson = {
  id: string;
  full_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  receives_invoices: boolean;
  receives_dunning: boolean;
};

export type Contact = ContactSummary & {
  language: string;
  vat_regime: string;
  payment_method: string | null;
  payment_terms_days: number;
  notes: string | null;
  excise_number: string | null;
  eori: string | null;
  tax_id_warning: string | null;
  created_at: string;
  addresses: Address[];
  persons: ContactPerson[];
};

export type ContactInput = {
  kind: ContactKind;
  legal_name: string;
  trade_name?: string;
  tax_id?: string;
  country_code: string;
  language: string;
  is_customer: boolean;
  is_supplier: boolean;
  is_carrier: boolean;
  is_logistics_operator: boolean;
  vat_regime: string;
  payment_method?: string;
  payment_terms_days: number;
  notes?: string;
  excise_number?: string;
  eori?: string;
  email?: string;
  phone?: string;
};

export type ContactQuery = {
  q?: string;
  kind?: ContactKind | "";
  role?: ContactRole | "";
  country?: string;
  archived?: boolean;
  cursor?: string;
  limit?: number;
};

export type ContactPage = {
  items: ContactSummary[];
  next_cursor: string | null;
  total: number;
};

export type AuditChange = { field: string; before: unknown; after: unknown };

export type AuditEvent = {
  id: string;
  occurred_at: string;
  actor: { type: string; id: string; display_name: string };
  action: string;
  changes: AuditChange[];
  row_id?: string;
};

export type AuditPage = { items: AuditEvent[]; next_cursor: string | null };

export const COUNTRIES = [
  { code: "ES", label: "España" },
  { code: "FR", label: "Francia" },
  { code: "PT", label: "Portugal" },
  { code: "DE", label: "Alemania" },
  { code: "IT", label: "Italia" },
] as const;

export const VAT_REGIMES = [
  { value: "general", label: "General" },
  { value: "equivalence_surcharge", label: "Recargo de equivalencia" },
  { value: "export", label: "Exportación" },
  { value: "intra_eu", label: "Intracomunitario" },
  { value: "canary_ceuta_melilla", label: "Canarias, Ceuta y Melilla" },
  { value: "exempt_other", label: "Exento u otros" },
] as const;

export const PAYMENT_METHODS = [
  { value: "", label: "Sin indicar" },
  { value: "transfer", label: "Transferencia" },
  { value: "direct_debit", label: "Domiciliación" },
  { value: "card", label: "Tarjeta" },
  { value: "cash", label: "Efectivo" },
  { value: "stripe", label: "Stripe" },
  { value: "other", label: "Otro" },
] as const;

export function vatLabel(value: string): string {
  return VAT_REGIMES.find((item) => item.value === value)?.label ?? value;
}

export function paymentLabel(value: string | null | undefined): string {
  if (!value) return "Sin indicar";
  return PAYMENT_METHODS.find((item) => item.value === value)?.label ?? value;
}

export function countryLabel(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.label ?? code;
}

export function roleLabels(contact: Pick<ContactSummary, "is_customer" | "is_supplier" | "is_carrier" | "is_logistics_operator">): string[] {
  const labels: string[] = [];
  if (contact.is_customer) labels.push("Cliente");
  if (contact.is_supplier) labels.push("Proveedor");
  if (contact.is_carrier) labels.push("Transportista");
  if (contact.is_logistics_operator) labels.push("Operador logístico");
  return labels;
}

export function contactQuery(query: ContactQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind) params.set("kind", query.kind);
  if (query.role) params.set("role", query.role);
  if (query.country) params.set("country", query.country);
  params.set("archived", query.archived ? "true" : "false");
  if (query.cursor) params.set("cursor", query.cursor);
  params.set("limit", String(query.limit ?? 50));
  return `/v1/contacts?${params.toString()}`;
}

export function listContacts(query: ContactQuery, signal?: AbortSignal) {
  return api<ContactPage>(contactQuery(query), { signal });
}

export function getContact(id: string, signal?: AbortSignal) {
  return api<Contact>(`/v1/contacts/${id}?include=addresses,persons`, { signal });
}

export function createContact(input: ContactInput, idempotencyKey: string) {
  return api<Contact>("/v1/contacts", {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export function updateContact(id: string, input: ContactInput, updatedAt: string) {
  return api<Contact>(`/v1/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
    headers: { "If-Match": updatedAt },
  });
}

export function archiveContact(id: string) {
  return api<Contact>(`/v1/contacts/${id}/archive`, { method: "POST" });
}

export function unarchiveContact(id: string) {
  return api<Contact>(`/v1/contacts/${id}/unarchive`, { method: "POST" });
}

export function createAddress(contactId: string, body: Omit<Address, "id">) {
  return api<Address>(`/v1/contacts/${contactId}/addresses`, { method: "POST", body: JSON.stringify(body) });
}

export function updateAddress(contactId: string, addressId: string, body: Omit<Address, "id">) {
  return api<Address>(`/v1/contacts/${contactId}/addresses/${addressId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function archiveAddress(contactId: string, addressId: string) {
  return api<void>(`/v1/contacts/${contactId}/addresses/${addressId}/archive`, { method: "POST" });
}

export function createPerson(contactId: string, body: Omit<ContactPerson, "id">) {
  return api<ContactPerson>(`/v1/contacts/${contactId}/persons`, { method: "POST", body: JSON.stringify(body) });
}

export function updatePerson(contactId: string, personId: string, body: Omit<ContactPerson, "id">) {
  return api<ContactPerson>(`/v1/contacts/${contactId}/persons/${personId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function archivePerson(contactId: string, personId: string) {
  return api<void>(`/v1/contacts/${contactId}/persons/${personId}/archive`, { method: "POST" });
}

export function contactAudit(id: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ table: "party.contact", row_id: id });
  return api<AuditPage>(`/v1/audit?${params.toString()}`, { signal });
}

export function recentContactAudit(limit = 5, signal?: AbortSignal) {
  const params = new URLSearchParams({ table: "party.contact", limit: String(limit) });
  return api<AuditPage>(`/v1/audit?${params.toString()}`, { signal });
}

export async function exportContacts(query: ContactQuery) {
  const path = contactQuery(query).replace("/v1/contacts?", "/v1/contacts/export.csv?");
  const blob = await apiBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contactos.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** El registro guarda INSERT/UPDATE; la ficha habla de alta, cambio y archivo. */
export function presentAuditAction(event: AuditEvent): string {
  const raw = event.action.toLowerCase();
  if (raw === "insert" || raw === "create") return "create";
  const archived = event.changes.find((change) => change.field === "archived_at");
  if (archived && (raw === "update" || raw === "archive" || raw === "unarchive")) {
    return archived.after ? "archive" : "unarchive";
  }
  if (raw === "update") return "update";
  return event.action;
}

export function duplicateContact(error: unknown): { id: string; name: string } | null {
  if (!(error instanceof ApiError) || error.code !== "WC_CONTACT_DUPLICATE_TAX_ID" || !error.details) return null;
  const id = error.details.existing_id;
  const name = error.details.existing_name;
  if (typeof id === "string" && typeof name === "string") return { id, name };
  return null;
}

export function isStale(error: unknown): boolean {
  return error instanceof ApiError && error.code === "WC_STALE_VERSION";
}

export function emptyInput(): ContactInput {
  return {
    kind: "company",
    legal_name: "",
    trade_name: "",
    tax_id: "",
    country_code: "ES",
    language: "es",
    is_customer: true,
    is_supplier: false,
    is_carrier: false,
    is_logistics_operator: false,
    vat_regime: "general",
    payment_method: "",
    payment_terms_days: 30,
    notes: "",
    excise_number: "",
    eori: "",
    email: "",
    phone: "",
  };
}

export function inputFromContact(contact: Contact): ContactInput {
  return {
    kind: contact.kind,
    legal_name: contact.legal_name,
    trade_name: contact.trade_name ?? "",
    tax_id: contact.tax_id ?? "",
    country_code: contact.country_code,
    language: contact.language,
    is_customer: contact.is_customer,
    is_supplier: contact.is_supplier,
    is_carrier: contact.is_carrier,
    is_logistics_operator: contact.is_logistics_operator,
    vat_regime: contact.vat_regime,
    payment_method: contact.payment_method ?? "",
    payment_terms_days: contact.payment_terms_days,
    notes: contact.notes ?? "",
    excise_number: contact.excise_number ?? "",
    eori: contact.eori ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
  };
}

export function cleanInput(input: ContactInput): ContactInput {
  const trim = (value?: string) => {
    const next = value?.trim();
    return next ? next : undefined;
  };
  return {
    ...input,
    legal_name: input.legal_name.trim(),
    trade_name: trim(input.trade_name),
    tax_id: trim(input.tax_id),
    payment_method: trim(input.payment_method),
    notes: trim(input.notes),
    excise_number: trim(input.excise_number),
    eori: trim(input.eori),
    email: trim(input.email),
    phone: trim(input.phone),
  };
}
