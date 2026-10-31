import { sessionOf } from '../../auth/guard';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { emitEvent } from '../events/emit';
import { domainError } from '../errors';
import { newId } from '../ids';
import { money } from '../money';
import { actorFor, invalid, readJson, requireText } from '../cellar/service/http';
import {
  DEFAULT_ALERTS,
  evaluateFermentationAlerts,
  organicCategory,
  outsideLimit,
  outsidePhysical,
  parseAlertSettings,
  sugarBand,
  type AlertHit,
  type AlertRule,
  type AlertThresholds,
  type ReadingPoint,
} from './rules';

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLERGEN = /^[a-z0-9_]{1,32}$/;
const ADDITIVE_LOT = /^[A-Z0-9][A-Z0-9./-]{0,29}$/;
const LABS = new Set(['internal', 'external']);
const KINDS = new Set(['grape', 'must', 'fml_pack', 'pre_bottling', 'control', 'other']);
const SOURCES = new Set(['manual', 'voice', 'sensor', 'import']);

export interface CurvePoint {
  at: string;
  density: string | null;
  temperature_c: string | null;
  residual_sugar_gl: string | null;
}

export async function createReading(writer: Writer, request: Request): Promise<Record<string, unknown>> {
  const body = await readJson(request);
  const lotId = uuidOf(body.lotId ?? body.lot_id, 'lotId');
  const vesselId = uuidOf(body.vesselId ?? body.vessel_id, 'vesselId');
  const at = requireText(body.at, 'at', 40);
  if (!isInstant(at)) invalid({ at: 'Debe ser un instante ISO-8601 con zona horaria' });
  if (Date.parse(at) > Date.now() + 60_000) invalid({ at: 'La lectura no puede ser futura' });
  const density = optionalDecimal(body.density, 'density', 4);
  const temperature = optionalDecimal(body.temperatureC ?? body.temperature_c, 'temperatureC', 1);
  const sugar = optionalDecimal(body.sugar ?? body.residual_sugar_gl, 'sugar', 3);
  if (density === null && temperature === null) {
    invalid({ density: 'La lectura necesita densidad o temperatura' });
  }
  if (density !== null && outsidePhysical(density, { min: '0.9800', max: '1.2000' })) {
    invalid({ density: 'La densidad debe estar entre 0,9800 y 1,2000 g/mL' });
  }
  if (temperature !== null && outsidePhysical(temperature, { min: '-5', max: '45' })) {
    invalid({ temperatureC: 'La temperatura debe estar entre -5 y 45 °C' });
  }
  if (sugar !== null && outsidePhysical(sugar, { min: '0', max: '400' })) {
    invalid({ sugar: 'El azúcar debe estar entre 0 y 400 g/L' });
  }
  const sourceRaw = body.source === undefined || body.source === null ? 'manual' : requireText(body.source, 'source', 20);
  if (!SOURCES.has(sourceRaw)) invalid({ source: 'El origen de la lectura no es válido' });
  const actor = actorFor(request, 'lectura de fermentación');
  const measuredBy = sessionOf(request).displayName || actor.id;
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    await assertLotId(tx, lotId);
    await assertVessel(tx, vesselId);
    const clash = await tx.read(sql`
      SELECT id FROM cellar.fermentation_reading
      WHERE vessel_id = CAST(${vesselId} AS UUID) AND measured_at = CAST(${at} AS TIMESTAMPTZ)
    `);
    if (clash.length > 0) invalid({ at: 'Ya hay una lectura de ese recipiente en ese instante' });
    tx.write(sql`
      INSERT INTO cellar.fermentation_reading (
        id, lot_id, vessel_id, measured_at, density, temperature_c, measured_by, source
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${lotId} AS UUID),
        CAST(${vesselId} AS UUID),
        CAST(${at} AS TIMESTAMPTZ),
        CAST(${density} AS DECIMAL(6,4)),
        CAST(${temperature} AS DECIMAL(4,1)),
        ${measuredBy},
        ${sourceRaw}
      )
    `);
    tx.audit({
      table: 'cellar.fermentation_reading',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { lot_id: lotId, vessel_id: vesselId, measured_at: at },
    });
    if (sugar !== null) {
      tx.write(sql`
        INSERT INTO cellar.fermentation_reading_extra (reading_id, residual_sugar_gl)
        VALUES (CAST(${id} AS UUID), CAST(${sugar} AS DECIMAL(8,3)))
      `);
    }
  });
  return readingById(writer, id);
}

