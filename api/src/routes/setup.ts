import { requestIdFor, sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { createRuleSet, ensureDefaultRule, inspectBillingSetup, requestActivation } from '../core/sales/rules';
import { assessReadiness } from '../core/setup/readiness';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getReadiness(writer: Writer, request: Request, now: Date, deliveryAlertHours: number) {
  sessionOf(request);
  return assessReadiness(writer, { now, deliveryAlertHours });
}

export async function postBillingRuleActivation(writer: Writer, request: Request) {
  const user = sessionOf(request);
  const raw = await request.json().catch(() => {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo no es JSON' });
  });
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  let issuing: string | null = null;
  if (body.issuing_entity_id != null && body.issuing_entity_id !== '') {
    if (typeof body.issuing_entity_id !== 'string' || !UUID.test(body.issuing_entity_id)) {
      throw domainError('WC_VALIDATION', { issuing_entity_id: 'Identificador no válido' });
    }
    issuing = body.issuing_entity_id.toLowerCase();
  }
  const actor = { type: 'user' as const, id: user.id, requestId: requestIdFor(request), reason: 'petición de reglas de facturación' };
  const view = await writer.withWrite(actor, (tx) => inspectBillingSetup(tx));
  if (view.kind === 'active') {
    throw domainError('WC_VALIDATION', { status: 'Ya hay un conjunto de reglas activo' });
  }
  if (view.kind === 'pending') {
    return { approval_request_id: view.approval_request_id, rule_set_id: view.rule_set_id, status: 'pending' as const, already_pending: true };
  }
  let setId = view.rule_set_id;
  if (!setId) {
    const created = await writer.withWrite(actor, (tx) => createRuleSet(tx, user.id, 'Puesta en marcha'));
    setId = String(created.id);
  }
  if (view.kind === 'needs_default') {
    if (!issuing) throw domainError('WC_VALIDATION', { issuing_entity_id: 'Indica la entidad de la regla por defecto' });
    await writer.withWrite(actor, (tx) => ensureDefaultRule(tx, setId as string, issuing as string));
  }
  const requested = await writer.withWrite(actor, (tx) => requestActivation(tx, setId as string, user.id));
  return {
    approval_request_id: String(requested.approval_request_id),
    rule_set_id: setId,
    status: 'pending' as const,
    already_pending: false,
  };
}
