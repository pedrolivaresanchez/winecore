import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { isInstant } from '../inventory/periods';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  invalid,
  isUuid,
  oneOf,
  optionalText,
  optionalUuid,
  readJson,
  requireText,
  requireUuid,
  textOf,
  textOrNull,
} from '../cellar/service/http';

const STATUSES = ['idea', 'planned', 'done'] as const;
const KINDS = ['appointment', 'process'] as const;
const SOURCES = ['manual', 'voice', 'chat'] as const;

type IdeaStatus = (typeof STATUSES)[number];
type IdeaKind = (typeof KINDS)[number];
type IdeaSource = (typeof SOURCES)[number];

const CREATE_KEYS = [
  'title', 'note', 'status', 'kind', 'scheduled_at', 'contact_id', 'invoice_id', 'quote_id',
  'tasting_note_id', 'source',
] as const;

export interface Idea {
  id: string;
  title: string;
  note: string | null;
  status: IdeaStatus;
  kind: IdeaKind | null;
  scheduled_at: string | null;
  contact_id: string | null;
  invoice_id: string | null;
  quote_id: string | null;
  tasting_note_id: string | null;
  calendar_provider: 'outlook' | null;
  calendar_external_id: string | null;
  calendar_exported_at: string | null;
  calendar_export_requested_at: string | null;
  source: IdeaSource;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface CalendarSync {
  status: 'pending_connector' | 'already_exported';
  provider: 'outlook';
  external_id: string | null;
  message_es: string;
}

const PENDING_ES = 'Outlook Calendar no está conectado. No se ha creado ningún evento ni se ha llamado a ningún servicio externo. La cita queda anotada para exportarla cuando exista el conector.';
const EXPORTED_ES = 'Esta cita ya estaba marcada como exportada al calendario. No se ha llamado a Outlook.';

const SELECT = `
  id::VARCHAR AS id, title, note, status, kind, scheduled_at::VARCHAR AS scheduled_at,
  contact_id::VARCHAR AS contact_id, invoice_id::VARCHAR AS invoice_id,
  quote_id::VARCHAR AS quote_id, tasting_note_id::VARCHAR AS tasting_note_id,
  calendar_provider, calendar_external_id,
  calendar_exported_at::VARCHAR AS calendar_exported_at,
  calendar_export_requested_at::VARCHAR AS calendar_export_requested_at,
  source, created_by, created_at::VARCHAR AS created_at, updated_at::VARCHAR AS updated_at,
  archived_at::VARCHAR AS archived_at, archived_by
`;

type Reader = { read<T = Record<string, unknown>>(statement: string): Promise<T[]> };

interface IdeaInput {
  title: string;
  note: string | null;
  status: IdeaStatus;
  kind: IdeaKind | null;
  scheduled_at: string | null;
  contact_id: string | null;
  invoice_id: string | null;
  quote_id: string | null;
  tasting_note_id: string | null;
  source: IdeaSource;
}

export async function listIdeas(writer: Writer, request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get('limit'));
  const cursor = decodeCursor(params.get('cursor'));
  const includeArchived = params.get('include_archived') === 'true';
  const filters: string[] = [];
  if (!includeArchived) filters.push('archived_at IS NULL');
  const status = params.get('status');
  if (status) filters.push(sql`status = ${oneOf(status, 'status', STATUSES)}`);
  const kind = params.get('kind');
  if (kind) filters.push(sql`kind = ${oneOf(kind, 'kind', KINDS)}`);
  const contactId = params.get('contact_id');
  if (contactId) filters.push(sql`contact_id = CAST(${requireUuid(contactId, 'contact_id')} AS UUID)`);
  const invoiceId = params.get('invoice_id');
  if (invoiceId) filters.push(sql`invoice_id = CAST(${requireUuid(invoiceId, 'invoice_id')} AS UUID)`);
  const quoteId = params.get('quote_id');
  if (quoteId) filters.push(sql`quote_id = CAST(${requireUuid(quoteId, 'quote_id')} AS UUID)`);
  const tastingId = params.get('tasting_note_id');
  if (tastingId) filters.push(sql`tasting_note_id = CAST(${requireUuid(tastingId, 'tasting_note_id')} AS UUID)`);
  const q = params.get('q');
  if (q !== null && q.trim() !== '') {
    const pattern = likePattern(q.trim());
    filters.push(sql`(
      lower(title) LIKE ${pattern} ESCAPE '\\'
      OR lower(coalesce(note, '')) LIKE ${pattern} ESCAPE '\\'
    )`);
  }
  if (cursor) {
    filters.push(sql`(
      created_at < CAST(${cursor.createdAt} AS TIMESTAMPTZ)
      OR (created_at = CAST(${cursor.createdAt} AS TIMESTAMPTZ) AND id < CAST(${cursor.id} AS UUID))
    )`);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${SELECT}
    FROM agenda.idea
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(mapIdea);
  const last = items.at(-1);
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

export async function getIdea(writer: Writer, id: string) {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const row = await loadIdea(writer, id);
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

export async function createIdea(writer: Writer, request: Request) {
  const body = await readJson(request);
  rejectUnknown(body, CREATE_KEYS);
  const input = parseIdea(body, null);
  const actor = actorFor(request, 'alta de idea');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    await assertLinks(tx, input);
    auditInsert(tx, 'agenda.idea', id, { id, ...input }, sql`
      INSERT INTO agenda.idea (
        id, title, note, status, kind, scheduled_at, contact_id, invoice_id, quote_id,
        tasting_note_id, source, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        ${input.title},
        ${input.note},
        ${input.status},
        ${input.kind},
        CAST(${input.scheduled_at} AS TIMESTAMPTZ),
        CAST(${input.contact_id} AS UUID),
        CAST(${input.invoice_id} AS UUID),
        CAST(${input.quote_id} AS UUID),
        CAST(${input.tasting_note_id} AS UUID),
        ${input.source},
        ${actor.id}
      )
    `);
  });
  return requireIdea(writer, id);
}

export async function updateIdea(writer: Writer, request: Request, id: string) {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  rejectUnknown(body, CREATE_KEYS);
  if (Object.keys(body).length === 0) invalid({ body: 'No hay cambios' });
  const actor = actorFor(request, 'edición de idea');
  await writer.withWrite(actor, async (tx) => {
    const current = await loadIdea(tx, id);
    if (!current) throw domainError('WC_NOT_FOUND');
    if (current.archived_at) invalid({ id: 'La idea está archivada' });
    const input = parseIdea(body, current);
    guardExported(current, input);
    await assertLinks(tx, input);
    const requestedAt = keepExportRequest(current, input);
    auditUpdate(tx, 'agenda.idea', id, current, { ...input, calendar_export_requested_at: requestedAt }, sql`
      UPDATE agenda.idea SET
        title = ${input.title},
        note = ${input.note},
        status = ${input.status},
        kind = ${input.kind},
        scheduled_at = CAST(${input.scheduled_at} AS TIMESTAMPTZ),
        contact_id = CAST(${input.contact_id} AS UUID),
        invoice_id = CAST(${input.invoice_id} AS UUID),
        quote_id = CAST(${input.quote_id} AS UUID),
        tasting_note_id = CAST(${input.tasting_note_id} AS UUID),
        source = ${input.source},
        calendar_export_requested_at = CAST(${requestedAt} AS TIMESTAMPTZ),
        updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
  });
  return requireIdea(writer, id);
}

export async function archiveIdea(writer: Writer, request: Request, id: string) {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const actor = actorFor(request, 'archivo de idea');
  await writer.withWrite(actor, async (tx) => {
    const current = await loadIdea(tx, id);
    if (!current) throw domainError('WC_NOT_FOUND');
    if (current.archived_at) invalid({ id: 'La idea ya está archivada' });
    auditUpdate(tx, 'agenda.idea', id, current, { archived_at: 'now', archived_by: actor.id }, sql`
      UPDATE agenda.idea SET
        archived_at = now(),
        archived_by = ${actor.id},
        updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
  });
  return requireIdea(writer, id);
}

export async function requestCalendarExport(writer: Writer, request: Request, id: string): Promise<Idea & { calendar_sync: CalendarSync }> {
  if (!isUuid(id)) throw domainError('WC_NOT_FOUND');
  const actor = actorFor(request, 'petición de exportar idea al calendario');
  await writer.withWrite(actor, async (tx) => {
    const current = await loadIdea(tx, id);
    if (!current) throw domainError('WC_NOT_FOUND');
    assertExportable(current);
    if (current.calendar_exported_at || current.calendar_export_requested_at) return;
    auditUpdate(tx, 'agenda.idea', id, current, { calendar_export_requested_at: 'now' }, sql`
      UPDATE agenda.idea SET
        calendar_export_requested_at = now(),
        updated_at = now()
      WHERE id = CAST(${id} AS UUID) AND calendar_export_requested_at IS NULL
    `);
  });
  const idea = await requireIdea(writer, id);
  assertExportable(idea);
  return { ...idea, calendar_sync: syncOf(idea) };
}

function syncOf(idea: Idea): CalendarSync {
  if (idea.calendar_exported_at) {
    return {
      status: 'already_exported',
      provider: 'outlook',
      external_id: idea.calendar_external_id,
      message_es: EXPORTED_ES,
    };
  }
  return {
    status: 'pending_connector',
    provider: 'outlook',
    external_id: null,
    message_es: PENDING_ES,
  };
}

function assertExportable(idea: Idea): void {
  if (idea.archived_at) invalid({ id: 'La idea está archivada' });
  if (idea.kind !== 'appointment' || !idea.scheduled_at) {
    invalid({ kind: 'Solo se exporta una cita (appointment) con fecha y hora' });
  }
}

function guardExported(current: Idea, input: IdeaInput): void {
  if (!current.calendar_exported_at) return;
  if (input.kind !== 'appointment') {
    invalid({ kind: 'La cita ya está exportada al calendario: el tipo no se cambia' });
  }
  if (input.scheduled_at !== current.scheduled_at) {
    invalid({ scheduled_at: 'La cita ya está exportada al calendario: la fecha no se cambia' });
  }
}

function keepExportRequest(current: Idea, input: IdeaInput): string | null {
  if (!current.calendar_export_requested_at || current.calendar_exported_at) {
    return current.calendar_export_requested_at;
  }
  if (input.kind !== current.kind || input.scheduled_at !== current.scheduled_at) return null;
  return current.calendar_export_requested_at;
}

async function assertLinks(tx: Reader, input: IdeaInput): Promise<void> {
  if (input.contact_id) {
    const rows = await tx.read(sql`
      SELECT id FROM party.contact
      WHERE id = CAST(${input.contact_id} AS UUID) AND archived_at IS NULL
    `);
    if (rows.length === 0) invalid({ contact_id: 'El contacto no existe' });
  }
  if (input.invoice_id) await requireRow(tx, 'billing.invoice', input.invoice_id, 'invoice_id', 'La factura no existe');
  if (input.quote_id) await requireRow(tx, 'sales.quote', input.quote_id, 'quote_id', 'El presupuesto no existe');
  if (input.tasting_note_id) await requireRow(tx, 'tasting.note', input.tasting_note_id, 'tasting_note_id', 'La cata no existe');
}

async function requireRow(tx: Reader, table: 'billing.invoice' | 'sales.quote' | 'tasting.note', id: string, field: string, message: string): Promise<void> {
  const rows = await tx.read(sql`
    SELECT id FROM ${sql.raw(table)} WHERE id = CAST(${id} AS UUID)
  `);
  if (rows.length === 0) invalid({ [field]: message });
}

async function loadIdea(tx: Reader, id: string): Promise<Idea | null> {
  const rows = await tx.read<Record<string, unknown>>(
    `SELECT ${SELECT} FROM agenda.idea WHERE id = ${sql`CAST(${id} AS UUID)`}`,
  );
  const row = rows[0];
  return row ? mapIdea(row) : null;
}

async function requireIdea(tx: Reader, id: string): Promise<Idea> {
  const row = await loadIdea(tx, id);
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

function mapIdea(row: Record<string, unknown>): Idea {
  return {
    id: textOf(row.id).toLowerCase(),
    title: textOf(row.title),
    note: textOrNull(row.note),
    status: textOf(row.status) as IdeaStatus,
    kind: row.kind == null ? null : textOf(row.kind) as IdeaKind,
    scheduled_at: textOrNull(row.scheduled_at),
    contact_id: uuidOrNull(row.contact_id),
    invoice_id: uuidOrNull(row.invoice_id),
    quote_id: uuidOrNull(row.quote_id),
    tasting_note_id: uuidOrNull(row.tasting_note_id),
    calendar_provider: row.calendar_provider == null ? null : 'outlook',
    calendar_external_id: textOrNull(row.calendar_external_id),
    calendar_exported_at: textOrNull(row.calendar_exported_at),
    calendar_export_requested_at: textOrNull(row.calendar_export_requested_at),
    source: textOf(row.source) as IdeaSource,
    created_by: textOf(row.created_by),
    created_at: textOf(row.created_at),
    updated_at: textOf(row.updated_at),
    archived_at: textOrNull(row.archived_at),
    archived_by: textOrNull(row.archived_by),
  };
}

function uuidOrNull(value: unknown): string | null {
  if (value == null) return null;
  return textOf(value).toLowerCase();
}

function parseIdea(body: Record<string, unknown>, current: Idea | null): IdeaInput {
  return {
    title: body.title === undefined && current ? current.title : requireText(body.title, 'title', 200),
    note: body.note === undefined && current ? current.note : optionalText(body.note, 'note', 4000),
    status: body.status === undefined && current ? current.status : oneOf(body.status ?? 'idea', 'status', STATUSES),
    kind: body.kind === undefined && current ? current.kind : optionalKind(body.kind),
    scheduled_at: body.scheduled_at === undefined && current ? current.scheduled_at : optionalInstant(body.scheduled_at, 'scheduled_at'),
    contact_id: body.contact_id === undefined && current ? current.contact_id : optionalUuid(body.contact_id, 'contact_id'),
    invoice_id: body.invoice_id === undefined && current ? current.invoice_id : optionalUuid(body.invoice_id, 'invoice_id'),
    quote_id: body.quote_id === undefined && current ? current.quote_id : optionalUuid(body.quote_id, 'quote_id'),
    tasting_note_id: body.tasting_note_id === undefined && current
      ? current.tasting_note_id
      : optionalUuid(body.tasting_note_id, 'tasting_note_id'),
    source: body.source === undefined && current ? current.source : oneOf(body.source ?? 'manual', 'source', SOURCES),
  };
}

function optionalKind(value: unknown): IdeaKind | null {
  if (value === undefined || value === null || value === '') return null;
  return oneOf(value, 'kind', KINDS);
}

function optionalInstant(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isInstant(value)) {
    invalid({ [field]: 'Debe ser un instante ISO-8601 con zona horaria' });
  }
  return value;
}

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) invalid({ [key]: 'Campo no reconocido' });
  }
}

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === '') return 25;
  if (!/^\d{1,3}$/.test(value)) invalid({ limit: 'Debe ser un entero entre 1 y 100' });
  const parsed = Number(value);
  if (parsed < 1 || parsed > 100) invalid({ limit: 'Debe ser un entero entre 1 y 100' });
  return parsed;
}

function likePattern(value: string): string {
  if (value.length > 80) invalid({ q: 'Máximo 80 caracteres' });
  return `%${value.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(value: string | null): { createdAt: string; id: string } | null {
  if (value === null || value.trim() === '') return null;
  let text: string;
  try {
    text = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    invalid({ cursor: 'Cursor no válido' });
  }
  const sep = text.indexOf('|');
  if (sep <= 0) invalid({ cursor: 'Cursor no válido' });
  const createdAt = text.slice(0, sep);
  const id = text.slice(sep + 1);
  if (!isUuid(id)) invalid({ cursor: 'Cursor no válido' });
  if (createdAt.length > 60 || !/^[\d:.+\-T ]+$/.test(createdAt)) invalid({ cursor: 'Cursor no válido' });
  return { createdAt, id };
}
