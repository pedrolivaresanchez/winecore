import { seed, seedInputFromEnv } from '../db/seed';
import { migrate } from '../db/migrate';
import { createApp, type AppDeps } from '../src/app';
import { loadConfig, type Env } from '../src/config';
import { createLocalClient } from '../src/core/db/local';
import { createWriter } from '../src/core/db/writer';

export async function createTestApp(options?: {
  log?: (line: string) => void;
  env?: Env;
  now?: () => Date;
  ocr?: AppDeps['ocr'];
  approvalHook?: AppDeps['approvalHook'];
  mcpRatePerMinute?: number;
  fetchImpl?: AppDeps['fetchImpl'];
}) {
  const client = await createLocalClient(':memory:');
  await migrate(client);
  await seed(client, seedInputFromEnv({ NODE_ENV: 'test' }));
  const writer = createWriter(client);
  if (!(await writer.tryAcquireLease())) throw new Error('No se ha adquirido el arrendamiento');
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'dev',
    DEV_USER_EMAIL: 'owner@winecore.test',
    DB_MODE: 'local',
    DB_PATH: ':memory:',
    PORT: '3000',
    API_BASE_PATH: '',
    GIT_SHA: 'testsha',
    WINECORE_DATA_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ...options?.env,
  });
  const deps: AppDeps = {
    config,
    writer,
    log: options?.log ?? (() => undefined),
    fetchImpl: options?.fetchImpl,
    now: options?.now,
    ocr: options?.ocr,
    approvalHook: options?.approvalHook,
    mcpRatePerMinute: options?.mcpRatePerMinute,
  };
  const app = createApp(deps);
  return {
    app,
    client,
    writer,
    config,
    async close() {
      writer.stopMaintenance();
      await client.close?.();
    },
  };
}
