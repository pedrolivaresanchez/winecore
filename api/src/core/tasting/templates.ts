import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { asBool, asId, asInstant, asJsonArray, asNumber, asText } from './rows';
import {
  isDescriptorFamily,
  isFieldKind,
  type DescriptorFamily,
  type FieldKind,
  type ScoreScale,
  type Subject,
} from './types';
import {
  fieldSpec,
  invalid,
  rejectUnknown,
  requireBool,
  requireObject,
  requireScale,
  requireSubject,
  requireText,
  templateCode,
  type StoredField,
} from './validate';

export interface FieldView extends StoredField {}

export interface TemplateView {
  id: string;
  code: string;
  name: string;
  subject: Subject;
  score_scale: ScoreScale;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  fields: FieldView[];
}

export interface DescriptorView {
  code: string;
  name_es: string;
  family: DescriptorFamily;
  is_active: boolean;
}

const TEMPLATE_PATCH = ['name', 'score_scale', 'is_active'];
const FIELD_PATCH = ['label', 'kind', 'required', 'position', 'options', 'min_value', 'max_value', 'unit', 'help', 'is_active'];
const DESCRIPTOR_PATCH = ['name_es', 'is_active'];

export async function listTemplates(writer: Writer, request: Request): Promise<{ items: TemplateView[] }> {
  const url = new URL(request.url);
  const subject = url.searchParams.get('subject');
  const code = url.searchParams.get('code');
  const where: string[] = ['TRUE'];
  if (subject) where.push(sql`t.subject = ${subject}`);
  if (code) where.push(sql`t.code = ${code.trim().toUpperCase()}`);
  const templates = await writer.read<Record<string, unknown>>(
    `SELECT t.id::VARCHAR AS id, t.code, t.name, t.subject, t.score_scale, t.is_active,
            t.created_by, t.created_at, t.updated_at
     FROM tasting.template t
     WHERE ${where.join(' AND ')}
     ORDER BY t.subject, t.code`,
  );
  const fields = await loadFields(writer, templates.map((row) => asId(row.id)));
  return { items: templates.map((row) => templateOf(row, fields)) };
}

export async function getTemplate(writer: Writer, id: string): Promise<TemplateView> {
  const row = await oneTemplate(writer, id);
  const fields = await loadFields(writer, [asId(row.id)]);
  return templateOf(row, fields);
}

export async function createTemplate(writer: Writer, actor: Actor, body: unknown): Promise<TemplateView> {
  const record = requireObject(body);
  rejectUnknown(record, ['code', 'name', 'subject', 'score_scale', 'fields']);
  const code = templateCode(record.code);
  const name = requireText(record.name, 'name', 120);
  const subject = requireSubject(record.subject);
  const scale = requireScale(record.score_scale);
  const fields = Array.isArray(record.fields) ? record.fields.map((item) => fieldSpec(requireObject(item))) : [];
  assertUniqueKeys(fields.map((field) => field.field_key));
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM tasting.template WHERE code = ${code} LIMIT 1`);
    if (existing[0]) invalid({ code: 'Ya existe una plantilla con este código' });
    tx.write(sql`
      INSERT INTO tasting.template (id, code, name, subject, score_scale, created_by)
      VALUES (CAST(${id} AS UUID), ${code}, ${name}, ${subject}, ${scale}, ${actor.id})
    `);
    tx.audit({
      table: 'tasting.template',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { code, name, subject, score_scale: scale },
    });
    for (const field of fields) insertField(tx, id, field);
  });
  return getTemplate(writer, id);
}

export async function patchTemplate(writer: Writer, actor: Actor, id: string, body: unknown): Promise<TemplateView> {
  const record = requireObject(body);
  rejectUnknown(record, [...TEMPLATE_PATCH, 'code', 'subject']);
  if ('code' in record) invalid({ code: 'El código de la plantilla no se cambia' });
  if ('subject' in record) invalid({ subject: 'El sujeto de la plantilla no se cambia' });
  if (Object.keys(record).length === 0) invalid({ body: 'No hay cambios' });
  const current = await getTemplate(writer, id);
  const name = record.name === undefined ? current.name : requireText(record.name, 'name', 120);
  const scale = record.score_scale === undefined ? current.score_scale : requireScale(record.score_scale);
  const active = record.is_active === undefined ? current.is_active : requireBool(record.is_active, 'is_active');
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE tasting.template
      SET name = ${name}, score_scale = ${scale}, is_active = ${active}, updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
    tx.audit({
      table: 'tasting.template',
      rowId: id,
      action: 'UPDATE',
      before: { name: current.name, score_scale: current.score_scale, is_active: current.is_active },
      after: { name, score_scale: scale, is_active: active },
    });
  });
  return getTemplate(writer, id);
}

export async function addField(writer: Writer, actor: Actor, templateId: string, body: unknown): Promise<TemplateView> {
  await getTemplate(writer, templateId);
  const spec = fieldSpec(requireObject(body));
  await writer.withWrite(actor, async (tx) => {
    const clash = await tx.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM tasting.template_field
      WHERE template_id = CAST(${templateId} AS UUID) AND field_key = ${spec.field_key}
      LIMIT 1
    `);
    if (clash[0]) invalid({ field_key: 'Ya existe ese campo en la plantilla' });
    insertField(tx, templateId, spec);
    touchTemplate(tx, templateId);
  });
  return getTemplate(writer, templateId);
}

