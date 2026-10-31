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
  kind              text NOT NULL CHECK (kind IN (
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
  legal_entity_id   uuid REFERENCES core.legal_entity(id),        -- NULL = todas
  min_approvals     smallint NOT NULL DEFAULT 1 CHECK (min_approvals BETWEEN 1 AND 3),
  allowed_roles     text[] NOT NULL DEFAULT '{owner,approver}',
  allowed_user_ids  uuid[] NOT NULL DEFAULT '{}',                 -- vacío = cualquiera con allowed_roles
  requires_step_up  boolean NOT NULL DEFAULT true,
  validity_minutes  integer NOT NULL DEFAULT 1440 CHECK (validity_minutes BETWEEN 5 AND 10080),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text NOT NULL
);
CREATE UNIQUE INDEX approval_policy_uq
  ON ops.approval_policy (kind, coalesce(legal_entity_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------
-- Solicitud de aprobación ligada al HASH del contenido aprobado.
-- Si el contenido cambia después de aprobar, el hash no coincide y la
-- ejecución se rechaza (WC040).
-- ---------------------------------------------------------------------
CREATE TABLE ops.approval_request (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,
  legal_entity_id  uuid REFERENCES core.legal_entity(id),
  subject_table    text NOT NULL CHECK (subject_table ~ '^[a-z_]+\.[a-z_]+$'),
  subject_id       uuid NOT NULL,
  payload_sha256   char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  summary          text NOT NULL CHECK (length(summary) BETWEEN 5 AND 300),
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,           -- qué se va a enviar, a quién, importes, nº de registros
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled','consumed')),
  requested_by     text NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  approved_at      timestamptz,
  consumed_at      timestamptz,
  workflow_run_ref text                                         -- id de ejecución de Timbal que espera (suspend/resume)
);
CREATE INDEX approval_request_pending_idx ON ops.approval_request(status, expires_at) WHERE status = 'pending';
CREATE INDEX approval_request_subject_idx ON ops.approval_request(subject_table, subject_id);
CREATE TRIGGER approval_request_no_delete BEFORE DELETE ON ops.approval_request
  FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE ops.approval_decision (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES ops.approval_request(id),
  decided_by      uuid NOT NULL REFERENCES core.app_user(id),
  decision        text NOT NULL CHECK (decision IN ('approve','reject')),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  note            text CHECK (length(note) <= 500),
  step_up_method  text CHECK (step_up_method IN ('passkey','totp')),
  step_up_at      timestamptz,
  payload_sha256  char(64) NOT NULL,                             -- hash visto por el aprobador
  ip              inet,
  user_agent      text,
  UNIQUE (request_id, decided_by)
);
CREATE TRIGGER approval_decision_no_delete BEFORE DELETE ON ops.approval_decision
  FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();
CREATE FUNCTION ops.approval_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WC041: una decisión de aprobación no se modifica';
END $$;
CREATE TRIGGER approval_decision_no_update BEFORE UPDATE ON ops.approval_decision
  FOR EACH ROW EXECUTE FUNCTION ops.approval_decision_immutable();

-- La decisión debe referirse al mismo hash que la solicitud
CREATE FUNCTION ops.approval_decision_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r ops.approval_request;
BEGIN
  SELECT * INTO r FROM ops.approval_request WHERE id = NEW.request_id FOR UPDATE;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'WC042: la solicitud % no está pendiente (%)', r.id, r.status;
  END IF;
  IF r.expires_at < now() THEN
    RAISE EXCEPTION 'WC043: la solicitud % ha caducado', r.id;
  END IF;
  IF NEW.payload_sha256 <> r.payload_sha256 THEN
    RAISE EXCEPTION 'WC040: el contenido aprobado no coincide con el contenido actual';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_decision_check BEFORE INSERT ON ops.approval_decision
  FOR EACH ROW EXECUTE FUNCTION ops.approval_decision_check();

-- ---------------------------------------------------------------------
-- Outbox de eventos de dominio (para workflows de Timbal, agentes vigilantes y avisos a CVBOT)
-- ---------------------------------------------------------------------
CREATE TABLE ops.outbox_event (
  id             bigserial PRIMARY KEY,
  event_type     text NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_]+(\.[a-z_]+)?$'),  -- p. ej. 'billing.invoice.issued'
  aggregate_table text NOT NULL,
  aggregate_id   uuid NOT NULL,
  legal_entity_id uuid REFERENCES core.legal_entity(id),
  payload        jsonb NOT NULL,                 -- sin datos personales innecesarios (ids y resúmenes)
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  available_at   timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text
);
CREATE INDEX outbox_pending_idx ON ops.outbox_event(available_at) WHERE published_at IS NULL;

-- ---------------------------------------------------------------------
-- Idempotencia de escrituras de API/MCP (cabecera Idempotency-Key)
-- ---------------------------------------------------------------------
CREATE TABLE ops.idempotency_key (
  key           text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  principal     text NOT NULL,                  -- user:<uuid> o client:<code>
  route         text NOT NULL,
  request_sha256 char(64) NOT NULL,
  status_code   smallint,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days',
  PRIMARY KEY (principal, key)
);

-- ---------------------------------------------------------------------
-- Confirmaciones de escritura por MCP (§12.5: escritura con confirmación)
-- ---------------------------------------------------------------------
CREATE TABLE ops.mcp_confirmation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          bytea NOT NULL UNIQUE,      -- sha256 del token de confirmación de un solo uso
  tool_name           text NOT NULL,
  args_sha256         char(64) NOT NULL,
  client_id           uuid NOT NULL REFERENCES core.api_client(id),
  on_behalf_of_user_id uuid REFERENCES core.app_user(id),
  preview             jsonb NOT NULL,             -- lo que se mostró al usuario
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  confirmed_at        timestamptz,
  executed_at         timestamptz,
  result_ref          jsonb,
  CHECK (expires_at <= created_at + interval '15 minutes')
);

-- ---------------------------------------------------------------------
-- Ejecuciones de jobs programados y de conectores
-- ---------------------------------------------------------------------
CREATE TABLE ops.job_run (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name     text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','skipped')),
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text,
  trace_ref    text
);
CREATE INDEX job_run_name_idx ON ops.job_run(job_name, started_at DESC);

CREATE TRIGGER approval_policy_audit AFTER INSERT OR UPDATE OR DELETE ON ops.approval_policy FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER approval_request_audit AFTER INSERT OR UPDATE ON ops.approval_request FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER approval_decision_audit AFTER INSERT ON ops.approval_decision FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER mcp_confirmation_audit AFTER INSERT OR UPDATE ON ops.mcp_confirmation FOR EACH ROW EXECUTE FUNCTION audit.capture();
