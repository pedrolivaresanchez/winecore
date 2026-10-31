import type { UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import { domainError } from '../errors';
import type { EntityFilter } from '../reports/types';

export interface LegacyScope {
  entity: EntityFilter;
  po: boolean;
  cvpo: boolean;
}

/** Ventas Holded que no están anuladas. El alias de la factura es `h`. */
export const HOLDED_NOT_CANCELLED =
  "lower(trim(h.status_holded)) NOT IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada')";

export function parseEntityParam(raw: string | null): EntityFilter {
  if (raw == null || raw.trim() === '') return 'both';
  const normalized = raw.trim().toLowerCase().replace(/\./g, '');
  if (normalized === 'po') return 'PO';
  if (normalized === 'cvpo') return 'CVPO';
  if (normalized === 'both' || normalized === 'ambas' || normalized === 'all' || normalized === 'todas') return 'both';
  throw domainError('WC_VALIDATION', { entity: 'La entidad debe ser P.O, CVPO o ambas' });
}

export function legacyScope(user: UserCtx, requested: EntityFilter): LegacyScope {
  const allowed = allowedCodes(user);
  if (requested === 'PO' && !allowed.has('PO')) throw domainError('WC_FORBIDDEN');
  if (requested === 'CVPO' && !allowed.has('CVPO')) throw domainError('WC_FORBIDDEN');
  const po = requested !== 'CVPO' && allowed.has('PO');
  const cvpo = requested !== 'PO' && allowed.has('CVPO');
  const entity: EntityFilter = po && cvpo ? 'both' : po ? 'PO' : 'CVPO';
  return { entity: po || cvpo ? entity : requested, po, cvpo };
}

function allowedCodes(user: UserCtx): Set<string> {
  const codes = new Set<string>();
  let unrestricted = false;
  for (const role of user.roles) {
    if (role.legalEntityId == null) unrestricted = true;
    else if (role.legalEntityCode === 'PO' || role.legalEntityCode === 'CVPO') codes.add(role.legalEntityCode);
  }
  if (unrestricted) {
    codes.add('PO');
    codes.add('CVPO');
  }
  return codes;
}

/** `e.code` limitado a las sociedades que el filtro y el rol permiten. */
export function entityPredicate(scope: LegacyScope, column = 'e.code'): string {
  if (!scope.po && !scope.cvpo) return 'FALSE';
  const parts: string[] = [];
  if (scope.po) parts.push(`${column} = 'PO'`);
  if (scope.cvpo) parts.push(`${column} = 'CVPO'`);
  return `(${parts.join(' OR ')})`;
}

/**
 * Un contacto sin ficha por sociedad se ve en P.O y en CVPO.
 * El alias del contacto es `c`.
 */
export function contactVisibility(scope: LegacyScope): string {
  if (scope.po && scope.cvpo) return 'TRUE';
  if (!scope.po && !scope.cvpo) return 'FALSE';
  const code = scope.po ? 'PO' : 'CVPO';
  return sql`(
    NOT EXISTS (SELECT 1 FROM party.contact_entity_terms t WHERE t.contact_id = c.id)
    OR EXISTS (
      SELECT 1 FROM party.contact_entity_terms t
      JOIN core.legal_entity le ON le.id = t.legal_entity_id
      WHERE t.contact_id = c.id AND le.code = ${code}
    )
  )`;
}

export function likePattern(value: string): string {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
