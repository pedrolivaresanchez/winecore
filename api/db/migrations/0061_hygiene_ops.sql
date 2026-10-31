-- WineCore · 0061_hygiene_ops · dialecto DuckDB (ADR 002).
-- Registros operativos: aplicación del procedimiento, filtración, consumo y compra
-- de consumibles, control de envasado y mantenimiento de equipo.
-- operation_id nulo no es único: el índice de expresión solo exige unicidad cuando hay operación.

CREATE TABLE hygiene.cleaning_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id             uuid NOT NULL UNIQUE,
  procedure_id             uuid NOT NULL REFERENCES hygiene.cleaning_procedure(id),
  actual_dose              DECIMAL(12,3) NOT NULL CHECK (actual_dose > 0),
  actual_dose_unit         VARCHAR NOT NULL CHECK (actual_dose_unit IN ('g/hl','mg/l','g/l','pct','ml/l','ppm')),
  actual_contact_time_min  INTEGER NOT NULL CHECK (actual_contact_time_min > 0),
  rinsed                   BOOLEAN NOT NULL,
  operator                 VARCHAR NOT NULL CHECK (length(operator) BETWEEN 2 AND 120),
  vessel_id                uuid,
  equipment_id             uuid REFERENCES hygiene.equipment(id),
  occurred_on              DATE NOT NULL,
  notes                    VARCHAR,
  created_by               VARCHAR NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (vessel_id IS NOT NULL OR equipment_id IS NOT NULL)
);

CREATE INDEX cleaning_log_day_idx ON hygiene.cleaning_log(occurred_on);

CREATE TABLE hygiene.filtration (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id         uuid,
  occurred_at          TIMESTAMPTZ NOT NULL,
  plate_grade          VARCHAR NOT NULL CHECK (plate_grade IN ('V00','V07','V13')),
  plate_format         VARCHAR NOT NULL CHECK (length(plate_format) BETWEEN 1 AND 80),
  supplier_contact_id  uuid NOT NULL,
  plate_count          INTEGER NOT NULL CHECK (plate_count > 0),
  equipment_id         uuid REFERENCES hygiene.equipment(id),
  operator             VARCHAR NOT NULL CHECK (length(operator) BETWEEN 2 AND 120),
  location_id          uuid NOT NULL,
  owner_entity_id      uuid NOT NULL,
  notes                VARCHAR,
  created_by           VARCHAR NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX filtration_operation_uq ON hygiene.filtration (
  (CASE WHEN operation_id IS NULL THEN NULL ELSE operation_id::VARCHAR END)
);

CREATE INDEX filtration_time_idx ON hygiene.filtration(occurred_at);

CREATE TABLE hygiene.consumable_use (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL,
  location_id       uuid NOT NULL,
  owner_entity_id   uuid NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  purpose           VARCHAR NOT NULL CHECK (purpose IN ('filter_plate','cleaning_product','other')),
  filtration_id     uuid REFERENCES hygiene.filtration(id),
  cleaning_log_id   uuid REFERENCES hygiene.cleaning_log(id),
  operation_id      uuid,
  status            VARCHAR NOT NULL CHECK (status IN ('planned','posted')),
  stock_move_id     uuid,
  occurred_at       TIMESTAMPTZ,
  created_by        VARCHAR NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (filtration_id IS NOT NULL OR cleaning_log_id IS NOT NULL OR operation_id IS NOT NULL),
  CHECK (status = 'planned' OR (stock_move_id IS NOT NULL AND occurred_at IS NOT NULL))
);

CREATE INDEX consumable_use_op_idx ON hygiene.consumable_use(operation_id);

CREATE TABLE hygiene.consumable_receipt (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL,
  location_id      uuid NOT NULL,
  owner_entity_id  uuid NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  occurred_at      TIMESTAMPTZ NOT NULL,
  supplier_name    VARCHAR,
  stock_move_id    uuid NOT NULL,
  created_by       VARCHAR NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hygiene.bottling_check (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id               uuid NOT NULL UNIQUE,
  bottles_disinfected        BOOLEAN NOT NULL,
  disinfection_procedure_id  uuid REFERENCES hygiene.cleaning_procedure(id),
  fill_rejects               INTEGER NOT NULL CHECK (fill_rejects >= 0),
  closure_rejects            INTEGER NOT NULL CHECK (closure_rejects >= 0),
  label_rejects              INTEGER NOT NULL CHECK (label_rejects >= 0),
  equipment_id               uuid NOT NULL REFERENCES hygiene.equipment(id),
  closure_type               VARCHAR NOT NULL CHECK (closure_type IN ('natural_cork','agglomerated_cork')),
  seal_type                  VARCHAR NOT NULL CHECK (seal_type IN ('capsule','wax_seal')),
  notes                      VARCHAR,
  operator                   VARCHAR NOT NULL CHECK (length(operator) BETWEEN 2 AND 120),
  filled_by                  VARCHAR NOT NULL,
  filled_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT bottles_disinfected OR disinfection_procedure_id IS NOT NULL)
);

CREATE TABLE hygiene.equipment_maintenance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id  uuid NOT NULL REFERENCES hygiene.equipment(id),
  performed_at  TIMESTAMPTZ NOT NULL,
  notes         VARCHAR NOT NULL CHECK (length(notes) BETWEEN 2 AND 500),
  operator      VARCHAR NOT NULL CHECK (length(operator) BETWEEN 2 AND 120),
  next_due_on   DATE,
  created_by    VARCHAR NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX equipment_maintenance_time_idx ON hygiene.equipment_maintenance(performed_at);

CREATE TABLE hygiene.operation_equipment (
  operation_id  uuid NOT NULL,
  equipment_id  uuid NOT NULL REFERENCES hygiene.equipment(id),
  role          VARCHAR NOT NULL CHECK (role IN ('used','cleaned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, equipment_id)
);
