-- =====================================================================
-- WineCore · Migración 0001 · núcleo (core) y auditoría (audit)
-- Especificación: docs/02-modelo-dominio.md §3 y §4
-- PostgreSQL 16. Extensiones estándar: pgcrypto, citext, btree_gist.
-- Convenciones:
--   * PK uuid (la app genera UUIDv7; el DEFAULT v4 es solo red de seguridad).
--   * timestamptz para instantes; date para fechas de negocio (Europe/Madrid).
--   * Importes numeric(14,2); precios unitarios numeric(14,6); % numeric(5,2).
--   * Volúmenes en mililitros enteros (bigint); masas en gramos (bigint).
--   * Códigos de error de negocio 'WCnnn' en RAISE (ver §9 del modelo).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS party;
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

-- ---------------------------------------------------------------------
-- Contexto de actor por transacción. La app SIEMPRE ejecuta, al abrir
-- cada transacción de escritura:
--   SELECT core.set_actor('user'|'agent'|'system'|'migration', '<id>', '<on_behalf_of|null>', '<request_id>', '<reason|null>');
-- ---------------------------------------------------------------------
CREATE FUNCTION core.set_actor(p_type text, p_id text, p_on_behalf_of text, p_request_id text, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_type NOT IN ('user','agent','system','migration') THEN
    RAISE EXCEPTION 'WC002: tipo de actor no válido: %', p_type;
  END IF;
  IF p_id IS NULL OR length(p_id) = 0 THEN
    RAISE EXCEPTION 'WC002: falta el identificador del actor';
  END IF;
  PERFORM set_config('winecore.actor_type', p_type, true);
  PERFORM set_config('winecore.actor_id', p_id, true);
  PERFORM set_config('winecore.on_behalf_of', coalesce(p_on_behalf_of, ''), true);
  PERFORM set_config('winecore.request_id', coalesce(p_request_id, ''), true);
  PERFORM set_config('winecore.reason', coalesce(p_reason, ''), true);
END $$;

CREATE FUNCTION core.ctx(p_key text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('winecore.' || p_key, true), '') $$;

CREATE FUNCTION core.forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WC001: borrado prohibido en %.% (se rectifica, nunca se borra)', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;

CREATE FUNCTION core.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Entidades fiscales (P.O, CVPO)
-- ---------------------------------------------------------------------
CREATE TABLE core.legal_entity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  legal_name       text NOT NULL CHECK (length(legal_name) BETWEEN 2 AND 120),
  trade_name       text,
  tax_id           text NOT NULL UNIQUE CHECK (tax_id ~ '^[A-Z0-9]{9}$'),
  person_type      text NOT NULL CHECK (person_type IN ('natural','legal')),
  income_tax       text NOT NULL CHECK (income_tax IN ('IRPF','IS')),
  vat_id           text CHECK (vat_id ~ '^ES[A-Z0-9]{9}$'),
  eori             text,
  gln              char(13) CHECK (gln ~ '^[0-9]{13}$'),          -- punto operacional GS1 (usuario de AecocEDI)
  gs1_company_prefix text CHECK (gs1_company_prefix ~ '^[0-9]{7,12}$'),
  registry_data    text,                                          -- datos registrales (sociedades) para documentos
  address_line     text NOT NULL,
  postal_code      text NOT NULL CHECK (postal_code ~ '^[0-9]{5}$'),
  city             text NOT NULL,
  province         text NOT NULL,
  country_code     char(2) NOT NULL DEFAULT 'ES',
  default_currency char(3) NOT NULL DEFAULT 'EUR',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER legal_entity_touch BEFORE UPDATE ON core.legal_entity
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER legal_entity_no_delete BEFORE DELETE ON core.legal_entity
  FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- ---------------------------------------------------------------------
-- Usuarios, credenciales, sesiones y clientes de API (ADR 008)
-- ---------------------------------------------------------------------
CREATE TABLE core.app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  locale        text NOT NULL DEFAULT 'es-ES' CHECK (locale IN ('es-ES','en-GB')),
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','revoked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TRIGGER app_user_touch BEFORE UPDATE ON core.app_user
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER app_user_no_delete BEFORE DELETE ON core.app_user
  FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Roles fijos (la matriz de permisos vive en código: api/src/core/auth/permissions.ts)
CREATE TABLE core.role (
  code        text PRIMARY KEY CHECK (code IN ('owner','approver','admin','cellar','field','advisor','agent','mcp_client')),
  name_es     text NOT NULL,
  description text NOT NULL
);

CREATE TABLE core.user_role (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES core.app_user(id),
  role_code       text NOT NULL REFERENCES core.role(code),
  legal_entity_id uuid REFERENCES core.legal_entity(id),   -- NULL = todas las entidades
  granted_by      uuid REFERENCES core.app_user(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  CHECK (role_code NOT IN ('agent','mcp_client'))          -- esos roles son de api_client
);
CREATE UNIQUE INDEX user_role_active_uq ON core.user_role
  (user_id, role_code, coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

CREATE TABLE core.user_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES core.app_user(id),
  kind           text NOT NULL CHECK (kind IN ('passkey','totp')),
  label          text NOT NULL,
  -- passkey: credential_id (base64url), public_key (COSE), sign_count; totp: secreto cifrado con WINECORE_DATA_KEY
  credential_id  text UNIQUE,
  public_key     bytea,
  sign_count     bigint NOT NULL DEFAULT 0,
  totp_secret_enc bytea,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  CHECK ((kind = 'passkey' AND credential_id IS NOT NULL AND public_key IS NOT NULL)
      OR (kind = 'totp' AND totp_secret_enc IS NOT NULL))
);

CREATE TABLE core.session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES core.app_user(id),
  token_hash       bytea NOT NULL UNIQUE,                 -- sha256 del token de la cookie
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  step_up_at       timestamptz,                           -- última verificación reforzada (passkey/TOTP)
  step_up_method   text CHECK (step_up_method IN ('passkey','totp')),
  ip               inet,
  user_agent       text,
  revoked_at       timestamptz
);
CREATE INDEX session_user_idx ON core.session(user_id) WHERE revoked_at IS NULL;

CREATE TABLE core.api_client (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{2,40}$'),  -- p. ej. 'cvbot', 'regulatorio-silicie'
  role_code           text NOT NULL REFERENCES core.role(code) CHECK (role_code IN ('agent','mcp_client')),
  description         text NOT NULL,
  scopes              text[] NOT NULL,                     -- p. ej. {'read:*','write:sales.order'}
  on_behalf_of_user_id uuid REFERENCES core.app_user(id),  -- usuario al que representa (CVBOT → Pedro)
  created_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz
);

CREATE TABLE core.api_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES core.api_client(id),
  token_hash  bytea NOT NULL UNIQUE,                         -- sha256; el token solo se muestra al crearlo
  prefix      text NOT NULL CHECK (prefix ~ '^wc_[a-z]+_[A-Za-z0-9]{6}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Módulos activables (§12.6) y ajustes
-- ---------------------------------------------------------------------
CREATE TABLE core.module_state (
  module_key  text PRIMARY KEY CHECK (module_key IN (
                'contacts','catalog','sales','billing','verifactu','purchasing','inventory','cellar',
                'vineyard','finance','accounting','silicie','sisv','emcs','edi','organic','labels',
                'knowledge','mcp','assistant','watchers')),
  enabled     boolean NOT NULL DEFAULT false,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text NOT NULL
);

CREATE TABLE core.setting (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z]+(\.[a-z0-9_]+)+$'),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

-- ---------------------------------------------------------------------
-- Series y numeración sin huecos
-- ---------------------------------------------------------------------
CREATE TABLE core.number_series (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  doc_type        text NOT NULL CHECK (doc_type IN (
                    'invoice','credit_note','simplified_invoice','intercompany_invoice',
                    'delivery_note','quote','sales_order','proforma','cellar_operation','inventory_count')),
  code            text NOT NULL CHECK (code ~ '^[A-Z]{1,4}$'),
  year            smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  prefix          text NOT NULL CHECK (length(prefix) BETWEEN 1 AND 12),
  padding         smallint NOT NULL DEFAULT 4 CHECK (padding BETWEEN 2 AND 8),
  next_value      integer NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  is_default      boolean NOT NULL DEFAULT false,
  verifactu       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, doc_type, code, year),
  UNIQUE (legal_entity_id, prefix)
);
CREATE UNIQUE INDEX number_series_default_uq
  ON core.number_series (legal_entity_id, doc_type, year) WHERE is_default;
CREATE TRIGGER number_series_no_delete BEFORE DELETE ON core.number_series
  FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Toma el siguiente número dentro de la transacción del emisor.
-- El bloqueo de fila serializa emisores concurrentes; si la transacción
-- se deshace, el contador también: no hay huecos.
CREATE FUNCTION core.take_number(p_series_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_prefix text; v_pad smallint; v_val integer;
BEGIN
  UPDATE core.number_series
     SET next_value = next_value + 1
   WHERE id = p_series_id AND is_active
   RETURNING prefix, padding, next_value - 1 INTO v_prefix, v_pad, v_val;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WC010: serie % inexistente o inactiva', p_series_id;
  END IF;
  IF length(v_val::text) > v_pad THEN
    RAISE EXCEPTION 'WC011: la serie % ha agotado su rango (%)', p_series_id, v_val;
  END IF;
  RETURN v_prefix || lpad(v_val::text, v_pad, '0');
END $$;

-- ---------------------------------------------------------------------
-- Adjuntos (PDF, fotos, capturas, acuses). El contenido vive en core.attachment_content
-- (misma Knowledge Base, ADR 002) y se identifica por su SHA-256; 'onedrive' solo para copias de consulta.
-- ---------------------------------------------------------------------
CREATE TABLE core.attachment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256          char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_backend text NOT NULL CHECK (storage_backend IN ('knowledge_base','onedrive')),
  storage_key     text NOT NULL,   -- en 'knowledge_base', el SHA-256 de core.attachment_content
  filename        text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  classification  text NOT NULL DEFAULT 'internal' CHECK (classification IN ('internal','personal_data','regulatory_evidence','secret_free_log')),
  retention_until date,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_backend, storage_key)
);
CREATE INDEX attachment_sha_idx ON core.attachment(sha256);
CREATE TRIGGER attachment_no_delete BEFORE DELETE ON core.attachment
  FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE core.attachment_content (
  sha256     char(64) PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content    bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(content) BETWEEN 1 AND 104857600)   -- límite de 100 MB de la Knowledge Base
);
-- El contenido no se borra ni se sustituye (WC001)
CREATE FUNCTION core.attachment_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WC001: el contenido de un adjunto no se borra ni se sustituye';
END $$;
CREATE TRIGGER attachment_content_immutable BEFORE UPDATE OR DELETE ON core.attachment_content
  FOR EACH ROW EXECUTE FUNCTION core.attachment_content_guard();

