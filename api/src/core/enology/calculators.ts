import { domainError } from '../errors';
import {
  ALLERGEN_TOTAL_SO2_MG_L,
  COLD_SOURCE,
  EU_SUGAR_FACTOR,
  KMS_SO2_PERCENT,
  SO2_PKA,
  SUGAR_LABEL,
  parameterOf,
  so2LimitOf,
} from './defaults';
import { decimalText, esNum, fixed, max0, plain, q, round, zero } from './qty';
import { type SettingsView, type SugarBand, type Warning, type WineColor } from './types';

const WINE: Record<string, WineColor> = {
  tinto: 'tinto',
  red: 'tinto',
  blanco: 'blanco',
  white: 'blanco',
  rosado: 'rosado',
  rose: 'rosado',
};

export interface So2Result {
  formula: string;
  pka: { value: string; basis: 'hecho'; status_label: 'hecho'; source_ref: string };
  molecular_target: {
    code: string;
    value: string;
    basis: string;
    status_label: string;
    source_ref: string;
    overridden: boolean;
  };
  free_so2_needed_mg_l: string;
  free_so2_to_add_mg_l: string;
  dose_withheld: boolean;
  product: {
    kind: 'potassium_metabisulfite' | 'solution';
    so2_percent: string;
    so2_percent_basis: 'hecho' | 'indicado';
    concentration: 'g/100 mL' | 'porcentaje teórico';
    quantity: string;
    unit: 'g' | 'ml';
  };
  resulting_total_so2_mg_l: string | null;
  limits: {
    wine_type: WineColor;
    sugar_band: SugarBand | null;
    sugar_label: string | null;
    organic: LimitSide;
    legal: LimitSide;
  };
  warnings: Warning[];
}

interface LimitSide {
  limit_mg_l: string | null;
  basis: string | null;
  status_label: string | null;
  source_ref: string | null;
  note: string | null;
}

export interface ColdResult {
  formula: string;
  basis: 'hecho';
  source_ref: string;
  alcohol_pct: string;
  temperature_c: string;
}

export interface AlcoholResult {
  from_sugars: {
    sugars_g_l: string;
    factor: string;
    factor_basis: 'hecho';
    source_ref: string;
    alcohol_pct: string;
  } | null;
  from_density: {
    density_g_l: string;
    factor: string;
    factor_basis: string;
    factor_status_label: string;
    source_ref: string;
    alcohol_pct: string;
  } | null;
  warnings: Warning[];
}

export interface BlendComponentResult {
  label: string | null;
  vessel_id: string | null;
  lot_id: string | null;
  pipette_ml: string;
  percent: string;
  volume_ml: string;
  volume_l: string;
  available_ml: string | null;
  sufficient: boolean | null;
}

export interface BlendResult {
  target_volume_l: string;
  target_volume_ml: string;
  rounding: string;
  components: BlendComponentResult[];
  warnings: Warning[];
}

export interface BlendComponentInput {
  label: string | null;
  volume_ml: string;
  vessel_id: string | null;
  lot_id: string | null;
  /** null: no se ha consultado el saldo. */
  available_ml: string | null;
}

/**
 * SO2 libre necesario = objetivo molecular × (1 + 10^(pH − 1,81)).
 * El % de una solución es g de SO2 por 100 mL (p/v).
 */
