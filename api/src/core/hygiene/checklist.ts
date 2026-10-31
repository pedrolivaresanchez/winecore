import type { Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { domainError } from '../errors';
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
  requireText,
  requireUuid,
} from '../cellar/service/http';
import { CLOSURE_LABEL, CLOSURE_TYPES, SEAL_LABEL, SEAL_TYPES, type ClosureType, type SealType } from './constants';
import { requireEquipment, requireOperation, requireProcedure } from './lookups';
import { idOf, nonNegativeUnits, noteOf } from './parse';
import { checklistRequired } from './policy';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Gate the bottling confirm can call. When the setting is on, a complete
 * checklist must already exist for the operation. A recorded "no" on bottle
 * disinfection still counts: the gate checks that the control was filled.
 */
export async function assertBottlingChecklist(tx: Tx, operationId: string): Promise<void> {
  const operation = await requireOperation(tx, operationId);
  if (operation.op_type !== 'bottling') return;
  if (!(await checklistRequired(tx))) return;
  const row = await loadCheck(tx, operationId);
  if (!row) {
    throw domainError('WC_HYGIENE_CHECKLIST', { operation_id: 'Falta el control de envasado' });
  }
  const fields: Record<string, string> = {};
  if (row.bottlesDisinfected && !row.procedureId) {
    fields.disinfection_procedure_id = 'Falta el procedimiento de desinfección';
  }
  if (!row.equipmentId) fields.equipment_id = 'Falta el equipo';
  if (!row.closureType) fields.closure_type = 'Falta el cierre';
  if (!row.sealType) fields.seal_type = 'Falta el precinto';
  if (!row.operator) fields.operator = 'Falta el operario';
  if (Object.keys(fields).length > 0) throw domainError('WC_HYGIENE_CHECKLIST', fields);
}

export async function putBottlingCheck(writer: Writer, request: Request, operationId: string) {
  if (!UUID.test(operationId)) throw domainError('WC_NOT_FOUND');
  const body = await readJson(request);
  const input = parseCheck(body);
  const actor = actorFor(request, 'control de envasado');
  await writer.withWrite(actor, async (tx) => {
    const operation = await requireOperation(tx, operationId);
    if (operation.op_type !== 'bottling') invalid({ operation_id: 'La operación no es un envasado' });
    if (operation.status !== 'draft') {
      throw domainError('WC031', { operation_id: 'El envasado ya está confirmado' }, 'El control de un envasado confirmado no se modifica');
    }
    await requireEquipment(tx, input.equipmentId, 'equipment_id', true);
    if (input.bottlesDisinfected) {
      if (!input.procedureId) invalid({ disinfection_procedure_id: 'Falta el procedimiento de desinfección de botellas' });
      const procedure = await requireProcedure(tx, input.procedureId, 'disinfection_procedure_id');
      if (!procedure.is_active) invalid({ disinfection_procedure_id: 'El procedimiento no está activo' });
      if (procedure.purpose === 'cleaning') {
        invalid({ disinfection_procedure_id: 'El procedimiento no es de desinfección' });
      }
    }
    const existing = await loadCheck(tx, operationId);
    if (!existing) {
      const id = newId();
      auditInsert(tx, 'hygiene.bottling_check', id, { id, operation_id: operationId, ...input }, sql`
        INSERT INTO hygiene.bottling_check (
          id, operation_id, bottles_disinfected, disinfection_procedure_id, fill_rejects, closure_rejects,
          label_rejects, equipment_id, closure_type, seal_type, notes, operator, filled_by
        ) VALUES (
          CAST(${id} AS UUID),
          CAST(${operationId} AS UUID),
          ${input.bottlesDisinfected},
          CAST(${input.procedureId} AS UUID),
          ${input.fillRejects},
          ${input.closureRejects},
          ${input.labelRejects},
          CAST(${input.equipmentId} AS UUID),
          ${input.closureType},
          ${input.sealType},
          ${input.notes},
          ${input.operator},
          ${actor.id}
        )
      `);
      return;
    }
    auditUpdate(tx, 'hygiene.bottling_check', existing.id, existing, input, sql`
      UPDATE hygiene.bottling_check SET
        bottles_disinfected = ${input.bottlesDisinfected},
        disinfection_procedure_id = CAST(${input.procedureId} AS UUID),
        fill_rejects = ${input.fillRejects},
        closure_rejects = ${input.closureRejects},
        label_rejects = ${input.labelRejects},
        equipment_id = CAST(${input.equipmentId} AS UUID),
        closure_type = ${input.closureType},
        seal_type = ${input.sealType},
        notes = ${input.notes},
        operator = ${input.operator},
        filled_by = ${actor.id},
        filled_at = now()
      WHERE operation_id = CAST(${operationId} AS UUID)
    `);
  });
  return readBottlingCheck(writer, operationId);
}

