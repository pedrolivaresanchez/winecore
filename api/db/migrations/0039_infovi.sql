-- WineCore · 0039_infovi · declaración mensual de existencias.
-- El CHECK de regulatory.submission.flow no incluye 'infovi' y DuckDB 1.5.5
-- no permite DROP CONSTRAINT. La ficha vive aquí y reutiliza la aprobación
-- regulatory_submission. Sin FK hacia approval_request: DuckDB reescribe el
-- UPDATE de una fila referenciada.

CREATE TABLE regulatory.infovi_filing (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL,
  tax_warehouse_id       uuid NOT NULL,
  kind                   VARCHAR NOT NULL DEFAULT 'infovi.mensual' CHECK (kind IN ('infovi.mensual')),
  period_start           date NOT NULL,
  period_end             date NOT NULL,
  due_date               date NOT NULL,
  status                 VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft','validated','pending_approval','approved','submitted',
                           'accepted','rejected','cancelled','rectified')),
  payload                JSON NOT NULL,
  payload_sha256         VARCHAR NOT NULL,
  rendered_attachment_id uuid,
  validation_errors      JSON NOT NULL DEFAULT '[]'::JSON,
  response_summary       JSON,
  approval_request_id    uuid,
  external_ref           VARCHAR,
  rectifies_filing_id    uuid REFERENCES regulatory.infovi_filing(id),
  created_by             VARCHAR NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (status NOT IN ('approved','submitted','accepted') OR approval_request_id IS NOT NULL),
  CHECK (status NOT IN ('validated','pending_approval','approved','submitted','accepted')
         OR json_array_length(validation_errors) = 0)
);

CREATE INDEX infovi_filing_period_idx
  ON regulatory.infovi_filing(legal_entity_id, period_start, period_end);
