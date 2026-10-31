import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { parseCampaign, type CampaignWindow } from './dates';
import {
  cueFilename,
  renderCueCsv,
  type CueHarvest,
  type CueOperation,
  type CueParcel,
  type CueProduct,
  type CueTask,
  type CueTreatment,
  type CueWarning,
  type CueWorkbook,
} from './export-csv';
import { decimalText } from './quantities';
import {
  TREATMENT_COLUMNS,
  TREATMENT_FROM,
  asCivilDate,
  asInt,
  sigpacOf,
  textOrNull,
  treatmentView,
  uuidText,
  bool,
} from './rows';
import { warningsByTreatment, type WarningSubject } from './warnings';

export async function exportCue(writer: Writer, request: Request, asOf: string): Promise<Response> {
  const url = new URL(request.url);
  const format = url.searchParams.get('format');
  if (format && format !== 'csv') {
    throw domainError('WC_VALIDATION', { format: 'El cuaderno se exporta en CSV. El PDF no está disponible en esta versión.' });
  }
  const raw = url.searchParams.get('campaign')?.trim() ?? '';
  if (raw === '') throw domainError('WC_VALIDATION', { campaign: 'Obligatorio' });
  const window = parseCampaign(raw);
  if (!window) throw domainError('WC_VALIDATION', { campaign: 'Usa AAAA o AAAA/AAAA+1' });
  const book = await loadWorkbook(writer, window, asOf);
  const csv = renderCueCsv(book);
  return new Response(Buffer.from(csv, 'utf8'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${cueFilename(window.label)}"`,
    },
  });
}

async function loadWorkbook(writer: Writer, window: CampaignWindow, asOf: string): Promise<CueWorkbook> {
  const treatmentRows = await writer.read<Record<string, unknown>>(`
    SELECT ${TREATMENT_COLUMNS}
    ${TREATMENT_FROM}
    WHERE t.applied_on >= CAST(${sql`${window.start}`} AS DATE)
      AND t.applied_on <= CAST(${sql`${window.end}`} AS DATE)
    ORDER BY t.applied_on, p.code, t.id
  `);
  if (treatmentRows.length > 5000) {
    throw domainError('WC_VALIDATION', { campaign: 'Demasiados tratamientos para un cuaderno' });
  }
  const subjects: WarningSubject[] = treatmentRows.map((row) => ({
    id: uuidText(row.id),
    parcel_id: uuidText(row.parcel_id),
    parcel_code: String(row.parcel_code),
    applied_on: asCivilDate(row.applied_on),
    safety_interval_days: asInt(row.safety_interval_days),
  }));
  const warnings = await warningsByTreatment((statement) => writer.read(statement), subjects);
  const treatments = treatmentRows.map((row) => treatmentView(row, asOf, warnings.get(uuidText(row.id)) ?? []));
  const cueTreatments = treatments.map(toCueTreatment);
  const cueWarnings: CueWarning[] = treatments.flatMap((item) => item.warnings.map((warning) => ({
    parcelCode: item.parcel_code,
    sigpac: item.sigpac,
    eventOn: warning.event_on,
    code: warning.code,
    message: warning.message,
  })));
  for (const item of treatments) {
    if (item.cue.status !== 'warn' && item.cue.status !== 'overdue') continue;
    cueWarnings.push({
      parcelCode: item.parcel_code,
      sigpac: item.sigpac,
      eventOn: item.cue.warn_on ?? item.applied_on,
      code: item.cue.status === 'overdue' ? 'CUE_VENCIDO' : 'CUE_AVISO',
      message: item.cue.status === 'overdue'
        ? `El tratamiento del ${item.applied_on} en ${item.parcel_code} superó el mes para anotarlo en el CUE (${item.cue.due_on}). Lo anota el agricultor. WineCore no lo envía.`
        : `El tratamiento del ${item.applied_on} en ${item.parcel_code} lleva 20 días sin anotar en el CUE. Fecha límite ${item.cue.due_on}. Lo anota el agricultor. WineCore no lo envía.`,
    });
  }
  return {
    campaignLabel: window.label,
    windowStart: window.start,
    windowEnd: window.end,
    generatedOn: asOf,
    parcels: await loadParcels(writer),
    products: productsOf(cueTreatments),
    treatments: cueTreatments,
    operations: await loadOperations(writer, window),
    tasks: await loadTasks(writer, window),
    harvests: await loadHarvests(writer, window),
    warnings: cueWarnings,
  };
}

function toCueTreatment(item: ReturnType<typeof treatmentView>): CueTreatment {
  return {
    appliedOn: item.applied_on,
    parcelCode: item.parcel_code,
    sigpac: item.sigpac,
    crop: item.crop,
    variety: item.variety,
    treatedAreaHa: item.treated_area_ha,
    organicParcel: item.parcel_is_organic,
    target: item.target,
    operatorName: item.operator_name,
    ropo: item.applicator_ropo,
    advisor: item.advisor_name,
    productName: item.product_name,
    registration: item.product_registration,
    substances: item.active_substances,
    organicProduct: item.is_organic_approved,
    dose: item.dose,
    doseUnit: item.dose_unit,
    maxDose: item.max_dose,
    maxDoseUnit: item.max_dose_unit,
    quantity: item.total_quantity,
    quantityUnit: item.quantity_unit,
    equipment: item.equipment_roma,
    safetyDays: item.safety_interval_days,
    efficacy: item.efficacy,
    weather: item.weather_notes,
    method: item.method,
    kind: item.kind,
    nutrient: item.nutrient_npk,
    timing: item.application_timing,
    cueStatus: item.cue.status,
    cueRecordedOn: item.cue_recorded_at ? item.cue_recorded_at.slice(0, 10) : null,
    invoiceId: item.supplier_invoice_id,
    warnings: item.warnings.map((warning) => warning.message),
    notes: item.notes,
  };
}

