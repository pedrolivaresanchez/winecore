import { sessionOf } from '../auth/guard';
import { can, entityScope, isOwner } from '../core/auth/permissions';
import { domainError } from '../core/errors';
import { listTaxWarehouses } from '../core/regulatory/warehouses';
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
