-- WineCore · 0057_cellar_holders · dialecto DuckDB (ADR 002).
-- Nichos y jaulones: el recipiente del vino embotellado.
-- El libro físico no admite vessel_id en envasado, así que el saldo del soporte
-- usa la misma clave (ubicación, recipiente, propietario, lote, producto, estado)
-- con holder_id en el puesto del recipiente.

CREATE TABLE cellar.holder (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         uuid NOT NULL,
  zone_id             uuid REFERENCES cellar.zone(id),
  code                VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  kind                VARCHAR NOT NULL CHECK (kind IN ('nicho','jaulon')),
  name                VARCHAR NOT NULL,
  cage_number         integer CHECK (cage_number IS NULL OR cage_number > 0),
  capacity_units      integer CHECK (capacity_units IS NULL OR capacity_units > 0),
  nominal_volume_ml   integer CHECK (nominal_volume_ml IS NULL OR nominal_volume_ml > 0),
  format_code         VARCHAR,
  notes               VARCHAR,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'jaulon' OR (cage_number IS NOT NULL AND capacity_units IS NOT NULL AND nominal_volume_ml IS NOT NULL))
);

CREATE INDEX cellar_holder_location_idx ON cellar.holder(location_id);


CREATE TABLE cellar.plan_position (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     uuid NOT NULL REFERENCES cellar.zone(id),
  vessel_id   uuid REFERENCES cellar.vessel(id),
  holder_id   uuid REFERENCES cellar.holder(id),
  x           DOUBLE NOT NULL,
  y           DOUBLE NOT NULL,
  width       DOUBLE NOT NULL CHECK (width > 0),
  height      DOUBLE NOT NULL CHECK (height > 0),
  rotation    DOUBLE NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (vessel_id IS NOT NULL AND holder_id IS NULL)
    OR (vessel_id IS NULL AND holder_id IS NOT NULL)
  )
);

CREATE INDEX cellar_plan_position_zone_idx ON cellar.plan_position(zone_id);


-- Movimientos del soporte. qty_units es el signo (entrada positiva, salida negativa).
CREATE TABLE cellar.holder_move (
  id                uuid PRIMARY KEY,
  occurred_at       TIMESTAMPTZ NOT NULL,
  holder_id         uuid NOT NULL REFERENCES cellar.holder(id),
  location_id       uuid NOT NULL,
  owner_entity_id   uuid NOT NULL,
  lot_id            uuid NOT NULL,
  product_id        uuid NOT NULL,
  product_state     VARCHAR NOT NULL CHECK (product_state IN ('packaged_unlabeled','packaged_labeled')),
  qty_units         integer NOT NULL CHECK (qty_units <> 0),
  source_table      VARCHAR NOT NULL DEFAULT 'cellar.holder_move' CHECK (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id         uuid NOT NULL,
  created_by        VARCHAR NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cellar_holder_move_key_idx
  ON cellar.holder_move(location_id, holder_id, owner_entity_id, lot_id, product_id, product_state);


-- Línea de aforo que nombra el nicho o el jaulón (recipiente) y el estado.
CREATE TABLE cellar.holder_count_line (
  id                   uuid PRIMARY KEY,
  count_id             uuid NOT NULL,
  count_line_id        uuid NOT NULL,
  holder_id            uuid NOT NULL REFERENCES cellar.holder(id),
  location_id          uuid NOT NULL,
  owner_entity_id      uuid NOT NULL,
  lot_id               uuid NOT NULL,
  product_id           uuid NOT NULL,
  product_state        VARCHAR NOT NULL CHECK (product_state IN ('packaged_unlabeled','packaged_labeled')),
  counted_qty_units    integer NOT NULL CHECK (counted_qty_units >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (count_id, holder_id, owner_entity_id, lot_id, product_id, product_state)
);

CREATE INDEX cellar_holder_count_idx ON cellar.holder_count_line(count_id);
