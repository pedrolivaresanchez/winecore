import { canonicalJson } from '../db/audit';
import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { DomainError, domainError } from '../errors';
import { sha256Hex } from '../hash';
import {
  assertEntity,
  dateOf,
  fail,
  idOf,
  idOrNull,
  loadCustomer,
  newRowId,
  textOf,
  throwIf,
} from './db';

export type MatchedScope = 'customer' | 'channel' | 'default';

export type IssuingResolution = {
  entityId: string;
  matchedScope: MatchedScope;
  ruleId: string;
  trace: Record<string, unknown>;
  ruleSetId: string;
  version: number;
  entityCode: string;
  label: string;
};

type RuleRow = {
  id: string;
  scope: MatchedScope;
  customer_id: string | null;
  channel: string | null;
  issuing_entity_id: string;
  notes: string | null;
};

type SetRow = {
  id: string;
  version: number;
  status: string;
  notes: string | null;
  approval_request_id: string | null;
  activated_at: string | null;
};

function scopeOf(value: unknown): MatchedScope {
  const text = String(value);
  if (text === 'customer' || text === 'channel' || text === 'default') return text;
  fail('Ámbito de regla no válido', { scope: text });
}

function mapRule(row: Record<string, unknown>): RuleRow {
  return {
    id: idOf(row.id),
    scope: scopeOf(row.scope),
    customer_id: idOrNull(row.customer_id),
    channel: textOf(row.channel),
    issuing_entity_id: idOf(row.issuing_entity_id),
    notes: textOf(row.notes),
  };
}

async function loadSet(tx: Tx, id: string): Promise<SetRow> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, version, status, notes, approval_request_id, activated_at
    FROM billing.billing_rule_set WHERE id = CAST(${id} AS UUID)
  `);
  const row = rows[0];
  if (!row) throw domainError('WC_NOT_FOUND');
  return {
    id: idOf(row.id),
    version: Number(row.version),
    status: String(row.status),
    notes: textOf(row.notes),
    approval_request_id: idOrNull(row.approval_request_id),
    activated_at: row.activated_at == null ? null : String(row.activated_at),
  };
}

async function loadRules(tx: Tx, setId: string): Promise<RuleRow[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, scope, customer_id, channel, issuing_entity_id, notes
    FROM billing.billing_rule
    WHERE rule_set_id = CAST(${setId} AS UUID)
    ORDER BY scope, customer_id, channel
  `);
  return rows.map(mapRule);
}

async function activeSet(tx: Tx): Promise<SetRow | null> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, version, status, notes, approval_request_id, activated_at
    FROM billing.billing_rule_set WHERE status = 'active'
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: idOf(row.id),
    version: Number(row.version),
    status: String(row.status),
    notes: textOf(row.notes),
    approval_request_id: idOrNull(row.approval_request_id),
    activated_at: row.activated_at == null ? null : String(row.activated_at),
  };
}

function rulesHash(version: number, rules: readonly RuleRow[]): string {
  return sha256Hex(canonicalJson({
    version,
    rules: rules.map((rule) => ({
      scope: rule.scope,
      customer_id: rule.customer_id,
      channel: rule.channel,
      issuing_entity_id: rule.issuing_entity_id,
      notes: rule.notes,
    })),
  }));
}

export async function listRuleSets(tx: Tx): Promise<Record<string, unknown>[]> {
  const rows = await tx.read<Record<string, unknown>>(sql`
    SELECT id, version, status, notes, approval_request_id, activated_at, created_at
    FROM billing.billing_rule_set
    ORDER BY version DESC
  `);
  const items = [];
  for (const row of rows) {
    const id = idOf(row.id);
    const rules = await loadRules(tx, id);
    items.push({
      id,
      version: Number(row.version),
      status: String(row.status),
      notes: textOf(row.notes),
      approval_request_id: idOrNull(row.approval_request_id),
      activated_at: row.activated_at == null ? null : String(row.activated_at),
      created_at: String(row.created_at),
      rules: rules.map(ruleJson),
    });
  }
  return items;
}

function ruleJson(rule: RuleRow): Record<string, unknown> {
  return {
    id: rule.id,
    scope: rule.scope,
    customer_id: rule.customer_id,
    channel: rule.channel,
    issuing_entity_id: rule.issuing_entity_id,
    notes: rule.notes,
  };
}

