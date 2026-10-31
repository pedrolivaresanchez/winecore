import type { Writer } from '../db/writer';
import type { DesignInput } from './design';
import { readStoredDesign } from './design';
import type { RecipeAddition, RecipeStep } from './history';
import { loadHistory } from './history';
import { requireLot } from './lot-ref';
import { readRecipeVersion, type RecipeVersion } from './recipes';

export interface Deviation {
  kind: 'missing_step' | 'extra_operation' | 'type_mismatch' | 'parameter' | 'design';
  position: number | null;
  op_type: string | null;
  field: string | null;
  expected: unknown;
  actual: unknown;
}

interface ComparableAddition {
  product_id: string | null;
  product_name: string | null;
  dose_g_per_hl: number | null;
}

interface ComparableStep {
  op_type: string;
  duration_hours: number | null;
  temperature_c: number | null;
  additions: ComparableAddition[];
  blend_percents: number[];
}

export interface DeviationReport {
  lot_id: string;
  lot_code: string;
  recipe_id: string;
  version_id: string;
  version_no: number;
  expected_count: number;
  actual_count: number;
  matched: boolean;
  deviations: Deviation[];
}

function comparable(step: RecipeStep): ComparableStep {
  return {
    op_type: step.op_type,
    duration_hours: step.duration_hours,
    temperature_c: step.temperature_c,
    additions: step.additions.map((item) => ({
      product_id: item.product_id,
      product_name: item.product_name,
      dose_g_per_hl: item.dose_g_per_hl,
    })),
    blend_percents: step.blend_proportions.map((item) => item.percent),
  };
}

function percentKey(values: readonly number[]): string {
  return values.map((value) => value.toFixed(1)).sort().join('/');
}

function additionKey(item: ComparableAddition): string {
  if (item.product_id) return `id:${item.product_id}`;
  return `name:${(item.product_name ?? '').trim().toLowerCase()}`;
}

function doseDiffers(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) > Math.max(0.05, Math.abs(expected) * 0.05);
}

function parameterDeviations(position: number, expected: ComparableStep, actual: ComparableStep): Deviation[] {
  const out: Deviation[] = [];
  const base = { kind: 'parameter' as const, position, op_type: expected.op_type };
  if (expected.temperature_c != null) {
    const actualTemp = actual.temperature_c;
    if (actualTemp == null || Math.abs(expected.temperature_c - actualTemp) > 0.5) {
      out.push({ ...base, field: 'temperature_c', expected: expected.temperature_c, actual: actualTemp });
    }
  }
  if (expected.duration_hours != null) {
    const actualDuration = actual.duration_hours;
    const limit = Math.max(1, Math.abs(expected.duration_hours) * 0.1);
    if (actualDuration == null || Math.abs(expected.duration_hours - actualDuration) > limit) {
      out.push({ ...base, field: 'duration_hours', expected: expected.duration_hours, actual: actualDuration });
    }
  }
  if (expected.blend_percents.length > 0 || actual.blend_percents.length > 0) {
    const expectedKey = percentKey(expected.blend_percents);
    const actualKey = percentKey(actual.blend_percents);
    if (expectedKey !== actualKey) {
      out.push({ ...base, field: 'blend_proportions', expected: expectedKey, actual: actualKey });
    }
  }
  const actualByKey = new Map(actual.additions.map((item) => [additionKey(item), item]));
  const seen = new Set<string>();
  for (const item of expected.additions) {
    const key = additionKey(item);
    seen.add(key);
    const found = actualByKey.get(key);
    if (!found) {
      out.push({ ...base, field: 'additions', expected: additionLabel(item), actual: null });
      continue;
    }
    if (item.dose_g_per_hl != null && found.dose_g_per_hl != null && doseDiffers(item.dose_g_per_hl, found.dose_g_per_hl)) {
      out.push({
        ...base,
        field: 'dose_g_per_hl',
        expected: item.dose_g_per_hl,
        actual: found.dose_g_per_hl,
      });
    }
  }
  for (const item of actual.additions) {
    const key = additionKey(item);
    if (!seen.has(key)) out.push({ ...base, field: 'additions', expected: null, actual: additionLabel(item) });
  }
  return out;
}

function additionLabel(item: ComparableAddition): string {
  return item.product_name ?? item.product_id ?? 'adición';
}

