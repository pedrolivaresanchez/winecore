import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite, patchOnto } from "../../rest";

const id = z.string().uuid();
const country = z.string().regex(/^[A-Za-z]{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD");
const decimal = z.union([z.number().nonnegative(), z.string().trim().regex(/^\d+(\.\d+)?$/)]);
const percent = z.union([z.number().min(0).max(100), z.string().trim().regex(/^\d+(\.\d+)?$/)]);
const limit = z.number().int().min(1).max(200).optional();
const reason = z.string().trim().min(3).max(500);

const channel = z.enum([
  "direct", "distributor", "horeca", "eci_edi", "web", "fair", "cellar_shop", "export", "institutional", "intercompany",
]).describe("Canal de venta: direct, distributor, horeca (restauración), eci_edi (El Corte Inglés), web, fair (ferias), cellar_shop (tienda de la bodega), export, institutional, intercompany");
const incoterm = z.enum(["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"]);
const taxCode = z.string().min(2).max(20).describe("Código de impuesto: IVA21, IVA21_RE (con recargo), EXP_E2 (exportación), INTRA_E5 (intracomunitaria), NS_LOC… Sin él, el del producto");
const shipTo = z.object({
  country_code: country.describe("País de entrega; fuera de España el pedido exige Incoterm y la expedición, DAE"),
}).strict();

const commercialLine = z.object({
  product_id: id,
  quantity: decimal.describe("Cantidad, mayor que cero"),
  discount_pct: percent.optional().describe("Descuento en %, de 0 a 100"),
  unit_price: decimal.optional().describe("Precio unitario sin IVA. Sin él, el de la tarifa del cliente o del canal"),
  price_reason: z.string().trim().min(3).max(300).optional().describe("Motivo del precio; obligatorio si no es el de tarifa"),
  tax_code: taxCode.optional(),
  description: z.string().max(250).optional().describe("Texto de la línea; sin él, el nombre del producto"),
}).strict();

const deliveryLine = z.object({
  order_line_id: id.optional().describe("Línea del pedido que se sirve: trae producto, precio, descuento e impuesto"),
  product_id: id.optional().describe("Producto; obligatorio si no hay order_line_id"),
  lot_id: id.optional().describe("Lote; obligatorio al emitir si el producto va por lotes"),
  quantity: decimal.describe("Unidades, mayor que cero (enteras si el producto lleva stock)"),
  unit_price: decimal.optional().describe("Precio unitario sin IVA; un albarán con precios queda valorado"),
  discount_pct: percent.optional(),
  tax_code: taxCode.optional(),
  description: z.string().max(250).optional(),
}).strict();

const quoteFields = {
  customer_id: id,
  channel,
  language: z.enum(["es", "en"]).optional().describe("Idioma del documento; es por defecto"),
  is_proforma: z.boolean().optional().describe("true para una factura proforma (no es una factura fiscal)"),
  incoterm: incoterm.optional(),
  valid_until: isoDate.optional().describe("Válido hasta, AAAA-MM-DD"),
  notes: z.string().max(2000).optional(),
};

const quoteChanges = z.object({
  customer_id: id.optional(),
  channel: channel.optional(),
  language: z.enum(["es", "en"]).optional(),
  is_proforma: z.boolean().optional(),
  incoterm: incoterm.nullable().optional(),
  valid_until: isoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(commercialLine).min(1).optional().describe("Si se manda, sustituye todas las líneas"),
}).strict();

const ORDER_KEYS = [
  "customer_id", "channel", "order_date", "requested_date", "customer_order_ref", "customer_department",
  "customer_cost_center", "external_ref", "ship_to", "incoterm", "notes",
] as const;

const orderText = z.string().max(80);

const orderChanges = z.object({
  customer_id: id.optional(),
  channel: channel.optional(),
  order_date: isoDate.optional(),
  requested_date: isoDate.nullable().optional().describe("Fecha de entrega pedida"),
  customer_order_ref: orderText.nullable().optional().describe("Número de pedido del cliente"),
  customer_department: orderText.nullable().optional().describe("Departamento (El Corte Inglés)"),
  customer_cost_center: orderText.nullable().optional().describe("Centro de coste (El Corte Inglés)"),
  external_ref: orderText.nullable().optional(),
  ship_to: shipTo.nullable().optional(),
  incoterm: incoterm.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(commercialLine).min(1).optional()
    .describe("Todas las líneas, en el mismo orden y número que ahora (para añadir o quitar, cancela el pedido y crea otro)"),
}).strict();

const deliveryKind = z.enum(["sale", "consignment", "transfer", "return", "sample"])
  .describe("sale (venta), consignment (depósito en un tercero), transfer (traspaso entre almacenes), return (devolución), sample (muestra)");

const RULE_SET_STATUS = "draft (borrador), active (activa) o superseded (sustituida)";

const ruleInput = z.object({
  scope: z.enum(["customer", "channel", "default"]).describe("customer (un cliente), channel (un canal) o default (el resto)"),
  customer_id: id.optional().describe("Obligatorio si scope es customer"),
  channel: channel.optional().describe("Obligatorio si scope es channel"),
  issuing_entity_id: id.describe("Sociedad que factura (id de P.O o CVPO)"),
  notes: z.string().max(500).optional(),
}).strict();

const EXPORT_FIELDS = ["entity_eori", "customer_eori", "incoterm", "nc_code", "origin", "net_weight", "gross_weight", "packages"] as const;

const exportCountry = z.object({
  example: z.boolean().describe("true si es un ejemplo sin confirmar"),
  confirmed: z.boolean().describe("true cuando el titular y el asesor lo han confirmado; un ejemplo no puede estar confirmado"),
  required_fields: z.array(z.enum(EXPORT_FIELDS)).describe("Datos que tiene que llevar la factura"),
  documents: z.array(z.object({
    code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).describe("commercial_invoice y packing_list se generan; el resto se aportan aparte"),
    name_es: z.string().trim().min(2).max(80),
    name_en: z.string().trim().min(2).max(80),
  }).strict()).max(20),
  notes: z.string().trim().min(1).max(2000).describe("Sin saltos de línea"),
}).strict();

const decimalText = z.string().trim().regex(/^\d+(\.\d+)?$/);

const exportParty = z.object({
  legal_name: z.string().trim().min(1).max(120),
  country_code: country,
  tax_id: z.string().max(20).optional(),
  eori: z.string().max(32).optional(),
  address_line: z.string().max(200).optional(),
  postal_code: z.string().max(16).optional(),
  city: z.string().max(80).optional(),
  province: z.string().max(80).optional(),
}).strict();

const exportInvoice = z.object({
  destination_country: country.describe("País de destino"),
  language: z.enum(["es", "en"]).optional(),
  currency: z.string().regex(/^[A-Za-z]{3}$/).optional().describe("EUR por defecto"),
  tax_treatment: z.string().regex(/^[A-Z0-9_]{2,20}$/).optional().describe("Código de tratamiento fiscal, p. ej. EXP_E2"),
  incoterm: z.string().length(3).optional(),
  packages: z.number().int().optional().describe("Número de bultos"),
  origin_country: country.optional(),
  number: z.string().max(60).optional().describe("Número de la factura"),
  issue_date: isoDate.optional(),
  entity: exportParty.describe("Sociedad que exporta"),
  customer: exportParty.describe("Cliente"),
  lines: z.array(z.object({
    line_no: z.number().int().min(1).max(999),
    description: z.string().trim().min(1).max(250),
    kind: z.enum(["wine", "other"]),
    quantity: decimalText.describe("Cantidad en texto, p. ej. \"12\""),
    unit: z.string().max(12).optional().describe("ud por defecto"),
    unit_price: decimalText.optional(),
    discount_pct: decimalText.optional(),
    line_base: decimalText.optional(),
    nc_code: z.string().max(8).optional().describe("Código NC (arancel)"),
    origin_country: country.optional(),
    unit_net_weight_g: z.number().int().min(1).optional(),
    unit_gross_weight_g: z.number().int().min(1).optional(),
    sku: z.string().max(40).optional(),
    lot_code: z.string().max(40).optional(),
  }).strict()).max(200),
  sscc: z.array(z.string().regex(/^\d{18}$/)).optional().describe("Códigos SSCC de los palés, 18 dígitos"),
}).strict();

const DOCUMENT_STATUSES = [
  "draft", "pending_approval", "issued", "pending", "partial", "overdue", "paid", "uncollectible", "void", "discarded",
  "sent", "accepted", "rejected", "expired", "converted",
  "shipped", "delivered", "partially_invoiced", "invoiced", "cancelled",
] as const;

type Fields = Record<string, unknown>;

function fieldsOf(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : {};
}

function bodyId(body: unknown): string | null {
  const found = fieldsOf(body).id;
  return typeof found === "string" ? found : null;
}

/** The document number, or how a draft without one is called. */
function numberOf(current: unknown, draft: string): string {
  const found = fieldsOf(current).number;
  return typeof found === "string" && found !== "" ? found : draft;
}

function objectOf(value: unknown): Fields | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Fields : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : null;
}

