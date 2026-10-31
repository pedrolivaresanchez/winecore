-- WineCore · 0016_legacy · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0016_legacy.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts
-- Histórico de solo lectura (WC140) y el cobro de partidas abiertas (WC100/WC101) los aplica el núcleo.
-- DuckDB no puede hacer ALTER del CHECK de payment_allocation: la lista final está en 0011.

-- =====================================================================
-- WineCore · Migración 0016 · histórico importado (legacy) — M1 (contactos/productos) y M7 (resto)
-- Archivo de solo lectura de Holded (CVPO y P.O), Shopify, PDF y contabilidad histórica (D7),
-- más las partidas abiertas (cobros/pagos pendientes) al corte.
-- Especificación: docs/06-migracion.md. Contiene datos personales: mismo nivel de protección que party.*
-- Las facturas de Holded NO son facturas de WineCore: no generan registros Verifactu ni usan sus series.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS legacy;


CREATE TABLE legacy.import_batch (id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        VARCHAR NOT NULL CHECK (source IN ('holded','shopify','accounting_d7','pdf')),
  entity_id     uuid,
  dataset       VARCHAR NOT NULL,
  -- p. ej. 'contacts','sales_invoices','sales_invoice_lines'
  file_name     VARCHAR NOT NULL,
  file_sha256   VARCHAR NOT NULL,
  mode          VARCHAR NOT NULL CHECK (mode IN ('dry_run','load')),
  rows_read     integer NOT NULL DEFAULT 0,
  rows_loaded   integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  report        JSON NOT NULL DEFAULT '{}'::JSON,
  -- calidad: rechazos con motivo, avisos, totales por año
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  run_by        VARCHAR NOT NULL
);


-- Facturas emitidas y recibidas de Holded (cabecera)
CREATE TABLE legacy.holded_invoice (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id           uuid NOT NULL,
  kind                VARCHAR NOT NULL CHECK (kind IN ('sale','purchase')),
  number              VARCHAR NOT NULL,
  internal_number     VARCHAR,
  issue_date          date NOT NULL,
  operation_date      date,
  accounting_date     date,
  due_date            date,
  counterparty_name   VARCHAR NOT NULL,
  counterparty_contact_id uuid,
  description         VARCHAR,
  tags                VARCHAR,
  account_label       VARCHAR,
  payment_method      VARCHAR,
  subtotal            DECIMAL(14,2) NOT NULL,
  vat                 DECIMAL(14,2) NOT NULL DEFAULT 0,
  vat_2               DECIMAL(14,2),
  withholding         DECIMAL(14,2) NOT NULL DEFAULT 0,
  surcharge           DECIMAL(14,2) NOT NULL DEFAULT 0,
  total               DECIMAL(14,2) NOT NULL,
  paid                DECIMAL(14,2),
  pending             DECIMAL(14,2),
  status_holded       VARCHAR NOT NULL,
  -- Pagado, Vencido, Anulado, Pendiente, Cobrado
  paid_on             date,
  face_status         VARCHAR,
  number_anomaly      VARCHAR CHECK (number_anomaly IN ('suffix','year_mismatch','gap_before','duplicate')),
  raw                 JSON NOT NULL,
  UNIQUE (entity_id, kind, number, issue_date)
);

CREATE INDEX holded_invoice_cp_idx ON legacy.holded_invoice(counterparty_contact_id);


CREATE TABLE legacy.holded_invoice_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id          uuid NOT NULL,
  kind               VARCHAR NOT NULL CHECK (kind IN ('sale','purchase','delivery_note','quote')),
  document_number    VARCHAR NOT NULL,
  document_date      date NOT NULL,
  due_date           date,
  line_seq           integer NOT NULL CHECK (line_seq > 0),          -- orden en el fichero dentro del documento
  description        VARCHAR,
  is_draft           boolean NOT NULL DEFAULT false,
  counterparty_name  VARCHAR,
  counterparty_tax_id VARCHAR,
  postal_code        VARCHAR,
  city               VARCHAR,
  country            VARCHAR,
  sku                VARCHAR,
  item               VARCHAR,
  tags               VARCHAR,
  account_label      VARCHAR,
  units              DECIMAL(14,3),
  subtotal           DECIMAL(14,2),
  tax_rate_label     VARCHAR,
  tax_amount         DECIMAL(14,2),
  total              DECIMAL(14,2),
  matched_product_id uuid,
  raw                JSON NOT NULL,
  UNIQUE (entity_id, kind, document_number, document_date, line_seq)
);


CREATE TABLE legacy.holded_delivery_note (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id         uuid NOT NULL,
  number            VARCHAR NOT NULL,
  issue_date        date NOT NULL,
  destination       VARCHAR,
  shipping          VARCHAR,
  tags              VARCHAR,
  description       VARCHAR,
  channel_label     VARCHAR,
  warehouse_label   VARCHAR,
  payment_method    VARCHAR,
  units             DECIMAL(14,3),
  vat               DECIMAL(14,2),
  withholding       DECIMAL(14,2),
  surcharge         DECIMAL(14,2),
  subtotal          DECIMAL(14,2),
  total             DECIMAL(14,2),
  invoiced_amount   DECIMAL(14,2),
  invoiced_status   VARCHAR NOT NULL,                               -- Pendiente, Facturado, Parcialmente
  review_decision   VARCHAR CHECK (review_decision IN ('still_open','closed','ignore')),  -- decisión de Pedro en la migración
  review_note       VARCHAR,
  raw               JSON NOT NULL,
  UNIQUE (entity_id, number, issue_date)
);