export async function listReadings(writer: Writer, request: Request): Promise<{ items: CurvePoint[] }> {
  sessionOf(request);
  const url = new URL(request.url);
  const lotId = optionalQueryUuid(url.searchParams.get('lotId') ?? url.searchParams.get('lot_id'), 'lotId');
  const vesselId = optionalQueryUuid(url.searchParams.get('vesselId') ?? url.searchParams.get('vessel_id'), 'vesselId');
  if (!lotId && !vesselId) invalid({ lotId: 'Indica un lote o un recipiente' });
  const filters = ['TRUE'];
  if (lotId) filters.push(sql`r.lot_id = CAST(${lotId} AS UUID)`);
  if (vesselId) filters.push(sql`r.vessel_id = CAST(${vesselId} AS UUID)`);
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT r.measured_at, r.density::VARCHAR AS density, r.temperature_c::VARCHAR AS temperature_c,
           e.residual_sugar_gl::VARCHAR AS residual_sugar_gl
    FROM cellar.fermentation_reading r
    LEFT JOIN cellar.fermentation_reading_extra e ON e.reading_id = r.id
    WHERE ${filters.join(' AND ')}
    ORDER BY r.measured_at
  `);
  return { items: rows.map(pointOf) };
}

export async function fermentationCurve(writer: Writer, request: Request, code: string): Promise<{
  lot_id: string;
  points: CurvePoint[];
}> {
  sessionOf(request);
  const lot = await lotByCode(writer, code);
  const url = new URL(request.url);
  const vesselId = optionalQueryUuid(url.searchParams.get('vesselId') ?? url.searchParams.get('vessel_id'), 'vesselId');
  const rows = vesselId
    ? await writer.read<Record<string, unknown>>(sql`
      SELECT r.measured_at, r.density::VARCHAR AS density, r.temperature_c::VARCHAR AS temperature_c,
             e.residual_sugar_gl::VARCHAR AS residual_sugar_gl
      FROM cellar.fermentation_reading r
      LEFT JOIN cellar.fermentation_reading_extra e ON e.reading_id = r.id
      WHERE r.lot_id = CAST(${lot.id} AS UUID)
        AND r.vessel_id = CAST(${vesselId} AS UUID)
      ORDER BY r.measured_at
    `)
    : await writer.read<Record<string, unknown>>(sql`
      SELECT r.measured_at, r.density::VARCHAR AS density, r.temperature_c::VARCHAR AS temperature_c,
             e.residual_sugar_gl::VARCHAR AS residual_sugar_gl
      FROM cellar.fermentation_reading r
      LEFT JOIN cellar.fermentation_reading_extra e ON e.reading_id = r.id
      WHERE r.lot_id = CAST(${lot.id} AS UUID)
      ORDER BY r.measured_at
    `);
  return { lot_id: lot.id, points: rows.map(pointOf) };
}

export async function runFermentationAlerts(writer: Writer, now = new Date()): Promise<{ opened: number; closed: number }> {
  const thresholds = await loadThresholds(writer);
  const since = new Date(now.getTime() - 14 * 24 * 3_600_000).toISOString();
  const pairs = await writer.read<{ lot_id: string; vessel_id: string }>(sql`
    SELECT DISTINCT lot_id::VARCHAR AS lot_id, vessel_id::VARCHAR AS vessel_id
    FROM cellar.fermentation_reading
    WHERE measured_at >= CAST(${since} AS TIMESTAMPTZ)
  `);
  let opened = 0;
  let closed = 0;
  for (const pair of pairs) {
    const result = await syncPair(writer, pair.lot_id, pair.vessel_id, thresholds);
    opened += result.opened;
    closed += result.closed;
  }
  return { opened, closed };
}

export async function createAnalysis(writer: Writer, request: Request, code: string): Promise<Record<string, unknown>> {
  const lot = await lotByCode(writer, code);
  const body = await readJson(request);
  const sampledAt = requireText(body.at ?? body.sampled_at, 'at', 40);
  if (!isInstant(sampledAt)) invalid({ at: 'Debe ser un instante ISO-8601 con zona horaria' });
  const labRaw = requireText(body.lab, 'lab', 120);
  const lab = LABS.has(labRaw) ? labRaw : 'external';
  const labName = LABS.has(labRaw)
    ? optionalText(body.lab_name, 'lab_name', 120)
    : labRaw;
  const kindRaw = body.kind === undefined || body.kind === null ? 'control' : requireText(body.kind, 'kind', 20);
  if (!KINDS.has(kindRaw)) invalid({ kind: 'El tipo de analítica no es válido' });
  const vesselId = body.vesselId === undefined && body.vessel_id === undefined
    ? null
    : uuidOf(body.vesselId ?? body.vessel_id, 'vessel_id');
  const attachmentId = attachmentOf(body);
  const resultAt = optionalInstantField(body.result_at ?? body.resultAt, 'result_at');
  if (resultAt && Date.parse(resultAt) < Date.parse(sampledAt)) {
    invalid({ result_at: 'El resultado no puede ser anterior a la muestra' });
  }
  const labContactId = optionalUuidField(body.lab_contact_id ?? body.labContactId, 'lab_contact_id');
  const sampleOperationId = optionalUuidField(body.sample_operation_id ?? body.sampleOperationId, 'sample_operation_id');
  const results = parseResults(body.results);
  const actor = actorFor(request, 'analítica');
  const id = newId();
  const wine = await writer.read<{ color: string | null; is_organic: boolean }>(sql`
    SELECT w.color, l.is_organic
    FROM inventory.lot l
    LEFT JOIN catalog.wine w ON w.id = l.wine_id
    WHERE l.id = CAST(${lot.id} AS UUID)
  `);
  const color = wine[0]?.color ?? null;
  const organic = wine[0]?.is_organic === true;
  const sugar = results.find((row) => row.parameter === 'glucose_fructose')?.value ?? null;
  const categories = categoriesFor(color, organic, sugar);

  await writer.withWrite(actor, async (tx) => {
    if (vesselId) await assertVessel(tx, vesselId);
    if (attachmentId) {
      const found = await tx.read(sql`SELECT id FROM core.attachment WHERE id = CAST(${attachmentId} AS UUID)`);
      if (found.length === 0) invalid({ pdf: 'El informe adjunto no existe' });
    }
    if (labContactId) {
      const contact = await tx.read<{ is_supplier: boolean }>(sql`
        SELECT is_supplier FROM party.contact WHERE id = CAST(${labContactId} AS UUID)
      `);
      if (!contact[0]) invalid({ lab_contact_id: 'El laboratorio no existe' });
      if (contact[0].is_supplier !== true) invalid({ lab_contact_id: 'El laboratorio tiene que ser un proveedor' });
    }
    if (sampleOperationId) {
      const operation = await tx.read<{ op_type: string }>(sql`
        SELECT op_type FROM cellar.operation WHERE id = CAST(${sampleOperationId} AS UUID)
      `);
      if (!operation[0]) invalid({ sample_operation_id: 'La muestra no existe' });
      if (operation[0].op_type !== 'sampling') invalid({ sample_operation_id: 'La muestra tiene que ser una toma de muestras' });
    }
    const parameters = await tx.read<{ code: string; unit: string; min_value: string | null; max_value: string | null }>(`
      SELECT code, unit, min_value::VARCHAR AS min_value, max_value::VARCHAR AS max_value
      FROM cellar.analysis_parameter
    `);
    const byCode = new Map(parameters.map((row) => [row.code, row]));
    for (const result of results) {
      const parameter = byCode.get(result.parameter);
      if (!parameter) invalid({ [`results.${result.parameter}`]: 'Parámetro desconocido' });
      if (parameter.unit !== result.unit) {
        invalid({ [`results.${result.parameter}`]: `La unidad debe ser ${parameter.unit}` });
      }
      const violation = outsidePhysical(result.value, { min: parameter.min_value, max: parameter.max_value });
      if (violation) {
        throw domainError(
          'WC_ANALYSIS_RANGE',
          { [`results.${result.parameter}`]: 'Fuera del rango físico' },
          `WC_ANALYSIS_RANGE: ${result.parameter} está fuera del rango físico`,
        );
      }
    }
    tx.write(sql`
      INSERT INTO cellar.analysis (
        id, lot_id, vessel_id, kind, sampled_at, lab, lab_name, report_attachment_id, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${lot.id} AS UUID),
        CAST(${vesselId} AS UUID),
        ${kindRaw},
        CAST(${sampledAt} AS TIMESTAMPTZ),
        ${lab},
        ${labName},
        CAST(${attachmentId} AS UUID),
        ${actor.id}
      )
    `);
    tx.audit({
      table: 'cellar.analysis',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { lot_id: lot.id, sampled_at: sampledAt, lab },
    });
    if (labContactId || sampleOperationId || resultAt) {
      tx.write(sql`
        INSERT INTO cellar.analysis_extra (analysis_id, lab_contact_id, sample_operation_id, result_at)
        VALUES (
          CAST(${id} AS UUID),
          CAST(${labContactId} AS UUID),
          CAST(${sampleOperationId} AS UUID),
          CAST(${resultAt} AS TIMESTAMPTZ)
        )
      `);
    }
    const limits = categories.length === 0
      ? []
      : await tx.read<{ category: string; parameter_code: string; min_value: string | null; max_value: string | null }>(`
        SELECT category, parameter_code, min_value::VARCHAR AS min_value, max_value::VARCHAR AS max_value
        FROM cellar.analysis_limit
        WHERE category IN (${categories.map((category) => sql`${category}`).join(', ')})
      `);
    for (const result of results) {
      const resultId = newId();
      tx.write(sql`
        INSERT INTO cellar.analysis_result (id, analysis_id, parameter_code, value)
        VALUES (
          CAST(${resultId} AS UUID),
          CAST(${id} AS UUID),
          ${result.parameter},
          CAST(${result.value} AS DECIMAL(12,4))
        )
      `);
      for (const limit of limits) {
        if (limit.parameter_code !== result.parameter) continue;
        const bound = outsideLimit(result.value, { min: limit.min_value, max: limit.max_value });
        if (!bound) continue;
        const flagId = newId();
        const limitValue = bound === 'max' ? limit.max_value : limit.min_value;
        tx.write(sql`
          INSERT INTO cellar.analysis_flag (id, analysis_id, parameter_code, category, bound, limit_value, value)
          VALUES (
            CAST(${flagId} AS UUID),
            CAST(${id} AS UUID),
            ${result.parameter},
            ${limit.category},
            ${bound},
            CAST(${limitValue} AS DECIMAL(12,4)),
            CAST(${result.value} AS DECIMAL(12,4))
          )
        `);
      }
    }
    await applyAssumptionMarks(tx, {
      analysisId: id,
      lotId: lot.id,
      sampledAt,
      results,
    });
  });
  return analysisById(writer, id);
}

export async function listAnalyses(writer: Writer, _request: Request, code: string): Promise<{
  items: Record<string, unknown>[];
  next_cursor: null;
  total: number;
}> {
  const lot = await lotByCode(writer, code);
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM cellar.analysis
    WHERE lot_id = CAST(${lot.id} AS UUID)
    ORDER BY sampled_at DESC, id DESC
  `);
  const items = [];
  for (const row of rows) items.push(await analysisById(writer, row.id));
  return { items, next_cursor: null, total: items.length };
}

