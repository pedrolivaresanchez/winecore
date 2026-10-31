import { isUuid } from '../catalog/fields';
import { uuidList } from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { instantToCivil } from './dates';
import { traceLotParcels } from './genealogy';
import {
  asCivil,
  asNum,
  asRecord,
  asText,
  columnSet,
  roundTo,
  tableExists,
  type SqlReader,
} from './rows';

const ANALYSIS_KEYS = [
  'abv',
  'total_acidity',
  'ph',
  'free_so2',
  'total_so2',
  'volatile_acidity',
  'total_polyphenol_index',
] as const;

const SCORE_COLUMNS = ['score', 'overall_score', 'points', 'rating', 'overall', 'puntuacion'];

type AnalysisKey = (typeof ANALYSIS_KEYS)[number];
type Analyses = Record<AnalysisKey, number | null>;

export interface VintageFilter {
  parcelId: string | null;
  wineId: string | null;
  fromVintage: number | null;
  toVintage: number | null;
}

interface Ripeness {
  checked_at: string | null;
  probable_abv: number | null;
  total_acidity: number | null;
  sanitary_status: string | null;
  sensory_notes: string | null;
}

export interface VintageMetrics {
  vintage: number;
  harvest_date: string | null;
  kg: number | null;
  yield_kg_ha: number | null;
  varieties: string[];
  ripeness: Ripeness[];
  intake_sanitary_notes: string | null;
  analyses: Analyses | null;
  tasting_score: number | null;
  tasting_count: number;
  weather_notes: string | null;
}

export interface VintageReport {
  missing: string[];
  filter: {
    parcel_id: string | null;
    wine_id: string | null;
    vintage_from: number | null;
    vintage_to: number | null;
  };
  by_parcel: Array<{
    parcel_id: string;
    code: string;
    name: string;
    area_ha: number | null;
    vintages: VintageMetrics[];
  }>;
  by_wine: Array<{
    wine_id: string;
    code: string;
    name: string;
    vintages: VintageMetrics[];
  }>;
}

interface HarvestRow {
  id: string;
  parcelId: string;
  vintage: number;
  harvestedOn: string | null;
  variety: string | null;
  estimatedKg: number | null;
  receptionId: string | null;
  notes: string | null;
}

interface LotInfo {
  id: string;
  vintage: number | null;
  referenceId: string | null;
  parcelIds: string[];
}

interface TastingNote {
  lotId: string | null;
  wineId: string | null;
  vintage: number | null;
  score: number;
}

function emptyAnalyses(): Analyses {
  return {
    abv: null,
    total_acidity: null,
    ph: null,
    free_so2: null,
    total_so2: null,
    volatile_acidity: null,
    total_polyphenol_index: null,
  };
}

function vintageOk(vintage: number, filter: VintageFilter): boolean {
  if (filter.fromVintage != null && vintage < filter.fromVintage) return false;
  if (filter.toVintage != null && vintage > filter.toVintage) return false;
  return true;
}

