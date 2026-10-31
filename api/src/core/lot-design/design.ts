import {
  FieldBag,
  boolValue,
  enumValue,
  intValue,
  isUuid,
  readObject,
  rejectUnknown,
  textValue,
} from '../catalog/fields';
import { auditInsert, auditUpdate } from '../cellar/service/http';
import { sql } from '../db/sql';
import type { Actor, Writer } from '../db/writer';
import { domainError } from '../errors';
import {
  AGING_METHODS,
  DESTINATIONS,
  INOCULATIONS,
  PRACTICES,
  VINIFICATIONS,
  type AgingMethod,
  type DestinationKind,
  type InoculationKind,
  type Vinification,
} from './codes';
import { originParcels, type ParcelRef } from './genealogy';
import { requireLot } from './lot-ref';
import { asBool, asInt, asRecord, asText, stringList, type SqlReader } from './rows';

const YEAST_LOT = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,39}$/;
const FIELDS = [
  'destination_kind', 'wine_id', 'product_id', 'collection_name',
  'vinification', 'destemmed', 'inoculation_kind',
  'yeast_product_id', 'yeast_lot_code', 'yeast_name',
  'practices_applied', 'practices_not_applied', 'no_intervention',
  'aging_method', 'aging_duration_days', 'single_plot', 'parcel_id',
  'label_number', 'notes',
] as const;

export interface PracticeInfo {
  code: string;
  name_es: string;
  intervention: boolean;
}

export interface DesignInput {
  destination_kind: DestinationKind;
  wine_id: string | null;
  product_id: string | null;
  collection_name: string | null;
  vinification: Vinification;
  destemmed: boolean;
  inoculation_kind: InoculationKind;
  yeast_product_id: string | null;
  yeast_lot_code: string | null;
  yeast_name: string | null;
  practices_applied: string[];
  practices_not_applied: string[];
  no_intervention: boolean;
  aging_method: AgingMethod;
  aging_duration_days: number | null;
  single_plot: boolean;
  parcel_id: string | null;
  label_number: number | null;
  notes: string | null;
}

export interface DesignView {
  lot_id: string;
  lot_code: string;
  origin_parcels: ParcelRef[];
  single_plot_allowed: boolean;
  practice_catalog: PracticeInfo[];
  design: DesignInput | null;
  updated_at: string | null;
  updated_by: string | null;
}

interface StoredDesign {
  input: DesignInput;
  updated_at: string | null;
  updated_by: string | null;
}

