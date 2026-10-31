import type { Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import { newId } from '../ids';
import {
  actorFor,
  auditInsert,
  auditUpdate,
  invalid,
  oneOf,
  readJson,
  requireCode,
  requireText,
  requireUuid,
} from '../cellar/service/http';
import { CAPACITY_UNITS, EQUIPMENT_KINDS, EQUIPMENT_ROLES, type EquipmentKind } from './constants';
import { loadEquipment, requireEquipment, requireOperation, type EquipmentRow } from './lookups';
import { noteOf, optionalDay, parseDecimal3, parseInstant } from './parse';

const UUID = /^[0-9a-f-]{36}$/i;

export async function listEquipment(writer: Writer) {
  const rows = await writer.read<{ id: string }>(`
    SELECT id::VARCHAR AS id FROM hygiene.equipment ORDER BY code
  `);
  const items: EquipmentRow[] = [];
  for (const row of rows) {
    const equipment = await loadEquipment(writer, row.id);
    if (equipment) items.push(equipment);
  }
  return { items };
}

export async function getEquipment(writer: Writer, id: string) {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const row = await loadEquipment(writer, id);
  if (!row) throw domainError('WC_NOT_FOUND');
  return row;
}

export async function createEquipment(writer: Writer, request: Request) {
  const input = parseEquipment(await readJson(request), null);
  const actor = actorFor(request, 'alta de equipo');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const taken = await tx.read(sql`SELECT id FROM hygiene.equipment WHERE code = ${input.code}`);
    if (taken.length > 0) invalid({ code: 'El código ya existe' });
    auditInsert(tx, 'hygiene.equipment', id, { id, ...input }, sql`
      INSERT INTO hygiene.equipment (
        id, code, name, kind, capacity, capacity_unit, maintenance_notes, status
      ) VALUES (
        CAST(${id} AS UUID),
        ${input.code},
        ${input.name},
        ${input.kind},
        CAST(${input.capacity} AS DECIMAL(14,3)),
        ${input.capacity_unit},
        ${input.maintenance_notes},
        ${input.status}
      )
    `);
  });
  const created = await loadEquipment(writer, id);
  if (!created) throw domainError('WC_NOT_FOUND');
  return created;
}

