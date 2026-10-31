import { createApp } from './app';
import { loadConfig } from './config';
import { openClient } from './core/db/open';
import { createWriter, installWriter } from './core/db/writer';
import { registerOutboxDispatch } from './jobs/outbox';
import { registerRegulatoryDeadlines } from './jobs/regulatory-deadlines';
import { createScheduler } from './jobs/scheduler';
import { migrate } from '../db/migrate';
import { withoutApiPrefix } from './api-prefix';

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
    registerRegulatoryDeadlines(scheduler, { writer });
    scheduler.start();
  }
  const app = createApp({ config, writer });
  Bun.serve({
    port: config.port,
    idleTimeout: 120,
    fetch: (request) => app.handle(config.apiBasePath ? request : withoutApiPrefix(request)),
  });
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Error interno';
  console.error(message);
  // The platform exposes no runtime logs: keep the port open and report the startup failure on every path.
  Bun.serve({
    port: Number(process.env.PORT) || 3000,
    // /healthcheck stays 200 so the platform keeps the process up and the reason is readable on /health.
    fetch: (request) =>
      new URL(request.url).pathname.endsWith('/healthcheck')
        ? Response.json({ status: 'degraded' })
        : Response.json({ status: 'error', stage: 'startup', message }, { status: 503 }),
  });
});
