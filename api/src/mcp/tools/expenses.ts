import { z } from "zod";

import { defineRestRead, defineRestWrite } from "../rest";

export const purchasingExpensesList = defineRestRead({
  name: "purchasing_expenses_list",
  module: "purchasing",
  scope: "purchasing.read",
  title: "Gastos",
  description: "La lista de Gastos (facturas de proveedor y tickets) con los filtros de la app: estado, sociedad, mes, categoría y búsqueda por proveedor, NIF o número. Paginada con next_cursor.",
  input: z.object({
    status: z.enum(["captured", "validated", "approved", "rejected", "duplicate"]).optional()
      .describe("captured = pendiente de revisar, validated = lista para aprobar"),
    entity: z.enum(["PO", "CVPO"]).optional().describe("Solo los gastos de esa sociedad"),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("Mes de la factura, AAAA-MM"),
    category: z.string().regex(/^[a-z_]{2,30}$/).optional().describe("Código de purchasing_expense_categories_list"),
    q: z.string().max(80).optional().describe("Proveedor, NIF o número de factura"),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(200).optional(),
  }).strict(),
  route: "GET /v1/supplier-invoices",
  web: () => "/gastos",
});

export const purchasingExpenseUpload = defineRestWrite({
  name: "purchasing_expense_upload",
  module: "purchasing",
  scope: "purchasing.write",
  title: "Capturar gasto",
  description: "Sube la foto de un ticket o el PDF o XML (Facturae) de una factura de proveedor, como Capturar en Gastos: la app lee proveedor, número, fechas, importes y líneas, y el gasto queda capturado para revisarlo y validarlo.",
  input: z.object({
    file_base64: z.string().min(1).describe("El fichero en base64 (máx. 10 MB)"),
    filename: z.string().trim().min(1).max(180),
    content_type: z.string().trim().min(1).max(100).describe("image/jpeg, image/png, image/heic, application/pdf o application/xml"),
    entity: z.enum(["PO", "CVPO"]).optional().describe("Sociedad que recibe la factura; si falta, la deduce del NIF del comprador"),
    source: z.enum(["photo", "upload", "email_forward"]).optional().describe("Por defecto, photo para imágenes y upload para el resto"),
    notes: z.string().max(2000).optional(),
  }).strict(),
  route: "POST /v1/supplier-invoices/capture",
  upload: { field: "file", formFields: ["entity", "source", "notes"] },
  summary: (input) => `Capturar el gasto ${input.filename}${input.entity ? ` para ${input.entity}` : ""}. ¿Confirmas?`,
  web: (_input, body) => {
    const created = typeof body === "object" && body !== null ? (body as { id?: unknown }).id : null;
    return typeof created === "string" ? `/gastos/${created}` : "/gastos";
  },
});