export function calculateSo2(body: Record<string, unknown>, settings: SettingsView): So2Result {
  const fields: Record<string, string> = {};
  const ph = requiredDecimal(body.ph, 'ph', fields);
  const free = requiredDecimal(body.free_so2_mg_l, 'free_so2_mg_l', fields);
  const volume = requiredDecimal(body.volume_l, 'volume_l', fields);
  const wine = wineOf(body.wine_type, fields);
  const product = productOf(body.product, fields);
  const targetOverride = optionalDecimal(body.molecular_target_mg_l, 'molecular_target_mg_l', fields);
  const total = optionalDecimal(body.total_so2_mg_l, 'total_so2_mg_l', fields);
  const sugar = optionalDecimal(body.residual_sugar_g_l, 'residual_sugar_g_l', fields);
  const noSulfites = boolField(body.no_added_sulfites, 'no_added_sulfites', fields);
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  if (!ph || !free || !volume || !wine || !product) throw domainError('WC_VALIDATION', fields);

  if (ph.lte(0) || ph.gte(14)) fields.ph = 'El pH tiene que estar entre 0 y 14';
  if (free.isNeg()) fields.free_so2_mg_l = 'El SO2 libre no puede ser negativo';
  if (volume.lte(0)) fields.volume_l = 'El volumen tiene que ser mayor que cero';
  if (total?.isNeg()) fields.total_so2_mg_l = 'El SO2 total no puede ser negativo';
  if (sugar?.isNeg()) fields.residual_sugar_g_l = 'El azúcar no puede ser negativo';
  if (targetOverride && (targetOverride.lte(0) || targetOverride.gt(5))) {
    fields.molecular_target_mg_l = 'El objetivo molecular tiene que estar entre 0 y 5 mg/L';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);

  const code = molecularCode(wine);
  const configured = parameterOf(settings, code);
  if (configured.value === null) throw new Error(`Falta el objetivo molecular ${code}`);
  const target = targetOverride ?? q(configured.value);
  const needed = target.mul(q('1').plus(q('10').pow(ph.minus(q(SO2_PKA)))));
  const gap = max0(needed.minus(free));
  const toAdd = round(gap, 2);
  const applied = noSulfites ? zero() : toAdd;
  const quantity = productQuantity(applied, volume, product.percent);
  const band = sugar ? sugarBand(sugar) : null;
  const organic = band ? so2LimitOf(settings, 'organic', wine, band) : null;
  const legal = band ? so2LimitOf(settings, 'legal', wine, band) : null;
  const resulting = total ? fixed(total.plus(applied), 2) : null;
  const warnings: Warning[] = [];

  if (ph.lt('2.5') || ph.gt('4.5')) {
    warnings.push({
      code: 'ENO_PH_RANGE',
      severity: 'info',
      message: `El pH ${esNum(plain(ph))} está fuera del rango habitual de vino (2,5–4,5).`,
    });
  }
  if (noSulfites) {
    warnings.push({
      code: 'ENO_NO_ADDED_SULFITES',
      severity: 'warning',
      message: 'El lote está marcado como sin sulfitos añadidos: no se propone dosis.',
    });
    const compared = total ?? null;
    if (compared && compared.gt(ALLERGEN_TOTAL_SO2_MG_L)) {
      warnings.push({
        code: 'ENO_SULFITE_ALLERGEN',
        severity: 'info',
        message: 'Aunque no se añadan sulfitos, si el SO2 total supera 10 mg/L la etiqueta debe decir «contiene sulfitos».',
      });
    }
  }
  if (!sugar) {
    warnings.push({
      code: 'ENO_SO2_SUGAR_MISSING',
      severity: 'info',
      message: 'Sin azúcar residual no se elige la banda del límite de SO2 total, así que no se compara.',
    });
  }
  if (total === null) {
    warnings.push({
      code: 'ENO_SO2_TOTAL_MISSING',
      severity: 'info',
      message: 'Sin el SO2 total actual no se puede proyectar el total resultante.',
    });
  }
  if (resulting && organic) warnLimit(warnings, 'organic', resulting, organic, wine, band);
  if (resulting && legal) warnLimit(warnings, 'legal', resulting, legal, wine, band);
  if (band && !organic) {
    warnings.push({
      code: 'ENO_SO2_ORGANIC_UNKNOWN',
      severity: 'info',
      message: 'No hay límite ecológico configurado para esta categoría.',
    });
  }

  return {
    formula: 'libre_necesario = objetivo_molecular * (1 + 10^(pH - 1.81))',
    pka: {
      value: SO2_PKA,
      basis: 'hecho',
      status_label: 'hecho',
      source_ref: 'FACT: pKa del SO2 molecular 1,81 a 20 C.',
    },
    molecular_target: {
      code,
      value: plain(target),
      basis: targetOverride ? 'indicado' : configured.basis,
      status_label: targetOverride ? 'indicado en la petición' : configured.status_label,
      source_ref: configured.source_ref,
      overridden: targetOverride !== null,
    },
    free_so2_needed_mg_l: fixed(needed, 2),
    free_so2_to_add_mg_l: fixed(applied, 2),
    dose_withheld: noSulfites,
    product: {
      kind: product.kind,
      so2_percent: plain(product.percent),
      so2_percent_basis: product.kind === 'potassium_metabisulfite' ? 'hecho' : 'indicado',
      concentration: product.kind === 'potassium_metabisulfite' ? 'porcentaje teórico' : 'g/100 mL',
      quantity: fixed(quantity, 3),
      unit: product.kind === 'potassium_metabisulfite' ? 'g' : 'ml',
    },
    resulting_total_so2_mg_l: resulting,
    limits: {
      wine_type: wine,
      sugar_band: band,
      sugar_label: band ? SUGAR_LABEL[band] : null,
      organic: side(organic),
      legal: side(legal),
    },
    warnings,
  };
}

