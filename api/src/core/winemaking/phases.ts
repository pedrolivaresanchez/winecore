import { sessionOf } from '../../auth/guard';
import { sql } from '../db/sql';
import type { Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { money } from '../money';
import { actorFor, invalid, readJson, requireText } from '../cellar/service/http';
import { coldStabilisationTargetC } from './yields';

const LOT_CODE = /^[A-Z0-9][A-Z0-9./-]{1,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHASES = [
  'cold_soak',
  'aqueous_maceration',
  'skin_maceration',
  'post_fermentation_maceration',
  'alcoholic_fermentation',
  'malolactic_fermentation',
  'natural_cold_stabilisation',
  'forced_cold_stabilisation',
  'protein_stabilisation',
  'aging',
] as const;
const FERMENTATIONS = new Set(['alcoholic_fermentation', 'malolactic_fermentation']);
const COLD = new Set(['natural_cold_stabilisation', 'forced_cold_stabilisation']);
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export async function listPhases(writer: Writer, request: Request, code: string) {
  sessionOf(request);
  const lot = await lotByCode(writer, code);
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, lot_id::VARCHAR AS lot_id, vessel_id::VARCHAR AS vessel_id,
           phase, status, started_at, ended_at, inoculation,
           inoculum_product_id::VARCHAR AS inoculum_product_id,
           target_temp_c::VARCHAR AS target_temp_c, aging_method, end_evidence,
           end_analysis_id::VARCHAR AS end_analysis_id, observations, created_by, created_at
    FROM cellar.lot_phase
    WHERE lot_id = CAST(${lot.id} AS UUID)
    ORDER BY coalesce(started_at, created_at), id
  `);
  return { items: rows, next_cursor: null, total: rows.length };
}

export async function startPhase(writer: Writer, request: Request, code: string): Promise<Record<string, unknown>> {
  const lot = await lotByCode(writer, code);
  const body = await readJson(request);
  const phase = onePhase(body.phase);
  const startedAt = requireText(body.started_at ?? body.startedAt, 'started_at', 40);
  if (!INSTANT.test(startedAt)) invalid({ started_at: 'Debe ser un instante ISO-8601 con zona horaria' });
  const vesselId = optionalUuid(body.vessel_id ?? body.vesselId, 'vessel_id');
  const inoculation = optionalEnum(body.inoculation, 'inoculation', ['spontaneous', 'commercial'] as const);
  const productId = optionalUuid(body.inoculum_product_id ?? body.inoculumProductId, 'inoculum_product_id');
  let target = optionalTemp(body.target_temp_c ?? body.targetTempC, 'target_temp_c');
  const aging = optionalEnum(body.aging_method ?? body.agingMethod, 'aging_method', ['tank', 'barrel', 'demijohn_outdoor'] as const);
  let observations = optionalText(body.observations, 'observations', 2000);
  if (body.white_as_red === true || body.whiteAsRed === true) {
    const note = 'blanca vinificada en tinto';
    observations = observations ? `${note}. ${observations}` : note;
  }
  if (FERMENTATIONS.has(phase) && inoculation === null) {
    invalid({ inoculation: 'La fermentación indica si es espontánea o comercial' });
  }
  if (inoculation === 'commercial' && !productId) {
    invalid({ inoculum_product_id: 'La inoculación comercial necesita el producto' });
  }
  if (!FERMENTATIONS.has(phase) && inoculation !== null) {
    invalid({ inoculation: 'La inoculación solo aplica a fermentaciones' });
  }
  if (phase === 'aging' && aging === null) invalid({ aging_method: 'La crianza indica depósito, barrica o damajuana' });
  if (phase !== 'aging' && aging !== null) invalid({ aging_method: 'El método de crianza solo aplica a la crianza' });
  const actor = actorFor(request, 'fase de lote');
  if (COLD.has(phase) && target === null) {
    const abv = await latestAbv(writer, lot.id);
    if (!abv) invalid({ target_temp_c: 'Falta la temperatura objetivo o un grado alcohólico del lote' });
    target = coldStabilisationTargetC(abv);
  }
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    if (vesselId) await assertId(tx, 'cellar.vessel', vesselId, 'vessel_id', 'El recipiente no existe');
    if (productId) await assertId(tx, 'catalog.product', productId, 'inoculum_product_id', 'El producto no existe');
    const open = await tx.read(sql`
      SELECT id FROM cellar.lot_phase
      WHERE lot_id = CAST(${lot.id} AS UUID) AND phase = ${phase} AND status = 'in_progress'
    `);
    if (open.length > 0) invalid({ phase: 'Esa fase ya está en curso' });
    tx.write(sql`
      INSERT INTO cellar.lot_phase (
        id, lot_id, vessel_id, phase, status, started_at, inoculation, inoculum_product_id,
        target_temp_c, aging_method, observations, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${lot.id} AS UUID),
        CAST(${vesselId} AS UUID),
        ${phase},
        'in_progress',
        CAST(${startedAt} AS TIMESTAMPTZ),
        ${inoculation},
        CAST(${productId} AS UUID),
        CAST(${target} AS DECIMAL(4,1)),
        ${aging},
        ${observations},
        ${actor.id}
      )
    `);
    tx.audit({
      table: 'cellar.lot_phase',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { lot_id: lot.id, phase, status: 'in_progress' },
    });
  });
  return phaseById(writer, id);
}

export async function endPhase(writer: Writer, request: Request, code: string, phaseId: string): Promise<Record<string, unknown>> {
  return closePhase(writer, request, code, phaseId, 'completed');
}

export async function stopPhase(writer: Writer, request: Request, code: string, phaseId: string): Promise<Record<string, unknown>> {
  return closePhase(writer, request, code, phaseId, 'stopped');
}

async function closePhase(
  writer: Writer,
  request: Request,
  code: string,
  phaseId: string,
  status: 'completed' | 'stopped',
): Promise<Record<string, unknown>> {
  if (!UUID.test(phaseId)) throw domainError('WC_NOT_FOUND');
  const lot = await lotByCode(writer, code);
  const body = await readJson(request);
  const endedAt = requireText(body.ended_at ?? body.endedAt, 'ended_at', 40);
  if (!INSTANT.test(endedAt)) invalid({ ended_at: 'Debe ser un instante ISO-8601 con zona horaria' });
  const evidence = optionalEnum(body.end_evidence ?? body.endEvidence, 'end_evidence', ['sensory', 'analysis', 'both'] as const);
  const analysisId = optionalUuid(body.end_analysis_id ?? body.endAnalysisId, 'end_analysis_id');
  const observations = optionalText(body.observations, 'observations', 2000);
  const actor = actorFor(request, status === 'completed' ? 'fin de fase' : 'parada de fase');
  await writer.withWrite(actor, async (tx) => {
    const rows = await tx.read<{ phase: string; status: string; started_at: string | null }>(sql`
      SELECT phase, status, started_at
      FROM cellar.lot_phase
      WHERE id = CAST(${phaseId} AS UUID) AND lot_id = CAST(${lot.id} AS UUID)
    `);
    const row = rows[0];
    if (!row) throw domainError('WC_NOT_FOUND');
    if (row.status !== 'in_progress') {
      throw domainError('WC_ILLEGAL_TRANSITION', { status: 'La fase no está en curso' });
    }
    if (row.started_at && Date.parse(endedAt) < Date.parse(String(row.started_at))) {
      invalid({ ended_at: 'El fin es anterior al inicio' });
    }
    if (status === 'completed' && row.phase === 'malolactic_fermentation' && evidence === null) {
      invalid({ end_evidence: 'El fin de la maloláctica indica si es sensorial, analítico o ambos' });
    }
    if ((evidence === 'analysis' || evidence === 'both') && !analysisId) {
      invalid({ end_analysis_id: 'Falta la analítica que cierra la fase' });
    }
    if (analysisId) {
      const found = await tx.read(sql`
        SELECT id FROM cellar.analysis
        WHERE id = CAST(${analysisId} AS UUID) AND lot_id = CAST(${lot.id} AS UUID)
      `);
      if (found.length === 0) invalid({ end_analysis_id: 'La analítica no es de este lote' });
    }
    tx.write(sql`
      UPDATE cellar.lot_phase
      SET status = ${status},
          ended_at = CAST(${endedAt} AS TIMESTAMPTZ),
          end_evidence = ${evidence},
          end_analysis_id = CAST(${analysisId} AS UUID),
          observations = coalesce(${observations}, observations)
      WHERE id = CAST(${phaseId} AS UUID)
    `);
    tx.audit({
      table: 'cellar.lot_phase',
      rowId: phaseId,
      action: 'UPDATE',
      before: { status: 'in_progress' },
      after: { status, ended_at: endedAt },
    });
  });
  return phaseById(writer, phaseId);
}

export async function mirrorFermentationPhase(
  tx: Tx,
  input: {
    operationId: string;
    lotId: string;
    vesselId: string;
    kind: 'alcoholic' | 'alcoholic_done' | 'malolactic' | 'malolactic_done';
    at: string;
    actorId: string;
    inoculation: 'spontaneous' | 'commercial' | null;
    inoculumProductId: string | null;
    observations: string | null;
    endEvidence: 'sensory' | 'analysis' | 'both' | null;
    endAnalysisId: string | null;
  },
): Promise<void> {
  const phase = input.kind.startsWith('alcoholic') ? 'alcoholic_fermentation' : 'malolactic_fermentation';
  const opening = input.kind === 'alcoholic' || input.kind === 'malolactic';
  if (opening) {
    const open = await tx.read(sql`
      SELECT id FROM cellar.lot_phase
      WHERE lot_id = CAST(${input.lotId} AS UUID) AND phase = ${phase} AND status = 'in_progress'
    `);
    if (open.length > 0) return;
    const id = newId();
    const inoculation = input.inoculation ?? 'spontaneous';
    tx.write(sql`
      INSERT INTO cellar.lot_phase (
        id, lot_id, vessel_id, phase, status, started_at, inoculation, inoculum_product_id,
        observations, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.lotId} AS UUID),
        CAST(${input.vesselId} AS UUID),
        ${phase},
        'in_progress',
        CAST(${input.at} AS TIMESTAMPTZ),
        ${inoculation},
        CAST(${input.inoculumProductId} AS UUID),
        ${input.observations},
        ${input.actorId}
      )
    `);
    tx.audit({ table: 'cellar.lot_phase', rowId: id, action: 'INSERT', before: null, after: { phase, status: 'in_progress' } });
    return;
  }
  const evidence = input.kind === 'malolactic_done' ? (input.endEvidence ?? 'sensory') : null;
  const open = await tx.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id FROM cellar.lot_phase
    WHERE lot_id = CAST(${input.lotId} AS UUID) AND phase = ${phase} AND status = 'in_progress'
  `);
  if (open[0]) {
    tx.write(sql`
      UPDATE cellar.lot_phase
      SET status = 'completed',
          ended_at = CAST(${input.at} AS TIMESTAMPTZ),
          end_evidence = ${evidence},
          end_analysis_id = CAST(${input.endAnalysisId} AS UUID),
          observations = coalesce(${input.observations}, observations)
      WHERE id = CAST(${open[0].id} AS UUID)
    `);
    tx.audit({
      table: 'cellar.lot_phase',
      rowId: open[0].id,
      action: 'UPDATE',
      before: { status: 'in_progress' },
      after: { status: 'completed' },
    });
    return;
  }
  const id = newId();
  tx.write(sql`
    INSERT INTO cellar.lot_phase (
      id, lot_id, vessel_id, phase, status, ended_at, inoculation, end_evidence, end_analysis_id,
      observations, created_by
    ) VALUES (
      CAST(${id} AS UUID),
      CAST(${input.lotId} AS UUID),
      CAST(${input.vesselId} AS UUID),
      ${phase},
      'completed',
      CAST(${input.at} AS TIMESTAMPTZ),
      ${input.kind === 'alcoholic_done' ? (input.inoculation ?? 'spontaneous') : input.inoculation},
      ${evidence},
      CAST(${input.endAnalysisId} AS UUID),
      ${input.observations},
      ${input.actorId}
    )
  `);
  tx.audit({ table: 'cellar.lot_phase', rowId: id, action: 'INSERT', before: null, after: { phase, status: 'completed' } });
}

