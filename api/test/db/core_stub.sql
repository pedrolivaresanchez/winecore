-- Stub de prueba de 0001 (el padre lo sustituye por la migración real).
-- Tablas: schema_migration, writer_lease, legal_entity, app_user, role, user_role, setting, audit_log.
-- email y tax_id no llevan UNIQUE: son mutables y la fila está referenciada (DuckDB rehace el UPDATE como delete+insert).


-- =====================================================================
-- WineCore · Migración 0001 · núcleo (core) y auditoría (audit)
-- Especificación: docs/02-modelo-dominio.md §3 y §4
-- PostgreSQL 16. Extensiones estándar: pgcrypto, VARCHAR, btree_gist.
-- Convenciones:
--   * PK uuid (la app genera UUIDv7; el DEFAULT v4 es solo red de seguridad).
--   * TIMESTAMPTZ para instantes; date para fechas de negocio (Europe/Madrid).
--   * Importes DECIMAL(14,2); precios unitarios DECIMAL(14,6); % DECIMAL(5,2).
--   * Volúmenes en mililitros enteros (bigint); masas en gramos (bigint).
--   * Códigos de error de negocio 'WCnnn' en RAISE (ver §9 del modelo).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS core;


CREATE SCHEMA IF NOT EXISTS audit;


CREATE SCHEMA IF NOT EXISTS party;



-- ---------------------------------------------------------------------
-- Contexto de actor por transacción. La app SIEMPRE ejecuta, al abrir
-- cada transacción de escritura:
--   SELECT core.set_actor('user'|'agent'|'system'|'migration', '<id>', '<on_behalf_of|null>', '<request_id>', '<reason|null>');
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Entidades fiscales (P.O, CVPO)
-- ---------------------------------------------------------------------
CREATE TABLE core.legal_entity (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  legal_name       VARCHAR NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 120),
  trade_name       VARCHAR,
  tax_id           VARCHAR NOT NULL CHECK (tax_id ~ '^[A-Z0-9]{9}$'),
  person_type      VARCHAR NOT NULL CHECK (person_type IN ('natural','legal')),
  income_tax       VARCHAR NOT NULL CHECK (income_tax IN ('IRPF','IS')),
  vat_id           VARCHAR CHECK (vat_id ~ '^ES[A-Z0-9]{9}$'),
  eori             VARCHAR,
  gln              VARCHAR CHECK (gln ~ '^[0-9]{13}$'),
  -- punto operacional GS1 (usuario de AecocEDI)
  gs1_company_prefix VARCHAR CHECK (gs1_company_prefix ~ '^[0-9]{7,12}$'),
  registry_data    VARCHAR,
  -- datos registrales (sociedades) para documentos
  address_line     VARCHAR NOT NULL,
  postal_code      VARCHAR NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
  city             VARCHAR NOT NULL,
  province         VARCHAR NOT NULL,
  country_code     VARCHAR NOT NULL DEFAULT 'ES',
  default_currency VARCHAR NOT NULL DEFAULT 'EUR',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);



-- ---------------------------------------------------------------------
-- Usuarios, credenciales, sesiones y clientes de API (ADR 008)
-- ---------------------------------------------------------------------
CREATE TABLE core.app_user (id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR NOT NULL CHECK (email = lower(email)),
  display_name  VARCHAR NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  locale        VARCHAR NOT NULL DEFAULT 'es-ES' CHECK (locale IN ('es-ES','en-GB')),
  status        VARCHAR NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','revoked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);



-- Roles fijos (la matriz de permisos vive en código: api/src/core/auth/permissions.ts)
CREATE TABLE core.role (code        VARCHAR PRIMARY KEY CHECK (code IN ('owner','approver','admin','cellar','field','advisor','agent','mcp_client')),
  name_es     VARCHAR NOT NULL,
  description VARCHAR NOT NULL
);



CREATE TABLE core.user_role (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES core.app_user(id),
  role_code       VARCHAR NOT NULL REFERENCES core.role(code),
  legal_entity_id uuid REFERENCES core.legal_entity(id),   -- NULL = todas las entidades
  granted_by      uuid REFERENCES core.app_user(id),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  CHECK (role_code NOT IN ('agent','mcp_client'))          -- esos roles son de api_client
);



CREATE TABLE core.setting (
  key        VARCHAR PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z0-9_]+)+$'),
  value      JSON NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR NOT NULL
);



-- ---------------------------------------------------------------------
-- Auditoría inmutable con encadenamiento de hash
-- ---------------------------------------------------------------------
CREATE SEQUENCE audit.audit_log_id_seq;


CREATE TABLE audit.audit_log (
  id           BIGINT DEFAULT nextval('audit.audit_log_id_seq') PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tx_id        bigint NOT NULL DEFAULT txid_current(),
  actor_type   VARCHAR NOT NULL CHECK (actor_type IN ('user','agent','system','migration')),
  actor_id     VARCHAR NOT NULL,
  on_behalf_of VARCHAR,
  request_id   VARCHAR,
  action       VARCHAR NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','EVENT')),
  table_name   VARCHAR NOT NULL,
  row_id       VARCHAR,
  before_data  JSON,
  after_data   JSON,
  reason       VARCHAR,
  prev_hash    BLOB,
  hash         BLOB NOT NULL
);


CREATE INDEX audit_log_row_idx ON audit.audit_log(table_name, row_id);


CREATE INDEX audit_log_time_idx ON audit.audit_log(occurred_at);



-- Devuelve solo la última huella: los roles que escriben en la auditoría no necesitan leerla entera

-- Trigger genérico de captura: se asocia a cada tabla auditada (lista en §4.3 del modelo).

-- Eventos de negocio sin cambio de fila (login, aprobación, envío, exportación...)

-- Verificación de la cadena (la usa el job diario audit-verify)

-- Tablas de core auditadas

-- Datos de referencia
INSERT INTO core.role(code, name_es, description) VALUES
 ('owner',     'Dirección',      'Todo, incluida la configuración, los aprobadores y los módulos'),
 ('approver',  'Aprobador',      'Aprueba emisiones en lote y envíos regulatorios de las entidades asignadas'),
 ('admin',     'Administración', 'Prepara documentos, facturas, compras y cobros; no aprueba envíos regulatorios'),
 ('cellar',    'Bodega',         'Operaciones de bodega, envasado, aforos y analíticas'),
 ('field',     'Campo',          'Viñedo: tratamientos, labores y controles de maduración'),
 ('advisor',   'Asesoría',       'Lectura y exportaciones fiscales y contables'),
 ('agent',     'Agente',         'Cuenta de servicio de un miembro de la workforce de Timbal (mínimo privilegio)'),
 ('mcp_client','Cliente MCP',    'Cliente MCP externo (CVBOT): lectura libre, escritura con confirmación');

CREATE TABLE core.schema_migration (
  file VARCHAR PRIMARY KEY,
  sha256 VARCHAR NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.writer_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder VARCHAR NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL
);
