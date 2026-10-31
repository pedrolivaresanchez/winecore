import { createApp } from './app';
import { loadConfig } from './config';
import { openClient } from './core/db/open';
import { createWriter, installWriter } from './core/db/writer';
import { registerOutboxDispatch } from './jobs/outbox';
import { createScheduler } from './jobs/scheduler';
import { migrate } from '../db/migrate';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const client = await openClient(config);
  if (config.dbMode === 'local') await migrate(client);
  const writer = createWriter(client);
  installWriter(writer);
  try {
    await writer.tryAcquireLease();
  } catch {
    console.log(JSON.stringify({ level: 'error', component: 'writer', code: 'WRITER_LEASE_ACQUIRE' }));
  }
  writer.startMaintenance();
  const role = process.env.WINECORE_ROLE?.trim() || 'app';
  const scheduler = role === 'verifactu-sender'
    ? null
    : createScheduler({ isLeader: async () => (await writer.currentRole()) === 'leader' });
  if (scheduler) {
    registerOutboxDispatch(scheduler, { writer, config });
    scheduler.start();
  }
  const app = createApp({ config, writer });
  app.listen(config.port);
  console.log(JSON.stringify({ level: 'info', event: 'listen', port: config.port, role }));

  const shutdown = async () => {
    scheduler?.stop();
    writer.stopMaintenance();
    await client.close?.();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Error interno');
    process.exit(1);
  });
}
