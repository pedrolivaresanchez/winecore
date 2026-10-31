import { createApp } from './app';
import { loadConfig } from './config';
import { openClient } from './core/db/open';
import { createWriter, installWriter } from './core/db/writer';
import { migrate } from '../db/migrate';
import { startDeliveryAlertJob } from './jobs/delivery-alerts';

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
  const app = createApp({ config, writer });
  const stopDeliveryAlerts = startDeliveryAlertJob(writer, config.deliveryAlertHours);
  app.listen(config.port);
  console.log(JSON.stringify({ level: 'info', event: 'listen', port: config.port }));

  const shutdown = async () => {
    stopDeliveryAlerts();
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
