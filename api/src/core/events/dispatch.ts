import { createHmac } from 'node:crypto';
import type { Config } from '../../config';
import { sql } from '../db/sql';
import type { Actor, Writer } from '../db/writer';
import { newId } from '../ids';
import { ensureNotifications, failureNotice, noticeFor } from './notify';

const MAX_ATTEMPTS = 5;
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000];
const CLAIM_MS = 2 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LIMIT = 50;

export interface DispatchResult {
  delivered: number;
  internal: number;
  retried: number;
  failed: number;
}

export interface DispatchDeps {
  writer: Writer;
  config: Config;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
  timeoutMs?: number;
  now?: () => Date;
  limit?: number;
}

interface OutboxEvent {
  id: string;
  idNum: number;
  type: string;
  legalEntityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  attempts: number;
}

type Outcome = 'delivered' | 'internal' | 'retried' | 'failed';

class DeliveryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DeliveryError';
  }
}

export function cvbotConfigState(config: Config): 'ready' | 'off' | 'incomplete' {
  const hasUrl = Boolean(config.cvbotEventsUrl);
  const hasKey = Boolean(config.cvbotEventsHmacKey);
  if (hasUrl && hasKey) return 'ready';
  if (hasUrl || hasKey) return 'incomplete';
  return 'off';
}

export async function dispatchOutbox(deps: DispatchDeps): Promise<DispatchResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now?.() ?? new Date();
  const limit = clampLimit(deps.limit ?? DEFAULT_LIMIT);
  const state = cvbotConfigState(deps.config);
  if (state === 'incomplete') {
    log(JSON.stringify({ level: 'error', component: 'outbox', code: 'CVBOT_CONFIG_INCOMPLETE' }));
  }
  // DuckDB no admite FOR UPDATE SKIP LOCKED. El arrendamiento del escritor
  // y el scheduler (solo el líder, sin solapar el mismo job) serializan la entrega.
  const rows = await deps.writer.read<Record<string, unknown>>(sql`
    SELECT id, event_type, legal_entity_id, payload, occurred_at, attempts
    FROM ops.outbox_event
    WHERE published_at IS NULL
      AND attempts < ${MAX_ATTEMPTS}
      AND available_at <= ${now}
    ORDER BY id
    LIMIT ${limit}
  `);
  const result: DispatchResult = { delivered: 0, internal: 0, retried: 0, failed: 0 };
  for (const row of rows) {
    const event = normalize(row);
    const outcome = await dispatchOne(deps, event, now, state, log);
    result[outcome] += 1;
  }
  return result;
}

async function dispatchOne(
  deps: DispatchDeps,
  event: OutboxEvent,
  now: Date,
  state: 'ready' | 'off' | 'incomplete',
  log: (line: string) => void,
): Promise<Outcome> {
  if (state !== 'ready') {
    await deps.writer.withWrite(actor(), async (tx) => {
      await ensureNotifications(tx, event.id, event.legalEntityId, noticeFor(event.type, event.payload));
      tx.write(sql`
        UPDATE ops.outbox_event
        SET published_at = ${now}, last_error = 'delivered-internal'
        WHERE id = ${event.idNum} AND published_at IS NULL
      `);
    });
    log(JSON.stringify({
      level: 'info',
      component: 'outbox',
      event_id: event.idNum,
      type: event.type,
      result: 'delivered-internal',
    }));
    return 'internal';
  }

  const claimUntil = new Date(now.getTime() + CLAIM_MS);
  await deps.writer.withWrite(actor(), async (tx) => {
    await ensureNotifications(tx, event.id, event.legalEntityId, noticeFor(event.type, event.payload));
    tx.write(sql`
      UPDATE ops.outbox_event
      SET available_at = ${claimUntil}
      WHERE id = ${event.idNum}
        AND published_at IS NULL
        AND attempts = ${event.attempts}
    `);
  });

  const url = deps.config.cvbotEventsUrl;
  const key = deps.config.cvbotEventsHmacKey;
  if (!url || !key) {
    throw new DeliveryError('network');
  }
  try {
    await postEvent(deps, event, url, key);
  } catch (error) {
    const code = error instanceof DeliveryError ? error.code : 'network';
    return settleFailure(deps, event, now, code, log);
  }

  await deps.writer.withWrite(actor(), async (tx) => {
    tx.write(sql`
      UPDATE ops.outbox_event
      SET published_at = ${now}, last_error = NULL
      WHERE id = ${event.idNum} AND published_at IS NULL
    `);
  });
  log(JSON.stringify({
    level: 'info',
    component: 'outbox',
    event_id: event.idNum,
    type: event.type,
    result: 'delivered',
  }));
  return 'delivered';
}

