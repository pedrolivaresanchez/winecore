-- WineCore · 0049_catalog_reconcile · dialecto DuckDB (ADR 002).
-- Diario de la reparación de catálogo y bodega. No mueve stock por sí sola.
-- merged_into_id apunta a la ficha que se queda. La otra se desactiva, no se borra.

ALTER TABLE catalog.wine ADD COLUMN merged_into_id UUID;
ALTER TABLE catalog.product ADD COLUMN merged_into_id UUID;

CREATE TABLE ops.data_repair (
  id           uuid PRIMARY KEY,
  code         VARCHAR NOT NULL,
  payload      JSON NOT NULL,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at  TIMESTAMPTZ
);
