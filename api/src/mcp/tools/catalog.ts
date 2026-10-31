import { Decimal } from "decimal.js";
import { z } from "zod";

import { getProduct, listProductPrices, listProducts } from "../../core/catalog/products";
import { listFormats } from "../../core/catalog/formats";
import { listPriceLists, priceFor } from "../../core/catalog/pricing";
import { sql } from "../../core/db/sql";
import { domainError } from "../../core/errors";
import { money } from "../../core/money";
import { businessDate } from "../../core/time";
import { defineReadTool } from "../registry";
import { requireWriter, text, webLink } from "../runtime";

const page = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

const CHANNEL_LIST: Record<string, string> = {
  direct: "final",
  distributor: "distributor",
  horeca: "final",
  eci_edi: "distributor",
  web: "shop",
  fair: "final",
  cellar_shop: "shop",
  export: "final",
  institutional: "final",
  intercompany: "distributor",
};

function localRequest(path: string): Request {
  return new Request(`http://winecore.local${path}`);
}

export const catalogProductsSearch = defineReadTool({
  name: "catalog_products_search",
  module: "catalog",
  scope: "catalog.read",
  title: "Buscar productos",
  description: "Busca productos del catálogo.",
  input: z.object({
    q: z.string().trim().max(80).optional(),
    kind: z.string().trim().max(40).optional(),
    wine_code: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/).optional(),
    vintage: z.number().int().min(1990).max(2100).optional(),
    active: z.boolean().optional(),
    ...page,
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const params = new URLSearchParams();
    params.set("limit", String(input.limit ?? 25));
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.q) params.set("q", input.q);
    if (input.kind) params.set("kind", input.kind);
    if (input.vintage !== undefined) params.set("vintage", String(input.vintage));
    if (input.active !== undefined) params.set("active", input.active ? "true" : "false");
    if (input.wine_code) {
      const wines = await writer.read<{ id: string }>(sql`
        SELECT id::VARCHAR AS id FROM catalog.wine WHERE code = ${input.wine_code}
      `);
      const wineId = wines[0]?.id;
      if (!wineId) return { items: [], next_cursor: null, warnings: [] as string[] };
      params.set("wine_id", wineId);
    }
    const pageResult = await listProducts(writer, localRequest(`/v1/products?${params.toString()}`));
    const formatIds = [...new Set(pageResult.items.map((item) => item.format_id).filter((id): id is string => Boolean(id)))];
    const formats = new Map<string, string>();
    for (const formatId of formatIds) {
      const rows = await writer.read<{ id: string; code: string }>(sql`
        SELECT id::VARCHAR AS id, code FROM catalog.format WHERE id = CAST(${formatId} AS UUID)
      `);
      const row = rows[0];
      if (row) formats.set(row.id, row.code);
    }
    return {
      items: pageResult.items.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        kind: item.kind,
        vintage: item.vintage ?? undefined,
        format: item.format_id ? formats.get(item.format_id) : undefined,
        gtin: item.gtin ?? undefined,
        active: item.is_active,
      })),
      next_cursor: pageResult.next_cursor,
      warnings: [] as string[],
    };
  },
});

export const catalogProductGet = defineReadTool({
  name: "catalog_product_get",
  module: "catalog",
  scope: "catalog.read",
  title: "Ficha de producto",
  description: "Producto, precios vigentes y, si el inventario está activo, un resumen de stock.",
  input: z.object({ product_id: z.uuid() }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const product = await getProduct(writer, input.product_id);
    const prices = await listProductPrices(writer, localRequest("/v1/products/x/prices?limit=100"), input.product_id);
    let format: string | undefined;
    if (product.format_id) {
      const rows = await writer.read<{ code: string }>(sql`
        SELECT code FROM catalog.format WHERE id = CAST(${product.format_id} AS UUID)
      `);
      format = rows[0]?.code;
    }
    const body: Record<string, unknown> = {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        kind: product.kind,
        vintage: product.vintage,
        format,
        gtin: product.gtin,
        active: product.is_active,
      },
      prices: prices.items.map((price) => ({
        price_list: price.code,
        unit_price: money.toString(money.fromString(price.unit_price)),
        valid_from: price.valid_from,
      })),
      links: { web: webLink(ctx, `/productos/${product.id}`) },
      warnings: [] as string[],
    };
    if (ctx.activeModules.includes("inventory")) {
      const rows = await writer.read<{ location: string; qty: string }>(sql`
        SELECT loc.code AS location, COALESCE(SUM(m.qty_units), 0)::VARCHAR AS qty
        FROM inventory.stock_move m
        JOIN inventory.location loc ON loc.id = m.location_id
        WHERE m.product_id = CAST(${product.id} AS UUID)
        GROUP BY loc.code
        HAVING SUM(m.qty_units) <> 0
        ORDER BY loc.code
      `);
      body.stock_summary = rows.map((row) => ({ location: row.location, qty_units: Number(row.qty) }));
    }
    return body;
  },
});

export const catalogFormatsList = defineReadTool({
  name: "catalog_formats_list",
  module: "catalog",
  scope: "catalog.read",
  title: "Formatos",
  description: "Formatos de envase del catálogo.",
  input: z.object({ active: z.boolean().optional(), ...page }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const params = new URLSearchParams();
    params.set("limit", String(input.limit ?? 25));
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.active !== undefined) params.set("active", input.active ? "true" : "false");
    const listed = await listFormats(writer, localRequest(`/v1/formats?${params.toString()}`));
    return {
      items: listed.items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        container: item.container,
        nominal_volume_ml: item.nominal_volume_ml,
        units_per_case: item.units_per_case,
        active: item.is_active,
      })),
      next_cursor: listed.next_cursor,
      warnings: [] as string[],
    };
  },
});