/** As the app saves an order: each line keeps product, quantity, discount and tax, and the tariff prices it again. */
function keptOrderLines(current: unknown): Fields[] {
  const lines = fieldsOf(current).lines;
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    const row = fieldsOf(line);
    const out: Fields = { product_id: row.product_id, quantity: row.quantity, discount_pct: row.discount_pct };
    if (typeof row.tax_code === "string") out.tax_code = row.tax_code;
    if (typeof row.description === "string") out.description = row.description;
    return out;
  });
}

const quoteLink = (input: { id: string }) => `/ventas/presupuestos/${input.id}`;
const orderLink = (input: { id: string }) => `/ventas/pedidos/${input.id}`;
const deliveryLink = (input: { id: string }) => `/ventas/albaranes/${input.id}`;
const createdQuote = (_: unknown, body: unknown) => (bodyId(body) ? `/ventas/presupuestos/${bodyId(body)}` : null);
const createdOrder = (_: unknown, body: unknown) => (bodyId(body) ? `/ventas/pedidos/${bodyId(body)}` : null);
const createdDelivery = (_: unknown, body: unknown) => (bodyId(body) ? `/ventas/albaranes/${bodyId(body)}` : null);

const quoteCurrent = { route: "GET /v1/quotes/:id" } as const;
const orderCurrent = { route: "GET /v1/sales-orders/:id" } as const;
const deliveryCurrent = { route: "GET /v1/delivery-notes/:id" } as const;

