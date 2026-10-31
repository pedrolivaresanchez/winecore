export const PERMISSIONS = [
  'contacts.read',
  'contacts.write',
  'settings.manage',
  'users.manage',
  'audit.read',
  // --- Bodega (07-arquitectura.md §6) ---
  'cellar.read',
  'cellar.operate',
  'cellar.manage',
  // Existencias (stock): lectura del libro y aforos.
  'inventory.read',
  'inventory.count',
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
  approver: ['contacts.read', 'audit.read', 'cellar.read', 'inventory.read'],
  admin: ['contacts.read', 'contacts.write', 'cellar.read', 'inventory.read', 'inventory.count'],
  cellar: ['cellar.read', 'cellar.operate', 'inventory.read', 'inventory.count'],
  field: ['cellar.read'],
  advisor: ['contacts.read', 'audit.read', 'cellar.read', 'inventory.read'],
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