export async function loadLotPhaseName(tx: Tx, lotId: string): Promise<'alcoholic' | 'alcoholic_done' | 'malolactic' | 'malolactic_done' | null> {
  const rows = await tx.read<{ phase: string; status: string }>(sql`
    SELECT phase, status FROM cellar.lot_phase
    WHERE lot_id = CAST(${lotId} AS UUID)
      AND phase IN ('alcoholic_fermentation','malolactic_fermentation')
      AND status IN ('in_progress','completed')
    ORDER BY coalesce(started_at, created_at) DESC
  `);
  const malolactic = rows.find((row) => row.phase === 'malolactic_fermentation' && row.status === 'in_progress');
  if (malolactic) return 'malolactic';
  const alcoholic = rows.find((row) => row.phase === 'alcoholic_fermentation' && row.status === 'in_progress');
  if (alcoholic) return 'alcoholic';
  if (rows.some((row) => row.phase === 'malolactic_fermentation' && row.status === 'completed')) return 'malolactic_done';
  if (rows.some((row) => row.phase === 'alcoholic_fermentation' && row.status === 'completed')) return 'alcoholic_done';
  return null;
}

async function phaseById(writer: Writer, id: string): Promise<Record<string, unknown>> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, lot_id::VARCHAR AS lot_id, vessel_id::VARCHAR AS vessel_id,
           phase, status, started_at, ended_at, inoculation,
           inoculum_product_id::VARCHAR AS inoculum_product_id,
           target_temp_c::VARCHAR AS target_temp_c, aging_method, end_evidence,
           end_analysis_id::VARCHAR AS end_analysis_id, observations, created_by, created_at
    FROM cellar.lot_phase WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

