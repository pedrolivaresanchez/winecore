import { describe, expect, it } from 'bun:test';
import {
  can,
  entityScope,
  PERMISSIONS,
  seesPersonalContactData,
  type Permission,
  type RoleCode,
  type UserCtx,
} from '../../src/core/auth/permissions';

const granted: Record<RoleCode, readonly Permission[]> = {
  owner: [
    'contacts.read', 'contacts.write', 'finance.read', 'finance.write', 'finance.manage',
    'settings.manage', 'users.manage', 'audit.read',
  ],
  approver: ['contacts.read', 'audit.read', 'finance.read'],
  admin: ['contacts.read', 'contacts.write', 'finance.read', 'finance.write'],
  cellar: [],
  field: [],
  advisor: ['contacts.read', 'audit.read', 'finance.read'],
};

function user(role: RoleCode, legalEntityId: string | null = null): UserCtx {
  return {
    id: 'user-1',
    email: 'owner@winecore.test',
    displayName: 'Propietario',
    roles: [{ role, legalEntityId, legalEntityCode: legalEntityId ? 'PO' : null }],
  };
}

describe('can', () => {
  it('resuelve la matriz de permisos de esta fase', () => {
    for (const role of Object.keys(granted) as RoleCode[]) {
      for (const permission of PERMISSIONS) {
        expect(can(user(role), permission)).toBe(granted[role].includes(permission));
      }
    }
  });

  it('limita el permiso a la entidad asignada y deja NULL como todas', () => {
    const scoped = user('admin', 'entity-po');
    expect(can(scoped, 'contacts.write', 'entity-po')).toBe(true);
    expect(can(scoped, 'contacts.write', 'entity-cvpo')).toBe(false);
    expect(can(user('admin', null), 'contacts.write', 'entity-cvpo')).toBe(true);
  });

  it('limita finanzas a las entidades del rol y deja el alcance global en null', () => {
    expect(entityScope(user('owner'), 'finance.manage')).toBeNull();
    expect(entityScope(user('admin', 'entity-po'), 'finance.write')).toEqual(['entity-po']);
    expect(entityScope(user('cellar'), 'finance.read')).toEqual([]);
    expect(can(user('admin'), 'finance.manage')).toBe(false);
    expect(can(user('advisor'), 'finance.read')).toBe(true);
    expect(can(user('advisor'), 'finance.write')).toBe(false);
  });

  it('oculta los datos personales de contacto al asesor', () => {
    expect(seesPersonalContactData(user('advisor'))).toBe(false);
    expect(seesPersonalContactData(user('owner'))).toBe(true);
    expect(seesPersonalContactData(user('admin'))).toBe(true);
    expect(seesPersonalContactData(user('approver'))).toBe(true);
    expect(seesPersonalContactData(user('cellar'))).toBe(false);
  });
});
