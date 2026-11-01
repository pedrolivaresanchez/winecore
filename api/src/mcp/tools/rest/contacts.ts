import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite, patchOnto } from "../../rest";

const id = z.string().uuid();
const country = z.string().regex(/^[A-Za-z]{2}$/);

const CONTACT_KEYS = [
  "kind", "legal_name", "trade_name", "tax_id", "country_code", "language",
  "is_customer", "is_supplier", "is_carrier", "is_logistics_operator",
  "vat_regime", "payment_method", "payment_terms_days", "notes", "excise_number", "eori", "email", "phone",
] as const;

const contactFields = z.object({
  kind: z.enum(["company", "person"]).optional(),
  legal_name: z.string().min(2).max(120).optional(),
  trade_name: z.string().max(120).optional(),
  tax_id: z.string().max(40).optional().describe("NIF, CIF o VAT; la API lo normaliza"),
  country_code: country.optional(),
  language: z.enum(["es", "en"]).optional(),
  is_customer: z.boolean().optional(),
  is_supplier: z.boolean().optional(),
  is_carrier: z.boolean().optional(),
  is_logistics_operator: z.boolean().optional(),
  vat_regime: z.enum(["general", "equivalence_surcharge", "export", "intra_eu", "canary_ceuta_melilla", "exempt_other"]).optional(),
  payment_method: z.enum(["transfer", "direct_debit", "card", "cash", "stripe", "other"]).optional(),
  payment_terms_days: z.number().int().min(0).max(180).optional(),
  notes: z.string().max(2000).optional(),
  excise_number: z.string().max(40).optional().describe("CAE / número de impuestos especiales"),
  eori: z.string().max(40).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
}).strict();

const ADDRESS_KEYS = ["kind", "label", "line1", "line2", "postal_code", "city", "province", "country_code", "is_default"] as const;

const addressFields = z.object({
  kind: z.enum(["billing", "shipping", "both"]),
  label: z.string().max(80).optional(),
  line1: z.string().min(1).max(120),
  line2: z.string().max(120).optional(),
  postal_code: z.string().min(1).max(12),
  city: z.string().min(1).max(80),
  province: z.string().max(80).optional(),
  country_code: country,
  is_default: z.boolean(),
}).strict();

const PERSON_KEYS = ["full_name", "role", "email", "phone", "receives_invoices", "receives_dunning"] as const;

const personFields = z.object({
  full_name: z.string().min(2).max(80),
  role: z.string().max(80).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  receives_invoices: z.boolean(),
  receives_dunning: z.boolean().describe("Recibe las reclamaciones de cobro"),
}).strict();

const listFilters = {
  q: z.string().max(120).optional().describe("Nombre, nombre comercial o NIF"),
  kind: z.enum(["company", "person"]).optional(),
  role: z.enum(["customer", "supplier", "carrier", "logistics_operator"]).optional(),
  country: country.optional(),
  entity: z.enum(["PO", "CVPO"]).optional().describe("Solo los contactos de esa sociedad"),
  archived: z.boolean().optional().describe("true para ver los archivados"),
};

const contactLink = (input: { id: string }) => `/contactos/${input.id}`;

