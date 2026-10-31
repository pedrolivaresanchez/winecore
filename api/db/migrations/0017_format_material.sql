-- WineCore · 0017_format_material · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0004_catalog.sql (catalog.format_material).
-- Sin disparadores: la auditoría la escribe el núcleo en la misma petición.
-- text → VARCHAR, numeric → DECIMAL. Las claves foráneas se quedan: format y product
-- están en el esquema catalog.

-- Materiales de envasado por formato (corchos, cápsulas de lacre, cajas de 6, palés).
-- El envasado los descuenta del stock (cellar.material_consumption).
CREATE TABLE catalog.format_material (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format_id           uuid NOT NULL REFERENCES catalog.format(id),
  material_product_id uuid NOT NULL REFERENCES catalog.product(id),
  per                 VARCHAR NOT NULL CHECK (per IN ('unit','case','pallet')),
  quantity            DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (format_id, material_product_id, per)
);
