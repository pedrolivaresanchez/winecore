import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import {
  actorFor,
  auditInsert,
  invalid,
  oneOf,
  optionalUuid,
  readJson,
  requireText,
  requireUuid,
} from '../cellar/service/http';
import { PLATE_GRADE_LABEL, PLATE_GRADES, type PlateGrade } from './constants';
import { loadOperation, requireContact, requireConsumable, requireEntity, requireEquipment, requireLocation } from './lookups';
import { noteOf, parseInstant, positiveUnits } from './parse';
import { balanceUnits, consumeNow, type ConsumptionLine } from './stock';

interface FiltrationInput {
  occurredAt: string;
  plateGrade: PlateGrade;
  plateFormat: string;
  supplierContactId: string;
  plateCount: number;
  equipmentId: string | null;
  operator: string;
  locationId: string;
  ownerEntityId: string;
  notes: string | null;
  operationId: string | null;
  lines: { productId: string; quantity: number }[];
}

export async function createFiltration(writer: Writer, request: Request) {
  const input = parseFiltration(await readJson(request));
  const actor = actorFor(request, 'filtración y consumo de placas');
  const id = newId();
  const useLines: ConsumptionLine[] = [];
  await writer.withWrite(actor, async (tx) => {
    if (input.operationId) {
      const operation = await loadOperation(tx, input.operationId);
      if (!operation) invalid({ operation_id: 'La operación no existe' });
      if (operation.op_type !== 'filtration') invalid({ operation_id: 'La operación no es una filtración' });
    }
    const supplier = await requireContact(tx, input.supplierContactId, 'supplier_contact_id');
    await requireLocation(tx, input.locationId, 'location_id');
    await requireEntity(tx, input.ownerEntityId, 'owner_entity_id');
    if (input.equipmentId) await requireEquipment(tx, input.equipmentId, 'equipment_id', true);
    let plates = 0;
    for (const line of input.lines) {
      const consumable = await requireConsumable(tx, line.productId, 'consumptions.product_id');
      if (consumable.consumable_kind === 'filter_plate') plates += line.quantity;
      useLines.push({
        id: newId(),
        productId: line.productId,
        locationId: input.locationId,
        ownerEntityId: input.ownerEntityId,
        quantity: line.quantity,
        purpose: consumable.consumable_kind,
        filtrationId: id,
        cleaningLogId: null,
        operationId: input.operationId,
      });
    }
    if (plates !== input.plateCount) {
      invalid({ plate_count: 'El número de placas tiene que coincidir con el consumo de placas' });
    }
    auditInsert(tx, 'hygiene.filtration', id, {
      id,
      plate_grade: input.plateGrade,
      plate_count: input.plateCount,
      supplier: supplier.legal_name,
    }, sql`
      INSERT INTO hygiene.filtration (
        id, operation_id, occurred_at, plate_grade, plate_format, supplier_contact_id, plate_count,
        equipment_id, operator, location_id, owner_entity_id, notes, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${input.operationId} AS UUID),
        CAST(${input.occurredAt} AS TIMESTAMPTZ),
        ${input.plateGrade},
        ${input.plateFormat},
        CAST(${input.supplierContactId} AS UUID),
        ${input.plateCount},
        CAST(${input.equipmentId} AS UUID),
        ${input.operator},
        CAST(${input.locationId} AS UUID),
        CAST(${input.ownerEntityId} AS UUID),
        ${input.notes},
        ${actor.id}
      )
    `);
    await consumeNow(tx, useLines, input.occurredAt, actor.id);
  });
  const view = await readFiltration(writer, id);
  const balances = [];
  for (const line of input.lines) {
    balances.push({
      product_id: line.productId,
      balance_units: await balanceUnits(writer, line.productId, input.locationId, input.ownerEntityId),
    });
  }
  return { ...view, balances };
}

export async function readFiltration(writer: Writer, id: string) {
  const rows = await writer.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, occurred_at, plate_grade, plate_format,
           supplier_contact_id::VARCHAR AS supplier_contact_id, plate_count, equipment_id::VARCHAR AS equipment_id,
           operator, location_id::VARCHAR AS location_id, owner_entity_id::VARCHAR AS owner_entity_id, notes
    FROM hygiene.filtration
    WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const grade = String(row.plate_grade) as PlateGrade;
  return {
    id: String(row.id).toLowerCase(),
    operation_id: row.operation_id == null ? null : String(row.operation_id).toLowerCase(),
    occurred_at: String(row.occurred_at),
    plate_grade: grade,
    plate_grade_label: PLATE_GRADE_LABEL[grade],
    plate_format: String(row.plate_format),
    supplier_contact_id: String(row.supplier_contact_id).toLowerCase(),
    plate_count: Number(row.plate_count),
    equipment_id: row.equipment_id == null ? null : String(row.equipment_id).toLowerCase(),
    operator: String(row.operator),
    location_id: String(row.location_id).toLowerCase(),
    owner_entity_id: String(row.owner_entity_id).toLowerCase(),
    notes: row.notes == null ? null : String(row.notes),
  };
}

function parseFiltration(body: Record<string, unknown>): FiltrationInput {
  if (!Array.isArray(body.consumptions) || body.consumptions.length === 0) {
    invalid({ consumptions: 'La filtración consume placas' });
  }
  const lines = body.consumptions.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      invalid({ [`consumptions[${index}]`]: 'La línea no es válida' });
    }
    const line = item as Record<string, unknown>;
    return {
      productId: requireUuid(line.product_id, `consumptions[${index}].product_id`),
      quantity: positiveUnits(line.quantity, `consumptions[${index}].quantity`),
    };
  });
  return {
    occurredAt: parseInstant(body.occurred_at, 'occurred_at'),
    plateGrade: oneOf(body.plate_grade, 'plate_grade', PLATE_GRADES),
    plateFormat: requireText(body.plate_format, 'plate_format', 80),
    supplierContactId: requireUuid(body.supplier_contact_id, 'supplier_contact_id'),
    plateCount: positiveUnits(body.plate_count, 'plate_count'),
    equipmentId: optionalUuid(body.equipment_id, 'equipment_id'),
    operator: requireText(body.operator, 'operator', 120),
    locationId: requireUuid(body.location_id, 'location_id'),
    ownerEntityId: requireUuid(body.owner_entity_id, 'owner_entity_id'),
    notes: noteOf(body.notes, 'notes'),
    operationId: optionalUuid(body.operation_id, 'operation_id'),
    lines,
  };
}
