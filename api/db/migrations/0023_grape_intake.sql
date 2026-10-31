-- Recepción de uva: contenedor, pesada y sanidad (1:1 con cellar.operation).
-- Los CHECK van en el CREATE TABLE. DuckDB 1.5 no añade columnas NOT NULL.

CREATE TABLE cellar.grape_intake (
  operation_id         uuid PRIMARY KEY REFERENCES cellar.operation(id),
  container            VARCHAR NOT NULL CHECK (container IN ('box','bin','tank_trailer','bulk','other')),
  container_count      integer CHECK (container_count > 0),
  container_nominal_kg DECIMAL(7,2) CHECK (container_nominal_kg > 0),
  weighing             VARCHAR NOT NULL CHECK (weighing IN ('weighed','estimated')),
  sanitary_state       VARCHAR NOT NULL CHECK (sanitary_state IN ('healthy','minor','affected','severe')),
  botrytis_pct         DECIMAL(5,2) CHECK (botrytis_pct BETWEEN 0 AND 100),
  storm_damage         boolean NOT NULL DEFAULT false,
  overripe             boolean NOT NULL DEFAULT false,
  raisined             boolean NOT NULL DEFAULT false,
  microbial_notes      VARCHAR,
  decision             VARCHAR NOT NULL DEFAULT 'accepted' CHECK (decision IN ('accepted','segregated','rejected')),
  grape_temperature_c  DECIMAL(4,1) CHECK (grape_temperature_c BETWEEN -5 AND 50),
  CHECK (container <> 'box' OR container_count IS NOT NULL)
);

-- El lote de una entrada segregada no se ensambla con uno sano. NULL = no segregado.
ALTER TABLE inventory.lot ADD COLUMN segregated BOOLEAN;
