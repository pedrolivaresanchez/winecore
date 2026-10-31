import type { Tx } from '../../db/writer';
import { takeNumber } from '../../series/numbering';

/**
 * Número de `cellar_operation` para la entidad y el año fiscal.
 * Delega en el servicio compartido de series (sin huecos, misma transacción).
 */
export async function takeCellarOperationNumber(tx: Tx, entityId: string, fiscalDate: string): Promise<string> {
  return takeNumber(tx, {
    legalEntityId: entityId,
    docType: 'cellar_operation',
    date: new Date(`${fiscalDate}T12:00:00.000Z`),
  });
}
