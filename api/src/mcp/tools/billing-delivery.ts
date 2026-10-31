import { z } from "zod";

import {
  billingInvoiceDeliveryMarkFailed,
  billingInvoiceDeliveryMarkSent,
  billingInvoicePdfGet,
  billingInvoicesPendingDeliveryList,
} from "../../core/billing/delivery/mcp-tools";
import { defineDirectWrite, defineReadTool } from "../registry";
import { actorOf, requireWriter } from "../runtime";

function deliveryContext(ctx: Parameters<typeof actorOf>[0]) {
  const actor = actorOf(ctx, "Entrega de factura");
  return {
    writer: requireWriter(ctx),
    actorId: actor.onBehalfOf ?? actor.id,
    actorType: actor.type === "user" ? "user" as const : "machine" as const,
    permissions: new Set(ctx.behalfGrants ?? ctx.client.scopes),
    now: ctx.now,
  };
}

export const billingInvoicesPendingDeliveryListTool = defineReadTool({
  name: "billing_invoices_pending_delivery_list",
  module: "billing",
  scope: "billing.read",
  title: "Facturas pendientes de entrega",
  description: "Lista facturas emitidas que CVBOT aún no ha marcado como enviadas.",
  input: z.object({
    entity: z.string().uuid().optional(),
    older_than_hours: z.number().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  handler: (ctx, input) => billingInvoicesPendingDeliveryList(deliveryContext(ctx), input),
});

export const billingInvoicePdfGetTool = defineReadTool({
  name: "billing_invoice_pdf_get",
  module: "billing",
  scope: "billing.read",
  title: "PDF de factura",
  description: "Devuelve el PDF y el texto para que CVBOT lo envíe desde Outlook. WineCore no envía correo.",
  input: z.object({ invoice_id: z.string().uuid() }),
  handler: (ctx, input) => billingInvoicePdfGet(deliveryContext(ctx), input),
});

export const billingInvoiceDeliveryMarkSentTool = defineDirectWrite({
  name: "billing_invoice_delivery_mark_sent",
  module: "billing",
  scope: "billing.deliver",
  title: "Marcar factura enviada",
  description: "Registra que CVBOT ya envió la factura. No envía correo.",
  input: z.object({
    invoice_id: z.string().uuid(),
    attempt: z.number().int(),
    message_id: z.string().min(1),
    sent_at: z.string().min(1),
    recipients: z.array(z.string()),
  }),
  handler: (ctx, input) => billingInvoiceDeliveryMarkSent(deliveryContext(ctx), input),
});

export const billingInvoiceDeliveryMarkFailedTool = defineDirectWrite({
  name: "billing_invoice_delivery_mark_failed",
  module: "billing",
  scope: "billing.deliver",
  title: "Marcar entrega fallida",
  description: "Registra que CVBOT no pudo enviar la factura. No envía correo.",
  input: z.object({
    invoice_id: z.string().uuid(),
    attempt: z.number().int(),
    error: z.string().min(1),
  }),
  handler: (ctx, input) => billingInvoiceDeliveryMarkFailed(deliveryContext(ctx), input),
});
