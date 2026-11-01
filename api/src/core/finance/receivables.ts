import { Decimal } from 'decimal.js';
import { entityScope, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { assertScope } from './payments';
import {
  addCalendarDays,
  ageingOf,
  AGING_BUCKETS,
  compact,
  decimalOf,
  moneyText,
  normalizeAging,
  optionalText,
  parseUuid,
  todayMadrid,
  type AgingBucket,
} from './support';
import { findEntity, listOpenDocuments, type PayableDocument } from './store';

const ZERO = new Decimal(0);

type Entity = { id: string; code: string };

export async function listReceivables(writer: Writer, user: UserCtx, request: Request, now = new Date()) {
  const url = new URL(request.url);
  const entityValue = optionalText(url.searchParams.get('entity'), 'entity', 36);
  const contactRaw = optionalText(url.searchParams.get('contact_id') ?? url.searchParams.get('counterparty_id'), 'contact_id', 36);
  const contactId = contactRaw ? parseUuid(contactRaw, 'contact_id') : null;
  const agingRaw = optionalText(url.searchParams.get('aging'), 'aging', 8);
  const aging = agingRaw ? normalizeAging(agingRaw) : null;
  const direction = directionOf(url.searchParams.get('direction'));
  const today = todayMadrid(now);
  const scope = entityScope(user, 'finance.read');
  let entityId: string | null = null;
  if (entityValue) {
    const entity = await findEntity(writer, entityValue);
    if (!entity) throw domainError('WC_VALIDATION', { entity: 'La entidad no existe' });
    assertScope(user, 'finance.read', entity.id);
    entityId = entity.id;
  } else if (scope && scope.length === 0) {
    return empty(today);
  }
  const entities = (await writer.read<{ id: string; code: string }>('SELECT id, code FROM core.legal_entity ORDER BY code'))
    .map((row) => ({ id: String(row.id).toLowerCase(), code: String(row.code) }))
    .filter((entity) => (entityId ? entity.id === entityId : scope === null || scope.some((id) => id.toLowerCase() === entity.id)));
  const codes = new Map(entities.map((entity) => [entity.id, entity.code]));
  const docs = (await listOpenDocuments(writer, entityId))
    .filter((doc) => doc.direction === direction)
    .filter((doc) => scope === null || entityId !== null || scope.some((id) => id.toLowerCase() === doc.legalEntityId))
    .filter((doc) => !contactId || doc.counterpartyId === contactId.toLowerCase());
  const collected = await collectedThisMonth(writer, { direction, today, entities, contactId });
  const summary = summaryOf(docs, entities, today, collected);
  const groups = new Map<string, {
    key: string;
    contact_id: string | null;
    customer_name: string;
    amounts: Record<AgingBucket | 'total' | 'overdue', Decimal>;
    items: Array<Record<string, unknown>>;
  }>();
  for (const doc of docs) {
    const age = ageingOf(doc.dueDate, doc.issueDate, today);
    if (aging && age.bucket !== aging) continue;
    const key = groupKey(doc);
    const group = groups.get(key) ?? {
      key,
      contact_id: doc.counterpartyId,
      customer_name: doc.counterpartyName ?? 'Sin cliente',
      amounts: bucketMap(),
      items: [],
    };
    group.amounts[age.bucket] = group.amounts[age.bucket].plus(doc.outstanding);
    group.amounts.total = group.amounts.total.plus(doc.outstanding);
    if (age.isOverdue) group.amounts.overdue = group.amounts.overdue.plus(doc.outstanding);
    group.items.push(itemOf(doc, age, codes));
    groups.set(key, group);
  }
  const totals = bucketMap();
  const listed = [...groups.values()]
    .map((group) => {
      for (const bucket of AGING_BUCKETS) totals[bucket] = totals[bucket].plus(group.amounts[bucket]);
      totals.total = totals.total.plus(group.amounts.total);
      totals.overdue = totals.overdue.plus(group.amounts.overdue);
      group.items.sort((left, right) => String(left.due_date ?? left.issue_date).localeCompare(String(right.due_date ?? right.issue_date)));
      return {
        key: group.key,
        contact_id: group.contact_id,
        customer_name: group.customer_name,
        amounts: renderBuckets(group.amounts),
        items: group.items,
      };
    })
    .sort((left, right) => left.customer_name.localeCompare(right.customer_name, 'es'));
  return {
    as_of: today,
    status: totals.total.eq(0) ? 'clear' : 'open',
    groups: listed,
    totals: renderBuckets(totals),
    summary,
  };
}

/** Sin contacto, las partidas de Holded se agrupan por el nombre del documento (sin mayúsculas, tildes ni espacios de más). */
function groupKey(doc: PayableDocument): string {
  if (doc.counterpartyId) return doc.counterpartyId;
  const name = doc.counterpartyName ? compact(doc.counterpartyName) : '';
  return name === '' ? 'none' : `name:${name}`;
}

/** Sobre todo lo pendiente de la entidad, contacto y sentido pedidos; no aplica el filtro de antigüedad. */
function summaryOf(docs: PayableDocument[], entities: Entity[], today: string, collected: Decimal) {
  const horizon = addCalendarDays(today, 30);
  let pending = ZERO;
  let overdue = ZERO;
  let next30 = ZERO;
  const byEntity = new Map(entities.map((entity) => [entity.id, { code: entity.code, pending: ZERO, overdue: ZERO }]));
  for (const doc of docs) {
    const late = ageingOf(doc.dueDate, doc.issueDate, today).isOverdue;
    pending = pending.plus(doc.outstanding);
    if (late) overdue = overdue.plus(doc.outstanding);
    if (doc.dueDate !== null && doc.dueDate >= today && doc.dueDate <= horizon) next30 = next30.plus(doc.outstanding);
    const row = byEntity.get(doc.legalEntityId);
    if (row) {
      row.pending = row.pending.plus(doc.outstanding);
      if (late) row.overdue = row.overdue.plus(doc.outstanding);
    }
  }
  return {
    pending_total: moneyText(pending),
    overdue_total: moneyText(overdue),
    due_next_30: moneyText(next30),
    collected_this_month: moneyText(collected),
    by_entity: [...byEntity.values()].map((row) => ({
      entity_code: row.code,
      pending: moneyText(row.pending),
      overdue: moneyText(row.overdue),
    })),
  };
}

/** Pagos registrados (no anulados) con fecha valor desde el día 1 del mes hasta hoy. */
async function collectedThisMonth(writer: Writer, input: {
  direction: 'in' | 'out';
  today: string;
  entities: Entity[];
  contactId: string | null;
}): Promise<Decimal> {
  if (input.entities.length === 0) return ZERO;
  const rows = await writer.read<{ amount: unknown }>(sql`
    SELECT coalesce(sum(amount), 0) AS amount
    FROM finance.payment
    WHERE status = 'registered'
      AND direction = ${input.direction}
      AND value_date BETWEEN CAST(${`${input.today.slice(0, 8)}01`} AS DATE) AND CAST(${input.today} AS DATE)
      AND (${input.contactId} IS NULL OR counterparty_id = CAST(${input.contactId} AS UUID))
      AND list_contains(${input.entities.map((entity) => entity.id)}, CAST(legal_entity_id AS VARCHAR))
  `);
  return decimalOf(rows[0]?.amount ?? 0);
}

function itemOf(doc: PayableDocument, age: ReturnType<typeof ageingOf>, codes: Map<string, string>) {
  return {
    target_table: doc.targetTable,
    target_id: doc.targetId,
    document_id: doc.documentId,
    legal_entity_id: doc.legalEntityId,
    entity_code: codes.get(doc.legalEntityId) ?? null,
    document_number: doc.documentNumber,
    counterparty_name: doc.sourceName ?? doc.counterpartyName,
    contact_match: doc.counterpartyMatch,
    issue_date: doc.issueDate,
    due_date: doc.dueDate,
    outstanding: moneyText(doc.outstanding),
    aging: age.bucket,
    days: age.days,
    is_overdue: age.isOverdue,
    origin: doc.origin,
    source_label: doc.origin === 'holded' ? 'Holded' : null,
  };
}

function bucketMap(): Record<AgingBucket | 'total' | 'overdue', Decimal> {
  return { '0-30': ZERO, '31-60': ZERO, '61-90': ZERO, '>90': ZERO, total: ZERO, overdue: ZERO };
}

function renderBuckets(amounts: Record<AgingBucket | 'total' | 'overdue', Decimal>) {
  return {
    '0-30': moneyText(amounts['0-30']),
    '31-60': moneyText(amounts['31-60']),
    '61-90': moneyText(amounts['61-90']),
    '>90': moneyText(amounts['>90']),
    total: moneyText(amounts.total),
    overdue: moneyText(amounts.overdue),
  };
}

function directionOf(value: string | null): 'in' | 'out' {
  if (value == null || value === '' || value === 'receivable' || value === 'in') return 'in';
  if (value === 'payable' || value === 'out') return 'out';
  throw domainError('WC_VALIDATION', { direction: 'Usa receivable o payable' });
}

function empty(today: string) {
  const zero = moneyText(ZERO);
  return {
    as_of: today,
    status: 'clear',
    groups: [],
    totals: renderBuckets(bucketMap()),
    summary: { pending_total: zero, overdue_total: zero, due_next_30: zero, collected_this_month: zero, by_entity: [] },
  };
}
