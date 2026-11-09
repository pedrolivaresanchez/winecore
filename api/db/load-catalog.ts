import { loadConfig } from '../src/config';
import { loadCatalog } from '../src/core/catalog/load-catalog';
import { createWriter } from '../src/core/db/writer';
import { openClient } from '../src/core/db/open';

/** Catálogo real y archivo de productos Holded. bun run db/load-catalog.ts */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.dbMode === 'timbal' && process.env.WINECORE_CONFIRM_BOTTLED_LOAD !== 'si') {
    throw new Error('Para cargar en Timbal hace falta WINECORE_CONFIRM_BOTTLED_LOAD=si');
  }
  const client = await openClient(config);
  const writer = createWriter(client);
  if (!(await writer.tryAcquireLease())) throw new Error('No se ha adquirido el arrendamiento de escritura');
  try {
    console.log(JSON.stringify(await loadCatalog(writer), null, 2));
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
