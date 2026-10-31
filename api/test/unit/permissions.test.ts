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
  owner: PERMISSIONS,
  approver: ['contacts.read', 'catalog.read', 'reports.read', 'audit.read', 'billing.read', 'billing.write', 'billing.issue', 'billing.void', 'purchasing.read', 'purchasing.approve', 'finance.read', 'inventory.read', 'cellar.read', 'sales.read', 'regulatory.read', 'regulatory.approve', 'vineyard.read'],
  admin: ['contacts.read', 'contacts.write', 'catalog.read', 'catalog.write', 'reports.read', 'billing.read', 'billing.write', 'billing.issue', 'billing.deliver', 'purchasing.read', 'purchasing.write', 'finance.read', 'finance.write', 'inventory.read', 'inventory.count', 'cellar.read', 'sales.read', 'sales.write', 'regulatory.read', 'regulatory.prepare', 'vineyard.read'],
  cellar: ['catalog.read', 'inventory.read', 'inventory.count', 'cellar.read', 'cellar.operate', 'vineyard.read', 'vineyard.write'],
  field: ['cellar.read', 'vineyard.read', 'vineyard.write'],
  advisor: ['contacts.read', 'catalog.read', 'reports.read', 'audit.read', 'billing.read', 'purchasing.read', 'finance.read', 'inventory.read', 'cellar.read', 'sales.read', 'regulatory.read', 'vineyard.read'],
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
