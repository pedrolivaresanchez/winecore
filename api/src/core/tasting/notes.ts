import { listLinks } from '../attachments/store';
import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import {
  asBool,
  asId,
  asInstant,
  asInt,
  asJsonObject,
  asNumber,
  asStringList,
  asText,
} from './rows';
import { findByCode, findLotByCode, loadLot, loadProduct, loadUserName, requireAttachment, requireRow } from './refs';
import { findTemplate } from './templates';
import {
  isSource,
  type ScoreScale,
  type Subject,
  type TastingSource,
} from './types';
import {
  bottleColumns,
  invalid,
  isUuid,
  optionalText,
  optionalUuid,
  parseScore,
  rejectUnknown,
  requireInstant,
  requireObject,
  requireText,
  subjectGap,
  templateCode,
  validateAnswers,
} from './validate';

export interface NoteView {
  id: string;
  template_id: string;
  template_code: string;
  tasted_at: string;
  taster_user_id: string | null;
  taster_name: string;
  subject: Subject;
  parcel_id: string | null;
  lot_id: string | null;
  vessel_id: string | null;
  product_id: string | null;
  wine_id: string | null;
  vintage: number | null;
  score_scale: ScoreScale;
  visual_score: number | null;
  nose_score: number | null;
  mouth_score: number | null;
  overall_score: number | null;
  descriptors: string[];
  descriptors_text: string | null;
  defects: string[];
  decision: string | null;
  notes: string | null;
  voice_transcript: string | null;
  place: string | null;
  glass: string | null;
  context: string | null;
  evolution: string | null;
  values: Record<string, unknown>;
  source: TastingSource;
  attachments: { id: string; role: string; filename: string }[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface NoteCommand {
  template_id: string | null;
  template_code: string | null;
  tasted_at: string;
  taster_user_id: string | null;
  taster_name: string | null;
  parcel_id: string | null;
  lot_id: string | null;
  vessel_id: string | null;
  product_id: string | null;
  wine_id: string | null;
  vintage: number | null;
  visual_score: number | null;
  nose_score: number | null;
  mouth_score: number | null;
  overall_score: number | null;
  descriptors: string[];
  descriptors_text: string | null;
  defects: string[];
  decision: string | null;
  notes: string | null;
  voice_transcript: string | null;
  values: Record<string, unknown>;
  attachment_ids: string[];
  voice_attachment_id: string | null;
  source: TastingSource;
}

const CREATE_KEYS = [
  'template_id', 'template_code', 'tasted_at', 'taster_user_id', 'taster_name',
  'parcel_id', 'lot_id', 'vessel_id', 'product_id', 'wine_id', 'vintage',
  'visual_score', 'nose_score', 'mouth_score', 'overall_score',
  'descriptors', 'descriptors_text', 'defects', 'decision', 'notes', 'voice_transcript',
  'values', 'place', 'glass', 'context', 'evolution',
  'attachment_ids', 'voice_attachment_id', 'source',
];

const PATCH_KEYS = [
  'visual_score', 'nose_score', 'mouth_score', 'overall_score',
  'descriptors', 'descriptors_text', 'defects', 'decision', 'notes', 'voice_transcript',
  'values', 'place', 'glass', 'context', 'evolution',
];

export async function listNotes(writer: Writer, request: Request): Promise<{ items: NoteView[] }> {
  const url = new URL(request.url);
  const where = ['TRUE'];
  const lotId = optionalQueryUuid(url, 'lot_id');
  const wineId = optionalQueryUuid(url, 'wine_id');
  const parcelId = optionalQueryUuid(url, 'parcel_id');
  const subject = url.searchParams.get('subject');
  const code = url.searchParams.get('template_code');
  if (lotId) where.push(sql`n.lot_id = CAST(${lotId} AS UUID)`);
  if (wineId) where.push(sql`n.wine_id = CAST(${wineId} AS UUID)`);
  if (parcelId) where.push(sql`n.parcel_id = CAST(${parcelId} AS UUID)`);
  if (subject) where.push(sql`n.subject = ${subject}`);
  if (code) where.push(sql`t.code = ${code.trim().toUpperCase()}`);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (from) where.push(sql`n.tasted_at >= CAST(${requireInstant(from, 'from')} AS TIMESTAMPTZ)`);
  if (to) where.push(sql`n.tasted_at <= CAST(${requireInstant(to, 'to')} AS TIMESTAMPTZ)`);
  const limit = limitOf(url.searchParams.get('limit'));
  const rows = await writer.read<Record<string, unknown>>(
    `${noteSelect()} WHERE ${where.join(' AND ')} ORDER BY n.tasted_at DESC, n.id DESC LIMIT ${limit}`,
  );
  const items: NoteView[] = [];
  for (const row of rows) items.push(await noteOf(writer, row));
  return { items };
}

export async function getNote(writer: Writer, id: string): Promise<NoteView> {
  if (!isUuid(id)) invalid({ id: 'Debe ser un UUID' });
  const rows = await writer.read<Record<string, unknown>>(
    `${noteSelect()} ${sql`WHERE n.id = CAST(${id.toLowerCase()} AS UUID) LIMIT 1`}`,
  );
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return noteOf(writer, row);
}

export async function createNote(writer: Writer, actor: Actor, body: unknown): Promise<NoteView> {
  return insertNote(writer, actor, commandFromBody(body));
}

export async function insertNote(writer: Writer, actor: Actor, command: NoteCommand): Promise<NoteView> {
  const tastedAt = requireInstant(command.tasted_at, 'tasted_at');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const template = await findTemplate(tx, { id: command.template_id, code: command.template_code });
    if (!template.is_active) throw domainError('WC_TASTING_TEMPLATE', { template_code: 'La plantilla no está activa' });
    const answers = validateAnswers(template.fields, command.values);
    const scale = template.score_scale;
    const scores = {
      visual_score: parseScore(command.visual_score, 'visual_score', scale),
      nose_score: parseScore(command.nose_score, 'nose_score', scale),
      mouth_score: parseScore(command.mouth_score, 'mouth_score', scale),
      overall_score: parseScore(command.overall_score, 'overall_score', scale),
    };
    const descriptors = await codesOf(tx, command.descriptors, 'descriptors', null);
    const defects = await codesOf(tx, command.defects, 'defects', 'defect');
    const link = await resolveLinks(tx, template.subject, command);
    const taster = await resolveTaster(tx, command.taster_user_id, command.taster_name, actor.id);
    const photos = uniqueIds(command.attachment_ids, 'attachment_ids');
    const voiceId = command.voice_attachment_id;
    if (voiceId && photos.includes(voiceId)) invalid({ voice_attachment_id: 'El audio ya está entre las fotos' });
    for (const attachmentId of photos) await requireAttachment(tx, attachmentId, 'attachment_ids');
    if (voiceId) await requireAttachment(tx, voiceId, 'voice_attachment_id');
    const columns = bottleColumns(answers);
    const source = command.source;
    tx.write(sql`
      INSERT INTO tasting.note (
        id, template_id, tasted_at, taster_user_id, taster_name, subject,
        parcel_id, lot_id, vessel_id, product_id, wine_id, vintage,
        score_scale, visual_score, nose_score, mouth_score, overall_score,
        descriptors, descriptors_text, defects, decision, notes, voice_transcript,
        place, glass, context, evolution, answers, source, created_by
      ) VALUES (
        CAST(${id} AS UUID), CAST(${template.id} AS UUID), CAST(${tastedAt} AS TIMESTAMPTZ),
        CAST(${taster.userId} AS UUID), ${taster.name}, ${template.subject},
        CAST(${link.parcel_id} AS UUID), CAST(${link.lot_id} AS UUID), CAST(${link.vessel_id} AS UUID),
        CAST(${link.product_id} AS UUID), CAST(${link.wine_id} AS UUID), ${link.vintage},
        ${scale}, ${scores.visual_score}, ${scores.nose_score}, ${scores.mouth_score}, ${scores.overall_score},
        ${sql.json(descriptors)}, ${command.descriptors_text}, ${sql.json(defects)},
        ${command.decision}, ${command.notes}, ${command.voice_transcript},
        ${columns.place}, ${columns.glass}, ${columns.context}, ${columns.evolution},
        ${sql.json(answers)}, ${source}, ${actor.id}
      )
    `);
    tx.audit({
      table: 'tasting.note',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        template_id: template.id,
        subject: template.subject,
        tasted_at: tastedAt,
        taster_name: taster.name,
        lot_id: link.lot_id,
        wine_id: link.wine_id,
        parcel_id: link.parcel_id,
      },
    });
    for (const attachmentId of photos) linkAttachment(tx, id, attachmentId, 'photo', actor.id);
    if (voiceId) linkAttachment(tx, id, voiceId, 'other', actor.id);
  });
  return getNote(writer, id);
}

