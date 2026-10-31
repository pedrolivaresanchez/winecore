import { domainError } from '../errors';
import {
  PROCESS_LABEL,
  STATE_LABEL,
  isProcess,
  isProductState,
  lossOf,
  parameterOf,
  processOf,
} from './defaults';
import { decimalText, esNum, fixed, plain, q } from './qty';
import { fold } from './text';
import {
  type CellarProcess,
  type ProductState,
  type SettingsView,
} from './types';

export interface CheckAddition {
  name: string;
  purpose: string | null;
  is_so2: boolean | null;
}

export interface CheckAnalysis {
  sampled_on: string;
  parameters: string[];
}

export interface CheckOperationInput {
  as_of: string;
  operation: {
    op_type: string;
    process: string | null;
    product_state: string;
    input_volume_ml: string;
    loss_volume_ml: string;
    reason: string | null;
    additions: CheckAddition[];
    practices: string[];
  };
  lot: {
    kind: string | null;
    has_volume: boolean;
    racked_this_winter: boolean;
    malolactic_finished: boolean | null;
    malic_acid_g_l: string | null;
    volatile_acidity_g_l: string | null;
    analyses: CheckAnalysis[];
  };
  settings: SettingsView;
}

export interface CheckFinding {
  code: string;
  severity: 'info' | 'warning' | 'error';
  blocks: boolean;
  requires_reason: boolean;
  reason_satisfied: boolean;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  findings: CheckFinding[];
}