export async function loadPractices(reader: SqlReader): Promise<PracticeInfo[]> {
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT code, name_es, intervention
    FROM cellar.practice
    ORDER BY code
  `);
  if (rows.length === 0) {
    return PRACTICES.map((item) => ({ ...item }));
  }
  return rows.map((row) => ({
    code: String(row.code),
    name_es: String(row.name_es),
    intervention: asBool(row.intervention),
  }));
}

function optionalUuid(value: unknown, field: string, errors: FieldBag): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) {
    errors.add(field, 'Debe ser un UUID');
    return null;
  }
  return value.toLowerCase();
}

function practiceList(
  value: unknown,
  field: string,
  allowed: Set<string>,
  errors: FieldBag,
): string[] | null {
  if (!Array.isArray(value)) {
    errors.add(field, 'Debe ser una lista');
    return null;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      errors.add(field, 'Práctica no reconocida');
      return null;
    }
    if (seen.has(item)) {
      errors.add(field, 'Práctica repetida');
      return null;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

export async function parseDesign(reader: SqlReader, body: unknown): Promise<DesignInput> {
  const record = readObject(body);
  const errors = new FieldBag();
  rejectUnknown(record, FIELDS, errors);
  const catalog = await loadPractices(reader);
  const allowed = new Set(catalog.map((item) => item.code));
  const intervention = new Set(catalog.filter((item) => item.intervention).map((item) => item.code));

  const destination = enumValue(record.destination_kind, 'destination_kind', DESTINATIONS, errors);
  const vinification = enumValue(record.vinification, 'vinification', VINIFICATIONS, errors);
  const inoculation = enumValue(record.inoculation_kind, 'inoculation_kind', INOCULATIONS, errors);
  const aging = enumValue(record.aging_method, 'aging_method', AGING_METHODS, errors);
  const destemmed = boolValue(record.destemmed, 'destemmed', errors);
  const singlePlot = boolValue(record.single_plot, 'single_plot', errors);
  const noIntervention = boolValue(record.no_intervention, 'no_intervention', errors);
  const wineId = optionalUuid(record.wine_id, 'wine_id', errors);
  const productId = optionalUuid(record.product_id, 'product_id', errors);
  const parcelId = optionalUuid(record.parcel_id, 'parcel_id', errors);
  const yeastProductId = optionalUuid(record.yeast_product_id, 'yeast_product_id', errors);
  const collection = textValue(record.collection_name, 'collection_name', errors, { max: 80, min: 2 });
  const yeastLot = textValue(record.yeast_lot_code, 'yeast_lot_code', errors, {
    max: 40,
    pattern: YEAST_LOT,
    patternMessage: 'Lote de cepa no válido',
  });
  const yeastName = textValue(record.yeast_name, 'yeast_name', errors, { min: 2, max: 80 });
  const notes = textValue(record.notes, 'notes', errors, { max: 2000 });
  const applied = practiceList(record.practices_applied, 'practices_applied', allowed, errors);
  const notApplied = practiceList(record.practices_not_applied, 'practices_not_applied', allowed, errors);
  let agingDays: number | null = null;
  if (record.aging_duration_days != null && record.aging_duration_days !== '') {
    agingDays = intValue(record.aging_duration_days, 'aging_duration_days', errors, { min: 0, max: 3650 });
  }
  let label: number | null = null;
  if (record.label_number != null && record.label_number !== '') {
    label = intValue(record.label_number, 'label_number', errors, { min: 1, max: 99 });
  }
  if (Object.keys(errors.fields).length > 0) errors.fail();
  if (!destination || !vinification || !inoculation || !aging || destemmed == null || singlePlot == null || noIntervention == null || !applied || !notApplied) {
    errors.fail();
    throw domainError('WC_VALIDATION');
  }

  if (destination === 'reference' && !wineId && !productId) {
    errors.add('wine_id', 'Indica la referencia o el producto');
  }
  if (destination !== 'reference' && (wineId || productId)) {
    errors.add('wine_id', 'Solo se indica cuando el destino es una referencia');
  }
  if (destination === 'new_collection' && !collection) errors.add('collection_name', 'Obligatorio');
  if (destination !== 'new_collection' && collection) {
    errors.add('collection_name', 'Solo se indica en una colección nueva');
  }
  if (inoculation === 'espontanea' && (yeastProductId || yeastLot || yeastName)) {
    errors.add('inoculation_kind', 'La fermentación espontánea no lleva cepa comercial');
  }
  if (inoculation === 'comercial') {
    if (!yeastLot) errors.add('yeast_lot_code', 'Obligatorio para la cepa comercial');
    if (!yeastProductId && !yeastName) errors.add('yeast_name', 'Indica el producto o el nombre de la cepa');
  }
  const overlap = applied.filter((code) => notApplied.includes(code));
  if (overlap.length > 0) errors.add('practices_not_applied', 'Una práctica no puede estar aplicada y no aplicada');
  const flagged = applied.includes('sin_intervencion');
  if (noIntervention !== flagged) {
    errors.add(
      'no_intervention',
      flagged
        ? 'La práctica sin_intervencion exige el indicador'
        : 'Sin intervención exige la práctica sin_intervencion',
    );
  }
  if (noIntervention && applied.some((code) => intervention.has(code))) {
    errors.add('practices_applied', 'Sin intervención no admite prácticas de intervención');
  }
  if (aging === 'sin_crianza' && agingDays != null && agingDays > 0) {
    errors.add('aging_duration_days', 'Sin crianza no tiene duración');
  }
  if (singlePlot && !parcelId) errors.add('parcel_id', 'Obligatorio');
  if (!singlePlot && parcelId) errors.add('parcel_id', 'Solo se indica con parcela única');
  if (!errors.fields.label_number) {
    if (singlePlot) {
      if (label == null) label = 1;
      else if (label !== 1) errors.add('label_number', 'La parcela única usa el número de etiqueta 1');
    } else if (label === 1) {
      errors.add('label_number', 'El número 1 está reservado a la parcela única');
    }
  }
  errors.fail();

  return {
    destination_kind: destination,
    wine_id: wineId,
    product_id: productId,
    collection_name: collection,
    vinification,
    destemmed,
    inoculation_kind: inoculation,
    yeast_product_id: inoculation === 'comercial' ? yeastProductId : null,
    yeast_lot_code: inoculation === 'comercial' ? yeastLot : null,
    yeast_name: inoculation === 'comercial' ? yeastName : null,
    practices_applied: applied,
    practices_not_applied: notApplied,
    no_intervention: noIntervention,
    aging_method: aging,
    aging_duration_days: aging === 'sin_crianza' ? null : agingDays,
    single_plot: singlePlot,
    parcel_id: singlePlot ? parcelId : null,
    label_number: label,
    notes,
  };
}

export async function assertDesignRefs(reader: SqlReader, input: DesignInput): Promise<void> {
  const errors = new FieldBag();
  if (input.wine_id) {
    const rows = await reader.read(sql`
      SELECT id::VARCHAR AS id FROM catalog.wine WHERE id = CAST(${input.wine_id} AS UUID)
    `);
    if (rows.length === 0) errors.add('wine_id', 'La referencia no existe');
  }
  if (input.product_id) {
    const rows = await reader.read<{ kind: string; wine_id: string | null }>(sql`
      SELECT kind, wine_id::VARCHAR AS wine_id
      FROM catalog.product
      WHERE id = CAST(${input.product_id} AS UUID)
    `);
    const product = rows[0];
    if (!product) errors.add('product_id', 'El producto no existe');
    else if (product.kind !== 'wine' && product.kind !== 'bulk_wine') {
      errors.add('product_id', 'El destino tiene que ser un vino');
    } else if (input.wine_id && product.wine_id && product.wine_id.toLowerCase() !== input.wine_id) {
      errors.add('product_id', 'El producto no es de esa referencia');
    }
  }
  if (input.parcel_id) {
    const rows = await reader.read(sql`
      SELECT id::VARCHAR AS id FROM vineyard.parcel WHERE id = CAST(${input.parcel_id} AS UUID)
    `);
    if (rows.length === 0) errors.add('parcel_id', 'La parcela no existe');
  }
  if (input.yeast_product_id) {
    const rows = await reader.read<{ kind: string }>(sql`
      SELECT kind FROM catalog.product WHERE id = CAST(${input.yeast_product_id} AS UUID)
    `);
    const yeast = rows[0];
    if (!yeast) errors.add('yeast_product_id', 'El producto no existe');
    else if (yeast.kind !== 'oenological_product') {
      errors.add('yeast_product_id', 'La cepa tiene que ser un producto enológico');
    }
  }
  errors.fail();
}

export async function assertSinglePlot(reader: SqlReader, lotId: string, parcelId: string): Promise<void> {
  const parcels = await originParcels(reader, lotId);
  if (parcels.length === 1 && parcels[0]?.id === parcelId) return;
  const message = parcels.length === 0
    ? 'La genealogía no llega a ninguna parcela'
    : parcels.length === 1
      ? 'La parcela no es la de origen del lote'
      : 'La genealogía llega a más de una parcela';
  throw domainError('WC_LOT_SINGLE_PLOT', { parcel_id: message }, { origin_parcels: parcels });
}

export function snapshotDesign(value: unknown): DesignInput | null {
  const record = asRecord(value);
  if (record.present !== true) return null;
  return mapInput(record);
}

function mapInput(row: Record<string, unknown>): DesignInput {
  return {
    destination_kind: String(row.destination_kind) as DestinationKind,
    wine_id: asText(row.wine_id)?.toLowerCase() ?? null,
    product_id: asText(row.product_id)?.toLowerCase() ?? null,
    collection_name: asText(row.collection_name),
    vinification: String(row.vinification) as Vinification,
    destemmed: asBool(row.destemmed),
    inoculation_kind: String(row.inoculation_kind) as InoculationKind,
    yeast_product_id: asText(row.yeast_product_id)?.toLowerCase() ?? null,
    yeast_lot_code: asText(row.yeast_lot_code),
    yeast_name: asText(row.yeast_name),
    practices_applied: stringList(row.practices_applied),
    practices_not_applied: stringList(row.practices_not_applied),
    no_intervention: asBool(row.no_intervention),
    aging_method: String(row.aging_method) as AgingMethod,
    aging_duration_days: asInt(row.aging_duration_days),
    single_plot: asBool(row.single_plot),
    parcel_id: asText(row.parcel_id)?.toLowerCase() ?? null,
    label_number: asInt(row.label_number),
    notes: asText(row.notes),
  };
}

export async function readStoredDesign(reader: SqlReader, lotId: string): Promise<StoredDesign | null> {
  if (!isUuid(lotId)) throw domainError('WC_NOT_FOUND');
  const rows = await reader.read<Record<string, unknown>>(sql`
    SELECT
      lot_id::VARCHAR AS lot_id,
      destination_kind,
      wine_id::VARCHAR AS wine_id,
      product_id::VARCHAR AS product_id,
      collection_name,
      vinification,
      destemmed,
      inoculation_kind,
      yeast_product_id::VARCHAR AS yeast_product_id,
      yeast_lot_code,
      yeast_name,
      practices_applied,
      practices_not_applied,
      no_intervention,
      aging_method,
      aging_duration_days::VARCHAR AS aging_duration_days,
      single_plot,
      parcel_id::VARCHAR AS parcel_id,
      label_number::VARCHAR AS label_number,
      notes,
      updated_by,
      updated_at
    FROM cellar.lot_design
    WHERE lot_id = CAST(${lotId} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    input: mapInput(row),
    updated_at: asText(row.updated_at),
    updated_by: asText(row.updated_by),
  };
}

