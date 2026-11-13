import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import {
  applySettings,
  buildValuation,
  requireList,
  type SettingsPatch,
} from '../core/inventory/service/valuation.service';
import { eurField, isValuationList, parseEur, type ValuationListCode } from '../core/inventory/valuation';
import { actorFrom, readJson } from './stock-http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VESSEL = /^[A-Z0-9-]{2,20}$/;

export async function stockValuation(writer: Writer, request: Request) {
  const list = requireList(new URL(request.url).searchParams.get('list'));
  return buildValuation(writer, list);
}

export async function valuationSettings(writer: Writer, request: Request) {
  const list = requireList(new URL(request.url).searchParams.get('list'));
  const body = await buildValuation(writer, list);
  return { rates: body.rates, worthless: body.worthless, list: body.list, updated_at: body.rates.updated_at };
}

export async function putValuationSettings(writer: Writer, request: Request) {
  const body = await readJson(request);
  const patch = parsePatch(body);
  const requested = new URL(request.url).searchParams.get('list');
  const bodyList = typeof body === 'object' && body !== null && 'list' in body && typeof body.list === 'string'
    ? body.list
    : null;
  const list = requireList(requested ?? bodyList ?? patch.price?.list ?? 'distributor');
  await applySettings(writer, actorFrom(request), patch);
  return buildValuation(writer, list);
}

function parsePatch(body: unknown): SettingsPatch {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
  const record = body as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if ('demijohn_eur_per_litre' in record) patch.demijohnEurPerLitre = euros(record.demijohn_eur_per_litre, 'demijohn_eur_per_litre');
  if ('bulk_eur_per_litre' in record) patch.bulkEurPerLitre = euros(record.bulk_eur_per_litre, 'bulk_eur_per_litre');
  if ('bulk_wines' in record) patch.bulkWines = wines(record.bulk_wines);
  if ('price' in record) patch.price = price(record.price);
  if ('worthless' in record) patch.worthless = worthless(record.worthless);
  if (!patch.demijohnEurPerLitre && !patch.bulkEurPerLitre && !patch.bulkWines && !patch.price && !patch.worthless) {
    throw domainError('WC_VALIDATION', { body: 'No hay nada que guardar' });
  }
  return patch;
}

function euros(raw: unknown, field: string): string {
  try {
    return parseEur(raw, field);
  } catch (error) {
    const hit = eurField(error);
    throw domainError('WC_VALIDATION', { [hit?.field ?? field]: hit?.message ?? 'Importe no válido' });
  }
}

function wines(raw: unknown): { wineId: string; eurPerLitre: string }[] {
  if (!Array.isArray(raw)) throw domainError('WC_VALIDATION', { bulk_wines: 'Tiene que ser una lista' });
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw domainError('WC_VALIDATION', { bulk_wines: `La fila ${index + 1} no es válida` });
    }
    const row = item as Record<string, unknown>;
    const wineId = uuidOf(row.wine_id, 'wine_id');
    if (seen.has(wineId)) throw domainError('WC_VALIDATION', { wine_id: 'El vino está repetido' });
    seen.add(wineId);
    return { wineId, eurPerLitre: euros(row.eur_per_litre, 'eur_per_litre') };
  });
}

function price(raw: unknown): SettingsPatch['price'] {
  if (typeof raw !== 'object' || raw === null) throw domainError('WC_VALIDATION', { price: 'No es válido' });
  const row = raw as Record<string, unknown>;
  const list = typeof row.list === 'string' ? row.list : '';
  if (!isValuationList(list)) throw domainError('WC_VALIDATION', { list: 'La tarifa no es válida' });
  const productId = uuidOf(row.product_id, 'product_id');
  const unitPrice = row.unit_price == null || row.unit_price === '' ? null : euros(row.unit_price, 'unit_price');
  return { productId, list: list as ValuationListCode, unitPrice };
}

function worthless(raw: unknown): SettingsPatch['worthless'] {
  if (typeof raw !== 'object' || raw === null) throw domainError('WC_VALIDATION', { worthless: 'No es válido' });
  const row = raw as Record<string, unknown>;
  if (row.subject !== 'vessel' && row.subject !== 'lot') {
    throw domainError('WC_VALIDATION', { subject: 'Tiene que ser recipiente o lote' });
  }
  const enabled = row.enabled === true;
  if (row.subject === 'vessel') {
    const key = typeof row.subject_key === 'string' ? row.subject_key.trim() : '';
    if (!VESSEL.test(key)) throw domainError('WC_VALIDATION', { subject_key: 'El código del recipiente no es válido' });
    return { subject: 'vessel', subjectKey: key, enabled };
  }
  return { subject: 'lot', subjectKey: uuidOf(row.subject_key, 'subject_key'), enabled };
}

function uuidOf(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID.test(text)) throw domainError('WC_VALIDATION', { [field]: 'Identificador no válido' });
  return text;
}
