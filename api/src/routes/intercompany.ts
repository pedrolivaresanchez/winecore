import { sessionOf } from '../auth/guard';
import type { Tx, Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { newId } from '../core/ids';
import { businessDate } from '../core/time';
import {
  closeSettlement,
  closeSettlementById,
  ensureOpenSettlement,
  listSettlementIndex,
  readSettlement,
  requestIntercompanyInvoice,
  type SettlementIndexItem,
  type SettlementView,
} from '../core/intercompany/settlement';
import {
  activateTariff,
  createTariff,
  listTariffs,
  parseTariffBody,
  retireTariff,
  tariffById,
  updateDraftTariff,
  type TariffRecord,
} from '../core/intercompany/tariff';

export async function getTariffs(writer: Writer): Promise<{ items: ReturnType<typeof tariffJson>[] }> {
  const items = await listTariffs(readOnly(writer));
  return { items: items.map(tariffJson) };
}

export async function postTariff(writer: Writer, request: Request): Promise<{ status: number; body: ReturnType<typeof tariffJson> }> {
  const user = sessionOf(request);
  const input = parseTariffBody(await readJson(request), false);
  const now = new Date();
  const record = await writer.withWrite(actor(user, request), (tx) => createTariff(tx, input, user.id, now));
  return { status: 201, body: tariffJson(record) };
}

export async function patchTariff(writer: Writer, request: Request, id: string): Promise<ReturnType<typeof tariffJson>> {
  requireUuid(id);
  const user = sessionOf(request);
  const raw = await readJson(request);
  const record = await writer.withWrite(actor(user, request), async (tx) => {
    const current = await tariffById(tx, id);
    const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const hasValidTo = Object.prototype.hasOwnProperty.call(body, 'valid_to');
    const input = parseTariffBody({
      seller_entity_id: current.sellerEntityId,
      buyer_entity_id: current.buyerEntityId,
      base_price_list_id: body.base_price_list_id ?? current.basePriceListId,
      discount_pct: body.discount_pct ?? current.discountPct,
      valid_from: body.valid_from ?? current.validFrom,
      valid_to: hasValidTo ? body.valid_to : current.validTo,
      advisor_validation: body.advisor_validation ?? current.advisorValidation,
    }, false);
    return updateDraftTariff(tx, id, input);
  });
  return tariffJson(record);
}

export async function postActivateTariff(writer: Writer, request: Request, id: string): Promise<ReturnType<typeof tariffJson>> {
  requireUuid(id);
  const user = sessionOf(request);
  const record = await writer.withWrite(actor(user, request), (tx) => activateTariff(tx, id));
  return tariffJson(record);
}

export async function postRetireTariff(writer: Writer, request: Request, id: string): Promise<ReturnType<typeof tariffJson>> {
  requireUuid(id);
  const user = sessionOf(request);
  const record = await writer.withWrite(actor(user, request), (tx) => retireTariff(tx, id));
  return tariffJson(record);
}

export async function getTariff(writer: Writer, id: string): Promise<ReturnType<typeof tariffJson>> {
  requireUuid(id);
  return tariffJson(await tariffById(readOnly(writer), id));
}

export async function getSettlement(
  writer: Writer,
  request: Request,
): Promise<SettlementView | { items: SettlementIndexItem[] }> {
  const period = new URL(request.url).searchParams.get('period');
  const today = businessDate(new Date());
  if (period == null || period.trim() === '') return listSettlementIndex(readOnly(writer));
  return readSettlement(readOnly(writer), period.trim(), today);
}

export async function postSettlement(writer: Writer, request: Request): Promise<SettlementView> {
  const user = sessionOf(request);
  const body = await readObject(request);
  const period = typeof body.period === 'string' ? body.period : '';
  const now = new Date();
  return writer.withWrite(actor(user, request), (tx) => ensureOpenSettlement(tx, {
    period,
    today: businessDate(now),
    actorId: user.id,
    now,
  }));
}

export async function postClosePeriod(writer: Writer, request: Request): Promise<SettlementView> {
  const user = sessionOf(request);
  const body = await readObject(request);
  const period = typeof body.period === 'string' ? body.period : '';
  const now = new Date();
  return writer.withWrite(actor(user, request), (tx) => closeSettlement(tx, {
    period,
    today: businessDate(now),
    actorId: user.id,
    now,
    belowCostAcknowledged: body.below_cost_acknowledged === true,
  }));
}

export async function postCloseSettlement(writer: Writer, request: Request, id: string): Promise<SettlementView> {
  requireUuid(id);
  const user = sessionOf(request);
  const body = await readObject(request);
  const now = new Date();
  return writer.withWrite(actor(user, request), (tx) => closeSettlementById(tx, id, {
    today: businessDate(now),
    actorId: user.id,
    now,
    belowCostAcknowledged: body.below_cost_acknowledged === true,
  }));
}

export async function postInvoiceRequest(writer: Writer, request: Request, id: string): Promise<SettlementView> {
  requireUuid(id);
  const user = sessionOf(request);
  const now = new Date();
  return writer.withWrite(actor(user, request), (tx) => requestIntercompanyInvoice(
    tx,
    id,
    user.id,
    now,
    businessDate(now),
  ));
}

function tariffJson(record: TariffRecord) {
  return {
    id: record.id,
    seller_entity_id: record.sellerEntityId,
    buyer_entity_id: record.buyerEntityId,
    base_price_list_id: record.basePriceListId,
    discount_pct: record.discountPct,
    valid_from: record.validFrom,
    valid_to: record.validTo,
    status: record.status,
    advisor_validation: record.advisorValidation,
    created_by: record.createdBy,
    created_at: record.createdAt,
  };
}

function readOnly(writer: Writer): Tx {
  return {
    read: (statement) => writer.read(statement),
    write() {
      throw domainError('WC_VALIDATION');
    },
    audit() {
      throw domainError('WC_VALIDATION');
    },
  };
}

function actor(user: { id: string }, request: Request) {
  return {
    type: 'user' as const,
    id: user.id,
    requestId: request.headers.get('x-request-id') ?? newId(),
  };
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw domainError('WC_NOT_FOUND');
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const value = await readJson(request);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  return value as Record<string, unknown>;
}
