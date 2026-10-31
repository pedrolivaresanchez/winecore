/**
 * Semilla local de demostración. Nombres y NIF salen de generateSynthetic;
 * no hay personas ni identificadores reales en este fichero.
 * No se ejecuta en producción ni contra Timbal.
 */
import { loadConfig, type Env } from '../src/config';
import type { KbClient } from '../src/core/db/client';
import { sql } from '../src/core/db/sql';
import { newId } from '../src/core/ids';
import { migrate } from './migrate';
import { openClient } from '../src/core/db/open';
import { seed, seedInputFromEnv } from './seed';
import { generateSynthetic, type ContactRow } from './synthetic';

const TAX = /^[A-Z0-9]{2,20}$/;
const HASH = 'ee'.repeat(32);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function countOf(row: Record<string, unknown> | undefined): number {
  return Number(row?.n ?? 0);
}

async function main(): Promise<void> {
  const env: Env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    AUTH_MODE: 'dev',
    DB_MODE: 'local',
    DB_PATH: process.env.DB_PATH ?? '/tmp/winecore-rediseno.duckdb',
    DEV_USER_EMAIL: process.env.DEV_USER_EMAIL ?? 'owner@winecore.test',
    PORT: process.env.PORT ?? '3149',
  };
  if (env.NODE_ENV === 'production' || env.DB_MODE === 'timbal') {
    throw new Error('La semilla de vista previa solo corre en local');
  }
  const config = loadConfig(env);
  const client = await openClient(config);
  try {
    await migrate(client);
    const entities = await client.query<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM core.legal_entity`);
    if (countOf(entities[0]) === 0) await seed(client, seedInputFromEnv(env));
    const invoices = await client.query<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM legacy.holded_invoice`);
    if (countOf(invoices[0]) > 0) {
      console.log(JSON.stringify({ skipped: true, db: config.dbPath }));
      return;
    }
    await loadPreview(client);
    const summary = await client.query<{ contacts: number; invoices: number; products: number }>(`
      SELECT
        (SELECT COUNT(*) FROM party.contact WHERE archived_at IS NULL) AS contacts,
        (SELECT COUNT(*) FROM legacy.holded_invoice) AS invoices,
        (SELECT COUNT(*) FROM legacy.holded_product) AS products
    `);
    console.log(JSON.stringify({ seeded: true, db: config.dbPath, ...summary[0] }));
  } finally {
    await client.close?.();
  }
}

