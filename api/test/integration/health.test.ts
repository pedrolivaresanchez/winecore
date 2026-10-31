import { describe, expect, it } from 'bun:test';
import { createTestApp } from '../helpers';

describe('GET /health', () => {
  it('responde sin autenticación', async () => {
    const logs: string[] = [];
    const ctx = await createTestApp({ log: (line) => logs.push(line) });
    try {
      const response = await ctx.app.handle(new Request('http://localhost/health'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: 'ok',
        sha: 'testsha',
        schema_version: '0001_core.sql',
        db: 'local',
        writer: 'leader',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const line = logs.find((entry) => entry.includes('"/health"'));
      expect(line).toBeDefined();
      const parsed = JSON.parse(line ?? '{}') as { request_id: string; method: string; path: string; status: number; ms: number };
      expect(parsed.method).toBe('GET');
      expect(parsed.path).toBe('/health');
      expect(parsed.status).toBe(200);
      expect(typeof parsed.request_id).toBe('string');
      expect(typeof parsed.ms).toBe('number');
      expect(line).not.toContain('owner@winecore.test');
    } finally {
      await ctx.close();
    }
  });

  it('respeta API_BASE_PATH', async () => {
    const ctx = await createTestApp({ env: { API_BASE_PATH: '/api' } });
    try {
      const response = await ctx.app.handle(new Request('http://localhost/api/health'));
      expect(response.status).toBe(200);
      const missing = await ctx.app.handle(new Request('http://localhost/health'));
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ code: 'WC_NOT_FOUND', message: 'No encontrado' });
    } finally {
      await ctx.close();
    }
  });
});
