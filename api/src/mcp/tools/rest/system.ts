import { z } from "zod";

import { APPROVAL_KINDS } from "../../../core/approvals/types";
import { ATTACHMENT_ROLES } from "../../../core/attachments/store";
import { GROUP_BY } from "../../../core/reports/types";
import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entityFilter = z.enum(["PO", "CVPO", "both"]).optional().describe("PO, CVPO o both (las dos, por defecto)");

const reportQuery = z.object({
  from: date.describe("Primer día, AAAA-MM-DD"),
  to: date.describe("Último día, AAAA-MM-DD (hasta 10 años después de from)"),
  group_by: z.enum(GROUP_BY).optional().describe("Agrupación de la serie; month por defecto"),
  compare: z.literal("previous_year").optional().describe("Añade el mismo periodo del año anterior"),
  entity: entityFilter,
}).strict();

const attachmentTable = z.string().regex(/^[a-z_]+\.[a-z_]+$/).describe("Tabla del registro, p. ej. purchasing.supplier_invoice o party.contact");

const STEP_UP_NOTE = "Si el propietario exige passkey o código para aprobar, la API lo rechaza (WC_STEP_UP_REQUIRED) y hay que hacerlo en la app.";

type Fields = Record<string, unknown>;

function recordOf(value: unknown): Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Fields : {};
}

function approvalLabel(current: unknown): string {
  const approval = recordOf(current);
  const title = typeof approval.title === "string" ? approval.title : "Solicitud";
  const summary = typeof approval.summary === "string" && approval.summary !== "" ? `: ${approval.summary}` : "";
  const entity = typeof approval.legal_entity_code === "string" ? ` (${approval.legal_entity_code})` : "";
  return `«${title}${summary}»${entity}`;
}

function cannotDecide(current: unknown): string {
  const approval = recordOf(current);
  return approval.can_decide === false && typeof approval.reason_cannot_decide === "string"
    ? ` Ojo: ${approval.reason_cannot_decide}.`
    : "";
}

function payloadHash(current: unknown): unknown {
  return recordOf(current).payload_sha256;
}

const approvalLink = (input: { id: string }) => `/aprobaciones/${input.id}`;

