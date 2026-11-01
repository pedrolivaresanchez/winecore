import { z } from "zod";

import { DOC_TYPES } from "../../../core/series";
import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha AAAA-MM-DD");
const decimal = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
const limit = z.number().int().min(1).max(100).optional();
const cursor = z.string().max(200).optional();
const docType = z.enum(DOC_TYPES).describe("invoice factura, credit_note rectificativa, simplified_invoice simplificada…");
const year = z.number().int().min(2020).max(2100);
const channel = z.string().regex(/^[a-z_]{2,20}$/).describe("Canal de venta (código)");
const paymentMethod = z.enum(["transfer", "direct_debit", "card", "cash", "stripe", "other"]);
const incoterm = z.enum(["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"]);
const legacyEntity = z.enum(["PO", "CVPO", "both"]).optional().describe("Sociedad: PO, CVPO o both (las dos)");

const invoiceLine = z.object({
  product_id: id,
  description: z.string().min(1).max(250).optional().describe("Texto de la línea; por defecto, el nombre del producto"),
  quantity: decimal.describe("Cantidad; negativa solo en una rectificativa por diferencias"),
  unit_price: decimal.optional().describe("Precio unitario sin IVA; si falta, el de la tarifa del cliente"),
  discount_pct: decimal.optional().describe("Descuento en %, de 0 a 100"),
  tax_code: z.string().min(1).max(40).optional().describe("IVA21, IVA21_RE, IVA21_ALQ, EXP_E2, INTRA_E5…; por defecto, el del producto"),
  lot_id: id.optional(),
  lot_code: z.string().min(1).max(120).optional().describe("Lote; obligatorio en las líneas de vino"),
  delivery_note_line_id: id.optional(),
  order_line_id: id.optional(),
}).strict();

const rectifiedInvoice = z.union([
  z.object({ invoice_id: id.describe("Factura emitida de WineCore que se rectifica") }).strict(),
  z.object({
    legacy: z.object({
      issuer_tax_id: z.string().min(1).max(20).describe("NIF de la sociedad que emitió la factura en Holded"),
      number: z.string().min(1).max(60),
      issue_date: day,
      base: decimal.optional(),
      quota: decimal.optional(),
      surcharge: decimal.optional(),
    }).strict().describe("Factura de Holded; en sustitución hacen falta base, cuota y recargo"),
  }).strict(),
]);

const invoiceFields = {
  description: z.string().min(1).max(500).optional().describe("Concepto general de la factura (al crearla, por defecto «Venta de vino»)"),
  language: z.enum(["es", "en"]).optional(),
  payment_terms_days: z.number().int().min(0).max(180).optional().describe("Días de vencimiento; por defecto, los del cliente"),
  notes: z.string().max(2000).optional(),
};

const invoiceCreate = z.object({
  customer_id: id.optional().describe("Cliente; obligatorio salvo que salga de los albaranes o del pedido"),
  legal_entity_id: id.optional().describe("Sociedad que factura; si falta, la de las reglas de facturación o la del origen"),
  series_id: id.optional().describe("Serie; si falta, la de por defecto del año"),
  invoice_type: z.enum(["F1", "R1", "R2", "R3", "R4"]).optional()
    .describe("F1 factura completa (por defecto). Rectificativas: R1 error en la factura, R2 concurso, R3 crédito incobrable, R4 devolución o descuento"),
  rectification_kind: z.enum(["I", "S"]).optional().describe("Solo rectificativas: I por diferencias, S por sustitución"),
  rectifies: z.array(rectifiedInvoice).min(1).optional().describe("Solo rectificativas: la factura rectificada"),
  reason: z.string().min(1).max(2000).optional().describe("Motivo; obligatorio en rectificativas"),
  no_physical_return: z.boolean().optional().describe("Solo rectificativas: no hay devolución física de mercancía"),
  return_delivery_note: z.string().max(80).optional().describe("Solo rectificativas: albarán de devolución"),
  from_delivery_notes: z.array(id).min(1).optional().describe("Facturar estos albaranes emitidos (mismo cliente y sociedad)"),
  from_order: id.optional().describe("Facturar este pedido; no se combina con albaranes"),
  lines: z.array(invoiceLine).optional().describe("Líneas manuales, además de las de albaranes o pedido"),
  channel: channel.optional(),
  payment_method: paymentMethod.optional(),
  operation_date: day.optional(),
  issue_date: day.optional().describe("Fecha de expedición; si falta, la del día de emisión"),
  incoterm: incoterm.optional(),
  ...invoiceFields,
}).strict();

