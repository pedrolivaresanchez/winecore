import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { money } from '../money';
import { newId } from '../ids';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  invalid,
  oneOf,
  optionalUuid,
  readJson,
  requireBool,
  requireCode,
  requireText,
  requireUuid,
} from '../cellar/service/http';
import {
  DOSE_UNITS,
  EFFLUENT_PENDING,
  PROCEDURE_PURPOSES,
  type DoseUnit,
  type ProcedurePurpose,
} from './constants';
import { loadProcedure, requireAnyProduct, requireProcedure, type ProcedureRow } from './lookups';
import { contactMinutes, noteOf, parseClasses, parseDecimal3 } from './parse';

interface ProcedureInput {
  code: string;
  name: string;
  purpose: ProcedurePurpose;
  product_name: string;
  product_id: string | null;
  active_substance: string;
  dose_min: string;
  dose_max: string;
  dose_unit: DoseUnit;
  concentration: string | null;
  contact_time_min: number;
  rinse_required: boolean;
  applicable_classes: string[];
  effluent_destination: string;
  effluent_note: string;
  is_active: boolean;
}

export async function listProcedures(writer: Writer, request: Request) {
  const active = new URL(request.url).searchParams.get('active');
  const where = active === 'true' ? 'WHERE is_active' : active === 'false' ? 'WHERE NOT is_active' : '';
  const rows = await writer.read<{ id: string }>(`
    SELECT id::VARCHAR AS id FROM hygiene.cleaning_procedure ${where} ORDER BY code
  `);
  const items: ProcedureRow[] = [];
  for (const row of rows) {
    const procedure = await requireProcedure(writer, row.id, 'id');
    items.push(procedure);
  }
  return { items };
}

export async function getProcedure(writer: Writer, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw domainError('WC_NOT_FOUND');
  const row = await loadProcedure(writer, id);
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

export async function createProcedure(writer: Writer, request: Request) {
  const input = parseProcedure(await readJson(request), null);
  const actor = actorFor(request, 'alta de procedimiento de higiene');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    if (input.product_id) await requireAnyProduct(tx, input.product_id, 'product_id');
    const taken = await tx.read(sql`SELECT id FROM hygiene.cleaning_procedure WHERE code = ${input.code}`);
    if (taken.length > 0) invalid({ code: 'El código ya existe' });
    auditInsert(tx, 'hygiene.cleaning_procedure', id, { id, ...input }, insertSql(id, input, actor.id));
  });
  return requireProcedure(writer, id, 'id');
}

export async function updateProcedure(writer: Writer, request: Request, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const actor = actorFor(request, 'edición de procedimiento de higiene');
  await writer.withWrite(actor, async (tx) => {
    const current = await requireProcedure(tx, id, 'id');
    if (body.code !== undefined && body.code !== current.code) {
      invalid({ code: 'El código no se modifica' });
    }
    const input = parseProcedure(body, current);
    if (input.product_id) await requireAnyProduct(tx, input.product_id, 'product_id');
    auditUpdate(tx, 'hygiene.cleaning_procedure', id, current, input, sql`
      UPDATE hygiene.cleaning_procedure SET
        name = ${input.name},
        purpose = ${input.purpose},
        product_name = ${input.product_name},
        product_id = CAST(${input.product_id} AS UUID),
        active_substance = ${input.active_substance},
        dose_min = CAST(${input.dose_min} AS DECIMAL(12,3)),
        dose_max = CAST(${input.dose_max} AS DECIMAL(12,3)),
        dose_unit = ${input.dose_unit},
        concentration = ${input.concentration},
        contact_time_min = ${input.contact_time_min},
        rinse_required = ${input.rinse_required},
        applicable_classes = ${sql.json(input.applicable_classes)},
        effluent_destination = ${input.effluent_destination},
        effluent_note = ${input.effluent_note},
        is_active = ${input.is_active},
        updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
  });
  return requireProcedure(writer, id, 'id');
}

function insertSql(id: string, input: ProcedureInput, actorId: string): string {
  return sql`
    INSERT INTO hygiene.cleaning_procedure (
      id, code, name, purpose, product_name, product_id, active_substance, dose_min, dose_max,
      dose_unit, concentration, contact_time_min, rinse_required, applicable_classes,
      effluent_destination, effluent_note, is_active, created_by
    ) VALUES (
      CAST(${id} AS UUID),
      ${input.code},
      ${input.name},
      ${input.purpose},
      ${input.product_name},
      CAST(${input.product_id} AS UUID),
      ${input.active_substance},
      CAST(${input.dose_min} AS DECIMAL(12,3)),
      CAST(${input.dose_max} AS DECIMAL(12,3)),
      ${input.dose_unit},
      ${input.concentration},
      ${input.contact_time_min},
      ${input.rinse_required},
      ${sql.json(input.applicable_classes)},
      ${input.effluent_destination},
      ${input.effluent_note},
      ${input.is_active},
      ${actorId}
    )
  `;
}

function parseProcedure(body: Record<string, unknown>, current: ProcedureRow | null): ProcedureInput {
  const doseMin = body.dose_min === undefined && current ? current.dose_min : parseDecimal3(body.dose_min, 'dose_min');
  const doseMax = body.dose_max === undefined && current ? current.dose_max : parseDecimal3(body.dose_max, 'dose_max');
  if (money.fromString(doseMax).lt(money.fromString(doseMin))) {
    invalid({ dose_max: 'El máximo no puede ser menor que el mínimo' });
  }
  const note = body.effluent_note === undefined
    ? (current?.effluent_note ?? EFFLUENT_PENDING)
    : (noteOf(body.effluent_note, 'effluent_note', 300) ?? EFFLUENT_PENDING);
  return {
    code: current?.code ?? requireCode(body.code, 'code'),
    name: body.name === undefined && current ? current.name : requireText(body.name, 'name', 120),
    purpose: body.purpose === undefined && current
      ? current.purpose
      : oneOf(body.purpose, 'purpose', PROCEDURE_PURPOSES),
    product_name: body.product_name === undefined && current
      ? current.product_name
      : requireText(body.product_name, 'product_name', 120),
    product_id: body.product_id === undefined && current
      ? current.product_id
      : optionalUuid(body.product_id, 'product_id'),
    active_substance: body.active_substance === undefined && current
      ? current.active_substance
      : requireText(body.active_substance, 'active_substance', 120),
    dose_min: doseMin,
    dose_max: doseMax,
    dose_unit: body.dose_unit === undefined && current
      ? current.dose_unit
      : oneOf(body.dose_unit, 'dose_unit', DOSE_UNITS),
    concentration: body.concentration === undefined && current
      ? current.concentration
      : noteOf(body.concentration, 'concentration', 80),
    contact_time_min: body.contact_time_min === undefined && current
      ? current.contact_time_min
      : contactMinutes(body.contact_time_min, 'contact_time_min'),
    rinse_required: body.rinse_required === undefined && current
      ? current.rinse_required
      : requireBool(body.rinse_required, 'rinse_required'),
    applicable_classes: body.applicable_classes === undefined && current
      ? current.applicable_classes
      : parseClasses(body.applicable_classes, 'applicable_classes'),
    effluent_destination: body.effluent_destination === undefined && current
      ? current.effluent_destination
      : requireText(body.effluent_destination, 'effluent_destination', 200),
    effluent_note: note,
    is_active: body.is_active === undefined ? (current?.is_active ?? true) : requireBool(body.is_active, 'is_active'),
  };
}
