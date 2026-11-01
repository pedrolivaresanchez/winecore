import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KbClient } from '../db/client';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../db/migrations/0047_holded_native_invoices.sql',
);

/**
 * Vuelve a proyectar legacy.holded_invoice sobre las tablas nativas.
 * La migración 0047 ya lo hace una vez; esto sirve para ensayos y para
 * un histórico cargado después. Es idempotente.
 */
export async function projectHoldedInvoices(client: KbClient): Promise<{ sales: number; purchases: number }> {
  const file = await readFile(migrationPath, 'utf8');
  const match = file.match(/-- BEGIN HOLDED_PROJECT\r?\n([\s\S]*?)\r?\n-- END HOLDED_PROJECT/);
  const block = match?.[1]?.trim();
  if (!block) throw new Error('Falta el bloque de proyección Holded');
  await client.query(`BEGIN TRANSACTION;\n${block};\nCOMMIT;`);
  const rows = await client.query<{ sales: number | string; purchases: number | string }>(`
    SELECT
      (SELECT count(*) FROM billing.invoice WHERE origin = 'holded_import') AS sales,
      (SELECT count(*) FROM purchasing.supplier_invoice WHERE origin = 'holded_import') AS purchases
  `);
  return {
    sales: Number(rows[0]?.sales ?? 0),
    purchases: Number(rows[0]?.purchases ?? 0),
  };
}