const quoteTools: readonly AnyTool[] = [
  defineRestRead({
    name: "sales_quotes_list",
    module: "sales",
    scope: "sales.read",
    title: "Lista de presupuestos",
    description: "Los presupuestos y proformas, del más reciente al más antiguo, con estado, cliente, líneas y totales. Paginada con next_cursor.",
    input: z.object({ limit, cursor: id.optional() }).strict(),
    route: "GET /v1/quotes",
  }),
  defineRestRead({
    name: "sales_quote_get",
    module: "sales",
    scope: "sales.read",
    title: "Ver presupuesto",
    description: "Un presupuesto con su estado, número, cliente, canal, validez, líneas, precios y totales.",
    input: z.object({ id }).strict(),
    route: "GET /v1/quotes/:id",
    web: quoteLink,
  }),
  defineRestRead({
    name: "sales_quote_pdf_get",
    module: "sales",
    scope: "sales.read",
    title: "PDF del presupuesto",
    description: "El PDF del presupuesto o de la proforma, el mismo que se descarga en la app (en base64).",
    input: z.object({ id }).strict(),
    route: "GET /v1/quotes/:id/pdf",
    web: quoteLink,
  }),
  defineRestWrite({
    name: "sales_quote_create",
    module: "sales",
    scope: "sales.write",
    title: "Crear presupuesto",
    description: "Crea un presupuesto (o proforma) en borrador para un cliente: canal, idioma, validez y líneas con producto y cantidad. Los precios salen de la tarifa; un precio distinto necesita motivo. Para duplicar uno, léelo con sales_quote_get y crea otro con sus líneas.",
    input: z.object({
      ...quoteFields,
      legal_entity_id: id.optional().describe("Sociedad que emite; sin ella la deciden las reglas de facturación"),
      lines: z.array(commercialLine).min(1),
    }).strict(),
    route: "POST /v1/quotes",
    web: createdQuote,
  }),
  defineRestWrite({
    name: "sales_quote_update",
    module: "sales",
    scope: "sales.write",
    title: "Editar presupuesto",
    description: "Cambia un presupuesto en borrador: cliente, canal, idioma, proforma, Incoterm, validez, notas o líneas. Solo hace falta mandar lo que cambia; las líneas, si se mandan, sustituyen a todas. Cambiar cliente, canal o líneas recalcula los precios con la tarifa.",
    input: z.object({ id, changes: quoteChanges }).strict(),
    route: "PATCH /v1/quotes/:id",
    current: quoteCurrent,
    send: (input) => input.changes,
    web: quoteLink,
  }),
  defineRestWrite({
    name: "sales_quote_mark_sent",
    module: "sales",
    scope: "sales.write",
    title: "Marcar presupuesto como enviado",
    description: "Numera el presupuesto y lo pasa a enviado. No manda ningún correo: el PDF se envía aparte.",
    input: z.object({ id }).strict(),
    route: "POST /v1/quotes/:id/send",
    current: quoteCurrent,
    summary: (_, current) => `Marcar el presupuesto ${numberOf(current, "en borrador")} como enviado. Si no tenía número, se le asigna ahora y ya no cambia. No se envía ningún correo. ¿Confirmas?`,
    web: quoteLink,
  }),
  defineRestWrite({
    name: "sales_quote_accept",
    module: "sales",
    scope: "sales.write",
    title: "Aceptar presupuesto",
    description: "Marca como aceptado un presupuesto en borrador o enviado (lo numera si no tenía número). Para hacer el pedido, sales_quote_convert.",
    input: z.object({ id }).strict(),
    route: "POST /v1/quotes/:id/accept",
    current: quoteCurrent,
    summary: (_, current) => `Marcar el presupuesto ${numberOf(current, "en borrador")} como aceptado por el cliente. Ya no se podrá editar. ¿Confirmas?`,
    web: quoteLink,
  }),
  defineRestWrite({
    name: "sales_quote_reject",
    module: "sales",
    scope: "sales.write",
    title: "Rechazar presupuesto",
    description: "Marca como rechazado un presupuesto en borrador o enviado, con motivo opcional. Un presupuesto rechazado queda cerrado: no se edita ni se convierte en pedido.",
    input: z.object({ id, reason: reason.optional().describe("Motivo, de 3 a 500 caracteres") }).strict(),
    route: "POST /v1/quotes/:id/reject",
    current: quoteCurrent,
    summary: (_, current) => `Rechazar el presupuesto ${numberOf(current, "en borrador")}. Queda cerrado y no se podrá convertir en pedido. ¿Confirmas?`,
    web: quoteLink,
  }),
  defineRestWrite({
    name: "sales_quote_convert",
    module: "sales",
    scope: "sales.write",
    title: "Convertir presupuesto en pedido",
    description: "Crea un pedido en borrador con el cliente, el canal, las líneas y los precios del presupuesto; el presupuesto queda convertido y no se puede convertir otra vez.",
    input: z.object({ id }).strict(),
    route: "POST /v1/quotes/:id/to-order",
    current: quoteCurrent,
    summary: (_, current) => `Convertir el presupuesto ${numberOf(current, "en borrador")} en un pedido en borrador con sus mismas líneas y precios. El presupuesto queda como convertido. ¿Confirmas?`,
    web: createdOrder,
  }),
];