export function calculateCold(body: Record<string, unknown>): ColdResult {
  const fields: Record<string, string> = {};
  const alcohol = requiredDecimal(body.alcohol_pct, 'alcohol_pct', fields);
  if (!alcohol || Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  if (alcohol.isNeg() || alcohol.gt(25)) {
    throw domainError('WC_VALIDATION', { alcohol_pct: 'El grado tiene que estar entre 0 y 25 % vol' });
  }
  const temperature = alcohol.div(2).plus(1).neg();
  return {
    formula: 'T = -(grado / 2 + 1)',
    basis: 'hecho',
    source_ref: COLD_SOURCE,
    alcohol_pct: plain(alcohol),
    temperature_c: formatTemperature(temperature),
  };
}

export function calculateProbableAlcohol(body: Record<string, unknown>, settings: SettingsView): AlcoholResult {
  const fields: Record<string, string> = {};
  const sugars = optionalDecimal(body.sugars_g_l, 'sugars_g_l', fields);
  const density = optionalDecimal(body.density_g_l, 'density_g_l', fields);
  if (sugars === null && density === null && Object.keys(fields).length === 0) {
    fields.body = 'Indica sugars_g_l o density_g_l';
  }
  if (sugars?.isNeg() || (sugars && sugars.gt(500))) fields.sugars_g_l = 'Los azúcares tienen que estar entre 0 y 500 g/L';
  if (density && (density.lt(900) || density.gt(1200))) {
    fields.density_g_l = 'La densidad tiene que estar entre 900 y 1200 g/L';
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);

  const factorRow = parameterOf(settings, 'density_alcohol_factor');
  if (factorRow.value === null) throw new Error('Falta el factor de densidad');
  const factor = q(factorRow.value);
  const warnings: Warning[] = [];
  let fromDensity: AlcoholResult['from_density'] = null;
  if (density) {
    const alcohol = density.minus(1000).div(factor);
    if (alcohol.isNeg()) {
      warnings.push({
        code: 'ENO_DENSITY_BELOW_1000',
        severity: 'info',
        message: 'La densidad es inferior a 1000 g/L y el grado probable sale negativo. La fórmula es para mosto.',
      });
    }
    fromDensity = {
      density_g_l: plain(density),
      factor: plain(factor),
      factor_basis: factorRow.basis,
      factor_status_label: factorRow.status_label,
      source_ref: factorRow.source_ref,
      alcohol_pct: fixed(alcohol, 2),
    };
  }
  return {
    from_sugars: sugars
      ? {
          sugars_g_l: plain(sugars),
          factor: EU_SUGAR_FACTOR,
          factor_basis: 'hecho',
          source_ref: 'FACT: factor UE, grado probable = azúcares g/L / 16,83.',
          alcohol_pct: fixed(sugars.div(q(EU_SUGAR_FACTOR)), 2),
        }
      : null,
    from_density: fromDensity,
    warnings,
  };
}

/**
 * Reparte el volumen objetivo según los mL de la pipeta.
 * Cada parte se redondea al mL (HALF_UP) y el residuo se aplica a la mayor
 * (la primera, si empatan). Los porcentajes, a 2 decimales, suman 100.
 */
export function calculateBlend(components: readonly BlendComponentInput[], targetVolumeL: string): BlendResult {
  if (components.length < 2 || components.length > 12) {
    throw domainError('WC_VALIDATION', { components: 'Hacen falta de 2 a 12 componentes' });
  }
  const target = q(targetVolumeL);
  if (target.lte(0) || target.gt('1000000')) {
    throw domainError('WC_VALIDATION', { target_volume_l: 'El volumen objetivo no es válido' });
  }
  const pipettes = components.map((row, index) => {
    const text = decimalText(row.volume_ml);
    if (text === null) {
      throw domainError('WC_VALIDATION', { [`components.${index}.volume_ml`]: 'Debe ser un número' });
    }
    const value = q(text);
    if (value.lte(0)) {
      throw domainError('WC_VALIDATION', { [`components.${index}.volume_ml`]: 'Tiene que ser mayor que cero' });
    }
    return value;
  });
  const targetMl = round(target.mul(1000), 0);
  const shares = apportion(pipettes, targetMl, 0);
  const percents = apportion(pipettes, q('100'), 2);
  const warnings: Warning[] = [];
  const rows: BlendComponentResult[] = components.map((row, index) => {
    const share = shares[index] ?? zero();
    const percent = percents[index] ?? zero();
    const available = row.available_ml === null ? null : q(row.available_ml);
    let sufficient: boolean | null = null;
    if (available) {
      sufficient = available.gte(share);
      if (!sufficient) {
        const name = row.label ?? `componente ${index + 1}`;
        warnings.push({
          code: 'ENO_BLEND_SHORT',
          severity: 'warning',
          message: `${name} no tiene volumen suficiente: hay ${esNum(fixed(available, 0))} mL y hacen falta ${esNum(fixed(share, 0))} mL.`,
        });
      }
    }
    return {
      label: row.label,
      vessel_id: row.vessel_id,
      lot_id: row.lot_id,
      pipette_ml: plain(pipettes[index] ?? zero()),
      percent: fixed(percent, 2),
      volume_ml: fixed(share, 0),
      volume_l: fixed(share.div(1000), 3),
      available_ml: available ? fixed(available, 0) : null,
      sufficient,
    };
  });
  return {
    target_volume_l: fixed(target, 3),
    target_volume_ml: fixed(targetMl, 0),
    rounding: 'Cada parte se redondea al mL (HALF_UP) y el residuo se suma a la mayor; si empatan, a la primera. Los porcentajes a 2 decimales se ajustan igual para sumar 100.',
    components: rows,
    warnings,
  };
}

export function sugarBand(sugar: ReturnType<typeof q>): SugarBand {
  if (sugar.lt(2)) return 'lt_2';
  if (sugar.lte(5)) return 'from_2_to_5';
  return 'gte_5';
}

export function wineOf(value: unknown, fields: Record<string, string>): WineColor | null {
  if (typeof value !== 'string') {
    fields.wine_type = 'Indica tinto, blanco o rosado';
    return null;
  }
  const wine = WINE[value.trim().toLowerCase()];
  if (!wine) fields.wine_type = 'Indica tinto, blanco o rosado';
  return wine ?? null;
}

function molecularCode(wine: WineColor): string {
  if (wine === 'tinto') return 'molecular_so2_tinto_mg_l';
  if (wine === 'blanco') return 'molecular_so2_blanco_mg_l';
  return 'molecular_so2_rosado_mg_l';
}

function productOf(
  value: unknown,
  fields: Record<string, string>,
): { kind: 'potassium_metabisulfite' | 'solution'; percent: ReturnType<typeof q> } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fields.product = 'Indica el producto';
    return null;
  }
  const body = value as Record<string, unknown>;
  const kind = body.kind;
  if (kind === 'potassium_metabisulfite') return { kind, percent: q(KMS_SO2_PERCENT) };
  if (kind === 'solution') {
    const percent = decimalText(body.so2_percent);
    if (percent === null) {
      fields['product.so2_percent'] = 'Indica el porcentaje de SO2 de la solución';
      return null;
    }
    const valuePct = q(percent);
    if (valuePct.lte(0) || valuePct.gt(100)) {
      fields['product.so2_percent'] = 'El porcentaje tiene que estar entre 0 y 100';
      return null;
    }
    return { kind, percent: valuePct };
  }
  fields['product.kind'] = 'Usa potassium_metabisulfite o solution';
  return null;
}

