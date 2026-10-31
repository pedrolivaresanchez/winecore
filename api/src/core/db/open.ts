import type { Config } from '../../config';
import type { KbClient } from './client';
import { createLocalClient } from './local';
import { createTimbalClient } from './timbal';

export async function openClient(config: Config): Promise<KbClient> {
  if (config.dbMode === 'local') return createLocalClient(config.dbPath);
  return createTimbalClient({
    host: config.timbalApiHost,
    orgId: config.timbalOrgId,
    kbId: config.timbalKbId,
    token: config.timbalToken,
  });
}