const orderTools: readonly AnyTool[] = [
  defineRestRead({
    name: "sales_orders_list",
    module: "sales",
    scope: "sales.read",
    title: "Lista de pedidos",
    description: "Pedidos de venta, del más reciente al más antiguo, con filtros por estado, sociedad, canal y cliente. Paginada con next_cursor.",
    input: z.object({
      status: z.enum(["draft", "confirmed", "partially_delivered", "delivered", "closed", "cancelled"]).optional(),
      entity: id.optional().describe("Id de la sociedad que factura"),
      channel: channel.optional(),
      customer_id: id.optional(),
      limit,
      cursor: id.optional(),
    }).strict(),
    route: "GET /v1/sales-orders",
  }),
  defineRestRead({
    name: "sales_order_get",
    module: "sales",
    scope: "sales.read",
    title: "Ver pedido",
    description: "Un pedido con estado, número, sociedad que factura (o la que propondrían las reglas si está en borrador), cliente, líneas y totales. Cada línea trae el id que pide el albarán.",
    input: z.object({ id }).strict(),
    route: "GET /v1/sales-orders/:id",
    web: orderLink,
  }),
  defineRestWrite({
    name: "sales_order_create",
    module: "sales",
    scope: "sales.write",
    title: "Crear pedido",
    description: "Crea un pedido de venta en borrador para un cliente, con sus líneas. Los precios salen de la tarifa; un precio distinto necesita motivo. Para duplicar un pedido, léelo con sales_order_get y crea otro con sus líneas.",
    input: z.object({
      customer_id: id,
      channel,
      legal_entity_id: id.optional().describe("Sociedad que factura; sin ella la deciden las reglas al confirmar"),
      source: z.enum(["manual", "edi", "web", "mcp", "import"]).optional().describe("Origen del pedido; manual por defecto"),
      order_date: isoDate.optional().describe("Fecha del pedido; hoy por defecto"),
      requested_date: isoDate.optional().describe("Fecha de entrega pedida"),
      customer_order_ref: orderText.optional().describe("Número de pedido del cliente"),
      customer_department: orderText.optional().describe("Departamento (obligatorio para El Corte Inglés)"),
      customer_cost_center: orderText.optional().describe("Centro de coste (obligatorio para El Corte Inglés)"),
      external_ref: orderText.optional().describe("Referencia en el sistema de origen; única por origen"),
      ship_to: shipTo.optional(),
      incoterm: incoterm.optional().describe("Obligatorio al confirmar si se entrega fuera de España"),
      notes: z.string().max(2000).optional(),
      quote_id: id.optional().describe("Presupuesto del que viene"),
      lines: z.array(commercialLine).min(1),
    }).strict(),
    route: "POST /v1/sales-orders",
    web: createdOrder,
  }),
  defineRestWrite({
    name: "sales_order_update",
    module: "sales",
    scope: "sales.write",
    title: "Editar pedido",
    description: "Cambia un pedido en borrador: cliente, canal, fechas, referencias, departamento y centro de coste, país de entrega, Incoterm, notas o líneas. Solo hace falta mandar lo que cambia. Como al guardar en la app, las líneas se vuelven a valorar con la tarifa; para mantener un precio distinto, manda las líneas con unit_price y price_reason.",
    input: z.object({ id, changes: orderChanges }).strict(),
    route: "PATCH /v1/sales-orders/:id",
    current: orderCurrent,
    send: (input, current) => {
      const body = patchOnto(current, ORDER_KEYS, input.changes);
      if (input.changes.lines === undefined) body.lines = keptOrderLines(current);
      if (body.ship_to !== undefined && body.ship_to !== null) body.ship_to = objectOf(body.ship_to);
      return body;
    },
    web: orderLink,
  }),
  defineRestWrite({
    name: "sales_order_confirm",
    module: "sales",
    scope: "sales.write",
    title: "Confirmar pedido",
    description: "Confirma un pedido en borrador: le asigna número y la sociedad que factura según las reglas activas. Después ya no se edita; se sirve con albaranes.",
    input: z.object({ id }).strict(),
    route: "POST /v1/sales-orders/:id/confirm",
    current: orderCurrent,
    summary: () => "Confirmar el pedido: recibe su número y la sociedad que factura según las reglas, y ya no se podrá editar. ¿Confirmas?",
    web: orderLink,
  }),
  defineRestWrite({
    name: "sales_order_cancel",
    module: "sales",
    scope: "sales.write",
    title: "Cancelar pedido",
    description: "Cancela un pedido en borrador o confirmado, con motivo. No se puede si ya tiene albaranes emitidos. Es irreversible.",
    input: z.object({ id, reason }).strict(),
    route: "POST /v1/sales-orders/:id/cancel",
    current: orderCurrent,
    summary: (input, current) => `Cancelar el pedido ${numberOf(current, "en borrador")} («${input.reason}»). Es irreversible: si era un borrador, recibe número igualmente para que conste. ¿Confirmas?`,
    web: orderLink,
  }),
  defineRestWrite({
    name: "sales_order_close",
    module: "sales",
    scope: "sales.manage",
    title: "Cerrar resto del pedido",
    description: "Da por terminado un pedido servido en parte: lo que falta por servir ya no se servirá. Con motivo. Es irreversible.",
    input: z.object({ id, reason }).strict(),
    route: "POST /v1/sales-orders/:id/close",
    current: orderCurrent,
    summary: (input, current) => `Cerrar el pedido ${numberOf(current, "")} sin servir lo que falta («${input.reason}»). Es irreversible. ¿Confirmas?`,
    web: orderLink,
  }),
  defineRestWrite({
    name: "sales_order_entity_exception_set",
    module: "sales",
    scope: "sales.manage",
    title: "Cambiar sociedad que factura",
    description: "Elige, con motivo, otra sociedad (P.O o CVPO) para facturar un pedido en borrador, en vez de la que dicen las reglas de facturación. Queda registrado como excepción.",
    input: z.object({
      id,
      legal_entity_id: id.describe("Sociedad que facturará"),
      reason: z.string().trim().min(5).max(500),
    }).strict(),
    route: "POST /v1/sales-orders/:id/entity-exception",
    current: orderCurrent,
    summary: (input) => `Facturar este pedido desde otra sociedad que la de las reglas («${input.reason}»). Queda registrado como excepción. ¿Confirmas?`,
    web: orderLink,
  }),
  defineRestWrite({
    name: "sales_order_delivery_note_create",
    module: "sales",
    scope: "sales.write",
    title: "Crear albarán del pedido",
    description: "Crea un albarán en borrador para servir un pedido confirmado: almacén de salida y, por cada línea del pedido (order_line_id), cantidad y lote. Cliente, sociedad, precios e impuestos salen del pedido. Después hay que emitirlo.",
    input: z.object({
      id,
      from_location_id: id.describe("Almacén de salida"),
      kind: deliveryKind.optional().describe("sale por defecto"),
      to_location_id: id.optional().describe("Almacén de destino (depósito o traspaso)"),
      ship_to: shipTo.optional(),
      incoterm: incoterm.optional(),
      notes: z.string().max(2000).optional(),
      lines: z.array(deliveryLine).min(1),
    }).strict(),
    route: "POST /v1/sales-orders/:id/delivery-notes",
    current: orderCurrent,
    web: createdDelivery,
  }),
];