export async function createRuleSet(tx: Tx, actorId: string, notes: string | null): Promise<Record<string, unknown>> {
  const versions = await tx.read<{ version: unknown }>(sql`
    SELECT coalesce(max(version), 0) AS version FROM billing.billing_rule_set
  `);
  const version = Number(versions[0]?.version ?? 0) + 1;
  const id = newRowId();
  const now = new Date();
  tx.write(sql`
    INSERT INTO billing.billing_rule_set (id, version, status, notes, created_by, created_at)
    VALUES (CAST(${id} AS UUID), ${version}, 'draft', ${notes}, ${actorId}, ${now})
  `);
  tx.audit({ table: 'billing.billing_rule_set', rowId: id, action: 'INSERT', before: null, after: { version, status: 'draft', notes } });
  const current = await activeSet(tx);
  if (current) {
    const rules = await loadRules(tx, current.id);
    for (const rule of rules) {
      insertRule(tx, id, rule);
    }
  }
  const saved = await loadRules(tx, id);
  return { id, version, status: 'draft', notes, rules: saved.map(ruleJson) };
}

function insertRule(tx: Tx, setId: string, rule: Omit<RuleRow, 'id'>): string {
  const id = newRowId();
  tx.write(sql`
    INSERT INTO billing.billing_rule (id, rule_set_id, scope, customer_id, channel, issuing_entity_id, notes)
    VALUES (
      CAST(${id} AS UUID), CAST(${setId} AS UUID), ${rule.scope},
      CASE WHEN ${rule.customer_id} IS NULL THEN NULL ELSE CAST(${rule.customer_id} AS UUID) END,
      ${rule.channel},
      CAST(${rule.issuing_entity_id} AS UUID),
      ${rule.notes}
    )
  `);
  tx.audit({
    table: 'billing.billing_rule',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { rule_set_id: setId, scope: rule.scope, customer_id: rule.customer_id, channel: rule.channel, issuing_entity_id: rule.issuing_entity_id },
  });
  return id;
}

export type RuleInput = {
  scope: MatchedScope;
  customerId: string | null;
  channel: string | null;
  issuingEntityId: string;
  notes: string | null;
};

export async function replaceRules(tx: Tx, setId: string, rules: readonly RuleInput[]): Promise<Record<string, unknown>> {
  const set = await loadSet(tx, setId);
  if (set.status !== 'draft') {
    throw new DomainError('WC070', 409, 'El conjunto de reglas no está en borrador; crea una versión nueva', { status: set.status });
  }
  const seenCustomer = new Set<string>();
  const seenChannel = new Set<string>();
  let defaults = 0;
  for (const rule of rules) {
    if (rule.scope === 'customer') {
      if (!rule.customerId) fail('La regla de cliente necesita un cliente', { customer_id: 'Obligatorio' });
      if (seenCustomer.has(rule.customerId)) {
        throw new DomainError('WC070', 409, 'Ya hay una regla para este cliente', { customer_id: rule.customerId });
      }
      seenCustomer.add(rule.customerId);
      await loadCustomer(tx, rule.customerId);
    } else if (rule.scope === 'channel') {
      if (!rule.channel) fail('La regla de canal necesita un canal', { channel: 'Obligatorio' });
      if (seenChannel.has(rule.channel)) {
        throw new DomainError('WC070', 409, 'Ya hay una regla para este canal', { channel: rule.channel });
      }
      seenChannel.add(rule.channel);
      const channels = await tx.read(sql`SELECT code FROM sales.channel WHERE code = ${rule.channel} AND is_active`);
      if (!channels[0]) fail('El canal no existe', { channel: rule.channel });
    } else {
      defaults += 1;
      if (defaults > 1) throw new DomainError('WC070', 409, 'Solo puede haber una regla por defecto');
    }
    await assertEntity(tx, rule.issuingEntityId);
  }
  const previous = await loadRules(tx, setId);
  tx.write(sql`DELETE FROM billing.billing_rule WHERE rule_set_id = CAST(${setId} AS UUID)`);
  for (const rule of previous) {
    tx.audit({ table: 'billing.billing_rule', rowId: rule.id, action: 'DELETE', before: rule, after: null });
  }
  const saved: RuleRow[] = [];
  for (const rule of rules) {
    const id = insertRule(tx, setId, {
      scope: rule.scope,
      customer_id: rule.scope === 'customer' ? rule.customerId : null,
      channel: rule.scope === 'channel' ? rule.channel : null,
      issuing_entity_id: rule.issuingEntityId,
      notes: rule.notes,
    });
    saved.push({
      id,
      scope: rule.scope,
      customer_id: rule.scope === 'customer' ? rule.customerId : null,
      channel: rule.scope === 'channel' ? rule.channel : null,
      issuing_entity_id: rule.issuingEntityId,
      notes: rule.notes,
    });
  }
  return { id: set.id, version: set.version, status: set.status, rules: saved.map(ruleJson) };
}

/**
 * Cliente > canal > defecto. `setId` prueba un borrador; si falta, usa el conjunto activo.
 */
