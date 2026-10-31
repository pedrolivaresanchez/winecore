import { domainError } from '../errors';
import { asNumber } from './rows';
import {
  isEvolution,
  isFieldKind,
  isScoreScale,
  isSubject,
  scoreMax,
  type FieldKind,
  type ScoreScale,
  type Subject,
} from './types';

const CODE = /^[a-z][a-z0-9_]{0,40}$/;
const TEMPLATE_CODE = /^[A-Z0-9-]{2,20}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FieldSpec {
  field_key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  position: number;
  options: string[] | null;
  min_value: number | null;
  max_value: number | null;
  unit: string | null;
  help: string | null;
}

export interface StoredField extends FieldSpec {
  id: string;
  is_active: boolean;
}

export function invalid(fields: Record<string, string>, message?: string): never {
  throw domainError('WC_VALIDATION', fields, message);
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid({ [field]: 'Debe ser un UUID' });
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value, field);
}

export function requireObject(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    invalid({ body: 'El cuerpo debe ser un objeto' });
  }
  return body as Record<string, unknown>;
}

export function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) invalid({ [key]: 'Campo no reconocido' });
  }
}

export function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') invalid({ [field]: 'Debe ser un texto' });
  const trimmed = value.trim();
  if (trimmed.length === 0) invalid({ [field]: 'Es obligatorio' });
  if (trimmed.length > max) invalid({ [field]: `Máximo ${max} caracteres` });
  return trimmed;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  return requireText(value, field, max);
}

export function templateCode(value: unknown, field = 'code'): string {
  if (typeof value !== 'string' || !TEMPLATE_CODE.test(value.trim().toUpperCase())) {
    invalid({ [field]: 'Debe cumplir ^[A-Z0-9-]{2,20}$' });
  }
  return value.trim().toUpperCase();
}

export function requireSubject(value: unknown): Subject {
  if (typeof value !== 'string' || !isSubject(value)) {
    invalid({ subject: 'Sujeto de cata no reconocido' });
  }
  return value;
}

export function requireScale(value: unknown, field = 'score_scale'): ScoreScale {
  if (typeof value !== 'string' || !isScoreScale(value)) {
    invalid({ [field]: 'La escala es 0-10 o 0-100' });
  }
  return value;
}

export function requireInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !INSTANT.test(value.trim())) {
    invalid({ [field]: 'Debe ser una fecha y hora con zona, por ejemplo 2026-09-01T08:00:00Z' });
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) invalid({ [field]: 'Fecha no válida' });
  return parsed.toISOString();
}

export function requireDay(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DAY.test(value.trim())) {
    invalid({ [field]: 'Debe ser una fecha YYYY-MM-DD' });
  }
  return value.trim();
}

export function requireBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid({ [field]: 'Debe ser verdadero o falso' });
  return value;
}

export function parseScore(value: unknown, field: string, scale: ScoreScale): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') {
    throw domainError('WC_TASTING_SCORE', { [field]: 'Debe ser un número' });
  }
  const text = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim().replace(',', '.')
      : '';
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) {
    throw domainError('WC_TASTING_SCORE', { [field]: 'Debe ser un número entre 0 y el máximo de la escala, con hasta dos decimales' });
  }
  const parsed = Number(text);
  const max = scoreMax(scale);
  if (parsed > max) {
    throw domainError('WC_TASTING_SCORE', { [field]: `Debe estar entre 0 y ${max}` });
  }
  return parsed;
}

export function subjectGap(subject: Subject, link: {
  parcel_id: string | null;
  lot_id: string | null;
  wine_id: string | null;
  product_id: string | null;
}): string | null {
  if (subject === 'grape' && !link.parcel_id) return 'La cata de uva en viña exige una parcela';
  if (subject === 'must' && !link.lot_id) return 'La cata de mosto exige un lote';
  if (subject === 'wine_aging' && !link.lot_id) return 'La cata de crianza exige un lote';
  if (subject === 'blend_candidate' && !link.lot_id) return 'La cata de candidato a ensamblaje exige un lote';
  if (subject === 'bottle' && !link.lot_id && !link.wine_id && !link.product_id) {
    return 'La nota de botella exige un vino, un producto o un lote';
  }
  return null;
}

