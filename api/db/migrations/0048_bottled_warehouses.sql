-- WineCore · 0048_bottled_warehouses · dialecto DuckDB (ADR 002).
-- Envasado de la bodega (cajas, nichos, jaulones) y palets de TFRP.
-- La foto es del 09/11/2026. El script de carga inserta los saldos; esta migración no los escribe.
-- No se aplica sola a producción.

ALTER TABLE catalog.product ADD COLUMN for_sale BOOLEAN DEFAULT TRUE;

-- Hueco físico de una línea del Excel (nicho, caja, jaulón o palet).
-- opened_* es la foto. El saldo vivo es la suma de cellar.bottled_move.
CREATE TABLE cellar.bottled_placement (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id        uuid NOT NULL,
  zone_id            uuid,
  holder_id          uuid,
  slot_kind          VARCHAR NOT NULL CHECK (slot_kind IN ('caja','nicho','jaulon','palet')),
  slot_code          VARCHAR NOT NULL CHECK (slot_code ~ '^[A-Z0-9-]{2,20}$'),
  niche_number       INTEGER CHECK (niche_number IS NULL OR niche_number > 0),
  pallet_count       INTEGER CHECK (pallet_count IS NULL OR pallet_count > 0),
  line_no            INTEGER NOT NULL CHECK (line_no > 0),
  wine_label         VARCHAR NOT NULL,
  lot_code_raw       VARCHAR,
  wine_id            uuid,
  product_id         uuid,
  lot_id             uuid,
  owner_entity_id    uuid NOT NULL,
  opened_bottles     INTEGER NOT NULL DEFAULT 0 CHECK (opened_bottles >= 0),
  bottle_ml          INTEGER CHECK (bottle_ml IS NULL OR bottle_ml > 0),
  opened_volume_ml   BIGINT NOT NULL DEFAULT 0 CHECK (opened_volume_ml >= 0),
  abv_pct            DECIMAL(5,2) CHECK (abv_pct IS NULL OR abv_pct BETWEEN 0 AND 25),
  is_organic         BOOLEAN,
  color              VARCHAR CHECK (color IS NULL OR color IN ('blanco','tinto','rosado','otro')),
  product_state      VARCHAR NOT NULL CHECK (product_state IN ('packaged_unlabeled','packaged_labeled','empty')),
  not_for_sale       BOOLEAN NOT NULL DEFAULT FALSE,
  note               VARCHAR,
  match_status       VARCHAR NOT NULL CHECK (match_status IN ('matched','unmatched','empty','note_only')),
  match_note         VARCHAR,
  source_sheet       VARCHAR NOT NULL,
  source_row         INTEGER,
  photo_date         DATE NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_sheet, source_row, line_no)
);

CREATE INDEX cellar_bottled_placement_location_idx ON cellar.bottled_placement(location_id);
CREATE INDEX cellar_bottled_placement_lot_idx ON cellar.bottled_placement(lot_id);


CREATE TABLE cellar.bottled_move (
  id               uuid PRIMARY KEY,
  occurred_at      TIMESTAMPTZ NOT NULL,
  placement_id     uuid NOT NULL REFERENCES cellar.bottled_placement(id),
  qty_units        INTEGER NOT NULL,
  volume_ml        BIGINT NOT NULL,
  move_type        VARCHAR NOT NULL CHECK (move_type IN ('opening','delivery_out','invoice_out','return_in','loss','reversal')),
  lot_id           uuid,
  source_table     VARCHAR NOT NULL CHECK (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id        uuid NOT NULL,
  source_line_id   uuid,
  reverses_move_id uuid,
  created_by       VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (qty_units <> 0 OR volume_ml <> 0),
  CHECK (
    move_type = 'reversal'
    OR (move_type IN ('opening','return_in') AND qty_units > 0 AND volume_ml >= 0)
    OR (move_type IN ('delivery_out','invoice_out','loss') AND qty_units < 0 AND volume_ml <= 0)
  )
);

CREATE INDEX cellar_bottled_move_placement_idx ON cellar.bottled_move(placement_id);
CREATE INDEX cellar_bottled_move_source_idx ON cellar.bottled_move(source_table, source_id);


-- Almacenaje TFRP: 7,20 €/palet/mes. La foto cuenta 13; las facturas de ago. y sep. cobran 12.
CREATE TABLE inventory.pallet_storage (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id                   uuid NOT NULL,
  operator_name                 VARCHAR NOT NULL,
  operator_tax_id               VARCHAR,
  price_eur_per_pallet_month    DECIMAL(12,2) NOT NULL CHECK (price_eur_per_pallet_month >= 0),
  currency                      VARCHAR NOT NULL DEFAULT 'EUR',
  counted_pallets               INTEGER NOT NULL CHECK (counted_pallets >= 0),
  notes                         VARCHAR,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory.pallet_storage_invoice (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_id        uuid NOT NULL REFERENCES inventory.pallet_storage(id),
  invoice_number    VARCHAR NOT NULL,
  invoice_date      DATE NOT NULL,
  billed_pallets    INTEGER NOT NULL CHECK (billed_pallets >= 0),
  line_amount_eur   DECIMAL(12,2) NOT NULL,
  mismatch          BOOLEAN NOT NULL,
  notes             VARCHAR NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
