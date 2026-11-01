import { z } from "zod";

import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.guid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const flow = z.enum(["verifactu", "silicie", "sisv", "emcs", "edi", "organic", "aeat_model"]);
const submissionStatus = z.enum([
  "draft", "validated", "pending_approval", "approved", "submitted",
  "accepted", "accepted_with_errors", "rejected", "cancelled", "corrected",
]);

const ANNULMENT_REASONS: Record<string, string> = { "1": "error numérico", "2": "asiento duplicado", "3": "otro motivo" };
const RESULTS: Record<string, string> = {
  accepted: "aceptado",
  accepted_with_errors: "aceptado con errores",
  rejected: "rechazado",
};

function fieldOf(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" || typeof found === "number" ? String(found) : null;
}

function submissionLabel(current: unknown): string {
  const start = fieldOf(current, "period_start")?.slice(0, 10);
  const end = fieldOf(current, "period_end")?.slice(0, 10);
  const summary = typeof current === "object" && current !== null ? (current as { summary?: unknown }).summary : null;
  const count = fieldOf(summary, "entry_count");
  const period = start && end ? ` del ${start} al ${end}` : "";
  return `el envío SILICIE${period}${count ? ` (${count} asientos)` : ""}`;
}

const submissionLink = (input: { id: string }) => `/regulatorio/envios/${input.id}`;
const createdLink = (_input: unknown, body: unknown) => {
  const created = fieldOf(body, "id");
  return created ? `/regulatorio/envios/${created}` : "/regulatorio";
};

