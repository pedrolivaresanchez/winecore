import { assertConserved, fail, needsEnds, sumMl } from '../cellar/common';
import type { PlanFailure } from '../cellar/types';

export interface BalanceLine {
  role: 'input' | 'output' | 'loss' | 'pomace';
  volume_ml: number;
}

/**
 * Conservación de docs/02-modelo-dominio.md §9.2 para los tipos que DuckDB
 * no puede añadir al CHECK. El sangrado y el descube conservan mililitros.
 * El délestage, la corrección de temperatura y la toma de muestras no admiten líneas.
 */
export function assertElaborationBalance(
  opType: string,
  lines: readonly BalanceLine[],
): PlanFailure | null {
  if (opType === 'delestage' || opType === 'temperature_control' || opType === 'sampling') {
    if (lines.length > 0) {
      return fail(
        'WC020',
        `WC020: ${opType} no mueve volumen; los datos van en los detalles.`,
        { op_type: opType, lines: lines.length },
      );
    }
    return null;
  }
  if (opType !== 'bleeding' && opType !== 'pressing_off') return null;
  const inputs = lines.filter((line) => line.role === 'input').length;
  const outputs = lines.filter((line) => line.role === 'output').length;
  const ends = needsEnds(inputs, outputs, opType);
  if (ends !== null) return ends;
  const inputMl = sumMl(lines.filter((line) => line.role === 'input').map((line) => line.volume_ml));
  if (typeof inputMl !== 'number') return inputMl;
  const outputMl = sumMl(lines.filter((line) => line.role === 'output').map((line) => line.volume_ml));
  if (typeof outputMl !== 'number') return outputMl;
  const lossMl = sumMl(lines.filter((line) => line.role === 'loss').map((line) => line.volume_ml));
  if (typeof lossMl !== 'number') return lossMl;
  return assertConserved({ inputs_ml: inputMl, outputs_ml: outputMl, losses_ml: lossMl }, opType);
}

/** silicie.md no define sangrado ni descube (Q-040). */
export const SILICIE_Q040 =
  'Q-040: silicie.md no define el asiento de sangrado ni de descube; no hay movimiento fiscal.';
