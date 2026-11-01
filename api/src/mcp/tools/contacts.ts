import { z } from "zod";

import { encodeCursor } from "../../core/catalog/query";
import { sql } from "../../core/db/sql";
import { emitEvent } from "../../core/events/emit";
import { domainError } from "../../core/errors";
import { newId } from "../../core/ids";
import { normalizeName } from "../../core/party/duplicateKey";
import {
  insertAddress,
  insertContact,
  insertPerson,
  resolveTax,
  type ContactInput,
} from "../../core/party/contacts";
import { defineReadTool, defineWriteTool } from "../registry";
import {
  actorOf,
  iso,
  maskTaxId,
  previewStale,
  requireWriter,
  seesPersonal,
  text,
  webLink,
} from "../runtime";

const addressInput = z.object({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  postal_code: z.string().trim().min(1).max(12),
  city: z.string().trim().min(1).max(80),
  province: z.string().trim().max(80).optional(),
  country_code: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
});

const createInput = z.object({
  kind: z.enum(["company", "person"]),
  legal_name: z.string().trim().min(2).max(120),
  tax_id: z.string().trim().min(2).max(20).optional(),
  country: z.string().trim().regex(/^[A-Za-z]{2}$/),
  address: addressInput.optional(),
  email: z.string().trim().max(120).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).optional(),
  phone: z.string().trim().max(40).optional(),
  is_customer: z.boolean().optional(),
  is_supplier: z.boolean().optional(),
  vat_regime: z.enum([
    "general",
    "equivalence_surcharge",
    "export",
    "intra_eu",
    "canary_ceuta_melilla",
    "exempt_other",
  ]).optional(),
  payment_terms_days: z.number().int().min(0).max(180).optional(),
  default_channel: z.string().trim().regex(/^[a-z0-9_]{2,40}$/).optional(),
});

interface DuplicateHit {
  contact_id: string;
  legal_name: string;
  rule: "tax_id" | "same_name";
}

interface CreatePayload {
  input: z.infer<typeof createInput>;
  tax_id: string | null;
  duplicate_ids: string[];
}

