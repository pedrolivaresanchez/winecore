import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD");
const amount = z.union([z.number(), z.string().trim().min(1).max(24)]).describe("Importe en euros, p. ej. \"48.00\"");

const expenseLine = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: amount.optional().describe("Cantidad; 1 por defecto"),
  unit_price: amount.optional().describe("Precio unitario; por defecto, la base de la línea"),
  line_base: amount.describe("Base imponible de la línea"),
  vat_rate: amount.describe("Tipo de IVA en %, p. ej. 21"),
  vat_quota: amount.describe("Cuota de IVA de la línea"),
  withholding_rate: amount.optional().describe("Retención en %; 0 por defecto"),
  vat_deductible_pct: amount.optional().describe("IVA deducible en %, de 0 a 100; 100 por defecto"),
  expense_account: z.string().regex(/^6[0-9]{2,7}$/).optional().describe("Cuenta de gasto del grupo 6; por defecto, la de la categoría"),
}).strict();

const expenseChanges = z.object({
  supplier_id: id.optional().describe("Contacto proveedor (búscalo con contacts_search)"),
  supplier_invoice_number: z.string().trim().min(1).max(60).optional().describe("Número de la factura del proveedor"),
  issue_date: date.optional().describe("Fecha de expedición, AAAA-MM-DD"),
  accounting_date: date.optional().describe("Fecha contable, AAAA-MM-DD"),
  due_date: date.nullable().optional().describe("Vencimiento, AAAA-MM-DD; null para quitarlo"),
  category_code: z.string().trim().min(1).max(40).optional().describe("Código de purchasing_expense_categories_list"),
  subtotal: amount.optional(),
  tax_total: amount.optional(),
  withholding_total: amount.optional(),
  total: amount.optional(),
  payment_method: z.enum(["transfer", "direct_debit", "card", "cash", "other"]).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(expenseLine).min(1).optional().describe("Todas las líneas del gasto: sustituyen a las actuales"),
}).strict();

type Fields = Record<string, unknown>;

const CHANGE_LABELS: Record<keyof z.infer<typeof expenseChanges>, string> = {
  supplier_id: "proveedor",
  supplier_invoice_number: "número",
  issue_date: "fecha de expedición",
  accounting_date: "fecha contable",
  due_date: "vencimiento",
  category_code: "categoría",
  subtotal: "base",
  tax_total: "IVA",
  withholding_total: "retención",
  total: "total",
  payment_method: "forma de pago",
  notes: "notas",
  lines: "líneas",
};

function recordOf(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : {};
}

function expenseLabel(current: unknown): string {
  const expense = recordOf(current);
  const number = typeof expense.supplier_invoice_number === "string" ? expense.supplier_invoice_number : "sin número";
  const supplier = typeof expense.supplier_name === "string" ? ` de ${expense.supplier_name}` : "";
  const total = typeof expense.total === "string" ? ` por ${expense.total} €` : "";
  return `la factura ${number}${supplier}${total}`;
}

const expenseLink = (input: { id: string }) => `/gastos/${input.id}`;

