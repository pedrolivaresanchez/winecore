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
  ledger       text PRIMARY KEY CHECK (ledger IN ('physical','fiscal')),
  locked_until date NOT NULL,
  locked_by    text NOT NULL,
  locked_at    timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL
);

-- ---------------------------------------------------------------------
-- Libro FÍSICO
-- ---------------------------------------------------------------------
CREATE TABLE inventory.stock_move (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at      timestamptz NOT NULL,
  move_type        text NOT NULL CHECK (move_type IN (
                     'opening',                       -- aforo inicial (+)
                     'cellar_in','cellar_out',        -- desde operaciones de bodega (+/−)
                     'loss',                          -- merma/rotura/destrucción (−)
                     'delivery_out',                  -- salida por albarán (−)
                     'transfer_in',                   -- llegada a ubicación destino (consigna, traspaso) (+)
                     'return_in',                     -- devolución (+)
                     'ownership_out','ownership_in',  -- cambio de propietario en la misma ubicación (−/+)
                     'purchase_in',                   -- compra (+)
                     'count_adjust_in','count_adjust_out', -- regularización por aforo (+/−)
                     'reversal')),                    -- anula otro movimiento (signo contrario)
  location_id      uuid NOT NULL REFERENCES inventory.location(id),
  vessel_id        uuid REFERENCES cellar.vessel(id),
  owner_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  lot_id           uuid REFERENCES inventory.lot(id),
  product_id       uuid REFERENCES catalog.product(id),
  product_state    text NOT NULL CHECK (product_state IN ('grape','must','wine','packaged_unlabeled','packaged_labeled','goods')),
  qty_units        integer NOT NULL DEFAULT 0,
  volume_ml        bigint  NOT NULL DEFAULT 0,
  mass_g           bigint  NOT NULL DEFAULT 0,
  loss_kind        text CHECK (loss_kind IN ('authorized','incident')),
  source_table     text NOT NULL CHECK (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id        uuid NOT NULL,
  source_line_id   uuid,
  reverses_move_id uuid REFERENCES inventory.stock_move(id),
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (qty_units <> 0 OR volume_ml <> 0 OR mass_g <> 0),
  -- signo coherente con el tipo
  CHECK (move_type IN ('reversal')
      OR (move_type IN ('opening','transfer_in','return_in','ownership_in','purchase_in','count_adjust_in','cellar_in')
          AND qty_units >= 0 AND volume_ml >= 0 AND mass_g >= 0)
      OR (move_type IN ('loss','delivery_out','ownership_out','count_adjust_out','cellar_out')
          AND qty_units <= 0 AND volume_ml <= 0 AND mass_g <= 0)),
  CHECK ((move_type = 'reversal') = (reverses_move_id IS NOT NULL)),
  CHECK ((move_type = 'loss') = (loss_kind IS NOT NULL)),
  -- granel en recipiente; envasado por producto y unidades; uva por masa
  CHECK (product_state NOT IN ('must','wine') OR (vessel_id IS NOT NULL AND lot_id IS NOT NULL AND qty_units = 0)),
  CHECK (product_state NOT IN ('packaged_unlabeled','packaged_labeled') OR (product_id IS NOT NULL AND lot_id IS NOT NULL AND vessel_id IS NULL AND qty_units <> 0)),
  CHECK (product_state <> 'grape' OR (lot_id IS NOT NULL AND mass_g <> 0)),
  CHECK (product_state <> 'goods' OR (product_id IS NOT NULL AND qty_units <> 0))
);
CREATE INDEX stock_move_key_idx ON inventory.stock_move(location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state);
CREATE INDEX stock_move_time_idx ON inventory.stock_move(occurred_at);
CREATE INDEX stock_move_source_idx ON inventory.stock_move(source_table, source_id);
CREATE INDEX stock_move_lot_idx ON inventory.stock_move(lot_id);

-- ---------------------------------------------------------------------
-- Libro FISCAL (por establecimiento con CAE)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.fiscal_move (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_warehouse_id         uuid NOT NULL REFERENCES inventory.tax_warehouse(id),
  fiscal_date              date NOT NULL,
  physical_date            date,                         -- fecha de la salida física cuando difiere (C-28/Q-010)
  move_type                text NOT NULL CHECK (move_type IN (
                             'opening','production','bulk_receipt',
                             'packaging_out_bulk','packaging_in_packaged',
                             'loss','destruction',
                             'exit_domestic','exit_export','exit_intra_eu','exit_canary',
                             'return_in','regularization_in','regularization_out','reversal')),
  product_class            text NOT NULL CHECK (product_class IN ('bulk','packaged')),
  lot_id                   uuid REFERENCES inventory.lot(id),
  product_id               uuid REFERENCES catalog.product(id),
  volume_ml                bigint NOT NULL CHECK (volume_ml <> 0),
  units                    integer NOT NULL DEFAULT 0,
  abv_pct                  numeric(5,2) CHECK (abv_pct BETWEEN 0 AND 25),
  excise_product_key       text,
  nc_code                  text CHECK (nc_code ~ '^[0-9]{8}$'),
  justification_type       text NOT NULL CHECK (justification_type IN ('invoice','delivery_note','e_ad','customs_declaration','internal','count_record')),
  justification_ref        text NOT NULL,
  counterparty_contact_id  uuid REFERENCES party.contact(id),
  counterparty_excise_number text,
  fiscal_trigger           text NOT NULL CHECK (fiscal_trigger IN ('invoice','delivery_note','operation','count','manual')),
  source_table             text NOT NULL CHECK (source_table ~ '^[a-z_]+\.[a-z_]+$'),
  source_id                uuid NOT NULL,
  source_line_id           uuid,
  silicie_entry_id         uuid,                         -- FK a regulatory.silicie_entry (0012)
  reverses_move_id         uuid REFERENCES inventory.fiscal_move(id),
  reason                   text,
  created_by               text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (move_type IN ('reversal')
      OR (move_type IN ('opening','production','bulk_receipt','packaging_in_packaged','return_in','regularization_in') AND volume_ml > 0 AND units >= 0)
      OR (move_type IN ('packaging_out_bulk','loss','destruction','exit_domestic','exit_export','exit_intra_eu','exit_canary','regularization_out') AND volume_ml < 0 AND units <= 0)),
  CHECK ((move_type = 'reversal') = (reverses_move_id IS NOT NULL)),
  CHECK (product_class <> 'packaged' OR (product_id IS NOT NULL AND units <> 0)),
  CHECK (move_type NOT IN ('regularization_in','regularization_out','destruction') OR reason IS NOT NULL)
);
CREATE INDEX fiscal_move_wh_date_idx ON inventory.fiscal_move(tax_warehouse_id, fiscal_date);
CREATE INDEX fiscal_move_source_idx ON inventory.fiscal_move(source_table, source_id);
CREATE INDEX fiscal_move_silicie_idx ON inventory.fiscal_move(silicie_entry_id);

-- ---------------------------------------------------------------------
-- Inmutabilidad de los libros: solo inserción (fiscal_move admite enlazar el asiento SILICIE)
-- ---------------------------------------------------------------------
CREATE FUNCTION inventory.stock_move_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WC022: los movimientos de stock no se modifican; se anulan con un movimiento ''reversal''';
END $$;
CREATE TRIGGER stock_move_no_update BEFORE UPDATE ON inventory.stock_move FOR EACH ROW EXECUTE FUNCTION inventory.stock_move_immutable();
CREATE TRIGGER stock_move_no_delete BEFORE DELETE ON inventory.stock_move FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE FUNCTION inventory.fiscal_move_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'silicie_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'silicie_entry_id')
     OR (OLD.silicie_entry_id IS NOT NULL AND NEW.silicie_entry_id IS DISTINCT FROM OLD.silicie_entry_id) THEN
    RAISE EXCEPTION 'WC022: un movimiento fiscal solo admite enlazar su asiento SILICIE una vez';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_move_guard BEFORE UPDATE ON inventory.fiscal_move FOR EACH ROW EXECUTE FUNCTION inventory.fiscal_move_guard();
CREATE TRIGGER fiscal_move_no_delete BEFORE DELETE ON inventory.fiscal_move FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Periodos cerrados (WC021)
CREATE FUNCTION inventory.check_period_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_until date; v_date date;
BEGIN
  IF TG_TABLE_NAME = 'stock_move' THEN
    SELECT locked_until INTO v_until FROM inventory.period_lock WHERE ledger = 'physical';
    v_date := (NEW.occurred_at AT TIME ZONE 'Europe/Madrid')::date;
  ELSE
    SELECT locked_until INTO v_until FROM inventory.period_lock WHERE ledger = 'fiscal';
    v_date := NEW.fiscal_date;
  END IF;
  IF v_until IS NOT NULL AND v_date <= v_until THEN
    RAISE EXCEPTION 'WC021: el periodo está cerrado hasta % (movimiento con fecha %)', v_until, v_date;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_move_period_lock BEFORE INSERT ON inventory.stock_move FOR EACH ROW EXECUTE FUNCTION inventory.check_period_lock();
CREATE TRIGGER fiscal_move_period_lock BEFORE INSERT ON inventory.fiscal_move FOR EACH ROW EXECUTE FUNCTION inventory.check_period_lock();

-- Unidades ↔ volumen en envasado: volume_ml = qty_units × volumen nominal del formato (WC023)
CREATE FUNCTION inventory.check_packaged_volume() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_nominal integer;
BEGIN
  IF NEW.product_state IN ('packaged_unlabeled','packaged_labeled') THEN
    SELECT f.nominal_volume_ml INTO v_nominal
      FROM catalog.product p JOIN catalog.format f ON f.id = p.format_id WHERE p.id = NEW.product_id;
    IF v_nominal IS NULL OR NEW.volume_ml <> NEW.qty_units::bigint * v_nominal THEN
      RAISE EXCEPTION 'WC023: volumen % mL incoherente con % unidades del formato (% mL)', NEW.volume_ml, NEW.qty_units, v_nominal;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_move_packaged_volume BEFORE INSERT ON inventory.stock_move FOR EACH ROW EXECUTE FUNCTION inventory.check_packaged_volume();

-- Saldos no negativos, capacidad y un solo lote por recipiente (WC024–WC026). Diferido al final de la transacción.
CREATE FUNCTION inventory.check_stock_invariants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; v_cap bigint; v_total bigint; v_lots int;
BEGIN
  SELECT coalesce(sum(qty_units),0) AS u, coalesce(sum(volume_ml),0) AS v, coalesce(sum(mass_g),0) AS m INTO s
    FROM inventory.stock_move
   WHERE location_id = NEW.location_id
     AND vessel_id IS NOT DISTINCT FROM NEW.vessel_id
     AND owner_entity_id = NEW.owner_entity_id
     AND lot_id IS NOT DISTINCT FROM NEW.lot_id
     AND product_id IS NOT DISTINCT FROM NEW.product_id
     AND product_state = NEW.product_state;
  IF s.u < 0 OR s.v < 0 OR s.m < 0 THEN
    RAISE EXCEPTION 'WC024: saldo negativo (ubicación %, recipiente %, lote %, producto %, estado %): % ud, % mL, % g',
      NEW.location_id, NEW.vessel_id, NEW.lot_id, NEW.product_id, NEW.product_state, s.u, s.v, s.m;
  END IF;
  IF NEW.vessel_id IS NOT NULL THEN
    SELECT capacity_ml INTO v_cap FROM cellar.vessel WHERE id = NEW.vessel_id;
    SELECT coalesce(sum(volume_ml),0) INTO v_total FROM inventory.stock_move WHERE vessel_id = NEW.vessel_id;
    IF v_total > v_cap THEN
      RAISE EXCEPTION 'WC025: el recipiente % supera su capacidad (% mL > % mL)', NEW.vessel_id, v_total, v_cap;
    END IF;
    SELECT count(*) INTO v_lots FROM (
      SELECT lot_id FROM inventory.stock_move WHERE vessel_id = NEW.vessel_id
       GROUP BY lot_id HAVING sum(volume_ml) > 0) t;
    IF v_lots > 1 THEN
      RAISE EXCEPTION 'WC026: el recipiente % contendría % lotes; mezclar lotes es un ensamblaje (blend)', NEW.vessel_id, v_lots;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_move_invariants AFTER INSERT ON inventory.stock_move
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.check_stock_invariants();

-- El saldo fiscal por establecimiento, clase y clave de producto no puede ser negativo (WC027)
CREATE FUNCTION inventory.check_fiscal_invariants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  SELECT coalesce(sum(volume_ml),0) INTO v FROM inventory.fiscal_move
   WHERE tax_warehouse_id = NEW.tax_warehouse_id AND product_class = NEW.product_class
     AND excise_product_key IS NOT DISTINCT FROM NEW.excise_product_key;
  IF v < 0 THEN
    RAISE EXCEPTION 'WC027: saldo fiscal negativo (% / %): % mL', NEW.product_class, NEW.excise_product_key, v;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER fiscal_move_invariants AFTER INSERT ON inventory.fiscal_move
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.check_fiscal_invariants();

-- ---------------------------------------------------------------------
-- Saldos (vistas) y existencias a fecha (inspección sin aviso)
-- ---------------------------------------------------------------------
CREATE VIEW inventory.v_stock_balance AS
SELECT location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state,
       sum(qty_units)::bigint AS qty_units, sum(volume_ml)::bigint AS volume_ml, sum(mass_g)::bigint AS mass_g
  FROM inventory.stock_move
 GROUP BY location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state
HAVING sum(qty_units) <> 0 OR sum(volume_ml) <> 0 OR sum(mass_g) <> 0;

CREATE FUNCTION inventory.stock_at(p_at timestamptz)
RETURNS TABLE(location_id uuid, vessel_id uuid, owner_entity_id uuid, lot_id uuid, product_id uuid,
              product_state text, qty_units bigint, volume_ml bigint, mass_g bigint)
LANGUAGE sql STABLE AS $$
  SELECT location_id, vessel_id, owner_entity_id, lot_id, product_id, product_state,
         sum(qty_units)::bigint, sum(volume_ml)::bigint, sum(mass_g)::bigint
    FROM inventory.stock_move WHERE occurred_at <= p_at
   GROUP BY 1,2,3,4,5,6
  HAVING sum(qty_units) <> 0 OR sum(volume_ml) <> 0 OR sum(mass_g) <> 0
$$;

CREATE VIEW inventory.v_fiscal_balance AS
SELECT tax_warehouse_id, product_class, excise_product_key,
       sum(volume_ml)::bigint AS volume_ml, sum(units)::bigint AS units
  FROM inventory.fiscal_move
 GROUP BY tax_warehouse_id, product_class, excise_product_key;

CREATE FUNCTION inventory.fiscal_at(p_date date)
RETURNS TABLE(tax_warehouse_id uuid, product_class text, excise_product_key text, volume_ml bigint, units bigint)
LANGUAGE sql STABLE AS $$
  SELECT tax_warehouse_id, product_class, excise_product_key, sum(volume_ml)::bigint, sum(units)::bigint
    FROM inventory.fiscal_move WHERE fiscal_date <= p_date
   GROUP BY 1,2,3
$$;

-- ---------------------------------------------------------------------
-- Aforos / recuentos físicos (inventario de arranque, periódico o de inspección)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.inventory_count (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  number              text,
  kind                text NOT NULL CHECK (kind IN ('opening','periodic','inspection','spot')),
  counted_at          timestamptz NOT NULL,
  location_ids        uuid[] NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','review','approved','posted','cancelled')),
  approval_request_id uuid REFERENCES ops.approval_request(id),
  signed_by           uuid REFERENCES core.app_user(id),
  signed_at           timestamptz,
  notes               text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, number),
  CHECK (status NOT IN ('approved','posted') OR (signed_by IS NOT NULL AND signed_at IS NOT NULL))
);
CREATE TRIGGER inventory_count_no_delete BEFORE DELETE ON inventory.inventory_count FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE inventory.inventory_count_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id            uuid NOT NULL REFERENCES inventory.inventory_count(id),
  location_id         uuid NOT NULL REFERENCES inventory.location(id),
  vessel_id           uuid REFERENCES cellar.vessel(id),
  owner_entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  lot_id              uuid REFERENCES inventory.lot(id),
  product_id          uuid REFERENCES catalog.product(id),
  product_state       text NOT NULL CHECK (product_state IN ('must','wine','packaged_unlabeled','packaged_labeled','goods')),
  expected_qty_units  integer NOT NULL DEFAULT 0,
  expected_volume_ml  bigint NOT NULL DEFAULT 0,
  counted_qty_units   integer,
  counted_volume_ml   bigint,
  method              text CHECK (method IN ('dipstick','flowmeter','level_gauge','unit_count','weight','estimate')),
  difference_reason   text,
  photo_attachment_id uuid REFERENCES core.attachment(id),
  CHECK (counted_qty_units IS NULL OR counted_qty_units >= 0),
  CHECK (counted_volume_ml IS NULL OR counted_volume_ml >= 0)
);
CREATE INDEX inventory_count_line_idx ON inventory.inventory_count_line(count_id);

CREATE TRIGGER period_lock_audit AFTER INSERT OR UPDATE OR DELETE ON inventory.period_lock FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER stock_move_audit AFTER INSERT ON inventory.stock_move FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER fiscal_move_audit AFTER INSERT OR UPDATE ON inventory.fiscal_move FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER inventory_count_audit AFTER INSERT OR UPDATE ON inventory.inventory_count FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER inventory_count_line_audit AFTER INSERT OR UPDATE OR DELETE ON inventory.inventory_count_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
