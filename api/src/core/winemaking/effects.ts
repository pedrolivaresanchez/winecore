import { newId } from '../ids';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import type { FermentationPhaseName, PlanSuccess } from '../cellar/types';
import { publicOpType } from './ops';

const PHASES = new Set(['alcoholic', 'alcoholic_done', 'malolactic', 'malolactic_done']);

export async function applyWinemakingEffects(tx: Tx, operationId: string, plan: PlanSuccess): Promise<void> {
  for (const update of plan.lotUpdates) {
    if (update.lot_id.trim() === '') continue;
    const rows = await tx.read<{ kind: string }>(sql`
      SELECT kind FROM inventory.lot WHERE id = CAST(${update.lot_id} AS UUID)
    `);
    const current = rows[0]?.kind ?? null;
    if (current === update.kind) continue;
    tx.write(sql`
      UPDATE inventory.lot SET kind = ${update.kind} WHERE id = CAST(${update.lot_id} AS UUID)
    `);
    tx.audit({
      table: 'inventory.lot',
      rowId: update.lot_id,
      action: 'UPDATE',
      before: { kind: current },
      after: { kind: update.kind },
    });
  }

  for (const fact of plan.silicieFacts) {
    const id = newId();
    tx.write(sql`
      INSERT INTO cellar.silicie_fact (
        id, operation_id, kind, mass_g, volume_ml, ledger_reference, abv_pct
      ) VALUES (
        CAST(${id} AS UUID),
        CAST(${operationId} AS UUID),
        ${fact.kind},
        ${fact.mass_g},
        ${fact.volume_ml},
        ${fact.ledger_reference},
        CAST(${fact.abv_pct} AS DECIMAL(5,2))
      )
    `);
    tx.audit({
      table: 'cellar.silicie_fact',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: { operation_id: operationId, kind: fact.kind },
    });
  }

  const yieldRow = plan.pressingYield;
  if (yieldRow) {
    tx.write(sql`
      INSERT INTO cellar.pressing_yield (
        operation_id, input_state, input_mass_g, input_volume_ml, must_volume_ml, pomace_mass_g,
        must_yield, must_yield_unit, pomace_yield, pomace_yield_unit
      ) VALUES (
        CAST(${operationId} AS UUID),
        ${yieldRow.input_state},
        ${yieldRow.input_mass_g},
        ${yieldRow.input_volume_ml},
        ${yieldRow.must_volume_ml},
        ${yieldRow.pomace_mass_g},
        ${yieldRow.must_yield},
        ${yieldRow.must_yield_unit},
        ${yieldRow.pomace_yield},
        ${yieldRow.pomace_yield_unit}
      )
    `);
    tx.audit({
      table: 'cellar.pressing_yield',
      rowId: operationId,
      action: 'INSERT',
      before: null,
      after: yieldRow,
    });
  }

  const phase = plan.fermentationPhase;
  if (phase) await upsertPhase(tx, operationId, phase.lot_id, phase.vessel_id, phase.phase, phase.previous_phase);
}

export async function recordAdditionTrace(
  tx: Tx,
  operationId: string,
  additiveLotCode: string | null,
  allergens: readonly string[],
): Promise<void> {
  if ((additiveLotCode === null || additiveLotCode === '') && allergens.length === 0) return;
  tx.write(sql`
    INSERT INTO cellar.addition_trace (operation_id, additive_lot_code, allergens)
    VALUES (
      CAST(${operationId} AS UUID),
      ${additiveLotCode},
      ${sql.json([...allergens])}
    )
  `);
  tx.audit({
    table: 'cellar.addition_trace',
    rowId: operationId,
    action: 'INSERT',
    before: null,
    after: { additive_lot_code: additiveLotCode, allergens: [...allergens] },
  });
}

