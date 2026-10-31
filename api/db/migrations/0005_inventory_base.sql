-- WineCore · 0005_inventory_base · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0005_inventory_base.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0005 · base de inventario y trazabilidad (inventory)
-- Almacén fiscal (fábrica de vino de P.O), ubicaciones, lotes y genealogía de lotes (DAG).
-- Especificación: docs/02-modelo-dominio.md §8
-- =====================================================================

-- Establecimiento con CAE (fábrica de vino). El CAE vive en la BD, nunca en el repo.
CREATE TABLE inventory.tax_warehouse (id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  cae             VARCHAR NOT NULL UNIQUE CHECK (cae ~ '^ES[0-9A-Z]{11}$'),
  activity_code   VARCHAR NOT NULL CHECK (activity_code ~ '^[A-Z][0-9A-Z]$'),
  -- 'V1' elaboradores de vino
  name            VARCHAR NOT NULL,
  is_test         boolean NOT NULL DEFAULT false,
  -- CAE de pruebas de la AEAT (preproducción)
  silicie_since   date,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE inventory.location (id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  -- 'BOD','TIENDA','TFRP','ECOVITIS','GRUPAMAR','VLC','TRANSITO'
  name                  VARCHAR NOT NULL,
  kind                  VARCHAR NOT NULL CHECK (kind IN (
                          'cellar',                 -- bodega (dentro del perímetro fiscal)
                          'cellar_shop',            -- tienda de la bodega
                          'own_warehouse',          -- almacén propio (p. ej. CVPO en Valencia)
                          'third_party_warehouse',  -- operador logístico con stock (TFRP, Ecovitis)
                          'forwarder',              -- transitario (tránsito hacia exportación)
                          'in_transit',             -- virtual: en camino
                          'customer_virtual')),
  -- virtual: entregado a cliente (cierra movimientos)
  tax_warehouse_id      uuid REFERENCES inventory.tax_warehouse(id),
  -- no nulo = dentro del perímetro fiscal (Q-021)
  operator_contact_id   uuid,
  controlling_entity_id uuid NOT NULL,
  address               JSON,
  is_virtual            boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('in_transit','customer_virtual') OR is_virtual),
  CHECK (kind NOT IN ('third_party_warehouse','forwarder') OR operator_contact_id IS NOT NULL)
);


-- ---------------------------------------------------------------------
-- Lotes: identidad de un contenido (uva, mosto, vino a granel, vino envasado)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.lot (id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_entity_id       uuid NOT NULL,
  code                     VARCHAR NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9./-]{1,29}$'),
  kind                     VARCHAR NOT NULL CHECK (kind IN ('grape','must','wine','bottled')),
  wine_id                  uuid,
  vintage                  smallint CHECK (vintage BETWEEN 1990 AND 2100),
  is_organic               boolean NOT NULL DEFAULT true,
  status                   VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','closed')),
  origin                   VARCHAR NOT NULL CHECK (origin IN ('reception','operation','opening_count','legacy')),
  created_by_operation_id  uuid,
  -- FK a cellar.operation (se añade en 0006)
  notes                    VARCHAR,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (producer_entity_id, code)
);


-- Genealogía: arista hijo ← padre con el volumen (o masa) aportado. Debe ser un DAG.
CREATE TABLE inventory.lot_edge (
  child_lot_id   uuid NOT NULL REFERENCES inventory.lot(id),
  parent_lot_id  uuid NOT NULL REFERENCES inventory.lot(id),
  operation_id   uuid NOT NULL,                                    -- FK a cellar.operation (se añade en 0006)
  volume_ml      bigint NOT NULL DEFAULT 0 CHECK (volume_ml >= 0),
  mass_g         bigint NOT NULL DEFAULT 0 CHECK (mass_g >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (child_lot_id, parent_lot_id, operation_id),
  CHECK (child_lot_id <> parent_lot_id),
  CHECK (volume_ml > 0 OR mass_g > 0)
);

CREATE INDEX lot_edge_parent_idx ON inventory.lot_edge(parent_lot_id);
