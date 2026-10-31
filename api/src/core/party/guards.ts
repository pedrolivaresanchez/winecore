import { sql } from '../db/sql';
import type { Tx } from '../db/writer';

/** UQ:party.contact(tax_id) — un NIF normalizado, un contacto vivo. */
export async function findLiveTaxId(
  tx: Tx,
  taxId: string,
  exceptId?: string,
): Promise<{ id: string; legal_name: string } | null> {
  const rows = await tx.read<{ id: string; legal_name: string }>(sql`
    SELECT id, legal_name
    FROM party.contact
    WHERE tax_id = ${taxId}
      AND archived_at IS NULL
      AND merged_into_id IS NULL
      AND (${exceptId ?? null} IS NULL OR id <> CAST(${exceptId ?? null} AS UUID))
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * UQ:party.contact_address(contact_id,kind) — una dirección por defecto viva
 * por contacto y tipo. Las demás del mismo tipo dejan de serlo.
 */
export function clearOtherDefaultAddresses(
  tx: Tx,
  contactId: string,
  kind: string,
  keepId: string,
): void {
  tx.write(sql`
    UPDATE party.contact_address
    SET is_default = FALSE
    WHERE contact_id = CAST(${contactId} AS UUID)
      AND kind = ${kind}
      AND is_default
      AND archived_at IS NULL
      AND id <> CAST(${keepId} AS UUID)
  `);
}
