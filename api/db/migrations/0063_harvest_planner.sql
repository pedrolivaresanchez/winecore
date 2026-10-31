-- Planificador de vendimia: personal por día y plan por parcela y añada (§15).
-- El umbral del cuaderno simplificado queda sin confirmar (Q-038).

CREATE TABLE vineyard.crew_availability (
  day    date PRIMARY KEY,
  people smallint NOT NULL CHECK (people >= 0),
  notes  VARCHAR
);

CREATE TABLE vineyard.harvest_plan (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id         uuid NOT NULL REFERENCES vineyard.parcel(id),
  vintage           smallint NOT NULL CHECK (vintage BETWEEN 1990 AND 2100),
  ripeness_ready_on date,
  weather_risk      VARCHAR CHECK (weather_risk IN ('none','heat_wave','rain','storm','hail')),
  weather_note      VARCHAR,
  crew_needed       smallint CHECK (crew_needed > 0),
  earliest_on       date,
  latest_on         date,
  suggested_on      date,
  rationale         VARCHAR,
  status            VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','done','cancelled')),
  UNIQUE (parcel_id, vintage),
  CHECK (latest_on IS NULL OR earliest_on IS NULL OR latest_on >= earliest_on)
);

INSERT INTO core.setting (key, value, updated_by)
SELECT 'vineyard.simplified_notebook_max_ha',
       '{"max_ha":2,"confirmed":false,"question":"Q-038"}'::JSON,
       'migration'
WHERE NOT EXISTS (
  SELECT 1 FROM core.setting WHERE key = 'vineyard.simplified_notebook_max_ha'
);