export async function patchField(
  writer: Writer,
  actor: Actor,
  templateId: string,
  fieldId: string,
  body: unknown,
): Promise<TemplateView> {
  const record = requireObject(body);
  rejectUnknown(record, [...FIELD_PATCH, 'field_key']);
  if ('field_key' in record) invalid({ field_key: 'La clave del campo no se cambia' });
  if (Object.keys(record).length === 0) invalid({ body: 'No hay cambios' });
  const current = await getTemplate(writer, templateId);
  const field = current.fields.find((item) => item.id === fieldId.toLowerCase());
  if (!field) throw domainError('WC_NOT_FOUND');
  const merged = fieldSpec({
    field_key: field.field_key,
    label: record.label === undefined ? field.label : record.label,
    kind: record.kind === undefined ? field.kind : record.kind,
    required: record.required === undefined ? field.required : record.required,
    position: record.position === undefined ? field.position : record.position,
    options: record.options === undefined ? field.options : record.options,
    min_value: record.min_value === undefined ? field.min_value : record.min_value,
    max_value: record.max_value === undefined ? field.max_value : record.max_value,
    unit: record.unit === undefined ? field.unit : record.unit,
    help: record.help === undefined ? field.help : record.help,
  });
  const active = record.is_active === undefined ? field.is_active : requireBool(record.is_active, 'is_active');
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE tasting.template_field
      SET label = ${merged.label},
          kind = ${merged.kind},
          required = ${merged.required},
          position = ${merged.position},
          options = ${merged.options == null ? null : sql.json(merged.options)},
          min_value = ${merged.min_value},
          max_value = ${merged.max_value},
          unit = ${merged.unit},
          help = ${merged.help},
          is_active = ${active}
      WHERE id = CAST(${field.id} AS UUID)
        AND template_id = CAST(${templateId} AS UUID)
    `);
    tx.audit({
      table: 'tasting.template_field',
      rowId: field.id,
      action: 'UPDATE',
      before: { label: field.label, position: field.position, required: field.required, is_active: field.is_active },
      after: { label: merged.label, position: merged.position, required: merged.required, is_active: active },
    });
    touchTemplate(tx, templateId);
  });
  return getTemplate(writer, templateId);
}

export async function listDescriptors(writer: Writer): Promise<{ items: DescriptorView[] }> {
  const rows = await writer.read<Record<string, unknown>>(
    `SELECT code, name_es, family, is_active FROM tasting.descriptor ORDER BY family, code`,
  );
  return { items: rows.map(descriptorOf) };
}

export async function createDescriptor(writer: Writer, actor: Actor, body: unknown): Promise<DescriptorView> {
  const record = requireObject(body);
  rejectUnknown(record, ['code', 'name_es', 'family']);
  const code = requireText(record.code, 'code', 41).toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(code)) invalid({ code: 'Solo minúsculas, números y guion bajo' });
  const name = requireText(record.name_es, 'name_es', 80);
  if (typeof record.family !== 'string' || !isDescriptorFamily(record.family)) {
    invalid({ family: 'Familia no reconocida' });
  }
  const family = record.family;
  await writer.withWrite(actor, async (tx) => {
    const existing = await tx.read<{ code: string }>(sql`SELECT code FROM tasting.descriptor WHERE code = ${code} LIMIT 1`);
    if (existing[0]) invalid({ code: 'Ya existe ese descriptor' });
    tx.write(sql`
      INSERT INTO tasting.descriptor (code, name_es, family) VALUES (${code}, ${name}, ${family})
    `);
    tx.audit({
      table: 'tasting.descriptor',
      rowId: code,
      action: 'INSERT',
      before: null,
      after: { code, name_es: name, family },
    });
  });
  return { code, name_es: name, family, is_active: true };
}

export async function patchDescriptor(writer: Writer, actor: Actor, code: string, body: unknown): Promise<DescriptorView> {
  const record = requireObject(body);
  rejectUnknown(record, DESCRIPTOR_PATCH);
  if (Object.keys(record).length === 0) invalid({ body: 'No hay cambios' });
  const current = (await listDescriptors(writer)).items.find((item) => item.code === code);
  if (!current) throw domainError('WC_NOT_FOUND');
  const name = record.name_es === undefined ? current.name_es : requireText(record.name_es, 'name_es', 80);
  const active = record.is_active === undefined ? current.is_active : requireBool(record.is_active, 'is_active');
  await writer.withWrite(actor, async (tx) => {
    tx.write(sql`
      UPDATE tasting.descriptor SET name_es = ${name}, is_active = ${active} WHERE code = ${code}
    `);
    tx.audit({
      table: 'tasting.descriptor',
      rowId: code,
      action: 'UPDATE',
      before: { name_es: current.name_es, is_active: current.is_active },
      after: { name_es: name, is_active: active },
    });
  });
  return { code, name_es: name, family: current.family, is_active: active };
}

export async function loadTemplateFields(read: { read<T>(sql: string): Promise<T[]> }, templateId: string): Promise<StoredField[]> {
  const grouped = await loadFields(read, [templateId]);
  return grouped.get(templateId) ?? [];
}

async function oneTemplate(read: { read<T>(sql: string): Promise<T[]> }, id: string): Promise<Record<string, unknown>> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) invalid({ id: 'Debe ser un UUID' });
  const rows = await read.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, name, subject, score_scale, is_active, created_by, created_at, updated_at
    FROM tasting.template
    WHERE id = CAST(${id} AS UUID)
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function loadFields(
  read: { read<T>(sql: string): Promise<T[]> },
  templateIds: readonly string[],
): Promise<Map<string, FieldView[]>> {
  const grouped = new Map<string, FieldView[]>();
  if (templateIds.length === 0) return grouped;
  const list = templateIds.map((id) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) invalid({ template_id: 'Debe ser un UUID' });
    return sql`CAST(${id} AS UUID)`;
  }).join(', ');
  const rows = await read.read<Record<string, unknown>>(
    `SELECT id::VARCHAR AS id, template_id::VARCHAR AS template_id, field_key, label, kind,
            required, position, options, min_value, max_value, unit, help, is_active
     FROM tasting.template_field
     WHERE template_id IN (${list})
     ORDER BY position, field_key`,
  );
  for (const row of rows) {
    const templateId = asId(row.template_id);
    const listForTemplate = grouped.get(templateId) ?? [];
    listForTemplate.push(fieldOf(row));
    grouped.set(templateId, listForTemplate);
  }
  return grouped;
}

function insertField(tx: Tx, templateId: string, field: ReturnType<typeof fieldSpec>): void {
  const id = newId();
  tx.write(sql`
    INSERT INTO tasting.template_field (
      id, template_id, field_key, label, kind, required, position, options, min_value, max_value, unit, help
    ) VALUES (
      CAST(${id} AS UUID), CAST(${templateId} AS UUID), ${field.field_key}, ${field.label}, ${field.kind},
      ${field.required}, ${field.position}, ${field.options == null ? null : sql.json(field.options)},
      ${field.min_value}, ${field.max_value}, ${field.unit}, ${field.help}
    )
  `);
  tx.audit({
    table: 'tasting.template_field',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { template_id: templateId, field_key: field.field_key, position: field.position, required: field.required },
  });
}

function touchTemplate(tx: Tx, templateId: string): void {
  tx.write(sql`UPDATE tasting.template SET updated_at = now() WHERE id = CAST(${templateId} AS UUID)`);
}

function assertUniqueKeys(keys: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) invalid({ field_key: 'Hay un campo repetido' });
    seen.add(key);
  }
}

function templateOf(row: Record<string, unknown>, fields: Map<string, FieldView[]>): TemplateView {
  const id = asId(row.id);
  const subject = asText(row.subject);
  const scale = asText(row.score_scale);
  if (!requireKnownSubject(subject) || (scale !== '0-10' && scale !== '0-100')) {
    throw domainError('WC_TASTING_TEMPLATE', { id: 'Plantilla ilegible' });
  }
  return {
    id,
    code: asText(row.code),
    name: asText(row.name),
    subject,
    score_scale: scale,
    is_active: asBool(row.is_active),
    created_by: asText(row.created_by),
    created_at: asInstant(row.created_at),
    updated_at: asInstant(row.updated_at),
    fields: fields.get(id) ?? [],
  };
}

function requireKnownSubject(value: string): value is Subject {
  return value === 'grape' || value === 'must' || value === 'wine_aging' || value === 'blend_candidate' || value === 'bottle';
}

function fieldOf(row: Record<string, unknown>): FieldView {
  const kind = asText(row.kind);
  if (!isFieldKind(kind)) throw domainError('WC_TASTING_TEMPLATE', { field_key: 'Tipo de campo ilegible' });
  const options = asJsonArray(row.options).filter((item): item is string => typeof item === 'string');
  return {
    id: asId(row.id),
    field_key: asText(row.field_key),
    label: asText(row.label),
    kind: kind as FieldKind,
    required: asBool(row.required),
    position: asNumber(row.position) ?? 0,
    options: options.length > 0 ? options : null,
    min_value: asNumber(row.min_value),
    max_value: asNumber(row.max_value),
    unit: row.unit == null ? null : asText(row.unit),
    help: row.help == null ? null : asText(row.help),
    is_active: asBool(row.is_active),
  };
}

function descriptorOf(row: Record<string, unknown>): DescriptorView {
  const family = asText(row.family);
  if (!isDescriptorFamily(family)) throw domainError('WC_TASTING_TEMPLATE', { code: 'Descriptor ilegible' });
  return {
    code: asText(row.code),
    name_es: asText(row.name_es),
    family,
    is_active: asBool(row.is_active),
  };
}

export async function findTemplate(read: { read<T>(sql: string): Promise<T[]> }, hint: { id?: string | null; code?: string | null }): Promise<TemplateView> {
  if (hint.id) {
    const row = await oneTemplate(read, hint.id);
    const fields = await loadFields(read, [asId(row.id)]);
    return templateOf(row, fields);
  }
  if (hint.code) {
    const rows = await read.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, code, name, subject, score_scale, is_active, created_by, created_at, updated_at
      FROM tasting.template WHERE code = ${hint.code} LIMIT 1
    `);
    const row = rows[0];
    if (!row) invalid({ template_code: 'No existe esa plantilla' });
    const fields = await loadFields(read, [asId(row.id)]);
    return templateOf(row, fields);
  }
  invalid({ template_code: 'Indica la plantilla' });
}
