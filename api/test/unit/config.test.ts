import { describe, expect, it } from 'bun:test';
import { loadConfig } from '../../src/config';
import { seedInputFromEnv } from '../../db/seed';

const dev = {
  NODE_ENV: 'development',
  AUTH_MODE: 'dev',
};

describe('loadConfig', () => {
  it('aplica los valores por defecto sin imprimir secretos', () => {
    const secret = 'super-secret-value';
    const config = loadConfig({ ...dev, TIMBAL_API_KEY: secret, DB_MODE: 'local' });
    expect(config.port).toBe(3000);
    expect(config.apiBasePath).toBe('');
    expect(config.dbMode).toBe('local');
    expect(config.dbPath).toBe('.data/winecore.duckdb');
    expect(config.timbalApiHost).toBe('api.timbal.ai');
    expect(config.devUserEmail).toBe('owner@winecore.test');
    expect(config.gitSha).toBe('dev');
    expect(config.appPublicUrl).toBe('http://localhost:5173');
    expect(config.timbalToken).toBe(secret);
  });

  it('nombra la variable ausente o inválida y no incluye su valor', () => {
    expect(() => loadConfig({ AUTH_MODE: 'dev' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...dev, PORT: 'no-es-un-puerto' })).toThrow(/PORT/);
    try {
      loadConfig({ ...dev, PORT: 'no-es-un-puerto', TIMBAL_API_KEY: 'super-secret-value' });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('no-es-un-puerto');
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });

  it('lee el asistente de la workforce y lo deja nulo si falta', () => {
    expect(loadConfig(dev).assistantUrl).toBeNull();
    expect(loadConfig(dev).assistantToken).toBeNull();
    const config = loadConfig({
      ...dev,
      WINECORE_ASSISTANT_URL: 'https://workforce.example/asistente/run',
      WINECORE_ASSISTANT_TOKEN: 'token-sintetico',
    });
    expect(config.assistantUrl).toBe('https://workforce.example/asistente/run');
    expect(config.assistantToken).toBe('token-sintetico');
    expect(() => loadConfig({ ...dev, WINECORE_ASSISTANT_URL: 'ftp://workforce.example' })).toThrow(/WINECORE_ASSISTANT_URL/);
    expect(() => loadConfig({ ...dev, WINECORE_ASSISTANT_URL: 'https://usuario:clave@example.com/run' })).toThrow(/WINECORE_ASSISTANT_URL/);
  });

  it('rechaza AUTH_MODE=dev en producción', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/AUTH_MODE/);
  });

  it('rechaza la clave de datos de las pruebas en producción', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      AUTH_MODE: 'timbal',
      DB_MODE: 'local',
      TIMBAL_ORG_ID: 'org-1',
      TIMBAL_PROJECT_ID: 'proj-1',
      WEBAUTHN_RP_ID: 'bodega.example',
      WEBAUTHN_ORIGIN: 'https://bodega.example',
      APP_PUBLIC_URL: 'https://bodega.example',
      WINECORE_DATA_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    })).toThrow(/WINECORE_DATA_KEY/);
  });

  it('exige los identificadores de Timbal según el modo', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'timbal', DB_MODE: 'local' })).toThrow(/TIMBAL_ORG_ID/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'timbal',
        DB_MODE: 'timbal',
        TIMBAL_ORG_ID: 'org-1',
        TIMBAL_PROJECT_ID: 'proj-1',
      }),
    ).toThrow(/TIMBAL_KB_ID|TIMBAL_PROJECT_SECRET/);
  });
});

describe('seedInputFromEnv', () => {
  it('usa identificadores sintéticos fuera de producción', () => {
    expect(seedInputFromEnv({ NODE_ENV: 'test' })).toEqual({
      nodeEnv: 'test',
      poTaxId: '00000000T',
      cvpoTaxId: 'B00000000',
    });
  });

  it('en producción exige la variable y no repite un valor inválido', () => {
    expect(() => seedInputFromEnv({ NODE_ENV: 'production' })).toThrow(/WINECORE_SEED_PO_TAX_ID/);
    try {
      seedInputFromEnv({ NODE_ENV: 'production', WINECORE_SEED_PO_TAX_ID: 'BAD' });
    } catch (error) {
      expect((error as Error).message).toContain('WINECORE_SEED_PO_TAX_ID');
      expect((error as Error).message).not.toContain('BAD');
    }
  });
});
