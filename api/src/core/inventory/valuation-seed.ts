import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Writer } from '../db/writer';

const ACTOR = {
  type: 'migration' as const,
  id: '019c0000-0000-7000-8000-0000000000ac',
  requestId: 'valuation-seed',
};

/**
 * Copia los precios fijados de la migración 0053.
 * Idempotente: no pisa un precio que Pedro ya haya cambiado.
 * Hace falta cuando el catálogo se carga después de migrar.
 */
export async function seedValuationPrices(writer: Writer): Promise<void> {
  const statements = priceCopyStatements();
  if (statements.length === 0) return;
  await writer.withWrite(ACTOR, async (tx) => {
    for (const statement of statements) tx.write(statement);
  });
}

export function priceCopyStatements(): string[] {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations/0053_stock_valuation.sql');
  const text = readFileSync(file, 'utf8');
  return text
    .split(/;\s*(?:\n|$)/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('INSERT INTO inventory.valuation_price'));
}
