import { sql } from '../db/sql';

/**
 * Enlace de un documento de Holded con su contacto de WineCore.
 * Por orden: el contacto que guardó la importación (siguiendo las fusiones), el NIF de las
 * líneas del documento y el nombre exacto (sin mayúsculas, tildes ni espacios de más).
 * NIF y nombre solo enlazan si identifican a un único contacto sin fusionar.
 */
export type ContactMatch = 'contact' | 'tax_id' | 'name';

/** Igual que normalizeTaxId: sin separadores, en mayúsculas y sin el ES de un NIF-IVA español. */
export function taxKeySql(expr: string): string {
  return `regexp_replace(upper(regexp_replace(coalesce(${expr}, ''), '[^0-9A-Za-z]', '', 'g')), '^ES(.{9})$', '\\1')`;
}

export function nameKeySql(expr: string): string {
  return `trim(regexp_replace(strip_accents(lower(coalesce(${expr}, ''))), '\\s+', ' ', 'g'))`;
}

/**
 * CTE `contact_tax`, `contact_name` y `holded_line_party` (NIF y nombre de las líneas de cada documento).
 * `lineKinds` limita las líneas a esas clases de documento.
 */
export function contactLinkCtes(lineKinds?: readonly string[]): string {
  const kinds = lineKinds && lineKinds.length > 0
    ? `WHERE l.kind IN (${lineKinds.map((kind) => sql`${kind}`).join(', ')})`
    : '';
  return `
    contact_tax AS (
      SELECT tax_key, any_value(id) AS id
        FROM (
          SELECT c.id, ${taxKeySql('c.tax_id')} AS tax_key
            FROM party.contact c
           WHERE c.merged_into_id IS NULL
        )
       WHERE tax_key <> ''
       GROUP BY tax_key
      HAVING count(*) = 1
    ),
    contact_name AS (
      SELECT name_key, any_value(id) AS id
        FROM (
          SELECT c.id, ${nameKeySql('c.legal_name')} AS name_key
            FROM party.contact c
           WHERE c.merged_into_id IS NULL
          UNION
          SELECT c.id, ${nameKeySql('c.trade_name')} AS name_key
            FROM party.contact c
           WHERE c.merged_into_id IS NULL AND c.trade_name IS NOT NULL
        )
       WHERE name_key <> ''
       GROUP BY name_key
      HAVING count(DISTINCT id) = 1
    ),
    holded_line_party AS (
      SELECT l.entity_id, l.kind, l.document_number, l.document_date,
             max(NULLIF(${taxKeySql('l.counterparty_tax_id')}, '')) AS tax_key,
             max(NULLIF(trim(l.counterparty_name), '')) AS counterparty_name
        FROM legacy.holded_invoice_line l
       ${kinds}
       GROUP BY l.entity_id, l.kind, l.document_number, l.document_date
    )`;
}

/**
 * Joins y expresiones del enlace para un documento con alias `alias`.
 * `stored` es el contacto guardado (puede ser NULL) y `name` el nombre de la contraparte.
 * Necesita las CTE de `contactLinkCtes` y un alias único por SELECT.
 */
export function contactLinkSql(input: {
  alias: string;
  stored: string;
  entity: string;
  kind: string;
  number: string;
  date: string;
  name: string;
}): { joins: string; id: string; match: string; lineName: string } {
  const a = input.alias;
  const joins = `
    LEFT JOIN party.contact ${a}_dc ON ${a}_dc.id = ${input.stored}
    LEFT JOIN holded_line_party ${a}_lp
      ON ${a}_lp.entity_id = ${input.entity} AND ${a}_lp.kind = ${input.kind}
     AND ${a}_lp.document_number = ${input.number} AND ${a}_lp.document_date = ${input.date}
    LEFT JOIN contact_tax ${a}_ct ON ${a}_ct.tax_key = ${a}_lp.tax_key
    LEFT JOIN contact_name ${a}_cn ON ${a}_cn.name_key = ${nameKeySql(`COALESCE(${input.name}, ${a}_lp.counterparty_name)`)}`;
  const stored = `COALESCE(${a}_dc.merged_into_id, ${a}_dc.id)`;
  return {
    joins,
    id: `CAST(COALESCE(${stored}, ${a}_ct.id, ${a}_cn.id) AS VARCHAR)`,
    match: `CASE WHEN ${stored} IS NOT NULL THEN 'contact' WHEN ${a}_ct.id IS NOT NULL THEN 'tax_id' WHEN ${a}_cn.id IS NOT NULL THEN 'name' END`,
    lineName: `${a}_lp.counterparty_name`,
  };
}
