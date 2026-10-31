import { sql } from '../../db/sql';
import type { Tx } from '../../db/writer';
import { DomainError, domainError } from '../../errors';
import { auditUpdate, intOf } from './http';

/**
 * Next `cellar_operation` number for the entity and fiscal year.
 * Isolated so the shared series service can replace this function.
 */
export async function takeCellarOperationNumber(tx: Tx, entityId: string, fiscalDate: string): Promise<string> {
  const year = Number(fiscalDate.slice(0, 4));
  const rows = await tx.read<{ id: string; prefix: string; padding: unknown; next_value: unknown }>(sql`
    SELECT id::VARCHAR AS id, prefix, padding, next_value
    FROM core.number_series
    WHERE legal_entity_id = CAST(${entityId} AS UUID)
      AND doc_type = 'cellar_operation'
      AND year = ${year}
      AND is_active
      AND is_default
    ORDER BY code
    LIMIT 1
  `);
  const series = rows[0];
  if (!series) {
    throw new DomainError('WC010', 409, `No hay una serie activa de operaciones de bodega para ${year}`);
  }
  const padding = intOf(series.padding);
  const next = intOf(series.next_value);
  const limit = 10 ** padding - 1;
  if (!Number.isSafeInteger(limit) || next > limit) throw domainError('WC011');
  const number = `${series.prefix}${String(next).padStart(padding, '0')}`;
  auditUpdate(tx, 'core.number_series', series.id, { next_value: next }, { next_value: next + 1 }, sql`
    UPDATE core.number_series
    SET next_value = ${next + 1}
    WHERE id = CAST(${series.id} AS UUID) AND next_value = ${next}
  `);
  return number;
}
