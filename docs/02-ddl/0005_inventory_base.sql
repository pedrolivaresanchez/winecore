-- =====================================================================
-- WineCore · Migración 0005 · base de inventario y trazabilidad (inventory)
-- Almacén fiscal (fábrica de vino de P.O), ubicaciones, lotes y genealogía de lotes (DAG).
-- Especificación: docs/02-modelo-dominio.md §8
-- =====================================================================

-- Establecimiento con CAE (fábrica de vino). El CAE vive en la BD, nunca en el repo.
CREATE TABLE inventory.tax_warehouse (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  cae             text NOT NULL UNIQUE CHECK (cae ~ '^ES[0-9A-Z]{11}$'),
  activity_code   text NOT NULL CHECK (activity_code ~ '^[A-Z][0-9A-Z]$'),       -- 'V1' elaboradores de vino
  name            text NOT NULL,
  is_test         boolean NOT NULL DEFAULT false,                               -- CAE de pruebas de la AEAT (preproducción)
  silicie_since   date,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory.location (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),   -- 'BOD','TIENDA','TFRP','ECOVITIS','GRUPAMAR','VLC','TRANSITO'
  name                  text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN (
                          'cellar',                 -- bodega (dentro del perímetro fiscal)
                          'cellar_shop',            -- tienda de la bodega
                          'own_warehouse',          -- almacén propio (p. ej. CVPO en Valencia)
                          'third_party_warehouse',  -- operador logístico con stock (TFRP, Ecovitis)
                          'forwarder',              -- transitario (tránsito hacia exportación)
                          'in_transit',             -- virtual: en camino
                          'customer_virtual')),     -- virtual: entregado a cliente (cierra movimientos)
  tax_warehouse_id      uuid REFERENCES inventory.tax_warehouse(id),             -- no nulo = dentro del perímetro fiscal (Q-021)
  operator_contact_id   uuid REFERENCES party.contact(id),
  controlling_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  address               jsonb,
  is_virtual            boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('in_transit','customer_virtual') OR is_virtual),
  CHECK (kind NOT IN ('third_party_warehouse','forwarder') OR operator_contact_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Lotes: identidad de un contenido (uva, mosto, vino a granel, vino envasado)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.lot (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_entity_id       uuid NOT NULL REFERENCES core.legal_entity(id),
  code                     text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9./-]{1,29}$'),
  kind                     text NOT NULL CHECK (kind IN ('grape','must','wine','bottled')),
  wine_id                  uuid REFERENCES catalog.wine(id),
  vintage                  smallint CHECK (vintage BETWEEN 1990 AND 2100),
  is_organic               boolean NOT NULL DEFAULT true,
  status                   text NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','closed')),
  origin                   text NOT NULL CHECK (origin IN ('reception','operation','opening_count','legacy')),
  created_by_operation_id  uuid,                                   -- FK a cellar.operation (se añade en 0006)
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producer_entity_id, code)
);
CREATE TRIGGER lot_no_delete BEFORE DELETE ON inventory.lot FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Genealogía: arista hijo ← padre con el volumen (o masa) aportado. Debe ser un DAG.
CREATE TABLE inventory.lot_edge (
  child_lot_id   uuid NOT NULL REFERENCES inventory.lot(id),
  parent_lot_id  uuid NOT NULL REFERENCES inventory.lot(id),
  operation_id   uuid NOT NULL,                                    -- FK a cellar.operation (se añade en 0006)
  volume_ml      bigint NOT NULL DEFAULT 0 CHECK (volume_ml >= 0),
  mass_g         bigint NOT NULL DEFAULT 0 CHECK (mass_g >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_lot_id, parent_lot_id, operation_id),
  CHECK (child_lot_id <> parent_lot_id),
  CHECK (volume_ml > 0 OR mass_g > 0)
);
CREATE INDEX lot_edge_parent_idx ON inventory.lot_edge(parent_lot_id);
CREATE TRIGGER lot_edge_no_delete BEFORE DELETE ON inventory.lot_edge FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Impide ciclos: el hijo no puede ser antepasado del padre (WC030)
CREATE FUNCTION inventory.lot_edge_acyclic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE anc(id) AS (
      SELECT NEW.parent_lot_id
      UNION
      SELECT e.parent_lot_id FROM inventory.lot_edge e JOIN anc ON e.child_lot_id = anc.id
    )
    SELECT 1 FROM anc WHERE id = NEW.child_lot_id
  ) THEN
    RAISE EXCEPTION 'WC030: la genealogía de lotes tendría un ciclo (% ← %)', NEW.child_lot_id, NEW.parent_lot_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lot_edge_acyclic BEFORE INSERT OR UPDATE ON inventory.lot_edge
  FOR EACH ROW EXECUTE FUNCTION inventory.lot_edge_acyclic();

-- Ancestros de un lote (trazabilidad botella → parcela): profundidad y aporte
CREATE FUNCTION inventory.lot_ancestors(p_lot_id uuid)
RETURNS TABLE(lot_id uuid, parent_id uuid, depth integer, volume_ml bigint, mass_g bigint, operation_id uuid)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE t AS (
    SELECT e.child_lot_id, e.parent_lot_id, 1 AS depth, e.volume_ml, e.mass_g, e.operation_id
      FROM inventory.lot_edge e WHERE e.child_lot_id = p_lot_id
    UNION ALL
    SELECT e.child_lot_id, e.parent_lot_id, t.depth + 1, e.volume_ml, e.mass_g, e.operation_id
      FROM inventory.lot_edge e JOIN t ON e.child_lot_id = t.parent_lot_id
     WHERE t.depth < 50
  )
  SELECT child_lot_id, parent_lot_id, depth, volume_ml, mass_g, operation_id FROM t
$$;

-- Descendientes (retirada de producto: ¿qué botellas salen de este lote?)
CREATE FUNCTION inventory.lot_descendants(p_lot_id uuid)
RETURNS TABLE(lot_id uuid, child_id uuid, depth integer)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE t AS (
    SELECT e.parent_lot_id, e.child_lot_id, 1 AS depth FROM inventory.lot_edge e WHERE e.parent_lot_id = p_lot_id
    UNION ALL
    SELECT e.parent_lot_id, e.child_lot_id, t.depth + 1
      FROM inventory.lot_edge e JOIN t ON e.parent_lot_id = t.child_lot_id
     WHERE t.depth < 50
  )
  SELECT parent_lot_id, child_lot_id, depth FROM t
$$;

CREATE TRIGGER tax_warehouse_audit AFTER INSERT OR UPDATE ON inventory.tax_warehouse FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER location_audit AFTER INSERT OR UPDATE ON inventory.location FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER lot_audit AFTER INSERT OR UPDATE ON inventory.lot FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER lot_edge_audit AFTER INSERT ON inventory.lot_edge FOR EACH ROW EXECUTE FUNCTION audit.capture();
