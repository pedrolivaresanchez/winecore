-- WineCore · 0065 · analíticas de parcela, laboratorio, muestra y parámetros de la reunión
-- El CHECK de resultado posterior a la muestra y el sujeto lote/parcela los aplica la API:
-- DuckDB 1.5.5 no admite ADD CONSTRAINT.
-- Turbidez ya está en 0045 (0–10000). El catálogo de la reunión usa 0–1000 NTU.

-- DuckDB 1.5.5 no puede alterar cellar.analysis: analysis_result depende de ella.
-- Los datos nuevos viven en cellar.analysis_extra. La analítica de parcela,
-- sin lote, vive en cellar.parcel_analysis (lot_id no se puede dejar nulo).

UPDATE cellar.analysis_parameter
SET max_value = 1000
WHERE code = 'turbidity' AND max_value > 1000;

INSERT INTO cellar.analysis_parameter (code, name_es, unit, min_value, max_value) VALUES
  ('polymerization_index', 'Índice de polimerización (IP)', '%', 0, 100);

CREATE TABLE cellar.analysis_extra (
  analysis_id          uuid PRIMARY KEY REFERENCES cellar.analysis(id),
  parcel_id            uuid,
  lab_contact_id       uuid,
  sample_operation_id  uuid,
  result_at            TIMESTAMPTZ
);

CREATE TABLE cellar.parcel_analysis (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id            uuid NOT NULL,
  kind                 VARCHAR NOT NULL DEFAULT 'grape' CHECK (kind IN ('grape','must','fml_pack','pre_bottling','control','other')),
  sampled_at           TIMESTAMPTZ NOT NULL,
  result_at            TIMESTAMPTZ,
  lab                  VARCHAR NOT NULL CHECK (lab IN ('internal','external')),
  lab_name             VARCHAR,
  lab_contact_id       uuid,
  report_attachment_id uuid,
  notes                VARCHAR,
  created_by           VARCHAR NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (result_at IS NULL OR result_at >= sampled_at)
);

CREATE TABLE cellar.parcel_analysis_result (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     uuid NOT NULL REFERENCES cellar.parcel_analysis(id),
  parameter_code  VARCHAR NOT NULL REFERENCES cellar.analysis_parameter(code),
  value           DECIMAL(12,4) NOT NULL,
  UNIQUE (analysis_id, parameter_code)
);

CREATE INDEX parcel_analysis_parcel_idx ON cellar.parcel_analysis(parcel_id, sampled_at);