CREATE TABLE core.attachment_link (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES core.attachment(id),
  entity_table  text NOT NULL CHECK (entity_table ~ '^[a-z_]+\.[a-z_]+$'),
  entity_id     uuid NOT NULL,
  role          text NOT NULL CHECK (role IN (
                  'invoice_pdf','delivery_note_pdf','supplier_invoice_scan','expense_photo',
                  'evidence_screenshot','evidence_request','evidence_response','official_receipt',
                  'lab_report','photo','label_artwork','contract','other')),
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, entity_table, entity_id, role)
);
CREATE INDEX attachment_link_entity_idx ON core.attachment_link(entity_table, entity_id);

-- Los enlaces de evidencias, PDF emitidos y acuses no se desvinculan nunca (WC001)
CREATE FUNCTION core.attachment_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role IN ('invoice_pdf','delivery_note_pdf','evidence_screenshot','evidence_request',
                  'evidence_response','official_receipt','lab_report') THEN
    RAISE EXCEPTION 'WC001: el enlace % (%) es una evidencia y no se elimina', OLD.id, OLD.role;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER attachment_link_guard BEFORE DELETE ON core.attachment_link
  FOR EACH ROW EXECUTE FUNCTION core.attachment_link_guard();

CREATE TABLE core.notification (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES core.app_user(id),
  kind       text NOT NULL,
  title      text NOT NULL CHECK (length(title) <= 80),
  body       text NOT NULL CHECK (length(body) <= 500),
  link       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notification_unread_idx ON core.notification(user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------
-- Auditoría inmutable con encadenamiento de hash
-- ---------------------------------------------------------------------
CREATE TABLE audit.audit_log (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  tx_id        bigint NOT NULL DEFAULT txid_current(),
  actor_type   text NOT NULL CHECK (actor_type IN ('user','agent','system','migration')),
  actor_id     text NOT NULL,
  on_behalf_of text,
  request_id   text,
  action       text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE','EVENT')),
  table_name   text NOT NULL,
  row_id       text,
  before_data  jsonb,
  after_data   jsonb,
  reason       text,
  prev_hash    bytea,
  hash         bytea NOT NULL
);
CREATE INDEX audit_log_row_idx ON audit.audit_log(table_name, row_id);
CREATE INDEX audit_log_time_idx ON audit.audit_log(occurred_at);

-- Devuelve solo la última huella: los roles que escriben en la auditoría no necesitan leerla entera
CREATE FUNCTION audit.last_hash() RETURNS bytea LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, audit AS $$
  SELECT hash FROM audit.audit_log ORDER BY id DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION audit.last_hash() FROM PUBLIC;

CREATE FUNCTION audit.chain_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('winecore.audit_chain'));
  v_prev := audit.last_hash();
  NEW.prev_hash := v_prev;
  NEW.hash := digest(
    coalesce(encode(v_prev, 'hex'), '') || '|' || NEW.occurred_at::text || '|' || NEW.actor_type || '|' ||
    NEW.actor_id || '|' || NEW.action || '|' || NEW.table_name || '|' || coalesce(NEW.row_id, '') || '|' ||
    coalesce(NEW.before_data::text, '') || '|' || coalesce(NEW.after_data::text, '') || '|' || coalesce(NEW.reason, ''),
    'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.chain_hash();

CREATE FUNCTION audit.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WC003: el registro de auditoría es inmutable';
END $$;
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit.audit_log
  FOR EACH ROW EXECUTE FUNCTION audit.immutable();

-- Trigger genérico de captura: se asocia a cada tabla auditada (lista en §4.3 del modelo).
CREATE FUNCTION audit.capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type text := core.ctx('actor_type');
  v_id   text := core.ctx('actor_id');
  v_row  text;
BEGIN
  IF v_type IS NULL OR v_id IS NULL THEN
    RAISE EXCEPTION 'WC002: falta contexto de actor (core.set_actor) al modificar %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_row := (to_jsonb(OLD) ->> 'id');
  ELSE
    v_row := (to_jsonb(NEW) ->> 'id');
  END IF;
  INSERT INTO audit.audit_log(actor_type, actor_id, on_behalf_of, request_id, action, table_name, row_id,
                              before_data, after_data, reason)
  VALUES (v_type, v_id, core.ctx('on_behalf_of'), core.ctx('request_id'), TG_OP,
          TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, v_row,
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END,
          core.ctx('reason'));
  RETURN NULL;
END $$;

-- Eventos de negocio sin cambio de fila (login, aprobación, envío, exportación...)
CREATE FUNCTION audit.log_event(p_table text, p_row_id text, p_payload jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF core.ctx('actor_type') IS NULL THEN
    RAISE EXCEPTION 'WC002: falta contexto de actor';
  END IF;
  INSERT INTO audit.audit_log(actor_type, actor_id, on_behalf_of, request_id, action, table_name, row_id, after_data, reason)
  VALUES (core.ctx('actor_type'), core.ctx('actor_id'), core.ctx('on_behalf_of'), core.ctx('request_id'),
          'EVENT', p_table, p_row_id, p_payload, core.ctx('reason'));
END $$;

-- Verificación de la cadena (la usa el job diario audit-verify)
CREATE FUNCTION audit.verify_chain(p_from_id bigint DEFAULT 1)
RETURNS TABLE(broken_at bigint) LANGUAGE plpgsql AS $$
DECLARE r record; v_prev bytea; v_calc bytea; v_first boolean := true;
BEGIN
  FOR r IN SELECT * FROM audit.audit_log WHERE id >= p_from_id ORDER BY id LOOP
    IF v_first THEN v_prev := r.prev_hash; v_first := false; END IF;
    v_calc := digest(
      coalesce(encode(v_prev, 'hex'), '') || '|' || r.occurred_at::text || '|' || r.actor_type || '|' ||
      r.actor_id || '|' || r.action || '|' || r.table_name || '|' || coalesce(r.row_id, '') || '|' ||
      coalesce(r.before_data::text, '') || '|' || coalesce(r.after_data::text, '') || '|' || coalesce(r.reason, ''),
      'sha256');
    IF r.prev_hash IS DISTINCT FROM v_prev OR r.hash <> v_calc THEN
      broken_at := r.id; RETURN NEXT; RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
END $$;

-- Tablas de core auditadas
CREATE TRIGGER legal_entity_audit AFTER INSERT OR UPDATE ON core.legal_entity FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER app_user_audit AFTER INSERT OR UPDATE ON core.app_user FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER user_role_audit AFTER INSERT OR UPDATE ON core.user_role FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER user_credential_audit AFTER INSERT OR UPDATE ON core.user_credential FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER api_client_audit AFTER INSERT OR UPDATE ON core.api_client FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER api_token_audit AFTER INSERT OR UPDATE ON core.api_token FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER module_state_audit AFTER INSERT OR UPDATE OR DELETE ON core.module_state FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER setting_audit AFTER INSERT OR UPDATE OR DELETE ON core.setting FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER number_series_audit AFTER INSERT OR UPDATE ON core.number_series FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER attachment_audit AFTER INSERT ON core.attachment FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER attachment_link_audit AFTER INSERT OR DELETE ON core.attachment_link FOR EACH ROW EXECUTE FUNCTION audit.capture();

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
