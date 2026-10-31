import { sql } from '../db/sql';
import { addDays, insideSafetyInterval, safetyEndsOn } from './dates';
import { asCivilDate, asInt, uuidText, type NotebookWarning } from './rows';

export type SqlRead = <T = Record<string, unknown>>(statement: string) => Promise<T[]>;

export interface WarningSubject {
  id: string;
  parcel_id: string;
  parcel_code: string;
  applied_on: string;
  safety_interval_days: number | null;
}

interface HarvestRow {
  parcel_id: string;
  harvested_on: string;
}

interface MaturityRow {
  parcel_id: string;
  planned_on: string;
}

export async function warningsByTreatment(read: SqlRead, subjects: readonly WarningSubject[]): Promise<Map<string, NotebookWarning[]>> {
  const grouped = new Map<string, NotebookWarning[]>();
  for (const subject of subjects) grouped.set(subject.id, []);
  const interesting = subjects.filter((subject) => (subject.safety_interval_days ?? 0) > 0);
  if (interesting.length === 0) return grouped;
  const parcelIds = [...new Set(interesting.map((subject) => subject.parcel_id))];
  const list = parcelIds.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const harvests = await read<Record<string, unknown>>(`
    SELECT parcel_id, harvested_on
    FROM vineyard.harvest
    WHERE parcel_id IN (${list})
  `);
  const checks = await read<Record<string, unknown>>(`
    SELECT parcel_id, checked_at, estimated_days_to_harvest
    FROM vineyard.maturity_check
    WHERE parcel_id IN (${list})
      AND estimated_days_to_harvest IS NOT NULL
  `);
  const harvestRows = harvests.map(toHarvest).filter((row): row is HarvestRow => row !== null);
  const maturityRows = checks.map(toMaturity).filter((row): row is MaturityRow => row !== null);
  for (const subject of interesting) {
    const days = subject.safety_interval_days ?? 0;
    const end = safetyEndsOn(subject.applied_on, days);
    const warnings: NotebookWarning[] = [];
    for (const harvest of harvestRows) {
      if (harvest.parcel_id !== subject.parcel_id) continue;
      if (!insideSafetyInterval(harvest.harvested_on, subject.applied_on, days)) continue;
      warnings.push(warning(subject, 'SAFETY_INTERVAL', 'harvest', harvest.harvested_on, days, end));
    }
    for (const plan of maturityRows) {
      if (plan.parcel_id !== subject.parcel_id) continue;
      if (!insideSafetyInterval(plan.planned_on, subject.applied_on, days)) continue;
      warnings.push(warning(subject, 'PLANNED_HARVEST', 'maturity', plan.planned_on, days, end));
    }
    warnings.sort((left, right) => left.event_on.localeCompare(right.event_on) || left.code.localeCompare(right.code));
    grouped.set(subject.id, warnings);
  }
  return grouped;
}

function warning(
  subject: WarningSubject,
  code: NotebookWarning['code'],
  source: NotebookWarning['source'],
  eventOn: string,
  days: number,
  end: string,
): NotebookWarning {
  const lead = source === 'harvest'
    ? `La vendimia del ${eventOn}`
    : `La vendimia prevista el ${eventOn} (control de maduración)`;
  return {
    code,
    source,
    message: `${lead} cae dentro del plazo de seguridad (${days} días desde el ${subject.applied_on}, se puede vendimiar a partir del ${end}).`,
    parcel_id: subject.parcel_id,
    parcel_code: subject.parcel_code,
    event_on: eventOn,
    safety_interval_days: days,
    interval_ends_on: end,
  };
}

function toHarvest(row: Record<string, unknown>): HarvestRow | null {
  const harvested = asCivilDate(row.harvested_on);
  if (!harvested) return null;
  return { parcel_id: uuidText(row.parcel_id), harvested_on: harvested };
}

function toMaturity(row: Record<string, unknown>): MaturityRow | null {
  const checked = asCivilDate(row.checked_at);
  const days = asInt(row.estimated_days_to_harvest);
  if (!checked || days == null) return null;
  return { parcel_id: uuidText(row.parcel_id), planned_on: addDays(checked, days) };
}
