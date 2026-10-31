import type { PlanSuccess } from '../cellar/types';

export const WINEMAKING_OPS = [
  'crushing_pressing',
  'fermentation_start',
  'fermentation_end',
  'malolactic_start',
  'malolactic_end',
] as const;

export type WinemakingOp = (typeof WINEMAKING_OPS)[number];

const WINEMAKING_SET = new Set<string>(WINEMAKING_OPS);

export function isWinemakingOp(value: string): value is WinemakingOp {
  return WINEMAKING_SET.has(value);
}

/**
 * DuckDB 1.5.5 no puede ampliar el CHECK de cellar.operation.op_type.
 * El inicio de FA y las dos fases malolácticas se guardan como `stabilization`
 * (sin volumen) y el tipo real va en details.winemaking_op.
 * El prensado y el fin de FA usan los tipos que la especificación ya nombra.
 */
export function dbOpType(op: string): string {
  if (op === 'fermentation_start' || op === 'malolactic_start' || op === 'malolactic_end') {
    return 'stabilization';
  }
  return op;
}

export function publicOpType(column: string, details: unknown): string {
  if (details !== null && typeof details === 'object' && !Array.isArray(details)) {
    const op = (details as { winemaking_op?: unknown }).winemaking_op;
    if (typeof op === 'string' && isWinemakingOp(op)) return op;
  }
  return column;
}

export interface SilicieEntryView {
  kind: 'A14' | 'A15' | 'A32';
  quantity: number;
  unit: 'KGM' | 'LTR';
  operation: 'V01';
  loss: 'VB01' | null;
}

/** Asientos que silicie.md §5 pide, sin generar el CSV (eso lo hace el módulo SILICIE). */
export function describeSilicie(plan: PlanSuccess): SilicieEntryView[] {
  const rows: SilicieEntryView[] = [];
  for (const fact of plan.silicieFacts) {
    if (fact.kind === 'crushing' && fact.mass_g !== null) {
      rows.push({ kind: 'A14', quantity: fact.mass_g, unit: 'KGM', operation: 'V01', loss: null });
    }
    if (fact.kind === 'elaboration_loss' && fact.volume_ml !== null) {
      rows.push({ kind: 'A32', quantity: fact.volume_ml, unit: 'LTR', operation: 'V01', loss: 'VB01' });
    }
  }
  for (const move of plan.fiscalMoves) {
    if (move.move_type === 'production') {
      rows.push({ kind: 'A15', quantity: move.volume_ml, unit: 'LTR', operation: 'V01', loss: null });
    }
  }
  return rows;
}
