import {
  enumValue,
  FieldBag,
  hasKey,
  isCalendarDate,
  isUuid,
  rejectUnknown,
  requireUuid,
  textValue,
} from '../catalog/fields';
import { sql } from '../db/sql';
import type { Actor, Tx, Writer } from '../db/writer';
import { domainError } from '../errors';
import { newId } from '../ids';
import { calendarYear, parseCampaign } from './dates';
import { parseQuantity } from './quantities';
import { OPERATION_KINDS, bool, operationView, uuidText, type OperationKind, type OperationView } from './rows';

const CREATE_KEYS = [
  'parcel_id',
  'done_on',
  'kind',
  'operator_name',
  'product_name',
  'active_substance',
  'quantity',
  'quantity_unit',
  'notes',
] as const;

interface OperationDraft {
  parcelId: string;
  doneOn: string;
  kind: OperationKind;
  operatorName: string | null;
  productName: string | null;
  activeSubstance: string | null;
  quantity: string | null;
  quantityUnit: string | null;
  notes: string | null;
}

export async function listOperations(writer: Writer, request: Request): Promise<{ items: OperationView[] }> {
  const url = new URL(request.url);
  const filters = ['TRUE'];
  const campaign = url.searchParams.get('campaign');
  if (campaign) {
    const window = parseCampaign(campaign);
    if (!window) throw domainError('WC_VALIDATION', { campaign: 'Usa AAAA o AAAA/AAAA+1' });
    filters.push(sql`o.done_on >= CAST(${window.start} AS DATE) AND o.done_on <= CAST(${window.end} AS DATE)`);
  }
  const parcelId = url.searchParams.get('parcel_id');
  if (parcelId) {
    requireUuid(parcelId, 'parcel_id');
    filters.push(sql`o.parcel_id = CAST(${parcelId} AS UUID)`);
  }
  const rows = await writer.read<Record<string, unknown>>(`
    SELECT o.id, o.parcel_id, p.code AS parcel_code, o.done_on, o.campaign, o.kind,
           o.operator_name, o.product_name, o.active_substance, o.quantity, o.quantity_unit,
           o.notes, o.created_by, o.created_at,
           p.sigpac_province, p.sigpac_municipality, p.sigpac_aggregate, p.sigpac_zone,
           p.sigpac_polygon, p.sigpac_parcel, p.sigpac_enclosure
    FROM vineyard.notebook_operation o
    JOIN vineyard.parcel p ON p.id = o.parcel_id
    WHERE ${filters.join(' AND ')}
    ORDER BY o.done_on DESC, o.id DESC
    LIMIT 500
  `);
  return { items: rows.map(operationView) };
}

export async function createOperation(writer: Writer, actor: Actor, body: unknown): Promise<OperationView> {
  const draft = parseOperation(body);
  const id = newId();
  const now = new Date();
  await writer.withWrite(actor, async (tx) => {
    const parcel = await loadParcel(tx, draft.parcelId);
    if (!parcel) throw domainError('WC_VALIDATION', { parcel_id: 'La parcela no existe' });
    if (!parcel.is_active) throw domainError('WC_VALIDATION', { parcel_id: 'La parcela no está activa' });
    const campaign = calendarYear(draft.doneOn);
    tx.write(sql`
      INSERT INTO vineyard.notebook_operation (
        id, parcel_id, done_on, campaign, kind, operator_name, product_name,
        active_substance, quantity, quantity_unit, notes, created_by, created_at
      ) VALUES (
        CAST(${id} AS UUID), CAST(${parcel.id} AS UUID), CAST(${draft.doneOn} AS DATE), ${campaign},
        ${draft.kind}, ${draft.operatorName}, ${draft.productName}, ${draft.activeSubstance},
        CAST(${draft.quantity} AS DECIMAL(14,4)), ${draft.quantityUnit}, ${draft.notes}, ${actor.id}, ${now}
      )
    `);
    tx.audit({
      table: 'vineyard.notebook_operation',
      rowId: id,
      action: 'INSERT',
      before: null,
      after: {
        id,
        parcel_id: parcel.id,
        done_on: draft.doneOn,
        campaign,
        kind: draft.kind,
        operator_name: draft.operatorName,
        product_name: draft.productName,
      },
    });
  });
  const listed = await listOperations(writer, new Request(`http://localhost/v1/vineyard-notebook/operations?parcel_id=${draft.parcelId}`));
  const created = listed.items.find((item) => item.id === id);
  if (!created) throw domainError('WC_NOT_FOUND');
  return created;
}

async function loadParcel(tx: Tx, id: string): Promise<{ id: string; is_active: boolean } | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, is_active FROM vineyard.parcel WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) return null;
  return { id: uuidText(row.id), is_active: bool(row.is_active) };
}

function parseOperation(body: unknown): OperationDraft {
  const record = objectBody(body);
  const errors = new FieldBag();
  rejectUnknown(record, CREATE_KEYS, errors);
  const parcelId = textValue(record.parcel_id, 'parcel_id', errors, { required: true });
  if (parcelId && !isUuid(parcelId)) errors.add('parcel_id', 'Identificador no válido');
  const doneOn = textValue(record.done_on, 'done_on', errors, { required: true });
  if (doneOn && !isCalendarDate(doneOn)) errors.add('done_on', 'Fecha no válida (AAAA-MM-DD)');
  const kind = enumValue(record.kind, 'kind', OPERATION_KINDS, errors);
  const operatorName = textValue(record.operator_name, 'operator_name', errors, { max: 120 });
  const productName = textValue(record.product_name, 'product_name', errors, { max: 160 });
  const substance = textValue(record.active_substance, 'active_substance', errors, { max: 200 });
  const quantity = hasKey(record, 'quantity')
    ? parseQuantity(record.quantity, 'quantity', errors, 4, '9999999999.9999')
    : null;
  const quantityUnit = textValue(record.quantity_unit, 'quantity_unit', errors, { max: 16 });
  if (quantity && !quantityUnit) errors.add('quantity_unit', 'Obligatorio si indicas la cantidad');
  if (!quantity && quantityUnit) errors.add('quantity', 'Obligatorio si indicas la unidad');
  const notes = textValue(record.notes, 'notes', errors, { max: 1000 });
  errors.fail();
  if (!parcelId || !doneOn || !kind) throw domainError('WC_VALIDATION');
  return {
    parcelId: parcelId.toLowerCase(),
    doneOn,
    kind,
    operatorName,
    productName,
    activeSubstance: substance,
    quantity,
    quantityUnit,
    notes,
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'Se esperaba un objeto' });
  }
  return body as Record<string, unknown>;
}
