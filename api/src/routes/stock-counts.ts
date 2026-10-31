import type { Writer } from '../core/db/writer';
import {
  closeInventoryCount,
  createInventoryCount,
  putInventoryCountLines,
  submitInventoryCount,
} from '../core/inventory/service/counts.service';
import { actorFrom, countId, readJson } from './stock-http';

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
