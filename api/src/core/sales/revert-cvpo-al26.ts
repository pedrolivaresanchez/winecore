import { deliveryEraseBlock, eraseDeliveryChildren, eraseDeliveryHeader } from '../documents/delete-draft';
import type { Actor, Tx, Writer } from '../db/writer';
import { sql } from '../db/sql';
import { planPrefix } from '../series/plan';
import { idOf } from './db';

/**
 * Numeración: `core.number_series.next_value` es el siguiente entero. El número
 * visible es `prefijo + entero con relleno` (`AL26-` + `0001`). `takeNumber`
 * incrementa `next_value` en la misma escritura que el documento.
 *
 * DuckDB rehace UPDATE como DELETE + INSERT y lo rechaza si otra fila apunta
 * a la clave. `sales.delivery_note` la referencian sus líneas, así que estos
 * albaranes se borran (hijas primero) y no se actualizan. `core.number_series`
 * no la referencia nadie (0040 la rehizo por eso): el contador sí se puede
 * poner a 1.
 *
 * No escribe en la org 1 ni en SDR. Contra Timbal hace falta
 * `WINECORE_REVERT_CONFIRM=AL26-0001`. El script no se lanza solo.
 */

export const CVPO_AL26_YEAR = 2026;
export const CVPO_AL26_PREFIX = planPrefix('delivery_note', CVPO_AL26_YEAR);
export const CVPO_AL26_NOTE_IDS = [
  '01a1d5b6-d65d-70de-bedb-1c5a540c3912',
  '01a1d64f-d6c0-700c-9b38-95355dd1f657',
] as const;

const CONFIRM = 'AL26-0001';

export type RevertAction = 'apply' | 'noop' | 'skip';

export type RevertPlan = {
  action: RevertAction;
  reason: 'ready' | 'already' | 'later_numbers' | 'unsafe';
  message: string;
  series_id: string | null;
  prefix: string;
  next_value: number | null;
  next_number_after: string | null;
  delete_ids: string[];
  later_numbers: string[];
};

type ReadDb = { read<T = Record<string, unknown>>(statement: string): Promise<T[]> };

type SeriesRow = {
  id: unknown;
  prefix: unknown;
  padding: unknown;
  next_value: unknown;
  entity_id: unknown;
};

type NoteRow = Record<string, unknown>;

function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return Number.NaN;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  return raw.length === 0 ? null : raw;
}

function plan(partial: Omit<RevertPlan, 'prefix'> & { prefix?: string }): RevertPlan {
  return { ...partial, prefix: partial.prefix ?? CVPO_AL26_PREFIX };
}

/** Rechaza org 1, el proyecto SDR y Timbal sin confirmación explícita. */
export function assertRevertTarget(env: Record<string, string | undefined>): void {
  const org = env.TIMBAL_ORG_ID?.trim() ?? '';
  const project = env.TIMBAL_PROJECT_ID?.trim() ?? '';
  const kb = env.TIMBAL_KB_ID?.trim() ?? '';
  const name = env.TIMBAL_PROJECT_NAME?.trim() ?? '';
  if (org === '1') throw new Error('Rechazado: no se toca la org 1.');
  if ([project, kb, name].some((value) => /sdr/i.test(value))) {
    throw new Error('Rechazado: no se toca el proyecto SDR.');
  }
  const mode = (env.DB_MODE?.trim() ?? 'local').toLowerCase();
  if (mode !== 'timbal') return;
  if (env.WINECORE_REVERT_CONFIRM?.trim() !== CONFIRM) {
    throw new Error(
      'Rechazado: este script no escribe en Timbal salvo WINECORE_REVERT_CONFIRM=AL26-0001. Por defecto no se ejecuta.',
    );
  }
  if (org !== '122' || project !== '3942') {
    throw new Error('Rechazado: en Timbal solo se admite la org 122 y el proyecto 3942.');
  }
}

