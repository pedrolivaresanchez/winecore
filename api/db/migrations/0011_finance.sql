-- WineCore · 0011_finance · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0011_finance.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts
-- El CHECK de payment_allocation.target_table ya incluye legacy.open_item (DuckDB no puede sustituir un CHECK en 0016).

-- =====================================================================
-- WineCore · Migración 0011 · finanzas (finance)
-- Cuentas bancarias, cobros y pagos con imputación parcial, extractos (Norma 43/CAMT/CSV),
-- conciliación y remesas SEPA (fichero que sube una persona al banco; WineCore no guarda claves bancarias).
-- Especificación: docs/02-modelo-dominio.md §14 · Estados: docs/03-maquinas-estado.md §6
-- =====================================================================

CREATE TABLE finance.bank_account (id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id    uuid NOT NULL,
  bank_name          VARCHAR NOT NULL,
  iban_enc           BLOB NOT NULL,
  -- cifrado con WINECORE_DATA_KEY
  iban_last4         VARCHAR NOT NULL,
  bic                VARCHAR,
  currency           VARCHAR NOT NULL DEFAULT 'EUR',
  accounting_account VARCHAR CHECK (accounting_account ~ '^57[0-9]{1,6}$'),
  sepa_creditor_id   VARCHAR,
  -- identificador de acreedor SEPA (adeudos)
  is_default         boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE finance.payment (id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL,
  direction              VARCHAR NOT NULL CHECK (direction IN ('in','out')),
  method                 VARCHAR NOT NULL CHECK (method IN ('transfer','direct_debit','card','cash','stripe','compensation','other')),
  amount                 DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  currency               VARCHAR NOT NULL DEFAULT 'EUR',
  value_date             date NOT NULL,
  bank_account_id        uuid REFERENCES finance.bank_account(id),
  counterparty_id        uuid,
  reference              VARCHAR,
  source                 VARCHAR NOT NULL CHECK (source IN ('manual','bank_import','stripe','remittance','edi_remittance_advice','migration')),
  status                 VARCHAR NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','reversed')),
  reverses_payment_id    uuid REFERENCES finance.payment(id),
  reversal_reason        VARCHAR,
  notes                  VARCHAR,
  created_by             VARCHAR NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'reversed' OR reversal_reason IS NOT NULL)
);

CREATE INDEX payment_counterparty_idx ON finance.payment(counterparty_id, value_date);


CREATE TABLE finance.payment_allocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid NOT NULL REFERENCES finance.payment(id),
  target_table  VARCHAR NOT NULL CHECK (target_table IN ('billing.invoice','purchasing.supplier_invoice','legacy.open_item')),
  target_id     uuid NOT NULL,
  amount        DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  allocated_by  VARCHAR NOT NULL,
  allocated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, target_table, target_id)
);

CREATE INDEX payment_allocation_target_idx ON finance.payment_allocation(target_table, target_id);


-- Recalcula el cobrado/pagado del documento y su estado (WC100 si se imputa de más)

-- ---------------------------------------------------------------------
-- Extractos bancarios y conciliación
-- ---------------------------------------------------------------------
CREATE TABLE finance.bank_statement_import (id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id   uuid NOT NULL REFERENCES finance.bank_account(id),
  format            VARCHAR NOT NULL CHECK (format IN ('n43','camt053','csv')),
  attachment_id     uuid NOT NULL,
  file_sha256       VARCHAR NOT NULL,
  period_from       date NOT NULL,
  period_to         date NOT NULL,
  lines_count       integer NOT NULL CHECK (lines_count >= 0),
  imported_by       VARCHAR NOT NULL,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, file_sha256)
);


CREATE TABLE finance.bank_statement_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id          uuid NOT NULL REFERENCES finance.bank_statement_import(id),
  bank_account_id    uuid NOT NULL REFERENCES finance.bank_account(id),
  booking_date       date NOT NULL,
  value_date         date,
  amount             DECIMAL(14,2) NOT NULL CHECK (amount <> 0),       -- + abono, − cargo
  description        VARCHAR NOT NULL,
  counterparty_name  VARCHAR,
  reference          VARCHAR,
  external_id        VARCHAR NOT NULL,                                     -- hash estable de la línea (deduplicación)
  status             VARCHAR NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','suggested','matched','ignored')),
  suggestions        JSON NOT NULL DEFAULT '[]'::JSON,                -- [{payment|invoice, score, reason}]
  matched_payment_id uuid REFERENCES finance.payment(id),
  ignored_reason     VARCHAR,
  UNIQUE (bank_account_id, external_id),
  CHECK (status <> 'matched' OR matched_payment_id IS NOT NULL),
  CHECK (status <> 'ignored' OR ignored_reason IS NOT NULL)
);


-- ---------------------------------------------------------------------
-- Remesas SEPA (pain.008 adeudos / pain.001 transferencias): fichero aprobado que una persona sube al banco
-- ---------------------------------------------------------------------
CREATE TABLE finance.remittance (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL,
  kind                VARCHAR NOT NULL CHECK (kind IN ('direct_debit','credit_transfer')),
  status              VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','file_generated','uploaded_by_user','settled','partially_rejected','cancelled')),
  bank_account_id     uuid NOT NULL REFERENCES finance.bank_account(id),
  execution_date      date NOT NULL,
  total               DECIMAL(14,2) NOT NULL DEFAULT 0,
  file_attachment_id  uuid,
  approval_request_id uuid,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE finance.remittance_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id  uuid NOT NULL REFERENCES finance.remittance(id),
  target_table   VARCHAR NOT NULL CHECK (target_table IN ('billing.invoice','purchasing.supplier_invoice')),
  target_id      uuid NOT NULL,
  counterparty_id uuid NOT NULL,
  amount         DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  mandate_ref    VARCHAR,
  end_to_end_id  VARCHAR NOT NULL CHECK (length(end_to_end_id) <= 35),
  status         VARCHAR NOT NULL DEFAULT 'included' CHECK (status IN ('included','settled','rejected','returned')),
  reject_reason  VARCHAR,
  UNIQUE (remittance_id, target_table, target_id)
);