function productsOf(treatments: readonly CueTreatment[]): CueProduct[] {
  const map = new Map<string, CueProduct>();
  for (const item of treatments) {
    const key = `${item.productName}|${item.registration ?? ''}|${item.kind}`;
    if (map.has(key)) continue;
    map.set(key, {
      name: item.productName,
      registration: item.registration,
      substances: item.substances,
      organic: item.organicProduct,
      maxDose: item.maxDose,
      maxDoseUnit: item.maxDoseUnit,
      safetyDays: item.safetyDays,
      kind: item.kind,
      nutrient: item.nutrient,
    });
  }
  return [...map.values()];
}

async function loadParcels(writer: Writer): Promise<CueParcel[]> {
  const parcels = await writer.read<Record<string, unknown>>(`
    SELECT id, code, name, area_ha, is_organic, organic_since,
           sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone,
           sigpac_polygon, sigpac_parcel, sigpac_enclosure
    FROM vineyard.parcel
    WHERE is_active
    ORDER BY code
  `);
  if (parcels.length === 0) return [];
  const ids = parcels.map((row) => sql`CAST(${uuidText(row.id)} AS UUID)`).join(', ');
  const varieties = await writer.read<Record<string, unknown>>(`
    SELECT parcel_id, variety, area_ha
    FROM vineyard.parcel_variety
    WHERE parcel_id IN (${ids})
    ORDER BY variety
  `);
  const byParcel = new Map<string, { variety: string; areaHa: string }[]>();
  for (const row of varieties) {
    const id = uuidText(row.parcel_id);
    const list = byParcel.get(id) ?? [];
    list.push({ variety: String(row.variety), areaHa: decimalText(row.area_ha, 4) });
    byParcel.set(id, list);
  }
  return parcels.map((row) => ({
    code: String(row.code),
    sigpac: sigpacOf(row),
    areaHa: decimalText(row.area_ha, 4),
    organic: bool(row.is_organic),
    organicSince: row.organic_since == null ? null : asCivilDate(row.organic_since),
    name: String(row.name),
    varieties: byParcel.get(uuidText(row.id)) ?? [],
  }));
}

async function loadOperations(writer: Writer, window: CampaignWindow): Promise<CueOperation[]> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT o.done_on, o.kind, o.operator_name, o.product_name, o.active_substance,
           o.quantity, o.quantity_unit, o.notes, p.code AS parcel_code,
           p.sigpac_province, p.sigpac_municipality, p.sigpac_aggregate, p.sigpac_zone,
           p.sigpac_polygon, p.sigpac_parcel, p.sigpac_enclosure
    FROM vineyard.notebook_operation o
    JOIN vineyard.parcel p ON p.id = o.parcel_id
    WHERE o.done_on >= CAST(${sql`${window.start}`} AS DATE)
      AND o.done_on <= CAST(${sql`${window.end}`} AS DATE)
  `);
  return rows.map((row) => ({
    doneOn: asCivilDate(row.done_on),
    parcelCode: String(row.parcel_code),
    sigpac: sigpacOf(row),
    kind: String(row.kind),
    operatorName: textOrNull(row.operator_name),
    productName: textOrNull(row.product_name),
    substance: textOrNull(row.active_substance),
    quantity: row.quantity == null ? null : decimalText(row.quantity, 4),
    quantityUnit: textOrNull(row.quantity_unit),
    notes: textOrNull(row.notes),
  }));
}

async function loadTasks(writer: Writer, window: CampaignWindow): Promise<CueTask[]> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT f.done_on, f.kind, f.operator_name, f.hours, f.notes, p.code AS parcel_code,
           p.sigpac_province, p.sigpac_municipality, p.sigpac_aggregate, p.sigpac_zone,
           p.sigpac_polygon, p.sigpac_parcel, p.sigpac_enclosure
    FROM vineyard.field_task f
    JOIN vineyard.parcel p ON p.id = f.parcel_id
    WHERE f.done_on >= CAST(${sql`${window.start}`} AS DATE)
      AND f.done_on <= CAST(${sql`${window.end}`} AS DATE)
  `);
  return rows.map((row) => ({
    doneOn: asCivilDate(row.done_on),
    parcelCode: String(row.parcel_code),
    sigpac: sigpacOf(row),
    kind: String(row.kind),
    operatorName: textOrNull(row.operator_name),
    hours: row.hours == null ? null : decimalText(row.hours, 2),
    notes: textOrNull(row.notes),
  }));
}

async function loadHarvests(writer: Writer, window: CampaignWindow): Promise<CueHarvest[]> {
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT h.harvested_on, h.variety, h.estimated_kg, h.notes, p.code AS parcel_code,
           p.sigpac_province, p.sigpac_municipality, p.sigpac_aggregate, p.sigpac_zone,
           p.sigpac_polygon, p.sigpac_parcel, p.sigpac_enclosure
    FROM vineyard.harvest h
    JOIN vineyard.parcel p ON p.id = h.parcel_id
    WHERE h.harvested_on >= CAST(${sql`${window.start}`} AS DATE)
      AND h.harvested_on <= CAST(${sql`${window.end}`} AS DATE)
  `);
  return rows.map((row) => ({
    harvestedOn: asCivilDate(row.harvested_on),
    parcelCode: String(row.parcel_code),
    sigpac: sigpacOf(row),
    variety: String(row.variety),
    estimatedKg: row.estimated_kg == null ? null : decimalText(row.estimated_kg, 1),
    notes: textOrNull(row.notes),
  }));
}
