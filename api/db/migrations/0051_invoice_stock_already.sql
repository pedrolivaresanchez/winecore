-- WineCore · 0051_invoice_stock_already · dialecto DuckDB (ADR 002).
-- Marca «stock ya descontado» de un borrador. No va en billing.invoice:
-- DuckDB reescribe el UPDATE como DELETE + INSERT y lo rechaza si otra fila
-- apunta a la clave. Esta tabla no la referencia nadie, así que se puede
-- borrar y volver a insertar el motivo sin tocar la factura.

CREATE TABLE billing.invoice_stock_already (
  invoice_id  uuid PRIMARY KEY,
  reason      VARCHAR NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