const deliveryTools: readonly AnyTool[] = [
  defineRestRead({
    name: "sales_delivery_notes_list",
    module: "sales",
    scope: "sales.read",
    title: "Lista de albaranes",
    description: "Albaranes, del más reciente al más antiguo, con filtros por tipo, estado, facturación, cliente y sociedad. Paginada con next_cursor.",
    input: z.object({
      kind: deliveryKind.optional(),
      status: z.enum(["draft", "issued", "shipped", "delivered", "cancelled"]).optional(),
      invoiced: z.enum(["true", "false", "not_invoiceable"]).optional().describe("true facturados, false pendientes de facturar, not_invoiceable no facturables"),
      customer_id: id.optional(),
      entity: z.string().max(40).optional().describe("PO, CVPO o el id de la sociedad"),
      limit,
      cursor: id.optional(),
    }).strict(),
    route: "GET /v1/delivery-notes",
  }),
  defineRestRead({
    name: "sales_delivery_notes_uninvoiced_lines_list",
    module: "sales",
    scope: "sales.read",
    title: "Líneas de albarán sin facturar",
    description: "Las líneas de albaranes emitidos que faltan por facturar, con la cantidad pendiente: es lo que se pasa a factura desde Facturas.",
    input: z.object({}).strict(),
    route: "GET /v1/delivery-notes/uninvoiced-lines",
  }),
  defineRestRead({
    name: "sales_delivery_note_get",
    module: "sales",
    scope: "sales.read",
    title: "Ver albarán",
    description: "Un albarán con tipo, estado, facturación, almacenes, seguimiento y líneas (con el id de cada una, necesario para devoluciones e incidencias).",
    input: z.object({ id }).strict(),
    route: "GET /v1/delivery-notes/:id",
    web: deliveryLink,
  }),
  defineRestRead({
    name: "sales_delivery_note_pdf_get",
    module: "sales",
    scope: "sales.read",
    title: "PDF del albarán",
    description: "El PDF del albarán con sus lotes, el mismo que se descarga en la app (en base64).",
    input: z.object({ id }).strict(),
    route: "GET /v1/delivery-notes/:id/pdf",
    web: deliveryLink,
  }),
  defineRestRead({
    name: "sales_delivery_note_incidents_list",
    module: "sales",
    scope: "sales.read",
    title: "Incidencias del albarán",
    description: "Las incidencias de transporte del albarán (roturas, pérdidas, retrasos, rechazos) con su estado y plazo de reclamación.",
    input: z.object({ id }).strict(),
    route: "GET /v1/delivery-notes/:id/incidents",
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_create",
    module: "sales",
    scope: "sales.write",
    title: "Crear albarán",
    description: "Crea un albarán en borrador sin pasar por un pedido: venta, muestra, depósito, traspaso entre almacenes o devolución. Venta y muestra necesitan cliente; depósito, traspaso y devolución, almacén de destino. Para servir un pedido, sales_order_delivery_note_create.",
    input: z.object({
      kind: deliveryKind.optional().describe("sale por defecto"),
      from_location_id: id.describe("Almacén de salida"),
      to_location_id: id.optional().describe("Almacén de destino"),
      customer_id: id.optional(),
      sales_order_id: id.optional().describe("Pedido confirmado que sirve; trae cliente, sociedad y canal"),
      legal_entity_id: id.optional().describe("Sociedad; sin ella, la que controla el almacén de salida"),
      channel: channel.optional(),
      ship_to: shipTo.optional(),
      incoterm: incoterm.optional(),
      notes: z.string().max(2000).optional(),
      lines: z.array(deliveryLine).min(1),
    }).strict(),
    route: "POST /v1/delivery-notes",
    web: createdDelivery,
  }),
  defineRestWrite({
    name: "sales_delivery_note_update",
    module: "sales",
    scope: "sales.write",
    title: "Cambiar líneas del albarán",
    description: "Sustituye todas las líneas de un albarán en borrador (producto o línea de pedido, cantidad, lote, precio).",
    input: z.object({ id, lines: z.array(deliveryLine).min(1) }).strict(),
    route: "PATCH /v1/delivery-notes/:id",
    current: deliveryCurrent,
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_issue",
    module: "sales",
    scope: "sales.write",
    title: "Emitir albarán",
    description: "Emite un albarán en borrador: le da número y mueve el stock (salida, traspaso o entrada de devolución). Comprueba existencias, lotes y lo pendiente del pedido. Para deshacerlo hay que anularlo.",
    input: z.object({ id }).strict(),
    route: "POST /v1/delivery-notes/:id/issue",
    current: deliveryCurrent,
    summary: () => "Emitir el albarán: recibe su número definitivo y se mueve el stock. Ya no se podrá editar; para deshacerlo habrá que anularlo. ¿Confirmas?",
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_dispatch",
    module: "sales",
    scope: "sales.write",
    title: "Marcar albarán como expedido",
    description: "Marca un albarán emitido como expedido (ha salido de la bodega), con número de seguimiento y transportista opcionales. Una venta fuera de España exige antes el DAE.",
    input: z.object({
      id,
      tracking_ref: z.string().max(120).optional().describe("Número de seguimiento del envío"),
      carrier_contact_id: id.optional().describe("Contacto del transportista"),
    }).strict(),
    route: "POST /v1/delivery-notes/:id/dispatch",
    current: deliveryCurrent,
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_mark_delivered",
    module: "sales",
    scope: "sales.write",
    title: "Marcar albarán como entregado",
    description: "Marca un albarán expedido como entregado al cliente.",
    input: z.object({ id }).strict(),
    route: "POST /v1/delivery-notes/:id/deliver",
    current: deliveryCurrent,
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_void",
    module: "sales",
    scope: "sales.manage",
    title: "Anular albarán",
    description: "Anula un albarán con motivo. Si estaba emitido, el stock vuelve; no se puede si ya salió (eso es una devolución) ni si está facturado. Es irreversible.",
    input: z.object({ id, reason }).strict(),
    route: "POST /v1/delivery-notes/:id/void",
    current: deliveryCurrent,
    summary: (input, current) => `Anular el albarán ${numberOf(current, "en borrador")} («${input.reason}»). Si estaba emitido, el stock vuelve al almacén. Es irreversible. ¿Confirmas?`,
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_return_create",
    module: "sales",
    scope: "sales.write",
    title: "Crear devolución",
    description: "Crea un albarán de devolución en borrador a partir de un albarán emitido: qué líneas y cuántas unidades vuelven y a qué almacén. Después hay que emitirlo.",
    input: z.object({
      id,
      to_location_id: id.describe("Almacén al que vuelve la mercancía"),
      lines: z.array(z.object({
        line_id: id.describe("Línea del albarán original"),
        quantity: decimal.describe("Unidades que vuelven, sin pasar de lo entregado"),
      }).strict()).min(1),
      notes: z.string().max(2000).optional(),
    }).strict(),
    route: "POST /v1/delivery-notes/:id/return",
    current: deliveryCurrent,
    web: createdDelivery,
  }),
  defineRestWrite({
    name: "sales_delivery_note_mark_not_invoiceable",
    module: "sales",
    scope: "sales.manage",
    title: "Marcar albarán como no facturable",
    description: "Marca un albarán emitido como no facturable, con motivo: deja de salir entre lo pendiente de facturar.",
    input: z.object({ id, reason }).strict(),
    route: "POST /v1/delivery-notes/:id/not-invoiceable",
    current: deliveryCurrent,
    summary: (input, current) => `Marcar el albarán ${numberOf(current, "")} como no facturable («${input.reason}»). Dejará de salir entre lo pendiente de facturar. ¿Confirmas?`,
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_incident_create",
    module: "sales",
    scope: "sales.write",
    title: "Registrar incidencia de transporte",
    description: "Registra una incidencia en un albarán emitido (rotura, pérdida, retraso, rechazo u otra), con unidades afectadas y referencia de reclamación. Fija el plazo de reclamación y propone la merma, que no se registra hasta confirmarla.",
    input: z.object({
      id,
      kind: z.enum(["breakage", "loss", "delay", "refused", "other"]).describe("breakage (rotura), loss (pérdida), delay (retraso), refused (rechazado), other"),
      description: z.string().trim().min(3).max(2000),
      units_affected: z.number().int().min(0).optional(),
      carrier_claim_ref: z.string().max(80).optional().describe("Referencia de la reclamación al transportista"),
      line_id: id.optional().describe("Línea afectada; obligatoria si el albarán tiene varias y hay merma"),
      photos: z.array(id).optional().describe("Ids de adjuntos ya subidos"),
    }).strict(),
    route: "POST /v1/delivery-notes/:id/incidents",
    current: deliveryCurrent,
    web: deliveryLink,
  }),
  defineRestWrite({
    name: "sales_delivery_note_loss_confirm",
    module: "sales",
    scope: "sales.write",
    title: "Confirmar merma de una incidencia",
    description: "Registra como merma de stock las unidades perdidas de una incidencia de transporte (el id sale en sales_delivery_note_incidents_list). Es irreversible.",
    input: z.object({ id, incident_id: id }).strict(),
    route: "POST /v1/delivery-notes/:id/incidents/:incidentId/confirm-loss",
    params: { incidentId: "incident_id" },
    current: deliveryCurrent,
    summary: (_, current) => `Dar de baja del stock, como merma, las unidades perdidas de la incidencia del albarán ${numberOf(current, "")}. Es irreversible. ¿Confirmas?`,
    web: deliveryLink,
  }),
];

