import { requestIdFor, sessionOf } from '../auth/guard';
import { can, entityScope, isOwner } from '../core/auth/permissions';
import { domainError } from '../core/errors';
import { listTaxWarehouses, maskCae, updateTaxWarehouseCae } from '../core/regulatory/warehouses';
import type { RegulatoryDeps } from './regulatory-submissions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getTaxWarehouses(deps: RegulatoryDeps, request: Request) {
  const user = sessionOf(request);
  const url = new URL(request.url);
  const entityRaw = url.searchParams.get('entity') ?? url.searchParams.get('legal_entity_id');
  let entity: string | undefined;
  if (entityRaw) {
    if (!UUID.test(entityRaw)) throw domainError('WC_VALIDATION', { entity: 'Identificador no válido' });
    entity = entityRaw.toLowerCase();
    if (!can(user, 'regulatory.read', entity)) throw domainError('WC_FORBIDDEN');
  }
  const scope = entityScope(user, 'regulatory.read');
  const entityIds = entity ? [entity] : scope?.map((id) => id.toLowerCase()) ?? null;
  const items = await listTaxWarehouses(deps.writer, { revealCae: isOwner(user), entityIds });
  return { items };
}

export async function patchTaxWarehouse(deps: RegulatoryDeps, request: Request, id: string) {
  const user = sessionOf(request);
  const body = await request.json().catch(() => {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo no es JSON' });
  });
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw domainError('WC_VALIDATION', { body: 'El cuerpo debe ser un objeto' });
  }
  const record = body as Record<string, unknown>;
  if (typeof record.cae !== 'string') throw domainError('WC_VALIDATION', { cae: 'Indica el CAE' });
  if (record.is_test !== undefined && typeof record.is_test !== 'boolean') {
    throw domainError('WC_VALIDATION', { is_test: 'Debe ser verdadero o falso' });
  }
  const saved = await updateTaxWarehouseCae(
    deps.writer,
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'CAE del depósito fiscal' },
    id,
    {
      cae: record.cae as string,
      isTest: typeof record.is_test === 'boolean' ? record.is_test : undefined,
    },
  );
  return {
    id: saved.id,
    name: saved.name,
    cae: saved.cae,
    cae_masked: maskCae(saved.cae, false),
    is_test: saved.is_test,
  };
}
