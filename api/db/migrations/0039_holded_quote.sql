-- WineCore · 0039_holded_quote · dialecto DuckDB (ADR 002).
-- Presupuestos históricos de Holded. No hay tabla en 0016: el CHECK de holded_invoice
-- solo admite sale/purchase y DuckDB 1.5 no puede ampliar ese CHECK.
-- Solo lectura, sin serie de WineCore ni movimiento de stock.

CREATE TABLE legacy.holded_quote (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id                 uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id                uuid NOT NULL,
  number                   VARCHAR NOT NULL,
  issue_date               date NOT NULL,
  valid_until              date,
  counterparty_name        VARCHAR NOT NULL,
  counterparty_contact_id  uuid,
  description              VARCHAR,
  tags                     VARCHAR,
  subtotal                 DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat                      DECIMAL(14,2) NOT NULL DEFAULT 0,
  total                    DECIMAL(14,2) NOT NULL DEFAULT 0,
  invoiced_total           DECIMAL(14,2),
  paid_on_account          DECIMAL(14,2),
  status_holded            VARCHAR NOT NULL,
  invoiced_status          VARCHAR,
  raw                      JSON NOT NULL,
  UNIQUE (entity_id, number, issue_date)
);