export const regulatoryRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "regulatory_obligations_list",
    module: "core",
    scope: "regulatory.read",
    title: "Calendario de obligaciones regulatorias",
    description: "Las obligaciones con la AEAT y otros organismos (SILICIE, Verifactu, modelos…) con su periodo, fecha límite, estado (pendiente, preparado, presentado, vencido) y el envío que las cubre.",
    input: z.object({
      entity: id.optional().describe("Id de la sociedad"),
      flow: flow.optional(),
      from: date.optional().describe("Vencimiento desde (AAAA-MM-DD)"),
      to: date.optional().describe("Vencimiento hasta (AAAA-MM-DD)"),
    }).strict(),
    route: "GET /v1/regulatory/obligations",
    web: () => "/regulatorio/calendario",
  }),
  defineRestWrite({
    name: "regulatory_obligations_sync",
    module: "core",
    scope: "regulatory.prepare",
    title: "Actualizar calendario regulatorio",
    description: "Recalcula el calendario de obligaciones. Con legal_entity_id y year a la vez, solo crea las obligaciones SILICIE que falten de esa sociedad y año; sin ellos, refresca todo el calendario.",
    input: z.object({
      legal_entity_id: id.optional().describe("Id de la sociedad; va con year"),
      year: z.number().int().optional().describe("Año; va con legal_entity_id"),
    }).strict(),
    route: "POST /v1/regulatory/obligations/sync",
    web: () => "/regulatorio/calendario",
  }),
  defineRestRead({
    name: "regulatory_submissions_list",
    module: "core",
    scope: "regulatory.read",
    title: "Presentaciones regulatorias",
    description: "Los envíos preparados (SILICIE y otros) con su estado, periodo, validación, ficheros y asientos, del más reciente al más antiguo; paginado con next_cursor.",
    input: z.object({
      entity: id.optional().describe("Id de la sociedad"),
      flow: flow.optional(),
      status: submissionStatus.optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().max(200).optional(),
    }).strict(),
    route: "GET /v1/regulatory/submissions",
    web: () => "/regulatorio",
  }),
  defineRestRead({
    name: "regulatory_submission_get",
    module: "core",
    scope: "regulatory.read",
    title: "Detalle de una presentación",
    description: "Un envío con su estado y fase, errores y avisos de validación, ficheros generados, resumen (asientos y litros), asientos con su número AEAT y el envío que lo corrige, si lo hay.",
    input: z.object({ id }).strict(),
    route: "GET /v1/regulatory/submissions/:id",
    web: submissionLink,
  }),
  defineRestRead({
    name: "regulatory_submission_file_get",
    module: "core",
    scope: "regulatory.read",
    title: "Descargar fichero SILICIE",
    description: "El CSV del envío para subirlo a la sede de la AEAT: el de altas (IESA1V2) o el de anulaciones (IESX4), del ejercicio indicado o del último.",
    input: z.object({
      id,
      exercise: z.number().int().optional().describe("Año del ejercicio; por defecto, el último del envío"),
      part: z.enum(["altas", "anulaciones"]).optional().describe("altas (por defecto) o anulaciones"),
    }).strict(),
    route: "GET /v1/regulatory/submissions/:id/file",
    web: submissionLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_create",
    module: "core",
    scope: "regulatory.prepare",
    title: "Preparar envío SILICIE",
    description: "Genera el envío SILICIE de un depósito fiscal para un periodo: calcula los asientos desde los movimientos fiscales y prepara el fichero. No se envía nada a la AEAT; después hay que validarlo y pedir la aprobación.",
    input: z.object({
      legal_entity_id: id.describe("Id de la sociedad"),
      tax_warehouse_id: id.describe("Id del depósito fiscal (CAE)"),
      period_start: date.describe("Primer día del periodo (AAAA-MM-DD)"),
      period_end: date.describe("Último día del periodo (AAAA-MM-DD)"),
      recorded_on: date.optional().describe("Fecha de registro de los asientos; por defecto, hoy"),
      aggregation: z.enum(["monthly", "none"]).optional().describe("monthly agrupa los asientos por mes; none los deja uno a uno"),
      flow: z.literal("silicie").optional(),
    }).strict(),
    route: "POST /v1/regulatory/submissions",
    web: createdLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_validate",
    module: "core",
    scope: "regulatory.prepare",
    title: "Validar envío SILICIE",
    description: "Vuelve a comprobar el envío contra los movimientos actuales. Sin errores queda validado y listo para pedir la aprobación; si los datos cambiaron, vuelve a borrador.",
    input: z.object({ id }).strict(),
    route: "POST /v1/regulatory/submissions/:id/validate",
    current: { route: "GET /v1/regulatory/submissions/:id" },
    web: submissionLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_request_approval",
    module: "core",
    scope: "regulatory.prepare",
    title: "Pedir aprobación del envío SILICIE",
    description: "Manda a aprobación un envío validado. Si los asientos del periodo cambiaron, se rechaza y hay que volver a generarlo.",
    input: z.object({ id }).strict(),
    route: "POST /v1/regulatory/submissions/:id/request-approval",
    current: { route: "GET /v1/regulatory/submissions/:id" },
    summary: (_input, current) => `Pedirá la aprobación de ${submissionLabel(current)}. Mientras esté pendiente no se puede presentar. ¿Confirmas?`,
    web: submissionLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_mark_submitted",
    module: "core",
    scope: "regulatory.prepare",
    title: "Marcar envío presentado en la AEAT",
    description: "Registra que el fichero aprobado ya se presentó en la sede de la AEAT, con la referencia que dio la AEAT y, si se tiene, el justificante subido como adjunto. Consume la aprobación.",
    input: z.object({
      id,
      external_ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./_-]{3,39}$/).describe("Referencia o CSV que dio la AEAT (4 a 40 caracteres)"),
      receipt_attachment_id: id.optional().describe("Id del adjunto con el justificante"),
    }).strict(),
    route: "POST /v1/regulatory/submissions/:id/mark-submitted",
    current: { route: "GET /v1/regulatory/submissions/:id" },
    summary: (input, current) => `Marcará ${submissionLabel(current)} como presentado en la AEAT con la referencia ${input.external_ref} y consumirá su aprobación. No se puede deshacer. ¿Confirmas?`,
    web: submissionLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_mark_result",
    module: "core",
    scope: "regulatory.prepare",
    title: "Registrar respuesta de la AEAT",
    description: "Apunta el resultado de un envío presentado (aceptado, aceptado con errores o rechazado) y, por asiento, el número que asignó la AEAT y si se aceptó.",
    input: z.object({
      id,
      result: z.enum(["accepted", "accepted_with_errors", "rejected"]),
      items: z.array(z.object({
        entry_id: id.describe("Id del asiento (entries en regulatory_submission_get)"),
        aeat_entry_number: z.string().max(35).optional().describe("Número de asiento que dio la AEAT"),
        result: z.enum(["accepted", "rejected"]).optional(),
      }).strict()).optional(),
    }).strict(),
    route: "POST /v1/regulatory/submissions/:id/mark-result",
    current: { route: "GET /v1/regulatory/submissions/:id" },
    summary: (input, current) => `Registrará que la AEAT ha dado ${submissionLabel(current)} por ${RESULTS[input.result] ?? input.result}. No se puede cambiar después. ¿Confirmas?`,
    web: submissionLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_correct",
    module: "core",
    scope: "regulatory.prepare",
    title: "Corregir envío SILICIE",
    description: "Crea un envío de corrección que anula asientos ya presentados (por defecto, todos los aceptados) y los vuelve a dar de alta. El nuevo envío hay que validarlo, aprobarlo y presentarlo.",
    input: z.object({
      id,
      reason: z.enum(["1", "2", "3"]).describe("Motivo de anulación AEAT: 1 error numérico, 2 duplicado, 3 otro"),
      entry_ids: z.array(id).optional().describe("Asientos a anular; por defecto, todos los aceptados"),
    }).strict(),
    route: "POST /v1/regulatory/submissions/:id/correct",
    current: { route: "GET /v1/regulatory/submissions/:id" },
    summary: (input, current) => {
      const which = input.entry_ids?.length ? `${input.entry_ids.length} asiento(s)` : "todos los asientos aceptados";
      return `Creará un envío que anula ${which} de ${submissionLabel(current)} por ${ANNULMENT_REASONS[input.reason] ?? input.reason}. Luego habrá que validarlo, aprobarlo y presentarlo. ¿Confirmas?`;
    },
    web: createdLink,
  }),
  defineRestWrite({
    name: "regulatory_submission_cancel",
    module: "core",
    scope: "regulatory.prepare",
    title: "Anular envío SILICIE",
    description: "Anula un envío que todavía no está aprobado (borrador, validado o pendiente de aprobación), con el motivo. Sus asientos pendientes se anulan y la obligación vuelve a quedar abierta. No llama a la AEAT.",
    input: z.object({
      id,
      reason: z.string().min(3).max(500).describe("Motivo de la anulación"),
    }).strict(),
    route: "POST /v1/regulatory/submissions/:id/cancel",
    current: { route: "GET /v1/regulatory/submissions/:id" },
    summary: (input, current) => `Anulará ${submissionLabel(current)} por «${input.reason}». Sus asientos pendientes quedan anulados. No se puede deshacer. ¿Confirmas?`,
    web: submissionLink,
  }),
  defineRestRead({
    name: "regulatory_silicie_ledgers_list",
    module: "core",
    scope: "regulatory.read",
    title: "Libros SILICIE del depósito fiscal",
    description: "Los libros (mayores) SILICIE de un depósito fiscal: referencia, descripción, clase de producto, epígrafe, código NC y si los validó el asesor.",
    input: z.object({ tax_warehouse_id: id.describe("Id del depósito fiscal") }).strict(),
    route: "GET /v1/silicie-ledgers",
    web: () => "/regulatorio/mayores",
  }),
  defineRestWrite({
    name: "regulatory_silicie_ledger_create",
    module: "core",
    scope: "regulatory.prepare",
    title: "Crear libro SILICIE",
    description: "Da de alta un libro (mayor) SILICIE en un depósito fiscal a partir de la clase de producto y, en vino, el color, el código de vino, la marca y el envase. Si ya existe uno con la misma referencia, devuelve ese.",
    input: z.object({
      tax_warehouse_id: id.describe("Id del depósito fiscal"),
      product_class: z.enum(["raw_grape", "raw_must", "bulk", "bulk_wood", "packaged", "byproduct"])
        .describe("raw_grape uva, raw_must mosto, bulk vino a granel, bulk_wood granel en madera, packaged envasado, byproduct subproducto"),
      color: z.enum(["tinto", "blanco", "rosado"]).optional(),
      wine_code: z.string().optional().describe("Código del vino para la referencia"),
      brand: z.string().optional().describe("Marca, para la descripción del envasado"),
      container_kind: z.enum(["bottle", "bib"]).optional().describe("Botella o bag-in-box (envasado)"),
      container_capacity_ml: z.number().optional().describe("Capacidad del envase en ml (envasado)"),
      nc_code: z.string().optional().describe("Código NC: el encabezado 220429, 220421 o 220422, o un código de 8 dígitos que empiece por él"),
    }).strict(),
    route: "POST /v1/silicie-ledgers",
    web: () => "/regulatorio/mayores",
  }),
  defineRestWrite({
    name: "regulatory_silicie_ledger_validate",
    module: "core",
    scope: "write:*",
    title: "Validar libro SILICIE",
    description: "Deja constancia de que el asesor revisó un libro SILICIE, con su referencia. Lo hace el propietario, el asesor o quien prepara los envíos.",
    input: z.object({
      id: id.describe("Id del libro (regulatory_silicie_ledgers_list)"),
      advisor_ref: z.string().regex(/^[A-Za-z0-9 .:_-]{3,80}$/).describe("Referencia de la validación del asesor"),
    }).strict(),
    route: "POST /v1/silicie-ledgers/:id/validate",
    summary: (input) => `Marcará el libro SILICIE como validado por el asesor con la referencia ${input.advisor_ref}. ¿Confirmas?`,
    web: () => "/regulatorio/mayores",
  }),
  defineRestWrite({
    name: "regulatory_silicie_exercise_open",
    module: "core",
    scope: "write:*",
    title: "Abrir ejercicio SILICIE",
    description: "Abre el ejercicio SILICIE de un año en un depósito fiscal; sin él no se registran entradas de uva. Si ya está abierto, lo devuelve. Solo el propietario o el asesor.",
    input: z.object({
      tax_warehouse_id: id.describe("Id del depósito fiscal"),
      year: z.number().int().min(2020).max(2100),
    }).strict(),
    route: "POST /v1/silicie-exercises",
    summary: (input) => `Abrirá el ejercicio SILICIE ${input.year} del depósito fiscal. ¿Confirmas?`,
  }),
];
