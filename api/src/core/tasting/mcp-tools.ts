import { z } from 'zod';
import type { Actor, Writer } from '../db/writer';
import { domainError } from '../errors';
import { insertNote, resolveCodeLink, type NoteCommand } from './notes';
import { parseDictation } from './parse-dictation';
import { castVote as castSessionVote, listSessionSamples as listSamples } from './sessions';
import { isSource } from './types';

/**
 * Handlers listos para el servidor MCP. No se registran aquí:
 * otro agente es dueño del catálogo MCP.
 */

export const createTastingNoteFromDictationInput = z.object({
  dictated_text: z.string().trim().min(1).max(8000),
  template_code: z.string().trim().min(2).max(20).optional(),
  tasted_at: z.string().optional(),
  taster_name: z.string().trim().min(1).max(120).optional(),
  taster_user_id: z.uuid().optional(),
  lot_code: z.string().trim().min(2).max(30).optional(),
  parcel_code: z.string().trim().min(2).max(20).optional(),
  vessel_code: z.string().trim().min(2).max(20).optional(),
  wine_code: z.string().trim().min(2).max(20).optional(),
  vintage: z.number().int().optional(),
  source: z.enum(['voice', 'chat', 'manual']).optional(),
}).strict();

export const createTastingNoteFromDictationOutput = z.object({
  note_id: z.uuid(),
  template_code: z.string(),
  subject: z.string(),
  voice_transcript: z.string(),
  lot_id: z.uuid().nullable(),
  parcel_id: z.uuid().nullable(),
  visual_score: z.number().nullable(),
  nose_score: z.number().nullable(),
  mouth_score: z.number().nullable(),
  overall_score: z.number().nullable(),
  defects: z.array(z.string()),
  decision: z.string().nullable(),
});

export const listSessionSamplesInput = z.object({
  session_id: z.uuid(),
}).strict();

export const listSessionSamplesOutput = z.object({
  session_id: z.uuid(),
  status: z.enum(['open', 'revealed']),
  revealed: z.boolean(),
  target: z.string(),
  samples: z.array(z.object({
    sample_no: z.number().int(),
    lot_id: z.uuid().optional(),
    lot_code: z.string().optional(),
    vessel_id: z.uuid().nullable().optional(),
    vessel_code: z.string().nullable().optional(),
  })),
});

export const castVoteInput = z.object({
  session_id: z.uuid(),
  sample_no: z.number().int().positive(),
  day_no: z.number().int().positive(),
  vote: z.enum(['yes', 'no']),
  score: z.number().min(0).max(100).nullable().optional(),
  comment: z.string().max(2000).optional(),
  taster_name: z.string().trim().min(1).max(120).optional(),
  taster_user_id: z.uuid().optional(),
}).strict();

export const castVoteOutput = z.object({
  vote_id: z.uuid(),
  session_id: z.uuid(),
  sample_no: z.number().int(),
  day_no: z.number().int(),
  vote: z.enum(['yes', 'no']),
  score: z.number().nullable(),
  taster_name: z.string(),
  updated: z.boolean(),
});

export async function createTastingNoteFromDictation(
  writer: Writer,
  actor: Actor,
  input: unknown,
): Promise<z.infer<typeof createTastingNoteFromDictationOutput>> {
  const parsedInput = parseSchema(createTastingNoteFromDictationInput, input);
  const dictated = parseDictation(parsedInput.dictated_text);
  const templateCode = parsedInput.template_code?.toUpperCase() ?? dictated.template_code;
  if (!templateCode) {
    throw domainError('WC_VALIDATION', { template_code: 'No se reconoce la plantilla en el dictado' });
  }
  const links = await resolveCodeLink(writer, {
    lot_code: (parsedInput.lot_code ?? dictated.lot_code)?.toUpperCase() ?? null,
    parcel_code: (parsedInput.parcel_code ?? dictated.parcel_code)?.toUpperCase() ?? null,
    vessel_code: (parsedInput.vessel_code ?? dictated.vessel_code)?.toUpperCase() ?? null,
    wine_code: parsedInput.wine_code?.toUpperCase() ?? null,
  });
  const source = parsedInput.source ?? 'voice';
  if (!isSource(source)) throw domainError('WC_VALIDATION', { source: 'Origen no reconocido' });
  const command: NoteCommand = {
    template_id: null,
    template_code: templateCode,
    tasted_at: parsedInput.tasted_at ?? new Date().toISOString(),
    taster_user_id: parsedInput.taster_user_id ?? null,
    taster_name: parsedInput.taster_name ?? null,
    parcel_id: links.parcel_id,
    parcel_code: null,
    lot_id: links.lot_id,
    vessel_id: links.vessel_id,
    product_id: null,
    wine_id: links.wine_id,
    vintage: parsedInput.vintage ?? dictated.vintage ?? links.vintage,
    visual_score: dictated.visual_score,
    nose_score: dictated.nose_score,
    mouth_score: dictated.mouth_score,
    overall_score: dictated.overall_score,
    descriptors: [],
    descriptors_text: null,
    defects: dictated.defects,
    decision: dictated.decision,
    notes: parsedInput.dictated_text,
    voice_transcript: parsedInput.dictated_text,
    values: dictated.values,
    attachment_ids: [],
    voice_attachment_id: null,
    source,
  };
  const note = await insertNote(writer, actor, command);
  return assertSchema(createTastingNoteFromDictationOutput, {
    note_id: note.id,
    template_code: note.template_code,
    subject: note.subject,
    voice_transcript: note.voice_transcript ?? parsedInput.dictated_text,
    lot_id: note.lot_id,
    parcel_id: note.parcel_id,
    visual_score: note.visual_score,
    nose_score: note.nose_score,
    mouth_score: note.mouth_score,
    overall_score: note.overall_score,
    defects: note.defects,
    decision: note.decision,
  });
}

export async function listSessionSamples(
  writer: Writer,
  input: unknown,
): Promise<z.infer<typeof listSessionSamplesOutput>> {
  const parsed = parseSchema(listSessionSamplesInput, input);
  const listed = await listSamples(writer, parsed);
  return assertSchema(listSessionSamplesOutput, listed);
}

export async function castVote(
  writer: Writer,
  actor: Actor,
  input: unknown,
): Promise<z.infer<typeof castVoteOutput>> {
  const parsed = parseSchema(castVoteInput, input);
  const vote = await castSessionVote(writer, actor, parsed);
  return assertSchema(castVoteOutput, vote);
}

function parseSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join('.') || 'body';
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  throw domainError('WC_VALIDATION', fields);
}

function assertSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Salida de cata no válida: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return parsed.data;
}