export async function resolveIssuingEntity(
  tx: Tx,
  input: { customerId: string; channel: string; setId?: string },
): Promise<IssuingResolution> {
  const set = input.setId ? await loadSet(tx, input.setId) : await activeSet(tx);
  if (!set) fail('No hay un conjunto de reglas activo');
  const customer = await loadCustomer(tx, input.customerId);
  const rules = await loadRules(tx, set.id);
  const customerRule = rules.find((rule) => rule.scope === 'customer' && rule.customer_id === input.customerId) ?? null;
  const channelRule = rules.find((rule) => rule.scope === 'channel' && rule.channel === input.channel) ?? null;
  const defaultRule = rules.find((rule) => rule.scope === 'default') ?? null;
  const winner = customerRule ?? channelRule ?? defaultRule;
  if (!winner) fail('No hay regla de entidad facturadora para este cliente y canal');
  const entity = await assertEntity(tx, winner.issuing_entity_id);
  const channelName = await channelLabel(tx, input.channel);
  const label = winner.scope === 'customer'
    ? `Regla: cliente ${customer.legal_name} (v${set.version})`
    : winner.scope === 'channel'
      ? `Regla: canal ${channelName} (v${set.version})`
      : `Regla: por defecto (v${set.version})`;
  const trace = {
    set_id: set.id,
    version: set.version,
    customer_id: input.customerId,
    channel: input.channel,
    label,
    evaluated: [
      evaluated('customer', customerRule),
      evaluated('channel', channelRule),
      evaluated('default', defaultRule),
    ],
    winner: winner.scope,
    rule_id: winner.id,
    issuing_entity_id: winner.issuing_entity_id,
  };
  return {
    entityId: winner.issuing_entity_id,
    matchedScope: winner.scope,
    ruleId: winner.id,
    trace,
    ruleSetId: set.id,
    version: set.version,
    entityCode: entity,
    label,
  };
}

function evaluated(scope: MatchedScope, rule: RuleRow | null): Record<string, unknown> {
  return {
    scope,
    matched: rule != null,
    rule_id: rule?.id ?? null,
    issuing_entity_id: rule?.issuing_entity_id ?? null,
  };
}

async function channelLabel(tx: Tx, code: string): Promise<string> {
  const rows = await tx.read<{ name_es: string }>(sql`SELECT name_es FROM sales.channel WHERE code = ${code}`);
  return rows[0] ? String(rows[0].name_es) : code;
}