function productQuantity(
  toAddMgL: ReturnType<typeof q>,
  volumeL: ReturnType<typeof q>,
  percent: ReturnType<typeof q>,
): ReturnType<typeof q> {
  if (toAddMgL.isZero()) return zero();
  return toAddMgL.mul(volumeL).div(percent.mul(10));
}

function warnLimit(
  warnings: Warning[],
  scope: 'organic' | 'legal',
  resulting: string,
  limit: NonNullable<ReturnType<typeof so2LimitOf>>,
  wine: WineColor,
  band: SugarBand | null,
): void {
  const label = scope === 'organic' ? 'ecológico' : 'legal';
  if (limit.limit_mg_l === null) {
    warnings.push({
      code: scope === 'organic' ? 'ENO_SO2_ORGANIC_UNKNOWN' : 'ENO_SO2_LEGAL_UNKNOWN',
      severity: 'info',
      message: limit.note ?? 'El documento no da la cifra de este límite.',
    });
    return;
  }
  if (q(resulting).gt(limit.limit_mg_l)) {
    const pending = limit.pending ? `, ${limit.status_label}` : '';
    warnings.push({
      code: scope === 'organic' ? 'ENO_SO2_ORGANIC_OVER' : 'ENO_SO2_LEGAL_OVER',
      severity: 'warning',
      message: `El SO2 total resultante (${esNum(resulting)} mg/L) supera el límite ${label} de ${esNum(limit.limit_mg_l)} mg/L${pending} para ${wine}${band ? ` con ${SUGAR_LABEL[band]}` : ''}.`,
    });
  }
}

