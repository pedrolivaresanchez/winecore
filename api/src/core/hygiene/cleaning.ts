import type { Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate } from '../time';
import {
  actorFor,
  auditInsert,
  invalid,
  optionalUuid,
  readJson,
  requireBool,
  requireText,
  requireUuid,
} from '../cellar/service/http';
import { DOSE_UNITS, type DoseUnit } from './constants';
import { assertDose } from './dose';
import {
  requireConsumable,
  requireEquipment,
  requireLocation,
  requireOperation,
  requireProcedure,
  requireVessel,
} from './lookups';
import { contactMinutes, decimalOut, noteOf, parseDecimal3, positiveUnits } from './parse';
import { insertPlannedUse, type ConsumptionLine } from './stock';

function oneOfDose(value: unknown, field: string): DoseUnit {
  if (typeof value !== 'string' || !(DOSE_UNITS as readonly string[]).includes(value)) {
    invalid({ [field]: `Debe ser uno de: ${DOSE_UNITS.join(', ')}` });
  }
  return value as DoseUnit;
}

interface UseInput {
  product_id: string;
  quantity: number;
  location_id: string;
}

export async function createCleaningLog(writer: Writer, request: Request) {
  const body = await readJson(request);
  const operationId = requireUuid(body.operation_id, 'operation_id');
  const procedureId = requireUuid(body.procedure_id, 'procedure_id');
  const actualDose = parseDecimal3(body.actual_dose, 'actual_dose');
  const actualUnit = oneOfDose(body.actual_dose_unit, 'actual_dose_unit');
  const contact = contactMinutes(body.actual_contact_time_min, 'actual_contact_time_min');
  const rinsed = requireBool(body.rinsed, 'rinsed');
  const operator = requireText(body.operator, 'operator', 120);
  const vesselId = optionalUuid(body.vessel_id, 'vessel_id');
  const equipmentId = optionalUuid(body.equipment_id, 'equipment_id');
  const notes = noteOf(body.notes, 'notes');
  const uses = parseUses(body.consumptions);
  if (body.occurred_on !== undefined && body.occurred_on !== null) {
    requireText(body.occurred_on, 'occurred_on', 10);
  }
  const actor = actorFor(request, 'registro de limpieza');
  const id = newId();
  let occurredOn = '';
  await writer.withWrite(actor, async (tx) => {
    const operation = await requireOperation(tx, operationId);
    if (operation.op_type !== 'cleaning') invalid({ operation_id: 'La operación no es una limpieza' });
    if (operation.status !== 'draft') {
      throw domainError('WC031', { operation_id: 'La operación no está en borrador' }, 'Solo se anota la higiene de un borrador');
    }
    occurredOn = businessDate(new Date(operation.occurred_at));
    if (typeof body.occurred_on === 'string' && body.occurred_on !== occurredOn) {
      invalid({ occurred_on: 'La fecha tiene que ser la de la operación' });
    }
    const procedure = await requireProcedure(tx, procedureId, 'procedure_id');
    if (!procedure.is_active) invalid({ procedure_id: 'El procedimiento no está activo' });
    assertDose({
      actual: actualDose,
      unit: actualUnit,
      min: procedure.dose_min,
      max: procedure.dose_max,
      procedureUnit: procedure.dose_unit,
      contactMinutes: contact,
      minContactMinutes: procedure.contact_time_min,
      rinseRequired: procedure.rinse_required,
      rinsed,
    });
    const vessel = vesselId === null ? null : await requireVessel(tx, vesselId, 'vessel_id');
    const equipment = equipmentId === null ? null : await requireEquipment(tx, equipmentId, 'equipment_id', true);
    if (operation.cleaning_vessel_id && vesselId && operation.cleaning_vessel_id !== vesselId) {
      invalid({ vessel_id: 'No es el recipiente de la operación' });
    }
    const boundVessel = vesselId ?? operation.cleaning_vessel_id;
    if (!boundVessel && !equipment) {
      invalid({ vessel_id: 'Hace falta un recipiente o un equipo' });
    }
    const targets: { field: string; kind: string }[] = [];
    if (vessel) targets.push({ field: 'vessel_id', kind: vessel.kind });
    else if (boundVessel && !vesselId) {
      const fromOperation = await requireVessel(tx, boundVessel, 'vessel_id');
      targets.push({ field: 'vessel_id', kind: fromOperation.kind });
    }
    if (equipment) targets.push({ field: 'equipment_id', kind: equipment.kind });
    assertScope(procedure.applicable_classes, targets);
    const duplicate = await tx.read(sql`
      SELECT id FROM hygiene.cleaning_log WHERE operation_id = CAST(${operationId} AS UUID)
    `);
    if (duplicate.length > 0) invalid({ operation_id: 'Ya hay un registro de higiene para esta operación' });
    const storedVessel = vesselId ?? operation.cleaning_vessel_id;
    auditInsert(tx, 'hygiene.cleaning_log', id, {
      id,
      operation_id: operationId,
      procedure_id: procedureId,
      actual_dose: actualDose,
      actual_dose_unit: actualUnit,
      actual_contact_time_min: contact,
      rinsed,
      operator,
    }, sql`
      INSERT INTO hygiene.cleaning_log (
        id, operation_id, procedure_id, actual_dose, actual_dose_unit, actual_contact_time_min,
        rinsed, operator, vessel_id, equipment_id, occurred_on, notes, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${operationId} AS UUID),
        CAST(${procedureId} AS UUID),
        CAST(${actualDose} AS DECIMAL(12,3)),
        ${actualUnit},
        ${contact},
        ${rinsed},
        ${operator},
        CAST(${storedVessel} AS UUID),
        CAST(${equipmentId} AS UUID),
        CAST(${occurredOn} AS DATE),
        ${notes},
        ${actor.id}
      )
    `);
    await planUses(tx, uses, {
      cleaningLogId: id,
      operationId,
      ownerEntityId: operation.legal_entity_id,
      actorId: actor.id,
    });
  });
  return readCleaningLog(writer, id);
}