export async function patchNote(writer: Writer, actor: Actor, id: string, body: unknown): Promise<NoteView> {
  const record = requireObject(body);
  rejectUnknown(record, PATCH_KEYS);
  if (Object.keys(record).length === 0) invalid({ body: 'No hay cambios' });
  const current = await getNote(writer, id);
  await writer.withWrite(actor, async (tx) => {
    const template = await findTemplate(tx, { id: current.template_id, code: null });
    const answersTouched = 'values' in record || 'place' in record || 'glass' in record || 'context' in record || 'evolution' in record;
    const answers = answersTouched
      ? validateAnswers(template.fields, mergeAnswers(current.values, record))
      : current.values;
    const columns = bottleColumns(answers);
    const scale = current.score_scale;
    const visual = 'visual_score' in record ? parseScore(record.visual_score, 'visual_score', scale) : current.visual_score;
    const nose = 'nose_score' in record ? parseScore(record.nose_score, 'nose_score', scale) : current.nose_score;
    const mouth = 'mouth_score' in record ? parseScore(record.mouth_score, 'mouth_score', scale) : current.mouth_score;
    const overall = 'overall_score' in record ? parseScore(record.overall_score, 'overall_score', scale) : current.overall_score;
    const descriptors = 'descriptors' in record
      ? await codesOf(tx, stringList(record.descriptors, 'descriptors'), 'descriptors', null)
      : current.descriptors;
    const defects = 'defects' in record
      ? await codesOf(tx, stringList(record.defects, 'defects'), 'defects', 'defect')
      : current.defects;
    const descriptorsText = 'descriptors_text' in record ? optionalText(record.descriptors_text, 'descriptors_text', 2000) : current.descriptors_text;
    const decision = 'decision' in record ? optionalText(record.decision, 'decision', 500) : current.decision;
    const notes = 'notes' in record ? optionalText(record.notes, 'notes', 4000) : current.notes;
    const transcript = 'voice_transcript' in record ? optionalText(record.voice_transcript, 'voice_transcript', 8000) : current.voice_transcript;
    tx.write(sql`
      UPDATE tasting.note SET
        visual_score = ${visual},
        nose_score = ${nose},
        mouth_score = ${mouth},
        overall_score = ${overall},
        descriptors = ${sql.json(descriptors)},
        descriptors_text = ${descriptorsText},
        defects = ${sql.json(defects)},
        decision = ${decision},
        notes = ${notes},
        voice_transcript = ${transcript},
        place = ${columns.place},
        glass = ${columns.glass},
        context = ${columns.context},
        evolution = ${columns.evolution},
        answers = ${sql.json(answers)},
        updated_at = now()
      WHERE id = CAST(${current.id} AS UUID)
    `);
    tx.audit({
      table: 'tasting.note',
      rowId: current.id,
      action: 'UPDATE',
      before: { overall_score: current.overall_score, decision: current.decision, notes: current.notes },
      after: { overall_score: overall, decision, notes },
    });
  });
  return getNote(writer, id);
}

