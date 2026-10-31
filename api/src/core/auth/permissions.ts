export const PERMISSIONS = [
  'contacts.read',
  'contacts.write',
  'catalog.read',
  'catalog.write',
  'reports.read',
  'purchasing.read',
  'purchasing.write',
  'purchasing.approve',
  'finance.read',
  'finance.write',
  'finance.manage',
  'settings.manage',
  'users.manage',
  'audit.read',
  // Facturación (docs/07-arquitectura.md §6). billing.void del aprobador es por entidad.
  'billing.read',
  'billing.write',
  'billing.issue',
  'billing.void',
  'billing.deliver',
  // Existencias (stock): lectura del libro y aforos.
  'inventory.read',
  'inventory.count',
  // Bodega (07-arquitectura.md §6).
  'cellar.read',
  'cellar.operate',
  'cellar.manage',
  // Ventas (docs/07-arquitectura.md §6): lectura, operación y excepciones.
  'sales.read',
  'sales.write',
  'sales.manage',
  'regulatory.read',
  'regulatory.prepare',
  'regulatory.approve',
  // Viñedo y cuaderno de explotación (07-arquitectura.md §6, UI-26).
  'vineyard.read',
  'vineyard.write',
  // Fichas de cata, cata ciega y notas. La lectura sigue siendo cellar.read.
  'tasting.write',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_CODES = ['owner', 'approver', 'admin', 'cellar', 'field', 'advisor'] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleAssignment {
  role: RoleCode;
  legalEntityId: string | null;
  legalEntityCode: string | null;
}

export interface UserCtx {
  id: string;
  email: string;
  displayName: string;
  roles: RoleAssignment[];
}

const MATRIX: Record<RoleCode, readonly Permission[]> = {
  owner: PERMISSIONS,
  approver: ['contacts.read', 'catalog.read', 'reports.read', 'audit.read', 'billing.read', 'billing.write', 'billing.issue', 'billing.void', 'purchasing.read', 'purchasing.approve', 'finance.read', 'inventory.read', 'cellar.read', 'sales.read', 'regulatory.read', 'regulatory.approve', 'vineyard.read'],
  admin: ['contacts.read', 'contacts.write', 'catalog.read', 'catalog.write', 'reports.read', 'billing.read', 'billing.write', 'billing.issue', 'billing.deliver', 'purchasing.read', 'purchasing.write', 'finance.read', 'finance.write', 'inventory.read', 'inventory.count', 'cellar.read', 'sales.read', 'sales.write', 'regulatory.read', 'regulatory.prepare', 'vineyard.read'],
  cellar: ['catalog.read', 'inventory.read', 'inventory.count', 'cellar.read', 'cellar.operate', 'tasting.write', 'vineyard.read', 'vineyard.write'],
  field: ['cellar.read', 'vineyard.read', 'vineyard.write'],
  advisor: ['contacts.read', 'catalog.read', 'reports.read', 'audit.read', 'billing.read', 'purchasing.read', 'finance.read', 'inventory.read', 'cellar.read', 'sales.read', 'regulatory.read', 'vineyard.read'],
};

const PERSONAL_CONTACT_ROLES = new Set<RoleCode>(['owner', 'admin', 'approver']);

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function can(user: UserCtx, permission: Permission, entityId?: string): boolean {
  return user.roles.some((assignment) => {
    if (!MATRIX[assignment.role].includes(permission)) return false;
    if (entityId === undefined) return true;
    return assignment.legalEntityId === null || assignment.legalEntityId === entityId;
  });
}

/** null = todas las entidades. Una lista vacía = ningún alcance. */
export function entityScope(user: UserCtx, permission: Permission): string[] | null {
  const ids = new Set<string>();
  let global = false;
  for (const assignment of user.roles) {
    if (!MATRIX[assignment.role].includes(permission)) continue;
    if (assignment.legalEntityId === null) global = true;
    else ids.add(assignment.legalEntityId);
  }
  if (global) return null;
  return [...ids];
}

export function permissionsFor(user: UserCtx): Permission[] {
  const granted = new Set<Permission>();
  for (const assignment of user.roles) {
    for (const permission of MATRIX[assignment.role]) granted.add(permission);
  }
  return [...granted].sort();
}

export function seesPersonalContactData(user: UserCtx): boolean {
  return user.roles.some((assignment) => PERSONAL_CONTACT_ROLES.has(assignment.role));
}

export function isOwner(user: UserCtx): boolean {
  return user.roles.some((assignment) => assignment.role === 'owner');
}
