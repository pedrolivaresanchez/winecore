import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { domainError } from '../errors';
import { uuidText } from './numbers';

export interface LegalEntityRow {
  id: string;
  code: string;
  legalName: string;
  taxId: string;
  incomeTax: 'IRPF' | 'IS';
}

export interface EntityPair {
  seller: LegalEntityRow;
  buyer: LegalEntityRow;
}

export async function defaultPair(tx: Tx): Promise<EntityPair> {
  const rows = await tx.read<{
    id: string;
    code: string;
    legal_name: string;
    tax_id: string;
    income_tax: string;
  }>(sql`
    SELECT id, code, legal_name, tax_id, income_tax
    FROM core.legal_entity
    WHERE code IN ('PO', 'CVPO') AND is_active
  `);
  const seller = rows.find((row) => row.code === 'PO');
  const buyer = rows.find((row) => row.code === 'CVPO');
  if (!seller || !buyer) throw domainError('WC_VALIDATION', { entity: 'Faltan las entidades P.O o CVPO' });
  return { seller: mapEntity(seller), buyer: mapEntity(buyer) };
}

export async function pairByIds(tx: Tx, sellerId: string, buyerId: string): Promise<EntityPair> {
  const sellerKey = uuidText(sellerId);
  const buyerKey = uuidText(buyerId);
  if (sellerKey === buyerKey) {
    throw domainError('WC_VALIDATION', { buyer_entity_id: 'El comprador tiene que ser otra entidad' });
  }
  const rows = await tx.read<{
    id: string;
    code: string;
    legal_name: string;
    tax_id: string;
    income_tax: string;
  }>(`
    SELECT id, code, legal_name, tax_id, income_tax
    FROM core.legal_entity
    WHERE id IN (CAST('${sellerKey}' AS UUID), CAST('${buyerKey}' AS UUID))
  `);
  const seller = rows.find((row) => uuidText(row.id) === sellerKey);
  const buyer = rows.find((row) => uuidText(row.id) === buyerKey);
  if (!seller || !buyer) throw domainError('WC_VALIDATION', { entity: 'Entidad desconocida' });
  return { seller: mapEntity(seller), buyer: mapEntity(buyer) };
}

function mapEntity(row: {
  id: string;
  code: string;
  legal_name: string;
  tax_id: string;
  income_tax: string;
}): LegalEntityRow {
  if (row.income_tax !== 'IRPF' && row.income_tax !== 'IS') {
    throw domainError('WC_VALIDATION', { income_tax: 'Régimen desconocido' });
  }
  return {
    id: uuidText(row.id),
    code: row.code,
    legalName: row.legal_name,
    taxId: row.tax_id,
    incomeTax: row.income_tax,
  };
}
