import { describe, expect, it } from 'bun:test';
import { sql } from '../../src/core/db/sql';
import { newId } from '../../src/core/ids';
import { assessReadiness, loadTableNames, maskCae } from '../../src/core/setup/readiness';
import { createTestApp } from '../helpers';

const CAE = 'ES00000V0000T';
const actor = { type: 'user' as const, id: 'setup-test', requestId: 'setup-test' };

type Check = {
  id: string;
  status: string;
  detail: string;
  href?: string | null;
  action?: {
    kind: string;
    items?: unknown[];
    entity?: { code: string; tax_id: string };
  };
};

type Report = {
  pending: number;
  modules: { id: string; name: string; checks: Check[] }[];
};

function call(
  ctx: Awaited<ReturnType<typeof createTestApp>>,
  method: string,
  path: string,
  body?: unknown,
  email?: string,
): Promise<Response> {
  const headers = new Headers();
  if (email) headers.set('x-dev-user', email);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return ctx.app.handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function report(ctx: Awaited<ReturnType<typeof createTestApp>>, email?: string): Promise<Report> {
  const response = await call(ctx, 'GET', '/v1/setup/readiness', undefined, email);
  expect(response.status).toBe(200);
  return response.json() as Promise<Report>;
}

function findCheck(body: Report, moduleId: string, checkId: string): Check {
  const module = body.modules.find((item) => item.id === moduleId);
  const check = module?.checks.find((item) => item.id === checkId);
  if (!check) throw new Error(`falta ${moduleId}.${checkId}`);
  return check;
}

describe('puesta en marcha', () => {
  it('lista los módulos y distingue lo que falta', async () => {
    const ctx = await createTestApp({ now: () => new Date('2026-10-31T10:00:00.000Z') });
    try {
      const body = await report(ctx);
      expect(body.modules.map((item) => item.name)).toEqual([
        'Contactos',
        'Catálogo',
        'Ventas',
        'Facturación P.O',
        'Facturación CVPO',
        'Cobros y SEPA',
        'Gastos',
        'Bodega',
        'Existencias',
        'SILICIE',
        'Viñedo',
        'CVBOT/MCP',
      ]);
      expect(body.pending).toBeGreaterThan(0);
      expect(findCheck(body, 'facturacion_po', 'entity.PO.address').status).toBe('missing');
      expect(findCheck(body, 'facturacion_po', 'entity.PO.nif').status).toBe('ok');
      expect(findCheck(body, 'facturacion_po', 'entity.PO.eori').status).toBe('ok');
      expect(findCheck(body, 'bodega', 'series.cellar').status).toBe('ok');
      expect(findCheck(body, 'gastos', 'purchasing.categories').status).toBe('ok');
      expect(findCheck(body, 'catalogo', 'catalog.price_lists').status).toBe('missing');
      expect(findCheck(body, 'ventas', 'series.sales').status).toBe('missing');
      expect(findCheck(body, 'facturacion_po', 'auth.owner_passkey').status).toBe('missing');
      expect(findCheck(body, 'cobros', 'finance.sepa').status).toBe('missing');
      expect(findCheck(body, 'cvbot', 'mcp.cvbot').status).toBe('missing');

      const admin = await call(ctx, 'GET', '/v1/setup/readiness', undefined, 'admin@winecore.test');
      expect(admin.status).toBe(200);
      const cellar = await call(ctx, 'GET', '/v1/setup/readiness', undefined, 'bodega@winecore.test');
      expect(cellar.status).toBe(403);
      const stranger = await call(ctx, 'GET', '/v1/setup/readiness', undefined, 'nadie@winecore.test');
      expect(stranger.status).toBe(403);
    } finally {
      await ctx.close();
    }
  });

  it('corrige la entidad y abre las series que faltan', async () => {
    const ctx = await createTestApp({ now: () => new Date('2026-10-31T10:00:00.000Z') });
    try {
      const pending = await call(ctx, 'PATCH', '/v1/legal-entities/PO', { tax_id: 'PENDIENTE' });
      expect(pending.status).toBe(422);
      const companyOnPerson = await call(ctx, 'PATCH', '/v1/legal-entities/PO', { tax_id: 'B00000000' });
      expect(companyOnPerson.status).toBe(422);
      const badLetter = await call(ctx, 'PATCH', '/v1/legal-entities/PO', { tax_id: `${'00000001'}T` });
      expect(badLetter.status).toBe(422);
      const forbidden = await call(ctx, 'PATCH', '/v1/legal-entities/PO', {
        address_line: 'Camino del Lagar 7',
      }, 'asesor@winecore.test');
      expect(forbidden.status).toBe(403);

      const saved = await call(ctx, 'PATCH', '/v1/legal-entities/PO', {
        legal_name: 'Productor Ejemplo',
        tax_id: '00000000T',
        address_line: 'Camino del Lagar 7',
        postal_code: '02240',
        city: 'Villarejo',
        province: 'Albacete',
        country_code: 'ES',
      });
      expect(saved.status).toBe(200);
      const entity = await saved.json() as { postal_code: string; legal_name: string };
      expect(entity.legal_name).toBe('Productor Ejemplo');
      expect(entity.postal_code).toBe('02240');

      const listed = await call(ctx, 'GET', '/v1/legal-entities', undefined, 'admin@winecore.test');
      expect(listed.status).toBe(200);
      const entities = (await listed.json() as { items: { id: string; code: string; postal_code: string | null }[] }).items;
      expect(entities.map((item) => item.code)).toContain('PO');
      expect(entities.find((item) => item.code === 'PO')?.postal_code).toBe('02240');
      expect(entities.every((item) => /^[0-9a-f-]{36}$/.test(item.id))).toBe(true);
      const hidden = await call(ctx, 'GET', '/v1/legal-entities', undefined, 'asesor@winecore.test');
      expect(hidden.status).toBe(403);
      const byAdmin = await call(ctx, 'PATCH', '/v1/legal-entities/PO', { city: 'Villarejo' }, 'admin@winecore.test');
      expect(byAdmin.status).toBe(200);

      const afterAddress = await report(ctx);
      expect(findCheck(afterAddress, 'facturacion_po', 'entity.PO.address').status).toBe('ok');

      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO party.contact (
            id, kind, legal_name, tax_id, tax_id_type, is_customer, vat_regime, country_code, created_by
          ) VALUES (
            CAST(${newId()} AS UUID), 'company', 'Importador Ejemplo', 'B00000000', 'nif',
            TRUE, 'export', 'US', 'setup-test'
          )
        `);
      });
      const needsEori = await report(ctx);
      expect(findCheck(needsEori, 'facturacion_po', 'entity.PO.eori').status).toBe('missing');
      expect(findCheck(needsEori, 'contactos', 'contacts.export_eori').status).toBe('missing');

      const withEori = await call(ctx, 'PATCH', '/v1/legal-entities/PO', { eori: 'ES00000000T' });
      expect(withEori.status).toBe(200);
      const readyEori = await report(ctx);
      expect(findCheck(readyEori, 'facturacion_po', 'entity.PO.eori').status).toBe('ok');
      expect(findCheck(readyEori, 'facturacion_po', 'entity.PO.eori').detail).not.toContain('ES00000000T');

      const billing = findCheck(readyEori, 'facturacion_po', 'series.billing.po');
      expect(billing.status).toBe('missing');
      expect(billing.action).toBeUndefined();
      expect(billing.href).toBe('settings:numbering');

      const sales = findCheck(readyEori, 'ventas', 'series.sales');
      expect(sales.action?.kind).toBe('create_series');
      const created = await call(ctx, 'POST', '/v1/number-series/bulk', { items: sales.action?.items });
      expect(created.status).toBe(201);
      const again = await call(ctx, 'POST', '/v1/number-series/bulk', { items: sales.action?.items });
      expect(again.status).toBe(200);
      const skipped = await again.json() as { items: { status: string }[] };
      expect(skipped.items.every((item) => item.status === 'skipped')).toBe(true);

      const afterSeries = await report(ctx);
      expect(findCheck(afterSeries, 'ventas', 'series.sales').status).toBe('ok');

      const forbiddenBulk = await call(ctx, 'POST', '/v1/number-series/bulk', { items: sales.action?.items }, 'admin@winecore.test');
      expect(forbiddenBulk.status).toBe(403);

      const audit = await ctx.writer.read<{ action: string; table_name: string }>(sql`
        SELECT action, table_name FROM audit.audit_log
        WHERE table_name IN ('core.legal_entity', 'core.number_series')
      `);
      expect(audit.some((row) => row.table_name === 'core.legal_entity' && row.action === 'UPDATE')).toBe(true);
      expect(audit.some((row) => row.table_name === 'core.number_series' && row.action === 'INSERT')).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  it('enmascara el CAE y la cuenta, y tolera una tabla ausente', async () => {
    const ctx = await createTestApp({ now: () => new Date('2026-10-31T10:00:00.000Z') });
    try {
      const po = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = 'PO'`);
      const cvpo = await ctx.writer.read<{ id: string }>(sql`SELECT id FROM core.legal_entity WHERE code = 'CVPO'`);
      const poId = String(po[0]?.id);
      const cvpoId = String(cvpo[0]?.id);
      await ctx.writer.withWrite(actor, async (tx) => {
        tx.write(sql`
          INSERT INTO inventory.tax_warehouse (id, legal_entity_id, cae, activity_code, name, is_test, is_active)
          VALUES (
            CAST(${newId()} AS UUID), CAST(${poId} AS UUID), ${CAE}, 'V1', 'Fábrica de prueba', TRUE, TRUE
          )
        `);
        tx.write(sql`
          INSERT INTO finance.bank_account (
            id, legal_entity_id, bank_name, iban_enc, iban_last4, sepa_creditor_id, is_active
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${poId} AS UUID), 'Caja Ejemplo', ${new Uint8Array([1])},
            '4242', 'ACREEDOR-PO', TRUE
          )
        `);
        tx.write(sql`
          INSERT INTO finance.bank_account (
            id, legal_entity_id, bank_name, iban_enc, iban_last4, sepa_creditor_id, is_active
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${cvpoId} AS UUID), 'Caja Ejemplo', ${new Uint8Array([2])},
            '1111', 'ACREEDOR-CVPO', TRUE
          )
        `);
        tx.write(sql`
          INSERT INTO core.user_credential (id, user_id, kind, label, credential_id, public_key, sign_count)
          SELECT CAST(${newId()} AS UUID), id, 'passkey', 'Llave de prueba', 'cred-setup-test', ${new Uint8Array([3])}, 0
          FROM core.app_user WHERE email = 'owner@winecore.test'
        `);
      });

      const body = await report(ctx);
      const encoded = JSON.stringify(body);
      expect(encoded).not.toContain(CAE);
      expect(encoded).not.toContain('ACREEDOR-PO');
      expect(encoded).toContain(maskCae(CAE));
      expect(encoded).toContain('···· 4242');
      expect(findCheck(body, 'silicie', 'silicie.warehouse').status).toBe('warning');
      expect(findCheck(body, 'cobros', 'finance.sepa').status).toBe('ok');
      expect(findCheck(body, 'facturacion_po', 'auth.owner_passkey').status).toBe('ok');

      const tables = await loadTableNames((statement) => ctx.writer.read(statement));
      tables.delete('cellar.vessel');
      tables.delete('regulatory.silicie_ledger');
      const partial = await assessReadiness(ctx.writer, {
        now: new Date('2026-10-31T10:00:00.000Z'),
        deliveryAlertHours: 24,
      }, tables);
      const vessels = partial.modules.find((item) => item.id === 'bodega')?.checks.find((item) => item.id === 'cellar.vessels');
      const ledgers = partial.modules.find((item) => item.id === 'silicie')?.checks.find((item) => item.id === 'silicie.ledgers');
      expect(vessels?.status).toBe('missing');
      expect(vessels?.detail).toContain('no está desplegada');
      expect(ledgers?.status).toBe('missing');
      expect(ledgers?.detail).toContain('no está desplegada');
    } finally {
      await ctx.close();
    }
  });
});