const listTools: readonly AnyTool[] = [
  defineRestRead({
    name: "sales_documents_list",
    module: "sales",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read", "purchasing.read"],
    title: "Documentos de venta",
    description: "La lista unificada de Holded y WineCore: facturas (de venta o de compra), presupuestos o albaranes, con filtros de estado, sociedad, fechas, cliente y búsqueda, orden, totales y recuentos por estado.",
    input: z.object({
      kind: z.enum(["invoice", "quote", "delivery_note"]),
      direction: z.enum(["sale", "purchase"]).optional().describe("purchase solo con facturas (facturas de compra)"),
      origin: z.array(z.enum(["holded", "winecore"])).optional(),
      entity: z.enum(["PO", "CVPO", "both"]).optional(),
      status: z.array(z.enum(DOCUMENT_STATUSES)).optional().describe("Estados válidos según el tipo de documento"),
      from: isoDate.optional(),
      to: isoDate.optional(),
      q: z.string().max(120).optional().describe("Número, cliente o texto"),
      customer_id: id.optional(),
      verifactu: z.enum(["pending", "accepted", "rejected"]).optional().describe("Solo facturas de venta"),
      delivery: z.enum(["pending", "sent", "failed", "no_recipient", "none"]).optional().describe("Envío al cliente; solo facturas de venta"),
      sort: z.enum(["date", "number", "customer", "total", "pending"]).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
      limit,
      offset: z.number().int().min(0).max(1_000_000).optional(),
    }).strict(),
    route: "GET /v1/sales-documents",
  }),
  defineRestRead({
    name: "sales_catalog_get",
    module: "sales",
    scope: "sales.read",
    title: "Catálogo de venta",
    description: "Lo que se puede vender en una fecha: productos activos con el precio de tarifa del cliente o del canal, lotes con existencias por almacén e impuestos. Es lo que usa la app al hacer un presupuesto, pedido o albarán.",
    input: z.object({
      customer_id: id.optional(),
      channel: channel.optional(),
      date: isoDate.optional().describe("Hoy por defecto"),
    }).strict(),
    route: "GET /v1/sales/catalog",
  }),
];