function writeDesign(input: DesignInput, lotId: string, actorId: string, update: boolean): string {
  const values = {
    destination_kind: input.destination_kind,
    wine_id: input.wine_id,
    product_id: input.product_id,
    collection_name: input.collection_name,
    vinification: input.vinification,
    destemmed: input.destemmed,
    inoculation_kind: input.inoculation_kind,
    yeast_product_id: input.yeast_product_id,
    yeast_lot_code: input.yeast_lot_code,
    yeast_name: input.yeast_name,
    practices_applied: input.practices_applied,
    practices_not_applied: input.practices_not_applied,
    no_intervention: input.no_intervention,
    aging_method: input.aging_method,
    aging_duration_days: input.aging_duration_days,
    single_plot: input.single_plot,
    parcel_id: input.parcel_id,
    label_number: input.label_number,
    notes: input.notes,
  };
  if (!update) {
    return sql`
      INSERT INTO cellar.lot_design (
        lot_id, destination_kind, wine_id, product_id, collection_name, vinification, destemmed,
        inoculation_kind, yeast_product_id, yeast_lot_code, yeast_name,
        practices_applied, practices_not_applied, no_intervention,
        aging_method, aging_duration_days, single_plot, parcel_id, label_number, notes, updated_by
      ) VALUES (
        CAST(${lotId} AS UUID),
        ${values.destination_kind},
        CAST(${values.wine_id} AS UUID),
        CAST(${values.product_id} AS UUID),
        ${values.collection_name},
        ${values.vinification},
        ${values.destemmed},
        ${values.inoculation_kind},
        CAST(${values.yeast_product_id} AS UUID),
        ${values.yeast_lot_code},
        ${values.yeast_name},
        ${sql.json(values.practices_applied)},
        ${sql.json(values.practices_not_applied)},
        ${values.no_intervention},
        ${values.aging_method},
        ${values.aging_duration_days},
        ${values.single_plot},
        CAST(${values.parcel_id} AS UUID),
        ${values.label_number},
        ${values.notes},
        ${actorId}
      )
    `;
  }
  return sql`
    UPDATE cellar.lot_design SET
      destination_kind = ${values.destination_kind},
      wine_id = CAST(${values.wine_id} AS UUID),
      product_id = CAST(${values.product_id} AS UUID),
      collection_name = ${values.collection_name},
      vinification = ${values.vinification},
      destemmed = ${values.destemmed},
      inoculation_kind = ${values.inoculation_kind},
      yeast_product_id = CAST(${values.yeast_product_id} AS UUID),
      yeast_lot_code = ${values.yeast_lot_code},
      yeast_name = ${values.yeast_name},
      practices_applied = ${sql.json(values.practices_applied)},
      practices_not_applied = ${sql.json(values.practices_not_applied)},
      no_intervention = ${values.no_intervention},
      aging_method = ${values.aging_method},
      aging_duration_days = ${values.aging_duration_days},
      single_plot = ${values.single_plot},
      parcel_id = CAST(${values.parcel_id} AS UUID),
      label_number = ${values.label_number},
      notes = ${values.notes},
      updated_by = ${actorId},
      updated_at = now()
    WHERE lot_id = CAST(${lotId} AS UUID)
  `;
}

