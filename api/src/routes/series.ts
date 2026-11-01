import { requestIdFor, sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import {
  createSeries,
  deactivateSeries,
  ensureSeriesForYear,
  isDocType,
  listSeries,
  numberingProposal,
  openNumbering,
  readSeries,
  type DocType,
  type EnsureSeriesInput,
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

const MAX_BULK = 64;

export async function createNumberSeriesBulk(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const items = parseBulk(raw);
  const created = await writer.withWrite(actor(user.id, request), async (tx) => {
    const out = [];
    for (const item of items) out.push(await ensureSeriesForYear(tx, item));
    return out;
  });
  return { items: created };
}

export async function getNumberingProposal(writer: Writer, request: Request) {
  sessionOf(request);
  const url = new URL(request.url);
  return numberingProposal(writer, {
    legalEntityId: url.searchParams.get('legal_entity_id') ?? '',
    docType: url.searchParams.get('doc_type') ?? '',
    year: Number(url.searchParams.get('year') ?? ''),
  });
}

export async function openNumberSeries(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const id = await writer.withWrite(
    { ...actor(user.id, request), reason: 'numeración de la primera factura del año' },
    (tx) => openNumbering(tx, {
      legalEntityId: typeof body.legal_entity_id === 'string' ? body.legal_entity_id : '',
      docType: typeof body.doc_type === 'string' ? body.doc_type : '',
      year: typeof body.year === 'number' ? body.year : Number.NaN,
      choice: body.choice,
      nextValue: body.next_value,
    }),
  );
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

function parseBulk(raw: unknown): EnsureSeriesInput[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.items)) {
    throw domainError('WC_VALIDATION', { items: 'Indica la lista de series' });
  }
  if (body.items.length === 0) throw domainError('WC_VALIDATION', { items: 'La lista está vacía' });
  if (body.items.length > MAX_BULK) {
    throw domainError('WC_VALIDATION', { items: `Como máximo ${MAX_BULK} series` });
  }
  const seen = new Set<string>();
  const items: EnsureSeriesInput[] = [];
  const fields: Record<string, string> = {};
  body.items.forEach((entry, index) => {
    const parsed = parseBulkItem(entry, index, fields);
    if (!parsed) return;
    const key = `${parsed.legalEntityId}|${parsed.docType}|${parsed.year}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(parsed);
  });
  if (Object.keys(fields).length > 0) throw domainError('WC_VALIDATION', fields);
  return items;
}

function parseBulkItem(entry: unknown, index: number, fields: Record<string, string>): EnsureSeriesInput | null {
  const prefix = `items.${index}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fields[prefix] = 'Cada serie debe ser un objeto';
    return null;
  }
  const body = entry as Record<string, unknown>;
  const legalEntityId = typeof body.legal_entity_id === 'string' ? body.legal_entity_id.trim().toLowerCase() : '';
  if (!UUID.test(legalEntityId)) fields[`${prefix}.legal_entity_id`] = 'Identificador no válido';
  const docTypeRaw = typeof body.doc_type === 'string' ? body.doc_type : '';
  if (!isDocType(docTypeRaw)) fields[`${prefix}.doc_type`] = 'Tipo de documento no válido';
  const code = typeof body.code === 'string' ? body.code : '';
  if (!/^[A-Z]{1,4}$/.test(code)) fields[`${prefix}.code`] = 'El código debe tener de 1 a 4 letras mayúsculas';
  const year = body.year;
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2020 || year > 2100) {
    fields[`${prefix}.year`] = 'El año debe estar entre 2020 y 2100';
  }
  const seriesPrefix = typeof body.prefix === 'string' ? body.prefix : '';
  if (seriesPrefix.length < 1 || seriesPrefix.length > 12) fields[`${prefix}.prefix`] = 'El prefijo debe tener entre 1 y 12 caracteres';
  const padding = body.padding === undefined ? 4 : body.padding;
  if (typeof padding !== 'number' || !Number.isInteger(padding) || padding < 2 || padding > 8) {
    fields[`${prefix}.padding`] = 'El relleno debe estar entre 2 y 8';
  }
  const nextValue = body.next_value === undefined ? 1 : body.next_value;
  if (typeof nextValue !== 'number' || !Number.isInteger(nextValue) || nextValue < 1) {
    fields[`${prefix}.next_value`] = 'El primer número debe ser un entero desde 1';
  }
  const isDefault = body.is_default === undefined ? true : body.is_default;
  const verifactu = body.verifactu === undefined ? false : body.verifactu;
  if (typeof isDefault !== 'boolean') fields[`${prefix}.is_default`] = 'Debe ser verdadero o falso';
  if (typeof verifactu !== 'boolean') fields[`${prefix}.verifactu`] = 'Debe ser verdadero o falso';
  if (
    !isDocType(docTypeRaw) || typeof year !== 'number' || typeof padding !== 'number'
    || typeof nextValue !== 'number' || typeof isDefault !== 'boolean' || typeof verifactu !== 'boolean'
  ) {
    return null;
  }
  const docType: DocType = docTypeRaw;
  return {
    legalEntityId,
    docType,
    code,
    year,
    prefix: seriesPrefix,
    padding,
    isDefault,
    verifactu,
    nextValue,
  };
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
