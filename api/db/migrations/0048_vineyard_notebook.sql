-- WineCore · 0048_vineyard_notebook · dialecto DuckDB (ADR 002).
-- TASK-VIN-002. No modifica 0013: añade el registro de productos y las columnas
-- del cuaderno que el DDL de referencia aún no trae (plazo de seguridad, ROPO,
-- cantidad, varias parcelas vía group_id, fertilización).
-- La exportación es CSV. WineCore no presenta el cuaderno a ninguna administración.

CREATE TABLE vineyard.notebook_product (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_name      VARCHAR NOT NULL,
  registration_number  VARCHAR,
  active_substances    VARCHAR NOT NULL,
  is_organic_approved  BOOLEAN NOT NULL,
  safety_interval_days INTEGER NOT NULL DEFAULT 0 CHECK (safety_interval_days >= 0),
  max_dose             DECIMAL(12,4) NOT NULL CHECK (max_dose > 0),
  max_dose_unit        VARCHAR NOT NULL CHECK (max_dose_unit IN ('kg/ha','l/ha','g/hl','ml/hl')),
  product_kind         VARCHAR NOT NULL CHECK (product_kind IN ('phytosanitary','fertiliser','other')),
  nutrient_npk         VARCHAR,
  notes                VARCHAR,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_by           VARCHAR NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DuckDB 1.5 no admite ADD COLUMN con NOT NULL ni DEFAULT. La aplicación rellena estos campos.
ALTER TABLE vineyard.treatment ADD COLUMN record_kind VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN notebook_product_id UUID;
ALTER TABLE vineyard.treatment ADD COLUMN crop VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN variety VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN total_quantity DECIMAL(14,4);
ALTER TABLE vineyard.treatment ADD COLUMN quantity_unit VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN applicator_ropo VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN weather_notes VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN safety_interval_days INTEGER;
ALTER TABLE vineyard.treatment ADD COLUMN group_id UUID;
ALTER TABLE vineyard.treatment ADD COLUMN campaign SMALLINT;
ALTER TABLE vineyard.treatment ADD COLUMN nutrient_npk VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN application_timing VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN active_substances VARCHAR;
ALTER TABLE vineyard.treatment ADD COLUMN max_dose DECIMAL(12,4);
ALTER TABLE vineyard.treatment ADD COLUMN max_dose_unit VARCHAR;

-- Labores que el cuaderno pide y que vineyard.field_task (TASK-VIN-003) no cubre:
-- limpieza de la explotación, análisis de residuos, riego y cubierta.
CREATE TABLE vineyard.notebook_operation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        uuid NOT NULL REFERENCES vineyard.parcel(id),
  done_on          DATE NOT NULL,
  campaign         SMALLINT NOT NULL CHECK (campaign BETWEEN 1990 AND 2100),
  kind             VARCHAR NOT NULL CHECK (kind IN ('cleaning','residue_analysis','irrigation','cover_crop','other')),
  operator_name    VARCHAR,
  product_name     VARCHAR,
  active_substance VARCHAR,
  quantity         DECIMAL(14,4),
  quantity_unit    VARCHAR,
  notes            VARCHAR,
  created_by       VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quantity IS NULL OR quantity > 0)
);

CREATE INDEX notebook_product_kind_idx ON vineyard.notebook_product (product_kind);
CREATE INDEX treatment_applied_idx ON vineyard.treatment (applied_on);
CREATE INDEX notebook_operation_done_idx ON vineyard.notebook_operation (done_on);
