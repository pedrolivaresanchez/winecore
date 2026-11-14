-- WineCore · 0053_stock_valuation · dialecto DuckDB (ADR 002).
-- Valoración de existencias: euro por litro, precio fijado por referencia y
-- recipientes o lotes sin valor. No se aplica sola a producción.
--
-- Los precios fijados se copian solo si el catálogo y la tarifa vigente ya están.
-- Si la migración corre antes, no inserta nada: load-tariffs vuelve a ejecutar
-- los INSERT de valuation_price (son idempotentes).
-- enTreDicho 23-24 (ENT-2324) toma el precio sin IVA de enTreDicho 21-22 (E202122)
-- en cada tarifa. Bobal basic 2025 (BOBAL-BASIC-2025) toma el de Bobal basic 2024
-- (EBO2024) en la versión vigente de cada tarifa. Un precio ya guardado no se pisa.

CREATE TABLE inventory.valuation_rate (
  scope          VARCHAR NOT NULL CHECK (scope IN ('demijohn', 'bulk')),
  wine_key       VARCHAR NOT NULL DEFAULT '',
  eur_per_litre  DECIMAL(12,2) NOT NULL CHECK (eur_per_litre >= 0 AND eur_per_litre <= 999999.99),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     VARCHAR NOT NULL,
  PRIMARY KEY (scope, wine_key)
);

INSERT INTO inventory.valuation_rate (scope, wine_key, eur_per_litre, updated_by)
VALUES
  ('demijohn', '', 50.00, 'migration'),
  ('bulk', '', 3.00, 'migration');

-- Precio de valoración por referencia y tarifa. Prevalece sobre la lista.
-- unit_price es la base, sin IVA.
CREATE TABLE inventory.valuation_price (
  product_id   uuid NOT NULL,
  list_code    VARCHAR NOT NULL CHECK (list_code IN ('distributor', 'shop', 'custom-horeca', 'final')),
  unit_price   DECIMAL(14,2) NOT NULL CHECK (unit_price >= 0 AND unit_price <= 999999.99),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   VARCHAR NOT NULL,
  PRIMARY KEY (product_id, list_code)
);

-- Recipiente (código estable, p. ej. LIAS) o lote (uuid). El valor de esa línea es 0.
CREATE TABLE inventory.valuation_worthless (
  subject      VARCHAR NOT NULL CHECK (subject IN ('vessel', 'lot')),
  subject_key  VARCHAR NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   VARCHAR NOT NULL,
  PRIMARY KEY (subject, subject_key)
);

INSERT INTO inventory.valuation_worthless (subject, subject_key, created_by)
VALUES ('vessel', 'LIAS', 'migration');

INSERT INTO inventory.valuation_price (product_id, list_code, unit_price, updated_by)
SELECT target.id, vigente.list_code,
       CASE WHEN vigente.tax_included
         THEN round(item.unit_price / (1 + coalesce(tax.rate, CAST(21 AS DECIMAL(5,2))) / CAST(100 AS DECIMAL(5,2))), 2)
         ELSE round(item.unit_price, 2)
       END,
       'migration'
FROM catalog.product target
JOIN catalog.product source ON source.sku = 'E202122'
JOIN (
  SELECT l.code AS list_code, l.tax_included, v.id AS version_id,
         row_number() OVER (PARTITION BY l.id ORDER BY v.valid_from DESC, v.version DESC) AS n
  FROM catalog.price_list l
  JOIN catalog.price_list_version v ON v.price_list_id = l.id
  WHERE l.is_active
    AND l.code IN ('distributor', 'shop', 'custom-horeca', 'final')
    AND v.status = 'active'
    AND v.valid_from <= CURRENT_DATE
    AND (v.valid_to IS NULL OR v.valid_to > CURRENT_DATE)
) vigente ON vigente.n = 1
JOIN catalog.price_list_item item
  ON item.version_id = vigente.version_id
 AND item.product_id = source.id
 AND item.min_qty = (
   SELECT min(other.min_qty)
   FROM catalog.price_list_item other
   WHERE other.version_id = vigente.version_id AND other.product_id = source.id
 )
LEFT JOIN billing.tax_code tax ON tax.code = coalesce(source.default_tax_code, 'IVA21')
WHERE target.sku = 'ENT-2324'
  AND NOT EXISTS (
    SELECT 1 FROM inventory.valuation_price existing
    WHERE existing.product_id = target.id AND existing.list_code = vigente.list_code
  );

INSERT INTO inventory.valuation_price (product_id, list_code, unit_price, updated_by)
SELECT target.id, vigente.list_code,
       CASE WHEN vigente.tax_included
         THEN round(item.unit_price / (1 + coalesce(tax.rate, CAST(21 AS DECIMAL(5,2))) / CAST(100 AS DECIMAL(5,2))), 2)
         ELSE round(item.unit_price, 2)
       END,
       'migration'
FROM catalog.product target
JOIN catalog.product source ON source.sku = 'EBO2024'
JOIN (
  SELECT l.code AS list_code, l.tax_included, v.id AS version_id,
         row_number() OVER (PARTITION BY l.id ORDER BY v.valid_from DESC, v.version DESC) AS n
  FROM catalog.price_list l
  JOIN catalog.price_list_version v ON v.price_list_id = l.id
  WHERE l.is_active
    AND l.code IN ('distributor', 'shop', 'custom-horeca', 'final')
    AND v.status = 'active'
    AND v.valid_from <= CURRENT_DATE
    AND (v.valid_to IS NULL OR v.valid_to > CURRENT_DATE)
) vigente ON vigente.n = 1
JOIN catalog.price_list_item item
  ON item.version_id = vigente.version_id
 AND item.product_id = source.id
 AND item.min_qty = (
   SELECT min(other.min_qty)
   FROM catalog.price_list_item other
   WHERE other.version_id = vigente.version_id AND other.product_id = source.id
 )
LEFT JOIN billing.tax_code tax ON tax.code = coalesce(source.default_tax_code, 'IVA21')
WHERE target.sku = 'BOBAL-BASIC-2025'
  AND NOT EXISTS (
    SELECT 1 FROM inventory.valuation_price existing
    WHERE existing.product_id = target.id AND existing.list_code = vigente.list_code
  );
