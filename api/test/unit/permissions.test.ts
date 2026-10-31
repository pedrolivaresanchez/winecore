import { describe, expect, it } from 'bun:test';
import {
  can,
  PERMISSIONS,
  seesPersonalContactData,
  type Permission,
  type RoleCode,
  type UserCtx,
} from '../../src/core/auth/permissions';

const granted: Record<RoleCode, readonly Permission[]> = {
  owner: PERMISSIONS,
  approver: ['contacts.read', 'catalog.read', 'reports.read', 'audit.read', 'billing.read', 'billing.write', 'billing.issue', 'billing.void', 'purchasing.read', 'purchasing.approve', 'inventory.read', 'cellar.read', 'sales.read'],
  admin: ['contacts.read', 'contacts.write', 'catalog.read', 'catalog.write', 'reports.read', 'billing.read', 'billing.write', 'billing.issue', 'billing.deliver', 'purchasing.read', 'purchasing.write', 'inventory.read', 'inventory.count', 'cellar.read', 'sales.read', 'sales.write'],
  cellar: ['catalog.read', 'inventory.read', 'inventory.count', 'cellar.read', 'cellar.operate'],
  field: ['cellar.read'],
  advisor: ['contacts.read', 'catalog.read', 'reports.read', 'audit.read', 'billing.read', 'purchasing.read', 'inventory.read', 'cellar.read', 'sales.read'],
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

  it('oculta los datos personales de contacto al asesor', () => {
    expect(seesPersonalContactData(user('advisor'))).toBe(false);
    expect(seesPersonalContactData(user('owner'))).toBe(true);
    expect(seesPersonalContactData(user('admin'))).toBe(true);
    expect(seesPersonalContactData(user('approver'))).toBe(true);
    expect(seesPersonalContactData(user('cellar'))).toBe(false);
  });
});
