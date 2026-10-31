import { requestIdFor, sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import {
  createSeries,
  deactivateSeries,
  isDocType,
  listSeries,
  readSeries,
  type SeriesFilter,
} from '../core/series';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listNumberSeries(writer: Writer, request: Request) {
  sessionOf(request);
  const items = await listSeries((statement) => writer.read(statement), parseFilter(new URL(request.url)));
  return { items };
}

export async function createNumberSeries(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const id = await writer.withWrite(actor(user.id, request), (tx) => createSeries(tx, raw));
  return readSeries((statement) => writer.read(statement), id);
}

export async function deactivateNumberSeries(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  await writer.withWrite(actor(user.id, request), (tx) => deactivateSeries(tx, id));
  return readSeries((statement) => writer.read(statement), id);
}

function parseFilter(url: URL): SeriesFilter {
  const fields: Record<string, string> = {};
  const filter: SeriesFilter = {};
  const entity = url.searchParams.get('legal_entity_id');
  if (entity) {
    if (!UUID.test(entity)) fields.legal_entity_id = 'Identificador no válido';
    else filter.legalEntityId = entity.toLowerCase();
  }
  const doc = url.searchParams.get('doc_type');
  if (doc) {
    if (!isDocType(doc)) fields.doc_type = 'Tipo de documento no válido';
    else filter.docType = doc;
  }
  const year = url.searchParams.get('year');
  if (year) {
    if (!/^\d{4}$/.test(year)) fields.year = 'Año no válido';
    else {
      const value = Number(year);
      if (value < 2020 || value > 2100) fields.year = 'El año debe estar entre 2020 y 2100';
      else filter.year = value;
    }
  }
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return filter;
}

function actor(userId: string, request: Request) {
  return { type: 'user' as const, id: userId, requestId: requestIdFor(request) };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}