export async function latestAnalysis(writer: Writer, request: Request, code: string): Promise<Record<string, unknown>> {
  const list = await listAnalyses(writer, request, code);
  const first = list.items[0];
  if (!first) throw domainError('WC_NOT_FOUND');
  return first;
}

export async function createTasting(writer: Writer, request: Request, code: string): Promise<Record<string, unknown>> {
  const lot = await lotByCode(writer, code);
  const body = await readJson(request);
  const tastedAt = requireText(body.at ?? body.tasted_at, 'at', 40);
  if (!isInstant(tastedAt)) invalid({ at: 'Debe ser un instante ISO-8601 con zona horaria' });
  const author = requireText(body.author, 'author', 120);
  const notes = requireText(body.notes, 'notes', 4000);
  const decision = optionalText(body.decision, 'decision', 500);
  const vesselId = body.vesselId === undefined && body.vessel_id === undefined
    ? null
    : uuidOf(body.vesselId ?? body.vessel_id, 'vessel_id');
  const sourceRaw = body.source === undefined || body.source === null ? 'manual' : requireText(body.source, 'source', 20);
  if (sourceRaw !== 'manual' && sourceRaw !== 'voice' && sourceRaw !== 'chat') {
    invalid({ source: 'El origen de la cata no es válido' });
  }
  const actor = actorFor(request, 'cata');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    if (vesselId) await assertVessel(tx, vesselId);
    tx.write(sql`
      INSERT INTO cellar.tasting (id, lot_id, vessel_id, tasted_at, author, notes, decision, source)
      VALUES (
        CAST(${id} AS UUID),
        CAST(${lot.id} AS UUID),
        CAST(${vesselId} AS UUID),
        CAST(${tastedAt} AS TIMESTAMPTZ),
        ${author},
        ${notes},
        ${decision},
        ${sourceRaw}
      )
    `);
    tx.audit({
      table: 'cellar.tasting',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { lot_id: lot.id, tasted_at: tastedAt },
    });
  });
  return tastingById(writer, id);
}

