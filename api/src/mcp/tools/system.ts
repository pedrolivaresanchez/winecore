import { z } from "zod";

import { sql } from "../../core/db/sql";
import { defineReadTool } from "../registry";
import { requireWriter, webLink } from "../runtime";

const emptyInput = z.object({});

const SEARCH_TYPES = ["contact", "product", "lot", "invoice", "order", "delivery_note"] as const;

export const systemWhoami = defineReadTool({
  name: "system_whoami",
  module: "system",
  scope: "",
  title: "Quién soy",
  description: "Identificador del cliente, alcances y persona representada. No modifica nada.",
  input: emptyInput,
  handler: (ctx) => ({
    client: ctx.client.id,
    on_behalf_of: ctx.actor ? { id: ctx.actor.id, name: ctx.actor.name } : null,
    roles: ctx.actor?.roles ?? [],
    scopes: ctx.client.scopes,
    modules_enabled: ctx.activeModules,
  }),
});

export const systemSearch = defineReadTool({
  name: "system_search",
  module: "system",
  scope: "*.read",
  title: "Buscar",
  description: "Busca contactos, productos y lotes por un texto. No devuelve datos fiscales ni de contacto.",
  input: z.object({
    q: z.string().trim().min(2).max(80),
    types: z.array(z.enum(SEARCH_TYPES)).max(6).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const limit = input.limit ?? 25;
    const wanted = new Set(input.types ?? ["contact", "product", "lot"]);
    const pattern = `%${input.q.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const items: { type: string; id: string; title: string; subtitle: string; link: string }[] = [];

    if (wanted.has("contact") && ctx.activeModules.includes("contacts")) {
      const rows = await writer.read<{ id: string; legal_name: string; country_code: string; kind: string }>(sql`
        SELECT id::VARCHAR AS id, legal_name, country_code, kind
        FROM party.contact
        WHERE archived_at IS NULL
          AND merged_into_id IS NULL
          AND lower(legal_name) LIKE ${pattern} ESCAPE '\\'
        ORDER BY legal_name, id
        LIMIT ${limit}
      `);
      for (const row of rows) {
        items.push({
          type: "contact",
          id: row.id,
          title: row.legal_name,
          subtitle: `${row.kind === "person" ? "Persona" : "Empresa"} · ${row.country_code}`,
          link: webLink(ctx, `/contactos/${row.id}`),
        });
      }
    }

    if (wanted.has("product") && ctx.activeModules.includes("catalog")) {
      const rows = await writer.read<{ id: string; sku: string; name: string; kind: string }>(sql`
        SELECT id::VARCHAR AS id, sku, name, kind
        FROM catalog.product
        WHERE lower(name) LIKE ${pattern} ESCAPE '\\'
           OR lower(sku) LIKE ${pattern} ESCAPE '\\'
        ORDER BY sku, id
        LIMIT ${limit}
      `);
      for (const row of rows) {
        items.push({
          type: "product",
          id: row.id,
          title: row.name,
          subtitle: `${row.sku} · ${row.kind}`,
          link: webLink(ctx, `/productos/${row.id}`),
        });
      }
    }

    if (wanted.has("lot") && (ctx.activeModules.includes("inventory") || ctx.activeModules.includes("cellar"))) {
      const code = input.q.toUpperCase();
      const rows = await writer.read<{ id: string; code: string; kind: string; vintage: number | null }>(sql`
        SELECT id::VARCHAR AS id, code, kind, vintage
        FROM inventory.lot
        WHERE code LIKE ${`%${code.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`} ESCAPE '\\'
        ORDER BY code, id
        LIMIT ${limit}
      `);
      for (const row of rows) {
        items.push({
          type: "lot",
          id: row.id,
          title: row.code,
          subtitle: [row.kind, row.vintage == null ? null : String(row.vintage)].filter((part) => part !== null).join(" · "),
          link: webLink(ctx, `/bodega/lotes/${row.code}`),
        });
      }
    }

    const warnings: string[] = [];
    if (!ctx.activeModules.some((name) => name === "contacts" || name === "catalog" || name === "inventory" || name === "cellar")) {
      warnings.push("Ningún módulo de búsqueda está activo.");
    }
    return {
      items: items.slice(0, limit),
      warnings,
    };
  },
});
