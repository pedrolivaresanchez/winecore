import { sql } from '../db/sql';
import type { Tx } from '../db/writer';
import { LABEL_SIBLINGS } from './catalog-snapshot';

type Readable = Pick<Tx, 'read'>;

export type LabelChoice = {
  product_id: string;
  sku: string;
  name: string;
  nominal_volume_ml: number | null;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  wine_code: string | null;
  nominal: string | null;
};

/** Productos con los que se puede etiquetar un jaulón de ese vino, además de la propia ficha. */
export async function siblingLabels(
  db: Readable,
  sourceWineCode: string | null,
  nominalMl: number | null,
): Promise<LabelChoice[]> {
  if (!sourceWineCode) return [];
  const skus = new Set<string>(LABEL_SIBLINGS.filter((row) => row.sourceWineCode === sourceWineCode).map((row) => row.labelSku));
  if (skus.size === 0) return [];
  const rows = await db.read<ProductRow>(sql`
    SELECT p.id::VARCHAR AS id, p.sku, p.name, w.code AS wine_code, f.nominal_volume_ml::VARCHAR AS nominal
    FROM catalog.product p
    JOIN catalog.wine w ON w.id = p.wine_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.is_active = TRUE AND p.for_sale = TRUE
  `);
  return rows
    .filter((row) => skus.has(row.sku))
    .filter((row) => fits(nominalMl, row.nominal))
    .map((row) => ({
      product_id: row.id.toLowerCase(),
      sku: row.sku,
      name: row.name,
      nominal_volume_ml: row.nominal == null ? null : Number(row.nominal),
    }));
}

export async function allowedLabelProductIds(db: Readable, sourceProductId: string): Promise<string[]> {
  const rows = await db.read<{ wine_code: string | null; nominal: string | null }>(sql`
    SELECT w.code AS wine_code, f.nominal_volume_ml::VARCHAR AS nominal
    FROM catalog.product p
    LEFT JOIN catalog.wine w ON w.id = p.wine_id
    LEFT JOIN catalog.format f ON f.id = p.format_id
    WHERE p.id = CAST(${sourceProductId} AS UUID)
  `);
  const source = rows[0];
  if (!source) return [];
  const nominal = source.nominal == null ? null : Number(source.nominal);
  const labels = await siblingLabels(db, source.wine_code, nominal);
  return labels.map((row) => row.product_id);
}

function fits(sourceNominal: number | null, labelNominal: string | null): boolean {
  if (sourceNominal == null || labelNominal == null) return true;
  return Number(labelNominal) === sourceNominal;
}
