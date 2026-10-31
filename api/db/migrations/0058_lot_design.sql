-- WineCore · 0058_lot_design · dialecto DuckDB (ADR 002).
-- Diseño de lote: extensión 1:1 de inventory.lot.
-- No se añaden columnas a inventory.lot: DuckDB no puede actualizar una columna
-- indexada (PK/UNIQUE) de una fila referenciada, y el lote está muy referenciado.
-- Las claves hacia otros esquemas las comprueba la aplicación (registro de guardas).

CREATE TABLE cellar.practice (
  code         VARCHAR PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name_es      VARCHAR NOT NULL,
  intervention BOOLEAN NOT NULL
);

INSERT INTO cellar.practice (code, name_es, intervention) VALUES
  ('desfangado', 'Desfangado', TRUE),
  ('centrifugado', 'Centrifugado', TRUE),
  ('estabilizacion_proteica', 'Estabilización proteica', TRUE),
  ('filtracion', 'Filtración', TRUE),
  ('clarificacion', 'Clarificación', TRUE),
  ('sin_sulfitos_anadidos', 'Sin sulfitos añadidos', FALSE),
  ('sin_intervencion', 'Sin intervención', FALSE);

CREATE TABLE cellar.lot_design (
  lot_id                UUID PRIMARY KEY,
  destination_kind      VARCHAR NOT NULL CHECK (destination_kind IN ('reference', 'new_collection', 'pending')),
  wine_id               UUID,
  product_id            UUID,
  collection_name       VARCHAR,
  vinification          VARCHAR NOT NULL CHECK (vinification IN ('blanco', 'tinto', 'rosado', 'orange', 'otro')),
  destemmed             BOOLEAN NOT NULL,
  inoculation_kind      VARCHAR NOT NULL CHECK (inoculation_kind IN ('espontanea', 'comercial')),
  yeast_product_id      UUID,
  yeast_lot_code        VARCHAR,
  yeast_name            VARCHAR,
  practices_applied     JSON NOT NULL,
  practices_not_applied JSON NOT NULL,
  no_intervention       BOOLEAN NOT NULL,
  aging_method          VARCHAR NOT NULL CHECK (aging_method IN ('deposito', 'barrica', 'damajuana_intemperie', 'sin_crianza')),
  aging_duration_days   INTEGER,
  single_plot           BOOLEAN NOT NULL,
  parcel_id             UUID,
  label_number          SMALLINT,
  notes                 VARCHAR,
  updated_by            VARCHAR NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (destination_kind = 'reference' AND collection_name IS NULL AND (wine_id IS NOT NULL OR product_id IS NOT NULL))
    OR (destination_kind = 'new_collection' AND wine_id IS NULL AND product_id IS NULL AND collection_name IS NOT NULL)
    OR (destination_kind = 'pending' AND wine_id IS NULL AND product_id IS NULL AND collection_name IS NULL)
  ),
  CHECK (collection_name IS NULL OR length(collection_name) BETWEEN 2 AND 80),
  CHECK (
    (inoculation_kind = 'espontanea' AND yeast_product_id IS NULL AND yeast_lot_code IS NULL AND yeast_name IS NULL)
    OR (
      inoculation_kind = 'comercial'
      AND yeast_lot_code IS NOT NULL
      AND (yeast_product_id IS NOT NULL OR yeast_name IS NOT NULL)
    )
  ),
  CHECK (yeast_lot_code IS NULL OR length(yeast_lot_code) BETWEEN 1 AND 40),
  CHECK (yeast_name IS NULL OR length(yeast_name) BETWEEN 2 AND 80),
  CHECK (aging_duration_days IS NULL OR aging_duration_days BETWEEN 0 AND 3650),
  CHECK (aging_method <> 'sin_crianza' OR aging_duration_days IS NULL OR aging_duration_days = 0),
  CHECK (NOT single_plot OR parcel_id IS NOT NULL),
  CHECK (label_number IS NULL OR label_number BETWEEN 1 AND 99),
  CHECK (notes IS NULL OR length(notes) <= 2000)
);