/** Al rectificar, el lote vuelve al estado anterior y la fase también. */
export async function restoreWinemaking(tx: Tx, operationId: string): Promise<void> {
  const rows = await tx.read<{ op_type: string; details: unknown }>(sql`
    SELECT op_type, details FROM cellar.operation WHERE id = CAST(${operationId} AS UUID)
  `);
  const row = rows[0];
  if (!row) return;
  const op = publicOpType(row.op_type, parseDetails(row.details));
  if (op === 'crushing_pressing') {
    await restoreKind(tx, operationId, 'grape', 'grape');
  } else if (op === 'fermentation_end') {
    await restoreKind(tx, operationId, null, 'must');
  }
  const phases = await tx.read<{ lot_id: string; phase: string; previous_phase: string | null }>(sql`
    SELECT lot_id::VARCHAR AS lot_id, phase, previous_phase
    FROM cellar.fermentation_phase
    WHERE operation_id = CAST(${operationId} AS UUID) AND active
  `);
  for (const phase of phases) {
    if (phase.previous_phase && PHASES.has(phase.previous_phase)) {
      tx.write(sql`
        UPDATE cellar.fermentation_phase
        SET phase = ${phase.previous_phase}, previous_phase = NULL, active = TRUE, updated_at = now()
        WHERE lot_id = CAST(${phase.lot_id} AS UUID)
      `);
      tx.audit({
        table: 'cellar.fermentation_phase',
        rowId: phase.lot_id,
        action: 'UPDATE',
        before: { phase: phase.phase },
        after: { phase: phase.previous_phase },
      });
    } else {
      tx.write(sql`
        UPDATE cellar.fermentation_phase
        SET active = FALSE, updated_at = now()
        WHERE lot_id = CAST(${phase.lot_id} AS UUID)
      `);
      tx.audit({
        table: 'cellar.fermentation_phase',
        rowId: phase.lot_id,
        action: 'UPDATE',
        before: { active: true, phase: phase.phase },
        after: { active: false },
      });
    }
  }
}

export async function loadPhase(tx: Tx, lotId: string): Promise<FermentationPhaseName | null> {
  const rows = await tx.read<{ phase: string }>(sql`
    SELECT phase FROM cellar.fermentation_phase
    WHERE lot_id = CAST(${lotId} AS UUID) AND active
  `);
  const phase = rows[0]?.phase ?? null;
  if (phase === 'alcoholic' || phase === 'alcoholic_done' || phase === 'malolactic' || phase === 'malolactic_done') {
    return phase;
  }
  return null;
}

async function upsertPhase(
  tx: Tx,
  operationId: string,
  lotId: string,
  vesselId: string,
  phase: FermentationPhaseName,
  previous: FermentationPhaseName | null,
): Promise<void> {
  const existing = await tx.read<{ phase: string }>(sql`
    SELECT phase FROM cellar.fermentation_phase WHERE lot_id = CAST(${lotId} AS UUID)
  `);
  if (existing.length === 0) {
    tx.write(sql`
      INSERT INTO cellar.fermentation_phase (lot_id, vessel_id, phase, previous_phase, operation_id, active)
      VALUES (
        CAST(${lotId} AS UUID),
        CAST(${vesselId} AS UUID),
        ${phase},
        ${previous},
        CAST(${operationId} AS UUID),
        TRUE
      )
    `);
  } else {
    tx.write(sql`
      UPDATE cellar.fermentation_phase
      SET vessel_id = CAST(${vesselId} AS UUID),
          phase = ${phase},
          previous_phase = ${previous},
          operation_id = CAST(${operationId} AS UUID),
          active = TRUE,
          updated_at = now()
      WHERE lot_id = CAST(${lotId} AS UUID)
    `);
  }
  tx.audit({
    table: 'cellar.fermentation_phase',
    rowId: lotId,
    action: existing.length === 0 ? 'INSERT' : 'UPDATE',
    before: existing[0] ? { phase: existing[0].phase } : null,
    after: { phase, operation_id: operationId },
  });
}

async function restoreKind(tx: Tx, operationId: string, productState: string | null, kind: string): Promise<void> {
  const lots = productState === null
    ? await tx.read<{ lot_id: string }>(sql`
      SELECT DISTINCT lot_id::VARCHAR AS lot_id
      FROM cellar.operation_line
      WHERE operation_id = CAST(${operationId} AS UUID) AND role = 'input'
    `)
    : await tx.read<{ lot_id: string }>(sql`
      SELECT DISTINCT lot_id::VARCHAR AS lot_id
      FROM cellar.operation_line
      WHERE operation_id = CAST(${operationId} AS UUID)
        AND role = 'input'
        AND product_state = ${productState}
    `);
  for (const lot of lots) {
    const current = await tx.read<{ kind: string }>(sql`
      SELECT kind FROM inventory.lot WHERE id = CAST(${lot.lot_id} AS UUID)
    `);
    if (current[0]?.kind === kind) continue;
    tx.write(sql`UPDATE inventory.lot SET kind = ${kind} WHERE id = CAST(${lot.lot_id} AS UUID)`);
    tx.audit({
      table: 'inventory.lot',
      rowId: lot.lot_id,
      action: 'UPDATE',
      before: { kind: current[0]?.kind ?? null },
      after: { kind },
    });
  }
}

function parseDetails(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}
