import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { businessDate } from '../time';
import {
  calculateBlend,
  calculateCold,
  calculateProbableAlcohol,
  calculateSo2,
  type BlendComponentInput,
} from './calculators';
import { checkOperation, type CheckAddition, type CheckAnalysis, type CheckOperationInput } from './checks';
import { decimalText, plain, q } from './qty';
import { readEffective, readSettings } from './settings';
import { flag, parseInstant } from './text';
import type { WineColor } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLOR: Record<string, WineColor> = {
  red: 'tinto',
  white: 'blanco',
  rose: 'rosado',
  tinto: 'tinto',
  blanco: 'blanco',
  rosado: 'rosado',
};

export async function runSo2(writer: Writer, body: unknown) {
  const record = objectOf(body);
  const settings = await readEffective(writer, optionalUuid(record.legal_entity_id, 'legal_entity_id'));
  const merged: Record<string, unknown> = { ...record };
  if (typeof record.lot_id === 'string') {
    const lot = await lotProfile(writer, record.lot_id);
    if (merged.no_added_sulfites === undefined) merged.no_added_sulfites = lot.noAddedSulfites;
    if (merged.wine_type === undefined && lot.wineType) merged.wine_type = lot.wineType;
  }
  return calculateSo2(merged, settings);
}

export async function runCold(body: unknown) {
  return calculateCold(objectOf(body));
}

export async function runProbableAlcohol(writer: Writer, body: unknown) {
  const record = objectOf(body);
  const settings = await readEffective(writer, optionalUuid(record.legal_entity_id, 'legal_entity_id'));
  return calculateProbableAlcohol(record, settings);
}

export async function runBlend(writer: Writer, body: unknown) {
  const record = objectOf(body);
  const target = decimalText(record.target_volume_l);
  if (target === null) throw domainError('WC_VALIDATION', { target_volume_l: 'Debe ser un número' });
  if (!Array.isArray(record.components)) {
    throw domainError('WC_VALIDATION', { components: 'Tiene que ser una lista' });
  }
  const components: BlendComponentInput[] = [];
  for (const [index, item] of record.components.entries()) {
    const row = objectOf(item, `components.${index}`);
    const vesselId = optionalUuid(row.vessel_id, `components.${index}.vessel_id`);
    const lotId = optionalUuid(row.lot_id, `components.${index}.lot_id`);
    const label = row.label === undefined || row.label === null ? null : textLabel(row.label, `components.${index}.label`);
    const volume = decimalText(row.volume_ml);
    if (volume === null) throw domainError('WC_VALIDATION', { [`components.${index}.volume_ml`]: 'Debe ser un número' });
    const available = vesselId || lotId ? await availableMl(writer, vesselId, lotId) : null;
    components.push({
      label,
      volume_ml: volume,
      vessel_id: vesselId,
      lot_id: lotId,
      available_ml: available,
    });
  }
  return calculateBlend(components, target);
}

export async function runChecks(writer: Writer, body: unknown, now: Date) {
  const record = objectOf(body);
  const entityId = requiredUuid(record.legal_entity_id, 'legal_entity_id');
  const settings = await readSettings(writer, entityId);
  const asOf = typeof record.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(record.as_of)
    ? record.as_of
    : businessDate(now);
  const operation = parseOperation(record.operation);
  const lot = await resolveLot(writer, record.lot, entityId, asOf, settings);
  const input: CheckOperationInput = { as_of: asOf, operation, lot, settings };
  return checkOperation(input);
}