function side(limit: ReturnType<typeof so2LimitOf>): LimitSide {
  if (!limit) {
    return { limit_mg_l: null, basis: null, status_label: null, source_ref: null, note: null };
  }
  return {
    limit_mg_l: limit.limit_mg_l,
    basis: limit.basis,
    status_label: limit.status_label,
    source_ref: limit.source_ref,
    note: limit.note,
  };
}

function apportion(parts: readonly ReturnType<typeof q>[], total: ReturnType<typeof q>, places: number): ReturnType<typeof q>[] {
  const sum = parts.reduce((acc, part) => acc.plus(part), zero());
  if (sum.lte(0)) throw domainError('WC_VALIDATION', { components: 'La suma de la pipeta es cero' });
  const raw = parts.map((part) => part.div(sum).mul(total));
  const rounded = raw.map((part) => round(part, places));
  let drift = total.minus(rounded.reduce((acc, part) => acc.plus(part), zero()));
  if (!drift.isZero()) {
    let index = 0;
    for (let cursor = 1; cursor < raw.length; cursor += 1) {
      const current = raw[cursor];
      const best = raw[index];
      if (current && best && current.gt(best)) index = cursor;
    }
    const chosen = rounded[index];
    if (!chosen) throw domainError('WC_VALIDATION', { components: 'No se ha podido redondear' });
    const adjusted = chosen.plus(drift);
    if (adjusted.isNeg()) {
      throw domainError('WC_VALIDATION', { components: 'El redondeo dejaría una parte negativa' });
    }
    rounded[index] = adjusted;
  }
  return rounded;
}

function formatTemperature(value: ReturnType<typeof q>): string {
  const rounded = round(value, 2);
  const text = rounded.toFixed(2);
  if (text.endsWith('0')) return rounded.toFixed(1);
  return text;
}

function requiredDecimal(value: unknown, field: string, fields: Record<string, string>) {
  const text = decimalText(value);
  if (text === null) {
    fields[field] = 'Debe ser un número';
    return null;
  }
  return q(text);
}

function optionalDecimal(value: unknown, field: string, fields: Record<string, string>) {
  if (value === undefined || value === null || value === '') return null;
  return requiredDecimal(value, field, fields);
}

function boolField(value: unknown, field: string, fields: Record<string, string>): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  fields[field] = 'Debe ser verdadero o falso';
  return false;
}
