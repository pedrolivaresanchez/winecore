-- WineCore · 0002 · resto de core (0001 de referencia) y ops (0002 de referencia), dialecto DuckDB.
-- Sin disparadores, funciones, GRANT ni índices parciales: api/src/core/db/guards/registry.ts
-- Esquemas core, audit y party los crea 0001.




CREATE SCHEMA IF NOT EXISTS ops;


CREATE SCHEMA IF NOT EXISTS catalog;


CREATE SCHEMA IF NOT EXISTS inventory;


CREATE SCHEMA IF NOT EXISTS cellar;


CREATE SCHEMA IF NOT EXISTS sales;


CREATE SCHEMA IF NOT EXISTS billing;


CREATE SCHEMA IF NOT EXISTS purchasing;


CREATE SCHEMA IF NOT EXISTS finance;


CREATE SCHEMA IF NOT EXISTS regulatory;


CREATE SCHEMA IF NOT EXISTS vineyard;


CREATE SCHEMA IF NOT EXISTS accounting;


CREATE SCHEMA IF NOT EXISTS knowledge;



CREATE TABLE core.user_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES core.app_user(id),
  kind           VARCHAR NOT NULL CHECK (kind IN ('passkey','totp')),
  label          VARCHAR NOT NULL,
  -- passkey: credential_id (base64url), public_key (COSE), sign_count; totp: secreto cifrado con WINECORE_DATA_KEY
  credential_id  VARCHAR UNIQUE,
  public_key     BLOB,
  sign_count     bigint NOT NULL DEFAULT 0,
  totp_secret_enc BLOB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  CHECK ((kind = 'passkey' AND credential_id IS NOT NULL AND public_key IS NOT NULL)
      OR (kind = 'totp' AND totp_secret_enc IS NOT NULL))
);



CREATE TABLE core.session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES core.app_user(id),
  token_hash       BLOB NOT NULL UNIQUE,                 -- sha256 del token de la cookie
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  step_up_at       TIMESTAMPTZ,                           -- última verificación reforzada (passkey/TOTP)
  step_up_method   VARCHAR CHECK (step_up_method IN ('passkey','totp')),
  ip               VARCHAR,
  user_agent       VARCHAR,
  revoked_at       TIMESTAMPTZ
);



CREATE TABLE core.api_client (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{2,40}$'),
  -- p. ej. 'cvbot', 'regulatorio-silicie'
  role_code           VARCHAR NOT NULL REFERENCES core.role(code) CHECK (role_code IN ('agent','mcp_client')),
  description         VARCHAR NOT NULL,
  scopes              VARCHAR[] NOT NULL,
  -- p. ej. {'read:*','write:sales.order'}
  on_behalf_of_user_id uuid REFERENCES core.app_user(id),
  -- usuario al que representa (CVBOT → Pedro)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at          TIMESTAMPTZ
);



CREATE TABLE core.api_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES core.api_client(id),
  token_hash  BLOB NOT NULL UNIQUE,                         -- sha256; el token solo se muestra al crearlo
  prefix      VARCHAR NOT NULL CHECK (prefix ~ '^wc_[a-z]+_[A-Za-z0-9]{6}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);



-- ---------------------------------------------------------------------
-- Módulos activables (§12.6) y ajustes
-- ---------------------------------------------------------------------
CREATE TABLE core.module_state (
  module_key  VARCHAR PRIMARY KEY CHECK (module_key IN (
                'contacts','catalog','sales','billing','verifactu','purchasing','inventory','cellar',
                'vineyard','finance','accounting','silicie','sisv','emcs','edi','organic','labels',
                'knowledge','mcp','assistant','watchers')),
  enabled     boolean NOT NULL DEFAULT false,
  config      JSON NOT NULL DEFAULT '{}'::JSON,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  VARCHAR NOT NULL
);



-- ---------------------------------------------------------------------
-- Series y numeración sin huecos
-- ---------------------------------------------------------------------
CREATE TABLE core.number_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  doc_type        VARCHAR NOT NULL CHECK (doc_type IN (
                    'invoice','credit_note','simplified_invoice','intercompany_invoice',
                    'delivery_note','quote','sales_order','proforma','cellar_operation','inventory_count')),
  code            VARCHAR NOT NULL CHECK (code ~ '^[A-Z]{1,4}$'),
  year            smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  prefix          VARCHAR NOT NULL CHECK (length(prefix) BETWEEN 1 AND 12),
  padding         smallint NOT NULL DEFAULT 4 CHECK (padding BETWEEN 3 AND 8),
  next_value      integer NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  is_default      boolean NOT NULL DEFAULT false,
  verifactu       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, doc_type, code, year),
  UNIQUE (legal_entity_id, prefix)
);