export interface SeasonalContext {
  day: string;
  lot_kind: string | null;
  has_volume: boolean;
  racked_this_winter: boolean;
  settings: SettingsView;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function checkOperation(input: CheckOperationInput): CheckResult {
  const findings: CheckFinding[] = [];
  findings.push(...lossFindings(input));
  findings.push(...additionFindings(input));
  findings.push(...bottlingFindings(input));
  findings.push(...volatileFindings(input));
  findings.push(...seasonalFindings({
    day: input.as_of,
    lot_kind: input.lot.kind,
    has_volume: input.lot.has_volume,
    racked_this_winter: input.lot.racked_this_winter,
    settings: input.settings,
  }));
  return { ok: findings.every((row) => !row.blocks), findings };
}

export function seasonalFindings(input: SeasonalContext): CheckFinding[] {
  const findings: CheckFinding[] = [];
  if (input.lot_kind !== 'wine' || !input.has_volume) return findings;
  if (!DATE.test(input.day)) return findings;
  if (winterRackingDue(input)) {
    findings.push({
      code: 'ENO_SEASONAL_RACKING',
      severity: 'info',
      blocks: false,
      requires_reason: false,
      reason_satisfied: false,
      message: 'Recordatorio: primer trasiego tras el frío del invierno (febrero-marzo) para este lote de vino a granel.',
    });
  }
  if (postSpringBottlingDue(input)) {
    const from = parameterOf(input.settings, 'bottling_reminder_month_from');
    const pending = from.pending ? ` (${from.status_label})` : '';
    findings.push({
      code: 'ENO_SEASONAL_BOTTLING',
      severity: 'info',
      blocks: false,
      requires_reason: false,
      reason_satisfied: false,
      message: `Recordatorio: el embotellado de casa es después de la primavera y este lote sigue a granel${pending}.`,
    });
  }
  return findings;
}

export function winterRackingDue(input: SeasonalContext): boolean {
  if (input.lot_kind !== 'wine' || !input.has_volume || input.racked_this_winter) return false;
  const from = monthParam(input.settings, 'winter_racking_month_from');
  const to = monthParam(input.settings, 'winter_racking_month_to');
  return inWindow(input.day, from, to);
}

export function postSpringBottlingDue(input: SeasonalContext): boolean {
  if (input.lot_kind !== 'wine' || !input.has_volume) return false;
  const from = monthParam(input.settings, 'bottling_reminder_month_from');
  const to = monthParam(input.settings, 'bottling_reminder_month_to');
  return inWindow(input.day, from, to);
}

export function seasonKey(day: string): string {
  return day.slice(0, 4);
}

export function isSo2Addition(addition: CheckAddition): boolean {
  if (addition.is_so2 === true) return true;
  if (addition.purpose === 'sulphiting') return true;
  const name = fold(addition.name);
  return [
    'so2',
    'dioxido de azufre',
    'metabisulfito',
    'bisulfito',
    'anhidrido sulfuroso',
    'potassium metabisulfite',
    'k2s2o5',
    'sulfuroso',
  ].some((term) => name.includes(term));
}

function lossFindings(input: CheckOperationInput): CheckFinding[] {
  const fields: Record<string, string> = {};
  const inputText = decimalText(input.operation.input_volume_ml);
  const lossText = decimalText(input.operation.loss_volume_ml);
  if (inputText === null) fields.input_volume_ml = 'Debe ser un número';
  if (lossText === null) fields.loss_volume_ml = 'Debe ser un número';
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  const inputMl = q(inputText ?? '0');
  const lossMl = q(lossText ?? '0');
  if (inputMl.isNeg() || lossMl.isNeg()) {
    throw domainError('WC_VALIDATION', { volume: 'El volumen no puede ser negativo' });
  }
  if (lossMl.isZero()) return [];

  const process = resolveProcess(input);
  const state = input.operation.product_state;
  if (!process || !isProductState(state)) {
    return [info(
      'ENO_LOSS_TOLERANCE_UNKNOWN',
      'No se puede elegir la tolerancia de merma: falta el proceso o el estado del producto. No se inventa un porcentaje.',
    )];
  }
  const row = lossOf(input.settings, process, state);
  const where = `${PROCESS_LABEL[process]} en ${STATE_LABEL[state]}`;
  if (!row) {
    return [info(
      'ENO_LOSS_TOLERANCE_UNKNOWN',
      `No hay tolerancia de merma para ${where}. No se inventa un porcentaje.`,
    )];
  }
  if (row.max_pct === null) {
    const shown = inputMl.isZero() ? 'la merma no tiene volumen de entrada' : `la merma es del ${esNum(percent(lossMl, inputMl))} %`;
    return [info(
      'ENO_LOSS_TOLERANCE_PENDING',
      `No hay tolerancia de merma para ${where}: el máximo está pendiente de que el asesor lo indique. No se compara (${shown}).`,
    )];
  }
  if (inputMl.isZero()) {
    return [warnReason(
      'WC_ENOLOGY_LOSS',
      hasReason(input.operation.reason),
      'Hay merma sin volumen de entrada, así que el porcentaje no se puede calcular. Hace falta un motivo.',
      'Hay merma sin volumen de entrada. El motivo consta.',
    )];
  }
  const pct = percent(lossMl, inputMl);
  if (q(pct).lte(row.max_pct)) return [];
  const over = `La merma es del ${esNum(pct)} % y la tolerancia de ${where} es del ${esNum(row.max_pct)} %`;
  return [warnReason(
    'WC_ENOLOGY_LOSS',
    hasReason(input.operation.reason),
    `${over}. Hace falta un motivo.`,
    `${over}. El motivo consta.`,
  )];
}

function additionFindings(input: CheckOperationInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const texts = [
    ...input.operation.additions.map((row) => row.name),
    ...input.operation.practices,
  ];
  for (const text of texts) {
    const practice = prohibitedMatch(input.settings, text);
    if (!practice) continue;
    findings.push({
      code: 'WC_ENOLOGY_PROHIBITED',
      severity: 'error',
      blocks: true,
      requires_reason: false,
      reason_satisfied: false,
      message: `${practice.name_es.charAt(0).toUpperCase()}${practice.name_es.slice(1)} está prohibido en esta bodega. La operación no puede seguir.`,
    });
    break;
  }

  const finished = malolacticFinished(input);
  if (finished !== true) return findings;
  const others = input.operation.additions.filter((row) => !isSo2Addition(row));
  if (others.length === 0) return findings;
  const names = others.map((row) => row.name).join(', ');
  const satisfied = hasReason(input.operation.reason);
  findings.push(warnReason(
    'ENO_ADDITION_AFTER_MLF',
    satisfied,
    `La fermentación maloláctica de este lote ya ha terminado. Una adición que no sea SO2 (${names}) exige un motivo.`,
    `La fermentación maloláctica ya ha terminado y la adición que no es SO2 (${names}) tiene motivo.`,
  ));
  return findings;
}

function bottlingFindings(input: CheckOperationInput): CheckFinding[] {
  const process = resolveProcess(input);
  if (input.operation.op_type !== 'bottling' && process !== 'bottling') return [];
  const mode = parameterOf(input.settings, 'bottling_analysis_mode');
  const block = mode.value_text === 'block';
  const days = parameterOf(input.settings, 'pre_bottling_freshness_days');
  const freshness = days.value === null ? 30 : Number(q(days.value).toFixed(0));
  const required = input.settings.required_analysis.filter((row) => row.active);
  const fresh = input.lot.analyses.find((row) => {
    if (!DATE.test(row.sampled_on) || !DATE.test(input.as_of)) return false;
    const age = daysBetween(row.sampled_on, input.as_of);
    return age >= 0 && age <= freshness && required.every((item) => row.parameters.includes(item.parameter_code));
  });
  if (fresh) return [];
  const missing = missingParameters(input, required, freshness);
  const pending = days.pending ? ` (${days.status_label})` : '';
  const detail = missing.length > 0 ? ` Faltan: ${missing.join(', ')}.` : '';
  const message = `El embotellado no tiene una analítica completa y reciente (máximo ${freshness} días${pending}).${detail}`;
  if (block) {
    return [{
      code: 'ENO_BOTTLING_ANALYSIS',
      severity: 'error',
      blocks: true,
      requires_reason: false,
      reason_satisfied: false,
      message,
    }];
  }
  return [{
    code: 'ENO_BOTTLING_ANALYSIS',
    severity: 'warning',
    blocks: false,
    requires_reason: false,
    reason_satisfied: false,
    message,
  }];
}

function volatileFindings(input: CheckOperationInput): CheckFinding[] {
  const raw = input.lot.volatile_acidity_g_l;
  if (raw === null) return [];
  const text = decimalText(raw);
  if (text === null) throw domainError('WC_VALIDATION', { volatile_acidity_g_l: 'Debe ser un número' });
  const value = q(text);
  const alert = parameterOf(input.settings, 'volatile_acidity_alert_g_l');
  if (alert.value === null) return [];
  if (value.lt(alert.value)) return [];
  const legal = parameterOf(input.settings, 'volatile_acidity_legal_max_g_l');
  const legalNote = legal.value === null
    ? ` ${legal.source_ref}`
    : ` El máximo legal de referencia es ${esNum(legal.value)} g/L.`;
  const pending = alert.pending ? ` (${alert.status_label})` : '';
  return [{
    code: 'ENO_VOLATILE_ACIDITY',
    severity: 'warning',
    blocks: false,
    requires_reason: false,
    reason_satisfied: false,
    message: `La acidez volátil es ${esNum(plain(value))} g/L y el umbral de alerta es ${esNum(alert.value)} g/L${pending}. Conviene corregir con SO2 y filtrar con placas amicrobianas V13.${legalNote}`,
  }];
}

function malolacticFinished(input: CheckOperationInput): boolean | null {
  if (input.lot.malolactic_finished !== null) return input.lot.malolactic_finished;
  if (input.lot.malic_acid_g_l === null) return null;
  const text = decimalText(input.lot.malic_acid_g_l);
  if (text === null) throw domainError('WC_VALIDATION', { malic_acid_g_l: 'Debe ser un número' });
  const limit = parameterOf(input.settings, 'malolactic_malic_g_l');
  if (limit.value === null) return null;
  return q(text).lte(limit.value);
}

function prohibitedMatch(settings: SettingsView, text: string): SettingsView['prohibited_practices'][number] | null {
  const folded = fold(text);
  if (folded === '') return null;
  for (const practice of settings.prohibited_practices) {
    if (!practice.active) continue;
    const terms = practice.match_terms.map((term) => fold(term)).filter((term) => term !== '');
    if (terms.some((term) => folded.includes(term))) return practice;
  }
  return null;
}

function missingParameters(
  input: CheckOperationInput,
  required: SettingsView['required_analysis'],
  freshness: number,
): string[] {
  const recent = input.lot.analyses.filter((row) => {
    if (!DATE.test(row.sampled_on)) return false;
    const age = daysBetween(row.sampled_on, input.as_of);
    return age >= 0 && age <= freshness;
  });
  const present = new Set(recent.flatMap((row) => row.parameters));
  if (recent.length === 0) return required.map((row) => row.name_es);
  return required.filter((row) => !present.has(row.parameter_code)).map((row) => row.name_es);
}

function resolveProcess(input: CheckOperationInput): CellarProcess | null {
  return processOf(input.operation.op_type, input.operation.process);
}

function percent(loss: ReturnType<typeof q>, input: ReturnType<typeof q>): string {
  if (input.isZero()) return '0.00';
  return fixed(loss.div(input).mul(100), 2);
}

function hasReason(reason: string | null): boolean {
  return reason !== null && reason.trim().length >= 3;
}

function warnReason(code: string, satisfied: boolean, missing: string, present: string): CheckFinding {
  return {
    code,
    severity: satisfied ? 'info' : 'warning',
    blocks: false,
    requires_reason: true,
    reason_satisfied: satisfied,
    message: satisfied ? present : missing,
  };
}

function info(code: string, message: string): CheckFinding {
  return {
    code,
    severity: 'info',
    blocks: false,
    requires_reason: false,
    reason_satisfied: false,
    message,
  };
}

function monthParam(settings: SettingsView, code: string): number {
  const row = parameterOf(settings, code);
  if (row.value === null) throw new Error(`Falta el mes ${code}`);
  return Number(q(row.value).toFixed(0));
}

function inWindow(day: string, from: number, to: number): boolean {
  const month = Number(day.slice(5, 7));
  if (!Number.isInteger(month)) return false;
  if (from <= to) return month >= from && month <= to;
  return month >= from || month <= to;
}

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function assertProcessState(process: string, state: string): void {
  if (!isProcess(process) || !isProductState(state)) {
    throw domainError('WC_VALIDATION', { process: 'Proceso o estado no válido' });
  }
}
