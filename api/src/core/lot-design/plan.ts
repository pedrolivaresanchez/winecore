import { isUuid } from '../catalog/fields';
import { auditInsert } from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Actor, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { isMadridCivilDate } from '../time';
import { addCivilDays } from './dates';
import { stepFromRow, type RecipeStep } from './history';
import { requireLot } from './lot-ref';
import { readRecipeVersion } from './recipes';
import { asInt, asText } from './rows';

export interface PlanStepView {
  position: number;
  op_type: string;
  target_date: string;
  offset_days: number;
  duration_hours: number | null;
  temperature_c: number | null;
  additions: RecipeStep['additions'];
  blend_proportions: RecipeStep['blend_proportions'];
  parameters: Record<string, unknown>;
  status: 'suggested';
}

export interface PlanView {
  id: string;
  lot_id: string;
  lot_code: string;
  recipe_id: string;
  recipe_code: string;
  version_id: string;
  version_no: number;
  start_date: string;
  creates_operations: false;
  steps: PlanStepView[];
}

export interface PlanRequest {
  code: string;
  producer_entity_id?: string | null;
  recipe_id: string;
  version_no?: number | null;
  start_date: string;
}

async function readPlan(writer: Writer, planId: string): Promise<PlanView> {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT
      p.id::VARCHAR AS id,
      p.lot_id::VARCHAR AS lot_id,
      l.code AS lot_code,
      p.recipe_id::VARCHAR AS recipe_id,
      r.code AS recipe_code,
      p.version_id::VARCHAR AS version_id,
      v.version_no::VARCHAR AS version_no,
      p.start_date
    FROM cellar.elaboration_plan p
    JOIN inventory.lot l ON l.id = p.lot_id
    JOIN cellar.recipe r ON r.id = p.recipe_id
    JOIN cellar.recipe_version v ON v.id = p.version_id
    WHERE p.id = CAST(${planId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const steps = await writer.read<Record<string, unknown>>(sql`
    SELECT
      position::VARCHAR AS position,
      op_type,
      target_date,
      offset_days::VARCHAR AS offset_days,
      duration_hours::VARCHAR AS duration_hours,
      temperature_c::VARCHAR AS temperature_c,
      additions,
      blend_proportions,
      parameters
    FROM cellar.elaboration_plan_step
    WHERE plan_id = CAST(${planId} AS UUID)
    ORDER BY position
  `);
  return {
    id: String(row.id).toLowerCase(),
    lot_id: String(row.lot_id).toLowerCase(),
    lot_code: String(row.lot_code),
    recipe_id: String(row.recipe_id).toLowerCase(),
    recipe_code: String(row.recipe_code),
    version_id: String(row.version_id).toLowerCase(),
    version_no: asInt(row.version_no) ?? 0,
    start_date: asText(row.start_date)?.slice(0, 10) ?? '',
    creates_operations: false,
    steps: steps.map((step) => {
      const parsed = stepFromRow(step);
      return {
        position: parsed.position,
        op_type: parsed.op_type,
        target_date: asText(step.target_date)?.slice(0, 10) ?? '',
        offset_days: parsed.offset_days,
        duration_hours: parsed.duration_hours,
        temperature_c: parsed.temperature_c,
        additions: parsed.additions,
        blend_proportions: parsed.blend_proportions,
        parameters: parsed.parameters,
        status: 'suggested' as const,
      };
    }),
  };
}

/** Suggests dated steps. It does not create or confirm cellar operations. */
export async function applyRecipe(writer: Writer, actor: Actor, input: PlanRequest): Promise<PlanView> {
  if (!isUuid(input.recipe_id)) throw domainError('WC_VALIDATION', { recipe_id: 'Debe ser un UUID' });
  if (!isMadridCivilDate(input.start_date)) {
    throw domainError('WC_VALIDATION', { start_date: 'Fecha no válida (AAAA-MM-DD)' });
  }
  if (input.version_no != null && (!Number.isSafeInteger(input.version_no) || input.version_no < 1)) {
    throw domainError('WC_VALIDATION', { version_no: 'Versión no válida' });
  }
  let planId = '';
  await writer.withWrite(actor, async (tx) => {
    const lot = await requireLot(tx, input.code, input.producer_entity_id ?? null);
    const version = await readRecipeVersion(tx, input.recipe_id, input.version_no ?? null, null);
    planId = newId();
    auditInsert(tx, 'cellar.elaboration_plan', planId, {
      id: planId,
      lot_id: lot.id,
      recipe_id: version.recipe_id,
      version_id: version.id,
      start_date: input.start_date,
    }, sql`
      INSERT INTO cellar.elaboration_plan (id, lot_id, recipe_id, version_id, start_date, created_by)
      VALUES (
        CAST(${planId} AS UUID),
        CAST(${lot.id} AS UUID),
        CAST(${version.recipe_id} AS UUID),
        CAST(${version.id} AS UUID),
        CAST(${input.start_date} AS DATE),
        ${actor.id}
      )
    `);
    for (const step of version.steps) {
      const id = newId();
      const target = addCivilDays(input.start_date, step.offset_days);
      auditInsert(tx, 'cellar.elaboration_plan_step', id, { ...step, id, target_date: target, status: 'suggested' }, sql`
        INSERT INTO cellar.elaboration_plan_step (
          id, plan_id, position, op_type, target_date, offset_days, duration_hours, temperature_c,
          additions, blend_proportions, parameters, status
        ) VALUES (
          CAST(${id} AS UUID),
          CAST(${planId} AS UUID),
          ${step.position},
          ${step.op_type},
          CAST(${target} AS DATE),
          ${step.offset_days},
          ${step.duration_hours},
          ${step.temperature_c},
          ${sql.json(step.additions)},
          ${sql.json(step.blend_proportions)},
          ${sql.json(step.parameters)},
          'suggested'
        )
      `);
    }
  });
  return readPlan(writer, planId);
}

export async function readLatestPlan(
  writer: Writer,
  code: string,
  producerId: string | null,
): Promise<PlanView> {
  const lot = await requireLot(writer, code, producerId);
  const rows = await writer.read<{ id: string }>(sql`
    SELECT id::VARCHAR AS id
    FROM cellar.elaboration_plan
    WHERE lot_id = CAST(${lot.id} AS UUID)
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const id = rows[0]?.id;
  if (!id) throw domainError('WC_NOT_FOUND');
  return readPlan(writer, id);
}