export async function updateEquipment(writer: Writer, request: Request, id: string) {
  if (!UUID.test(id)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const actor = actorFor(request, 'edición de equipo');
  await writer.withWrite(actor, async (tx) => {
    const current = await loadEquipment(tx, id);
    if (!current) throw domainError('WC_NOT_FOUND');
    if (body.code !== undefined && body.code !== current.code) invalid({ code: 'El código no se modifica' });
    if (body.kind !== undefined && body.kind !== current.kind) invalid({ kind: 'El tipo no se modifica' });
    const input = parseEquipment(body, current);
    auditUpdate(tx, 'hygiene.equipment', id, current, input, sql`
      UPDATE hygiene.equipment SET
        name = ${input.name},
        capacity = CAST(${input.capacity} AS DECIMAL(14,3)),
        capacity_unit = ${input.capacity_unit},
        maintenance_notes = ${input.maintenance_notes},
        status = ${input.status},
        updated_at = now()
      WHERE id = CAST(${id} AS UUID)
    `);
  });
  const updated = await loadEquipment(writer, id);
  if (!updated) throw domainError('WC_NOT_FOUND');
  return updated;
}

export async function addMaintenance(writer: Writer, request: Request, equipmentId: string) {
  if (!UUID.test(equipmentId)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const performedAt = parseInstant(body.performed_at, 'performed_at');
  const notes = requireText(body.notes, 'notes', 500);
  const operator = requireText(body.operator, 'operator', 120);
  const nextDue = optionalDay(body.next_due_on, 'next_due_on');
  const actor = actorFor(request, 'mantenimiento de equipo');
  const id = newId();
  await writer.withWrite(actor, async (tx) => {
    const equipment = await loadEquipment(tx, equipmentId);
    if (!equipment) throw domainError('WC_NOT_FOUND');
    if (equipment.status === 'retired') invalid({ equipment_id: 'El equipo está retirado' });
    auditInsert(tx, 'hygiene.equipment_maintenance', id, {
      id,
      equipment_id: equipmentId,
      performed_at: performedAt,
      notes,
      operator,
      next_due_on: nextDue,
    }, sql`
      INSERT INTO hygiene.equipment_maintenance (
        id, equipment_id, performed_at, notes, operator, next_due_on, created_by
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${equipmentId} AS UUID),
        CAST(${performedAt} AS TIMESTAMPTZ),
        ${notes},
        ${operator},
        CAST(${nextDue} AS DATE),
        ${actor.id}
      )
    `);
  });
  return { id, equipment_id: equipmentId.toLowerCase(), performed_at: performedAt, notes, operator, next_due_on: nextDue };
}

export async function linkOperationEquipment(writer: Writer, request: Request, operationId: string) {
  if (!UUID.test(operationId)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const equipmentId = requireUuid(body.equipment_id, 'equipment_id');
  const role = oneOf(body.role, 'role', EQUIPMENT_ROLES);
  const actor = actorFor(request, 'equipo de la operación');
  await writer.withWrite(actor, async (tx) => {
    await requireOperation(tx, operationId);
    await requireEquipment(tx, equipmentId, 'equipment_id', true);
    const existing = await tx.read(sql`
      SELECT operation_id FROM hygiene.operation_equipment
      WHERE operation_id = CAST(${operationId} AS UUID) AND equipment_id = CAST(${equipmentId} AS UUID)
    `);
    if (existing.length > 0) invalid({ equipment_id: 'El equipo ya está vinculado a la operación' });
    auditInsert(tx, 'hygiene.operation_equipment', `${operationId}:${equipmentId}`, {
      operation_id: operationId,
      equipment_id: equipmentId,
      role,
    }, sql`
      INSERT INTO hygiene.operation_equipment (operation_id, equipment_id, role)
      VALUES (CAST(${operationId} AS UUID), CAST(${equipmentId} AS UUID), ${role})
    `);
  });
  return { operation_id: operationId.toLowerCase(), equipment_id: equipmentId, role };
}

interface EquipmentInput {
  code: string;
  name: string;
  kind: EquipmentKind;
  capacity: string | null;
  capacity_unit: string | null;
  maintenance_notes: string | null;
  status: string;
}

function parseEquipment(body: Record<string, unknown>, current: EquipmentRow | null): EquipmentInput {
  const capacity = body.capacity === undefined && current
    ? current.capacity
    : (body.capacity === null ? null : (body.capacity === undefined ? null : parseDecimal3(body.capacity, 'capacity')));
  const unit = body.capacity_unit === undefined && current
    ? current.capacity_unit
    : (body.capacity_unit === null || body.capacity_unit === undefined
      ? null
      : oneOf(body.capacity_unit, 'capacity_unit', CAPACITY_UNITS));
  if ((capacity === null) !== (unit === null)) {
    invalid({ capacity: 'La capacidad y su unidad van juntas' });
  }
  const status = body.status === undefined
    ? (current?.status ?? 'in_service')
    : oneOf(body.status, 'status', ['in_service', 'out_of_service', 'retired'] as const);
  return {
    code: current?.code ?? requireCode(body.code, 'code'),
    name: body.name === undefined && current ? current.name : requireText(body.name, 'name', 120),
    kind: current?.kind ?? oneOf(body.kind, 'kind', EQUIPMENT_KINDS),
    capacity,
    capacity_unit: unit,
    maintenance_notes: body.maintenance_notes === undefined && current
      ? current.maintenance_notes
      : noteOf(body.maintenance_notes, 'maintenance_notes', 500),
    status,
  };
}