export function commandFromBody(body: unknown): NoteCommand {
  const record = requireObject(body);
  rejectUnknown(record, CREATE_KEYS);
  const values = record.values === undefined ? {} : requireObject(record.values);
  for (const key of ['place', 'glass', 'context', 'evolution'] as const) {
    if (record[key] !== undefined && values[key] === undefined) values[key] = record[key];
  }
  const sourceRaw = record.source === undefined ? 'manual' : record.source;
  if (typeof sourceRaw !== 'string' || !isSource(sourceRaw)) invalid({ source: 'Origen no reconocido' });
  const vintage = record.vintage === undefined || record.vintage === null
    ? null
    : vintageOf(record.vintage);
  return {
    template_id: optionalUuid(record.template_id, 'template_id'),
    template_code: record.template_code === undefined || record.template_code === null
      ? null
      : templateCode(record.template_code, 'template_code'),
    tasted_at: requireInstant(record.tasted_at, 'tasted_at'),
    taster_user_id: optionalUuid(record.taster_user_id, 'taster_user_id'),
    taster_name: optionalText(record.taster_name, 'taster_name', 120),
    parcel_id: optionalUuid(record.parcel_id, 'parcel_id'),
    lot_id: optionalUuid(record.lot_id, 'lot_id'),
    vessel_id: optionalUuid(record.vessel_id, 'vessel_id'),
    product_id: optionalUuid(record.product_id, 'product_id'),
    wine_id: optionalUuid(record.wine_id, 'wine_id'),
    vintage,
    visual_score: scoreOrNull(record.visual_score, 'visual_score'),
    nose_score: scoreOrNull(record.nose_score, 'nose_score'),
    mouth_score: scoreOrNull(record.mouth_score, 'mouth_score'),
    overall_score: scoreOrNull(record.overall_score, 'overall_score'),
    descriptors: record.descriptors === undefined ? [] : stringList(record.descriptors, 'descriptors'),
    descriptors_text: optionalText(record.descriptors_text, 'descriptors_text', 2000),
    defects: record.defects === undefined ? [] : stringList(record.defects, 'defects'),
    decision: optionalText(record.decision, 'decision', 500),
    notes: optionalText(record.notes, 'notes', 4000),
    voice_transcript: optionalText(record.voice_transcript, 'voice_transcript', 8000),
    values,
    attachment_ids: record.attachment_ids === undefined ? [] : stringList(record.attachment_ids, 'attachment_ids'),
    voice_attachment_id: optionalUuid(record.voice_attachment_id, 'voice_attachment_id'),
    source: sourceRaw,
  };
}