export async function lotEvolution(writer: Writer, request: Request, code: string) {
  sessionOf(request);
  const lot = await lotByCode(writer, code);
  const [analyses, readings, phases] = await Promise.all([
    listAnalyses(writer, request, code),
    fermentationCurve(writer, request, code),
    writer.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, phase, status, started_at, ended_at, inoculation,
             target_temp_c::VARCHAR AS target_temp_c, aging_method, end_evidence, observations
      FROM cellar.lot_phase
      WHERE lot_id = CAST(${lot.id} AS UUID)
      ORDER BY coalesce(started_at, created_at)
    `),
  ]);
  return {
    lot_id: lot.id,
    analyses: analyses.items,
    readings: readings.points,
    phases,
  };
}

export async function createParcelAnalysis(writer: Writer, request: Request, code: string): Promise<Record<string, unknown>> {
  const parcel = await parcelByCode(writer, code);
  const body = await readJson(request);
  const sampledAt = requireText(body.at ?? body.sampled_at, 'at', 40);
  if (!isInstant(sampledAt)) invalid({ at: 'Debe ser un instante ISO-8601 con zona horaria' });
  const resultAt = optionalInstantField(body.result_at ?? body.resultAt, 'result_at');
  if (resultAt && Date.parse(resultAt) < Date.parse(sampledAt)) {
    invalid({ result_at: 'El resultado no puede ser anterior a la muestra' });
  }
  const labRaw = requireText(body.lab, 'lab', 120);
  const lab = LABS.has(labRaw) ? labRaw : 'external';
  const labName = LABS.has(labRaw) ? optionalText(body.lab_name, 'lab_name', 120) : labRaw;
  const results = parseResults(body.results);
  const actor = actorFor(request, 'analítica de parcela');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const parameters = await tx.read<{ code: string; unit: string; min_value: string | null; max_value: string | null }>(`
      SELECT code, unit, min_value::VARCHAR AS min_value, max_value::VARCHAR AS max_value
      FROM cellar.analysis_parameter
    `);
    const byCode = new Map(parameters.map((row) => [row.code, row]));
    for (const result of results) {
      const parameter = byCode.get(result.parameter);
      if (!parameter) invalid({ [`results.${result.parameter}`]: 'Parámetro desconocido' });
      if (parameter.unit !== result.unit) invalid({ [`results.${result.parameter}`]: `La unidad debe ser ${parameter.unit}` });
      if (outsidePhysical(result.value, { min: parameter.min_value, max: parameter.max_value })) {
        throw domainError('WC_ANALYSIS_RANGE', { [`results.${result.parameter}`]: 'Fuera del rango físico' });
      }
    }
    tx.write(sql`
      INSERT INTO cellar.parcel_analysis (
        id, parcel_id, kind, sampled_at, result_at, lab, lab_name, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${parcel.id} AS UUID),
        'grape',
        CAST(${sampledAt} AS TIMESTAMPTZ),
        CAST(${resultAt} AS TIMESTAMPTZ),
        ${lab},
        ${labName},
        ${actor.id}
      )
    `);
    for (const result of results) {
      tx.write(sql`
        INSERT INTO cellar.parcel_analysis_result (id, analysis_id, parameter_code, value)
        VALUES (
          CAST(${newId()} AS UUID),
          CAST(${id} AS UUID),
          ${result.parameter},
          CAST(${result.value} AS DECIMAL(12,4))
        )
      `);
    }
  });
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT a.id::VARCHAR AS id, a.parcel_id::VARCHAR AS parcel_id, a.kind, a.sampled_at, a.result_at,
           a.lab, a.lab_name, a.created_by
    FROM cellar.parcel_analysis a WHERE a.id = CAST(${id} AS UUID)
  `);
  const resultsRows = await writer.read<Record<string, unknown>>(sql`
    SELECT parameter_code, value::VARCHAR AS value FROM cellar.parcel_analysis_result
    WHERE analysis_id = CAST(${id} AS UUID)
  `);
  return { ...rows[0], lot_id: null, results: resultsRows };
}

