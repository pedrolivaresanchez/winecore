-- WineCore · 0040_invoice_numbering · dialecto DuckDB (ADR 002).
-- La numeración fiscal no se crea sola: se elige al emitir la primera factura del año
-- (seguir la de Holded o empezar una serie nueva).
--
-- 1. El borrador de factura puede existir sin serie. DuckDB no altera una columna con
--    índices sobre la tabla: se quita invoice_customer_idx y 0041 lo vuelve a crear (en la
--    misma transacción, DuckDB 1.5 aborta al confirmar con datos).
-- 2. La serie que sigue a Holded conserva su ancho (F-2026-35: relleno 2). DuckDB no amplía
--    un CHECK: se rehace core.number_series con los mismos datos (nadie la referencia).

DROP INDEX billing.invoice_customer_idx;
ALTER TABLE billing.invoice ALTER COLUMN series_id DROP NOT NULL;

CREATE TABLE core.number_series_next (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  doc_type        VARCHAR NOT NULL CHECK (doc_type IN (
                    'invoice','credit_note','simplified_invoice','intercompany_invoice',
                    'delivery_note','quote','sales_order','proforma','cellar_operation','inventory_count')),
  code            VARCHAR NOT NULL CHECK (code ~ '^[A-Z]{1,4}$'),
  year            smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  prefix          VARCHAR NOT NULL CHECK (length(prefix) BETWEEN 1 AND 12),
  padding         smallint NOT NULL DEFAULT 4 CHECK (padding BETWEEN 2 AND 8),
  next_value      integer NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  is_default      boolean NOT NULL DEFAULT false,
  verifactu       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, doc_type, code, year),
  UNIQUE (legal_entity_id, prefix)
);
INSERT INTO core.number_series_next SELECT * FROM core.number_series;
DROP TABLE core.number_series;
ALTER TABLE core.number_series_next RENAME TO number_series;
