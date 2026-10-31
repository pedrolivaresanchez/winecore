import type { KbClient } from '../src/core/db/client';
import { openClient } from '../src/core/db/open';
import { loadConfig } from '../src/config';
import { cellarOperationSeriesStatements, seed, seedInputFromEnv, type SeedInput } from './seed';

/**
 * Demo bootstrap. The base seed already inserts the cellar_operation series;
 * applying them again is idempotent (current year and the next, P.O and CVPO).
 */
export async function seedDemo(client: KbClient, input: SeedInput): Promise<void> {
  await seed(client, input);
  await client.query(`${cellarOperationSeriesStatements().join(';\n')};`);
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = await openClient(config);
  try {
    await seedDemo(client, seedInputFromEnv(process.env));
    console.log(JSON.stringify({ seeded: true, demo: true }));
  } finally {
    await client.close?.();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Error interno');
    process.exit(1);
  });
}
