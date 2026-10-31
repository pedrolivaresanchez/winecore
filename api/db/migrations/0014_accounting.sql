-- WineCore · 0014_accounting · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0014_accounting.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0014 · contabilidad (accounting) — hito M7 (Q-022)
-- Plan de cuentas PGC por entidad, ejercicios, asientos por partida doble generados
-- desde documentos con reglas de contabilización, y saldos de apertura del asesor (R6).
-- Especificación: docs/02-modelo-dominio.md §16
-- =====================================================================

CREATE TABLE accounting.fiscal_year (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL,
  year             smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  status           VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  closed_by        uuid,
  closed_at        TIMESTAMPTZ,
  UNIQUE (legal_entity_id, year),
  CHECK (ends_on > starts_on)
);


CREATE TABLE accounting.account (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL,
  code             VARCHAR NOT NULL CHECK (code ~ '^[1-9][0-9]{2,9}$'),
  name             VARCHAR NOT NULL,
  pgc_group        smallint NOT NULL CHECK (pgc_group BETWEEN 1 AND 9),
  is_postable      boolean NOT NULL DEFAULT true,
  -- solo subcuentas de detalle
  contact_id       uuid,
  -- 430/400 por tercero
  is_active        boolean NOT NULL DEFAULT true,
  UNIQUE (legal_entity_id, code)
);


CREATE TABLE accounting.journal_entry (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL,
  fiscal_year_id   uuid NOT NULL REFERENCES accounting.fiscal_year(id),
  entry_no         integer NOT NULL CHECK (entry_no > 0),
  entry_date       date NOT NULL,
  kind             VARCHAR NOT NULL CHECK (kind IN ('opening','regular','adjustment','closing','reversal')),
  source_table     VARCHAR,
  source_id        uuid,
  description      VARCHAR NOT NULL,
  posted_by        VARCHAR NOT NULL,
  posted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverses_entry_id uuid REFERENCES accounting.journal_entry(id),
  UNIQUE (legal_entity_id, fiscal_year_id, entry_no)
);


CREATE TABLE accounting.journal_line (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES accounting.journal_entry(id),
  line_no     smallint NOT NULL CHECK (line_no > 0),
  account_id  uuid NOT NULL REFERENCES accounting.account(id),
  debit       DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description VARCHAR,
  UNIQUE (entry_id, line_no),
  CHECK ((debit = 0) <> (credit = 0))
);


-- Un asiento cuadra (Debe = Haber) al cerrar la transacción (WC110) y nunca se modifica

-- Reglas de contabilización por tipo de documento (plantillas)
CREATE TABLE accounting.posting_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  document_kind   VARCHAR NOT NULL CHECK (document_kind IN ('sales_invoice','sales_credit_note','supplier_invoice','payment_in','payment_out','intercompany_invoice')),
  template        JSON NOT NULL,                                    -- líneas: cuenta | origen del importe | signo
  valid_from      date NOT NULL,
  created_by      VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, document_kind, valid_from)
);