async function resolveLot(
  writer: Writer,
  raw: unknown,
  entityId: string,
  asOf: string,
  settings: Awaited<ReturnType<typeof readSettings>>,
): Promise<CheckOperationInput['lot']> {
  const body = raw === undefined || raw === null ? {} : objectOf(raw, 'lot');
  const base: CheckOperationInput['lot'] = {
    kind: typeof body.kind === 'string' ? body.kind : null,
    has_volume: body.has_volume === true,
    racked_this_winter: body.racked_this_winter === true,
    malolactic_finished: typeof body.malolactic_finished === 'boolean' ? body.malolactic_finished : null,
    malic_acid_g_l: decimalText(body.malic_acid_g_l),
    volatile_acidity_g_l: decimalText(body.volatile_acidity_g_l),
    analyses: parseAnalyses(body.analyses),
  };
  if (body.malic_acid_g_l !== undefined && base.malic_acid_g_l === null) {
    throw domainError('WC_VALIDATION', { malic_acid_g_l: 'Debe ser un número' });
  }
  if (body.volatile_acidity_g_l !== undefined && base.volatile_acidity_g_l === null) {
    throw domainError('WC_VALIDATION', { volatile_acidity_g_l: 'Debe ser un número' });
  }
  if (typeof body.id !== 'string') return base;
  const lotId = requiredUuid(body.id, 'lot.id');
  const rows = await writer.read<{ id: string; kind: string; producer_entity_id: string }>(sql`
    SELECT id::VARCHAR AS id, kind, producer_entity_id::VARCHAR AS producer_entity_id
    FROM inventory.lot
    WHERE id = CAST(${lotId} AS UUID)
  `);
  const lot = rows[0];
  if (!lot) throw domainError('WC_NOT_FOUND');
  if (lot.producer_entity_id.toLowerCase() !== entityId) {
    throw domainError('WC_VALIDATION', { 'lot.id': 'El lote no es de esta entidad' });
  }
  if (body.kind === undefined) base.kind = lot.kind;
  if (body.has_volume === undefined) base.has_volume = await lotHasVolume(writer, lotId);
  if (body.racked_this_winter === undefined) base.racked_this_winter = await lotRacked(writer, lotId, asOf, settings);
  if (body.analyses === undefined || body.malic_acid_g_l === undefined || body.volatile_acidity_g_l === undefined) {
    const loaded = await lotAnalyses(writer, lotId);
    if (body.analyses === undefined) base.analyses = loaded.analyses;
    if (body.malic_acid_g_l === undefined) base.malic_acid_g_l = loaded.malic;
    if (body.volatile_acidity_g_l === undefined) base.volatile_acidity_g_l = loaded.volatile;
  }
  return base;
}

async function lotProfile(writer: Writer, lotId: string): Promise<{ noAddedSulfites: boolean; wineType: WineColor | null }> {
  const id = requiredUuid(lotId, 'lot_id');
  const rows = await writer.read<{ id: string; no_added_sulfites: unknown; color: string | null }>(sql`
    SELECT l.id::VARCHAR AS id, w.no_added_sulfites, w.color
    FROM inventory.lot l
    LEFT JOIN catalog.wine w ON w.id = l.wine_id
    WHERE l.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    noAddedSulfites: flag(row.no_added_sulfites),
    wineType: row.color ? COLOR[row.color] ?? null : null,
  };
}

async function availableMl(writer: Writer, vesselId: string | null, lotId: string | null): Promise<string> {
  if (vesselId) {
    const vessels = await writer.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM cellar.vessel WHERE id = CAST(${vesselId} AS UUID)
    `);
    if (!vessels[0]) throw domainError('WC_NOT_FOUND');
  }
  if (lotId) {
    const lots = await writer.read<{ id: string }>(sql`
      SELECT id::VARCHAR AS id FROM inventory.lot WHERE id = CAST(${lotId} AS UUID)
    `);
    if (!lots[0]) throw domainError('WC_NOT_FOUND');
  }
  const filter = [
    vesselId ? sql`vessel_id = CAST(${vesselId} AS UUID)` : '',
    lotId ? sql`lot_id = CAST(${lotId} AS UUID)` : '',
  ].filter((part) => part !== '');
  const rows = await writer.read<{ volume_ml: string }>(`
    SELECT COALESCE(SUM(volume_ml), 0)::VARCHAR AS volume_ml
    FROM inventory.v_stock_balance
    WHERE ${filter.join(' AND ')}
  `);
  return rows[0]?.volume_ml ?? '0';
}

async function lotHasVolume(writer: Writer, lotId: string): Promise<boolean> {
  const rows = await writer.read<{ volume_ml: string }>(sql`
    SELECT COALESCE(SUM(volume_ml), 0)::VARCHAR AS volume_ml
    FROM inventory.v_stock_balance
    WHERE lot_id = CAST(${lotId} AS UUID)
  `);
  return Number(rows[0]?.volume_ml ?? 0) > 0;
}

async function lotRacked(
  writer: Writer,
  lotId: string,
  asOf: string,
  settings: Awaited<ReturnType<typeof readSettings>>,
): Promise<boolean> {
  const year = asOf.slice(0, 4);
  const rows = await writer.read<{ occurred_at: string }>(sql`
    SELECT o.occurred_at::VARCHAR AS occurred_at
    FROM cellar.operation_line ol
    JOIN cellar.operation o ON o.id = ol.operation_id
    WHERE ol.lot_id = CAST(${lotId} AS UUID)
      AND o.op_type = 'racking'
      AND o.status = 'confirmed'
  `);
  const from = Number(settings.parameters.find((row) => row.code === 'winter_racking_month_from')?.value ?? '2');
  const to = Number(settings.parameters.find((row) => row.code === 'winter_racking_month_to')?.value ?? '3');
  return rows.some((row) => {
    const instant = parseInstant(row.occurred_at);
    if (Number.isNaN(instant.getTime())) return false;
    const day = businessDate(instant);
    if (!day.startsWith(year)) return false;
    const month = Number(day.slice(5, 7));
    return month >= from && month <= to;
  });
}