-- Toma el siguiente número dentro de la transacción del emisor.
-- El bloqueo de fila serializa emisores concurrentes; si la transacción
-- se deshace, el contador también: no hay huecos.

-- ---------------------------------------------------------------------
-- Adjuntos (PDF, fotos, capturas, acuses). El contenido vive en core.attachment_content
-- (misma Knowledge Base, ADR 002) y se identifica por su SHA-256; 'onedrive' solo para copias de consulta.
-- ---------------------------------------------------------------------
CREATE TABLE core.attachment (id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256          VARCHAR NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_backend VARCHAR NOT NULL CHECK (storage_backend IN ('knowledge_base','onedrive')),
  storage_key     VARCHAR NOT NULL,
  -- en 'knowledge_base', el SHA-256 de core.attachment_content
  filename        VARCHAR NOT NULL,
  mime_type       VARCHAR NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  classification  VARCHAR NOT NULL DEFAULT 'internal' CHECK (classification IN ('internal','personal_data','regulatory_evidence','secret_free_log')),
  retention_until date,
  created_by      VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (storage_backend, storage_key)
);


CREATE INDEX attachment_sha_idx ON core.attachment(sha256);



CREATE TABLE core.attachment_content (
  sha256     VARCHAR PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content    BLOB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (octet_length(content) BETWEEN 1 AND 104857600)   -- límite de 100 MB de la Knowledge Base
);


-- El contenido no se borra ni se sustituye (WC001)

CREATE TABLE core.attachment_link (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES core.attachment(id),
  entity_table  VARCHAR NOT NULL CHECK (entity_table ~ '^[a-z_]+\.[a-z_]+$'),
  entity_id     uuid NOT NULL,
  role          VARCHAR NOT NULL CHECK (role IN (
                  'invoice_pdf','delivery_note_pdf','supplier_invoice_scan','expense_photo',
                  'evidence_screenshot','evidence_request','evidence_response','official_receipt',
                  'lab_report','photo','label_artwork','contract','other')),
  created_by    VARCHAR NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, entity_table, entity_id, role)
);


CREATE INDEX attachment_link_entity_idx ON core.attachment_link(entity_table, entity_id);



-- Los enlaces de evidencias, PDF emitidos y acuses no se desvinculan nunca (WC001)

CREATE TABLE core.notification (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES core.app_user(id),
  kind       VARCHAR NOT NULL,
  title      VARCHAR NOT NULL CHECK (length(title) <= 80),
  body       VARCHAR NOT NULL CHECK (length(body) <= 500),
  link       VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
-- =====================================================================
-- WineCore · Migración 0002 · operaciones transversales (ops)
-- Aprobaciones humanas, eventos (outbox), idempotencia, confirmaciones MCP y ejecuciones de jobs.
-- Especificación: docs/02-modelo-dominio.md §5 y docs/03-maquinas-estado.md §12
-- =====================================================================

-- ---------------------------------------------------------------------
-- Política de aprobación por tipo de acción y entidad
-- ---------------------------------------------------------------------
CREATE TABLE ops.approval_policy (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              VARCHAR NOT NULL CHECK (kind IN (
                      'invoice_batch_issue',        -- emisión de facturas en lote (regla 0.3)
                      'intercompany_invoice_issue', -- factura intercompañía del periodo
                      'regulatory_submission',      -- SILICIE, SISV, modelos
                      'emcs_submission',            -- e-DA y sus mensajes
                      'edi_submission',             -- factura u otros mensajes a AecocEDI
                      'organic_report',             -- informes a la certificadora
                      'cellar_loss',                -- mermas por incidencia y destrucciones
                      'inventory_adjustment',       -- regularizaciones de aforo
                      'billing_rules_activation',   -- reglas de entidad facturadora
                      'tariff_activation',          -- tarifas e intercompañía
                      'module_toggle',              -- activar/desactivar módulos
                      'third_party_message')),      -- cualquier envío a terceros (correo de factura, recordatorio)
  legal_entity_id   uuid,        -- NULL = todas
  min_approvals     smallint NOT NULL DEFAULT 1 CHECK (min_approvals BETWEEN 1 AND 3),
  allowed_roles     VARCHAR[] NOT NULL DEFAULT ['owner', 'approver'],
  allowed_user_ids  UUID[] NOT NULL DEFAULT [],                 -- vacío = cualquiera con allowed_roles
  requires_step_up  boolean NOT NULL DEFAULT true,
  validity_minutes  integer NOT NULL DEFAULT 1440 CHECK (validity_minutes BETWEEN 5 AND 10080),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        VARCHAR NOT NULL
);

CREATE UNIQUE INDEX approval_policy_uq
  ON ops.approval_policy (kind, coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid));


