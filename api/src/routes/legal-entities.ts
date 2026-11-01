import { requestIdFor, sessionOf } from '../auth/guard';
import type { Writer } from '../core/db/writer';
import { domainError } from '../core/errors';
import { listLegalEntities, patchLegalEntity } from '../core/setup/entities';

export async function getLegalEntitiesRoute(writer: Writer, request: Request) {
  sessionOf(request);
  return { items: await listLegalEntities(writer) };
}

export async function patchLegalEntityRoute(writer: Writer, request: Request, code: string) {
  const user = sessionOf(request);
  const raw = await readJson(request);
  return writer.withWrite(
    { type: 'user', id: user.id, requestId: requestIdFor(request), reason: 'datos fiscales de la entidad' },
    (tx) => patchLegalEntity(tx, code, raw),
  );
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw domainError('WC_VALIDATION', { body: 'JSON no válido' });
  }
}