export function fieldSpec(body: Record<string, unknown>): FieldSpec {
  const fieldKey = requireText(body.field_key, 'field_key', 41);
  if (!CODE.test(fieldKey)) invalid({ field_key: 'Solo minúsculas, números y guion bajo' });
  const label = requireText(body.label, 'label', 120);
  if (typeof body.kind !== 'string' || !isFieldKind(body.kind)) invalid({ kind: 'Tipo de campo no reconocido' });
  const kind = body.kind;
  const required = body.required === undefined ? false : requireBool(body.required, 'required');
  const position = integerIn(body.position, 'position', 0, 1000);
  const unit = optionalText(body.unit, 'unit', 20);
  const help = optionalText(body.help, 'help', 400);
  const options = kind === 'select' ? selectOptions(body.options) : null;
  if (kind !== 'select' && body.options !== undefined && body.options !== null) {
    invalid({ options: 'Solo los campos de lista llevan opciones' });
  }
  const bounded = kind === 'number' || kind === 'integer' || kind === 'scale';
  const minValue = bounded ? requiredBound(body.min_value, 'min_value') : emptyBound(body.min_value, 'min_value');
  const maxValue = bounded ? requiredBound(body.max_value, 'max_value') : emptyBound(body.max_value, 'max_value');
  if (minValue != null && maxValue != null && minValue > maxValue) {
    invalid({ max_value: 'El máximo no puede ser menor que el mínimo' });
  }
  return {
    field_key: fieldKey,
    label,
    kind,
    required,
    position,
    options,
    min_value: minValue,
    max_value: maxValue,
    unit,
    help,
  };
}

export function validateAnswers(
  fields: readonly StoredField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const active = fields.filter((field) => field.is_active);
  const known = new Set(active.map((field) => field.field_key));
  const problems: Record<string, string> = {};
  for (const key of Object.keys(values)) {
    if (!known.has(key)) problems[`values.${key}`] = 'Campo desconocido en la plantilla';
  }
  const normalized: Record<string, unknown> = {};
  for (const field of active) {
    const raw = values[field.field_key];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) problems[`values.${field.field_key}`] = 'Es obligatorio';
      continue;
    }
    const parsed = coerceField(field, raw);
    if (typeof parsed === 'string') problems[`values.${field.field_key}`] = parsed;
    else normalized[field.field_key] = parsed.value;
  }
  if (Object.keys(problems).length > 0) throw domainError('WC_TASTING_TEMPLATE', problems);
  return normalized;
}

export function bottleColumns(answers: Record<string, unknown>): {
  place: string | null;
  glass: string | null;
  context: string | null;
  evolution: string | null;
} {
  return {
    place: typeof answers.place === 'string' ? answers.place : null,
    glass: typeof answers.glass === 'string' ? answers.glass : null,
    context: typeof answers.context === 'string' ? answers.context : null,
    evolution: typeof answers.evolution === 'string' && isEvolution(answers.evolution) ? answers.evolution : null,
  };
}

function coerceField(field: StoredField, raw: unknown): { value: unknown } | string {
  if (field.kind === 'text') {
    if (typeof raw !== 'string') return 'Debe ser un texto';
    const trimmed = raw.trim();
    if (trimmed.length === 0) return field.required ? 'Es obligatorio' : 'El texto está vacío';
    if (trimmed.length > 2000) return 'Máximo 2000 caracteres';
    return { value: trimmed };
  }
  if (field.kind === 'boolean') {
    if (typeof raw !== 'boolean') return 'Debe ser verdadero o falso';
    return { value: raw };
  }
  if (field.kind === 'date') {
    if (typeof raw !== 'string' || !DAY.test(raw.trim())) return 'Debe ser una fecha YYYY-MM-DD';
    return { value: raw.trim() };
  }
  if (field.kind === 'select') {
    if (typeof raw !== 'string' || !field.options?.includes(raw)) return 'Opción no reconocida';
    return { value: raw };
  }
  const parsed = asNumber(raw);
  if (parsed == null) return 'Debe ser un número';
  if ((field.kind === 'integer' || field.kind === 'scale') && field.kind === 'integer' && !Number.isInteger(parsed)) {
    return 'Debe ser un entero';
  }
  if (field.kind === 'integer' && !Number.isInteger(parsed)) return 'Debe ser un entero';
  if (field.min_value != null && parsed < field.min_value) return `Mínimo ${field.min_value}`;
  if (field.max_value != null && parsed > field.max_value) return `Máximo ${field.max_value}`;
  if (typeof raw === 'number' && String(raw).includes('e')) return 'Número fuera de rango';
  return { value: parsed };
}

function selectOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    invalid({ options: 'La lista de opciones es obligatoria' });
  }
  const options: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !CODE.test(item)) invalid({ options: 'Cada opción es un código en minúsculas' });
    if (options.includes(item)) invalid({ options: 'Hay una opción repetida' });
    options.push(item);
  }
  return options;
}

function requiredBound(value: unknown, field: string): number {
  const parsed = asNumber(value);
  if (parsed == null) invalid({ [field]: 'Es obligatorio' });
  return parsed;
}

function emptyBound(value: unknown, field: string): null {
  if (value === undefined || value === null) return null;
  invalid({ [field]: 'Este tipo de campo no lleva mínimo ni máximo' });
}

function integerIn(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    invalid({ [field]: `Debe ser un entero entre ${min} y ${max}` });
  }
  return value;
}