export const contactsRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "contacts_list",
    module: "contacts",
    scope: "contacts.read",
    title: "Lista de contactos",
    description: "La lista de Contactos con los filtros de la app (tipo, rol, país, sociedad, archivados), paginada con next_cursor.",
    input: z.object({
      ...listFilters,
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/contacts",
  }),
  defineRestRead({
    name: "contacts_export_csv",
    module: "contacts",
    scope: "contacts.read",
    title: "Exportar contactos (CSV)",
    description: "El CSV de contactos que descarga la app, con los mismos filtros. Devuelve el texto del fichero.",
    input: z.object(listFilters).strict(),
    route: "GET /v1/contacts/export.csv",
  }),
  defineRestRead({
    name: "contacts_detail_get",
    module: "contacts",
    scope: "contacts.read",
    title: "Ficha completa del contacto",
    description: "La ficha tal como la ve la app, con el id de cada dirección y persona (necesarios para editarlas o archivarlas).",
    input: z.object({ id }).strict(),
    route: "GET /v1/contacts/:id",
    web: contactLink,
  }),
  defineRestRead({
    name: "contacts_summary_get",
    module: "contacts",
    scope: "contacts.read",
    title: "Resumen comercial del contacto",
    description: "Ventas, documentos recientes y saldo pendiente del contacto, como el panel de su ficha.",
    input: z.object({ id }).strict(),
    route: "GET /v1/contacts/:id/summary",
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_update",
    module: "contacts",
    scope: "contacts.write",
    title: "Editar contacto",
    description: "Cambia los datos de la ficha (nombre, NIF, país, roles, IVA, forma y plazo de pago, notas, CAE, EORI, correo y teléfono). Solo hace falta mandar lo que cambia.",
    input: z.object({ id, changes: contactFields }).strict(),
    route: "PATCH /v1/contacts/:id",
    current: { route: "GET /v1/contacts/:id" },
    send: (input, current) => patchOnto(current, CONTACT_KEYS, input.changes),
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_archive",
    module: "contacts",
    scope: "contacts.write",
    title: "Archivar contacto",
    description: "Archiva el contacto: deja de salir en listas y selectores; su historial se conserva.",
    input: z.object({ id }).strict(),
    route: "POST /v1/contacts/:id/archive",
    current: { route: "GET /v1/contacts/:id" },
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_unarchive",
    module: "contacts",
    scope: "contacts.write",
    title: "Recuperar contacto archivado",
    description: "Vuelve a activar un contacto archivado.",
    input: z.object({ id }).strict(),
    route: "POST /v1/contacts/:id/unarchive",
    current: { route: "GET /v1/contacts/:id" },
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_address_add",
    module: "contacts",
    scope: "contacts.write",
    title: "Añadir dirección",
    description: "Añade una dirección de facturación, de entrega o ambas al contacto.",
    input: z.object({ id, address: addressFields }).strict(),
    route: "POST /v1/contacts/:id/addresses",
    current: { route: "GET /v1/contacts/:id" },
    send: (input) => input.address,
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_address_update",
    module: "contacts",
    scope: "contacts.write",
    title: "Editar dirección",
    description: "Cambia una dirección del contacto (el id sale en contacts_detail_get). Solo hace falta mandar lo que cambia.",
    input: z.object({ id, address_id: id, changes: addressFields.partial().strict() }).strict(),
    route: "PATCH /v1/contacts/:id/addresses/:aid",
    params: { aid: "address_id" },
    current: { route: "GET /v1/contacts/:id" },
    send: (input, current) => patchOnto(current, ADDRESS_KEYS, input.changes, { list: "addresses", id: input.address_id }),
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_address_archive",
    module: "contacts",
    scope: "contacts.write",
    title: "Quitar dirección",
    description: "Archiva una dirección del contacto.",
    input: z.object({ id, address_id: id }).strict(),
    route: "POST /v1/contacts/:id/addresses/:aid/archive",
    params: { aid: "address_id" },
    current: { route: "GET /v1/contacts/:id" },
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_person_add",
    module: "contacts",
    scope: "contacts.write",
    title: "Añadir persona de contacto",
    description: "Añade una persona al contacto, con su correo, teléfono y si recibe facturas o reclamaciones.",
    input: z.object({ id, person: personFields }).strict(),
    route: "POST /v1/contacts/:id/persons",
    current: { route: "GET /v1/contacts/:id" },
    send: (input) => input.person,
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_person_update",
    module: "contacts",
    scope: "contacts.write",
    title: "Editar persona de contacto",
    description: "Cambia una persona del contacto (el id sale en contacts_detail_get). Solo hace falta mandar lo que cambia.",
    input: z.object({ id, person_id: id, changes: personFields.partial().strict() }).strict(),
    route: "PATCH /v1/contacts/:id/persons/:pid",
    params: { pid: "person_id" },
    current: { route: "GET /v1/contacts/:id" },
    send: (input, current) => patchOnto(current, PERSON_KEYS, input.changes, { list: "persons", id: input.person_id }),
    web: contactLink,
  }),
  defineRestWrite({
    name: "contacts_person_archive",
    module: "contacts",
    scope: "contacts.write",
    title: "Quitar persona de contacto",
    description: "Archiva una persona del contacto.",
    input: z.object({ id, person_id: id }).strict(),
    route: "POST /v1/contacts/:id/persons/:pid/archive",
    params: { pid: "person_id" },
    current: { route: "GET /v1/contacts/:id" },
    web: contactLink,
  }),
];