/** Aligns recipe steps with what the lot actually did. One look-ahead for a skipped or extra step. */
export function compareStepSequences(expected: readonly ComparableStep[], actual: readonly ComparableStep[]): Deviation[] {
  const out: Deviation[] = [];
  let i = 0;
  let j = 0;
  while (i < expected.length || j < actual.length) {
    const exp = expected[i];
    const act = actual[j];
    if (exp && act && exp.op_type === act.op_type) {
      out.push(...parameterDeviations(i + 1, exp, act));
      i += 1;
      j += 1;
      continue;
    }
    const nextExpected = expected[i + 1];
    const nextActual = actual[j + 1];
    if (exp && act && nextExpected && nextExpected.op_type === act.op_type) {
      out.push({
        kind: 'missing_step',
        position: i + 1,
        op_type: exp.op_type,
        field: null,
        expected: exp.op_type,
        actual: null,
      });
      i += 1;
      continue;
    }
    if (exp && act && nextActual && nextActual.op_type === exp.op_type) {
      out.push({
        kind: 'extra_operation',
        position: j + 1,
        op_type: act.op_type,
        field: null,
        expected: null,
        actual: act.op_type,
      });
      j += 1;
      continue;
    }
    if (exp && act) {
      out.push({
        kind: 'type_mismatch',
        position: i + 1,
        op_type: exp.op_type,
        field: 'op_type',
        expected: exp.op_type,
        actual: act.op_type,
      });
      i += 1;
      j += 1;
      continue;
    }
    if (exp) {
      out.push({
        kind: 'missing_step',
        position: i + 1,
        op_type: exp.op_type,
        field: null,
        expected: exp.op_type,
        actual: null,
      });
      i += 1;
      continue;
    }
    if (act) {
      out.push({
        kind: 'extra_operation',
        position: j + 1,
        op_type: act.op_type,
        field: null,
        expected: null,
        actual: act.op_type,
      });
      j += 1;
    }
  }
  return out;
}

const DESIGN_FIELDS = [
  'vinification',
  'destemmed',
  'inoculation_kind',
  'aging_method',
  'aging_duration_days',
  'no_intervention',
  'single_plot',
  'label_number',
] as const satisfies readonly (keyof DesignInput)[];

function designDeviations(expected: DesignInput, actual: DesignInput): Deviation[] {
  const out: Deviation[] = [];
  for (const field of DESIGN_FIELDS) {
    if (expected[field] !== actual[field]) {
      out.push({
        kind: 'design',
        position: null,
        op_type: null,
        field,
        expected: expected[field],
        actual: actual[field],
      });
    }
  }
  const applied = (values: string[]) => [...values].sort().join(',');
  if (applied(expected.practices_applied) !== applied(actual.practices_applied)) {
    out.push({
      kind: 'design',
      position: null,
      op_type: null,
      field: 'practices_applied',
      expected: expected.practices_applied,
      actual: actual.practices_applied,
    });
  }
  if (applied(expected.practices_not_applied) !== applied(actual.practices_not_applied)) {
    out.push({
      kind: 'design',
      position: null,
      op_type: null,
      field: 'practices_not_applied',
      expected: expected.practices_not_applied,
      actual: actual.practices_not_applied,
    });
  }
  return out;
}

export async function compareLot(
  writer: Writer,
  code: string,
  producerId: string | null,
  recipeId: string,
  versionNo: number | null,
): Promise<DeviationReport> {
  const lot = await requireLot(writer, code, producerId);
  const version: RecipeVersion = await readRecipeVersion(writer, recipeId, versionNo, lot.id);
  const expected = version.steps;
  const actual = await loadHistory(writer, lot.id);
  const deviations = compareStepSequences(expected.map(comparable), actual.map(comparable));
  const stored = await readStoredDesign(writer, lot.id);
  if (version.design && stored) deviations.push(...designDeviations(version.design, stored.input));
  return {
    lot_id: lot.id,
    lot_code: lot.code,
    recipe_id: version.recipe_id,
    version_id: version.id,
    version_no: version.version_no,
    expected_count: expected.length,
    actual_count: actual.length,
    matched: deviations.length === 0,
    deviations,
  };
}

export type { RecipeAddition };
