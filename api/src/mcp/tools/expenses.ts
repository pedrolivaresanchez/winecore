import { z } from "zod";

import { can } from "../../core/auth/permissions";
import { domainError } from "../../core/errors";
import { createHash } from "node:crypto";
import { noopApprovalHook } from "../../core/purchasing/approval";
import { detectMime } from "../../core/attachments/mime";
import { approveInvoice, captureInvoice, getInvoice, listInvoices } from "../../core/purchasing/invoice";
import { ocrFromEnv } from "../../core/purchasing/timbal";
import { defineReadTool, defineWriteTool } from "../registry";
import { actorOf, requireWriter, viewerOf } from "../runtime";

const uploadInput = z.object({
  filename: z.string().trim().min(1).max(180).optional(),
  content_base64: z.string().min(1),
  entity: z.string().trim().min(1).max(40).optional(),
});

interface UploadPayload {
  filename: string;
  content_base64: string;
  entity: string | null;
  sha256: string;
}

export const purchasingExpensesList = defineReadTool({
  name: "purchasing_expenses_list",
  module: "purchasing",
  scope: "purchasing.read",
  title: "Gastos",
  description: "Lista facturas recibidas y tickets capturados.",
  input: z.object({
    entity: z.string().optional(),
    status: z.enum(["captured", "validated", "approved", "rejected", "duplicate"]).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().optional(),
  }),
  handler: async (ctx, input) => {
    const url = new URL("http://localhost/v1/supplier-invoices");
    if (input.entity) url.searchParams.set("entity", input.entity);
    if (input.status) url.searchParams.set("status", input.status);
    if (input.cursor) url.searchParams.set("cursor", input.cursor);
    if (input.limit !== undefined) url.searchParams.set("limit", String(input.limit));
    return listInvoices(requireWriter(ctx), viewerOf(ctx), url);
  },
});

export const purchasingExpenseUpload = defineWriteTool({
  name: "purchasing_expense_upload",
  module: "purchasing",
  scope: "purchasing.write",
  title: "Capturar gasto",
  description: "Prepara una foto o un PDF y, al confirmar, lo entrega al servicio de captura.",
  input: uploadInput,
  prepare: (_ctx, input) => {
    const file = decodeFile(input.content_base64, input.filename);
    const payload: UploadPayload = {
      filename: file.filename,
      content_base64: input.content_base64,
      entity: input.entity ?? null,
      sha256: digest(file.bytes),
    };
    return {
      summary_es: `Capturar ${file.filename} (${file.bytes.byteLength} bytes)`,
      preview: {
        filename: file.filename,
        mime: file.mime,
        bytes: file.bytes.byteLength,
        sha256: payload.sha256,
      },
      payload,
    };
  },
  commit: async (ctx, payload) => {
    const user = viewerOf(ctx);
    if (!can(user, "purchasing.write")) throw domainError("WC_FORBIDDEN");
    const file = decodeFile(payload.content_base64, payload.filename);
    if (digest(file.bytes) !== payload.sha256) {
      throw domainError("WC_MCP_PREVIEW_STALE");
    }
    const result = await captureInvoice(
      requireWriter(ctx),
      actorOf(ctx, "Captura de gasto"),
      user,
      {
        bytes: file.bytes,
        filename: file.filename,
        entityRef: payload.entity,
        source: file.mime.startsWith("image/") ? "photo" : "upload",
        notes: null,
        extraction: null,
        idempotencyKey: payload.sha256.slice(0, 80),
        requestHash: createHash("sha256").update(Buffer.from(payload.content_base64)).digest("hex"),
      },
      ocrFromEnv(),
    );
    return { status: result.status, expense: result.body };
  },
});

const approveInput = z.object({
  expense_id: z.string().uuid(),
});

interface ApprovePayload {
  expense_id: string;
  updated_at: string;
}

export const purchasingExpenseApprove = defineWriteTool({
  name: "purchasing_expense_approve",
  module: "purchasing",
  scope: "purchasing.approve",
  title: "Aprobar gasto",
  description: "Pide la aprobación de un gasto en nombre de la persona representada.",
  input: approveInput,
  prepare: async (ctx, input) => {
    const user = viewerOf(ctx);
    if (!can(user, "purchasing.approve")) throw domainError("WC_FORBIDDEN");
    const current = await getInvoice(requireWriter(ctx), user, input.expense_id);
    const payload: ApprovePayload = { expense_id: input.expense_id, updated_at: current.updated_at };
    return {
      summary_es: `Aprobar gasto ${current.supplier_invoice_number ?? input.expense_id}`,
      preview: {
        id: current.id,
        status: current.status,
        total: current.total,
        supplier: current.supplier_name,
      },
      payload,
    };
  },
  commit: async (ctx, payload) => {
    const user = viewerOf(ctx);
    if (!can(user, "purchasing.approve")) throw domainError("WC_FORBIDDEN");
    return approveInvoice(
      requireWriter(ctx),
      actorOf(ctx, "Aprobación de gasto"),
      user,
      payload.expense_id,
      payload.updated_at,
      noopApprovalHook,
    );
  },
});

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeFile(contentBase64: string, filename: string | undefined): {
  bytes: Uint8Array;
  filename: string;
  mime: string;
} {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(contentBase64)) {
    throw domainError("WC_VALIDATION", { content_base64: "El fichero no es base64" });
  }
  const bytes = Uint8Array.from(Buffer.from(contentBase64.replace(/\s+/g, ""), "base64"));
  if (bytes.byteLength === 0) throw domainError("WC_VALIDATION", { content_base64: "El fichero está vacío" });
  const mime = detectMime(bytes);
  if (!mime) throw domainError("WC_VALIDATION", { content_base64: "Tipo de fichero no admitido" });
  const fallback = mime === "application/pdf" ? "gasto.pdf" : "gasto.jpg";
  return { bytes, mime, filename: filename?.trim() || fallback };
}