const invoiceChanges = z.object({
  customer_id: id.optional(),
  legal_entity_id: id.optional(),
  series_id: id.nullable().optional().describe("null para volver a la serie de por defecto"),
  channel: channel.nullable().optional(),
  payment_method: paymentMethod.nullable().optional(),
  operation_date: day.nullable().optional(),
  issue_date: day.nullable().optional(),
  incoterm: incoterm.nullable().optional(),
  lines: z.array(invoiceLine).optional().describe("Sustituye todas las líneas del borrador"),
  no_physical_return: z.boolean().nullable().optional().describe("Solo rectificativas"),
  return_delivery_note: z.string().max(80).nullable().optional().describe("Solo rectificativas"),
  ...invoiceFields,
  notes: invoiceFields.notes.nullable(),
}).strict();

const invoiceListFilters = {
  entity: id.optional().describe("Solo las facturas de esa sociedad"),
  status: z.enum(["draft", "pending_approval", "issued", "voided", "discarded"]).optional(),
  series: id.optional(),
  customer_id: id.optional(),
  from: day.optional().describe("Fecha de emisión desde"),
  to: day.optional().describe("Fecha de emisión hasta"),
  payment_status: z.enum(["unpaid", "partially_paid", "paid", "uncollectible"]).optional(),
  verifactu_status: z.enum(["pending", "accepted"]).optional(),
  delivery_status: z.enum(["pending", "sent", "failed", "no_recipient", "none"]).optional(),
};

const legacyList = {
  entity: legacyEntity,
  q: z.string().max(120).optional().describe("Número o nombre"),
  limit,
  cursor,
};

const VOID_REASONS = { duplicate: "duplicada", wrong_entity: "sociedad equivocada", wrong_customer: "cliente equivocado sin entrega" } as const;

const invoiceLink = (input: { id: string }) => `/facturas/${input.id}`;

function fieldsOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function invoiceLabel(current: unknown): string {
  const invoice = fieldsOf(current);
  const number = textOf(invoice.number);
  const customer = textOf(invoice.customer_name);
  const total = textOf(invoice.total);
  return [
    number ? `la factura ${number}` : "el borrador",
    customer ? `de ${customer}` : null,
    total ? `por ${total} ${textOf(invoice.currency) ?? "EUR"}` : null,
  ].filter(Boolean).join(" ");
}