export const systemRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "approvals_requests_list",
    module: "core",
    scope: "read:*",
    title: "Bandeja de aprobaciones",
    description: "Las solicitudes de aprobación que la persona puede ver (pendientes por defecto, o decididas o todas), con su resumen, quién la pidió, cuándo caduca, cuántas aprobaciones lleva y si puede decidirla (can_decide).",
    input: z.object({
      status: z.enum(["pending", "decided", "all"]).optional(),
      kind: z.enum(APPROVAL_KINDS).optional().describe("Tipo de solicitud"),
      entity: z.enum(["PO", "CVPO"]).optional().describe("Solo las de esa sociedad"),
      mine: z.boolean().optional().describe("true para ver solo las que pidió la persona"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/approvals",
    web: () => "/aprobaciones",
  }),
  defineRestRead({
    name: "approvals_request_get",
    module: "core",
    scope: "read:*",
    title: "Solicitud de aprobación",
    description: "Una solicitud de aprobación con el detalle de lo que se aprueba, las decisiones ya tomadas y si la persona puede decidirla y, si no, por qué.",
    input: z.object({ id }).strict(),
    route: "GET /v1/approvals/:id",
    web: approvalLink,
  }),
  defineRestWrite({
    name: "approvals_request_approve",
    module: "core",
    scope: "write:*",
    title: "Aprobar solicitud",
    description: `Aprueba una solicitud de la bandeja con la firma de la persona. Con las aprobaciones necesarias, la app ejecuta lo aprobado (por ejemplo, un gasto queda aprobado). ${STEP_UP_NOTE}`,
    input: z.object({
      id,
      note: z.string().trim().max(500).optional().describe("Comentario opcional"),
    }).strict(),
    extraScopes: ["approve:*"],
    route: "POST /v1/approvals/:id/decide",
    current: { route: "GET /v1/approvals/:id" },
    send: (input, current) => ({ decision: "approve", payload_sha256: payloadHash(current), note: input.note }),
    summary: (_input, current) => `Aprobar la solicitud ${approvalLabel(current)} con tu firma.${cannotDecide(current)} ¿Confirmas?`,
    web: approvalLink,
  }),
  defineRestWrite({
    name: "approvals_request_reject",
    module: "core",
    scope: "write:*",
    title: "Rechazar solicitud",
    description: `Rechaza una solicitud de la bandeja con un motivo; lo pedido no se ejecuta. ${STEP_UP_NOTE}`,
    input: z.object({
      id,
      reason: z.string().trim().min(10).max(500).describe("Motivo del rechazo, de 10 a 500 caracteres"),
    }).strict(),
    extraScopes: ["approve:*"],
    route: "POST /v1/approvals/:id/decide",
    current: { route: "GET /v1/approvals/:id" },
    send: (input, current) => ({ decision: "reject", payload_sha256: payloadHash(current), note: input.reason }),
    summary: (input, current) => `Rechazar la solicitud ${approvalLabel(current)} con el motivo «${input.reason}».${cannotDecide(current)} ¿Confirmas?`,
    web: approvalLink,
  }),
  defineRestRead({
    name: "approvals_policies_list",
    module: "core",
    scope: "settings.manage",
    title: "Reglas de aprobación",
    description: "Para cada tipo de solicitud: quién puede aprobar, cuántas aprobaciones hacen falta, si pide passkey, cuántas horas vale y si el solicitante puede aprobarse a sí mismo. Solo el propietario.",
    input: z.object({}).strict(),
    route: "GET /v1/approval-policies",
  }),
  defineRestRead({
    name: "approvals_settings_get",
    module: "core",
    scope: "settings.manage",
    title: "Passkey para aprobar",
    description: "Si el propietario exige passkey o código para aprobar (Ajustes → Seguridad). Solo el propietario.",
    input: z.object({}).strict(),
    route: "GET /v1/approval-settings",
  }),
  defineRestRead({
    name: "dashboard_panel_get",
    module: "core",
    scope: "read:*",
    title: "Panel de inicio",
    description: "Los indicadores del Panel: aprobaciones pendientes, vencimientos de los próximos 30 días, cobros vencidos, avisos, cifras del año, Veri*factu pendiente, envíos fallidos y alertas de bodega y de existencias. Cada bloque sale solo si la persona tiene permiso.",
    input: z.object({ entity: entityFilter }).strict(),
    route: "GET /v1/dashboard",
    web: () => "/",
  }),
  defineRestRead({
    name: "reports_sales_get",
    module: "core",
    scope: "reports.read",
    title: "Informe de ventas",
    description: "Ventas de un periodo (facturas emitidas no anuladas más el histórico de Holded): totales y serie agrupada por mes, año, vino, producto, lote o cliente, con comparación opcional con el año anterior.",
    input: reportQuery,
    route: "GET /v1/reports/sales",
    web: () => "/informes",
  }),
  defineRestRead({
    name: "reports_sales_export_csv",
    module: "core",
    scope: "reports.read",
    title: "Informe de ventas (CSV)",
    description: "El CSV del informe de ventas que descarga la app, con los mismos filtros. Devuelve el texto del fichero.",
    input: reportQuery,
    route: "GET /v1/reports/sales.csv",
    web: () => "/informes",
  }),
  defineRestRead({
    name: "reports_expenses_get",
    module: "core",
    scope: "reports.read",
    title: "Informe de gastos",
    description: "Gastos de un periodo (facturas de proveedor aprobadas, por fecha contable): totales y serie agrupada por mes, año o categoría, con comparación opcional con el año anterior.",
    input: reportQuery,
    route: "GET /v1/reports/expenses",
    web: () => "/informes",
  }),
  defineRestRead({
    name: "reports_expenses_export_csv",
    module: "core",
    scope: "reports.read",
    title: "Informe de gastos (CSV)",
    description: "El CSV del informe de gastos que descarga la app, con los mismos filtros. Devuelve el texto del fichero.",
    input: reportQuery,
    route: "GET /v1/reports/expenses.csv",
    web: () => "/informes",
  }),
  defineRestRead({
    name: "reports_stock_get",
    module: "core",
    scope: "reports.read",
    title: "Informe de existencias",
    description: "Existencias en cada fecha de corte del periodo (fin de mes, de año o la fecha final): unidades y litros agrupados por producto, vino, lote o mes, con comparación opcional con el año anterior.",
    input: reportQuery,
    route: "GET /v1/reports/stock",
    web: () => "/informes",
  }),
  defineRestRead({
    name: "reports_stock_export_csv",
    module: "core",
    scope: "reports.read",
    title: "Informe de existencias (CSV)",
    description: "El CSV del informe de existencias que descarga la app, con los mismos filtros. Devuelve el texto del fichero.",
    input: reportQuery,
    route: "GET /v1/reports/stock.csv",
    web: () => "/informes",
  }),
  defineRestRead({
    name: "system_audit_list",
    module: "core",
    scope: "audit.read",
    title: "Historial de cambios",
    description: "El registro de auditoría: quién cambió qué y cuándo (persona o agente, en nombre de quién, campos antes y después), del más reciente al más antiguo. Se puede filtrar por tabla y por registro.",
    input: z.object({
      table: z.string().trim().max(200).optional().describe("Tabla, p. ej. billing.invoice o purchasing.supplier_invoice"),
      row_id: z.string().trim().max(200).optional().describe("Id del registro"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().regex(/^\d{1,18}$/).optional(),
    }).strict(),
    route: "GET /v1/audit",
  }),
  defineRestRead({
    name: "system_audit_verify",
    module: "core",
    scope: "settings.manage",
    title: "Comprobar el registro de auditoría",
    description: "Recalcula la cadena de huellas del registro de auditoría y dice si está intacta o desde qué apunte se ha roto. Solo el propietario.",
    input: z.object({}).strict(),
    route: "POST /v1/audit/verify",
    computeOnly: "Solo recalcula las huellas del registro de auditoría y dice si la cadena está intacta; no guarda nada.",
  }),
  defineRestRead({
    name: "system_setup_readiness_get",
    module: "core",
    scope: "settings.manage",
    title: "Puesta en marcha",
    description: "La lista de comprobación de la puesta en marcha, por módulos: qué falta o conviene revisar (datos de las sociedades y de los contactos, series de numeración, bancos, tarifas, depósitos, aforo inicial, ejercicios, passkey…) y cuántas cosas quedan pendientes.",
    input: z.object({}).strict(),
    route: "GET /v1/setup/readiness",
  }),
  defineRestRead({
    name: "system_attachments_list",
    module: "core",
    scope: "read:*",
    title: "Adjuntos de un registro",
    description: "Los ficheros adjuntos de un registro (factura, gasto, contacto, operación…) con su id, nombre, tipo y papel. Hace falta permiso de lectura sobre el registro.",
    input: z.object({ table: attachmentTable, row_id: id }).strict(),
    route: "GET /v1/attachments",
  }),
  defineRestRead({
    name: "system_attachment_download",
    module: "core",
    scope: "read:*",
    title: "Descargar adjunto",
    description: "Descarga un adjunto por su id (sale en system_attachments_list o en la ficha del registro). Devuelve el fichero en base64 o, si es texto, su contenido.",
    input: z.object({ id }).strict(),
    route: "GET /v1/attachments/:id",
  }),
  defineRestWrite({
    name: "system_attachment_upload",
    module: "core",
    scope: "write:*",
    title: "Adjuntar fichero",
    description: "Adjunta un fichero (contrato, foto, boletín, etiqueta…) a un registro. Hace falta permiso de escritura sobre el registro.",
    input: z.object({
      table: attachmentTable,
      row_id: id,
      role: z.enum(ATTACHMENT_ROLES).describe("Papel del fichero: contract, photo, lab_report, label_artwork, other…"),
      file_base64: z.string().min(1).describe("El fichero en base64 (máx. 10 MB)"),
      filename: z.string().trim().min(1).max(180),
      content_type: z.string().trim().min(1).max(100).describe("Tipo MIME, p. ej. application/pdf o image/jpeg"),
    }).strict(),
    route: "POST /v1/attachments",
    upload: { field: "file", formFields: ["table", "row_id", "role"] },
    summary: (input) => `Adjuntar ${input.filename} (${input.role}) a ${input.table} ${input.row_id}. ¿Confirmas?`,
  }),
  defineRestRead({
    name: "system_notifications_list",
    module: "core",
    scope: "read:*",
    title: "Avisos",
    description: "Los avisos de la persona (la campana de la app), del más reciente al más antiguo, con su enlace. Se pueden pedir solo los no leídos.",
    input: z.object({
      unread: z.boolean().optional().describe("true: solo no leídos; false: solo leídos"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/notifications",
  }),
  defineRestWrite({
    name: "system_notification_mark_read",
    module: "core",
    scope: "write:*",
    title: "Marcar aviso como leído",
    description: "Marca como leído un aviso de la persona (el id sale en system_notifications_list).",
    input: z.object({ id }).strict(),
    route: "POST /v1/notifications/:id/read",
  }),
  defineRestWrite({
    name: "system_notifications_mark_all_read",
    module: "core",
    scope: "write:*",
    title: "Marcar todos los avisos como leídos",
    description: "Marca como leídos todos los avisos pendientes de la persona.",
    input: z.object({}).strict(),
    route: "POST /v1/notifications/read-all",
  }),
  defineRestRead({
    name: "system_me_get",
    module: "core",
    scope: "read:*",
    title: "Mi perfil",
    description: "La persona representada como la ve la app: nombre, correo, roles por sociedad, sociedades visibles y permisos.",
    input: z.object({}).strict(),
    route: "GET /v1/me",
  }),
  defineRestRead({
    name: "system_users_list",
    module: "core",
    scope: "read:*",
    title: "Personas con acceso",
    description: "Las personas con acceso a WineCore, sus roles y su estado (Ajustes → Personas). Solo el propietario o un administrador. Las altas y los cambios se hacen en la app.",
    input: z.object({}).strict(),
    route: "GET /v1/users",
  }),
];
