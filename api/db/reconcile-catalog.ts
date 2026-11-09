import { loadConfig } from '../src/config';
import { reconcileCatalog, type ReconcileReport } from '../src/core/catalog/reconcile';
import { createWriter } from '../src/core/db/writer';
import { openClient } from '../src/core/db/open';

/**
 * Repara catálogo, enTreDicho, ubicaciones y las líneas de stock que no casaron.
 * No envía nada a SILICIE. Por defecto simula.
 *
 *   bun run db/reconcile-catalog.ts              # dry-run
 *   bun run db/reconcile-catalog.ts --apply
 *   bun run db/reconcile-catalog.ts --revert
 *
 * En Timbal hace falta WINECORE_CONFIRM_BOTTLED_LOAD=si y el arrendamiento
 * core.writer_lease. Después, en este orden: load:tariffs.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const mode: ReconcileReport['mode'] = process.argv.includes('--revert')
    ? 'revert'
    : process.argv.includes('--apply')
      ? 'apply'
      : 'dry-run';
  if (config.dbMode === 'timbal' && process.env.WINECORE_CONFIRM_BOTTLED_LOAD !== 'si') {
    throw new Error('Para tocar Timbal hace falta WINECORE_CONFIRM_BOTTLED_LOAD=si');
  }
  const client = await openClient(config);
  const writer = createWriter(client);
  if (!(await writer.tryAcquireLease())) throw new Error('No se ha adquirido el arrendamiento de escritura');
  try {
    console.log(JSON.stringify(await reconcileCatalog(writer, mode), null, 2));
  } finally {
    writer.stopMaintenance();
    await client.close?.();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Error interno');
    process.exit(1);
  });
}