export const billingRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "billing_invoices_list",
    module: "billing",
    scope: "billing.read",
    title: "Lista de facturas",
    description: "Las facturas de WineCore con los filtros de la app (sociedad, estado, cliente, fechas, cobro, envío), de la más reciente a la más antigua, paginadas con next_cursor.",
    input: z.object({ ...invoiceListFilters, limit, cursor }).strict(),
    route: "GET /v1/invoices",
  }),
  defineRestRead({
    name: "billing_invoices_book_export",
    module: "billing",
    scope: "billing.read",
    title: "Libro de facturas expedidas (CSV)",
    description: "El libro registro de facturas expedidas de una sociedad para un trimestre, un mes o unas fechas, como lo descarga la app. Devuelve el texto del CSV.",
    input: z.object({
      entity: z.string().min(2).max(36).describe("Sociedad: código (PO, CVPO) o su id"),
      period: z.string().regex(/^\d{4}-(Q[1-4]|\d{2})$/).optional().describe("2026-Q4 o 2026-10; si no, from y to"),
      from: day.optional(),
      to: day.optional(),
    }).strict(),
    route: "GET /v1/invoices/export",
  }),
  defineRestRead({
    name: "billing_invoice_deliveries_pending_list",
    module: "billing",
    scope: "billing.deliver",
    title: "Facturas pendientes de envío",
    description: "Facturas emitidas cuyo último envío está pendiente, fallido o sin destinatario, de la más antigua a la más reciente. WineCore no envía correo: el asistente las manda y después registra el envío.",
    input: z.object({
      entity: id.optional().describe("Solo las de esa sociedad"),
      older_than_hours: z.number().min(0).optional().describe("Solo las que llevan al menos estas horas pendientes"),
      limit,
      cursor,
    }).strict(),
    route: "GET /v1/invoices/deliveries/pending",
  }),
  defineRestWrite({
    name: "billing_invoices_batch_issue_request",
    module: "billing",
    scope: "billing.write",
    title: "Pedir aprobación para emitir un lote",
    description: "Valida hasta 100 borradores de una misma sociedad y pide la aprobación para emitirlos juntos. Mientras se decide quedan bloqueados (pendientes de aprobación); aprobado el lote, se emite con billing_invoices_batch_issue.",
    input: z.object({ invoice_ids: z.array(id).min(1).max(100) }).strict(),
    route: "POST /v1/invoices/batch-issue-request",
    summary: (input) => `Pedir la aprobación para emitir ${input.invoice_ids.length} borrador(es) de una vez. Quedan bloqueados hasta que se decida. ¿Confirmas?`,
    web: (_input, body) => {
      const request = textOf(fieldsOf(body).approval_request_id);
      return request ? `/aprobaciones/${request}` : null;
    },
  }),
  defineRestWrite({
    name: "billing_invoices_batch_issue",
    module: "billing",
    scope: "billing.issue",
    title: "Emitir lote aprobado",
    description: "Emite, por orden de fecha, las facturas de un lote ya aprobado (el id de la aprobación sale al pedirla). Los borradores que cambiaron después de pedirla vuelven a borrador y se listan en failed. Emitir es irreversible.",
    input: z.object({ request_id: id.describe("Id de la aprobación del lote") }).strict(),
    route: "POST /v1/invoices/batch-issue/:requestId/execute",
    params: { requestId: "request_id" },
    summary: () => "Emitir todas las facturas del lote aprobado: cada una recibe su número y queda bloqueada. Es irreversible. ¿Confirmas?",
  }),
  defineRestWrite({
    name: "billing_invoice_create",
    module: "billing",
    scope: "billing.write",
    title: "Crear borrador de factura",
    description: "Crea un borrador de factura desde albaranes, desde un pedido o con líneas manuales; los precios salen de la tarifa del cliente si no se indican. También crea rectificativas (invoice_type R1–R4, rectification_kind, rectifies y reason). Para duplicar una factura, copia cliente y líneas de billing_invoice_get. No numera nada: eso lo hace emitir.",
    input: invoiceCreate,
    route: "POST /v1/invoices",
    web: (_input, body) => {
      const created = textOf(fieldsOf(body).id);
      return created ? `/facturas/${created}` : null;
    },
  }),
  defineRestRead({
    name: "billing_invoice_get",
    module: "billing",
    scope: "billing.read",
    title: "Ficha de la factura",
    description: "La factura tal como la ve la app: estado, número, sociedad, cliente, líneas, impuestos, vencimientos, cobro, anulación y facturas que rectifica.",
    input: z.object({ id }).strict(),
    route: "GET /v1/invoices/:id",
    web: invoiceLink,
  }),
  defineRestRead({
    name: "billing_invoice_pdf_download",
    module: "billing",
    scope: "billing.read",
    title: "Descargar PDF de la factura",
    description: "El PDF de una factura emitida o anulada, el mismo que se ve en la app, en base64. Un borrador no tiene PDF.",
    input: z.object({ id }).strict(),
    route: "GET /v1/invoices/:id/pdf",
    web: invoiceLink,
  }),
  defineRestRead({
    name: "billing_invoice_deliveries_list",
    module: "billing",
    scope: "billing.read",
    title: "Historial de envíos de la factura",
    description: "Cada intento de envío de la factura: destinatarios, estado, identificador del mensaje, error y fechas.",
    input: z.object({ id }).strict(),
    route: "GET /v1/invoices/:id/deliveries",
    web: invoiceLink,
  }),
  defineRestRead({
    name: "billing_invoice_delivery_package_get",
    module: "billing",
    scope: "billing.deliver",
    title: "Preparar el envío de la factura",
    description: "Lo necesario para mandar una factura emitida: PDF en base64, destinatarios, asunto y texto en español, y el número de intento. WineCore no envía correo: el asistente lo manda y luego registra el envío con ese intento.",
    input: z.object({ id }).strict(),
    route: "GET /v1/invoices/:id/delivery",
    web: invoiceLink,
  }),
  defineRestWrite({
    name: "billing_invoice_delivery_record_sent",
    module: "billing",
    scope: "billing.deliver",
    title: "Registrar factura enviada",
    description: "Anota que la factura ya se mandó (intento, identificador del mensaje, fecha y destinatarios). No envía nada: se usa después de mandarla.",
    input: z.object({
      id,
      attempt: z.number().int().min(1).describe("Intento que devolvió billing_invoice_delivery_package_get"),
      message_id: z.string().min(1).max(200).describe("Identificador del correo enviado"),
      sent_at: z.string().min(10).max(40).describe("Fecha y hora del envío, ISO 8601"),
      recipients: z.array(z.string().email()).min(1),
    }).strict(),
    route: "POST /v1/invoices/:id/delivery/sent",
    current: { route: "GET /v1/invoices/:id" },
    summary: (input, current) => `Registrar que ${invoiceLabel(current)} se envió a ${input.recipients.join(", ")} (intento ${input.attempt}). ¿Confirmas?`,
    web: invoiceLink,
  }),
  defineRestWrite({
    name: "billing_invoice_delivery_record_failed",
    module: "billing",
    scope: "billing.deliver",
    title: "Registrar envío fallido",
    description: "Anota que no se pudo mandar la factura en ese intento, con el motivo; la app avisa del fallo. No envía nada.",
    input: z.object({
      id,
      attempt: z.number().int().min(1),
      error: z.string().min(1).max(500).describe("Qué falló, sin datos personales"),
    }).strict(),
    route: "POST /v1/invoices/:id/delivery/failed",
    current: { route: "GET /v1/invoices/:id" },
    summary: (input, current) => `Registrar que el envío ${input.attempt} de ${invoiceLabel(current)} ha fallido. ¿Confirmas?`,
    web: invoiceLink,
  }),
  defineRestWrite({
    name: "billing_invoice_delivery_resend",
    module: "billing",
    scope: "billing.deliver",
    title: "Volver a enviar factura",
    description: "Abre un nuevo intento de envío de una factura emitida (no si ya hay uno pendiente), con los destinatarios actuales del cliente. WineCore no manda el correo: el asistente lo envía después y lo registra.",
    input: z.object({ id }).strict(),
    route: "POST /v1/invoices/:id/delivery/resend",
    current: { route: "GET /v1/invoices/:id" },
    summary: (_input, current) => `Abrir un nuevo envío de ${invoiceLabel(current)} para mandarla otra vez. ¿Confirmas?`,
    web: invoiceLink,
  }),
  defineRestWrite({
    name: "billing_invoice_update",
    module: "billing",
    scope: "billing.write",
    title: "Editar borrador de factura",
    description: "Cambia un borrador (cliente, sociedad, serie, fechas, concepto, idioma, forma y plazo de pago, notas, incoterm o líneas) y recalcula los importes. Solo hace falta mandar lo que cambia; si se mandan líneas, sustituyen a todas. Una factura emitida no se edita: se rectifica.",
    input: z.object({ id, changes: invoiceChanges }).strict(),
    route: "PATCH /v1/invoices/:id",
    current: { route: "GET /v1/invoices/:id" },
    send: (input) => input.changes,
    web: invoiceLink,
  }),
  defineRestRead({
    name: "billing_invoice_validate",
    module: "billing",
    scope: "billing.write",
    title: "Comprobar borrador antes de emitir",
    description: "Revisa un borrador con las reglas de emisión (NIF del cliente, lotes, VIES, serie y numeración del año, fechas, rectificativas) y devuelve errores y avisos sin cambiar nada.",
    input: z.object({ id }).strict(),
    route: "POST /v1/invoices/:id/validate",
    computeOnly: "Solo comprueba el borrador con las reglas de emisión y devuelve errores y avisos; no guarda nada.",
    web: invoiceLink,
  }),
  defineRestWrite({
    name: "billing_invoice_issue",
    module: "billing",
    scope: "billing.issue",
    title: "Emitir factura",
    description: "Emite un borrador: le da el siguiente número de su serie, congela cliente e importes y deja el envío pendiente. Emitir es irreversible: numera la factura y la bloquea; después solo se corrige con una rectificativa o se anula. Si es la primera del año sin serie, antes hay que abrir la numeración (billing_series_open).",
    input: z.object({ id }).strict(),
    route: "POST /v1/invoices/:id/issue",
    current: { route: "GET /v1/invoices/:id" },
    summary: (_input, current) => `Emitir ${invoiceLabel(current)}: recibe número y queda bloqueada. Es irreversible; después solo se corrige con una rectificativa o se anula. ¿Confirmas?`,
    web: invoiceLink,
  }),
  defineRestWrite({
    name: "billing_invoice_void",
    module: "billing",
    scope: "billing.void",
    title: "Anular factura",
    description: "Anula una factura emitida sin cobros por un motivo tasado (duplicada, sociedad equivocada o cliente equivocado sin entrega). La primera vez pide la aprobación (status pending con approval_request_id); aprobada, se repite para anularla. Es irreversible y el número no se reutiliza; para corregir importes, mejor una rectificativa.",
    input: z.object({
      id,
      reason_code: z.enum(["duplicate", "wrong_entity", "wrong_customer"]),
      reason_text: z.string().max(300).optional().describe("Detalle del motivo"),
    }).strict(),
    route: "POST /v1/invoices/:id/void",
    current: { route: "GET /v1/invoices/:id" },
    summary: (input, current) => `Anular ${invoiceLabel(current)} (${VOID_REASONS[input.reason_code]}). Si hace falta, primero queda pendiente de aprobación; una vez anulada no se puede deshacer y su número no se reutiliza. ¿Confirmas?`,
    web: (input, body) => {
      const result = fieldsOf(body);
      const request = result.status === "pending" ? textOf(result.approval_request_id) : null;
      return request ? `/aprobaciones/${request}` : `/facturas/${input.id}`;
    },
  }),
  defineRestWrite({
    name: "billing_invoice_discard",
    module: "billing",
    scope: "billing.write",
    title: "Descartar borrador",
    description: "Descarta un borrador que no se va a emitir. No consume número, pero no se puede recuperar.",
    input: z.object({ id, reason: z.string().max(2000).optional() }).strict(),
    route: "POST /v1/invoices/:id/discard",
    current: { route: "GET /v1/invoices/:id" },
    summary: (_input, current) => `Descartar ${invoiceLabel(current)}. No se puede recuperar. ¿Confirmas?`,
    web: invoiceLink,
  }),

  defineRestRead({
    name: "billing_legacy_overview_get",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read"],
    title: "Resumen del histórico de Holded",
    description: "Las cifras del histórico importado de Holded: ventas de este año y del anterior, pendiente de cobro y de pago, mejores clientes, ventas por mes y últimas facturas.",
    input: z.object({ entity: legacyEntity }).strict(),
    route: "GET /v1/legacy/overview",
  }),
  defineRestRead({
    name: "billing_legacy_invoices_list",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read", "purchasing.read"],
    title: "Facturas históricas de Holded",
    description: "Las facturas de venta o de compra importadas de Holded, de la más reciente a la más antigua, con búsqueda por número o contraparte y paginadas con next_cursor.",
    input: z.object({ kind: z.enum(["sale", "purchase"]).optional().describe("sale ventas (por defecto) o purchase compras"), ...legacyList }).strict(),
    route: "GET /v1/legacy/invoices",
  }),
  defineRestRead({
    name: "billing_legacy_invoice_get",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read", "purchasing.read"],
    title: "Factura histórica de Holded",
    description: "Una factura importada de Holded con sus líneas, importes, cobros y estado.",
    input: z.object({ id }).strict(),
    route: "GET /v1/legacy/invoices/:id",
  }),
  defineRestRead({
    name: "billing_legacy_invoice_pdf_download",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read", "purchasing.read"],
    title: "PDF de factura histórica",
    description: "El PDF de una factura de Holded en base64: el original adjunto si existe o una copia generada con sus datos.",
    input: z.object({ id }).strict(),
    route: "GET /v1/legacy/invoices/:id/pdf",
  }),
  defineRestRead({
    name: "billing_legacy_documents_list",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read"],
    title: "Albaranes y presupuestos históricos",
    description: "Los albaranes o presupuestos importados de Holded, del más reciente al más antiguo, con búsqueda y paginados con next_cursor.",
    input: z.object({ kind: z.enum(["delivery_note", "quote"]).optional().describe("delivery_note albaranes (por defecto) o quote presupuestos"), ...legacyList }).strict(),
    route: "GET /v1/legacy/documents",
  }),
  defineRestRead({
    name: "billing_legacy_document_get",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read"],
    title: "Albarán o presupuesto histórico",
    description: "Un albarán o presupuesto importado de Holded con sus líneas e importes.",
    input: z.object({ id }).strict(),
    route: "GET /v1/legacy/documents/:id",
  }),
  defineRestRead({
    name: "billing_legacy_document_pdf_download",
    module: "billing",
    scope: "reports.read",
    extraScopes: ["finance.read", "sales.read", "billing.read"],
    title: "PDF de albarán o presupuesto histórico",
    description: "El PDF de un albarán o presupuesto de Holded en base64: el original adjunto si existe o una copia generada.",
    input: z.object({ id }).strict(),
    route: "GET /v1/legacy/documents/:id/pdf",
  }),
  defineRestRead({
    name: "billing_legacy_products_list",
    module: "billing",
    scope: "catalog.read",
    extraScopes: ["reports.read", "finance.read", "sales.read"],
    title: "Productos históricos de Holded",
    description: "El catálogo importado de Holded (nombre, SKU, stock, coste, precio, impuesto y almacén), por orden alfabético, con búsqueda por nombre o SKU.",
    input: z.object({ ...legacyList, q: z.string().max(120).optional().describe("Nombre o SKU") }).strict(),
    route: "GET /v1/legacy/products",
  }),

  defineRestRead({
    name: "billing_legal_entities_list",
    module: "billing",
    scope: "settings.manage",
    title: "Sociedades",
    description: "Las sociedades activas que facturan (P.O, CVPO…) con su id, razón social, NIF, dirección fiscal y EORI, como en Ajustes.",
    input: z.object({}).strict(),
    route: "GET /v1/legal-entities",
  }),
  defineRestWrite({
    name: "billing_legal_entities_update",
    module: "billing",
    scope: "settings.manage",
    title: "Editar datos fiscales de la sociedad",
    description: "Cambia la razón social, el NIF, la dirección fiscal o el EORI de una sociedad. Solo hace falta mandar lo que cambia; salen en las facturas que se emitan desde ahora. El EORI no se quita si ya hay exportaciones.",
    input: z.object({
      code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,15}$/).describe("Código de la sociedad: PO, CVPO…"),
      changes: z.object({
        legal_name: z.string().min(2).max(120).optional(),
        tax_id: z.string().min(1).max(20).optional().describe("CIF de la sociedad o NIF/NIE si es persona física"),
        address_line: z.string().min(2).max(120).optional(),
        postal_code: z.string().regex(/^\d{5}$/).optional(),
        city: z.string().min(2).max(80).optional(),
        province: z.string().min(2).max(80).optional(),
        country_code: z.string().regex(/^[A-Za-z]{2}$/).optional(),
        eori: z.string().max(40).nullable().optional().describe("null para quitarlo"),
      }).strict(),
    }).strict(),
    route: "PATCH /v1/legal-entities/:code",
    send: (input) => input.changes,
    summary: (input) => `Cambiar ${Object.keys(input.changes).join(", ") || "los datos"} de la sociedad ${input.code.toUpperCase()}. Saldrá así en las facturas que se emitan desde ahora; las ya emitidas no cambian. ¿Confirmas?`,
  }),

  defineRestRead({
    name: "billing_series_list",
    module: "billing",
    scope: "settings.manage",
    title: "Series de numeración",
    description: "Las series de numeración de facturas y documentos (sociedad, tipo, código, año, prefijo, siguiente número, por defecto, activa), como en Ajustes.",
    input: z.object({ legal_entity_id: id.optional(), doc_type: docType.optional(), year: year.optional() }).strict(),
    route: "GET /v1/number-series",
  }),
  defineRestRead({
    name: "billing_series_proposal_get",
    module: "billing",
    scope: "settings.manage",
    title: "Propuesta de numeración del año",
    description: "Para la primera factura del año de una sociedad: la serie activa si ya la hay, la serie nueva del plan y, en facturas, cómo seguir la numeración de Holded. Sirve para elegir antes de billing_series_open.",
    input: z.object({ legal_entity_id: id, doc_type: docType, year }).strict(),
    route: "GET /v1/number-series/proposal",
  }),
  defineRestWrite({
    name: "billing_series_open",
    module: "billing",
    scope: "settings.manage",
    title: "Abrir la numeración del año",
    description: "Abre la serie por defecto de una sociedad, tipo de documento y año: fresh empieza la serie nueva del plan; holded sigue la numeración de Holded. Si ya hay una activa, se queda esa. Los números emitidos con ella no se cambian después.",
    input: z.object({
      legal_entity_id: id,
      doc_type: docType,
      year,
      choice: z.enum(["fresh", "holded"]),
      next_value: z.number().int().min(1).optional().describe("Corrige el primer número propuesto"),
    }).strict(),
    route: "POST /v1/number-series/open",
    summary: (input) => `Abrir la numeración de ${input.doc_type} ${input.year} ${input.choice === "holded" ? "siguiendo la de Holded" : "con una serie nueva"}. Los números que se emitan con ella no se pueden cambiar. ¿Confirmas?`,
  }),
  defineRestWrite({
    name: "billing_series_create",
    module: "billing",
    scope: "settings.manage",
    title: "Crear serie de numeración",
    description: "Da de alta una serie. La primera de un código puede indicar el año; las siguientes solo abren el año posterior al último, copiando prefijo (con el año cambiado), relleno y opciones. No puede repetir prefijo ni pisar números de Holded.",
    input: z.object({
      legal_entity_id: id,
      doc_type: docType,
      code: z.string().regex(/^[A-Z]{1,4}$/).describe("De 1 a 4 letras mayúsculas, p. ej. FA"),
      prefix: z.string().min(1).max(12).optional().describe("P. ej. FA26-; ASCII sin comillas, < > ni ="),
      padding: z.number().int().min(2).max(8).optional().describe("Cifras del contador"),
      year: year.optional(),
      next_value: z.number().int().min(1).max(99_999_999).optional().describe("Primer número"),
      is_default: z.boolean().optional(),
      verifactu: z.boolean().optional(),
    }).strict(),
    route: "POST /v1/number-series",
  }),
  defineRestWrite({
    name: "billing_series_deactivate",
    module: "billing",
    scope: "settings.manage",
    title: "Desactivar serie",
    description: "Desactiva una serie (el id sale en billing_series_list): deja de numerar documentos y pierde el «por defecto». No se borra y sus números siguen siendo válidos.",
    input: z.object({ id }).strict(),
    route: "POST /v1/number-series/:id/deactivate",
    summary: () => "Desactivar la serie: deja de numerar documentos. No se borra. ¿Confirmas?",
  }),
  defineRestWrite({
    name: "billing_series_bulk_create",
    module: "billing",
    scope: "settings.manage",
    title: "Abrir varias series a la vez",
    description: "Deja activas hasta 64 series (sociedad, tipo y año) de una vez, como en la puesta en marcha. Las que ya tienen una activa se saltan y las inactivas con el mismo código se reactivan.",
    input: z.object({
      items: z.array(z.object({
        legal_entity_id: id,
        doc_type: docType,
        code: z.string().regex(/^[A-Z]{1,4}$/),
        year,
        prefix: z.string().min(1).max(12),
        padding: z.number().int().min(2).max(8).optional().describe("Por defecto 4"),
        next_value: z.number().int().min(1).optional().describe("Por defecto 1"),
        is_default: z.boolean().optional().describe("Por defecto sí"),
        verifactu: z.boolean().optional().describe("Por defecto no"),
      }).strict()).min(1).max(64),
    }).strict(),
    route: "POST /v1/number-series/bulk",
  }),
];