export async function ruleImpact(tx: Tx, setId: string, days: number, today: string): Promise<Record<string, unknown>> {
  const set = await loadSet(tx, setId);
  const rules = await loadRules(tx, set.id);
  const from = shiftDate(today, -days);
  const orders = await tx.read<Record<string, unknown>>(sql`
    SELECT id, number, customer_id, channel, legal_entity_id, order_date
    FROM sales.sales_order
    WHERE status <> 'draft' AND status <> 'cancelled'
      AND legal_entity_id IS NOT NULL
      AND order_date >= CAST(${from} AS DATE)
      AND order_date <= CAST(${today} AS DATE)
  `);
  const changes = [];
  for (const order of orders) {
    const customerId = idOf(order.customer_id);
    const channel = String(order.channel);
    const customerRule = rules.find((rule) => rule.scope === 'customer' && rule.customer_id === customerId) ?? null;
    const channelRule = rules.find((rule) => rule.scope === 'channel' && rule.channel === channel) ?? null;
    const defaultRule = rules.find((rule) => rule.scope === 'default') ?? null;
    const winner = customerRule ?? channelRule ?? defaultRule;
    if (!winner) continue;
    const current = idOf(order.legal_entity_id);
    if (current !== winner.issuing_entity_id) {
      changes.push({
        order_id: idOf(order.id),
        number: textOf(order.number),
        from_entity_id: current,
        to_entity_id: winner.issuing_entity_id,
        order_date: dateOf(order.order_date),
      });
    }
  }
  return { days, orders: orders.length, would_change: changes.length, changes };
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

export async function requestActivation(tx: Tx, setId: string, actorId: string): Promise<Record<string, unknown>> {
  const set = await loadSet(tx, setId);
  if (set.status !== 'draft') {
    throw new DomainError('WC070', 409, 'El conjunto de reglas no está en borrador; crea una versión nueva');
  }
  const rules = await loadRules(tx, setId);
  if (!rules.some((rule) => rule.scope === 'default')) fail('Falta la regla por defecto');
  const hash = rulesHash(set.version, rules);
  const id = newRowId();
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const summary = `Activar reglas de facturación v${set.version}`;
  tx.write(sql`
    INSERT INTO ops.approval_request (
      id, kind, subject_table, subject_id, payload_sha256, summary, details,
      status, requested_by, requested_at, expires_at
    ) VALUES (
      CAST(${id} AS UUID), 'billing_rules_activation', 'billing.billing_rule_set', CAST(${setId} AS UUID),
      ${hash}, ${summary}, ${sql.json({ version: set.version, rules: rules.map(ruleJson) })},
      'pending', ${actorId}, ${now}, ${expires}
    )
  `);
  tx.write(sql`
    UPDATE billing.billing_rule_set
    SET approval_request_id = CAST(${id} AS UUID)
    WHERE id = CAST(${setId} AS UUID)
  `);
  tx.audit({
    table: 'ops.approval_request',
    rowId: id,
    action: 'INSERT',
    before: null,
    after: { kind: 'billing_rules_activation', subject_id: setId, payload_sha256: hash, status: 'pending' },
  });
  return { approval_request_id: id, payload_sha256: hash, status: 'pending', rule_set_id: setId };
}

export async function activateRuleSet(tx: Tx, setId: string): Promise<Record<string, unknown>> {
  const set = await loadSet(tx, setId);
  if (set.status !== 'draft') {
    throw new DomainError('WC070', 409, 'El conjunto de reglas no está en borrador; crea una versión nueva');
  }
  if (!set.approval_request_id) throw domainError('WC042');
  const approvals = await tx.read<Record<string, unknown>>(sql`
    SELECT id, status, payload_sha256, expires_at
    FROM ops.approval_request
    WHERE id = CAST(${set.approval_request_id} AS UUID)
  `);
  const approval = approvals[0];
  if (!approval) throw domainError('WC042');
  if (String(approval.status) !== 'approved') throw domainError('WC042');
  const expiresAt = approval.expires_at instanceof Date ? approval.expires_at : new Date(String(approval.expires_at));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) throw domainError('WC043');
  const rules = await loadRules(tx, setId);
  const hash = rulesHash(set.version, rules);
  if (String(approval.payload_sha256) !== hash) throw domainError('WC040');
  const now = new Date();
  const previous = await activeSet(tx);
  if (previous && previous.id !== setId) {
    tx.write(sql`
      UPDATE billing.billing_rule_set SET status = 'superseded' WHERE id = CAST(${previous.id} AS UUID)
    `);
    tx.audit({
      table: 'billing.billing_rule_set',
      rowId: previous.id,
      action: 'UPDATE',
      before: { status: 'active' },
      after: { status: 'superseded' },
    });
  }
  tx.write(sql`
    UPDATE billing.billing_rule_set
    SET status = 'active', activated_at = ${now}
    WHERE id = CAST(${setId} AS UUID)
  `);
  tx.write(sql`
    UPDATE ops.approval_request
    SET status = 'consumed', consumed_at = ${now}
    WHERE id = CAST(${set.approval_request_id} AS UUID)
  `);
  tx.audit({
    table: 'billing.billing_rule_set',
    rowId: setId,
    action: 'UPDATE',
    before: { status: 'draft' },
    after: { status: 'active', activated_at: now.toISOString() },
  });
  return { id: setId, version: set.version, status: 'active', activated_at: now.toISOString() };
}

export function parseRuleInputs(raw: unknown): RuleInput[] {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const list = body?.rules;
  if (!Array.isArray(list)) fail('Faltan las reglas', { rules: 'Debe ser una lista' });
  return list.map((item, index) => {
    const fields: Record<string, string> = {};
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
    if (!row) fail('Regla no válida', { [`rules.${index}`]: 'Debe ser un objeto' });
    const scope = row.scope;
    if (scope !== 'customer' && scope !== 'channel' && scope !== 'default') {
      fields.scope = 'Ámbito no válido';
    }
    const customerId = row.customer_id == null || row.customer_id === ''
      ? null
      : (typeof row.customer_id === 'string' ? row.customer_id.trim().toLowerCase() : '');
    const channel = row.channel == null || row.channel === '' ? null : (typeof row.channel === 'string' ? row.channel : '');
    const entity = typeof row.issuing_entity_id === 'string' ? row.issuing_entity_id.trim().toLowerCase() : '';
    if (!/^[0-9a-f-]{36}$/.test(entity)) fields.issuing_entity_id = 'Identificador no válido';
    const notes = row.notes == null || row.notes === '' ? null : (typeof row.notes === 'string' ? row.notes : null);
    if (row.notes != null && notes == null) fields.notes = 'Debe ser texto';
    throwIf(fields);
    if (scope !== 'customer' && scope !== 'channel' && scope !== 'default') fail('Ámbito no válido');
    return {
      scope,
      customerId: customerId && /^[0-9a-f-]{36}$/.test(customerId) ? customerId : null,
      channel,
      issuingEntityId: entity,
      notes,
    };
  });
}

export function resolutionJson(result: IssuingResolution): Record<string, unknown> {
  return {
    entity_id: result.entityId,
    entity_code: result.entityCode,
    matched_scope: result.matchedScope,
    rule_id: result.ruleId,
    rule_set_id: result.ruleSetId,
    version: result.version,
    label: result.label,
    trace: result.trace,
  };
}