async function lotAnalyses(writer: Writer, lotId: string): Promise<{
  analyses: CheckAnalysis[];
  malic: string | null;
  volatile: string | null;
}> {
  const rows = await writer.read<{
    id: string;
    sampled_at: string;
    parameter_code: string;
    value: string;
  }>(sql`
    SELECT a.id::VARCHAR AS id, a.sampled_at::VARCHAR AS sampled_at, r.parameter_code, r.value::VARCHAR AS value
    FROM cellar.analysis a
    JOIN cellar.analysis_result r ON r.analysis_id = a.id
    WHERE a.lot_id = CAST(${lotId} AS UUID)
    ORDER BY a.sampled_at DESC
  `);
  const grouped = new Map<string, CheckAnalysis>();
  let malic: string | null = null;
  let volatile: string | null = null;
  for (const row of rows) {
    const instant = parseInstant(row.sampled_at);
    const sampled = Number.isNaN(instant.getTime()) ? row.sampled_at.slice(0, 10) : businessDate(instant);
    const current = grouped.get(row.id) ?? { sampled_on: sampled, parameters: [] };
    current.parameters.push(row.parameter_code);
    grouped.set(row.id, current);
    if (row.parameter_code === 'malic_acid' && malic === null) malic = plain(q(row.value));
    if (row.parameter_code === 'volatile_acidity' && volatile === null) volatile = plain(q(row.value));
  }
  return { analyses: [...grouped.values()], malic, volatile };
}

function parseOperation(raw: unknown): CheckOperationInput['operation'] {
  const body = objectOf(raw, 'operation');
  const opType = typeof body.op_type === 'string' ? body.op_type : '';
  if (!/^[a-z_]{3,40}$/u.test(opType)) throw domainError('WC_VALIDATION', { op_type: 'Tipo de operación no válido' });
  const state = typeof body.product_state === 'string' ? body.product_state : '';
  if (!['grape', 'must', 'wine', 'packaged_unlabeled', 'packaged_labeled'].includes(state)) {
    throw domainError('WC_VALIDATION', { product_state: 'Estado de producto no válido' });
  }
  const input = decimalText(body.input_volume_ml);
  const loss = decimalText(body.loss_volume_ml);
  const fields: Record<string, string> = {};
  if (input === null) fields.input_volume_ml = 'Debe ser un número';
  if (loss === null) fields.loss_volume_ml = 'Debe ser un número';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return {
    op_type: opType,
    process: typeof body.process === 'string' ? body.process : null,
    product_state: state,
    input_volume_ml: input ?? '0',
    loss_volume_ml: loss ?? '0',
    reason: typeof body.reason === 'string' ? body.reason : null,
    additions: parseAdditions(body.additions),
    practices: parsePractices(body.practices),
  };
}

function parseAdditions(raw: unknown): CheckAddition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw domainError('WC_VALIDATION', { additions: 'Tiene que ser una lista' });
  return raw.map((item, index) => {
    const row = objectOf(item, `additions.${index}`);
    if (typeof row.name !== 'string' || row.name.trim() === '') {
      throw domainError('WC_VALIDATION', { [`additions.${index}.name`]: 'Indica el nombre' });
    }
    return {
      name: row.name.trim(),
      purpose: typeof row.purpose === 'string' ? row.purpose : null,
      is_so2: typeof row.is_so2 === 'boolean' ? row.is_so2 : null,
    };
  });
}

function parsePractices(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw domainError('WC_VALIDATION', { practices: 'Tiene que ser una lista' });
  return raw.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw domainError('WC_VALIDATION', { [`practices.${index}`]: 'Indica la práctica' });
    }
    return item.trim();
  });
}

function parseAnalyses(raw: unknown): CheckAnalysis[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw domainError('WC_VALIDATION', { analyses: 'Tiene que ser una lista' });
  return raw.map((item, index) => {
    const row = objectOf(item, `analyses.${index}`);
    if (typeof row.sampled_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.sampled_on)) {
      throw domainError('WC_VALIDATION', { [`analyses.${index}.sampled_on`]: 'Usa una fecha AAAA-MM-DD' });
    }
    if (!Array.isArray(row.parameters) || row.parameters.some((code) => typeof code !== 'string')) {
      throw domainError('WC_VALIDATION', { [`analyses.${index}.parameters`]: 'Indica los códigos de parámetro' });
    }
    return { sampled_on: row.sampled_on, parameters: row.parameters.map((code) => String(code)) };
  });
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredUuid(value, field);
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  }
  return value.toLowerCase();
}

function textLabel(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 40) {
    throw domainError('WC_VALIDATION', { [field]: 'La etiqueta tiene que tener entre 1 y 40 caracteres' });
  }
  return value.trim();
}

function objectOf(value: unknown, field = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { [field]: 'Tiene que ser un objeto' });
  }
  return value as Record<string, unknown>;
}
