-- WineCore 0001. Núcleo, auditoría y esquema party en DuckDB.
-- Traducción de docs/02-ddl/0001_core.sql. Sin PL/pgSQL: las guardas viven en el núcleo.
-- DuckDB no admite índices parciales: la unicidad del rol activo es un índice de expresión
-- (NULL cuando el rol está revocado, y un índice único admite varios NULL).

CREATE SCHEMA core;
CREATE SCHEMA audit;
CREATE SCHEMA party;

CREATE TABLE core.schema_migration (
  file VARCHAR PRIMARY KEY,
  sha256 VARCHAR NOT NULL CHECK (regexp_full_match(sha256, '^[0-9a-f]{64}$')),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.writer_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder VARCHAR,
  expires_at TIMESTAMPTZ NOT NULL
);

INSERT INTO core.writer_lease (id, holder, expires_at)
VALUES (1, NULL, TIMESTAMPTZ '1970-01-01 00:00:00+00');

CREATE TABLE core.legal_entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR NOT NULL UNIQUE CHECK (regexp_full_match(code, '^[A-Z][A-Z0-9_]{1,15}$')),
  legal_name VARCHAR NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 120),
  trade_name VARCHAR,
  tax_id VARCHAR NOT NULL UNIQUE CHECK (regexp_full_match(tax_id, '^[A-Z0-9]{9}$')),
  person_type VARCHAR NOT NULL CHECK (person_type IN ('natural', 'legal')),
  income_tax VARCHAR NOT NULL CHECK (income_tax IN ('IRPF', 'IS')),
  vat_id VARCHAR CHECK (regexp_full_match(vat_id, '^ES[A-Z0-9]{9}$')),
  eori VARCHAR,
  gln CHAR(13) CHECK (regexp_full_match(gln, '^[0-9]{13}$')),
  gs1_company_prefix VARCHAR CHECK (regexp_full_match(gs1_company_prefix, '^[0-9]{7,12}$')),
  registry_data VARCHAR,
  address_line VARCHAR NOT NULL,
  postal_code VARCHAR NOT NULL CHECK (regexp_full_match(postal_code, '^[0-9]{5}$')),
  city VARCHAR NOT NULL,
  province VARCHAR NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'ES',
  default_currency CHAR(3) NOT NULL DEFAULT 'EUR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR NOT NULL,
  display_name VARCHAR NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  locale VARCHAR NOT NULL DEFAULT 'es-ES' CHECK (locale IN ('es-ES', 'en-GB')),
  status VARCHAR NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX app_user_email_lower_uq ON core.app_user (lower(email));

CREATE TABLE core.user_role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.app_user (id),
  role_code VARCHAR NOT NULL CHECK (role_code IN ('owner', 'approver', 'admin', 'cellar', 'field', 'advisor')),
  legal_entity_id UUID REFERENCES core.legal_entity (id),
  granted_by UUID REFERENCES core.app_user (id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX user_role_active_uq ON core.user_role (
  (CASE
    WHEN revoked_at IS NULL THEN user_id::VARCHAR || '|' || role_code || '|' ||
      COALESCE(legal_entity_id::VARCHAR, '00000000-0000-0000-0000-000000000000')
    ELSE NULL
  END)
);

CREATE TABLE core.setting (
  key VARCHAR PRIMARY KEY CHECK (regexp_full_match(key, '^[a-z]+(\.[a-z0-9_]+)+$')),
  value JSON NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR NOT NULL
);

CREATE TABLE audit.audit_log (
  id BIGINT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_type VARCHAR NOT NULL CHECK (actor_type IN ('user', 'agent', 'system', 'migration')),
  actor_id VARCHAR NOT NULL,
  on_behalf_of VARCHAR,
  request_id VARCHAR,
  reason VARCHAR,
  table_name VARCHAR NOT NULL,
  row_id VARCHAR,
  action VARCHAR NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'EVENT', 'auth.denied')),
  before_data JSON,
  after_data JSON,
  prev_hash VARCHAR CHECK (regexp_full_match(prev_hash, '^[0-9a-f]{64}$')),
  hash VARCHAR NOT NULL CHECK (regexp_full_match(hash, '^[0-9a-f]{64}$'))
);

CREATE INDEX audit_log_row_idx ON audit.audit_log (table_name, row_id);
CREATE INDEX audit_log_time_idx ON audit.audit_log (occurred_at);