export async function getBottlingCheck(writer: Writer, operationId: string) {
  if (!UUID.test(operationId)) throw domainError('WC_NOT_FOUND');
  return readBottlingCheck(writer, operationId);
}

interface CheckInput {
  bottlesDisinfected: boolean;
  procedureId: string | null;
  fillRejects: number;
  closureRejects: number;
  labelRejects: number;
  equipmentId: string;
  closureType: ClosureType;
  sealType: SealType;
  notes: string | null;
  operator: string;
}

interface CheckRow extends CheckInput {
  id: string;
  operation_id: string;
  filled_by: string;
  filled_at: string;
}

function parseCheck(body: Record<string, unknown>): CheckInput {
  const bottlesDisinfected = requireBool(body.bottles_disinfected, 'bottles_disinfected');
  const procedureId = optionalUuid(body.disinfection_procedure_id, 'disinfection_procedure_id');
  if (bottlesDisinfected && !procedureId) {
    invalid({ disinfection_procedure_id: 'Falta el procedimiento de desinfección de botellas' });
  }
  if (!bottlesDisinfected && procedureId) {
    invalid({ disinfection_procedure_id: 'No corresponde si las botellas no se desinfectan' });
  }
  return {
    bottlesDisinfected,
    procedureId,
    fillRejects: nonNegativeUnits(body.fill_rejects, 'fill_rejects'),
    closureRejects: nonNegativeUnits(body.closure_rejects, 'closure_rejects'),
    labelRejects: nonNegativeUnits(body.label_rejects, 'label_rejects'),
    equipmentId: requireUuid(body.equipment_id, 'equipment_id'),
    closureType: oneOf(body.closure_type, 'closure_type', CLOSURE_TYPES),
    sealType: oneOf(body.seal_type, 'seal_type', SEAL_TYPES),
    notes: noteOf(body.notes, 'notes'),
    operator: requireText(body.operator, 'operator', 120),
  };
}

async function loadCheck(reader: { read<T>(statement: string): Promise<T[]> }, operationId: string): Promise<CheckRow | null> {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, operation_id::VARCHAR AS operation_id, bottles_disinfected,
           disinfection_procedure_id::VARCHAR AS disinfection_procedure_id, fill_rejects, closure_rejects,
           label_rejects, equipment_id::VARCHAR AS equipment_id, closure_type, seal_type, notes, operator,
           filled_by, filled_at
    FROM hygiene.bottling_check
    WHERE operation_id = CAST(${operationId} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    operation_id: idOf(row.operation_id),
    bottlesDisinfected: row.bottles_disinfected === true,
    procedureId: row.disinfection_procedure_id == null ? null : idOf(row.disinfection_procedure_id),
    fillRejects: Number(row.fill_rejects),
    closureRejects: Number(row.closure_rejects),
    labelRejects: Number(row.label_rejects),
    equipmentId: idOf(row.equipment_id),
    closureType: String(row.closure_type) as ClosureType,
    sealType: String(row.seal_type) as SealType,
    notes: row.notes == null ? null : String(row.notes),
    operator: String(row.operator),
    filled_by: String(row.filled_by),
    filled_at: String(row.filled_at),
  };
}

async function readBottlingCheck(writer: Writer, operationId: string) {
  const row = await loadCheck(writer, operationId);
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: row.id,
    operation_id: row.operation_id,
    bottles_disinfected: row.bottlesDisinfected,
    disinfection_procedure_id: row.procedureId,
    fill_rejects: row.fillRejects,
    closure_rejects: row.closureRejects,
    label_rejects: row.labelRejects,
    equipment_id: row.equipmentId,
    closure_type: row.closureType,
    closure_label: CLOSURE_LABEL[row.closureType],
    seal_type: row.sealType,
    seal_label: SEAL_LABEL[row.sealType],
    notes: row.notes,
    operator: row.operator,
    filled_by: row.filled_by,
    filled_at: row.filled_at,
  };
}
