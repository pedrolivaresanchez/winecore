import type { Writer } from '../core/db/writer';
import {
  closeInventoryCount,
  createInventoryCount,
  getInventoryCount,
  listInventoryCounts,
  putInventoryCountLines,
  submitInventoryCount,
} from '../core/inventory/service/counts.service';
import { actorFrom, countId, parseLimit, readJson } from './stock-http';
import { isUuid } from '../core/inventory/service/rows';
import { DomainError } from '../core/errors';

export async function listInventoryCountsRoute(writer: Writer, request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('legal_entity_id')?.trim() ?? '';
  if (raw !== '' && !isUuid(raw)) {
    throw new DomainError('WC_VALIDATION', 422, 'Identificador de entidad no válido.', { legal_entity_id: 'UUID no válido' });
  }
  const cursor = url.searchParams.get('cursor')?.trim() ?? '';
  if (cursor !== '' && !isUuid(cursor)) {
    throw new DomainError('WC_VALIDATION', 422, 'Cursor no válido.', { cursor: 'Cursor no válido' });
  }
  return listInventoryCounts(
    writer,
    raw === '' ? null : raw.toLowerCase(),
    parseLimit(url.searchParams.get('limit'), 50, 200),
    cursor === '' ? null : cursor.toLowerCase(),
  );
}

export async function getInventoryCountRoute(writer: Writer, id: string) {
  return getInventoryCount(writer, countId({ id }));
}

export async function postInventoryCountRoute(writer: Writer, request: Request) {
  return createInventoryCount(writer, actorFrom(request), await readJson(request));
}

export async function putInventoryCountLinesRoute(
  writer: Writer,
  request: Request,
  params: { id?: string },
) {
  return putInventoryCountLines(writer, actorFrom(request), countId(params), await readJson(request));
}

export async function closeInventoryCountRoute(
  writer: Writer,
  request: Request,
  params: { id?: string },
) {
  return closeInventoryCount(writer, actorFrom(request), countId(params));
}

export async function submitInventoryCountRoute(
  writer: Writer,
  request: Request,
  params: { id?: string },
) {
  return submitInventoryCount(writer, actorFrom(request), countId(params));
}
