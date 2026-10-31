import { describe, expect, it } from 'bun:test';
import { Decimal } from 'decimal.js';
import { migrate } from '../../db/migrate';
import { createLocalClient } from '../../src/core/db/local';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { entriesFor } from '../../src/core/regulatory/silicie/entries';
import type { SilicieEntryDraft, SilicieLedger } from '../../src/core/regulatory/silicie/types';
import { apertura } from '../silicie/scenarios';

describe('silicie en DuckDB', () => {
  it('los borradores de la apertura caben en silicie_ledger y silicie_entry', async () => {
    const scenario = apertura();
    const drafts = entriesFor(scenario.moves, scenario.context);
    const client = await createLocalClient(':memory:');
    try {
      await migrate(client);
      const warehouseId = newId();
      const exerciseId = newId();
      await client.query(sql`
        INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test)
        VALUES (${warehouseId}, ${newId()}, 'ES00000V0000T', 'V1', 'Fabrica sintetica', true)
      `);
      await client.query(sql`
        INSERT INTO regulatory.silicie_exercise (id, tax_warehouse_id, year)
        VALUES (${exerciseId}, ${warehouseId}, ${scenario.context.exerciseYear})
      `);
      for (const ledger of scenario.context.ledgers) {
        await insertLedger(client, warehouseId, ledger);
      }
      for (const draft of drafts) {
        await insertEntry(client, warehouseId, exerciseId, draft);
      }

      const ledgers = await client.query<{ reference: string; capacity: string | number | null }>(
        `SELECT reference, container_capacity_l::VARCHAR AS capacity
           FROM regulatory.silicie_ledger
          WHERE tax_warehouse_id = '${warehouseId}'
          ORDER BY reference`,
      );
      expect(ledgers.map((row) => row.reference).sort()).toEqual(
        scenario.context.ledgers.map((ledger) => ledger.reference).sort(),
      );
      const bottled = ledgers.find((row) => row.reference === 'B075-SINTE');
      expect(Number(bottled?.capacity)).toBeCloseTo(0.75, 3);

      const entries = await client.query<{
        local_seq: number | string;
        entry_kind: string;
        movement_date: string;
        status: string;
      }>(
        `SELECT local_seq, entry_kind, movement_date::VARCHAR AS movement_date, status
           FROM regulatory.silicie_entry
          WHERE exercise_id = '${exerciseId}'
          ORDER BY local_seq`,
      );
      expect(entries.map((row) => row.entry_kind)).toEqual(drafts.map((draft) => draft.entryKind));
      expect(entries.map((row) => Number(row.local_seq))).toEqual(drafts.map((draft) => draft.localSeq));
      expect(entries.map((row) => String(row.movement_date).slice(0, 10))).toEqual(
        drafts.map((draft) => draft.movementDate),
      );
      expect(entries.every((row) => row.status === 'pending')).toBe(true);
    } finally {
      await client.close?.();
    }
  });
});

async function insertLedger(
  client: { query: (statement: string) => Promise<unknown> },
  warehouseId: string,
  ledger: SilicieLedger,
): Promise<void> {
  const capacity =
    ledger.containerCapacityMl === null ? null : new Decimal(ledger.containerCapacityMl).div(1000);
  await client.query(sql`
    INSERT INTO regulatory.silicie_ledger (
      id, tax_warehouse_id, reference, description, product_class,
      epigrafe, epigrafe_code, nc_code, product_key, container_type,
      container_capacity_l, is_active, validated_by, created_at
    ) VALUES (
      ${newId()}, ${warehouseId}, ${ledger.reference}, ${ledger.description}, ${ledger.productClass},
      ${ledger.epigrafe}, ${ledger.epigrafeCode}, ${ledger.ncCode}, ${ledger.productKey}, ${ledger.containerType},
      ${capacity}, ${ledger.isActive}, ${ledger.validatedBy}, ${ledger.createdAt}::TIMESTAMPTZ
    )
  `);
}

async function insertEntry(
  client: { query: (statement: string) => Promise<unknown> },
  warehouseId: string,
  exerciseId: string,
  draft: SilicieEntryDraft,
): Promise<void> {
  await client.query(sql`
    INSERT INTO regulatory.silicie_entry (
      id, exercise_id, tax_warehouse_id, local_seq, movement_date,
      entry_kind, fields, status, aeat_entry_number, annuls_entry_id, submission_id
    ) VALUES (
      ${newId()}, ${exerciseId}, ${warehouseId}, ${draft.localSeq}, ${draft.movementDate}::DATE,
      ${draft.entryKind}, ${sql.json(draft.fields)}, ${draft.status}, ${draft.aeatEntryNumber},
      ${draft.annulsEntryId}, ${draft.submissionId}
    )
  `);
}
