import { sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { actorOf, asRecord, pathId, readJson } from '../core/sales/db';
import {
  createDeliveryNote,
  createReturn,
  dispatch,
  getDelivery,
  issueDeliveryNote,
  listDeliveries,
  markDelivered,
  markNotInvoiceable,
  patchDelivery,
  uninvoicedLines,
  voidDelivery,
} from '../core/sales/delivery';
import { confirmShrinkage, createIncident } from '../core/sales/incidents';

export function getNotes(writer: Writer, request: Request) {
  sessionOf(request);
  return listDeliveries(writer, request);
}

export function getUninvoiced(writer: Writer, request: Request) {
  sessionOf(request);
  return uninvoicedLines(writer);
}

export function getNote(writer: Writer, request: Request, id: string) {
  sessionOf(request);
  return getDelivery(writer, id);
}

export async function postNote(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const actor = actorOf(user, request);
  const body = await writer.withWrite(actor, (tx) => createDeliveryNote(tx, actor, raw));
  return { status: 201, body };
}

export async function patchNote(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, (tx) => patchDelivery(tx, pathId(id), raw));
}

export async function postIssue(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, (tx) => issueDeliveryNote(tx, { id: pathId(id), actor }));
}

export async function postDispatch(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await request.json().catch(() => ({}));
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const actor = actorOf(user, request);
  const tracking = typeof body.tracking_ref === 'string' ? body.tracking_ref : null;
  const carrier = typeof body.carrier_contact_id === 'string' ? body.carrier_contact_id : null;
  return writer.withWrite(actor, (tx) => dispatch(tx, {
    id: pathId(id),
    actor,
    trackingRef: tracking,
    carrierContactId: carrier,
  }));
}

export async function postDeliver(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  return writer.withWrite(actorOf(user, request), (tx) => markDelivered(tx, pathId(id)));
}

export async function postVoid(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = asRecord(await readJson(request));
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const actor = actorOf(user, request, reason);
  return writer.withWrite(actor, (tx) => voidDelivery(tx, actor, pathId(id), reason));
}

export async function postReturn(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const actor = actorOf(user, request);
  const body = await writer.withWrite(actor, (tx) => createReturn(tx, actor, pathId(id), raw));
  return { status: 201, body };
}

export async function postNotInvoiceable(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const body = asRecord(await readJson(request));
  const reason = typeof body.reason === 'string' ? body.reason : '';
  return writer.withWrite(actorOf(user, request), (tx) => markNotInvoiceable(tx, pathId(id), reason));
}

export async function postIncident(writer: Writer, request: Request, id: string) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, (tx) => createIncident(tx, actor, pathId(id), raw));
}

export async function postConfirmLoss(writer: Writer, request: Request, id: string, incidentId: string) {
  const user = sessionOf(request);
  const actor = actorOf(user, request);
  return writer.withWrite(actor, (tx) => confirmShrinkage(tx, actor, pathId(id), pathId(incidentId)));
}
