-- WineCore · 0030_cellar_plan · dialecto DuckDB (ADR 002).
-- Zonas del plano, historial de capacidad, ficha 1:1 de barrica y damajuana.
-- No altera columnas indexadas de cellar.vessel (está referenciado por el libro y las operaciones).
-- La camisa de frío ya vive en cellar.vessel.has_cooling_jacket.

CREATE TABLE cellar.zone (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id          uuid NOT NULL,
  code                 VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name                 VARCHAR NOT NULL,
  kind                 VARCHAR NOT NULL CHECK (kind IN ('elaboration','barrel_room','outdoor','bottle_store','other')),
  plan_attachment_id   uuid,
  notes                VARCHAR,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cellar_zone_location_idx ON cellar.zone(location_id);


-- Historial de capacidad. La capacidad vigente sigue en cellar.vessel.capacity_ml (no es PK ni UNIQUE).
CREATE TABLE cellar.vessel_capacity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id    uuid NOT NULL REFERENCES cellar.vessel(id),
  capacity_ml  bigint NOT NULL CHECK (capacity_ml > 0),
  reason       VARCHAR,
  recorded_by  VARCHAR NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cellar_vessel_capacity_idx ON cellar.vessel_capacity(vessel_id, recorded_at);


-- Ficha 1:1 de una barrica. vessel_id es la PK y no se actualiza.
CREATE TABLE cellar.barrel (
  vessel_id          uuid PRIMARY KEY REFERENCES cellar.vessel(id),
  oak_origin         VARCHAR NOT NULL CHECK (oak_origin IN ('frances','americano','centroeuropeo','otro')),
  forest             VARCHAR,
  toast              VARCHAR NOT NULL CHECK (toast IN ('ligero','medio','medio_plus','fuerte')),
  head_toast         boolean NOT NULL DEFAULT false,
  cooper             VARCHAR NOT NULL,
  year_made          smallint NOT NULL CHECK (year_made BETWEEN 1950 AND 2100),
  nominal_volume_ml  bigint NOT NULL CHECK (nominal_volume_ml > 0),
  purchase_date      date,
  purchase_price     DECIMAL(12,2) CHECK (purchase_price IS NULL OR purchase_price >= 0),
  use_count          integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  status             VARCHAR NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','resting','to_retire','retired')),
  retired_on         date,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'retired' OR retired_on IS NOT NULL)
);


-- Un uso por operación que llena una barrica que estaba vacía. Solo inserción.
CREATE TABLE cellar.barrel_fill (
  id            uuid PRIMARY KEY,
  vessel_id     uuid NOT NULL REFERENCES cellar.vessel(id),
  operation_id  uuid NOT NULL REFERENCES cellar.operation(id),
  lot_id        uuid,
  filled_at     TIMESTAMPTZ NOT NULL,
  created_by    VARCHAR NOT NULL,
  UNIQUE (vessel_id, operation_id)
);


-- Damajuana: crianza a la intemperie. 1:1 con el recipiente.
CREATE TABLE cellar.demijohn (
  vessel_id       uuid PRIMARY KEY REFERENCES cellar.vessel(id),
  outdoor_aging   boolean NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
