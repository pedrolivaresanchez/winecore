import { newId } from '../ids';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import {
  LOSS_SEEDS,
  PARAMETER_CODES,
  PARAMETER_SEEDS,
  SOURCE,
  SO2_SEEDS,
  TEMPLATE_ENTITY,
  VALID_FROM,
  isProcess,
  isProductState,
} from './defaults';
import { decimalText, plain, q } from './qty';
import { dayText, flag, fold } from './text';
import {
  isPending,
  pendingKeys,
  statusLabel,
  type Basis,
  type CellarProcess,
  type LossToleranceView,
  type ParameterView,
  type PracticeView,
  type ProductState,
  type RequiredAnalysisView,
  type SettingsView,
  type So2LimitView,
  type Warning,
  type So2Scope,
  type SugarBand,
  type WineColor,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

const TEXT_CODES = new Set(['bottling_analysis_mode']);

const RANGE: Record<string, { min: string; max: string; integer?: boolean; nullable?: boolean }> = {
  molecular_so2_tinto_mg_l: { min: '0.01', max: '2' },
  molecular_so2_blanco_mg_l: { min: '0.01', max: '2' },
  molecular_so2_rosado_mg_l: { min: '0.01', max: '2' },
  density_alcohol_factor: { min: '1', max: '30' },
  volatile_acidity_alert_g_l: { min: '0', max: '2' },
  volatile_acidity_legal_max_g_l: { min: '0', max: '2', nullable: true },
  dryness_glucose_fructose_g_l: { min: '0', max: '50' },
  malolactic_malic_g_l: { min: '0', max: '10' },
  pre_bottling_freshness_days: { min: '1', max: '365', integer: true },
  winter_racking_month_from: { min: '1', max: '12', integer: true },
  winter_racking_month_to: { min: '1', max: '12', integer: true },
  bottling_reminder_month_from: { min: '1', max: '12', integer: true },
  bottling_reminder_month_to: { min: '1', max: '12', integer: true },
};

interface Reader {
  read<T = Record<string, unknown>>(statement: string): Promise<T[]>;
}

interface ParameterRow {
  id: string;
  entityOwned: boolean;
  code: string;
  value: string | null;
  valueText: string | null;
  unit: string | null;
  basis: Basis;
  sourceRef: string;
  validFrom: string;
  confirmed: boolean;
}

interface So2Row {
  id: string;
  entityOwned: boolean;
  scope: So2Scope;
  wineColor: WineColor;
  sugarBand: SugarBand;
  sugarMin: string;
  sugarMax: string | null;
  limitMgL: string | null;
  basis: Basis;
  sourceRef: string;
  note: string | null;
  validFrom: string;
  confirmed: boolean;
}

interface LossRow {
  id: string;
  entityOwned: boolean;
  process: CellarProcess;
  productState: ProductState;
  maxPct: string | null;
  basis: Basis;
  sourceRef: string;
  validFrom: string;
  confirmed: boolean;
}

interface PracticeRow {
  id: string;
  entityOwned: boolean;
  nameEs: string;
  nameKey: string;
  matchTerms: string[];
  active: boolean;
  basis: Basis;
  sourceRef: string;
  confirmed: boolean;
}

interface RequiredRow {
  id: string;
  entityOwned: boolean;
  code: string;
  nameEs: string;
  active: boolean;
  sortOrder: number;
}

interface Bundle {
  parameters: ParameterRow[];
  so2: So2Row[];
  loss: LossRow[];
  practices: PracticeRow[];
  required: RequiredRow[];
}

export async function readSettings(reader: Reader, legalEntityId: string): Promise<SettingsView> {
  const entityId = await existingEntity(reader, legalEntityId);
  const bundle = await loadBundle(reader, entityId);
  return toView(entityId, bundle);
}

/** Sin entidad usa la plantilla global (los SUPUESTO siguen pendientes de confirmar). */
export async function readEffective(reader: Reader, legalEntityId: string | null): Promise<SettingsView> {
  if (legalEntityId === null) return toView(TEMPLATE_ENTITY, await loadBundle(reader, TEMPLATE_ENTITY));
  return readSettings(reader, legalEntityId);
}

export async function writeSettings(
  tx: Tx,
  actorId: string,
  body: unknown,
  now: Date,
): Promise<SettingsView & { warnings: Warning[] }> {
  const entityId = entityIdOf(body);
  await existingEntity(tx, entityId);
  const before = await loadBundle(tx, entityId);
  const after = applyPut(before, body, entityId, uuidOrNull(actorId), now);
  const beforeView = toView(entityId, before);
  const afterView = toView(entityId, after.bundle);
  if (JSON.stringify(beforeView) === JSON.stringify(afterView)) {
    throw domainError('WC_VALIDATION', { body: 'No hay cambios' });
  }
  for (const statement of after.writes) tx.write(statement);
  tx.audit({
    table: 'enology.settings',
    rowId: entityId,
    action: 'UPDATE',
    before: beforeView,
    after: afterView,
  });
  return { ...afterView, warnings: after.warnings };
}

async function existingEntity(reader: Reader, legalEntityId: string): Promise<string> {
  if (!UUID.test(legalEntityId)) throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  const id = legalEntityId.toLowerCase();
  const rows = await reader.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM core.legal_entity WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError('WC_NOT_FOUND');
  return id;
}

function entityIdOf(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const raw = (body as Record<string, unknown>).legal_entity_id;
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw domainError('WC_VALIDATION', { legal_entity_id: 'Identificador no válido' });
  }
  return raw.toLowerCase();
}