export async function listTastings(writer: Writer, _request: Request, code: string): Promise<{
  items: Record<string, unknown>[];
  next_cursor: null;
  total: number;
}> {
  const lot = await lotByCode(writer, code);
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, lot_id::VARCHAR AS lot_id, vessel_id::VARCHAR AS vessel_id,
           tasted_at, author, notes, decision, source, created_at
    FROM cellar.tasting
    WHERE lot_id = CAST(${lot.id} AS UUID)
    ORDER BY tasted_at DESC
  `);
  return { items: rows, next_cursor: null, total: rows.length };
}

export function parseAllergens(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8) invalid({ 'addition.allergens': 'Lista de alérgenos no válida' });
  return value.map((item, index) => {
    if (typeof item !== 'string' || !ALLERGEN.test(item)) {
      invalid({ [`addition.allergens[${index}]`]: 'Alérgeno no válido' });
    }
    return item;
  });
}

export function parseAdditiveLot(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ADDITIVE_LOT.test(value)) {
    invalid({ 'addition.additive_lot_code': 'El lote del aditivo no es válido' });
  }
  return value;
}

async function syncPair(
  writer: Writer,
  lotId: string,
  vesselId: string,
  thresholds: AlertThresholds,
): Promise<{ opened: number; closed: number }> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT measured_at, density::VARCHAR AS density, temperature_c::VARCHAR AS temperature_c
    FROM cellar.fermentation_reading
    WHERE lot_id = CAST(${lotId} AS UUID) AND vessel_id = CAST(${vesselId} AS UUID)
    ORDER BY measured_at
  `);
  const points: ReadingPoint[] = rows.map((row) => ({
    at: instantOf(row.measured_at),
    density: row.density == null ? null : Number(row.density),
    temperatureC: row.temperature_c == null ? null : Number(row.temperature_c),
  }));
  const hits = evaluateFermentationAlerts(points, thresholds);
  const hitByRule = new Map<AlertRule, AlertHit>(hits.map((hit) => [hit.rule, hit]));
  const rules: AlertRule[] = ['stuck', 'temperature', 'density_stall'];
  let opened = 0;
  let closed = 0;
  const lot = await writer.read<{ producer_entity_id: string; code: string }>(sql`
    SELECT producer_entity_id::VARCHAR AS producer_entity_id, code
    FROM inventory.lot WHERE id = CAST(${lotId} AS UUID)
  `);
  const entityId = lot[0]?.producer_entity_id ?? null;
  const code = lot[0]?.code ?? lotId;
  await writer.withWrite(
    { type: 'system', id: 'fermentation-alerts', requestId: newId(), reason: 'alerta de fermentación' },
    async (tx) => {
      for (const rule of rules) {
        const open = await tx.read<{ id: string }>(sql`
          SELECT id::VARCHAR AS id FROM cellar.fermentation_alert
          WHERE lot_id = CAST(${lotId} AS UUID)
            AND vessel_id = CAST(${vesselId} AS UUID)
            AND rule = ${rule}
            AND status = 'open'
        `);
        const hit = hitByRule.get(rule);
        if (hit && open.length === 0) {
          const id = newId();
          tx.write(sql`
            INSERT INTO cellar.fermentation_alert (id, lot_id, vessel_id, rule, status, opened_at, reading_at)
            VALUES (
              CAST(${id} AS UUID),
              CAST(${lotId} AS UUID),
              CAST(${vesselId} AS UUID),
              ${rule},
              'open',
              CAST(${hit.at} AS TIMESTAMPTZ),
              CAST(${hit.at} AS TIMESTAMPTZ)
            )
          `);
          const link = lotLink(code);
          emitEvent(tx, {
            type: 'cellar.fermentation.alert',
            aggregate: 'cellar.fermentation_reading',
            aggregateId: id,
            payload: {
              lot_id: lotId,
              vessel_id: vesselId,
              rule,
              legal_entity_id: entityId,
              ...(link ? { link } : {}),
            },
          });
          opened += 1;
        } else if (!hit && open[0]) {
          tx.write(sql`
            UPDATE cellar.fermentation_alert
            SET status = 'closed', closed_at = now(), updated_at = now()
            WHERE id = CAST(${open[0].id} AS UUID) AND status = 'open'
          `);
          closed += 1;
        }
      }
    },
  );
  return { opened, closed };
}

