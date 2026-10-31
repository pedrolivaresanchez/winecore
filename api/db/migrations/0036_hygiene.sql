-- WineCore · 0036_hygiene · dialecto DuckDB (ADR 002).
-- Procedimientos de limpieza y desinfección, registro de equipo y consumibles
-- de filtración/limpieza. El stock reutiliza catalog.product kind = packaging_material
-- y el libro físico con product_state = 'goods' (compra purchase_in, consumo cellar_out).
-- El efluente queda anotado; el requisito ambiental está PENDIENTE de confirmar.

CREATE SCHEMA hygiene;

CREATE TABLE hygiene.cleaning_procedure (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name                VARCHAR NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  purpose             VARCHAR NOT NULL CHECK (purpose IN ('cleaning','disinfection','both')),
  product_name        VARCHAR NOT NULL CHECK (length(product_name) BETWEEN 2 AND 120),
  product_id          uuid,
  active_substance    VARCHAR NOT NULL CHECK (length(active_substance) BETWEEN 2 AND 120),
  dose_min            DECIMAL(12,3) NOT NULL CHECK (dose_min > 0),
  dose_max            DECIMAL(12,3) NOT NULL CHECK (dose_max >= dose_min),
  dose_unit           VARCHAR NOT NULL CHECK (dose_unit IN ('g/hl','mg/l','g/l','pct','ml/l','ppm')),
  concentration       VARCHAR,
  contact_time_min    INTEGER NOT NULL CHECK (contact_time_min > 0),
  rinse_required      BOOLEAN NOT NULL,
  applicable_classes  JSON NOT NULL,
  effluent_destination VARCHAR NOT NULL CHECK (length(effluent_destination) BETWEEN 2 AND 200),
  effluent_note       VARCHAR NOT NULL DEFAULT 'El requisito ambiental está PENDIENTE de confirmar.',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hygiene.equipment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name               VARCHAR NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  kind               VARCHAR NOT NULL CHECK (kind IN (
                       'bottler','filter','filter_housing','pump','press','destemmer','other')),
  capacity           DECIMAL(14,3),
  capacity_unit      VARCHAR CHECK (capacity_unit IS NULL OR capacity_unit IN ('ud','l','hl','ml','plates')),
  maintenance_notes  VARCHAR,
  status             VARCHAR NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','out_of_service','retired')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (capacity IS NULL AND capacity_unit IS NULL)
    OR (capacity IS NOT NULL AND capacity_unit IS NOT NULL AND capacity > 0)
  )
);

-- Producto de catálogo que se cuenta como consumible (placas, producto de limpieza).
-- product_id apunta a catalog.product (kind packaging_material); sin FK entre esquemas.
CREATE TABLE hygiene.consumable (
  product_id      uuid PRIMARY KEY,
  consumable_kind VARCHAR NOT NULL CHECK (consumable_kind IN ('filter_plate','cleaning_product','other')),
  created_by      VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO core.setting (key, value, updated_by)
VALUES ('hygiene.bottling_checklist_required', 'true'::JSON, 'migration');