async function loadPreview(client: KbClient): Promise<void> {
  const entities = await client.query<{ id: string; code: string }>(`SELECT id, code FROM core.legal_entity`);
  const po = entities.find((row) => row.code === 'PO')?.id;
  const cvpo = entities.find((row) => row.code === 'CVPO')?.id;
  if (!po || !cvpo) throw new Error('Faltan las sociedades');

  const data = generateSynthetic({ seed: 2060, scale: 'demo' });
  const picked = data.contact
    .filter((row) => row.legal_name.length <= 120 && row.tax_id != null && TAX.test(row.tax_id))
    .slice(0, 72);
  if (picked.length < 24) throw new Error('El generador no ha dado bastantes contactos');

  const addressOf = new Map(data.contact_address.map((row) => [row.contact_id, row]));
  const personOf = new Map(data.contact_person.map((row) => [row.contact_id, row]));
  const batch = newId();
  const now = new Date('2026-10-15T10:00:00Z');

  await client.query('BEGIN TRANSACTION');
  try {
    await client.query(sql`
      INSERT INTO legacy.import_batch (id, source, entity_id, dataset, file_name, file_sha256, mode, run_by)
      VALUES (
        CAST(${batch} AS UUID), 'holded', CAST(${po} AS UUID), 'sales_invoices', 'vista-previa.xlsx', ${HASH}, 'load', 'preview'
      )
    `);

    for (let index = 0; index < picked.length; index += 1) {
      const source = picked[index] as ContactRow;
      const id = newId();
      const archived = index >= picked.length - 4;
      await client.query(sql`
        INSERT INTO party.contact (
          id, kind, legal_name, trade_name, tax_id, tax_id_type, tax_id_country, country_code,
          language, is_customer, is_supplier, is_carrier, is_logistics_operator,
          created_by, created_at, updated_at, archived_at
        ) VALUES (
          CAST(${id} AS UUID), ${source.kind}, ${source.legal_name}, ${source.trade_name},
          ${source.tax_id}, ${source.tax_id_type}, ${source.tax_id_country}, ${source.country_code},
          ${source.language}, ${source.is_customer}, ${source.is_supplier}, ${source.is_carrier},
          ${source.is_logistics_operator}, 'preview', ${now}, ${now},
          ${archived ? new Date('2026-01-02T00:00:00Z') : null}
        )
      `);
      const address = addressOf.get(source.id);
      if (address && !archived) {
        await client.query(sql`
          INSERT INTO party.contact_address (
            id, contact_id, kind, line1, postal_code, city, province, country_code, is_default
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${id} AS UUID), 'billing', ${address.line1},
            ${address.postal_code}, ${address.city}, ${address.province}, ${address.country_code}, TRUE
          )
        `);
      }
      const person = personOf.get(source.id);
      if (person && !archived && person.email && person.email === person.email.toLowerCase()) {
        await client.query(sql`
          INSERT INTO party.contact_person (id, contact_id, full_name, email, receives_invoices, receives_dunning)
          VALUES (
            CAST(${newId()} AS UUID), CAST(${id} AS UUID), ${person.full_name}, ${person.email}, TRUE, FALSE
          )
        `);
      }
      const both = index % 11 === 0;
      const none = index % 5 === 0 && !both;
      if (!archived && !none) {
        const targets = both ? [po, cvpo] : index % 2 === 0 ? [po] : [cvpo];
        for (const entityId of targets) {
          await client.query(sql`
            INSERT INTO party.contact_entity_terms (contact_id, legal_entity_id)
            VALUES (CAST(${id} AS UUID), CAST(${entityId} AS UUID))
          `);
        }
      }
      picked[index] = { ...source, id };
    }

    const names = picked.filter((_, index) => index < picked.length - 4).map((row) => row.legal_name);
    for (let index = 0; index < 48; index += 1) {
      const purchase = index >= 40;
      const month = (index % 10) + 1;
      const year = index < 36 || purchase ? 2026 : 2025;
      const date = `${year}-${pad(month)}-${pad(1 + (index % 27))}`;
      const total = 90 + (index % 8) * 40 + (index % 3) * 7.5;
      const cancelled = !purchase && index % 13 === 0;
      const pending = cancelled || index % 4 === 0 ? 0 : Math.round(total * 0.45 * 100) / 100;
      const status = cancelled ? 'Anulado' : pending === 0 ? 'Pagado' : index % 5 === 0 ? 'Vencido' : 'Pendiente';
      const entity = index % 3 === 0 ? cvpo : po;
      const id = newId();
      const number = `${purchase ? 'C' : 'F'}-${year}-${pad(index + 1)}`;
      const name = names[index % names.length] ?? 'Cliente ejemplo';
      await client.query(sql`
        INSERT INTO legacy.holded_invoice (
          id, batch_id, entity_id, kind, number, issue_date, due_date, counterparty_name,
          subtotal, total, pending, status_holded, raw
        ) VALUES (
          CAST(${id} AS UUID), CAST(${batch} AS UUID), CAST(${entity} AS UUID),
          ${purchase ? 'purchase' : 'sale'}, ${number}, CAST(${date} AS DATE), CAST(${date} AS DATE), ${name},
          ${total}, ${total}, ${pending}, ${status}, ${sql.json({})}
        )
      `);
      if (pending > 0) {
        await client.query(sql`
          INSERT INTO legacy.open_item (
            id, entity_id, direction, holded_invoice_id, document_number, document_date, due_date,
            amount, amount_paid, status
          ) VALUES (
            CAST(${newId()} AS UUID), CAST(${entity} AS UUID), ${purchase ? 'payable' : 'receivable'},
            CAST(${id} AS UUID), ${number}, CAST(${date} AS DATE), CAST(${date} AS DATE),
            ${pending}, 0, 'open'
          )
        `);
      }
    }

    for (const [index, product] of data.product.slice(0, 18).entries()) {
      await client.query(sql`
        INSERT INTO legacy.holded_product (
          id, batch_id, entity_id, name, sku, stock, sale_value, tax_label, raw
        ) VALUES (
          CAST(${newId()} AS UUID), CAST(${batch} AS UUID), CAST(${index % 3 === 0 ? cvpo : po} AS UUID),
          ${product.name}, ${product.sku}, ${4 + index}, ${6 + index}, 'IVA 21', ${sql.json({})}
        )
      `);
    }

    const catalog = [
      ['DEMO-BOTELLA', 'Botella de muestra 75 cl'],
      ['DEMO-CAJA', 'Caja de muestra 6 unidades'],
      ['DEMO-CORCHO', 'Corcho de muestra'],
    ] as const;
    for (const [sku, name] of catalog) {
      await client.query(sql`
        INSERT INTO catalog.product (id, sku, name, kind, unit, is_stock_tracked, requires_lot, is_active)
        VALUES (CAST(${newId()} AS UUID), ${sku}, ${name}, 'merchandise', 'ud', TRUE, FALSE, TRUE)
      `);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Error interno');
    process.exit(1);
  });
}
