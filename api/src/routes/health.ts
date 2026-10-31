import type { Config } from '../config';
import type { Writer } from '../core/db/writer';

export async function health(config: Config, writer: Writer) {
  const rows = await writer.read<{ file: string }>(
    'SELECT file FROM core.schema_migration ORDER BY file DESC LIMIT 1',
  );
  return {
    status: 'ok' as const,
    sha: config.gitSha,
    schema_version: rows[0]?.file ?? null,
    db: config.dbMode,
    writer: await writer.currentRole(),
  };
}