function lotLink(code: string): string | null {
  const link = `/bodega/lotes/${code}`;
  return /^\/[A-Za-z0-9._~/-]{1,180}$/.test(link) ? link : null;
}

async function loadThresholds(writer: Writer): Promise<AlertThresholds> {
  const rows = await writer.read<{ key: string; value: unknown }>(sql`
    SELECT key, value FROM core.setting
    WHERE key IN (
      'cellar.alerts.min_density_drop_48h',
      'cellar.alerts.temperature_range_c',
      'cellar.alerts.density_window_hours',
      'cellar.alerts.stall_hours',
      'cellar.alerts.dry_density'
    )
  `);
  const map = new Map<string, unknown>();
  for (const row of rows) map.set(row.key, unwrapJson(row.value));
  return rows.length === 0 ? DEFAULT_ALERTS : parseAlertSettings(map);
}

function categoriesFor(color: string | null, organic: boolean, sugar: string | null): string[] {
  const categories: string[] = [];
  if (color === 'red' || color === 'white' || color === 'rose') categories.push(color);
  if (organic && color) {
    const organicKey = organicCategory(color, sugarBand(sugar));
    if (organicKey) categories.push(organicKey);
  }
  return categories;
}

async function analysisById(writer: Writer, id: string): Promise<Record<string, unknown>> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT a.id::VARCHAR AS id, a.lot_id::VARCHAR AS lot_id, a.vessel_id::VARCHAR AS vessel_id,
           a.kind, a.sampled_at, a.lab, a.lab_name, a.report_attachment_id::VARCHAR AS report_attachment_id,
           a.notes, a.created_by, a.created_at,
           e.lab_contact_id::VARCHAR AS lab_contact_id,
           e.sample_operation_id::VARCHAR AS sample_operation_id,
           e.result_at
    FROM cellar.analysis a
    LEFT JOIN cellar.analysis_extra e ON e.analysis_id = a.id
    WHERE a.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const results = await writer.read<Record<string, unknown>>(sql`
    SELECT r.parameter_code, r.value::VARCHAR AS value, p.unit, p.name_es
    FROM cellar.analysis_result r
    JOIN cellar.analysis_parameter p ON p.code = r.parameter_code
    WHERE r.analysis_id = CAST(${id} AS UUID)
    ORDER BY r.parameter_code
  `);
  const flags = await writer.read<Record<string, unknown>>(sql`
    SELECT parameter_code, category, bound, limit_value::VARCHAR AS limit_value, value::VARCHAR AS value
    FROM cellar.analysis_flag
    WHERE analysis_id = CAST(${id} AS UUID)
  `);
  const flagged = new Set(
    flags.filter((flag) => !String(flag.category).startsWith('assumption_ok_')).map((flag) => String(flag.parameter_code)),
  );
  const categories = new Set(flags.map((flag) => String(flag.category)));
  return {
    ...row,
    out_of_spec: flagged.size > 0,
    results: results.map((result) => ({
      parameter: result.parameter_code,
      value: result.value,
      unit: result.unit,
      name_es: result.name_es,
      out_of_spec: flagged.has(String(result.parameter_code)),
    })),
    flags,
    marks: {
      volatile: categories.has('assumption_volatile'),
      volatile_overlap: categories.has('assumption_overlap'),
      dry: categories.has('assumption_ok_dry'),
      malolactic_finished: categories.has('assumption_ok_fml'),
      assumptions: true,
    },
  };
}