function yearOf(value: unknown): number | null {
  const civil = instantToCivil(value) ?? asCivil(value);
  if (!civil) return null;
  const year = Number(civil.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function weatherText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const record = asRecord(value);
  for (const key of ['note', 'notes', 'summary', 'text', 'description']) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  return null;
}

function sanitaryFromDetails(details: unknown): string | null {
  const record = asRecord(details);
  const raw = record.sanitary_notes ?? record.sanitary;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function joinUnique(values: readonly (string | null)[], separator: string): string | null {
  const unique = [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
  return unique.length === 0 ? null : unique.join(separator);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return roundTo(sum / values.length, 1);
}

async function loadTastings(reader: SqlReader, missing: string[]): Promise<TastingNote[]> {
  const tables = await reader.read<{ table_schema: string; table_name: string }>(sql`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE lower(table_name) LIKE '%tasting%'
      AND table_schema NOT IN ('information_schema', 'pg_catalog', 'main')
  `);
  const notes: TastingNote[] = [];
  let scored = false;
  for (const table of tables) {
    const schema = String(table.table_schema);
    const name = String(table.table_name);
    if (!/^[a-z_][a-z0-9_]*$/.test(schema) || !/^[a-z_][a-z0-9_]*$/.test(name)) continue;
    const columns = await columnSet(reader, schema, name);
    const score = SCORE_COLUMNS.find((column) => columns.has(column));
    if (!score) continue;
    scored = true;
    const lotSql = columns.has('lot_id') ? 'lot_id::VARCHAR' : 'NULL';
    const wineSql = columns.has('wine_id') ? 'wine_id::VARCHAR' : 'NULL';
    const vintageSql = columns.has('vintage') ? 'vintage::VARCHAR' : 'NULL';
    const rows = await reader.read<Record<string, unknown>>(`
      SELECT ${lotSql} AS lot_id, ${wineSql} AS wine_id, ${vintageSql} AS vintage, ${score}::VARCHAR AS score
      FROM ${schema}.${name}
      WHERE ${score} IS NOT NULL
    `);
    for (const row of rows) {
      const value = asNum(row.score);
      if (value == null) continue;
      notes.push({
        lotId: asText(row.lot_id)?.toLowerCase() ?? null,
        wineId: asText(row.wine_id)?.toLowerCase() ?? null,
        vintage: asNum(row.vintage) == null ? null : Math.trunc(asNum(row.vintage) ?? 0),
        score: value,
      });
    }
  }
  if (!scored) missing.push('tasting.score');
  return notes;
}

function scoresFor(
  notes: readonly TastingNote[],
  lotIds: ReadonlySet<string>,
  wineIds: ReadonlySet<string>,
  vintage: number,
): number[] {
  const values: number[] = [];
  for (const note of notes) {
    if (note.lotId && lotIds.has(note.lotId)) values.push(note.score);
    else if (!note.lotId && note.wineId && wineIds.has(note.wineId) && (note.vintage == null || note.vintage === vintage)) {
      values.push(note.score);
    }
  }
  return values;
}

function analysesFor(
  samples: Map<string, Map<string, { at: string; value: number }>>,
  lotIds: readonly string[],
  enabled: boolean,
): Analyses | null {
  if (!enabled) return null;
  const out = emptyAnalyses();
  for (const key of ANALYSIS_KEYS) {
    let best: { at: string; value: number } | null = null;
    for (const lotId of lotIds) {
      const sample = samples.get(lotId)?.get(key);
      if (!sample) continue;
      if (!best || sample.at > best.at) best = sample;
    }
    out[key] = best?.value ?? null;
  }
  return out;
}

function metricsOf(input: {
  vintage: number;
  harvests: readonly HarvestRow[];
  areaHa: number | null;
  checks: readonly { parcelId: string; checkedAt: unknown; probableAbv: number | null; acidity: number | null; sanitary: string | null; weather: unknown; sensory: string | null }[];
  parcelIds: readonly string[];
  lotIds: readonly string[];
  wineIds: readonly string[];
  massByOp: Map<string, number>;
  sanitaryByOp: Map<string, string>;
  samples: Map<string, Map<string, { at: string; value: number }>>;
  analysesEnabled: boolean;
  notes: readonly TastingNote[];
}): VintageMetrics {
  const kgs = input.harvests.map((harvest) => {
    const mass = harvest.receptionId ? input.massByOp.get(harvest.receptionId) : undefined;
    if (mass != null && mass > 0) return roundTo(mass / 1000, 1);
    return harvest.estimatedKg == null ? null : roundTo(harvest.estimatedKg, 1);
  }).filter((value): value is number => value != null);
  const kg = kgs.length === 0 ? null : roundTo(kgs.reduce((sum, value) => sum + value, 0), 1);
  const dates = input.harvests.map((harvest) => harvest.harvestedOn).filter((value): value is string => Boolean(value)).sort();
  const ripeness = input.checks
    .filter((check) => input.parcelIds.includes(check.parcelId) && yearOf(check.checkedAt) === input.vintage)
    .map((check) => ({
      checked_at: instantToCivil(check.checkedAt) ?? asText(check.checkedAt),
      probable_abv: check.probableAbv,
      total_acidity: check.acidity,
      sanitary_status: check.sanitary,
      sensory_notes: check.sensory,
    }))
    .sort((a, b) => String(a.checked_at).localeCompare(String(b.checked_at)));
  const scores = scoresFor(input.notes, new Set(input.lotIds), new Set(input.wineIds), input.vintage);
  return {
    vintage: input.vintage,
    harvest_date: dates[0] ?? null,
    kg,
    yield_kg_ha: kg != null && input.areaHa != null && input.areaHa > 0 ? roundTo(kg / input.areaHa, 1) : null,
    varieties: [...new Set(input.harvests.map((harvest) => harvest.variety).filter((value): value is string => Boolean(value)))].sort(),
    ripeness,
    intake_sanitary_notes: joinUnique([
      ...input.harvests.map((harvest) => harvest.notes),
      ...input.harvests.map((harvest) => (harvest.receptionId ? input.sanitaryByOp.get(harvest.receptionId) ?? null : null)),
    ], ' · '),
    analyses: analysesFor(input.samples, input.lotIds, input.analysesEnabled),
    tasting_score: average(scores),
    tasting_count: scores.length,
    weather_notes: joinUnique(ripeness.length === 0 ? [] : input.checks
      .filter((check) => input.parcelIds.includes(check.parcelId) && yearOf(check.checkedAt) === input.vintage)
      .map((check) => weatherText(check.weather)), ' | '),
  };
}

export function parseVintageFilter(request: Request): VintageFilter {
  const url = new URL(request.url);
  const parcel = url.searchParams.get('parcel_id');
  const wine = url.searchParams.get('wine_id');
  if (parcel && !isUuid(parcel)) throw domainError('WC_VALIDATION', { parcel_id: 'Debe ser un UUID' });
  if (wine && !isUuid(wine)) throw domainError('WC_VALIDATION', { wine_id: 'Debe ser un UUID' });
  return {
    parcelId: parcel ? parcel.toLowerCase() : null,
    wineId: wine ? wine.toLowerCase() : null,
    fromVintage: vintageParam(url.searchParams.get('vintage_from'), 'vintage_from'),
    toVintage: vintageParam(url.searchParams.get('vintage_to'), 'vintage_to'),
  };
}

function vintageParam(value: string | null, field: string): number | null {
  if (value == null || value.trim() === '') return null;
  if (!/^\d{4}$/.test(value)) throw domainError('WC_VALIDATION', { [field]: 'Añada no válida' });
  const parsed = Number(value);
  if (parsed < 1990 || parsed > 2100) throw domainError('WC_VALIDATION', { [field]: 'Añada no válida' });
  return parsed;
}

export async function vintageReport(writer: Writer, filter: VintageFilter): Promise<VintageReport> {
  const missing: string[] = [];
  const reader: SqlReader = writer;
  const parcels = await tableExists(reader, 'vineyard', 'parcel')
    ? await reader.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, code, name, area_ha::VARCHAR AS area_ha
      FROM vineyard.parcel
      ORDER BY code
    `)
    : (missing.push('vineyard.parcel'), []);
  const harvests: HarvestRow[] = [];
  if (await tableExists(reader, 'vineyard', 'harvest')) {
    const rows = await reader.read<Record<string, unknown>>(sql`
      SELECT
        id::VARCHAR AS id,
        parcel_id::VARCHAR AS parcel_id,
        vintage::VARCHAR AS vintage,
        harvested_on,
        variety,
        estimated_kg::VARCHAR AS estimated_kg,
        reception_operation_id::VARCHAR AS reception_operation_id,
        notes
      FROM vineyard.harvest
    `);
    for (const row of rows) {
      const vintage = asNum(row.vintage);
      const parcelId = asText(row.parcel_id)?.toLowerCase();
      if (vintage == null || !parcelId) continue;
      harvests.push({
        id: String(row.id).toLowerCase(),
        parcelId,
        vintage: Math.trunc(vintage),
        harvestedOn: asCivil(row.harvested_on),
        variety: asText(row.variety),
        estimatedKg: asNum(row.estimated_kg),
        receptionId: asText(row.reception_operation_id)?.toLowerCase() ?? null,
        notes: asText(row.notes),
      });
    }
  } else missing.push('vineyard.harvest');

  const checks: {
    parcelId: string;
    checkedAt: unknown;
    probableAbv: number | null;
    acidity: number | null;
    sanitary: string | null;
    weather: unknown;
    sensory: string | null;
  }[] = [];
  if (await tableExists(reader, 'vineyard', 'maturity_check')) {
    const rows = await reader.read<Record<string, unknown>>(sql`
      SELECT
        parcel_id::VARCHAR AS parcel_id,
        checked_at,
        probable_abv::VARCHAR AS probable_abv,
        total_acidity::VARCHAR AS total_acidity,
        sanitary_status,
        weather_snapshot,
        sensory_notes
      FROM vineyard.maturity_check
    `);
    for (const row of rows) {
      const parcelId = asText(row.parcel_id)?.toLowerCase();
      if (!parcelId) continue;
      checks.push({
        parcelId,
        checkedAt: row.checked_at,
        probableAbv: asNum(row.probable_abv),
        acidity: asNum(row.total_acidity),
        sanitary: asText(row.sanitary_status),
        weather: row.weather_snapshot,
        sensory: asText(row.sensory_notes),
      });
    }
  } else missing.push('vineyard.maturity_check');

  const lotRows = await reader.read<Record<string, unknown>>(sql`
    SELECT id::VARCHAR AS id, code, vintage::VARCHAR AS vintage, wine_id::VARCHAR AS wine_id
    FROM inventory.lot
  `);
  const designByLot = new Map<string, { wineId: string | null; productId: string | null }>();
  if (await tableExists(reader, 'cellar', 'lot_design')) {
    const rows = await reader.read<Record<string, unknown>>(sql`
      SELECT lot_id::VARCHAR AS lot_id, wine_id::VARCHAR AS wine_id, product_id::VARCHAR AS product_id
      FROM cellar.lot_design
    `);
    for (const row of rows) {
      const id = asText(row.lot_id)?.toLowerCase();
      if (!id) continue;
      designByLot.set(id, {
        wineId: asText(row.wine_id)?.toLowerCase() ?? null,
        productId: asText(row.product_id)?.toLowerCase() ?? null,
      });
    }
  }
  const productWine = new Map<string, string>();
  if (await tableExists(reader, 'catalog', 'product')) {
    const rows = await reader.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, wine_id::VARCHAR AS wine_id
      FROM catalog.product
      WHERE wine_id IS NOT NULL
    `);
    for (const row of rows) {
      const id = asText(row.id)?.toLowerCase();
      const wineId = asText(row.wine_id)?.toLowerCase();
      if (id && wineId) productWine.set(id, wineId);
    }
  }
  const traced = await traceLotParcels(reader);
  const lots: LotInfo[] = lotRows.map((row) => {
    const id = String(row.id).toLowerCase();
    const design = designByLot.get(id);
    const referenceId = asText(row.wine_id)?.toLowerCase()
      ?? design?.wineId
      ?? (design?.productId ? productWine.get(design.productId) ?? null : null);
    return {
      id,
      vintage: asNum(row.vintage) == null ? null : Math.trunc(asNum(row.vintage) ?? 0),
      referenceId,
      parcelIds: traced.get(id) ?? [],
    };
  });
  const visibleLots = lots.filter((lot) => {
    if (lot.vintage == null || !vintageOk(lot.vintage, filter)) return false;
    if (filter.wineId && lot.referenceId !== filter.wineId) return false;
    if (filter.parcelId && !lot.parcelIds.includes(filter.parcelId)) return false;
    return true;
  });

  const receptionIds = [...new Set(harvests.map((harvest) => harvest.receptionId).filter((id): id is string => Boolean(id)))];
  const massByOp = new Map<string, number>();
  const sanitaryByOp = new Map<string, string>();
  if (receptionIds.length > 0) {
    const masses = await reader.read<Record<string, unknown>>(`
      SELECT operation_id::VARCHAR AS operation_id, sum(mass_g)::VARCHAR AS mass_g
      FROM cellar.operation_line
      WHERE role = 'output' AND operation_id IN (${uuidList(receptionIds)})
      GROUP BY operation_id
    `);
    for (const row of masses) {
      const id = asText(row.operation_id)?.toLowerCase();
      const mass = asNum(row.mass_g);
      if (id && mass != null) massByOp.set(id, mass);
    }
    const ops = await reader.read<Record<string, unknown>>(`
      SELECT id::VARCHAR AS id, details FROM cellar.operation WHERE id IN (${uuidList(receptionIds)})
    `);
    for (const row of ops) {
      const id = asText(row.id)?.toLowerCase();
      const note = sanitaryFromDetails(row.details);
      if (id && note) sanitaryByOp.set(id, note);
    }
  }

  const analysesEnabled = (await tableExists(reader, 'cellar', 'analysis'))
    && (await tableExists(reader, 'cellar', 'analysis_result'));
  const samples = new Map<string, Map<string, { at: string; value: number }>>();
  if (analysesEnabled) {
    const rows = await reader.read<Record<string, unknown>>(`
      SELECT a.lot_id::VARCHAR AS lot_id, a.sampled_at, r.parameter_code, r.value::VARCHAR AS value
      FROM cellar.analysis a
      JOIN cellar.analysis_result r ON r.analysis_id = a.id
      WHERE r.parameter_code IN (${ANALYSIS_KEYS.map((key) => `'${key}'`).join(', ')})
    `);
    for (const row of rows) {
      const lotId = asText(row.lot_id)?.toLowerCase();
      const key = asText(row.parameter_code);
      const value = asNum(row.value);
      const at = asText(row.sampled_at) ?? '';
      if (!lotId || !key || value == null) continue;
      const byParam = samples.get(lotId) ?? new Map();
      const current = byParam.get(key);
      if (!current || at > current.at) byParam.set(key, { at, value });
      samples.set(lotId, byParam);
    }
  } else missing.push('cellar.analysis');

  const notes = await loadTastings(reader, missing);
  const wines = await tableExists(reader, 'catalog', 'wine')
    ? await reader.read<Record<string, unknown>>(sql`
      SELECT id::VARCHAR AS id, code, name FROM catalog.wine
    `)
    : [];
  const wineById = new Map(wines.map((row) => [String(row.id).toLowerCase(), row]));

  const visibleHarvests = harvests.filter((harvest) => {
    if (!vintageOk(harvest.vintage, filter)) return false;
    if (filter.parcelId && harvest.parcelId !== filter.parcelId) return false;
    if (filter.wineId) {
      return visibleLots.some((lot) => lot.vintage === harvest.vintage && lot.parcelIds.includes(harvest.parcelId));
    }
    return true;
  });

  const parcelViews = parcels.flatMap((row) => {
    const parcelId = String(row.id).toLowerCase();
    if (filter.parcelId && parcelId !== filter.parcelId) return [];
    const area = asNum(row.area_ha);
    const parcelHarvests = visibleHarvests.filter((harvest) => harvest.parcelId === parcelId);
    const parcelLots = visibleLots.filter((lot) => lot.parcelIds.includes(parcelId));
    if (filter.wineId && parcelLots.length === 0 && parcelHarvests.length === 0) return [];
    const vintages = new Set<number>([
      ...parcelHarvests.map((harvest) => harvest.vintage),
      ...parcelLots.map((lot) => lot.vintage).filter((vintage): vintage is number => vintage != null),
    ]);
    const series = [...vintages].filter((vintage) => vintageOk(vintage, filter)).sort((a, b) => a - b);
    if (series.length === 0) return [];
    return [{
      parcel_id: parcelId,
      code: String(row.code),
      name: String(row.name),
      area_ha: area,
      vintages: series.map((vintage) => {
        const harvestGroup = parcelHarvests.filter((harvest) => harvest.vintage === vintage);
        const lotGroup = parcelLots.filter((lot) => lot.vintage === vintage);
        return metricsOf({
          vintage,
          harvests: harvestGroup,
          areaHa: area,
          checks,
          parcelIds: [parcelId],
          lotIds: lotGroup.map((lot) => lot.id),
          wineIds: lotGroup.map((lot) => lot.referenceId).filter((id): id is string => Boolean(id)),
          massByOp,
          sanitaryByOp,
          samples,
          analysesEnabled,
          notes,
        });
      }),
    }];
  });

  const wineIds = [...new Set(visibleLots.map((lot) => lot.referenceId).filter((id): id is string => Boolean(id)))].sort();
  const wineViews = wineIds.flatMap((wineId) => {
    if (filter.wineId && wineId !== filter.wineId) return [];
    const wineLots = visibleLots.filter((lot) => lot.referenceId === wineId);
    const vintages = [...new Set(wineLots.map((lot) => lot.vintage).filter((vintage): vintage is number => vintage != null))].sort((a, b) => a - b);
    if (vintages.length === 0) return [];
    const info = wineById.get(wineId);
    return [{
      wine_id: wineId,
      code: info ? String(info.code) : wineId,
      name: info ? String(info.name) : wineId,
      vintages: vintages.map((vintage) => {
        const lotGroup = wineLots.filter((lot) => lot.vintage === vintage);
        const parcelIds = [...new Set(lotGroup.flatMap((lot) => lot.parcelIds))];
        const harvestGroup = visibleHarvests.filter((harvest) => harvest.vintage === vintage && parcelIds.includes(harvest.parcelId));
        const area = parcelIds.reduce((sum, parcelId) => {
          const parcel = parcels.find((item) => String(item.id).toLowerCase() === parcelId);
          const areaHa = parcel ? asNum(parcel.area_ha) : null;
          return areaHa == null ? sum : sum + areaHa;
        }, 0);
        return metricsOf({
          vintage,
          harvests: harvestGroup,
          areaHa: area > 0 ? area : null,
          checks,
          parcelIds,
          lotIds: lotGroup.map((lot) => lot.id),
          wineIds: [wineId],
          massByOp,
          sanitaryByOp,
          samples,
          analysesEnabled,
          notes,
        });
      }),
    }];
  });

  return {
    missing: [...new Set(missing)].sort(),
    filter: {
      parcel_id: filter.parcelId,
      wine_id: filter.wineId,
      vintage_from: filter.fromVintage,
      vintage_to: filter.toVintage,
    },
    by_parcel: parcelViews,
    by_wine: wineViews,
  };
}

const CSV_HEADER = [
  'scope', 'code', 'name', 'vintage', 'harvest_date', 'kg', 'yield_kg_ha',
  'ripeness_probable_abv', 'ripeness_total_acidity', 'intake_sanitary_notes',
  'abv', 'total_acidity', 'ph', 'free_so2', 'total_so2', 'volatile_acidity',
  'total_polyphenol_index', 'tasting_score', 'weather_notes',
];

function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function lastRipeness(metrics: VintageMetrics): Ripeness | undefined {
  return metrics.ripeness[metrics.ripeness.length - 1];
}

function csvRow(scope: string, code: string, name: string, metrics: VintageMetrics): string {
  const ripe = lastRipeness(metrics);
  const analyses = metrics.analyses;
  return [
    scope,
    code,
    name,
    metrics.vintage,
    metrics.harvest_date,
    metrics.kg,
    metrics.yield_kg_ha,
    ripe?.probable_abv ?? null,
    ripe?.total_acidity ?? null,
    metrics.intake_sanitary_notes,
    analyses?.abv ?? null,
    analyses?.total_acidity ?? null,
    analyses?.ph ?? null,
    analyses?.free_so2 ?? null,
    analyses?.total_so2 ?? null,
    analyses?.volatile_acidity ?? null,
    analyses?.total_polyphenol_index ?? null,
    metrics.tasting_score,
    metrics.weather_notes,
  ].map(csvCell).join(';');
}

export function vintageCsv(report: VintageReport): string {
  const lines = [CSV_HEADER.join(';')];
  for (const parcel of report.by_parcel) {
    for (const metrics of parcel.vintages) lines.push(csvRow('parcela', parcel.code, parcel.name, metrics));
  }
  for (const wine of report.by_wine) {
    for (const metrics of wine.vintages) lines.push(csvRow('referencia', wine.code, wine.name, metrics));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function vintageCsvResponse(report: VintageReport): Response {
  return new Response(Buffer.from(vintageCsv(report), 'utf8'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="comparacion-anadas.csv"',
    },
  });
}