export const catalogPriceListsList = defineReadTool({
  name: "catalog_price_lists_list",
  module: "catalog",
  scope: "catalog.read",
  title: "Tarifas",
  description: "Tarifas de precios. Solo lectura.",
  input: z.object({ active: z.boolean().optional(), ...page }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const params = new URLSearchParams();
    params.set("limit", String(input.limit ?? 25));
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.active !== undefined) params.set("active", input.active ? "true" : "false");
    const listed = await listPriceLists(writer, localRequest(`/v1/price-lists?${params.toString()}`));
    return {
      items: listed.items.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        currency: item.currency,
        tax_included: item.tax_included,
        active: item.is_active,
      })),
      next_cursor: listed.next_cursor,
      warnings: [] as string[],
    };
  },
});

const quoteLine = z.object({
  sku: z.string().trim().min(1).max(40),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
});

export const catalogPriceQuote = defineReadTool({
  name: "catalog_price_quote",
  module: "catalog",
  scope: "catalog.read",
  title: "Cotizar",
  description: "Precio de tarifa para unas líneas. No crea un pedido ni una factura.",
  input: z.object({
    customer_id: z.uuid().optional(),
    channel: z.string().trim().regex(/^[a-z0-9_]{2,40}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    lines: z.array(quoteLine).min(1).max(50),
  }),
  handler: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const listCode = CHANNEL_LIST[input.channel];
    if (!listCode && !input.customer_id) {
      throw domainError("WC_VALIDATION", { channel: "Canal sin tarifa" });
    }
    const date = input.date ?? businessDate(ctx.now());
    const warnings: string[] = [];
    const lines = [];
    let subtotal = money.fromString("0.00");
    let taxTotal = money.fromString("0.00");
    for (const line of input.lines) {
      const products = await writer.read<{ id: string; tax: string | null }>(sql`
        SELECT id::VARCHAR AS id, default_tax_code AS tax
        FROM catalog.product
        WHERE sku = ${line.sku} AND is_active
      `);
      const product = products[0];
      if (!product) throw domainError("WC_VALIDATION", { sku: `No existe ${line.sku}` });
      const qty = new Decimal(line.quantity);
      const priced = input.customer_id
        ? await priceFor(writer, { customerId: input.customer_id, productId: product.id, qty, date })
        : null;
      const fallback = priced
        ? { unit: priced.unitPrice.toFixed(), list: priced.priceListCode }
        : await priceByList(writer, listCode ?? "final", product.id, line.quantity, date);
      const unit = money.fromString(fallback.unit);
      const base = money.round2(money.mul(unit, qty));
      const taxCode = product.tax ?? "";
      const rate = taxCode ? await taxRate(writer, taxCode) : null;
      if (!rate) warnings.push(`Sin tipo impositivo para ${line.sku}.`);
      const tax = rate ? money.round2(money.mul(base, money.fromString(rate))) : money.fromString("0.00");
      subtotal = money.add(subtotal, base);
      taxTotal = money.add(taxTotal, tax);
      lines.push({
        sku: line.sku,
        unit_price: money.toString(unit),
        price_list: fallback.list,
        discount_pct: "0.00",
        line_base: money.toString(base),
        tax_code: taxCode || "PENDIENTE",
      });
    }
    const entities = await writer.read<{ code: string }>(sql`
      SELECT code FROM core.legal_entity WHERE code = 'CVPO'
    `);
    return {
      issuing_entity: entities[0]?.code === "CVPO" ? "CVPO" : "PO",
      rule: { scope: "channel", id: input.channel },
      lines,
      totals: {
        subtotal: money.toString(subtotal),
        tax_total: money.toString(taxTotal),
        total: money.toString(money.add(subtotal, taxTotal)),
      },
      warnings,
    };
  },
});

async function priceByList(
  writer: ReturnType<typeof requireWriter>,
  code: string,
  productId: string,
  qty: string,
  date: string,
): Promise<{ unit: string; list: string }> {
  const rows = await writer.read<{ unit_price: string; code: string }>(sql`
    SELECT CAST(i.unit_price AS VARCHAR) AS unit_price, l.code
    FROM catalog.price_list_item i
    JOIN catalog.price_list_version v ON v.id = i.version_id
    JOIN catalog.price_list l ON l.id = v.price_list_id
    WHERE l.code = ${code}
      AND l.is_active
      AND v.status = 'active'
      AND v.valid_from <= CAST(${date} AS DATE)
      AND (v.valid_to IS NULL OR v.valid_to > CAST(${date} AS DATE))
      AND i.product_id = CAST(${productId} AS UUID)
      AND i.min_qty <= CAST(${qty} AS DECIMAL(14,3))
    ORDER BY i.min_qty DESC
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError("WC_VALIDATION", { sku: "No hay un precio vigente" });
  return { unit: row.unit_price, list: row.code };
}

async function taxRate(writer: ReturnType<typeof requireWriter>, code: string): Promise<string | null> {
  const rows = await writer.read<{ rate: string }>(sql`
    SELECT CAST(rate / 100 AS VARCHAR) AS rate
    FROM billing.tax_code
    WHERE code = ${code} AND is_active
  `);
  return text(rows[0]?.rate);
}
