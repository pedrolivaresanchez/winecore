-- WineCore · 0042_vineyard · catálogo de variedades y datos que 0013 no guardaba.
-- Parcelas: denominación de origen, estado ecológico y fecha de inicio de conversión
-- (organic_since sigue siendo la fecha en que pasa a ecológico).
-- Maduración: azúcar (g/L) y pH. La suma de superficies se comprueba en la API.

ALTER TABLE vineyard.parcel ADD COLUMN appellation VARCHAR;
ALTER TABLE vineyard.parcel ADD COLUMN organic_status VARCHAR DEFAULT 'organic';
ALTER TABLE vineyard.parcel ADD COLUMN conversion_started_on DATE;

ALTER TABLE vineyard.maturity_check ADD COLUMN sugar_gl DECIMAL(6,2);
ALTER TABLE vineyard.maturity_check ADD COLUMN ph DECIMAL(4,2);

CREATE TABLE vineyard.grape_variety (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name       VARCHAR NOT NULL,
  color      VARCHAR NOT NULL CHECK (color IN ('red','white')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