async function readingById(writer: Writer, id: string): Promise<Record<string, unknown>> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT r.id::VARCHAR AS id, r.lot_id::VARCHAR AS lot_id, r.vessel_id::VARCHAR AS vessel_id,
           r.measured_at, r.density::VARCHAR AS density, r.temperature_c::VARCHAR AS temperature_c,
           r.measured_by, r.source, e.residual_sugar_gl::VARCHAR AS residual_sugar_gl
    FROM cellar.fermentation_reading r
    LEFT JOIN cellar.fermentation_reading_extra e ON e.reading_id = r.id
    WHERE r.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function tastingById(writer: Writer, id: string): Promise<Record<string, unknown>> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, lot_id::VARCHAR AS lot_id, vessel_id::VARCHAR AS vessel_id,
           tasted_at, author, notes, decision, source, created_at
    FROM cellar.tasting WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function lotByCode(writer: Writer, code: string): Promise<{ id: string }> {
  if (!LOT_CODE.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM inventory.lot WHERE code = ${code}
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (rows.length > 1) {
    throw domainError('WC_VALIDATION', { code: 'Hay varios lotes con este código' });
  }
  return row;
}

async function assertLotId(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM inventory.lot WHERE id = CAST(${id} AS UUID)`);
  if (rows.length === 0) invalid({ lotId: 'El lote no existe' });
}

async function assertVessel(tx: Tx, id: string): Promise<void> {
  const rows = await tx.read(sql`SELECT id FROM cellar.vessel WHERE id = CAST(${id} AS UUID)`);
  if (rows.length === 0) invalid({ vesselId: 'El recipiente no existe' });
}

function parseResults(value: unknown): { parameter: string; value: string; unit: string }[] {
  if (!Array.isArray(value) || value.length === 0) invalid({ results: 'La analítica no tiene resultados' });
  return value.map((item, index) => {
    const field = `results[${index}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) invalid({ [field]: 'Resultado no válido' });
    const row = item as Record<string, unknown>;
    const parameter = requireText(row.parameter ?? row.parameter_code, `${field}.parameter`, 40);
    const unit = requireText(row.unit, `${field}.unit`, 20);
    return { parameter, unit, value: decimalText(row.value, `${field}.value`, 4) };
  });
}

function attachmentOf(body: Record<string, unknown>): string | null {
  const raw = body.report_attachment_id ?? body.pdf ?? body.attachment_id;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID.test(raw)) invalid({ pdf: 'El informe debe ser el identificador de un adjunto' });
  return raw.toLowerCase();
}

function pointOf(row: Record<string, unknown>): CurvePoint {
  return {
    at: instantOf(row.measured_at),
    density: row.density == null ? null : String(row.density),
    temperature_c: row.temperature_c == null ? null : String(row.temperature_c),
    residual_sugar_gl: row.residual_sugar_gl == null ? null : String(row.residual_sugar_gl),
  };
}

function instantOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function uuidOf(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid({ [field]: 'Debe ser un UUID' });
  return value.toLowerCase();
}

function optionalQueryUuid(value: string | null, field: string): string | null {
  if (value === null || value.trim() === '') return null;
  return uuidOf(value, field);
}

function optionalDecimal(value: unknown, field: string, scale: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return decimalText(value, field, scale);
}

function decimalText(value: unknown, field: string, scale: number): string {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || text.trim() === '' || /[eE]/.test(text)) {
    invalid({ [field]: 'Debe ser un decimal' });
  }
  try {
    const parsed = money.fromString(text.trim());
    if (parsed.decimalPlaces() > scale) invalid({ [field]: `Máximo ${scale} decimales` });
    return parsed.toFixed(scale);
  } catch {
    invalid({ [field]: 'Debe ser un decimal' });
  }
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, max);
}

function isInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function optionalInstantField(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = requireText(value, field, 40);
  if (!isInstant(text)) invalid({ [field]: 'Debe ser un instante ISO-8601 con zona horaria' });
  return text;
}

function optionalUuidField(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuidOf(value, field);
}

