-- WineCore · 0007_ledgers · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0007_ledgers.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0007 · libros de movimientos de stock (inventory)
-- D2: stock FÍSICO (se mueve con el albarán y las operaciones de bodega) y
--     stock FISCAL del depósito/fábrica (se mueve con la factura, regla configurable).
-- Invariantes: saldos no negativos, capacidad de recipientes, un lote por recipiente,
-- unidades ↔ volumen coherentes, periodos cerrados intocables, solo inserción.
-- Especificación: docs/02-modelo-dominio.md §10 · Conciliación: §10.6
-- =====================================================================

-- Cierre de periodos (RF "la barrera es la fecha del último periodo declarado")
CREATE TABLE inventory.period_lock (
  ledger       VARCHAR PRIMARY KEY CHECK (ledger IN ('physical','fiscal')),
  locked_until date NOT NULL,
  locked_by    VARCHAR NOT NULL,
  locked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason       VARCHAR NOT NULL
);


-- ---------------------------------------------------------------------
-- Libro FÍSICO
-- ---------------------------------------------------------------------
CREATE TABLE inventory.stock_move (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      TIMESTAMPTZ NOT NULL,
  move_type        VARCHAR NOT NULL CHECK (move_type IN (
                     'opening',                       -- aforo inicial (+)
                     'cellar_in','cellar_out',        -- desde operaciones de bodega (+/−)
                     'loss',                          -- merma/rotura/destrucción (−)
                     'delivery_out',                  -- salida por albarán (−)
                     'transfer_in',                   -- llegada a ubicación destino (consigna, traspaso) (+)
                     'return_in',                     -- devolución (+)
                     'ownership_out','ownership_in',  -- cambio de propietario en la misma ubicación (−/+)
                     'purchase_in',                   -- compra (+)
                     'count_adjust_in','count_adjust_out', -- regularización por aforo (+/−)
                     'reversal')),
  -- anula otro movimiento (signo contrario)
  location_id      uuid NOT NULL REFERENCES inventory.location(id),
  vessel_id        uuid,
  owner_entity_id  uuid NOT NULL,
  lot_id           uuid REFERENCES inventory.lot(id),
  product_id       uuid,
  product_state    VARCHAR NOT NULL CHECK (product_state IN ('grape','must','wine','packaged_unlabeled','packaged_labeled','goods')),
  qty_units        integer NOT NULL DEFAULT 0,
  volume_ml        bigint  NOT NULL DEFAULT 0,
  mass_g           bigint  NOT NULL DEFAULT 0,
  loss_kind        VARCHAR CHECK (loss_kind IN ('authorized','incident')),
  source_table     VARCHAR NOT NULL CHECK (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id        uuid NOT NULL,
  source_line_id   uuid,
  reverses_move_id uuid REFERENCES inventory.stock_move(id),
  created_by       VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (qty_units <> 0 OR volume_ml <> 0 OR mass_g <> 0),
  -- signo coherente con el tipo
  CHECK (move_type IN ('reversal')
      OR (move_type IN ('opening','transfer_in','return_in','ownership_in','purchase_in','count_adjust_in','cellar_in')
          AND qty_units >= 0 AND volume_ml >= 0 AND mass_g >= 0)
      OR (move_type IN ('loss','delivery_out','ownership_out','count_adjust_out','cellar_out')
          AND qty_units <= 0 AND volume_ml <= 0 AND mass_g <= 0)),
  CHECK ((move_type = 'loss') = (loss_kind IS NOT NULL)),
  CHECK (product_state <> 'goods' OR (product_id IS NOT NULL AND qty_units <> 0))
);

CREATE INDEX stock_move_key_idx ON inventory.stock_move(location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state);

CREATE INDEX stock_move_time_idx ON inventory.stock_move(occurred_at);

CREATE INDEX stock_move_source_idx ON inventory.stock_move(source_table, source_id);

CREATE INDEX stock_move_lot_idx ON inventory.stock_move(lot_id);


-- ---------------------------------------------------------------------
-- Libro FISCAL (por establecimiento con CAE)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.fiscal_move (id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_warehouse_id         uuid NOT NULL REFERENCES inventory.tax_warehouse(id),
  fiscal_date              date NOT NULL,
  physical_date            date,
  -- fecha de la salida física cuando difiere (C-28/Q-010)
  move_type                VARCHAR NOT NULL CHECK (move_type IN (
                             'opening','production','bulk_receipt',
                             'packaging_out_bulk','packaging_in_packaged',
                             'loss','destruction',
                             'exit_domestic','exit_export','exit_intra_eu','exit_canary',
                             'ledger_change_out','ledger_change_in',      -- SILICIE A17/A16: paso entre mayores (depósito ↔ barrica)
                             'return_in','regularization_in','regularization_out','reversal')),
  -- Mayor contable de SILICIE 2.0: granel en depósitos, granel en madera no revestida (crianza) y envasado
  product_class            VARCHAR NOT NULL CHECK (product_class IN ('bulk','bulk_wood','packaged')),
  lot_id                   uuid REFERENCES inventory.lot(id),
  product_id               uuid,
  volume_ml                bigint NOT NULL CHECK (volume_ml <> 0),
  units                    integer NOT NULL DEFAULT 0,
  abv_pct                  DECIMAL(5,2) CHECK (abv_pct BETWEEN 0 AND 25),
  excise_product_key       VARCHAR,
  nc_code                  VARCHAR CHECK (nc_code ~ '^[0-9]{8}$'),
  justification_type       VARCHAR NOT NULL CHECK (justification_type IN ('invoice','delivery_note','e_ad','customs_declaration','internal','count_record')),
  justification_ref        VARCHAR NOT NULL,
  counterparty_contact_id  uuid,
  counterparty_excise_number VARCHAR,
  fiscal_trigger           VARCHAR NOT NULL CHECK (fiscal_trigger IN ('invoice','delivery_note','operation','count','manual')),
  source_table             VARCHAR NOT NULL CHECK (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id                uuid NOT NULL,
  source_line_id           uuid,
  silicie_entry_id         uuid,
  -- FK a regulatory.silicie_entry (0012)
  reverses_move_id         uuid REFERENCES inventory.fiscal_move(id),
  reason                   VARCHAR,
  created_by               VARCHAR NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (move_type IN ('reversal')
      OR (move_type IN ('opening','production','bulk_receipt','packaging_in_packaged','ledger_change_in','return_in','regularization_in') AND volume_ml > 0 AND units >= 0)
      OR (move_type IN ('packaging_out_bulk','loss','destruction','exit_domestic','exit_export','exit_intra_eu','exit_canary','ledger_change_out','regularization_out') AND volume_ml < 0 AND units <= 0)),
  CHECK (move_type NOT IN ('ledger_change_out','ledger_change_in') OR product_class IN ('bulk','bulk_wood')),
  CHECK (product_class <> 'packaged' OR (product_id IS NOT NULL AND units <> 0)),
  CHECK (move_type NOT IN ('regularization_in','regularization_out','destruction') OR reason IS NOT NULL)
);

CREATE INDEX fiscal_move_wh_date_idx ON inventory.fiscal_move(tax_warehouse_id, fiscal_date);

CREATE INDEX fiscal_move_source_idx ON inventory.fiscal_move(source_table, source_id);

CREATE INDEX fiscal_move_silicie_idx ON inventory.fiscal_move(silicie_entry_id);


-- ---------------------------------------------------------------------
-- Inmutabilidad de los libros: solo inserción (fiscal_move admite enlazar el asiento SILICIE)
-- ---------------------------------------------------------------------

-- Periodos cerrados (WC021)

-- Unidades ↔ volumen en envasado: volume_ml = qty_units × volumen nominal del formato (WC023)

-- Saldos no negativos, capacidad y un solo lote por recipiente (WC024–WC026). Diferido al final de la transacción.

-- El saldo fiscal por establecimiento, clase y clave de producto no puede ser negativo (WC027)

-- ---------------------------------------------------------------------
-- Saldos (vistas) y existencias a fecha (inspección sin aviso)
-- ---------------------------------------------------------------------
CREATE VIEW inventory.v_stock_balance AS
SELECT location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state,
       sum(qty_units)::bigint AS qty_units, sum(volume_ml)::bigint AS volume_ml, sum(mass_g)::bigint AS mass_g
  FROM inventory.stock_move
 GROUP BY location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state
HAVING sum(qty_units) <> 0 OR sum(volume_ml) <> 0 OR sum(mass_g) <> 0;


CREATE VIEW inventory.v_fiscal_balance AS
SELECT tax_warehouse_id, product_class, excise_product_key,
       sum(volume_ml)::bigint AS volume_ml, sum(units)::bigint AS units
  FROM inventory.fiscal_move
 GROUP BY tax_warehouse_id, product_class, excise_product_key;


-- ---------------------------------------------------------------------
-- Aforos / recuentos físicos (inventario de arranque, periódico o de inspección)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.inventory_count (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL,
  number              VARCHAR,
  kind                VARCHAR NOT NULL CHECK (kind IN ('opening','periodic','inspection','spot')),
  counted_at          TIMESTAMPTZ NOT NULL,
  location_ids        UUID[] NOT NULL,
  status              VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','review','approved','posted','cancelled')),
  approval_request_id uuid,
  signed_by           uuid,
  signed_at           TIMESTAMPTZ,
  notes               VARCHAR,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved','posted') OR (signed_by IS NOT NULL AND signed_at IS NOT NULL))
);


CREATE TABLE inventory.inventory_count_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id            uuid NOT NULL REFERENCES inventory.inventory_count(id),
  location_id         uuid NOT NULL REFERENCES inventory.location(id),
  vessel_id           uuid,
  owner_entity_id     uuid NOT NULL,
  lot_id              uuid REFERENCES inventory.lot(id),
  product_id          uuid,
  product_state       VARCHAR NOT NULL CHECK (product_state IN ('must','wine','packaged_unlabeled','packaged_labeled','goods')),
  expected_qty_units  integer NOT NULL DEFAULT 0,
  expected_volume_ml  bigint NOT NULL DEFAULT 0,
  counted_qty_units   integer,
  counted_volume_ml   bigint,
  method              VARCHAR CHECK (method IN ('dipstick','flowmeter','level_gauge','unit_count','weight','estimate')),
  difference_reason   VARCHAR,
  photo_attachment_id uuid,
  CHECK (counted_qty_units IS NULL OR counted_qty_units >= 0),
  CHECK (counted_volume_ml IS NULL OR counted_volume_ml >= 0)
);

CREATE INDEX inventory_count_line_idx ON inventory.inventory_count_line(count_id);