async function viewOf(reader: SqlReader, lotId: string, code: string): Promise<DesignView> {
  const [parcels, catalog, stored] = await Promise.all([
    originParcels(reader, lotId),
    loadPractices(reader),
    readStoredDesign(reader, lotId),
  ]);
  return {
    lot_id: lotId,
    lot_code: code,
    origin_parcels: parcels,
    single_plot_allowed: parcels.length === 1,
    practice_catalog: catalog,
    design: stored?.input ?? null,
    updated_at: stored?.updated_at ?? null,
    updated_by: stored?.updated_by ?? null,
  };
}

export async function readDesign(writer: Writer, code: string, producerId: string | null): Promise<DesignView> {
  const lot = await requireLot(writer, code, producerId);
  return viewOf(writer, lot.id, lot.code);
}

export async function saveDesign(
  writer: Writer,
  actor: Actor,
  code: string,
  producerId: string | null,
  body: unknown,
): Promise<DesignView> {
  await writer.withWrite(actor, async (tx) => {
    const input = await parseDesign(tx, body);
    const lot = await requireLot(tx, code, producerId);
    await assertDesignRefs(tx, input);
    if (input.single_plot && input.parcel_id) await assertSinglePlot(tx, lot.id, input.parcel_id);
    const current = await readStoredDesign(tx, lot.id);
    const statement = writeDesign(input, lot.id, actor.id, current !== null);
    if (current) auditUpdate(tx, 'cellar.lot_design', lot.id, current.input, input, statement);
    else auditInsert(tx, 'cellar.lot_design', lot.id, input, statement);
  });
  return readDesign(writer, code, producerId);
}