async function planUses(
  tx: Tx,
  uses: readonly UseInput[],
  link: { cleaningLogId: string; operationId: string; ownerEntityId: string; actorId: string },
): Promise<void> {
  for (const use of uses) {
    await requireLocation(tx, use.location_id, 'consumptions.location_id');
    const consumable = await requireConsumable(tx, use.product_id, 'consumptions.product_id');
    const line: ConsumptionLine = {
      id: newId(),
      productId: use.product_id,
      locationId: use.location_id,
      ownerEntityId: link.ownerEntityId,
      quantity: use.quantity,
      purpose: consumable.consumable_kind,
      filtrationId: null,
      cleaningLogId: link.cleaningLogId,
      operationId: link.operationId,
    };
    await insertPlannedUse(tx, line, link.actorId);
  }
}

function assertScope(classes: readonly string[], targets: readonly { field: string; kind: string }[]): void {
  const fields: Record<string, string> = {};
  for (const target of targets) {
    if (!classes.includes(target.kind)) fields[target.field] = 'El procedimiento no aplica a esta clase';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_HYGIENE_SCOPE', fields);
}

function parseUses(value: unknown): UseInput[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid({ consumptions: 'Tiene que ser una lista' });
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      invalid({ [`consumptions[${index}]`]: 'La línea no es válida' });
    }
    const line = item as Record<string, unknown>;
    return {
      product_id: requireUuid(line.product_id, `consumptions[${index}].product_id`),
      quantity: positiveUnits(line.quantity, `consumptions[${index}].quantity`),
      location_id: requireUuid(line.location_id, `consumptions[${index}].location_id`),
    };
  });
}

export async function readCleaningLog(writer: Writer, id: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT l.id::VARCHAR AS id, l.operation_id::VARCHAR AS operation_id, l.procedure_id::VARCHAR AS procedure_id,
           l.actual_dose::VARCHAR AS actual_dose, l.actual_dose_unit, l.actual_contact_time_min, l.rinsed,
           l.operator, l.vessel_id::VARCHAR AS vessel_id, l.equipment_id::VARCHAR AS equipment_id,
           l.occurred_on::VARCHAR AS occurred_on, l.notes, l.created_by, l.created_at,
           p.code AS procedure_code, p.name AS procedure_name, p.purpose, p.effluent_destination, p.effluent_note
    FROM hygiene.cleaning_log l
    JOIN hygiene.cleaning_procedure p ON p.id = l.procedure_id
    WHERE l.id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: String(row.id).toLowerCase(),
    operation_id: String(row.operation_id).toLowerCase(),
    procedure_id: String(row.procedure_id).toLowerCase(),
    procedure_code: String(row.procedure_code),
    procedure_name: String(row.procedure_name),
    purpose: String(row.purpose),
    actual_dose: decimalOut(row.actual_dose),
    actual_dose_unit: String(row.actual_dose_unit),
    actual_contact_time_min: Number(row.actual_contact_time_min),
    rinsed: row.rinsed === true,
    operator: String(row.operator),
    vessel_id: row.vessel_id == null ? null : String(row.vessel_id).toLowerCase(),
    equipment_id: row.equipment_id == null ? null : String(row.equipment_id).toLowerCase(),
    occurred_on: String(row.occurred_on).slice(0, 10),
    notes: row.notes == null ? null : String(row.notes),
    effluent_destination: String(row.effluent_destination),
    effluent_note: String(row.effluent_note),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
  };
}