export const purchasingRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "purchasing_expense_categories_list",
    module: "purchasing",
    scope: "purchasing.read",
    title: "Categorías de gasto",
    description: "Las categorías de gasto activas (uva, granel, enológicos, envases, transporte…) con su cuenta contable por defecto. Su código es el que se pone en un gasto.",
    input: z.object({}).strict(),
    route: "GET /v1/expense-categories",
  }),
  defineRestRead({
    name: "purchasing_expenses_export_csv",
    module: "purchasing",
    scope: "purchasing.read",
    title: "Libro de facturas recibidas (CSV)",
    description: "El libro de facturas recibidas de un trimestre y una sociedad, el CSV que descarga la app en Gastos. Devuelve el texto del fichero.",
    input: z.object({
      entity: z.enum(["PO", "CVPO"]).describe("Sociedad"),
      period: z.string().regex(/^\d{4}-?[TtQq][1-4]$/).describe("Trimestre, p. ej. 2027-T1"),
    }).strict(),
    route: "GET /v1/supplier-invoices/export",
    web: () => "/gastos",
  }),
  defineRestRead({
    name: "purchasing_expense_get",
    module: "purchasing",
    scope: "purchasing.read",
    title: "Ficha del gasto",
    description: "Un gasto (factura de proveedor o ticket) como lo ve la app: proveedor, fechas, categoría, importes, líneas, avisos de la lectura, estado y el id del documento escaneado.",
    input: z.object({ id }).strict(),
    route: "GET /v1/supplier-invoices/:id",
    web: expenseLink,
  }),
  defineRestWrite({
    name: "purchasing_expense_update",
    module: "purchasing",
    scope: "purchasing.write",
    title: "Corregir gasto",
    description: "Corrige los datos de un gasto capturado o validado: proveedor, número, fechas, categoría, importes, forma de pago, notas o líneas. Solo hace falta mandar lo que cambia; las líneas, si se mandan, van todas. Un gasto validado vuelve a capturado y hay que validarlo otra vez.",
    input: z.object({ id, changes: expenseChanges }).strict(),
    route: "PATCH /v1/supplier-invoices/:id",
    current: { route: "GET /v1/supplier-invoices/:id" },
    send: (input) => input.changes,
    summary: (input, current) => {
      const fields = (Object.keys(input.changes) as (keyof typeof CHANGE_LABELS)[]).map((key) => CHANGE_LABELS[key]);
      const revalidate = recordOf(current).status === "validated" ? " Volverá a quedar pendiente de validar." : "";
      return `Corregir ${expenseLabel(current)}: ${fields.join(", ") || "sin cambios"}.${revalidate} ¿Confirmas?`;
    },
    web: expenseLink,
  }),
  defineRestWrite({
    name: "purchasing_expense_validate",
    module: "purchasing",
    scope: "purchasing.write",
    title: "Validar gasto",
    description: "Da por buenos los datos de un gasto capturado: comprueba proveedor, número, fecha, categoría y que las líneas cuadran con el total. Si ya existe la misma factura, queda marcada como duplicada.",
    input: z.object({ id }).strict(),
    route: "POST /v1/supplier-invoices/:id/validate",
    current: { route: "GET /v1/supplier-invoices/:id" },
    summary: (_input, current) => `Validar ${expenseLabel(current)}: queda lista para aprobar. ¿Confirmas?`,
    web: expenseLink,
  }),
  defineRestWrite({
    name: "purchasing_expense_approval_request",
    module: "purchasing",
    scope: "purchasing.write",
    title: "Pedir aprobación del gasto",
    description: "Para quien no puede aprobar gastos: manda un gasto validado a la bandeja de aprobaciones. Cuando un aprobador lo acepta, el gasto queda aprobado.",
    input: z.object({ id }).strict(),
    route: "POST /v1/supplier-invoices/:id/request-approval",
    current: { route: "GET /v1/supplier-invoices/:id" },
    summary: (_input, current) => `Pedir aprobación de ${expenseLabel(current)}: se crea una solicitud en la bandeja de aprobaciones. ¿Confirmas?`,
    web: (input, body) => {
      const request = recordOf(body).approval_request_id;
      return typeof request === "string" ? `/aprobaciones/${request}` : expenseLink(input);
    },
  }),
  defineRestWrite({
    name: "purchasing_expense_approve",
    module: "purchasing",
    scope: "purchasing.approve",
    title: "Aprobar gasto",
    description: "Aprueba un gasto validado, con el permiso de aprobar gastos: pasa al libro de recibidas y ya no se puede editar. Sin ese permiso, usa purchasing_expense_approval_request.",
    input: z.object({ id }).strict(),
    route: "POST /v1/supplier-invoices/:id/approve",
    current: { route: "GET /v1/supplier-invoices/:id" },
    summary: (_input, current) => `Aprobar ${expenseLabel(current)}: entra en el libro de recibidas y ya no se podrá editar. ¿Confirmas?`,
    web: expenseLink,
  }),
  defineRestWrite({
    name: "purchasing_expense_reject",
    module: "purchasing",
    scope: "purchasing.write",
    title: "Rechazar gasto",
    description: "Rechaza un gasto capturado o validado (no es del negocio, está mal, es de otra sociedad…) con un motivo. No se borra: queda rechazado con su documento.",
    input: z.object({
      id,
      reason: z.string().trim().min(3).max(500).describe("Motivo del rechazo"),
    }).strict(),
    route: "POST /v1/supplier-invoices/:id/reject",
    current: { route: "GET /v1/supplier-invoices/:id" },
    summary: (input, current) => `Rechazar ${expenseLabel(current)} con el motivo «${input.reason}». ¿Confirmas?`,
    web: expenseLink,
  }),
];
