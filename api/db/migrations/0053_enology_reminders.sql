-- WineCore · 0053_enology_reminders · dialecto DuckDB.
-- Un aviso estacional por lote y temporada. Solo se inserta: la UNIQUE no se actualiza.

CREATE TABLE enology.reminder_dispatch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL,
  lot_id           uuid NOT NULL,
  rule_code        VARCHAR NOT NULL CHECK (rule_code IN ('winter_racking','post_spring_bottling')),
  season_key       VARCHAR NOT NULL CHECK (season_key ~ '^[0-9]{4}$'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lot_id, rule_code, season_key)
);