async function settleFailure(
  deps: DispatchDeps,
  event: OutboxEvent,
  now: Date,
  code: string,
  log: (line: string) => void,
): Promise<Outcome> {
  const nextAttempts = event.attempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    await deps.writer.withWrite(actor(), async (tx) => {
      tx.write(sql`
        UPDATE ops.outbox_event
        SET attempts = ${MAX_ATTEMPTS}, last_error = 'failed', available_at = ${now}
        WHERE id = ${event.idNum} AND published_at IS NULL
      `);
      await ensureNotifications(tx, event.id, event.legalEntityId, failureNotice(event.type, event.payload));
    });
    log(JSON.stringify({
      level: 'error',
      component: 'outbox',
      event_id: event.idNum,
      type: event.type,
      result: 'failed',
      attempt: MAX_ATTEMPTS,
    }));
    return 'failed';
  }
  const waitMs = RETRY_MS[Math.min(nextAttempts - 1, RETRY_MS.length - 1)] ?? RETRY_MS[RETRY_MS.length - 1] ?? 30 * 60_000;
  const nextAt = new Date(now.getTime() + waitMs);
  await deps.writer.withWrite(actor(), async (tx) => {
    tx.write(sql`
      UPDATE ops.outbox_event
      SET attempts = ${nextAttempts}, available_at = ${nextAt}, last_error = ${code}
      WHERE id = ${event.idNum} AND published_at IS NULL
    `);
  });
  log(JSON.stringify({
    level: 'info',
    component: 'outbox',
    event_id: event.idNum,
    type: event.type,
    result: 'retry',
    attempt: nextAttempts,
    wait_ms: waitMs,
  }));
  return 'retried';
}

async function postEvent(deps: DispatchDeps, event: OutboxEvent, url: string, key: string): Promise<void> {
  const body = JSON.stringify({
    event_id: event.idNum,
    type: event.type,
    occurred_at: event.occurredAt,
    data: event.payload,
  });
  const signature = `sha256=${createHmac('sha256', key).update(body, 'utf8').digest('hex')}`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-WineCore-Signature': signature,
      },
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status < 200 || response.status >= 300) {
      throw new DeliveryError(httpCode(response.status));
    }
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    if (controller.signal.aborted) throw new DeliveryError('timeout');
    throw new DeliveryError('network');
  } finally {
    clearTimeout(timer);
  }
}

function httpCode(status: number): string {
  if (!Number.isInteger(status) || status < 100 || status > 599) return 'http_error';
  return `http_${status}`;
}

function normalize(row: Record<string, unknown>): OutboxEvent {
  const id = String(row.id);
  if (!/^\d+$/.test(id)) throw new Error('Identificador de evento no válido');
  const idNum = Number(id);
  if (!Number.isSafeInteger(idNum)) throw new Error('Identificador de evento no válido');
  return {
    id,
    idNum,
    type: String(row.event_type),
    legalEntityId: row.legal_entity_id == null ? null : String(row.legal_entity_id),
    payload: asPayload(row.payload),
    occurredAt: String(row.occurred_at),
    attempts: Number(row.attempts),
  };
}

function asPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asPayload(JSON.parse(value) as unknown);
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function actor(): Actor {
  return { type: 'system', id: 'outbox-dispatch', requestId: newId() };
}

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, 100);
}