async function latestAbv(writer: Writer, lotId: string): Promise<string | null> {
  const rows = await writer.read<{ value: string }>(sql`
    SELECT r.value::VARCHAR AS value
    FROM cellar.analysis_result r
    JOIN cellar.analysis a ON a.id = r.analysis_id
    WHERE a.lot_id = CAST(${lotId} AS UUID) AND r.parameter_code = 'abv'
    ORDER BY a.sampled_at DESC
    LIMIT 1
  `);
  return rows[0]?.value ?? null;
}

async function lotByCode(writer: Writer, code: string): Promise<{ id: string }> {
  if (!LOT_CODE.test(code)) throw domainError('WC_NOT_FOUND');
  const rows = await writer.read<{ id: string }>(sql`SELECT id::VARCHAR AS id FROM inventory.lot WHERE code = ${code}`);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  if (rows.length > 1) throw domainError('WC_VALIDATION', { code: 'Hay varios lotes con este código' });
  return row;
}

async function assertId(tx: Tx, table: string, id: string, field: string, message: string): Promise<void> {
  const rows = await tx.read(`SELECT id FROM ${table} WHERE id = CAST('${id}' AS UUID)`);
  if (rows.length === 0) invalid({ [field]: message });
}

function onePhase(value: unknown): (typeof PHASES)[number] {
  if (typeof value !== 'string' || !(PHASES as readonly string[]).includes(value)) {
    invalid({ phase: 'La fase no es válida' });
  }
  return value as (typeof PHASES)[number];
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) invalid({ [field]: 'Debe ser un UUID' });
  return value.toLowerCase();
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, max);
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid({ [field]: 'El valor no es válido' });
  return value as T;
}

function optionalTemp(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') invalid({ [field]: 'Debe ser un decimal' });
  try {
    const parsed = money.fromString(text.trim());
    if (parsed.decimalPlaces() > 1) invalid({ [field]: 'Máximo un decimal' });
    return parsed.toFixed(1);
  } catch {
    invalid({ [field]: 'Debe ser un decimal' });
  }
}
