-- WineCore · 0059_recipes · dialecto DuckDB (ADR 002).
-- Receta versionada capturada de un lote y plan sugerido al aplicarla.
-- El plan no crea ni confirma cellar.operation: sus pasos quedan en 'suggested'.

CREATE TABLE cellar.recipe (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9./-]{1,39}$'),
  name          VARCHAR NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  source_lot_id UUID,
  status        VARCHAR NOT NULL CHECK (status IN ('draft', 'published')),
  notes         VARCHAR,
  created_by    VARCHAR NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (notes IS NULL OR length(notes) <= 2000)
);

CREATE INDEX recipe_source_lot_idx ON cellar.recipe(source_lot_id);

CREATE TABLE cellar.recipe_version (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     UUID NOT NULL REFERENCES cellar.recipe(id),
  version_no    INTEGER NOT NULL CHECK (version_no >= 1),
  status        VARCHAR NOT NULL CHECK (status IN ('draft', 'published')),
  source_lot_id UUID,
  design        JSON NOT NULL,
  published_at  TIMESTAMPTZ,
  published_by  VARCHAR,
  created_by    VARCHAR NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, version_no),
  CHECK ((status = 'published') = (published_at IS NOT NULL)),
  CHECK (published_at IS NULL OR published_by IS NOT NULL)
);

CREATE INDEX recipe_version_recipe_idx ON cellar.recipe_version(recipe_id);

CREATE TABLE cellar.recipe_step (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id           UUID NOT NULL REFERENCES cellar.recipe_version(id),
  position             INTEGER NOT NULL CHECK (position >= 1),
  op_type              VARCHAR NOT NULL,
  offset_days          INTEGER NOT NULL DEFAULT 0 CHECK (offset_days >= 0),
  duration_hours       DECIMAL(8,2),
  temperature_c        DECIMAL(5,2),
  additions            JSON NOT NULL DEFAULT '[]'::JSON,
  blend_proportions    JSON NOT NULL DEFAULT '[]'::JSON,
  parameters           JSON NOT NULL DEFAULT '{}'::JSON,
  source_operation_id  UUID,
  UNIQUE (version_id, position),
  CHECK (duration_hours IS NULL OR duration_hours >= 0),
  CHECK (temperature_c IS NULL OR temperature_c BETWEEN -10 AND 50)
);

CREATE INDEX recipe_step_version_idx ON cellar.recipe_step(version_id);

CREATE TABLE cellar.elaboration_plan (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      UUID NOT NULL,
  recipe_id   UUID NOT NULL REFERENCES cellar.recipe(id),
  version_id  UUID NOT NULL REFERENCES cellar.recipe_version(id),
  start_date  DATE NOT NULL,
  created_by  VARCHAR NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX elaboration_plan_lot_idx ON cellar.elaboration_plan(lot_id);

CREATE TABLE cellar.elaboration_plan_step (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           UUID NOT NULL REFERENCES cellar.elaboration_plan(id),
  position          INTEGER NOT NULL CHECK (position >= 1),
  op_type           VARCHAR NOT NULL,
  target_date       DATE NOT NULL,
  offset_days       INTEGER NOT NULL CHECK (offset_days >= 0),
  duration_hours    DECIMAL(8,2),
  temperature_c     DECIMAL(5,2),
  additions         JSON NOT NULL,
  blend_proportions JSON NOT NULL,
  parameters        JSON NOT NULL,
  status            VARCHAR NOT NULL DEFAULT 'suggested' CHECK (status = 'suggested'),
  UNIQUE (plan_id, position)
);

CREATE INDEX elaboration_plan_step_plan_idx ON cellar.elaboration_plan_step(plan_id);