CREATE TABLE legacy.holded_product (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id          uuid NOT NULL,
  name               VARCHAR NOT NULL,
  description        VARCHAR,
  sku                VARCHAR,
  warehouse_label    VARCHAR,
  stock              DECIMAL(14,3),
  cost               DECIMAL(14,6),
  sale_value         DECIMAL(14,6),
  tax_label          VARCHAR,
  matched_product_id uuid,
  raw                JSON NOT NULL
);


CREATE TABLE legacy.holded_trial_balance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id     uuid NOT NULL,
  year          smallint NOT NULL,
  account_code  VARCHAR NOT NULL,
  account_name  VARCHAR,
  group_label   VARCHAR,
  subgroup_1    VARCHAR,
  subgroup_2    VARCHAR,
  subgroup_3    VARCHAR,
  debit         DECIMAL(14,2) NOT NULL,
  credit        DECIMAL(14,2) NOT NULL,
  balance       DECIMAL(14,2) NOT NULL,
  UNIQUE (entity_id, year, account_code)
);


CREATE TABLE legacy.holded_pnl_line (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id   uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id  uuid NOT NULL,
  year       smallint NOT NULL,
  line_no    smallint NOT NULL,
  concept    VARCHAR NOT NULL,
  amount     DECIMAL(14,2),
  UNIQUE (entity_id, year, line_no)
);


-- Shopify (histórico de pedidos web; las facturas se hacían en Holded)
CREATE TABLE legacy.shopify_order (id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES legacy.import_batch(id),
  order_name        VARCHAR NOT NULL UNIQUE,
  -- '#1001'
  shopify_id        VARCHAR,
  created_at_shop   TIMESTAMPTZ NOT NULL,
  financial_status  VARCHAR,
  fulfillment_status VARCHAR,
  source            VARCHAR,
  -- web / pos
  currency          VARCHAR,
  subtotal          DECIMAL(14,2),
  shipping          DECIMAL(14,2),
  taxes             DECIMAL(14,2),
  discount_amount   DECIMAL(14,2),
  total             DECIMAL(14,2),
  refunded_amount   DECIMAL(14,2),
  payment_method    VARCHAR,
  shipping_country  VARCHAR,
  customer_contact_id uuid,
  raw               JSON NOT NULL                               -- sin datos de tarjeta (no vienen en el export)
);


CREATE TABLE legacy.shopify_order_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES legacy.shopify_order(id),
  line_seq       integer NOT NULL,
  name           VARCHAR NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL,
  price          DECIMAL(14,2) NOT NULL,
  matched_product_id uuid,
  UNIQUE (order_id, line_seq)
);


-- Partidas abiertas al corte (cobros y pagos pendientes de Holded): se cobran/pagan desde WineCore
CREATE TABLE legacy.open_item (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL,
  direction              VARCHAR NOT NULL CHECK (direction IN ('receivable','payable')),
  holded_invoice_id      uuid NOT NULL UNIQUE REFERENCES legacy.holded_invoice(id),
  counterparty_contact_id uuid,
  document_number        VARCHAR NOT NULL,
  document_date          date NOT NULL,
  due_date               date,
  amount                 DECIMAL(14,2) NOT NULL CHECK (amount > 0),   -- pendiente al corte
  amount_paid            DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status                 VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','written_off')),
  notes                  VARCHAR,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Contabilidad histórica (D7): formato de entrada esperado del diario (06-migracion.md §8)
CREATE TABLE legacy.accounting_journal_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id     uuid NOT NULL,
  year          smallint NOT NULL,
  entry_no      integer NOT NULL,
  line_no       smallint NOT NULL,
  entry_date    date NOT NULL,
  account_code  VARCHAR NOT NULL CHECK (account_code ~ '^[0-9]{3,10}$'),
  account_name  VARCHAR,
  concept       VARCHAR,
  debit         DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  document_ref  VARCHAR,
  UNIQUE (entity_id, year, entry_no, line_no)
);


-- PDF de facturas y su vinculación con el histórico
CREATE TABLE legacy.document_file (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id       uuid,
  attachment_id   uuid NOT NULL,
  original_path   VARCHAR NOT NULL,                                 -- ruta dentro del zip de Holded
  parsed_number   VARCHAR,
  parsed_kind     VARCHAR CHECK (parsed_kind IN ('sale','purchase','delivery_note','quote','unknown')),
  matched_table   VARCHAR,
  matched_id      uuid,
  match_rule      VARCHAR,
  status          VARCHAR NOT NULL CHECK (status IN ('matched','unmatched','ambiguous')),
  UNIQUE (attachment_id)
);