export async function inspectCvpoAl26(db: ReadDb): Promise<RevertPlan> {
  const entities = await db.read<{ id: unknown }>(sql`
    SELECT id FROM core.legal_entity WHERE code = 'CVPO' LIMIT 1
  `);
  const entityId = entities[0] ? idOf(entities[0].id) : null;
  const seriesRows = entityId ? await db.read<SeriesRow>(sql`
    SELECT id, prefix, padding, next_value, legal_entity_id AS entity_id
    FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND doc_type = 'delivery_note'
      AND "year" = ${CVPO_AL26_YEAR}
      AND prefix = ${CVPO_AL26_PREFIX}
    LIMIT 1
  `) : [];
  const series = seriesRows[0];
  const seriesId = series ? idOf(series.id) : null;
  const nextValue = series ? num(series.next_value) : null;
  const targets = await db.read<NoteRow>(sql`
    SELECT * FROM sales.delivery_note
    WHERE id IN (CAST(${CVPO_AL26_NOTE_IDS[0]} AS UUID), CAST(${CVPO_AL26_NOTE_IDS[1]} AS UUID))
  `);
  const present = new Map(targets.map((row) => [idOf(row.id), row]));

  if (!seriesId || !entityId) {
    if (present.size === 0) {
      return plan({
        action: 'noop',
        reason: 'already',
        message: `No hay serie ${CVPO_AL26_PREFIX} de albaranes CVPO ${CVPO_AL26_YEAR} ni esos albaranes. No hay nada que revertir.`,
        series_id: null,
        next_value: null,
        next_number_after: null,
        delete_ids: [],
        later_numbers: [],
      });
    }
    return plan({
      action: 'skip',
      reason: 'unsafe',
      message: `No se hace nada: los albaranes existen y no hay serie ${CVPO_AL26_PREFIX} de CVPO ${CVPO_AL26_YEAR}.`,
      series_id: null,
      next_value: null,
      next_number_after: null,
      delete_ids: [],
      later_numbers: [],
    });
  }

  const numbered = await db.read<{ id: unknown; number: unknown }>(sql`
    SELECT id, number FROM sales.delivery_note
    WHERE number IS NOT NULL
      AND (
        series_id = CAST(${seriesId} AS UUID)
        OR (legal_entity_id = CAST(${entityId} AS UUID) AND number LIKE ${`${CVPO_AL26_PREFIX}%`})
      )
  `);
  const targetSet = new Set<string>(CVPO_AL26_NOTE_IDS);
  const later = numbered
    .filter((row) => !targetSet.has(idOf(row.id)))
    .map((row) => String(row.number))
    .sort();
  if (later.length > 0) {
    return plan({
      action: 'skip',
      reason: 'later_numbers',
      message: `No se hace nada: hay albaranes posteriores en la serie ${CVPO_AL26_PREFIX} (${later.join(', ')}). El contador no se toca.`,
      series_id: seriesId,
      next_value: nextValue,
      next_number_after: null,
      delete_ids: [],
      later_numbers: later,
    });
  }

  const problems: string[] = [];
  const deleteIds: string[] = [];
  for (const id of CVPO_AL26_NOTE_IDS) {
    const note = present.get(id);
    if (!note) continue;
    const status = String(note.status);
    const number = text(note.number);
    if (status !== 'cancelled' && status !== 'draft') {
      problems.push(`${id} está en ${status}`);
      continue;
    }
    if (number && !number.startsWith(CVPO_AL26_PREFIX)) {
      problems.push(`${id} tiene el número ${number}, que no es de ${CVPO_AL26_PREFIX}`);
      continue;
    }
    const noteSeries = note.series_id == null ? null : idOf(note.series_id);
    if (noteSeries && noteSeries !== seriesId) {
      problems.push(`${id} pertenece a otra serie`);
      continue;
    }
    const block = await deliveryEraseBlock(db as Tx, id);
    if (block) {
      problems.push(`${id}: ${block}`);
      continue;
    }
    deleteIds.push(id);
  }
  if (problems.length > 0) {
    return plan({
      action: 'skip',
      reason: 'unsafe',
      message: `No se hace nada: ${problems.join('; ')}.`,
      series_id: seriesId,
      next_value: nextValue,
      next_number_after: null,
      delete_ids: [],
      later_numbers: [],
    });
  }

  const counterMoves = nextValue !== 1;
  if (deleteIds.length === 0 && !counterMoves) {
    return plan({
      action: 'noop',
      reason: 'already',
      message: `Ya estaba revertido: no quedan esos albaranes y el siguiente número es ${CVPO_AL26_PREFIX}0001.`,
      series_id: seriesId,
      next_value: nextValue,
      next_number_after: `${CVPO_AL26_PREFIX}${String(1).padStart(num(series?.padding) || 4, '0')}`,
      delete_ids: [],
      later_numbers: [],
    });
  }

  const padding = num(series?.padding);
  const nextNumber = `${CVPO_AL26_PREFIX}${String(1).padStart(Number.isInteger(padding) && padding > 0 ? padding : 4, '0')}`;
  const removed = deleteIds.length === 0 ? 'el contador' : `${deleteIds.length} albarán${deleteIds.length === 1 ? '' : 'es'}`;
  return plan({
    action: 'apply',
    reason: 'ready',
    message: `Se revierte ${removed}. El siguiente albarán de CVPO ${CVPO_AL26_YEAR} será ${nextNumber}.`,
    series_id: seriesId,
    next_value: nextValue,
    next_number_after: nextNumber,
    delete_ids: deleteIds,
    later_numbers: [],
  });
}

export async function applyCvpoAl26(writer: Writer, actor: Actor): Promise<RevertPlan> {
  const planResult = await inspectCvpoAl26(writer);
  if (planResult.action !== 'apply' || !planResult.series_id) return planResult;
  for (const id of planResult.delete_ids) {
    await writer.withWrite(actor, (tx) => eraseDeliveryChildren(tx, id));
  }
  const again = await inspectCvpoAl26(writer);
  if (again.action !== 'apply' || !again.series_id) return again;
  for (const id of again.delete_ids) {
    const rows = await writer.read<NoteRow>(sql`SELECT * FROM sales.delivery_note WHERE id = CAST(${id} AS UUID)`);
    const note = rows[0];
    if (!note) continue;
    await writer.withWrite(actor, (tx) => eraseDeliveryHeader(tx, id, note));
  }
  if (again.next_value !== 1) {
    await writer.withWrite(actor, async (tx) => {
      tx.write(sql`
        UPDATE core.number_series
        SET next_value = 1
        WHERE id = CAST(${again.series_id} AS UUID)
          AND doc_type = 'delivery_note'
          AND prefix = ${CVPO_AL26_PREFIX}
      `);
      tx.audit({
        table: 'core.number_series',
        rowId: again.series_id,
        action: 'UPDATE',
        before: { next_value: again.next_value },
        after: { next_value: 1, reason: 'revert-cvpo-al26' },
      });
    });
  }
  return again;
}