async function loadBundle(reader: Reader, entityId: string): Promise<Bundle> {
  const parameters = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, entity_key, code, value_num::VARCHAR AS value_num, value_text,
           unit, basis, source_ref, valid_from::VARCHAR AS valid_from, confirmed_at
    FROM enology.parameter
    WHERE superseded_at IS NULL AND entity_key IN (${TEMPLATE_ENTITY}, ${entityId})
  `);
  const so2 = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, entity_key, scope, wine_color, sugar_band,
           sugar_min_g_l::VARCHAR AS sugar_min_g_l, sugar_max_g_l::VARCHAR AS sugar_max_g_l,
           limit_mg_l::VARCHAR AS limit_mg_l, basis, source_ref, note,
           valid_from::VARCHAR AS valid_from, confirmed_at
    FROM enology.so2_limit
    WHERE superseded_at IS NULL AND entity_key IN (${TEMPLATE_ENTITY}, ${entityId})
  `);
  const loss = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, entity_key, process, product_state, max_pct::VARCHAR AS max_pct,
           basis, source_ref, valid_from::VARCHAR AS valid_from, confirmed_at
    FROM enology.loss_tolerance
    WHERE superseded_at IS NULL AND entity_key IN (${TEMPLATE_ENTITY}, ${entityId})
  `);
  const practices = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, entity_key, name_es, name_key, match_terms, active, basis, source_ref, confirmed_at
    FROM enology.prohibited_practice
    WHERE superseded_at IS NULL AND entity_key IN (${TEMPLATE_ENTITY}, ${entityId})
  `);
  const required = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, entity_key, parameter_code, name_es, active, sort_order
    FROM enology.required_analysis
    WHERE entity_key IN (${TEMPLATE_ENTITY}, ${entityId})
  `);
  return {
    parameters: orderParameters(parameters.map((row) => parameterRow(row, entityId))),
    so2: orderSo2(so2.map((row) => so2Row(row, entityId))),
    loss: orderLoss(loss.map((row) => lossRow(row, entityId))),
    practices: orderBy(practices.map((row) => practiceRow(row, entityId)), (row) => row.nameKey),
    required: required.map((row) => requiredRow(row, entityId)).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)),
  };
}

function applyPut(
  before: Bundle,
  body: unknown,
  entityId: string,
  actorId: string | null,
  now: Date,
): { bundle: Bundle; writes: string[]; warnings: Warning[] } {
  const record = objectOf(body);
  const writes: string[] = [];
  const warnings: Warning[] = [];
  const bundle: Bundle = {
    parameters: before.parameters.map((row) => ({ ...row })),
    so2: before.so2.map((row) => ({ ...row })),
    loss: before.loss.map((row) => ({ ...row })),
    practices: before.practices.map((row) => ({ ...row, matchTerms: [...row.matchTerms] })),
    required: before.required.map((row) => ({ ...row })),
  };
  const fields: Record<string, string> = {};
  let touched = false;
  if (record.parameters !== undefined) {
    touched = true;
    applyParameters(bundle, writes, arrayOf(record.parameters, 'parameters', fields), entityId, fields, actorId, now);
  }
  if (record.so2_limits !== undefined) {
    touched = true;
    applySo2(bundle, writes, arrayOf(record.so2_limits, 'so2_limits', fields), entityId, fields, actorId, now);
  }
  if (record.loss_tolerances !== undefined) {
    touched = true;
    applyLoss(bundle, writes, arrayOf(record.loss_tolerances, 'loss_tolerances', fields), entityId, fields, actorId, now, warnings);
  }
  if (record.prohibited_practices !== undefined) {
    touched = true;
    applyPractices(bundle, writes, arrayOf(record.prohibited_practices, 'prohibited_practices', fields), entityId, fields, actorId, now);
  }
  if (record.required_analysis !== undefined) {
    touched = true;
    applyRequired(bundle, writes, arrayOf(record.required_analysis, 'required_analysis', fields), entityId, fields);
  }
  if (!touched) fields.body = 'No hay cambios';
  checkWindows(bundle, fields);
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return { bundle, writes, warnings };
}

function applyParameters(
  bundle: Bundle,
  writes: string[],
  items: unknown[],
  entityId: string,
  fields: Record<string, string>,
  actorId: string | null,
  now: Date,
): void {
  items.forEach((item, index) => {
    const row = objectOf(item, `parameters.${index}`, fields);
    const code = typeof row.code === 'string' ? row.code : '';
    if (!PARAMETER_CODES.includes(code)) {
      fields[`parameters.${index}.code`] = 'Parámetro desconocido';
      return;
    }
    const current = bundle.parameters.find((entry) => entry.code === code);
    if (!current) {
      fields[`parameters.${index}.code`] = 'Parámetro desconocido';
      return;
    }
    const next = { ...current };
    if (TEXT_CODES.has(code)) {
      if (row.value_text !== undefined) {
        if (row.value_text !== 'warning' && row.value_text !== 'block') {
          fields[`parameters.${index}.value_text`] = 'Usa warning o block';
          return;
        }
        next.valueText = row.value_text;
        next.value = null;
      }
    } else if (row.value !== undefined) {
      next.value = parseRange(row.value, code, `parameters.${index}.value`, fields);
      next.valueText = null;
      if (fields[`parameters.${index}.value`]) return;
    }
    if (row.source_ref !== undefined) next.sourceRef = textRef(row.source_ref, `parameters.${index}.source_ref`, fields);
    if (row.valid_from !== undefined) next.validFrom = parseDay(row.valid_from, `parameters.${index}.valid_from`, fields);
    const confirm = boolOf(row.confirm, `parameters.${index}.confirm`, fields);
    next.confirmed = applyConfirmation(current.basis, current.confirmed, confirm, valueChanged(current, next));
    if (sameParameter(current, next)) return;
    bundle.parameters[bundle.parameters.indexOf(current)] = commitParameter(current, next, entityId, actorId, now, writes);
  });
}

function applySo2(
  bundle: Bundle,
  writes: string[],
  items: unknown[],
  entityId: string,
  fields: Record<string, string>,
  actorId: string | null,
  now: Date,
): void {
  items.forEach((item, index) => {
    const row = objectOf(item, `so2_limits.${index}`, fields);
    const scope = row.scope === 'organic' || row.scope === 'legal' ? row.scope : null;
    const wine = row.wine_color === 'tinto' || row.wine_color === 'blanco' || row.wine_color === 'rosado' ? row.wine_color : null;
    const band = row.sugar_band === 'lt_2' || row.sugar_band === 'from_2_to_5' || row.sugar_band === 'gte_5' ? row.sugar_band : null;
    if (!scope || !wine || !band) {
      fields[`so2_limits.${index}`] = 'Indica scope, wine_color y sugar_band';
      return;
    }
    const current = bundle.so2.find((entry) => entry.scope === scope && entry.wineColor === wine && entry.sugarBand === band);
    if (!current) {
      fields[`so2_limits.${index}`] = 'No existe esa banda';
      return;
    }
    const next = { ...current };
    if (row.limit_mg_l !== undefined) {
      next.limitMgL = row.limit_mg_l === null
        ? null
        : parseBound(row.limit_mg_l, '0', '500', false, `so2_limits.${index}.limit_mg_l`, fields);
    }
    if (row.source_ref !== undefined) next.sourceRef = textRef(row.source_ref, `so2_limits.${index}.source_ref`, fields);
    if (row.note !== undefined) next.note = row.note === null ? null : textRef(row.note, `so2_limits.${index}.note`, fields);
    if (row.valid_from !== undefined) next.validFrom = parseDay(row.valid_from, `so2_limits.${index}.valid_from`, fields);
    const confirm = boolOf(row.confirm, `so2_limits.${index}.confirm`, fields);
    next.confirmed = applyConfirmation(current.basis, current.confirmed, confirm, next.limitMgL !== current.limitMgL);
    if (JSON.stringify(publicSo2(current)) === JSON.stringify(publicSo2(next)) && current.validFrom === next.validFrom) return;
    const indexOf = bundle.so2.indexOf(current);
    bundle.so2[indexOf] = commitSo2(current, next, entityId, actorId, now, writes);
  });
}

function applyLoss(
  bundle: Bundle,
  writes: string[],
  items: unknown[],
  entityId: string,
  fields: Record<string, string>,
  actorId: string | null,
  now: Date,
  warnings: Warning[],
): void {
  items.forEach((item, index) => {
    const row = objectOf(item, `loss_tolerances.${index}`, fields);
    const process = typeof row.process === 'string' && isProcess(row.process) ? row.process : null;
    const state = typeof row.product_state === 'string' && isProductState(row.product_state) ? row.product_state : null;
    if (!process || !state) {
      fields[`loss_tolerances.${index}`] = 'Proceso o estado no válido';
      return;
    }
    const current = bundle.loss.find((entry) => entry.process === process && entry.productState === state);
    if (!current) {
      fields[`loss_tolerances.${index}`] = 'No existe esa tolerancia';
      return;
    }
    const next = { ...current };
    if (row.max_pct !== undefined) {
      next.maxPct = row.max_pct === null
        ? null
        : parseBound(row.max_pct, '0', '100', false, `loss_tolerances.${index}.max_pct`, fields);
    }
    if (row.source_ref !== undefined) next.sourceRef = textRef(row.source_ref, `loss_tolerances.${index}.source_ref`, fields);
    if (row.valid_from !== undefined) next.validFrom = parseDay(row.valid_from, `loss_tolerances.${index}.valid_from`, fields);
    const confirm = boolOf(row.confirm, `loss_tolerances.${index}.confirm`, fields);
    next.confirmed = applyConfirmation(current.basis, current.confirmed, confirm, next.maxPct !== current.maxPct);
    if (JSON.stringify(publicLoss(current)) === JSON.stringify(publicLoss(next)) && current.validFrom === next.validFrom) return;
    if (next.maxPct !== null && next.sourceRef === SOURCE.loss) {
      warnings.push({
        code: 'ENOLOGY_LOSS_SOURCE_PENDING',
        severity: 'warning',
        message: 'La merma máxima se guarda con la fuente todavía pendiente de confirmar.',
      });
    }
    bundle.loss[bundle.loss.indexOf(current)] = commitLoss(current, next, entityId, actorId, now, writes);
  });
}

function applyPractices(
  bundle: Bundle,
  writes: string[],
  items: unknown[],
  entityId: string,
  fields: Record<string, string>,
  actorId: string | null,
  now: Date,
): void {
  items.forEach((item, index) => {
    const row = objectOf(item, `prohibited_practices.${index}`, fields);
    if (typeof row.name_es !== 'string' || row.name_es.trim().length < 3 || row.name_es.trim().length > 80) {
      fields[`prohibited_practices.${index}.name_es`] = 'El nombre tiene que tener entre 3 y 80 caracteres';
      return;
    }
    const nameEs = row.name_es.trim();
    const nameKey = fold(nameEs);
    if (nameKey === '') {
      fields[`prohibited_practices.${index}.name_es`] = 'El nombre no es válido';
      return;
    }
    const current = bundle.practices.find((entry) => entry.nameKey === nameKey);
    if (row.active !== undefined && typeof row.active !== 'boolean') {
      fields[`prohibited_practices.${index}.active`] = 'Debe ser verdadero o falso';
      return;
    }
    const confirm = boolOf(row.confirm, `prohibited_practices.${index}.confirm`, fields);
    if (fields[`prohibited_practices.${index}.confirm`]) return;
    const active = typeof row.active === 'boolean' ? row.active : (current?.active ?? true);
    if (!current) {
      const created: PracticeRow = {
        id: newId(),
        entityOwned: true,
        nameEs,
        nameKey,
        matchTerms: [nameKey],
        active,
        basis: 'supuesto',
        sourceRef: 'Añadida por la dirección.',
        confirmed: confirm === true,
      };
      bundle.practices.push(created);
      writes.push(insertPractice(created, entityId, actorId, now));
      return;
    }
    const next: PracticeRow = { ...current, matchTerms: [...current.matchTerms], active, nameEs: current.nameEs };
    next.confirmed = applyConfirmation(current.basis, current.confirmed, confirm, active !== current.active);
    if (next.active === current.active && next.confirmed === current.confirmed) return;
    bundle.practices[bundle.practices.indexOf(current)] = commitPractice(current, next, entityId, actorId, now, writes);
  });
}

function applyRequired(
  bundle: Bundle,
  writes: string[],
  items: unknown[],
  entityId: string,
  fields: Record<string, string>,
): void {
  items.forEach((item, index) => {
    const row = objectOf(item, `required_analysis.${index}`, fields);
    const code = typeof row.parameter_code === 'string' ? row.parameter_code : '';
    const current = bundle.required.find((entry) => entry.code === code);
    if (!current) {
      fields[`required_analysis.${index}.parameter_code`] = 'Parámetro desconocido';
      return;
    }
    const active = boolOf(row.active, `required_analysis.${index}.active`, fields);
    if (active === null || active === current.active) return;
    const next = { ...current, active };
    bundle.required[bundle.required.indexOf(current)] = commitRequired(current, next, entityId, writes);
  });
}

function commitParameter(
  current: ParameterRow,
  next: ParameterRow,
  entityId: string,
  actorId: string | null,
  now: Date,
  writes: string[],
): ParameterRow {
  if (!current.entityOwned || current.validFrom !== next.validFrom) {
    const created = { ...next, id: newId(), entityOwned: true };
    if (current.entityOwned) writes.push(supersede('enology.parameter', current.id, now));
    writes.push(insertParameter(created, entityId, actorId, now));
    return created;
  }
  writes.push(updateParameter(current, next, actorId, now));
  return { ...next, entityOwned: true };
}

function commitSo2(current: So2Row, next: So2Row, entityId: string, actorId: string | null, now: Date, writes: string[]): So2Row {
  if (!current.entityOwned || current.validFrom !== next.validFrom) {
    const created = { ...next, id: newId(), entityOwned: true };
    if (current.entityOwned) writes.push(supersede('enology.so2_limit', current.id, now));
    writes.push(insertSo2(created, entityId, actorId, now));
    return created;
  }
  writes.push(updateSo2(current, next, actorId, now));
  return { ...next, entityOwned: true };
}

function commitLoss(current: LossRow, next: LossRow, entityId: string, actorId: string | null, now: Date, writes: string[]): LossRow {
  if (!current.entityOwned || current.validFrom !== next.validFrom) {
    const created = { ...next, id: newId(), entityOwned: true };
    if (current.entityOwned) writes.push(supersede('enology.loss_tolerance', current.id, now));
    writes.push(insertLoss(created, entityId, actorId, now));
    return created;
  }
  writes.push(updateLoss(current, next, actorId, now));
  return { ...next, entityOwned: true };
}

function commitPractice(
  current: PracticeRow,
  next: PracticeRow,
  entityId: string,
  actorId: string | null,
  now: Date,
  writes: string[],
): PracticeRow {
  if (!current.entityOwned) {
    const created = { ...next, id: newId(), entityOwned: true, matchTerms: [...next.matchTerms] };
    writes.push(insertPractice(created, entityId, actorId, now));
    return created;
  }
  writes.push(updatePractice(current, next, actorId, now));
  return { ...next, entityOwned: true };
}

function commitRequired(current: RequiredRow, next: RequiredRow, entityId: string, writes: string[]): RequiredRow {
  if (!current.entityOwned) {
    const created = { ...next, id: newId(), entityOwned: true };
    writes.push(insertRequired(created, entityId));
    return created;
  }
  writes.push(sql`
    UPDATE enology.required_analysis
    SET active = ${next.active}
    WHERE id = CAST(${current.id} AS UUID)
  `);
  return { ...next, entityOwned: true };
}

function confirmedPair(confirmed: boolean, actorId: string | null, now: Date): string {
  if (!confirmed) return 'NULL, NULL';
  const at = sql`${now}`;
  const by = actorId ? sql`CAST(${actorId} AS UUID)` : 'NULL';
  return `${at}, ${by}`;
}

function confirmedSet(before: boolean, after: boolean, actorId: string | null, now: Date): string {
  if (before === after) return '';
  if (!after) return ', confirmed_at = NULL, confirmed_by = NULL';
  const at = sql`${now}`;
  const by = actorId ? sql`CAST(${actorId} AS UUID)` : 'NULL';
  return `, confirmed_at = ${at}, confirmed_by = ${by}`;
}

function insertParameter(row: ParameterRow, entityId: string, actorId: string | null, now: Date): string {
  return `
    INSERT INTO enology.parameter (
      id, entity_key, legal_entity_id, code, value_num, value_text, unit, basis, source_ref, valid_from,
      confirmed_at, confirmed_by
    ) VALUES (
      ${sql`CAST(${row.id} AS UUID)`}, ${sql`${entityId}`}, ${sql`CAST(${entityId} AS UUID)`}, ${sql`${row.code}`},
      ${row.value === null ? 'NULL' : sql`${q(row.value)}`}, ${sql`${row.valueText}`}, ${sql`${row.unit}`},
      ${sql`${row.basis}`}, ${sql`${row.sourceRef}`}, ${sql`CAST(${row.validFrom} AS DATE)`},
      ${confirmedPair(row.confirmed, actorId, now)}
    )
  `;
}

function updateParameter(current: ParameterRow, next: ParameterRow, actorId: string | null, now: Date): string {
  return `
    UPDATE enology.parameter
    SET value_num = ${next.value === null ? 'NULL' : sql`${q(next.value)}`},
        value_text = ${sql`${next.valueText}`},
        source_ref = ${sql`${next.sourceRef}`}
        ${confirmedSet(current.confirmed, next.confirmed, actorId, now)}
    WHERE id = ${sql`CAST(${current.id} AS UUID)`}
  `;
}

function insertSo2(row: So2Row, entityId: string, actorId: string | null, now: Date): string {
  return `
    INSERT INTO enology.so2_limit (
      id, entity_key, legal_entity_id, scope, wine_color, sugar_band, sugar_min_g_l, sugar_max_g_l,
      limit_mg_l, basis, source_ref, note, valid_from, confirmed_at, confirmed_by
    ) VALUES (
      ${sql`CAST(${row.id} AS UUID)`}, ${sql`${entityId}`}, ${sql`CAST(${entityId} AS UUID)`}, ${sql`${row.scope}`},
      ${sql`${row.wineColor}`}, ${sql`${row.sugarBand}`}, ${sql`${q(row.sugarMin)}`},
      ${row.sugarMax === null ? 'NULL' : sql`${q(row.sugarMax)}`},
      ${row.limitMgL === null ? 'NULL' : sql`${q(row.limitMgL)}`}, ${sql`${row.basis}`}, ${sql`${row.sourceRef}`},
      ${sql`${row.note}`}, ${sql`CAST(${row.validFrom} AS DATE)`},
      ${confirmedPair(row.confirmed, actorId, now)}
    )
  `;
}

function updateSo2(current: So2Row, next: So2Row, actorId: string | null, now: Date): string {
  return `
    UPDATE enology.so2_limit
    SET limit_mg_l = ${next.limitMgL === null ? 'NULL' : sql`${q(next.limitMgL)}`},
        source_ref = ${sql`${next.sourceRef}`},
        note = ${sql`${next.note}`}
        ${confirmedSet(current.confirmed, next.confirmed, actorId, now)}
    WHERE id = ${sql`CAST(${current.id} AS UUID)`}
  `;
}

function insertLoss(row: LossRow, entityId: string, actorId: string | null, now: Date): string {
  return `
    INSERT INTO enology.loss_tolerance (
      id, entity_key, legal_entity_id, process, product_state, max_pct, basis, source_ref, valid_from,
      confirmed_at, confirmed_by
    ) VALUES (
      ${sql`CAST(${row.id} AS UUID)`}, ${sql`${entityId}`}, ${sql`CAST(${entityId} AS UUID)`}, ${sql`${row.process}`},
      ${sql`${row.productState}`}, ${row.maxPct === null ? 'NULL' : sql`${q(row.maxPct)}`}, ${sql`${row.basis}`},
      ${sql`${row.sourceRef}`}, ${sql`CAST(${row.validFrom} AS DATE)`},
      ${confirmedPair(row.confirmed, actorId, now)}
    )
  `;
}

function updateLoss(current: LossRow, next: LossRow, actorId: string | null, now: Date): string {
  return `
    UPDATE enology.loss_tolerance
    SET max_pct = ${next.maxPct === null ? 'NULL' : sql`${q(next.maxPct)}`},
        source_ref = ${sql`${next.sourceRef}`}
        ${confirmedSet(current.confirmed, next.confirmed, actorId, now)}
    WHERE id = ${sql`CAST(${current.id} AS UUID)`}
  `;
}

function insertPractice(row: PracticeRow, entityId: string, actorId: string | null, now: Date): string {
  return `
    INSERT INTO enology.prohibited_practice (
      id, entity_key, legal_entity_id, name_es, name_key, match_terms, active, basis, source_ref,
      confirmed_at, confirmed_by
    ) VALUES (
      ${sql`CAST(${row.id} AS UUID)`}, ${sql`${entityId}`}, ${sql`CAST(${entityId} AS UUID)`}, ${sql`${row.nameEs}`},
      ${sql`${row.nameKey}`}, ${sql`${row.matchTerms.join(',')}`}, ${row.active ? 'TRUE' : 'FALSE'}, ${sql`${row.basis}`},
      ${sql`${row.sourceRef}`},
      ${confirmedPair(row.confirmed, actorId, now)}
    )
  `;
}

function updatePractice(current: PracticeRow, next: PracticeRow, actorId: string | null, now: Date): string {
  return `
    UPDATE enology.prohibited_practice
    SET active = ${next.active ? 'TRUE' : 'FALSE'}
        ${confirmedSet(current.confirmed, next.confirmed, actorId, now)}
    WHERE id = ${sql`CAST(${current.id} AS UUID)`}
  `;
}

function insertRequired(row: RequiredRow, entityId: string): string {
  return sql`
    INSERT INTO enology.required_analysis (
      id, entity_key, legal_entity_id, parameter_code, name_es, active, sort_order
    ) VALUES (
      CAST(${row.id} AS UUID), ${entityId}, CAST(${entityId} AS UUID), ${row.code}, ${row.nameEs},
      ${row.active}, ${row.sortOrder}
    )
  `;
}

function supersede(table: string, id: string, now: Date): string {
  if (table !== 'enology.parameter' && table !== 'enology.so2_limit' && table !== 'enology.loss_tolerance') {
    throw new Error('Tabla de enología no válida');
  }
  return sql`
    UPDATE ${sql.raw(table)}
    SET superseded_at = ${now}
    WHERE id = CAST(${id} AS UUID) AND superseded_at IS NULL
  `;
}

function toView(entityId: string, bundle: Bundle): SettingsView {
  const partial = {
    legal_entity_id: entityId,
    parameters: bundle.parameters.map(publicParameter),
    so2_limits: bundle.so2.map(publicSo2),
    loss_tolerances: bundle.loss.map(publicLoss),
    prohibited_practices: bundle.practices.map(publicPractice),
    required_analysis: bundle.required.map(publicRequired),
  };
  return { ...partial, pending_confirmation: pendingKeys(partial) };
}

function publicParameter(row: ParameterRow): ParameterView {
  return {
    code: row.code,
    value: row.value,
    value_text: row.valueText,
    unit: row.unit,
    basis: row.basis,
    status_label: statusLabel(row.basis, row.confirmed),
    source_ref: row.sourceRef,
    valid_from: row.validFrom,
    pending: isPending(row.basis, row.confirmed),
  };
}

function publicSo2(row: So2Row): So2LimitView {
  return {
    scope: row.scope,
    wine_color: row.wineColor,
    sugar_band: row.sugarBand,
    sugar_min_g_l: row.sugarMin,
    sugar_max_g_l: row.sugarMax,
    limit_mg_l: row.limitMgL,
    basis: row.basis,
    status_label: statusLabel(row.basis, row.confirmed),
    source_ref: row.sourceRef,
    note: row.note,
    valid_from: row.validFrom,
    pending: isPending(row.basis, row.confirmed),
  };
}

function publicLoss(row: LossRow): LossToleranceView {
  return {
    process: row.process,
    product_state: row.productState,
    max_pct: row.maxPct,
    basis: row.basis,
    status_label: statusLabel(row.basis, row.confirmed),
    source_ref: row.sourceRef,
    valid_from: row.validFrom,
    pending: isPending(row.basis, row.confirmed),
  };
}

function publicPractice(row: PracticeRow): PracticeView {
  return {
    name_es: row.nameEs,
    name_key: row.nameKey,
    match_terms: [...row.matchTerms],
    active: row.active,
    basis: row.basis,
    status_label: statusLabel(row.basis, row.confirmed),
    source_ref: row.sourceRef,
    pending: isPending(row.basis, row.confirmed),
  };
}

function publicRequired(row: RequiredRow): RequiredAnalysisView {
  return {
    parameter_code: row.code,
    name_es: row.nameEs,
    active: row.active,
    sort_order: row.sortOrder,
  };
}

function parameterRow(row: Record<string, unknown>, entityId: string): ParameterRow {
  return {
    id: text(row.id).toLowerCase(),
    entityOwned: text(row.entity_key).toLowerCase() === entityId,
    code: text(row.code),
    value: numPlain(row.value_num),
    valueText: row.value_text == null || row.value_text === '' ? null : text(row.value_text),
    unit: row.unit == null ? null : text(row.unit),
    basis: basisOf(row.basis),
    sourceRef: text(row.source_ref),
    validFrom: dayText(row.valid_from) ?? VALID_FROM,
    confirmed: row.confirmed_at != null,
  };
}

function so2Row(row: Record<string, unknown>, entityId: string): So2Row {
  return {
    id: text(row.id).toLowerCase(),
    entityOwned: text(row.entity_key).toLowerCase() === entityId,
    scope: row.scope === 'legal' ? 'legal' : 'organic',
    wineColor: row.wine_color === 'blanco' || row.wine_color === 'rosado' ? row.wine_color : 'tinto',
    sugarBand: row.sugar_band === 'from_2_to_5' || row.sugar_band === 'gte_5' ? row.sugar_band : 'lt_2',
    sugarMin: numPlain(row.sugar_min_g_l) ?? '0',
    sugarMax: numPlain(row.sugar_max_g_l),
    limitMgL: numPlain(row.limit_mg_l),
    basis: basisOf(row.basis),
    sourceRef: text(row.source_ref),
    note: row.note == null ? null : text(row.note),
    validFrom: dayText(row.valid_from) ?? VALID_FROM,
    confirmed: row.confirmed_at != null,
  };
}

function lossRow(row: Record<string, unknown>, entityId: string): LossRow {
  const process = text(row.process);
  const state = text(row.product_state);
  if (!isProcess(process) || !isProductState(state)) throw new Error('Tolerancia de enología no válida');
  return {
    id: text(row.id).toLowerCase(),
    entityOwned: text(row.entity_key).toLowerCase() === entityId,
    process,
    productState: state,
    maxPct: numPlain(row.max_pct),
    basis: basisOf(row.basis),
    sourceRef: text(row.source_ref),
    validFrom: dayText(row.valid_from) ?? VALID_FROM,
    confirmed: row.confirmed_at != null,
  };
}

function practiceRow(row: Record<string, unknown>, entityId: string): PracticeRow {
  return {
    id: text(row.id).toLowerCase(),
    entityOwned: text(row.entity_key).toLowerCase() === entityId,
    nameEs: text(row.name_es),
    nameKey: text(row.name_key),
    matchTerms: text(row.match_terms).split(',').map((term) => term.trim()).filter((term) => term !== ''),
    active: flag(row.active),
    basis: basisOf(row.basis),
    sourceRef: text(row.source_ref),
    confirmed: row.confirmed_at != null,
  };
}

function requiredRow(row: Record<string, unknown>, entityId: string): RequiredRow {
  return {
    id: text(row.id).toLowerCase(),
    entityOwned: text(row.entity_key).toLowerCase() === entityId,
    code: text(row.parameter_code),
    nameEs: text(row.name_es),
    active: flag(row.active),
    sortOrder: Number(row.sort_order),
  };
}

function orderParameters(rows: ParameterRow[]): ParameterRow[] {
  const map = prefer(rows, (row) => row.code);
  return PARAMETER_SEEDS.map((seed) => map.get(seed.code) ?? parameterFromSeed(seed));
}

function orderSo2(rows: So2Row[]): So2Row[] {
  const map = prefer(rows, (row) => `${row.scope}:${row.wineColor}:${row.sugarBand}`);
  return SO2_SEEDS.map((seed) => map.get(`${seed.scope}:${seed.wine_color}:${seed.sugar_band}`) ?? so2FromSeed(seed));
}

function orderLoss(rows: LossRow[]): LossRow[] {
  const map = prefer(rows, (row) => `${row.process}:${row.productState}`);
  return LOSS_SEEDS.map((seed) => map.get(`${seed.process}:${seed.product_state}`) ?? lossFromSeed(seed));
}

function orderBy<T extends { entityOwned: boolean }>(rows: T[], key: (row: T) => string): T[] {
  const map = prefer(rows, key);
  return [...map.values()].sort((a, b) => key(a).localeCompare(key(b)));
}

function prefer<T extends { entityOwned: boolean }>(rows: T[], key: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = key(row);
    const current = map.get(id);
    if (!current || row.entityOwned) map.set(id, row);
  }
  return map;
}

function parameterFromSeed(seed: (typeof PARAMETER_SEEDS)[number]): ParameterRow {
  return {
    id: TEMPLATE_ENTITY,
    entityOwned: false,
    code: seed.code,
    value: seed.value,
    valueText: seed.value_text,
    unit: seed.unit,
    basis: seed.basis,
    sourceRef: seed.source_ref,
    validFrom: VALID_FROM,
    confirmed: false,
  };
}

function so2FromSeed(seed: (typeof SO2_SEEDS)[number]): So2Row {
  return {
    id: TEMPLATE_ENTITY,
    entityOwned: false,
    scope: seed.scope,
    wineColor: seed.wine_color,
    sugarBand: seed.sugar_band,
    sugarMin: seed.sugar_min_g_l,
    sugarMax: seed.sugar_max_g_l,
    limitMgL: seed.limit_mg_l,
    basis: seed.basis,
    sourceRef: seed.source_ref,
    note: seed.note,
    validFrom: VALID_FROM,
    confirmed: false,
  };
}

function lossFromSeed(seed: (typeof LOSS_SEEDS)[number]): LossRow {
  return {
    id: TEMPLATE_ENTITY,
    entityOwned: false,
    process: seed.process,
    productState: seed.product_state,
    maxPct: null,
    basis: 'pendiente',
    sourceRef: SOURCE.loss,
    validFrom: VALID_FROM,
    confirmed: false,
  };
}

function checkWindows(bundle: Bundle, fields: Record<string, string>): void {
  const from = bundle.parameters.find((row) => row.code === 'winter_racking_month_from')?.value;
  const to = bundle.parameters.find((row) => row.code === 'winter_racking_month_to')?.value;
  const bottleFrom = bundle.parameters.find((row) => row.code === 'bottling_reminder_month_from')?.value;
  const bottleTo = bundle.parameters.find((row) => row.code === 'bottling_reminder_month_to')?.value;
  if (from && to && Number(from) > Number(to)) fields.winter_racking_month_from = 'El mes inicial no puede ser posterior al final';
  if (bottleFrom && bottleTo && Number(bottleFrom) > Number(bottleTo)) {
    fields.bottling_reminder_month_from = 'El mes inicial no puede ser posterior al final';
  }
}

function applyConfirmation(basis: Basis, current: boolean, confirm: boolean | null, changed: boolean): boolean {
  if (confirm === true) return true;
  if (confirm === false && basis !== 'hecho') return false;
  if (changed) return false;
  return current;
}

function valueChanged(current: ParameterRow, next: ParameterRow): boolean {
  return current.value !== next.value || current.valueText !== next.valueText;
}

function sameParameter(current: ParameterRow, next: ParameterRow): boolean {
  return current.value === next.value
    && current.valueText === next.valueText
    && current.sourceRef === next.sourceRef
    && current.validFrom === next.validFrom
    && current.confirmed === next.confirmed;
}

function parseRange(value: unknown, code: string, field: string, fields: Record<string, string>): string | null {
  const range = RANGE[code];
  if (!range) {
    fields[field] = 'Parámetro desconocido';
    return null;
  }
  if (value === null) {
    if (!range.nullable) fields[field] = 'Este valor no puede quedar vacío';
    return null;
  }
  return parseBound(value, range.min, range.max, range.integer === true, field, fields);
}

function parseBound(
  value: unknown,
  min: string,
  max: string,
  integer: boolean,
  field: string,
  fields: Record<string, string>,
): string | null {
  const text = decimalText(value);
  if (text === null) {
    fields[field] = 'Debe ser un número';
    return null;
  }
  const parsed = q(text);
  if (integer && !parsed.isInteger()) fields[field] = 'Debe ser un entero';
  if (parsed.lt(min) || parsed.gt(max)) fields[field] = `Tiene que estar entre ${min} y ${max}`;
  if (fields[field]) return null;
  return plain(parsed);
}

function parseDay(value: unknown, field: string, fields: Record<string, string>): string {
  if (typeof value !== 'string' || !DAY.test(value)) {
    fields[field] = 'Usa una fecha AAAA-MM-DD';
    return VALID_FROM;
  }
  const year = Number(value.slice(0, 4));
  if (year < 2020 || year > 2100) fields[field] = 'El año tiene que estar entre 2020 y 2100';
  return value;
}

function textRef(value: unknown, field: string, fields: Record<string, string>): string {
  if (typeof value !== 'string' || value.trim().length < 5 || value.trim().length > 400) {
    fields[field] = 'La referencia tiene que tener entre 5 y 400 caracteres';
    return SOURCE.loss;
  }
  return value.trim();
}

function boolOf(value: unknown, field: string, fields: Record<string, string>): boolean | null {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value;
  fields[field] = 'Debe ser verdadero o falso';
  return null;
}

function arrayOf(value: unknown, field: string, fields: Record<string, string>): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) {
    fields[field] = 'Tiene que ser una lista de 1 a 40 elementos';
    return [];
  }
  return value;
}

function objectOf(value: unknown, field = 'body', fields?: Record<string, string>): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (fields) fields[field] = 'Tiene que ser un objeto';
    else throw domainError('WC_VALIDATION', { [field]: 'Tiene que ser un objeto' });
    return {};
  }
  return value as Record<string, unknown>;
}

function basisOf(value: unknown): Basis {
  if (value === 'hecho' || value === 'supuesto' || value === 'pendiente') return value;
  throw new Error('Base de enología no válida');
}

function numPlain(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return plain(q(String(value)));
}

function text(value: unknown): string {
  return String(value ?? '');
}

function uuidOrNull(value: string): string | null {
  return UUID.test(value) ? value.toLowerCase() : null;
}
