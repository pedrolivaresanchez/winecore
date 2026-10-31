-- WineCore · 0020 · elaboración: fase de fermentación, rendimientos y hechos SILICIE
-- DuckDB 1.5.5 no permite DROP CONSTRAINT. Los tipos nuevos de fase se guardan
-- como stabilization y el tipo real va en details.winemaking_op (api/src/core/winemaking/ops.ts).
-- Especificación: docs/02-modelo-dominio.md §9.2–§9.3 · silicie.md §5 (A14, A15, A32)

CREATE TABLE cellar.fermentation_phase (
  lot_id          uuid PRIMARY KEY,
  vessel_id       uuid NOT NULL REFERENCES cellar.vessel(id),
  phase           VARCHAR NOT NULL CHECK (phase IN ('alcoholic','alcoholic_done','malolactic','malolactic_done')),
  previous_phase  VARCHAR CHECK (previous_phase IS NULL OR previous_phase IN ('alcoholic','alcoholic_done','malolactic','malolactic_done')),
  operation_id    uuid NOT NULL REFERENCES cellar.operation(id),
  active          boolean NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cellar.pressing_yield (
  operation_id      uuid PRIMARY KEY REFERENCES cellar.operation(id),
  input_state       VARCHAR NOT NULL CHECK (input_state IN ('grape','must')),
  input_mass_g      bigint NOT NULL CHECK (input_mass_g >= 0),
  input_volume_ml   bigint NOT NULL CHECK (input_volume_ml >= 0),
  must_volume_ml    bigint NOT NULL CHECK (must_volume_ml > 0),
  pomace_mass_g     bigint NOT NULL CHECK (pomace_mass_g > 0),
  must_yield        VARCHAR NOT NULL,
  must_yield_unit   VARCHAR NOT NULL CHECK (must_yield_unit IN ('l_per_100kg','volume_ratio')),
  pomace_yield      VARCHAR NOT NULL,
  pomace_yield_unit VARCHAR NOT NULL CHECK (pomace_yield_unit IN ('mass_ratio','g_per_l'))
);

-- Hechos de §5 que no son inventory.fiscal_move: A14 de uva (KGM) y A32 de elaboración (VB01).
CREATE TABLE cellar.silicie_fact (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id      uuid NOT NULL REFERENCES cellar.operation(id),
  kind              VARCHAR NOT NULL CHECK (kind IN ('crushing','elaboration_loss')),
  mass_g            bigint CHECK (mass_g IS NULL OR mass_g > 0),
  volume_ml         bigint CHECK (volume_ml IS NULL OR volume_ml > 0),
  ledger_reference  VARCHAR,
  abv_pct           DECIMAL(5,2) CHECK (abv_pct IS NULL OR abv_pct BETWEEN 0 AND 25),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'crushing' OR mass_g IS NOT NULL),
  CHECK (kind <> 'elaboration_loss' OR (volume_ml IS NOT NULL AND ledger_reference IS NOT NULL AND abv_pct IS NOT NULL))
);

CREATE INDEX silicie_fact_op_idx ON cellar.silicie_fact(operation_id);

-- Azúcar opcional de la lectura, sin alterar cellar.fermentation_reading.
CREATE TABLE cellar.fermentation_reading_extra (
  reading_id         uuid PRIMARY KEY REFERENCES cellar.fermentation_reading(id),
  residual_sugar_gl  DECIMAL(8,3) NOT NULL CHECK (residual_sugar_gl >= 0 AND residual_sugar_gl <= 400)
);

-- Un episodio abierto por recipiente, lote y regla. Al cerrarse puede repetirse.
CREATE TABLE cellar.fermentation_alert (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id       uuid NOT NULL,
  vessel_id    uuid NOT NULL,
  rule         VARCHAR NOT NULL CHECK (rule IN ('stuck','temperature','density_stall')),
  status       VARCHAR NOT NULL CHECK (status IN ('open','closed')),
  opened_at    TIMESTAMPTZ NOT NULL,
  closed_at    TIMESTAMPTZ,
  reading_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (closed_at IS NULL))
);

CREATE INDEX fermentation_alert_open_idx ON cellar.fermentation_alert(vessel_id, lot_id, rule, status);

-- Lote del aditivo y alérgenos, además de la fila de cellar.addition.
CREATE TABLE cellar.addition_trace (
  operation_id       uuid PRIMARY KEY REFERENCES cellar.operation(id),
  additive_lot_code  VARCHAR,
  allergens          JSON NOT NULL
);
