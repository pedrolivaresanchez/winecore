import { Decimal } from 'decimal.js';
import { entityScope, type UserCtx } from '../auth/permissions';
import type { Writer } from '../db/writer';
import { domainError } from '../errors';
import { assertScope } from './payments';
import {
  ageingOf,
  AGING_BUCKETS,
  moneyText,
  normalizeAging,
  optionalText,
  parseUuid,
  todayMadrid,
  type AgingBucket,
} from './support';
import { findEntity, listOpenDocuments, type PayableDocument } from './store';

const ZERO = new Decimal(0);

export async function listReceivables(writer: Writer, user: UserCtx, request: Request) {
  const url = new URL(request.url);
  const entityValue = optionalText(url.searchParams.get('entity'), 'entity', 36);
  const contactRaw = optionalText(url.searchParams.get('contact_id') ?? url.searchParams.get('counterparty_id'), 'contact_id', 36);
  const contactId = contactRaw ? parseUuid(contactRaw, 'contact_id') : null;
  const agingRaw = optionalText(url.searchParams.get('aging'), 'aging', 8);
  const aging = agingRaw ? normalizeAging(agingRaw) : null;
  const today = todayMadrid();
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
  const docs = (await listOpenDocuments(writer, entityId))
    .filter((doc) => doc.direction === 'in')
    .filter((doc) => scope === null || entityId !== null || scope.some((id) => id.toLowerCase() === doc.legalEntityId))
    .filter((doc) => !contactId || doc.counterpartyId === contactId.toLowerCase());
  const groups = new Map<string, {
    contact_id: string | null;
    customer_name: string;
    amounts: Record<AgingBucket | 'total' | 'overdue', Decimal>;
    items: Array<Record<string, unknown>>;
  }>();
  for (const doc of docs) {
    const age = ageingOf(doc.dueDate, doc.issueDate, today);
    if (aging && age.bucket !== aging) continue;
    const key = doc.counterpartyId ?? 'none';
    const group = groups.get(key) ?? {
      contact_id: doc.counterpartyId,
      customer_name: doc.counterpartyName ?? 'Sin cliente',
      amounts: bucketMap(),
      items: [],
    };
    group.amounts[age.bucket] = group.amounts[age.bucket].plus(doc.outstanding);
    group.amounts.total = group.amounts.total.plus(doc.outstanding);
    if (age.isOverdue) group.amounts.overdue = group.amounts.overdue.plus(doc.outstanding);
    group.items.push(itemOf(doc, age));
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
  };
}

function itemOf(doc: PayableDocument, age: ReturnType<typeof ageingOf>) {
  return {
    target_table: doc.targetTable,
    target_id: doc.targetId,
    legal_entity_id: doc.legalEntityId,
    document_number: doc.documentNumber,
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

function empty(today: string) {
  return { as_of: today, status: 'clear', groups: [], totals: renderBuckets(bucketMap()) };
}
