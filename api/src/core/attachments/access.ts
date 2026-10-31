import { can, isPermission, type UserCtx } from '../auth/permissions';
import { sql } from '../db/sql';
import { DomainError, domainError } from '../errors';

type Read = <T = Record<string, unknown>>(statement: string) => Promise<T[]>;

/**
 * Permiso de lectura y de escritura del módulo de cada esquema.
 * Solo se concede si esa clave está en la matriz de esta fase (`isPermission`).
 * Escritura: la de la arquitectura (cellar.operate, inventory.count, …).
 */
const SCHEMA_ACCESS: Record<string, { read: string; write: string }> = {
  party: { read: 'contacts.read', write: 'contacts.write' },
  catalog: { read: 'catalog.read', write: 'catalog.write' },
  sales: { read: 'sales.read', write: 'sales.write' },
  billing: { read: 'billing.read', write: 'billing.write' },
  purchasing: { read: 'purchasing.read', write: 'purchasing.write' },
  finance: { read: 'finance.read', write: 'finance.write' },
  inventory: { read: 'inventory.read', write: 'inventory.count' },
  cellar: { read: 'cellar.read', write: 'cellar.operate' },
  tasting: { read: 'cellar.read', write: 'tasting.write' },
  vineyard: { read: 'vineyard.read', write: 'vineyard.write' },
  regulatory: { read: 'regulatory.read', write: 'regulatory.prepare' },
  knowledge: { read: 'knowledge.read', write: 'knowledge.write' },
  accounting: { read: 'exports.fiscal', write: 'accounting.write' },
  legacy: { read: 'exports.fiscal', write: 'settings.manage' },
  core: { read: 'settings.manage', write: 'settings.manage' },
};

const columnsCache = new Map<string, Set<string>>();

export type LinkDecision = 'ok' | 'forbidden' | 'missing' | 'invalid';

export function parseEntityTable(value: string): { schema: string; name: string; table: string } | null {
  const table = value.trim().toLowerCase();
  const match = /^([a-z_]+)\.([a-z_]+)$/.exec(table);
  const schema = match?.[1];
  const name = match?.[2];
  if (!schema || !name) return null;
  return { schema, name, table: `${schema}.${name}` };
}

async function columnsOf(read: Read, schema: string, name: string): Promise<Set<string>> {
  const key = `${schema}.${name}`;
  const cached = columnsCache.get(key);
  if (cached) return cached;
  const rows = await read<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${name}
  `);
  const names = new Set(rows.map((row) => String(row.column_name).toLowerCase()));
  if (names.size > 0) columnsCache.set(key, names);
  return names;
}

export async function decideLinkAccess(
  read: Read,
  user: UserCtx,
  table: string,
  rowId: string,
  mode: 'read' | 'write',
): Promise<LinkDecision> {
  const parsed = parseEntityTable(table);
  if (!parsed) return 'invalid';
  const access = SCHEMA_ACCESS[parsed.schema];
  if (!access) return 'invalid';
  const permission = access[mode];
  if (!isPermission(permission) || !can(user, permission)) return 'forbidden';
  const columns = await columnsOf(read, parsed.schema, parsed.name);
  if (!columns.has('id')) return 'invalid';
  const entityExpr = columns.has('legal_entity_id')
    ? 'legal_entity_id'
    : columns.has('entity_id')
      ? 'entity_id'
      : 'NULL';
  const idLiteral = sql`${rowId}`;
  let rows: Record<string, unknown>[];
  try {
    rows = await read(`
      SELECT id, ${entityExpr} AS legal_entity_id
      FROM ${parsed.schema}.${parsed.name}
      WHERE id = CAST(${idLiteral} AS UUID)
      LIMIT 1
    `);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return 'invalid';
  }
  const row = rows[0];
  if (!row) return 'missing';
  const entityId = row.legal_entity_id == null ? undefined : String(row.legal_entity_id).toLowerCase();
  if (entityId !== undefined && !can(user, permission, entityId)) return 'forbidden';
  return 'ok';
}

export async function assertLinkAccess(
  read: Read,
  user: UserCtx,
  table: string,
  rowId: string,
  mode: 'read' | 'write',
): Promise<void> {
  const decision = await decideLinkAccess(read, user, table, rowId, mode);
  if (decision === 'ok') return;
  if (decision === 'missing') throw domainError('WC_NOT_FOUND');
  if (decision === 'forbidden') throw domainError('WC_FORBIDDEN');
  throw domainError('WC_VALIDATION', { table: 'No se pueden adjuntar ficheros a esta tabla' });
}