const ruleTools: readonly AnyTool[] = [
  defineRestRead({
    name: "sales_billing_rules_resolve",
    module: "sales",
    scope: "sales.read",
    title: "Qué sociedad factura",
    description: "Qué sociedad (P.O o CVPO) facturaría a un cliente por un canal según las reglas activas, o las de una versión en borrador, y por qué regla. Sin reglas activas devuelve null.",
    input: z.object({ customer_id: id, channel, set_id: id.optional().describe("Versión de reglas que probar") }).strict(),
    route: "GET /v1/billing-rules/resolve",
  }),
  defineRestRead({
    name: "sales_billing_rules_state_get",
    module: "sales",
    scope: "sales.read",
    title: "Estado de las reglas de facturación",
    description: "Si hay reglas de facturación activas (active), solo versiones sin activar (inactive) o ninguna (empty). Sin reglas activas no se puede confirmar ningún pedido.",
    input: z.object({}).strict(),
    route: "GET /v1/billing-rules/state",
  }),
  defineRestRead({
    name: "sales_billing_rule_sets_list",
    module: "sales",
    scope: "settings.manage",
    title: "Versiones de reglas de facturación",
    description: `Todas las versiones de las reglas que deciden qué sociedad factura, con su estado (${RULE_SET_STATUS}), la aprobación pedida y sus reglas.`,
    input: z.object({}).strict(),
    route: "GET /v1/billing-rules/sets",
  }),
  defineRestRead({
    name: "sales_billing_rule_set_impact_get",
    module: "sales",
    scope: "settings.manage",
    title: "Impacto de unas reglas",
    description: "Simula una versión de reglas: cuántos pedidos confirmados de los últimos días habrían salido de otra sociedad, y cuáles. No cambia nada.",
    input: z.object({ id, days: z.number().int().min(1).max(3660).optional().describe("Días hacia atrás; 90 por defecto") }).strict(),
    route: "GET /v1/billing-rules/sets/:id/impact",
  }),
  defineRestWrite({
    name: "sales_billing_rule_set_create",
    module: "sales",
    scope: "settings.manage",
    title: "Nueva versión de reglas de facturación",
    description: "Abre una versión nueva de las reglas de facturación en borrador, con una copia de las activas para editarlas.",
    input: z.object({ notes: z.string().max(500).optional() }).strict(),
    route: "POST /v1/billing-rules/sets",
  }),
  defineRestWrite({
    name: "sales_billing_rule_set_rules_replace",
    module: "sales",
    scope: "settings.manage",
    title: "Cambiar reglas de facturación",
    description: "Sustituye todas las reglas de una versión en borrador: una por cliente, una por canal y una por defecto (obligatoria para activarla). Gana la de cliente, luego la de canal y luego la de por defecto.",
    input: z.object({ id, rules: z.array(ruleInput) }).strict(),
    route: "PUT /v1/billing-rules/sets/:id/rules",
  }),
  defineRestWrite({
    name: "sales_billing_rule_set_activation_request",
    module: "sales",
    scope: "settings.manage",
    title: "Pedir aprobación de reglas",
    description: "Pide la aprobación para activar una versión de reglas en borrador. La aprobación se decide aparte, en Aprobaciones; después se activa con sales_billing_rule_set_activate.",
    input: z.object({ id }).strict(),
    route: "POST /v1/billing-rules/sets/:id/request-activation",
  }),
  defineRestWrite({
    name: "sales_billing_rule_set_activate",
    module: "sales",
    scope: "settings.manage",
    title: "Activar reglas de facturación",
    description: "Activa una versión de reglas ya aprobada y sin cambios desde la aprobación; la activa hasta ahora queda sustituida. Los pedidos ya confirmados no cambian de sociedad.",
    input: z.object({ id }).strict(),
    route: "POST /v1/billing-rules/sets/:id/activate",
    summary: () => "Activar esta versión de las reglas de facturación: los pedidos que se confirmen a partir de ahora se facturarán desde la sociedad que digan. La versión activa hasta ahora queda sustituida. ¿Confirmas?",
  }),
];

