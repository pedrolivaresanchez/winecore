-- WineCore 0001. Núcleo, auditoría y esquema party en DuckDB.
-- Traducción de docs/02-ddl/0001_core.sql. Sin PL/pgSQL: las guardas viven en el núcleo.
-- DuckDB rehace un UPDATE de una fila referenciada como delete+insert, así que email y
-- tax_id no llevan UNIQUE (sí un CHECK de minúsculas en el email). El índice parcial de
-- rol activo se sustituye por un índice único de expresión (NULL si el rol está revocado).

CREATE SCHEMA core;
CREATE SCHEMA audit;
CREATE SCHEMA party;

CREATE TABLE core.schema_migration (
  file VARCHAR PRIMARY KEY,
  sha256 VARCHAR NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
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
  code VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  legal_name VARCHAR NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 120),
  trade_name VARCHAR,
  tax_id VARCHAR NOT NULL CHECK (tax_id ~ '^[A-Z0-9]{9}$'),
  person_type VARCHAR NOT NULL CHECK (person_type IN ('natural', 'legal')),
  income_tax VARCHAR NOT NULL CHECK (income_tax IN ('IRPF', 'IS')),
  vat_id VARCHAR CHECK (vat_id ~ '^ES[A-Z0-9]{9}$'),
  eori VARCHAR,
  gln VARCHAR CHECK (gln ~ '^[0-9]{13}$'),
  gs1_company_prefix VARCHAR CHECK (gs1_company_prefix ~ '^[0-9]{7,12}$'),
  registry_data VARCHAR,
  address_line VARCHAR NOT NULL,
  postal_code VARCHAR NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
  city VARCHAR NOT NULL,
  province VARCHAR NOT NULL,
  country_code VARCHAR NOT NULL DEFAULT 'ES',
  default_currency VARCHAR NOT NULL DEFAULT 'EUR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR NOT NULL CHECK (email = lower(email)),
  display_name VARCHAR NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  locale VARCHAR NOT NULL DEFAULT 'es-ES' CHECK (locale IN ('es-ES', 'en-GB')),
  status VARCHAR NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE core.role (
  code VARCHAR PRIMARY KEY CHECK (code IN ('owner', 'approver', 'admin', 'cellar', 'field', 'advisor', 'agent', 'mcp_client')),
  name_es VARCHAR NOT NULL,
  description VARCHAR NOT NULL
);

INSERT INTO core.role (code, name_es, description) VALUES
  ('owner', 'Dirección', 'Todo, incluida la configuración, los aprobadores y los módulos'),
  ('approver', 'Aprobador', 'Aprueba emisiones en lote y envíos regulatorios de las entidades asignadas'),
  ('admin', 'Administración', 'Prepara documentos, facturas, compras y cobros; no aprueba envíos regulatorios'),
  ('cellar', 'Bodega', 'Operaciones de bodega, envasado, aforos y analíticas'),
  ('field', 'Campo', 'Viñedo: tratamientos, labores y controles de maduración'),
  ('advisor', 'Asesoría', 'Lectura y exportaciones fiscales y contables'),
  ('agent', 'Agente', 'Cuenta de servicio de un miembro de la workforce de Timbal'),
  ('mcp_client', 'Cliente MCP', 'Cliente MCP externo: lectura libre, escritura con confirmación');

CREATE TABLE core.user_role (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES core.app_user (id),
  role_code VARCHAR NOT NULL REFERENCES core.role (code) CHECK (role_code NOT IN ('agent', 'mcp_client')),
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
  key VARCHAR PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z0-9_]+)+$'),
  value JSON NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR NOT NULL
);

CREATE SEQUENCE audit.audit_log_id_seq;

CREATE TABLE audit.audit_log (
  id BIGINT DEFAULT nextval('audit.audit_log_id_seq') PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx_id BIGINT NOT NULL DEFAULT txid_current(),
  actor_type VARCHAR NOT NULL CHECK (actor_type IN ('user', 'agent', 'system', 'migration')),
  actor_id VARCHAR NOT NULL,
  on_behalf_of VARCHAR,
  request_id VARCHAR,
  action VARCHAR NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'EVENT', 'auth.denied')),
  table_name VARCHAR NOT NULL,
  row_id VARCHAR,
  before_data JSON,
  after_data JSON,
  reason VARCHAR,
  prev_hash BLOB,
  hash BLOB NOT NULL
);

CREATE INDEX audit_log_row_idx ON audit.audit_log (table_name, row_id);
CREATE INDEX audit_log_time_idx ON audit.audit_log (occurred_at);