async function resolveLinks(tx: Tx, subject: Subject, command: NoteCommand): Promise<{
  parcel_id: string | null;
  lot_id: string | null;
  vessel_id: string | null;
  product_id: string | null;
  wine_id: string | null;
  vintage: number | null;
}> {
  const link = {
    parcel_id: command.parcel_id,
    lot_id: command.lot_id,
    vessel_id: command.vessel_id,
    product_id: command.product_id,
    wine_id: command.wine_id,
    vintage: command.vintage,
  };
  if (link.parcel_id) await requireRow(tx, 'vineyard.parcel', link.parcel_id, 'parcel_id');
  if (link.lot_id) {
    const lot = await loadLot(tx, link.lot_id);
    if (!lot) invalid({ lot_id: 'El lote no existe' });
    if (link.wine_id && lot.wine_id && link.wine_id !== lot.wine_id) {
      throw domainError('WC_TASTING_SUBJECT', { wine_id: 'No coincide con el vino del lote' });
    }
    if (!link.wine_id && lot.wine_id) link.wine_id = lot.wine_id;
    if (link.vintage == null && lot.vintage != null) link.vintage = lot.vintage;
  }
  if (link.vessel_id) await requireRow(tx, 'cellar.vessel', link.vessel_id, 'vessel_id');
  if (link.product_id) {
    const product = await loadProduct(tx, link.product_id);
    if (!product) invalid({ product_id: 'El producto no existe' });
    if (link.wine_id && product.wine_id && link.wine_id !== product.wine_id) {
      throw domainError('WC_TASTING_SUBJECT', { wine_id: 'No coincide con el vino del producto' });
    }
    if (!link.wine_id && product.wine_id) link.wine_id = product.wine_id;
    if (link.vintage == null && product.vintage != null) link.vintage = product.vintage;
  }
  if (link.wine_id) await requireRow(tx, 'catalog.wine', link.wine_id, 'wine_id');
  if (link.vintage != null && (link.vintage < 1990 || link.vintage > 2100)) {
    invalid({ vintage: 'La añada está fuera de rango' });
  }
  const gap = subjectGap(subject, link);
  if (gap) throw domainError('WC_TASTING_SUBJECT', { subject: gap });
  return link;
}

export async function resolveTaster(
  tx: Tx,
  userId: string | null,
  name: string | null,
  actorId: string,
): Promise<{ userId: string | null; name: string }> {
  if (userId) {
    const display = await loadUserName(tx, userId);
    if (!display) invalid({ taster_user_id: 'El catador no existe' });
    return { userId, name: name ?? display };
  }
  if (name) return { userId: null, name };
  if (isUuid(actorId)) {
    const display = await loadUserName(tx, actorId);
    if (display) return { userId: actorId.toLowerCase(), name: display };
  }
  invalid({ taster_name: 'Indica quién cata' });
}

