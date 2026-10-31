import type { Config } from '../../config';
import type { KbClient } from './client';
import { createTimbalClient } from './timbal';

export async function openClient(config: Config): Promise<KbClient> {
  if (config.dbMode === 'local') {
    // The DuckDB native binding is only loaded for local mode; the Timbal runtime never needs it.
    const { createLocalClient } = await import('./local');
    return createLocalClient(config.dbPath);
  }
  return createTimbalClient({
    host: config.timbalApiHost,
    orgId: config.timbalOrgId,
    kbId: config.timbalKbId,
    token: config.timbalToken,
  });
}