const page = {
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

export const contactsSearch = defineReadTool({
  name: "contacts_search",
  module: "contacts",
  scope: "contacts.read",
  title: "Buscar contactos",
  description: "Busca contactos. El NIF sale enmascarado.",
  input: z.object({
    q: z.string().trim().max(120).optional(),
    role: z.enum(["customer", "supplier", "carrier"]).optional(),
    country: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
    ...page,
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const limit = input.limit ?? 25;
    const filters = ["c.archived_at IS NULL", "c.merged_into_id IS NULL"];
    if (input.role === "customer") filters.push("c.is_customer");
    if (input.role === "supplier") filters.push("c.is_supplier");
    if (input.role === "carrier") filters.push("c.is_carrier");
    if (input.country) filters.push(sql`c.country_code = ${input.country.toUpperCase()}`);
    if (input.q && input.q.length >= 2) {
      const pattern = `%${input.q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      filters.push(sql`lower(c.legal_name) LIKE ${pattern} ESCAPE '\\'`);
    }
    const cursor = decodeCursor(input.cursor);
    const listed = [...filters];
    if (cursor) {
      listed.push(sql`(
        c.updated_at < CAST(${cursor.at} AS TIMESTAMPTZ)
        OR (c.updated_at = CAST(${cursor.at} AS TIMESTAMPTZ) AND c.id < CAST(${cursor.id} AS UUID))
      )`);
    }
    const rows = await writer.read<Record<string, unknown>>(`
      SELECT c.id::VARCHAR AS id, c.legal_name, c.tax_id, c.country_code,
             c.is_customer, c.is_supplier, c.default_channel, c.updated_at
      FROM party.contact c
      WHERE ${listed.join(" AND ")}
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${limit + 1}
    `);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map((row) => ({
        id: String(row.id),
        legal_name: String(row.legal_name),
        tax_id_masked: maskTaxId(text(row.tax_id)),
        country: String(row.country_code),
        is_customer: row.is_customer === true,
        is_supplier: row.is_supplier === true,
        default_channel: text(row.default_channel) ?? undefined,
      })),
      next_cursor: hasMore && last ? encodeCursor({ k: iso(last.updated_at), id: String(last.id) }) : null,
      warnings: [] as string[],
    };
  },
});

export const contactsGet = defineReadTool({
  name: "contacts_get",
  module: "contacts",
  scope: "contacts.read",
  title: "Ficha de contacto",
  description: "Ficha de un contacto. El NIF va enmascarado y el IBAN solo muestra los 4 últimos.",
  input: z.object({ contact_id: z.uuid() }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const rows = await writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, kind, legal_name, trade_name, tax_id, country_code,
             is_customer, is_supplier, vat_regime, payment_terms_days, payment_method,
             iban_last4, default_channel
      FROM party.contact
      WHERE id = CAST(${input.contact_id} AS UUID)
        AND merged_into_id IS NULL
        AND archived_at IS NULL
    `);
    const row = rows[0];
    if (!row) throw domainError("WC_NOT_FOUND");
    const addresses = await writer.read<Record<string, unknown>>(sql`
      SELECT kind, line1, line2, postal_code, city, province, country_code, is_default
      FROM party.contact_address
      WHERE contact_id = CAST(${input.contact_id} AS UUID) AND archived_at IS NULL
      ORDER BY is_default DESC, created_at
    `);
    const personal = seesPersonal(ctx);
    const persons = personal
      ? await writer.read<Record<string, unknown>>(sql`
        SELECT full_name, role, email, phone
        FROM party.contact_person
        WHERE contact_id = CAST(${input.contact_id} AS UUID) AND archived_at IS NULL
        ORDER BY created_at
      `)
      : [];
    const terms = await writer.read<Record<string, unknown>>(sql`
      SELECT e.code AS entity, t.customer_account, CAST(t.discount_pct AS VARCHAR) AS discount_pct
      FROM party.contact_entity_terms t
      JOIN core.legal_entity e ON e.id = t.legal_entity_id
      WHERE t.contact_id = CAST(${input.contact_id} AS UUID)
    `);
    const open = await writer.read<{ outstanding: string }>(sql`
      SELECT COALESCE(SUM(total - amount_paid), 0)::VARCHAR AS outstanding
      FROM billing.invoice
      WHERE customer_id = CAST(${input.contact_id} AS UUID)
        AND status = 'issued'
        AND payment_status IN ('unpaid', 'partially_paid')
    `);
    return {
      id: String(row.id),
      legal_name: String(row.legal_name),
      tax_id_masked: maskTaxId(text(row.tax_id)),
      country: String(row.country_code),
      is_customer: row.is_customer === true,
      is_supplier: row.is_supplier === true,
      default_channel: text(row.default_channel) ?? undefined,
      kind: String(row.kind),
      trade_name: text(row.trade_name) ?? undefined,
      addresses: addresses.map((address) => ({
        kind: String(address.kind),
        line1: personal ? String(address.line1) : undefined,
        line2: personal ? text(address.line2) : undefined,
        postal_code: personal ? String(address.postal_code) : undefined,
        city: String(address.city),
        province: text(address.province),
        country_code: String(address.country_code),
        is_default: address.is_default === true,
      })),
      persons: persons.map((person) => ({
        full_name: String(person.full_name),
        role: text(person.role) ?? undefined,
        email: text(person.email) ?? undefined,
        phone: text(person.phone) ?? undefined,
      })),
      vat_regime: String(row.vat_regime),
      payment_terms_days: Number(row.payment_terms_days),
      payment_method: text(row.payment_method) ?? undefined,
      iban_last4: text(row.iban_last4) ?? undefined,
      terms_by_entity: terms
        .filter((term) => term.entity === "PO" || term.entity === "CVPO")
        .map((term) => ({
          entity: term.entity as "PO" | "CVPO",
          customer_account: text(term.customer_account) ?? undefined,
          discount_pct: text(term.discount_pct) ?? "0.00",
        })),
      open_receivables: money2(open[0]?.outstanding),
      links: { web: webLink(ctx, `/contactos/${String(row.id)}`) },
      warnings: personal ? [] : ["Los datos de contacto (correo, teléfono y calle) están ocultos para este perfil."],
    };
  },
});

export const contactsCreate = defineWriteTool({
  name: "contacts_create",
  module: "contacts",
  scope: "contacts.write",
  title: "Crear contacto",
  description: "Prepara un contacto nuevo, avisa de duplicados y lo crea solo tras confirmar. El resto de campos de la ficha (idioma, transportista, notas, CAE, EORI…) se completan después con contacts_update.",
  input: createInput,
  routes: ["POST /v1/contacts"],
  prepare: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const country = input.country.toUpperCase();
    const tax = resolveTax(input.tax_id, country);
    const duplicates = await findDuplicates(writer, input.legal_name, tax.taxId);
    const payload: CreatePayload = {
      input: { ...input, country, email: input.email?.toLowerCase() },
      tax_id: tax.taxId,
      duplicate_ids: duplicates.map((hit) => hit.contact_id).sort(),
    };
    const duplicateText = duplicates.length === 0
      ? "No hay duplicados candidatos."
      : `Hay ${duplicates.length} posible${duplicates.length === 1 ? "" : "s"} duplicado${duplicates.length === 1 ? "" : "s"}.`;
    return {
      preview: {
        legal_name: input.legal_name,
        kind: input.kind,
        country,
        tax_id_masked: maskTaxId(tax.taxId),
        tax_warning: tax.warning ?? null,
        duplicates,
      },
      payload,
      summary_es: `Se creará el contacto «${input.legal_name}» (${country}). ${duplicateText}`,
    };
  },
  commit: async (ctx, raw) => {
    const writer = requireWriter(ctx);
    const payload = raw as CreatePayload;
    const input = payload.input;
    const country = input.country.toUpperCase();
    const tax = resolveTax(input.tax_id, country);
    const duplicates = await findDuplicates(writer, input.legal_name, tax.taxId);
    const ids = duplicates.map((hit) => hit.contact_id).sort();
    if (ids.join(",") !== payload.duplicate_ids.join(",")) throw previewStale();
    if (duplicates.some((hit) => hit.rule === "tax_id")) {
      throw domainError("WC_CONTACT_DUPLICATE_TAX_ID");
    }
    const id = newId();
    const now = ctx.now();
    const contact: ContactInput = {
      kind: input.kind,
      legal_name: input.legal_name,
      country_code: country,
      language: "es",
      is_customer: input.is_customer === true,
      is_supplier: input.is_supplier === true,
      is_carrier: false,
      is_logistics_operator: false,
      vat_regime: input.vat_regime ?? "general",
      payment_terms_days: input.payment_terms_days ?? 30,
      email: input.email,
      phone: input.phone,
    };
    const personId = input.email || input.phone ? newId() : null;
    const addressId = input.address ? newId() : null;
    await writer.withWrite(actorOf(ctx, "alta de contacto"), async (tx) => {
      insertContact(tx, id, contact, tax, ctx.actor?.id ?? ctx.client.id, now);
      if (input.default_channel) {
        tx.write(sql`
          UPDATE party.contact
          SET default_channel = ${input.default_channel}
          WHERE id = CAST(${id} AS UUID)
        `);
      }
      if (personId && (input.email || input.phone)) {
        insertPerson(tx, id, personId, {
          full_name: input.legal_name,
          role: null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          receives_invoices: true,
          receives_dunning: false,
        }, now);
      }
      if (addressId && input.address) {
        insertAddress(tx, id, addressId, {
          kind: "both",
          line1: input.address.line1,
          line2: input.address.line2 ?? null,
          postal_code: input.address.postal_code,
          city: input.address.city,
          province: input.address.province ?? null,
          country_code: (input.address.country_code ?? country).toUpperCase(),
          is_default: true,
        }, now);
      }
      emitEvent(tx, {
        type: "party.contact.created",
        aggregate: "party.contact",
        aggregateId: id,
        payload: { contact_id: id, link: `/contactos/${id}` },
      });
    });
    return {
      contact_id: id,
      links: { web: webLink(ctx, `/contactos/${id}`) },
    };
  },
});

async function findDuplicates(
  writer: ReturnType<typeof requireWriter>,
  legalName: string,
  taxId: string | null,
): Promise<DuplicateHit[]> {
  const hits: DuplicateHit[] = [];
  if (taxId) {
    const rows = await writer.read<{ id: string; legal_name: string }>(sql`
      SELECT id::VARCHAR AS id, legal_name
      FROM party.contact
      WHERE tax_id = ${taxId} AND archived_at IS NULL AND merged_into_id IS NULL
      LIMIT 5
    `);
    for (const row of rows) hits.push({ contact_id: row.id, legal_name: row.legal_name, rule: "tax_id" });
  }
  const folded = normalizeName(legalName);
  if (folded.length >= 2) {
    const rows = await writer.read<{ id: string; legal_name: string }>(sql`
      SELECT id::VARCHAR AS id, legal_name
      FROM party.contact
      WHERE archived_at IS NULL AND merged_into_id IS NULL
      ORDER BY updated_at DESC
      LIMIT 200
    `);
    for (const row of rows) {
      if (hits.some((hit) => hit.contact_id === row.id)) continue;
      if (normalizeName(row.legal_name) === folded) {
        hits.push({ contact_id: row.id, legal_name: row.legal_name, rule: "same_name" });
      }
    }
  }
  return hits.slice(0, 8);
}

function decodeCursor(value: string | undefined): { at: string; id: string } | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw domainError("WC_VALIDATION", { cursor: "Cursor no válido" });
  }
  if (!parsed || typeof parsed !== "object") {
    throw domainError("WC_VALIDATION", { cursor: "Cursor no válido" });
  }
  const k = (parsed as { k?: unknown }).k;
  const id = (parsed as { id?: unknown }).id;
  if (typeof k !== "string" || typeof id !== "string") {
    throw domainError("WC_VALIDATION", { cursor: "Cursor no válido" });
  }
  return { at: k, id };
}

function money2(value: string | undefined): string {
  const raw = value ?? "0";
  const negative = raw.trim().startsWith("-");
  const [whole, frac = ""] = raw.trim().replace("-", "").split(".");
  const digits = (frac + "00").slice(0, 2);
  return `${negative ? "-" : ""}${whole || "0"}.${digits}`;
}