async function codesOf(
  tx: Tx,
  codes: readonly string[],
  field: string,
  family: 'defect' | null,
): Promise<string[]> {
  if (codes.length > 20) invalid({ [field]: 'Demasiados códigos' });
  const normalized = codes.map((code) => code.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) invalid({ [field]: 'Hay un código repetido' });
  if (normalized.length === 0) return [];
  const rows = await tx.read<Record<string, unknown>>(`SELECT code, family, is_active FROM tasting.descriptor`);
  const known = new Map(rows.map((row) => [asText(row.code), { family: asText(row.family), active: asBool(row.is_active) }]));
  for (const code of normalized) {
    const descriptor = known.get(code);
    if (!descriptor || !descriptor.active) invalid({ [field]: `Descriptor no reconocido: ${code}` });
    if (family && descriptor.family !== family) invalid({ [field]: `${code} no es un defecto` });
  }
  return normalized;
}

function linkAttachment(tx: Tx, noteId: string, attachmentId: string, role: 'photo' | 'other', createdBy: string): void {
  const linkId = newId();
  tx.write(sql`
    INSERT INTO core.attachment_link (id, attachment_id, entity_table, entity_id, role, created_by)
    VALUES (
      CAST(${linkId} AS UUID), CAST(${attachmentId} AS UUID), ${'tasting.note'},
      CAST(${noteId} AS UUID), ${role}, ${createdBy}
    )
  `);
  tx.audit({
    table: 'core.attachment_link',
    rowId: linkId,
    action: 'INSERT',
    before: null,
    after: { attachment_id: attachmentId, entity_table: 'tasting.note', entity_id: noteId, role },
  });
}

function scoreOrNull(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean' || (typeof value !== 'number' && typeof value !== 'string')) {
    invalid({ [field]: 'Debe ser un número' });
  }
  return typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
}

function vintageOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) invalid({ vintage: 'Debe ser un año' });
  return value;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalid({ [field]: 'Debe ser una lista' });
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') invalid({ [field]: 'Cada elemento es un texto' });
    return item.trim();
  });
}

