import { isCalendarDate, requireUuid } from '../catalog/fields';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { businessDate } from '../time';
import { calendarYear, parseCampaign } from './dates';
import { parseTreatmentCreate, parseTreatmentPatch, type TreatmentDraft } from './parse-treatment';
import { readProduct } from './products';
import { decimalText, greaterThan, multiplyQuantity } from './quantities';
import {
  PER_HECTARE,
  PRODUCT_KINDS,
  QUANTITY_UNIT,
  TREATMENT_COLUMNS,
  TREATMENT_FROM,
  asCivilDate,
  bool,
  treatmentView,
  uuidText,
  type ProductKind,
  type TreatmentView,
} from './rows';
import { warningsByTreatment, type WarningSubject } from './warnings';

interface ParcelRow {
  id: string;
  code: string;
  area_ha: string;
  is_organic: boolean;
  is_active: boolean;
}

export async function listTreatments(writer: Writer, request: Request, asOf: string): Promise<{ items: TreatmentView[] }> {
  const url = new URL(request.url);
  const filters = ['TRUE'];
  const campaign = url.searchParams.get('campaign');
  if (campaign) {
    const window = parseCampaign(campaign);
    if (!window) throw domainError('WC_VALIDATION', { campaign: 'Usa AAAA o AAAA/AAAA+1' });
    filters.push(sql`t.applied_on >= CAST(${window.start} AS DATE) AND t.applied_on <= CAST(${window.end} AS DATE)`);
  }
  const parcelId = url.searchParams.get('parcel_id');
  if (parcelId) {
    requireUuid(parcelId, 'parcel_id');
    filters.push(sql`t.parcel_id = CAST(${parcelId} AS UUID)`);
  }
  const kind = url.searchParams.get('kind');
  if (kind) {
    if (!PRODUCT_KINDS.includes(kind as ProductKind)) {
      throw domainError('WC_VALIDATION', { kind: 'Valor no válido' });
    }
    filters.push(sql`t.record_kind = ${kind}`);
  }
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT ${TREATMENT_COLUMNS}
    ${TREATMENT_FROM}
    WHERE ${filters.join(' AND ')}
    ORDER BY t.applied_on DESC, t.id DESC
    LIMIT 500
  `);
  return { items: await withWarnings(writer, rows, asOf) };
}

export async function getTreatment(writer: Writer, id: string, asOf: string): Promise<TreatmentView> {
  requireUuid(id);
  const rows = await loadRows(writer, [id]);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  const [view] = await withWarnings(writer, [row], asOf);
  if (!view) throw domainError('WC_NOT_FOUND');
  return view;
}

export async function createTreatments(
  writer: Writer,
  actor: Actor,
  body: unknown,
  now: Date,
): Promise<{ treatments: TreatmentView[] }> {
  const draft = parseTreatmentCreate(body);
  const ids = draft.parcels.map(() => newId());
  const groupId = newId();
  await writer.withWrite(actor, async (tx) => {
    const product = await readProduct(tx, draft.productId);
    if (!product) throw domainError('WC_VALIDATION', { product_id: 'El producto no existe' });
    if (!product.is_active) throw domainError('WC_VALIDATION', { product_id: 'El producto no está activo' });
    if (product.product_kind !== draft.kind) {
      throw domainError('WC_VALIDATION', { product_id: 'El tipo de producto no coincide con el del tratamiento' });
    }
    if (draft.doseUnit !== product.max_dose_unit) {
      throw domainError('WC_VALIDATION', {
        dose_unit: `La unidad tiene que ser la de la dosis máxima (${product.max_dose_unit})`,
      });
    }
    if (greaterThan(draft.dose, product.max_dose)) {
      throw domainError('WC_VIN_DOSE', { dose: 'La dosis supera la dosis máxima del producto' });
    }
    if (draft.quantityUnit && draft.quantityUnit !== QUANTITY_UNIT[draft.doseUnit]) {
      throw domainError('WC_VALIDATION', { quantity_unit: `La unidad de cantidad tiene que ser ${QUANTITY_UNIT[draft.doseUnit]}` });
    }
    await assertInvoice(tx, draft.supplierInvoiceId);
    const parcels = await loadParcels(tx, draft.parcels.map((item) => item.parcelId));
    const varieties = await loadVarieties(tx, [...parcels.keys()]);
    for (let index = 0; index < draft.parcels.length; index += 1) {
      const item = draft.parcels[index];
      const id = ids[index];
      if (!item || !id) throw domainError('WC_VALIDATION', { parcel_ids: 'Hay una parcela que no existe' });
      const parcel = parcels.get(item.parcelId);
      if (!parcel) throw domainError('WC_VALIDATION', { parcel_ids: 'Hay una parcela que no existe' });
      if (!parcel.is_active) {
        throw domainError('WC_VALIDATION', { parcel_ids: `La parcela ${parcel.code} no está activa` });
      }
      const area = item.treatedAreaHa ?? parcel.area_ha;
      if (greaterThan(area, parcel.area_ha)) {
        throw domainError('WC_VIN_AREA', {
          treated_area_ha: `La superficie tratada supera la de la parcela ${parcel.code}`,
        });
      }
      if (parcel.is_organic && !product.is_organic_approved) {
        throw domainError('WC_VIN_ORGANIC', {
          product_id: `La parcela ${parcel.code} es ecológica y el producto no está autorizado`,
        });
      }
      const variety = resolveVariety(parcel.code, varieties.get(parcel.id) ?? [], draft.variety);
      const total = resolveTotal(draft, area);
      const nutrient = draft.nutrientNpk ?? (draft.kind === 'fertiliser' ? product.nutrient_npk : null);
      const after = {
        id,
        group_id: groupId,
        parcel_id: parcel.id,
        applied_on: draft.appliedOn,
        campaign: calendarYear(draft.appliedOn),
        record_kind: draft.kind,
        product_id: product.id,
        product_name: product.commercial_name,
        dose: draft.dose,
        treated_area_ha: area,
        total_quantity: total.quantity,
        is_organic_approved: product.is_organic_approved,
      };
      tx.write(sql`
        INSERT INTO vineyard.treatment (
          id, parcel_id, applied_on, operator_name, product_name, product_registration,
          is_organic_approved, dose, dose_unit, treated_area_ha, method, target, advisor_name,
          equipment_roma, efficacy, supplier_invoice_id, notes, created_by, created_at,
          record_kind, notebook_product_id, crop, variety, total_quantity, quantity_unit,
          applicator_ropo, weather_notes, safety_interval_days, group_id, campaign,
          nutrient_npk, application_timing, active_substances, max_dose, max_dose_unit
        ) VALUES (
          CAST(${id} AS UUID), CAST(${parcel.id} AS UUID), CAST(${draft.appliedOn} AS DATE),
          ${draft.operatorName}, ${product.commercial_name}, ${product.registration_number},
          ${product.is_organic_approved}, CAST(${draft.dose} AS DECIMAL(10,3)), ${draft.doseUnit},
          CAST(${area} AS DECIMAL(8,4)), ${draft.method}, ${draft.target}, ${draft.advisorName},
          ${draft.equipmentRoma}, ${draft.efficacy},
          CAST(${draft.supplierInvoiceId} AS UUID),
          ${draft.notes}, ${actor.id}, ${now},
          ${draft.kind}, CAST(${product.id} AS UUID), ${draft.crop}, ${variety},
          CAST(${total.quantity} AS DECIMAL(14,4)),
          ${total.unit}, ${draft.applicatorRopo}, ${draft.weatherNotes}, ${product.safety_interval_days},
          CAST(${groupId} AS UUID), ${calendarYear(draft.appliedOn)},
          ${nutrient}, ${draft.applicationTiming}, ${product.active_substances},
          CAST(${product.max_dose} AS DECIMAL(12,4)), ${product.max_dose_unit}
        )
      `);
      tx.audit({
        table: 'vineyard.treatment',
        rowId: id,
        action: 'INSERT',
        before: null,
        after,
      });
    }
  });
  const rows = await loadRows(writer, ids);
  const views = await withWarnings(writer, rows, businessDate(now));
  const order = new Map(ids.map((id, index) => [id, index]));
  views.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  return { treatments: views };
}

export async function updateTreatment(
  writer: Writer,
  actor: Actor,
  id: string,
  body: unknown,
  asOf: string,
): Promise<TreatmentView> {
  requireUuid(id);
  const patch = parseTreatmentPatch(body);
  await writer.withWrite(actor, async (tx) => {
    const idSql = sql`${id}`;
    const rows = await tx.read<Record<string, unknown>>(`
      SELECT ${TREATMENT_COLUMNS}
      ${TREATMENT_FROM}
      WHERE t.id = CAST(${idSql} AS UUID)
    `);
    const current = rows[0];
    if (!current) throw domainError('WC_NOT_FOUND');
    const appliedOn = asCivilDate(current.applied_on);
    if (patch.cueRecordedAt) {
      const recordedOn = patch.cueRecordedAt.toISOString().slice(0, 10);
      if (recordedOn < appliedOn) {
        throw domainError('WC_VALIDATION', { cue_recorded_at: 'No puede ser anterior al tratamiento' });
      }
    }
    const assignments: string[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (patch.efficacy !== undefined) {
      assignments.push(sql`efficacy = ${patch.efficacy}`);
      before.efficacy = current.efficacy ?? null;
      after.efficacy = patch.efficacy;
    }
    if (patch.notes !== undefined) {
      assignments.push(sql`notes = ${patch.notes}`);
      before.notes = current.notes ?? null;
      after.notes = patch.notes;
    }
    if (patch.weatherNotes !== undefined) {
      assignments.push(sql`weather_notes = ${patch.weatherNotes}`);
      before.weather_notes = current.weather_notes ?? null;
      after.weather_notes = patch.weatherNotes;
    }
    if (patch.advisorName !== undefined) {
      assignments.push(sql`advisor_name = ${patch.advisorName}`);
      before.advisor_name = current.advisor_name ?? null;
      after.advisor_name = patch.advisorName;
    }
    if (patch.cueRecordedAt) {
      assignments.push(sql`cue_recorded_at = ${patch.cueRecordedAt}`);
      before.cue_recorded_at = current.cue_recorded_at ?? null;
      after.cue_recorded_at = patch.cueRecordedAt.toISOString();
    }
    if (assignments.length === 0) throw domainError('WC_VALIDATION', { body: 'No hay cambios' });
    tx.write(`UPDATE vineyard.treatment SET ${assignments.join(', ')} WHERE ${sql`id = CAST(${id} AS UUID)`}`);
    tx.audit({
      table: 'vineyard.treatment',
      rowId: id,
      action: 'UPDATE',
      before,
      after,
    });
  });
  return getTreatment(writer, id, asOf);
}

async function loadRows(writer: Writer, ids: readonly string[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const list = ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  return writer.read<Record<string, unknown>>(`
    SELECT ${TREATMENT_COLUMNS}
    ${TREATMENT_FROM}
    WHERE t.id IN (${list})
  `);
}

async function withWarnings(read: Writer, rows: Record<string, unknown>[], asOf: string): Promise<TreatmentView[]> {
  const subjects: WarningSubject[] = rows.map((row) => ({
    id: uuidText(row.id),
    parcel_id: uuidText(row.parcel_id),
    parcel_code: String(row.parcel_code),
    applied_on: asCivilDate(row.applied_on),
    safety_interval_days: row.safety_interval_days == null ? null : Number(row.safety_interval_days),
  }));
  const warnings = await warningsByTreatment((statement) => read.read(statement), subjects);
  return rows.map((row) => treatmentView(row, asOf, warnings.get(uuidText(row.id)) ?? []));
}

async function loadParcels(tx: Tx, ids: readonly string[]): Promise<Map<string, ParcelRow>> {
  const map = new Map<string, ParcelRow>();
  if (ids.length === 0) return map;
  const list = ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const rows = await tx.read<Record<string, unknown>>(`
    SELECT id, code, area_ha, is_organic, is_active
    FROM vineyard.parcel
    WHERE id IN (${list})
  `);
  for (const row of rows) {
    const id = uuidText(row.id);
    map.set(id, {
      id,
      code: String(row.code),
      area_ha: decimalText(row.area_ha, 4),
      is_organic: bool(row.is_organic),
      is_active: bool(row.is_active),
    });
  }
  return map;
}

async function loadVarieties(tx: Tx, ids: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const list = ids.map((id) => sql`CAST(${id} AS UUID)`).join(', ');
  const rows = await tx.read<{ parcel_id: string; variety: string }>(`
    SELECT parcel_id, variety
    FROM vineyard.parcel_variety
    WHERE parcel_id IN (${list})
    ORDER BY variety
  `);
  for (const row of rows) {
    const id = uuidText(row.parcel_id);
    const listForParcel = map.get(id) ?? [];
    listForParcel.push(String(row.variety));
    map.set(id, listForParcel);
  }
  return map;
}

function resolveVariety(code: string, planted: readonly string[], requested: string | null): string | null {
  if (requested) {
    if (!planted.includes(requested)) {
      throw domainError('WC_VALIDATION', { variety: `La variedad no está en la parcela ${code}` });
    }
    return requested;
  }
  if (planted.length === 1) return planted[0] ?? null;
  throw domainError('WC_VALIDATION', { variety: `Indica la variedad de la parcela ${code}` });
}

function resolveTotal(draft: TreatmentDraft, area: string): { quantity: string | null; unit: string | null } {
  const unit = QUANTITY_UNIT[draft.doseUnit];
  if (draft.totalQuantity) return { quantity: draft.totalQuantity, unit: draft.quantityUnit ?? unit };
  if (!PER_HECTARE.has(draft.doseUnit)) {
    throw domainError('WC_VALIDATION', { total_quantity: 'Indica la cantidad total: la dosis no es por hectárea' });
  }
  return { quantity: multiplyQuantity(draft.dose, area, 4), unit };
}

async function assertInvoice(tx: Tx, id: string | null): Promise<void> {
  if (!id) return;
  const rows = await tx.read<{ id: string }>(sql`
    SELECT id FROM purchasing.supplier_invoice WHERE id = CAST(${id} AS UUID)
  `);
  if (!rows[0]) throw domainError('WC_VALIDATION', { supplier_invoice_id: 'La factura no existe' });
}

export function asOfDate(request: Request, now: Date): string {
  const raw = new URL(request.url).searchParams.get('as_of');
  if (raw == null || raw.trim() === '') return businessDate(now);
  if (!isCalendarDate(raw.trim())) {
    throw domainError('WC_VALIDATION', { as_of: 'Fecha no válida (AAAA-MM-DD)' });
  }
  return raw.trim();
}
