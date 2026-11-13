/**
 * Revierte los albaranes CVPO anulados por error AL26-0001 y AL26-0002
 * (01a1d5b6-d65d-70de-bedb-1c5a540c3912 y 01a1d64f-d6c0-700c-9b38-95355dd1f657)
 * y deja el contador de albaranes CVPO 2026 en AL26-0001.
 *
 * Solo si no hay otro albarán numerado en esa serie. Si lo hay, no escribe y avisa.
 * Es idempotente. No toca la org 1 ni el proyecto SDR. No se ejecuta solo.
 *
 * Simular (no escribe), contra la base local:
 *   NODE_ENV=development AUTH_MODE=dev DB_MODE=local \
 *     bun scripts/revert-cvpo-al26.ts
 *
 * Aplicar sobre esa misma base local:
 *   NODE_ENV=development AUTH_MODE=dev DB_MODE=local \
 *     bun scripts/revert-cvpo-al26.ts --apply
 *
 * Timbal (org 122, proyecto 3942) queda fuera de este comando salvo que alguien
 * ponga WINECORE_REVERT_CONFIRM=AL26-0001 a propósito. Este cambio no lo hace.
 */
import { loadConfig } from '../src/config';
import { openClient } from '../src/core/db/open';
import { createWriter } from '../src/core/db/writer';
import { newId } from '../src/core/ids';
import { applyCvpoAl26, assertRevertTarget, inspectCvpoAl26 } from '../src/core/sales/revert-cvpo-al26';

const apply = process.argv.includes('--apply');

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

assertRevertTarget(process.env);

const config = loadConfig({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  AUTH_MODE: process.env.AUTH_MODE ?? 'dev',
  DB_MODE: process.env.DB_MODE ?? 'local',
});

if (config.dbMode === 'timbal' && !apply) {
  fail('Contra Timbal no hay simulación: o se confirma y se aplica, o no se conecta.');
}

const client = await openClient(config);
let code = 0;
try {
  const writer = createWriter(client);
  if (apply && !(await writer.tryAcquireLease())) {
    console.error('No se ha adquirido la escritura de la base.');
    code = 1;
  } else {
    const seen = apply
      ? await applyCvpoAl26(writer, {
        type: 'migration',
        id: 'revert-cvpo-al26',
        requestId: newId(),
        reason: 'Revertir AL26-0001 y AL26-0002 de CVPO, anulados sin movimiento',
      })
      : await inspectCvpoAl26(writer);

    console.log(JSON.stringify({ apply, ...seen }, null, 2));
    if (seen.action === 'skip') code = 2;
  }
} finally {
  await client.close?.();
}
if (code !== 0) process.exit(code);
