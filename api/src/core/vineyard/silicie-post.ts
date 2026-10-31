import type { Tx } from '../db/writer';
import { sql } from '../db/sql';
import { DomainError, domainError } from '../errors';
import { newId } from '../ids';
import { businessDate } from '../time';
import { entriesFor } from '../regulatory/silicie/entries';
import { ledgerFromSituation } from '../regulatory/silicie/ledgers';
import type { SilicieCounterparty, SilicieLedger } from '../regulatory/silicie/types';
import { idOf, integer, objectOf, text } from './rows';

export interface GrapeEntryView {
  id: string | null;
  entry_kind: string;
  mass_g: number;
  unidad: string;
  regimen_fiscal: string;
  tipo_justificante: string;
  referencia: string;
  movement_date: string;
  numero_justificante: string | null;
  numero_referencia_interno: string | null;
  status: string | null;
}

export async function planGrapeEntry(
  tx: Tx,
  input: {
    operationId: string;
    warehouseId: string;
    warehouseName: string;
    fiscalDate: string;
    massG: number;
    justificationRef: string;
    counterparty: (SilicieCounterparty & { id: string }) | null;
    persist: boolean;
  },
): Promise<GrapeEntryView> {
  const year = Number(input.fiscalDate.slice(0, 4));
  const exercises = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, status
    FROM regulatory.silicie_exercise
    WHERE tax_warehouse_id = CAST(${input.warehouseId} AS UUID) AND year = ${year}
  `);
  const exercise = exercises[0];
  if (!exercise || text(exercise.status) !== 'open') {
    throw domainError('WC_VALIDATION', {
      fiscal_date: 'No hay un ejercicio SILICIE abierto para este año en el establecimiento',
    });
  }
  const ledger = await uvaLedger(tx, input.warehouseId, input.persist);
  const seqRows = await tx.read<Record<string, unknown>>(sql`
    SELECT COALESCE(max(local_seq), 0)::INTEGER AS seq
    FROM regulatory.silicie_entry
    WHERE exercise_id = CAST(${text(exercise.id)} AS UUID)
  `);
  const nextLocalSeq = integer(seqRows[0]?.seq ?? 0) + 1;
  const drafts = entriesFor([], {
    exerciseId: idOf(exercise.id),
    exerciseYear: year,
    taxWarehouseId: input.warehouseId,
    nextLocalSeq,
    ledgers: [ledger],
    aggregation: 'none',
    recordedOn: businessDate(new Date()),
    establishmentName: input.warehouseName,
    facts: [
      {
        kind: 'grape_reception',
        id: input.operationId,
        date: input.fiscalDate,
        massG: input.massG,
        justificationRef: input.justificationRef,
        counterpartyContactId: input.counterparty?.id ?? null,
      },
    ],
    counterparties: input.counterparty ? { [input.counterparty.id]: input.counterparty } : {},
  });
  const draft = drafts[0];
  if (!draft || drafts.length !== 1 || draft.entryKind !== 'A02') {
    throw new DomainError('WC_VALIDATION', 422, 'La entrada de uva no ha producido el asiento A02');
  }
  const entryId = input.persist ? newId() : null;
  if (input.persist && entryId !== null) {
    tx.write(sql`
      INSERT INTO regulatory.silicie_entry (
        id, exercise_id, tax_warehouse_id, local_seq, movement_date, entry_kind, fields, status
      ) VALUES (
        CAST(${entryId} AS UUID),
        CAST(${text(exercise.id)} AS UUID),
        CAST(${input.warehouseId} AS UUID),
        ${draft.localSeq},
        CAST(${draft.movementDate} AS DATE),
        ${draft.entryKind},
        ${sql.json(draft.fields)},
        'pending'
      )
    `);
    tx.audit({
      table: 'regulatory.silicie_entry',
      rowId: entryId,
      action: 'INSERT',
      before: null,
      after: { id: entryId, entry_kind: draft.entryKind, local_seq: draft.localSeq, operation_id: input.operationId },
    });
  }
  return {
    id: entryId,
    entry_kind: draft.entryKind,
    mass_g: draft.fields.cantidad,
    unidad: draft.fields.unidadMedida,
    regimen_fiscal: draft.fields.regimenFiscal,
    tipo_justificante: draft.fields.tipoJustificante,
    referencia: draft.fields.referenciaProducto,
    movement_date: draft.movementDate,
    numero_justificante: input.persist ? draft.fields.numeroJustificante : null,
    numero_referencia_interno: input.persist ? draft.fields.numeroReferenciaInterno : null,
    status: input.persist ? 'pending' : null,
  };
}

export async function annulPendingEntry(tx: Tx, entryId: string): Promise<void> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, status FROM regulatory.silicie_entry WHERE id = CAST(${entryId} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_VALIDATION', { silicie_entry_id: 'No está el asiento de la entrada de uva' });
  if (text(row.status) !== 'pending') {
    throw domainError('WC_VALIDATION', {
      silicie_entry_id: 'El asiento ya no está pendiente; la corrección oficial es una anulación',
    });
  }
  tx.write(sql`
    UPDATE regulatory.silicie_entry SET status = 'annulled'
    WHERE id = CAST(${entryId} AS UUID) AND status = 'pending'
  `);
  tx.audit({
    table: 'regulatory.silicie_entry',
    rowId: entryId,
    action: 'UPDATE',
    before: { status: 'pending' },
    after: { status: 'annulled' },
  });
}

export async function readEntry(reader: { read<T>(statement: string): Promise<T[]> }, entryId: string): Promise<GrapeEntryView | null> {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, entry_kind, status, movement_date::VARCHAR AS movement_date, fields
    FROM regulatory.silicie_entry
    WHERE id = CAST(${entryId} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  const fields = objectOf(row.fields) ?? {};
  return {
    id: idOf(row.id),
    entry_kind: text(row.entry_kind),
    mass_g: integer(fields.cantidad ?? 0),
    unidad: text(fields.unidadMedida ?? ''),
    regimen_fiscal: text(fields.regimenFiscal ?? ''),
    tipo_justificante: text(fields.tipoJustificante ?? ''),
    referencia: text(fields.referenciaProducto ?? ''),
    movement_date: text(row.movement_date).slice(0, 10),
    numero_justificante: fields.numeroJustificante == null ? null : text(fields.numeroJustificante),
    numero_referencia_interno: fields.numeroReferenciaInterno == null ? null : text(fields.numeroReferenciaInterno),
    status: text(row.status),
  };
}

async function uvaLedger(tx: Tx, warehouseId: string, persist: boolean): Promise<SilicieLedger> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, tax_warehouse_id::VARCHAR AS tax_warehouse_id, reference, description,
           product_class, epigrafe, epigrafe_code, nc_code, product_key, container_type,
           container_capacity_l::VARCHAR AS container_capacity_l, is_active, validated_by, created_at
    FROM regulatory.silicie_ledger
    WHERE tax_warehouse_id = CAST(${warehouseId} AS UUID) AND reference = 'UVA'
  `);
  const row = rows[0];
  if (row) {
    if (text(row.product_class) !== 'raw_grape' || text(row.nc_code) !== '0806' || text(row.product_key ?? '') !== 'V01') {
      throw domainError('WC_VALIDATION', { vessel_id: 'El mayor UVA del establecimiento no es el de uva de vinificación' });
    }
    return {
      id: idOf(row.id),
      taxWarehouseId: idOf(row.tax_warehouse_id),
      reference: text(row.reference),
      description: text(row.description),
      productClass: 'raw_grape',
      epigrafe: null,
      epigrafeCode: null,
      ncCode: text(row.nc_code),
      productKey: text(row.product_key ?? 'V01'),
      containerType: null,
      containerCapacityMl: null,
      isActive: row.is_active !== false,
      validatedBy: row.validated_by == null ? null : text(row.validated_by),
      createdAt: text(row.created_at),
    };
  }
  const ledger = ledgerFromSituation({
    id: newId(),
    taxWarehouseId: warehouseId,
    createdAt: new Date().toISOString(),
    situation: { productClass: 'raw_grape' },
  });
  if (persist) {
    tx.write(sql`
      INSERT INTO regulatory.silicie_ledger (
        id, tax_warehouse_id, reference, description, product_class, nc_code, product_key, is_active
      ) VALUES (
        CAST(${ledger.id} AS UUID), CAST(${warehouseId} AS UUID), ${ledger.reference}, ${ledger.description},
        ${ledger.productClass}, ${ledger.ncCode}, ${ledger.productKey}, TRUE
      )
    `);
    tx.audit({
      table: 'regulatory.silicie_ledger',
      rowId: ledger.id,
      action: 'INSERT',
      before: null,
      after: { id: ledger.id, reference: ledger.reference },
    });
  }
  return ledger;
}