-- ---------------------------------------------------------------------
-- Solicitud de aprobación ligada al HASH del contenido aprobado.
-- Si el contenido cambia después de aprobar, el hash no coincide y la
-- ejecución se rechaza (WC040).
-- ---------------------------------------------------------------------
CREATE TABLE ops.approval_request (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             VARCHAR NOT NULL,
  legal_entity_id  uuid,
  subject_table    VARCHAR NOT NULL CHECK (subject_table ~ '^[a-z_]+\.[a-z_]+$'),
  subject_id       uuid NOT NULL,
  payload_sha256   VARCHAR NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  summary          VARCHAR NOT NULL CHECK (length(summary) BETWEEN 5 AND 300),
  details          JSON NOT NULL DEFAULT '{}'::JSON,
  -- qué se va a enviar, a quién, importes, nº de registros
  status           VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled','consumed')),
  requested_by     VARCHAR NOT NULL,
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  approved_at      TIMESTAMPTZ,
  consumed_at      TIMESTAMPTZ,
  workflow_run_ref VARCHAR                                         -- id de ejecución de Timbal que espera (suspend/resume)
);

CREATE INDEX approval_request_subject_idx ON ops.approval_request(subject_table, subject_id);


CREATE TABLE ops.approval_decision (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES ops.approval_request(id),
  decided_by      uuid NOT NULL,
  decision        VARCHAR NOT NULL CHECK (decision IN ('approve','reject')),
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            VARCHAR CHECK (length(note) <= 500),
  step_up_method  VARCHAR CHECK (step_up_method IN ('passkey','totp')),
  step_up_at      TIMESTAMPTZ,
  payload_sha256  VARCHAR NOT NULL,                             -- hash visto por el aprobador
  ip              VARCHAR,
  user_agent      VARCHAR,
  UNIQUE (request_id, decided_by)
);


-- La decisión debe referirse al mismo hash que la solicitud

-- ---------------------------------------------------------------------
-- Outbox de eventos de dominio (para workflows de Timbal, agentes vigilantes y avisos a CVBOT)
-- ---------------------------------------------------------------------
CREATE SEQUENCE ops.outbox_event_id_seq;

CREATE TABLE ops.outbox_event (
  id             BIGINT DEFAULT nextval('ops.outbox_event_id_seq') PRIMARY KEY,
  event_type     VARCHAR NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$'),  -- p. ej. 'billing.invoice.issued'
  aggregate_table VARCHAR NOT NULL,
  aggregate_id   uuid NOT NULL,
  legal_entity_id uuid,
  payload        JSON NOT NULL,                 -- sin datos personales innecesarios (ids y resúmenes)
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     VARCHAR
);


-- ---------------------------------------------------------------------
-- Idempotencia de escrituras de API/MCP (cabecera Idempotency-Key)
-- ---------------------------------------------------------------------
CREATE TABLE ops.idempotency_key (
  key           VARCHAR NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  principal     VARCHAR NOT NULL,                  -- user:<uuid> o client:<code>
  route         VARCHAR NOT NULL,
  request_sha256 VARCHAR NOT NULL,
  status_code   smallint,
  response      JSON,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  PRIMARY KEY (principal, key)
);


-- ---------------------------------------------------------------------
-- Confirmaciones de escritura por MCP (§12.5: escritura con confirmación)
-- ---------------------------------------------------------------------
CREATE TABLE ops.mcp_confirmation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          BLOB NOT NULL UNIQUE,      -- sha256 del token de confirmación de un solo uso
  tool_name           VARCHAR NOT NULL,
  args_sha256         VARCHAR NOT NULL,
  client_id           uuid NOT NULL,
  on_behalf_of_user_id uuid,
  preview             JSON NOT NULL,             -- lo que se mostró al usuario
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  confirmed_at        TIMESTAMPTZ,
  executed_at         TIMESTAMPTZ,
  result_ref          JSON,
  CHECK (expires_at <= created_at + interval '15 minutes')
);


-- ---------------------------------------------------------------------
-- Ejecuciones de jobs programados y de conectores
-- ---------------------------------------------------------------------
CREATE TABLE ops.job_run (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     VARCHAR NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       VARCHAR NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','skipped')),
  summary      JSON NOT NULL DEFAULT '{}'::JSON,
  error        VARCHAR,
  trace_ref    VARCHAR
);

CREATE INDEX job_run_name_idx ON ops.job_run(job_name, started_at DESC);