const exportTools: readonly AnyTool[] = [
  defineRestRead({
    name: "sales_export_country_documents_get",
    module: "sales",
    scope: "settings.manage",
    title: "Requisitos de exportación por país",
    description: "Qué datos y documentos pide cada país de destino para exportar (ajuste del titular), si está confirmado o es un ejemplo, y cuándo se cambió.",
    input: z.object({}).strict(),
    route: "GET /v1/export/documents-by-country",
  }),
  defineRestWrite({
    name: "sales_export_country_documents_update",
    module: "sales",
    scope: "settings.manage",
    title: "Cambiar requisitos de exportación",
    description: "Cambia los requisitos de exportación por país. Los países que se manden sustituyen a esos mismos países del ajuste; los demás se quedan igual, y remove_countries quita países. Solo el titular.",
    input: z.object({
      notice: z.string().trim().min(1).max(500).optional().describe("Aviso general, sin saltos de línea"),
      countries: z.record(z.string().regex(/^[A-Za-z]{2}$/), exportCountry).optional().describe("Por código de país de 2 letras"),
      remove_countries: z.array(country).optional(),
    }).strict(),
    route: "PUT /v1/export/documents-by-country",
    current: { route: "GET /v1/export/documents-by-country" },
    send: (input, current) => {
      const value = fieldsOf(fieldsOf(current).value);
      const countries = new Map<string, unknown>();
      for (const [code, item] of Object.entries(fieldsOf(value.countries))) countries.set(code.toUpperCase(), item);
      for (const [code, item] of Object.entries(input.countries ?? {})) countries.set(code.toUpperCase(), item);
      for (const code of input.remove_countries ?? []) countries.delete(code.toUpperCase());
      return { notice: input.notice ?? value.notice, countries: Object.fromEntries(countries) };
    },
  }),
  defineRestRead({
    name: "sales_export_readiness_check",
    module: "sales",
    scope: "settings.manage",
    title: "¿Está lista para exportar?",
    description: "Comprueba si una factura de exportación lleva todo lo que pide el país de destino (EORI, Incoterm, código NC, origen, pesos, bultos, SSCC) y dice qué falta.",
    input: exportInvoice,
    route: "POST /v1/export/readiness",
    computeOnly: "Solo compara la factura con los requisitos del país; no guarda nada.",
  }),
  defineRestRead({
    name: "sales_export_checklist_get",
    module: "sales",
    scope: "settings.manage",
    title: "Documentos para exportar",
    description: "La lista de documentos que pide el país de destino para una factura de exportación: cuáles genera WineCore, cuáles se aportan aparte y cuáles faltan.",
    input: exportInvoice,
    route: "POST /v1/export/checklist",
    computeOnly: "Solo calcula la lista de documentos del país; no guarda nada.",
  }),
  defineRestRead({
    name: "sales_export_documents_generate",
    module: "sales",
    scope: "settings.manage",
    title: "Generar factura comercial y lista de bultos",
    description: "Genera en PDF la factura comercial y la lista de bultos de una factura de exportación que ya cumple los requisitos del país. Devuelve el texto y los PDF en base64.",
    input: exportInvoice,
    route: "POST /v1/export/documents",
    computeOnly: "Genera los PDF al vuelo y los devuelve; no guarda nada.",
  }),
];

export const salesRestTools: readonly AnyTool[] = [
  ...quoteTools,
  ...orderTools,
  ...deliveryTools,
  ...listTools,
  ...ruleTools,
  ...exportTools,
];
