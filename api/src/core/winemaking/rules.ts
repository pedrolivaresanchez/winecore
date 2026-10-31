import { money } from '../money';

/** Umbrales de docs/07-arquitectura.md (`cellar.alerts.*`) y de §9.3. */
export interface AlertThresholds {
  /** Caída mínima de densidad en la ventana. Defecto 0,002. */
  minDensityDrop: number;
  /** Horas de la ventana de fermentación parada. Defecto 48. */
  windowHours: number;
  /** Horas sin bajada de densidad. Defecto 48. */
  stallHours: number;
  /** Por debajo de esta densidad la fermentación se da por terminada. Defecto 0,995. */
  dryDensity: number;
  tempMin: number;
  tempMax: number;
}

export const DEFAULT_ALERTS: AlertThresholds = {
  minDensityDrop: 0.002,
  windowHours: 48,
  stallHours: 48,
  dryDensity: 0.995,
  tempMin: 10,
  tempMax: 30,
};

export type AlertRule = 'stuck' | 'temperature' | 'density_stall';

export interface ReadingPoint {
  at: string;
  density: number | null;
  temperatureC: number | null;
}

export interface AlertHit {
  rule: AlertRule;
  at: string;
}

const DENSITY_SCALE = 10_000;

/**
 * Reglas sobre una serie ya ordenada o no. Se evalúa el último punto:
 * - `stuck`: la densidad no baja al menos `minDensityDrop` en `windowHours` y aún está por encima de `dryDensity`.
 * - `density_stall`: la densidad no baja (delta ≤ 0) en `stallHours` y aún está por encima de `dryDensity`.
 * - `temperature`: la última temperatura queda fuera de [tempMin, tempMax].
 * Una bajada exacta del umbral no dispara `stuck`. Llegar a `dryDensity` cierra las reglas de densidad.
 */
export function evaluateFermentationAlerts(
  points: readonly ReadingPoint[],
  thresholds: AlertThresholds = DEFAULT_ALERTS,
): AlertHit[] {
  const series = points
    .filter((point) => Number.isFinite(Date.parse(point.at)))
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = series.at(-1);
  if (latest === undefined) return [];
  const hits: AlertHit[] = [];
  const densityNow = latestDensity(series);
  if (densityNow !== null && units(densityNow.density) > units(thresholds.dryDensity)) {
    const stuckBase = baseline(series, densityNow.at, thresholds.windowHours);
    if (stuckBase !== null) {
      const drop = units(stuckBase.density) - units(densityNow.density);
      if (drop < units(thresholds.minDensityDrop)) {
        hits.push({ rule: 'stuck', at: densityNow.at });
      }
    }
    const stallBase = baseline(series, densityNow.at, thresholds.stallHours);
    if (stallBase !== null) {
      const drop = units(stallBase.density) - units(densityNow.density);
      if (drop <= 0) hits.push({ rule: 'density_stall', at: densityNow.at });
    }
  }
  if (latest.temperatureC !== null && Number.isFinite(latest.temperatureC)) {
    const tenths = Math.round(latest.temperatureC * 10);
    const min = Math.round(thresholds.tempMin * 10);
    const max = Math.round(thresholds.tempMax * 10);
    if (tenths < min || tenths > max) hits.push({ rule: 'temperature', at: latest.at });
  }
  return hits;
}

export function parseAlertSettings(values: ReadonlyMap<string, unknown>): AlertThresholds {
  const drop = decimalSetting(values.get('cellar.alerts.min_density_drop_48h'), DEFAULT_ALERTS.minDensityDrop);
  const windowHours = intSetting(values.get('cellar.alerts.density_window_hours'), DEFAULT_ALERTS.windowHours);
  const stallHours = intSetting(values.get('cellar.alerts.stall_hours'), DEFAULT_ALERTS.stallHours);
  const dry = decimalSetting(values.get('cellar.alerts.dry_density'), DEFAULT_ALERTS.dryDensity);
  const range = values.get('cellar.alerts.temperature_range_c');
  let tempMin = DEFAULT_ALERTS.tempMin;
  let tempMax = DEFAULT_ALERTS.tempMax;
  if (Array.isArray(range) && range.length === 2) {
    const min = numberOrNull(range[0]);
    const max = numberOrNull(range[1]);
    if (min !== null && max !== null && min < max) {
      tempMin = min;
      tempMax = max;
    }
  }
  return {
    minDensityDrop: drop,
    windowHours,
    stallHours,
    dryDensity: dry,
    tempMin,
    tempMax,
  };
}

export interface Bound {
  min: string | null;
  max: string | null;
}

/** Fuera del rango físico del catálogo: el valor se rechaza. */
export function outsidePhysical(value: string, bound: Bound): 'low' | 'high' | null {
  const current = money.fromString(value);
  if (bound.min !== null && current.lt(money.fromString(bound.min))) return 'low';
  if (bound.max !== null && current.gt(money.fromString(bound.max))) return 'high';
  return null;
}

/** Fuera del límite de la categoría: el valor se guarda y se marca. */
export function outsideLimit(value: string, bound: Bound): 'min' | 'max' | null {
  const current = money.fromString(value);
  if (bound.min !== null && current.lt(money.fromString(bound.min))) return 'min';
  if (bound.max !== null && current.gt(money.fromString(bound.max))) return 'max';
  return null;
}

/** Banda de SO₂ ecológico según el azúcar residual (g/L). Sin azúcar se trata como seco. */
export function sugarBand(glucoseFructose: string | null): 'dry' | 'mid' | 'high' {
  if (glucoseFructose === null) return 'dry';
  const sugar = money.fromString(glucoseFructose);
  if (sugar.lt(money.fromString('2'))) return 'dry';
  if (sugar.lt(money.fromString('5'))) return 'mid';
  return 'high';
}

export function organicCategory(color: string, band: 'dry' | 'mid' | 'high'): string | null {
  const colour = color === 'red' || color === 'white' || color === 'rose' ? color : null;
  if (colour === null || band === 'high') return null;
  return `organic_${colour}_${band}`;
}

function latestDensity(series: readonly ReadingPoint[]): { at: string; density: number } | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    if (point !== undefined && point.density !== null && Number.isFinite(point.density)) {
      return { at: point.at, density: point.density };
    }
  }
  return null;
}

function baseline(
  series: readonly ReadingPoint[],
  at: string,
  hours: number,
): { at: string; density: number } | null {
  const cutoff = Date.parse(at) - hours * 3_600_000;
  if (!Number.isFinite(cutoff)) return null;
  let found: { at: string; density: number } | null = null;
  for (const point of series) {
    if (point.density === null || !Number.isFinite(point.density)) continue;
    if (Date.parse(point.at) <= cutoff) found = { at: point.at, density: point.density };
  }
  return found;
}

function units(value: number): number {
  return Math.round(value * DENSITY_SCALE);
}

function decimalSetting(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function intSetting(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = money.fromString(value.trim());
      const asNumber = parsed.toNumber();
      return Number.isFinite(asNumber) ? asNumber : null;
    } catch {
      return null;
    }
  }
  return null;
}