function uniqueIds(ids: readonly string[], field: string): string[] {
  const normalized = ids.map((id) => {
    if (!isUuid(id)) invalid({ [field]: 'Debe ser un UUID' });
    return id.toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) invalid({ [field]: 'Hay un adjunto repetido' });
  return normalized;
}

function mergeAnswers(current: Record<string, unknown>, record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  if (record.values !== undefined) Object.assign(next, requireObject(record.values));
  for (const key of ['place', 'glass', 'context', 'evolution'] as const) {
    if (record[key] !== undefined) next[key] = record[key];
  }
  return next;
}

function optionalQueryUuid(url: URL, field: string): string | null {
  const raw = url.searchParams.get(field);
  if (raw === null || raw.trim() === '') return null;
  return optionalUuid(raw, field);
}

function limitOf(value: string | null): number {
  if (value === null || value.trim() === '') return 100;
  if (!/^\d{1,3}$/.test(value)) invalid({ limit: 'Debe ser un entero entre 1 y 200' });
  const parsed = Number(value);
  if (parsed < 1 || parsed > 200) invalid({ limit: 'Debe ser un entero entre 1 y 200' });
  return parsed;
}

function noteSelect(): string {
  return `
    SELECT n.id::VARCHAR AS id, n.template_id::VARCHAR AS template_id, t.code AS template_code,
           n.tasted_at, n.taster_user_id::VARCHAR AS taster_user_id, n.taster_name, n.subject,
           n.parcel_id::VARCHAR AS parcel_id, n.lot_id::VARCHAR AS lot_id, n.vessel_id::VARCHAR AS vessel_id,
           n.product_id::VARCHAR AS product_id, n.wine_id::VARCHAR AS wine_id, n.vintage,
           n.score_scale, n.visual_score, n.nose_score, n.mouth_score, n.overall_score,
           n.descriptors, n.descriptors_text, n.defects, n.decision, n.notes, n.voice_transcript,
           n.place, n.glass, n.context, n.evolution, n.answers, n.source,
           n.created_by, n.created_at, n.updated_at
    FROM tasting.note n
    JOIN tasting.template t ON t.id = n.template_id
  `;
}

async function noteOf(writer: Writer, row: Record<string, unknown>): Promise<NoteView> {
  const id = asId(row.id);
  const links = await listLinks((statement) => writer.read(statement), 'tasting.note', id);
  const subject = asText(row.subject);
  const scale = asText(row.score_scale);
  const source = asText(row.source);
  if (!isSubjectValue(subject) || (scale !== '0-10' && scale !== '0-100') || !isSource(source)) {
    throw domainError('WC_TASTING_TEMPLATE', { id: 'Nota ilegible' });
  }
  return {
    id,
    template_id: asId(row.template_id),
    template_code: asText(row.template_code),
    tasted_at: asInstant(row.tasted_at),
    taster_user_id: row.taster_user_id == null ? null : asId(row.taster_user_id),
    taster_name: asText(row.taster_name),
    subject,
    parcel_id: row.parcel_id == null ? null : asId(row.parcel_id),
    lot_id: row.lot_id == null ? null : asId(row.lot_id),
    vessel_id: row.vessel_id == null ? null : asId(row.vessel_id),
    product_id: row.product_id == null ? null : asId(row.product_id),
    wine_id: row.wine_id == null ? null : asId(row.wine_id),
    vintage: asInt(row.vintage),
    score_scale: scale,
    visual_score: asNumber(row.visual_score),
    nose_score: asNumber(row.nose_score),
    mouth_score: asNumber(row.mouth_score),
    overall_score: asNumber(row.overall_score),
    descriptors: asStringList(row.descriptors),
    descriptors_text: row.descriptors_text == null ? null : asText(row.descriptors_text),
    defects: asStringList(row.defects),
    decision: row.decision == null ? null : asText(row.decision),
    notes: row.notes == null ? null : asText(row.notes),
    voice_transcript: row.voice_transcript == null ? null : asText(row.voice_transcript),
    place: row.place == null ? null : asText(row.place),
    glass: row.glass == null ? null : asText(row.glass),
    context: row.context == null ? null : asText(row.context),
    evolution: row.evolution == null ? null : asText(row.evolution),
    values: asJsonObject(row.answers),
    source,
    attachments: links.map((link) => ({ id: link.id, role: link.role, filename: link.filename })),
    created_by: asText(row.created_by),
    created_at: asInstant(row.created_at),
    updated_at: asInstant(row.updated_at),
  };
}

function isSubjectValue(value: string): value is Subject {
  return value === 'grape' || value === 'must' || value === 'wine_aging' || value === 'blend_candidate' || value === 'bottle';
}

export async function resolveCodeLink(
  read: { read<T>(statement: string): Promise<T[]> },
  codes: { lot_code?: string | null; parcel_code?: string | null; vessel_code?: string | null; wine_code?: string | null },
): Promise<{ lot_id: string | null; parcel_id: string | null; vessel_id: string | null; wine_id: string | null; vintage: number | null }> {
  let lotId: string | null = null;
  let vintage: number | null = null;
  if (codes.lot_code) {
    const lot = await findLotByCode(read, codes.lot_code);
    if (!lot) invalid({ lot_code: 'El lote no existe' });
    lotId = lot.id;
    vintage = lot.vintage;
  }
  const parcelId = codes.parcel_code ? await findByCode(read, 'vineyard.parcel', codes.parcel_code, 'parcel_code') : null;
  if (codes.parcel_code && !parcelId) invalid({ parcel_code: 'La parcela no existe' });
  const vesselId = codes.vessel_code ? await findByCode(read, 'cellar.vessel', codes.vessel_code, 'vessel_code') : null;
  if (codes.vessel_code && !vesselId) invalid({ vessel_code: 'El recipiente no existe' });
  const wineId = codes.wine_code ? await findByCode(read, 'catalog.wine', codes.wine_code, 'wine_code') : null;
  if (codes.wine_code && !wineId) invalid({ wine_code: 'El vino no existe' });
  return { lot_id: lotId, parcel_id: parcelId, vessel_id: vesselId, wine_id: wineId, vintage };
}
