import { z } from "zod";

import { domainError } from "../../../core/errors";
import type { AnyTool } from "../../registry";
import { defineRestRead, defineRestWrite } from "../../rest";

const id = z.string().uuid();
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/)
  .describe("Instante ISO-8601 con zona, p. ej. 2026-11-02T10:00:00+01:00");
const status = z.enum(["idea", "planned", "done"]).describe("idea, planned (planificada) o done (hecha)");
const kind = z.enum(["appointment", "process"]).describe("appointment (cita, con fecha y hora) o process (proceso, con fecha objetivo)");
const source = z.enum(["manual", "voice", "chat"]).describe("manual, voice (dictado) o chat");

const ideaFields = {
  title: z.string().trim().min(1).max(200).describe("Título de la idea"),
  note: z.string().trim().max(4000).nullable().optional().describe("Nota o descripción. null la quita"),
  status: status.optional(),
  kind: kind.nullable().optional().describe("null la deja sin tipo"),
  scheduled_at: instant.nullable().optional().describe("Fecha y hora objetivo. null la quita"),
  contact_id: id.nullable().optional().describe("Contacto relacionado. null lo quita"),
  invoice_id: id.nullable().optional().describe("Factura relacionada. null la quita"),
  quote_id: id.nullable().optional().describe("Presupuesto relacionado. null lo quita"),
  tasting_note_id: id.nullable().optional().describe("Cata (ficha tasting.note) relacionada. null la quita"),
  source: source.optional(),
};

function recordOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function titleOf(current: unknown): string {
  const title = recordOf(current)?.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : "la idea";
}

const KIND_ES: Record<string, string> = { appointment: "Cita", process: "Proceso" };

export const agendaRestTools: readonly AnyTool[] = [
  defineRestRead({
    name: "agenda_idea_list",
    module: "agenda",
    scope: "agenda.read",
    title: "Listar ideas",
    description: "Lista la agenda de ideas, de la más reciente a la más antigua. Por defecto oculta las archivadas. Se puede filtrar por estado, tipo, contacto, factura, presupuesto, cata o texto del título y la nota.",
    input: z.object({
      status: status.optional(),
      kind: kind.optional(),
      contact_id: id.optional(),
      invoice_id: id.optional(),
      quote_id: id.optional(),
      tasting_note_id: id.optional(),
      q: z.string().trim().min(1).max(80).optional().describe("Texto a buscar en el título y la nota"),
      include_archived: z.enum(["true", "false"]).optional().describe("true incluye las archivadas"),
      cursor: z.string().max(300).optional().describe("next_cursor de la página anterior"),
      limit: z.number().int().min(1).max(100).optional().describe("Por defecto 25"),
    }).strict(),
    route: "GET /v1/agenda/ideas",
  }),
  defineRestRead({
    name: "agenda_idea_get",
    module: "agenda",
    scope: "agenda.read",
    title: "Ver idea",
    description: "Una idea de la agenda, con su estado, tipo, fecha, enlaces (contacto, factura, presupuesto, cata) y si se pidió o se marcó la exportación al calendario.",
    input: z.object({ id }).strict(),
    route: "GET /v1/agenda/ideas/:id",
  }),
  defineRestWrite({
    name: "agenda_idea_create",
    module: "agenda",
    scope: "agenda.write",
    title: "Nueva idea",
    description: "Anota una idea o tarea suelta. El estado por defecto es idea. El tipo (cita o proceso) y la fecha son opcionales: se pueden poner ahora o después. Se puede enlazar un contacto, una factura, un presupuesto o una cata.",
    input: z.object({
      title: ideaFields.title,
      note: z.string().trim().max(4000).optional(),
      status: status.optional(),
      kind: kind.optional(),
      scheduled_at: instant.optional(),
      contact_id: id.optional(),
      invoice_id: id.optional(),
      quote_id: id.optional(),
      tasting_note_id: id.optional(),
      source: source.optional(),
    }).strict(),
    route: "POST /v1/agenda/ideas",
    summary: (input) => {
      const label = input.kind ? KIND_ES[input.kind] : "Idea";
      const when = input.scheduled_at ? ` para ${input.scheduled_at}` : " sin fecha";
      return `${label} «${input.title.trim()}»${when}. ¿Confirmas?`;
    },
  }),
  defineRestWrite({
    name: "agenda_idea_update",
    module: "agenda",
    scope: "agenda.write",
    title: "Editar idea",
    description: "Cambia título, nota, estado (idea, planificada, hecha), tipo (cita o proceso), fecha o enlaces. Solo hace falta mandar lo que cambia. null quita la nota, la fecha, el tipo o un enlace. No edita una idea archivada. Si la cita ya se exportó al calendario, el tipo y la fecha no se cambian.",
    input: z.object({
      id,
      changes: z.object(ideaFields).partial().strict(),
    }).strict(),
    route: "PATCH /v1/agenda/ideas/:id",
    current: { route: "GET /v1/agenda/ideas/:id" },
    send: (input) => input.changes,
    summary: (input, current) => {
      const fields = Object.keys(input.changes);
      if (fields.length === 0) throw domainError("WC_VALIDATION", { changes: "No hay cambios" });
      return `Cambiar ${fields.join(", ")} de «${titleOf(current)}». ¿Confirmas?`;
    },
  }),
  defineRestWrite({
    name: "agenda_idea_delete",
    module: "agenda",
    scope: "agenda.write",
    title: "Archivar idea",
    description: "Archiva la idea. No se borra de la base: deja de salir en el listado. No borra un evento de Outlook, porque esa conexión no existe.",
    input: z.object({ id }).strict(),
    route: "DELETE /v1/agenda/ideas/:id",
    current: { route: "GET /v1/agenda/ideas/:id" },
    summary: (_input, current) => `Archivar «${titleOf(current)}». Deja de salir en el listado y no se borra de la base. ¿Confirmas?`,
  }),
  defineRestWrite({
    name: "agenda_idea_calendar_export",
    module: "agenda",
    scope: "agenda.write",
    title: "Pedir exportar la cita al calendario",
    description: "Pide pasar una cita con fecha al calendario de Outlook. PLACEHOLDER: no llama a Outlook, no usa credenciales ni un endpoint externo. Si la idea es una cita (kind appointment) con scheduled_at, anota calendar_export_requested_at para cuando exista el conector. calendar_exported_at y calendar_external_id siguen vacíos hasta entonces. Si ya constaba como exportada, devuelve el id externo y no cambia nada. Un proceso, una idea sin fecha o una idea archivada no se exportan.",
    input: z.object({ id }).strict(),
    route: "POST /v1/agenda/ideas/:id/calendar-export",
    current: { route: "GET /v1/agenda/ideas/:id" },
    send: () => ({}),
    summary: (_input, current) => {
      const row = recordOf(current);
      if (row?.archived_at) throw domainError("WC_VALIDATION", { id: "La idea está archivada" });
      if (row?.kind !== "appointment" || !row.scheduled_at) {
        throw domainError("WC_VALIDATION", { kind: "Solo se exporta una cita (appointment) con fecha y hora" });
      }
      return `Pedir exportar al calendario de Outlook la cita «${titleOf(current)}» (${String(row.scheduled_at)}). No se llama a Outlook: la conexión no está hecha, solo se anota la petición. ¿Confirmas?`;
    },
  }),
];