async function parcelByCode(writer: Writer, code: string): Promise<{ id: string }> {
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM vineyard.parcel WHERE code = ${code} AND is_active
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

const ASSUMPTION_DEFAULTS = { volatile: '0.6', dry: '2', malic: '0.3' };

async function enologyThresholds(tx: Tx, entityId: string | null): Promise<{ volatile: string; dry: string; malic: string }> {
  const tables = await tx.read<{ name: string }>(`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = 'cellar' AND table_name = 'enology_setting'
  `);
  const found = { ...ASSUMPTION_DEFAULTS };
  if (tables.length > 0) {
    const rows = entityId
      ? await tx.read<{ key: string; value: string }>(sql`
        SELECT key, value::VARCHAR AS value FROM cellar.enology_setting
        WHERE legal_entity_id = CAST(${entityId} AS UUID)
          AND key IN ('volatile_acidity_alert','dry_sugars_max','fml_malic_max')
      `)
      : await tx.read<{ key: string; value: string }>(`
        SELECT key, value::VARCHAR AS value FROM cellar.enology_setting
        WHERE key IN ('volatile_acidity_alert','dry_sugars_max','fml_malic_max')
      `);
    for (const row of rows) {
      if (row.key === 'volatile_acidity_alert') found.volatile = row.value;
      if (row.key === 'dry_sugars_max') found.dry = row.value;
      if (row.key === 'fml_malic_max') found.malic = row.value;
    }
  }
  const settings = await tx.read<{ key: string; value: unknown }>(sql`
    SELECT key, value FROM core.setting
    WHERE key IN (
      'cellar.alerts.volatile_acidity_alert',
      'cellar.alerts.dry_sugars_max',
      'cellar.alerts.fml_malic_max'
    )
  `);
  for (const row of settings) {
    const raw = unwrapJson(row.value);
    const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null;
    if (!text) continue;
    if (row.key.endsWith('volatile_acidity_alert') && tables.length === 0) found.volatile = text;
    if (row.key.endsWith('dry_sugars_max') && tables.length === 0) found.dry = text;
    if (row.key.endsWith('fml_malic_max') && tables.length === 0) found.malic = text;
  }
  return found;
}

async function applyAssumptionMarks(
  tx: Tx,
  input: { analysisId: string; lotId: string; sampledAt: string; results: { parameter: string; value: string }[] },
): Promise<void> {
  const entity = await tx.read<{ producer_entity_id: string }>(sql`
    SELECT producer_entity_id::VARCHAR AS producer_entity_id FROM inventory.lot WHERE id = CAST(${input.lotId} AS UUID)
  `);
  const thresholds = await enologyThresholds(tx, entity[0]?.producer_entity_id ?? null);
  const valueOf = (parameter: string) => input.results.find((row) => row.parameter === parameter)?.value ?? null;
  const volatile = valueOf('volatile_acidity');
  const sugars = valueOf('glucose_fructose');
  const malic = valueOf('malic_acid');
  if (volatile && !money.fromString(volatile).lt(money.fromString(thresholds.volatile))) {
    await insertFlag(tx, input.analysisId, 'volatile_acidity', 'assumption_volatile', 'max', thresholds.volatile, volatile);
    emitEvent(tx, {
      type: 'cellar.fermentation.alert',
      aggregate: 'cellar.analysis',
      aggregateId: input.analysisId,
      payload: {
        lot_id: input.lotId,
        rule: 'volatile',
        legal_entity_id: entity[0]?.producer_entity_id ?? null,
        link: '/bodega/lotes',
      },
    });
  }
  if (sugars && !money.fromString(sugars).gt(money.fromString(thresholds.dry))) {
    await insertFlag(tx, input.analysisId, 'glucose_fructose', 'assumption_ok_dry', 'max', thresholds.dry, sugars);
  }
  if (malic && !money.fromString(malic).gt(money.fromString(thresholds.malic))) {
    await insertFlag(tx, input.analysisId, 'malic_acid', 'assumption_ok_fml', 'max', thresholds.malic, malic);
  }
  if (!volatile) return;
  const phases = await tx.read<{ phase: string }>(sql`
    SELECT phase FROM cellar.lot_phase
    WHERE lot_id = CAST(${input.lotId} AS UUID)
      AND status = 'in_progress'
      AND phase IN ('alcoholic_fermentation','malolactic_fermentation')
  `);
  const names = new Set(phases.map((row) => row.phase));
  if (!names.has('alcoholic_fermentation') || !names.has('malolactic_fermentation')) return;
  const previous = await tx.read<{ value: string }>(sql`
    SELECT r.value::VARCHAR AS value
    FROM cellar.analysis_result r
    JOIN cellar.analysis a ON a.id = r.analysis_id
    WHERE a.lot_id = CAST(${input.lotId} AS UUID)
      AND a.id <> CAST(${input.analysisId} AS UUID)
      AND r.parameter_code = 'volatile_acidity'
      AND a.sampled_at <= CAST(${input.sampledAt} AS TIMESTAMPTZ)
    ORDER BY a.sampled_at DESC
    LIMIT 1
  `);
  const prior = previous[0]?.value;
  if (!prior || !money.fromString(volatile).gt(money.fromString(prior))) return;
  await insertFlag(tx, input.analysisId, 'volatile_acidity', 'assumption_overlap', 'max', prior, volatile);
  emitEvent(tx, {
    type: 'cellar.fermentation.alert',
    aggregate: 'cellar.analysis',
    aggregateId: input.analysisId,
    payload: {
      lot_id: input.lotId,
      rule: 'volatile_overlap',
      legal_entity_id: entity[0]?.producer_entity_id ?? null,
      link: '/bodega/lotes',
    },
  });
}

async function insertFlag(
  tx: Tx,
  analysisId: string,
  parameter: string,
  category: string,
  bound: 'min' | 'max',
  limitValue: string,
  value: string,
): Promise<void> {
  tx.write(sql`
    INSERT INTO cellar.analysis_flag (id, analysis_id, parameter_code, category, bound, limit_value, value)
    VALUES (
      CAST(${newId()} AS UUID),
      CAST(${analysisId} AS UUID),
      ${parameter},
      ${category},
      ${bound},
      CAST(${limitValue} AS DECIMAL(12,4)),
      CAST(${value} AS DECIMAL(12,4))
    )
  `);
}

function unwrapJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
