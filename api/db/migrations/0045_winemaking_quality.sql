-- WineCore · 0045 · límites de analítica por categoría y turbidez
-- El rango físico sigue en cellar.analysis_parameter (rechazo).
-- Estos límites marcan fuera de especificación sin rechazar el valor.
-- SO₂ ecológico: docs/04-regulatorio/ecologico.md §3. Azúcar ≥ 5 g/L queda sin banda (pendiente de asesor).

INSERT INTO cellar.analysis_parameter (code, name_es, unit, min_value, max_value) VALUES
  ('turbidity', 'Turbidez', 'NTU', 0, 10000);

CREATE TABLE cellar.analysis_limit (
  category        VARCHAR NOT NULL,
  parameter_code  VARCHAR NOT NULL REFERENCES cellar.analysis_parameter(code),
  min_value       DECIMAL(12,4),
  max_value       DECIMAL(12,4),
  PRIMARY KEY (category, parameter_code),
  CHECK (min_value IS NOT NULL OR max_value IS NOT NULL)
);

CREATE TABLE cellar.analysis_flag (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid NOT NULL REFERENCES cellar.analysis(id),
  parameter_code  VARCHAR NOT NULL,
  category        VARCHAR NOT NULL,
  bound           VARCHAR NOT NULL CHECK (bound IN ('min','max')),
  limit_value     DECIMAL(12,4) NOT NULL,
  value           DECIMAL(12,4) NOT NULL
);

CREATE INDEX analysis_flag_analysis_idx ON cellar.analysis_flag(analysis_id);

INSERT INTO cellar.analysis_limit (category, parameter_code, max_value) VALUES
  ('organic_red_dry',   'total_so2', 100),
  ('organic_red_mid',   'total_so2', 120),
  ('organic_white_dry', 'total_so2', 150),
  ('organic_white_mid', 'total_so2', 170),
  ('organic_rose_dry',  'total_so2', 150),
  ('organic_rose_mid',  'total_so2', 170),
  ('red',               'volatile_acidity', 1.20),
  ('white',             'volatile_acidity', 1.08),
  ('rose',              'volatile_acidity', 1.08);
