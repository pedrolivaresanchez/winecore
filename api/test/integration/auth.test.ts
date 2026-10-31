import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';

async function bodyOf(response: Response) {
  return response.json() as Promise<{ code?: string; message?: string; email?: string; permissions?: string[] }>;
}

describe('auth', () => {
  it('en modo dev identifica al usuario por defecto', async () => {
    const logs: string[] = [];
    const ctx = await createTestApp({ log: (line) => logs.push(line) });
    try {
      const response = await ctx.app.handle(new Request('http://localhost/v1/me'));
      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.email).toBe('owner@winecore.test');
      expect(body.permissions).toEqual([
        'audit.read',
        'cellar.manage',
        'cellar.operate',
        'cellar.read',
        'contacts.read',
        'contacts.write',
        'inventory.count',
        'inventory.read',
        'settings.manage',
        'users.manage',
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const line = logs.find((entry) => entry.includes('"/v1/me"'));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line ?? '{}') as { path: string; status: number };
      expect(parsed.path).toBe('/v1/me');
      expect(parsed.status).toBe(200);
      expect(line).not.toContain('owner@winecore.test');
    } finally {
      await ctx.close();
    }
  });

  it('responde 403 si el usuario no está en la lista y deja auditoría', async () => {
    const ctx = await createTestApp();
    try {
      const response = await ctx.app.handle(new Request('http://localhost/v1/me', {
        headers: { 'X-Dev-User': 'nadie@winecore.test' },
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: 'WC_NO_ACCESS',
        message: 'No tienes acceso a WineCore',
      });
      const rows = await ctx.writer.read<{ action: string }>('SELECT action FROM audit.audit_log');
      expect(rows.map((row) => row.action)).toContain('auth.denied');
    } finally {
      await ctx.close();
    }
  });

  it('responde 403 si el usuario está revocado, con el mismo mensaje', async () => {
    const ctx = await createTestApp();
    try {
      await ctx.client.query(`UPDATE core.app_user SET status = 'revoked' WHERE email = 'admin@winecore.test'`);
      const response = await ctx.app.handle(new Request('http://localhost/v1/me', {
        headers: { 'X-Dev-User': 'admin@winecore.test' },
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: 'WC_NO_ACCESS',
        message: 'No tienes acceso a WineCore',
      });
      const rows = await ctx.writer.read<{ action: string }>('SELECT action FROM audit.audit_log');
      expect(rows.map((row) => row.action)).toContain('auth.denied');
    } finally {
      await ctx.close();
    }
  });

  it('responde 403 si falta el permiso', async () => {
    const ctx = await createTestApp();
    try {
      const response = await ctx.app.handle(new Request('http://localhost/v1/audit', {
        headers: { 'X-Dev-User': 'bodega@winecore.test' },
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        code: 'WC_FORBIDDEN',
        message: 'No tienes permiso para esta operación',
      });
    } finally {
      await ctx.close();
    }
  });

  it('solo el propietario verifica la cadena', async () => {
    const ctx = await createTestApp();
    try {
      const advisor = await ctx.app.handle(new Request('http://localhost/v1/audit/verify', {
        method: 'POST',
        headers: { 'X-Dev-User': 'asesor@winecore.test' },
      }));
      expect(advisor.status).toBe(403);
      expect((await advisor.json() as { code: string }).code).toBe('WC_FORBIDDEN');

      const owner = await ctx.app.handle(new Request('http://localhost/v1/audit/verify', { method: 'POST' }));
      expect(owner.status).toBe(200);
      expect(await owner.json()).toEqual({ intact: true, first_broken_id: null });
    } finally {
      await ctx.close();
    }
  });

  it('sin token en modo timbal responde 401 y no atiende X-Dev-User', async () => {
    const ctx = await createTestApp({
      env: {
        AUTH_MODE: 'timbal',
        TIMBAL_ORG_ID: 'org-1',
        TIMBAL_PROJECT_ID: 'proj-1',
      },
    });
    try {
      const response = await ctx.app.handle(new Request('http://localhost/v1/me', {
        headers: { 'X-Dev-User': 'owner@winecore.test' },
      }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: 'WC_UNAUTHENTICATED',
        message: 'No autenticado',
      });
    } finally {
      await ctx.close();
    }
  });
});
