-- =====================================================================
-- WineCore · Migración 0012 · regulatorio (regulatory)
-- Conectores intercambiables (§12.1: computer use hoy, API mañana), ejecutores, envíos con
-- aprobación y evidencias, Verifactu, SILICIE, SISV, EMCS (e-DA), EDI, calendario y cuadres.
-- Especificación: docs/02-modelo-dominio.md §18 · docs/04-regulatorio/*.md · Estados: docs/03-maquinas-estado.md §8–§11
-- Garantía de "un solo envío": la reclama WineCore (no el gate de Timbal) con
-- approval_request.status='consumed' + connector_run con lease (FOR UPDATE SKIP LOCKED).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ejecutores y conectores
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.runner (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{2,40}$'),   -- 'timbal-api', 'local-bodega-mac'
  kind           text NOT NULL CHECK (kind IN ('timbal','local','provider')),
  description    text NOT NULL,
  api_client_id  uuid REFERENCES core.api_client(id),                           -- credencial con la que reclama trabajos
  capabilities   text[] NOT NULL DEFAULT '{}',                                  -- p. ej. {'aeat_certificate','sisv','aecocedi'}
  last_seen_at   timestamptz,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regulatory.connector (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow             text NOT NULL CHECK (flow IN ('verifactu','silicie','sisv','emcs','edi','organic','aeat_model')),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  mode             text NOT NULL CHECK (mode IN ('api','computer_use','file_upload','manual')),
  environment      text NOT NULL CHECK (environment IN ('test','production')),
  runner_id        uuid REFERENCES regulatory.runner(id),
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,       -- endpoints, URLs de portal, ids de procedimiento (nunca secretos)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (mode = 'manual' OR runner_id IS NOT NULL)
);
CREATE UNIQUE INDEX connector_active_uq ON regulatory.connector(flow, legal_entity_id, environment) WHERE is_active;

-- ---------------------------------------------------------------------
-- Envío regulatorio genérico (estado: docs/03-maquinas-estado.md §11)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.submission (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow                  text NOT NULL CHECK (flow IN ('verifactu','silicie','sisv','emcs','edi','organic','aeat_model')),
  legal_entity_id       uuid NOT NULL REFERENCES core.legal_entity(id),
  connector_id          uuid REFERENCES regulatory.connector(id),
  kind                  text NOT NULL,                       -- p. ej. 'silicie.asientos', 'sisv.libro_envasado', 'emcs.ie815', 'edi.invoic'
  period_start          date,
  period_end            date,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN (
                          'draft','validated','pending_approval','approved','submitting','submitted',
                          'accepted','accepted_with_errors','rejected','failed','cancelled','rectified')),
  payload               jsonb NOT NULL,                      -- datos canónicos (el "qué"): lo que se envía, independiente del conector
  payload_sha256        char(64) NOT NULL,
  rendered_attachment_id uuid REFERENCES core.attachment(id), -- fichero/XML/ficha generada a partir del payload
  validation_errors     jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_request_id   uuid REFERENCES ops.approval_request(id),
  external_ref          text,                                -- nº de asiento, ARC, CSV de la AEAT, nº de registro SISV…
  response_summary      jsonb,
  rectifies_submission_id uuid REFERENCES regulatory.submission(id),
  due_date              date,
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved','submitting','submitted','accepted','accepted_with_errors') OR approval_request_id IS NOT NULL OR flow = 'verifactu'),
  CHECK (status NOT IN ('validated','pending_approval','approved','submitting','submitted','accepted','accepted_with_errors')
         OR jsonb_array_length(validation_errors) = 0)
);
CREATE INDEX submission_status_idx ON regulatory.submission(flow, status);
CREATE TRIGGER submission_touch BEFORE UPDATE ON regulatory.submission FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER submission_no_delete BEFORE DELETE ON regulatory.submission FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- El contenido no cambia una vez pedida la aprobación (WC120)
CREATE FUNCTION regulatory.submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('draft','validated') AND (NEW.payload IS DISTINCT FROM OLD.payload OR NEW.payload_sha256 <> OLD.payload_sha256) THEN
    RAISE EXCEPTION 'WC120: el contenido del envío está congelado desde la solicitud de aprobación';
  END IF;
  IF OLD.status IN ('accepted','rejected','cancelled','rectified') AND NEW.status <> OLD.status
     AND NOT (OLD.status IN ('accepted','rejected') AND NEW.status = 'rectified') THEN
    RAISE EXCEPTION 'WC121: el envío % está cerrado (%)', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER submission_guard BEFORE UPDATE ON regulatory.submission FOR EACH ROW EXECUTE FUNCTION regulatory.submission_guard();

CREATE TABLE regulatory.submission_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES regulatory.submission(id),
  item_table     text NOT NULL CHECK (item_table ~ '^[a-z_]+\.[a-z_]+$'),   -- 'regulatory.silicie_entry', 'regulatory.sisv_entry', …
  item_id        uuid NOT NULL,
  result         text CHECK (result IN ('accepted','rejected','warning')),
  result_detail  jsonb,
  UNIQUE (submission_id, item_table, item_id)
);

-- Cada intento de un conector (cola para el ejecutor; lease para que nunca haya dos a la vez)
CREATE TABLE regulatory.connector_run (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      uuid NOT NULL REFERENCES regulatory.submission(id),
  attempt            smallint NOT NULL CHECK (attempt BETWEEN 1 AND 10),
  action             text NOT NULL CHECK (action IN ('submit','check_status','fetch_receipt','read_inbox','cancel')),
  status             text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','running','succeeded','failed','needs_human','expired')),
  runner_id          uuid REFERENCES regulatory.runner(id),
  claimed_at         timestamptz,
  lease_until        timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  outcome            jsonb,                                  -- resultado estructurado (nº registro, CSV, ARC, errores del portal)
  error              text,
  trace_ref          text,                                   -- id de traza de Timbal o del ejecutor local
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, action, attempt)
);
-- Nunca dos envíos en curso del mismo envío
CREATE UNIQUE INDEX connector_run_single_submit_uq ON regulatory.connector_run(submission_id)
  WHERE action = 'submit' AND status IN ('queued','claimed','running');
CREATE INDEX connector_run_queue_idx ON regulatory.connector_run(status, created_at) WHERE status = 'queued';

-- ---------------------------------------------------------------------
-- Verifactu (docs/04-regulatorio/verifactu.md)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.verifactu_installation (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id       uuid NOT NULL REFERENCES core.legal_entity(id),
  environment           text NOT NULL CHECK (environment IN ('test','production')),
  mode                  text NOT NULL CHECK (mode IN ('verifactu','no_verifactu')),
  system_name           text NOT NULL DEFAULT 'WineCore',            -- NombreSistemaInformatico
  system_id             char(2) NOT NULL DEFAULT 'WC',               -- IdSistemaInformatico
  system_version        text NOT NULL,                               -- Version (semver del despliegue)
  installation_number   text NOT NULL,                               -- NumeroInstalacion
  producer_name         text NOT NULL,                               -- productor del SIF (Q-007)
  producer_tax_id       text NOT NULL,
  only_verifactu        boolean NOT NULL DEFAULT true,               -- TipoUsoPosibleSoloVerifactu
  multi_taxpayer        boolean NOT NULL DEFAULT true,               -- TipoUsoPosibleMultiOT (P.O y CVPO en el mismo sistema)
  multiple_taxpayers    boolean NOT NULL DEFAULT true,               -- IndicadorMultiplesOT
  starts_on             date NOT NULL,                               -- CVPO 2027-01-01; P.O 2027-07-01 (o antes, voluntario)
  next_send_not_before  timestamptz,                                 -- control de flujo (TiempoEsperaEnvio de la AEAT)
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, environment)
);

CREATE TABLE regulatory.verifactu_record (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id        uuid NOT NULL REFERENCES regulatory.verifactu_installation(id),
  legal_entity_id        uuid NOT NULL REFERENCES core.legal_entity(id),
  chain_seq              bigint NOT NULL CHECK (chain_seq >= 1),     -- orden en la cadena de la instalación
  record_type            text NOT NULL CHECK (record_type IN ('alta','anulacion')),
  invoice_id             uuid NOT NULL REFERENCES billing.invoice(id),
  issuer_tax_id          text NOT NULL,                              -- IDEmisorFactura
  invoice_number         text NOT NULL,                              -- NumSerieFactura
  invoice_issue_date     date NOT NULL,                              -- FechaExpedicionFactura
  invoice_type           char(2),                                    -- TipoFactura (alta)
  total_tax              numeric(14,2),                              -- CuotaTotal (alta)
  total_amount           numeric(14,2),                              -- ImporteTotal (alta)
  is_correction          boolean NOT NULL DEFAULT false,             -- Subsanacion
  rejected_previous      text CHECK (rejected_previous IN ('N','S','X')),  -- RechazoPrevio
  previous_record_id     uuid REFERENCES regulatory.verifactu_record(id),
  previous_hash          char(64),                                   -- Huella del registro anterior (NULL si PrimerRegistro)
  generated_at           timestamptz NOT NULL,                       -- FechaHoraHusoGenRegistro
  hash_type              char(2) NOT NULL DEFAULT '01',              -- TipoHuella 01 = SHA-256
  hash                   char(64) NOT NULL CHECK (hash ~ '^[0-9A-F]{64}$'),
  record_xml             text NOT NULL,                              -- XML canónico del registro (evidencia)
  qr_url                 text,                                       -- URL de cotejo (alta)
  signature_xml          text,                                       -- solo NO VERI*FACTU (firma XAdES)
  send_status            text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending','sending','accepted','accepted_with_errors','rejected','not_required')),
  aeat_csv               text,
  aeat_error_code        text,
  aeat_error_text        text,
  submission_id          uuid REFERENCES regulatory.submission(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, chain_seq),
  UNIQUE (installation_id, hash),
  CHECK ((chain_seq = 1) = (previous_record_id IS NULL)),
  CHECK ((previous_record_id IS NULL) = (previous_hash IS NULL)),
  CHECK (record_type <> 'alta' OR (invoice_type IS NOT NULL AND total_amount IS NOT NULL AND total_tax IS NOT NULL))
);
CREATE INDEX verifactu_record_send_idx ON regulatory.verifactu_record(send_status) WHERE send_status IN ('pending','sending');

-- La cadena solo crece por el final y los registros no se modifican salvo su estado de envío (WC130)
CREATE FUNCTION regulatory.verifactu_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_last regulatory.verifactu_record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtext('verifactu_chain:' || NEW.installation_id::text));
    SELECT * INTO v_last FROM regulatory.verifactu_record
     WHERE installation_id = NEW.installation_id ORDER BY chain_seq DESC LIMIT 1;
    IF v_last.id IS NULL THEN
      IF NEW.chain_seq <> 1 OR NEW.previous_record_id IS NOT NULL THEN
        RAISE EXCEPTION 'WC130: el primer registro de la instalación debe ser PrimerRegistro (seq 1)';
      END IF;
    ELSIF NEW.chain_seq <> v_last.chain_seq + 1 OR NEW.previous_record_id <> v_last.id OR NEW.previous_hash <> v_last.hash THEN
      RAISE EXCEPTION 'WC130: encadenamiento incorrecto (esperado seq %, anterior %)', v_last.chain_seq + 1, v_last.id;
    ELSIF NEW.generated_at < v_last.generated_at THEN
      RAISE EXCEPTION 'WC131: FechaHoraHusoGenRegistro anterior a la del registro anterior (% < %)', NEW.generated_at, v_last.generated_at;
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['send_status','aeat_csv','aeat_error_code','aeat_error_text','submission_id'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['send_status','aeat_csv','aeat_error_code','aeat_error_text','submission_id']) THEN
    RAISE EXCEPTION 'WC130: un registro de facturación no se modifica (solo su estado de envío)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verifactu_record_guard BEFORE INSERT OR UPDATE ON regulatory.verifactu_record
  FOR EACH ROW EXECUTE FUNCTION regulatory.verifactu_record_guard();
CREATE TRIGGER verifactu_record_no_delete BEFORE DELETE ON regulatory.verifactu_record FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Registro de eventos del SIF (obligatorio en NO VERI*FACTU; se mantiene también en VERI*FACTU como evidencia)
CREATE TABLE regulatory.verifactu_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id  uuid NOT NULL REFERENCES regulatory.verifactu_installation(id),
  event_type       text NOT NULL,                               -- códigos de la especificación (inicio, fin, detección de anomalías, exportación…)
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash    char(64),
  hash             char(64) NOT NULL
);
CREATE TRIGGER verifactu_event_no_update BEFORE UPDATE OR DELETE ON regulatory.verifactu_event FOR EACH ROW EXECUTE FUNCTION audit.immutable();

ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_verifactu_record_fk FOREIGN KEY (verifactu_record_id) REFERENCES regulatory.verifactu_record(id);

-- ---------------------------------------------------------------------
-- SILICIE (docs/04-regulatorio/silicie.md): ejercicios y asientos por establecimiento (CAE)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.silicie_exercise (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_warehouse_id uuid NOT NULL REFERENCES inventory.tax_warehouse(id),
  year             smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  UNIQUE (tax_warehouse_id, year)
);

CREATE TABLE regulatory.silicie_entry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id         uuid NOT NULL REFERENCES regulatory.silicie_exercise(id),
  tax_warehouse_id    uuid NOT NULL REFERENCES inventory.tax_warehouse(id),
  local_seq           integer NOT NULL CHECK (local_seq >= 1),          -- correlativo interno por ejercicio
  movement_date       date NOT NULL,                                    -- fecha del movimiento (fecha fiscal)
  entry_kind          text NOT NULL,                                    -- tipo de asiento/movimiento (lista en silicie.md)
  fields              jsonb NOT NULL,                                   -- campo a campo según el formato oficial (validado con el esquema de silicie.md)
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_submission','accepted','rejected','annulled')),
  aeat_entry_number   text,                                             -- nº de asiento asignado por la AEAT
  annuls_entry_id     uuid REFERENCES regulatory.silicie_entry(id),     -- asiento de anulación
  submission_id       uuid REFERENCES regulatory.submission(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exercise_id, local_seq)
);
CREATE INDEX silicie_entry_status_idx ON regulatory.silicie_entry(status, movement_date);
CREATE TRIGGER silicie_entry_no_delete BEFORE DELETE ON regulatory.silicie_entry FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

ALTER TABLE inventory.fiscal_move
  ADD CONSTRAINT fiscal_move_silicie_entry_fk FOREIGN KEY (silicie_entry_id) REFERENCES regulatory.silicie_entry(id);

-- Mayores contables de SILICIE 2.0: identificación estable de cada producto o materia prima
-- (Orden HAC/998/2019, anexo, campos 9.1–9.8 y 10.1–10.2; docs/04-regulatorio/silicie.md §6)
CREATE TABLE regulatory.silicie_ledger (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_warehouse_id     uuid NOT NULL REFERENCES inventory.tax_warehouse(id),
  reference            text NOT NULL CHECK (reference ~ '^[A-Z0-9_-]{2,20}$'),              -- 9.8 Referencia
  description          text NOT NULL CHECK (length(description) BETWEEN 3 AND 100),           -- 9.7 Descripción (agrupa existencias en 2.0)
  product_class        text NOT NULL CHECK (product_class IN ('raw_grape','raw_must','bulk','bulk_wood','packaged','byproduct')),
  epigrafe             text,                                                                  -- 9.1 (vino tranquilo: '1')
  epigrafe_code        text,                                                                  -- 9.2 (vino tranquilo: 'V0')
  nc_code              text NOT NULL CHECK (nc_code ~ '^[0-9]{4}([0-9]{2}){0,2}$'),            -- 9.3 (mínimo 4 dígitos en 2.0)
  product_key          text,                                                                  -- 9.4 Clave ('V01' uva, 'V02' mosto)
  container_type       text,                                                                  -- 10.1 Tipo de envase ('VF03'…)
  container_capacity_l numeric(7,3),                                                          -- 10.2 Capacidad del envase
  is_active            boolean NOT NULL DEFAULT true,
  validated_by         text,                                                                  -- revisión del asesor
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_warehouse_id, reference),
  UNIQUE (tax_warehouse_id, description),
  UNIQUE (tax_warehouse_id, reference, product_class),
  CHECK (product_class NOT IN ('bulk','bulk_wood','packaged') OR (epigrafe IS NOT NULL AND epigrafe_code IS NOT NULL)),
  CHECK (product_class <> 'packaged' OR (container_type IS NOT NULL AND container_capacity_l IS NOT NULL))
);
-- La identificación de un mayor no se cambia: se crea otro y se pasa el saldo con A17/A16
CREATE FUNCTION regulatory.silicie_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['is_active','validated_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['is_active','validated_by']) THEN
    RAISE EXCEPTION 'WC122: la identificación de un mayor de SILICIE no se modifica; crea otro y traspasa el saldo';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER silicie_ledger_guard BEFORE UPDATE ON regulatory.silicie_ledger FOR EACH ROW EXECUTE FUNCTION regulatory.silicie_ledger_guard();
CREATE TRIGGER silicie_ledger_no_delete BEFORE DELETE ON regulatory.silicie_ledger FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Cada movimiento fiscal apunta a un mayor existente y de su misma clase
ALTER TABLE inventory.fiscal_move
  ADD CONSTRAINT fiscal_move_ledger_fk FOREIGN KEY (tax_warehouse_id, excise_product_key, product_class)
  REFERENCES regulatory.silicie_ledger(tax_warehouse_id, reference, product_class);

-- ---------------------------------------------------------------------
-- SISV (docs/04-regulatorio/sisv.md): anotaciones por libro, derivadas de operaciones y documentos
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.sisv_entry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  book             text NOT NULL CHECK (book IN ('grape_intake','winemaking','varietal','packaged_wines','packaging','other')),
  entry_date       date NOT NULL,
  operation        text NOT NULL,                                       -- tipo de anotación según sisv.md
  fields           jsonb NOT NULL,
  source_table     text NOT NULL,
  source_id        uuid NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_submission','recorded','signed','rejected','annulled')),
  sisv_ref         text,                                                -- referencia de la anotación en SISV
  annuls_entry_id  uuid REFERENCES regulatory.sisv_entry(id),
  submission_id    uuid REFERENCES regulatory.submission(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sisv_entry_status_idx ON regulatory.sisv_entry(book, status, entry_date);
CREATE TRIGGER sisv_entry_no_delete BEFORE DELETE ON regulatory.sisv_entry FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- ---------------------------------------------------------------------
-- EMCS: documento administrativo electrónico (e-DA) y sus mensajes
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.emcs_document (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL REFERENCES core.legal_entity(id),
  tax_warehouse_id       uuid NOT NULL REFERENCES inventory.tax_warehouse(id),
  kind                   text NOT NULL CHECK (kind IN ('e_ad','e_sad')),     -- suspensivo / impuesto pagado
  destination_type       text NOT NULL,                                    -- código EMCS (lista en emcs.md)
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft','validated','pending_approval','approved','submitted','accepted','in_transit',
                           'delivered','refused','partially_refused','cancelled','destination_changed','rejected')),
  lrn                    text NOT NULL UNIQUE,                              -- número de referencia local
  arc                    text UNIQUE,                                       -- código de referencia administrativo (ARC)
  consignee_contact_id   uuid REFERENCES party.contact(id),
  consignee_excise_number text,
  delivery_place         jsonb,
  export_office_code     text,
  dispatch_date          date,
  delivery_note_id       uuid REFERENCES sales.delivery_note(id),
  fields                 jsonb NOT NULL,                                    -- campos IE815 según emcs.md
  receipt_status         text CHECK (receipt_status IN ('accepted','accepted_with_shortage','refused','partially_refused')),
  receipt_at             timestamptz,
  submission_id          uuid REFERENCES regulatory.submission(id),
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('accepted','in_transit','delivered','refused','partially_refused','destination_changed') OR arc IS NOT NULL)
);
CREATE TRIGGER emcs_document_no_delete BEFORE DELETE ON regulatory.emcs_document FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE regulatory.emcs_item (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emcs_document_id   uuid NOT NULL REFERENCES regulatory.emcs_document(id),
  item_no            smallint NOT NULL CHECK (item_no > 0),
  product_id         uuid REFERENCES catalog.product(id),
  lot_id             uuid REFERENCES inventory.lot(id),
  excise_product_code text NOT NULL,                                        -- p. ej. W200
  nc_code            text NOT NULL CHECK (nc_code ~ '^[0-9]{8}$'),
  volume_ml          bigint NOT NULL CHECK (volume_ml > 0),
  abv_pct            numeric(5,2) NOT NULL,
  units              integer,
  packages           jsonb,
  UNIQUE (emcs_document_id, item_no)
);

ALTER TABLE sales.delivery_note
  ADD CONSTRAINT delivery_note_emcs_fk FOREIGN KEY (emcs_document_id) REFERENCES regulatory.emcs_document(id);

-- ---------------------------------------------------------------------
-- EDI (AecocEDI): mensajes recibidos y enviados
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.edi_message (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id   uuid NOT NULL REFERENCES core.legal_entity(id),
  partner_contact_id uuid NOT NULL REFERENCES party.contact(id),
  direction         text NOT NULL CHECK (direction IN ('in','out')),
  message_type      text NOT NULL CHECK (message_type IN ('ORDERS','DESADV','INVOIC','REMADV','RECADV','TEXT','OTHER')),
  external_id       text,                                                  -- id en el portal / nº de documento
  document_number   text,
  document_date     date,
  status            text NOT NULL DEFAULT 'received' CHECK (status IN (
                      'notified','received','parsed','linked','prepared','pending_approval','approved','sent','acknowledged','error','ignored')),
  parsed            jsonb,                                                 -- campos normalizados (ver aecoc-edi.md)
  raw_attachment_id uuid REFERENCES core.attachment(id),                   -- captura/fichero tal cual
  sales_order_id    uuid REFERENCES sales.sales_order(id),
  invoice_id        uuid REFERENCES billing.invoice(id),
  submission_id     uuid REFERENCES regulatory.submission(id),
  received_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX edi_message_external_uq ON regulatory.edi_message(partner_contact_id, direction, message_type, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE sales.sales_order
  ADD CONSTRAINT sales_order_edi_fk FOREIGN KEY (edi_message_id) REFERENCES regulatory.edi_message(id);

-- ---------------------------------------------------------------------
-- Calendario de obligaciones (alimenta avisos a CVBOT y al panel)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.obligation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  flow             text NOT NULL,
  title            text NOT NULL,
  period_start     date,
  period_end       date,
  due_date         date NOT NULL,
  legal_basis      text NOT NULL,                                          -- norma y artículo (ver 04-regulatorio)
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','not_applicable')),
  submission_id    uuid REFERENCES regulatory.submission(id),
  owner_user_id    uuid REFERENCES core.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, flow, title, due_date)
);

-- ---------------------------------------------------------------------
-- Cuadres (SISV ↔ SILICIE, físico ↔ fiscal, WineCore ↔ AEAT)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.reconciliation_run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('sisv_vs_silicie','physical_vs_fiscal','winecore_vs_aeat','winecore_vs_sisv')),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  run_at           timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL CHECK (status IN ('balanced','differences','failed')),
  summary          jsonb NOT NULL,
  run_by           text NOT NULL
);

CREATE TABLE regulatory.reconciliation_diff (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES regulatory.reconciliation_run(id),
  dimension        jsonb NOT NULL,                                         -- producto, lote, recipiente, fecha…
  left_value_ml    bigint,
  right_value_ml   bigint,
  difference_ml    bigint NOT NULL,
  explanation      text,                                                   -- p. ej. "albarán X sin facturar"
  documents        jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution       text CHECK (resolution IN ('explained','regularized','pending')),
  resolved_by      text,
  resolved_at      timestamptz
);

CREATE TRIGGER runner_audit AFTER INSERT OR UPDATE ON regulatory.runner FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER connector_audit AFTER INSERT OR UPDATE ON regulatory.connector FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER submission_audit AFTER INSERT OR UPDATE ON regulatory.submission FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER submission_item_audit AFTER INSERT OR UPDATE ON regulatory.submission_item FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER connector_run_audit AFTER INSERT OR UPDATE ON regulatory.connector_run FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER verifactu_installation_audit AFTER INSERT OR UPDATE ON regulatory.verifactu_installation FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER verifactu_record_audit AFTER INSERT OR UPDATE ON regulatory.verifactu_record FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER silicie_exercise_audit AFTER INSERT OR UPDATE ON regulatory.silicie_exercise FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER silicie_entry_audit AFTER INSERT OR UPDATE ON regulatory.silicie_entry FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER sisv_entry_audit AFTER INSERT OR UPDATE ON regulatory.sisv_entry FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER emcs_document_audit AFTER INSERT OR UPDATE ON regulatory.emcs_document FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER emcs_item_audit AFTER INSERT OR UPDATE OR DELETE ON regulatory.emcs_item FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER edi_message_audit AFTER INSERT OR UPDATE ON regulatory.edi_message FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER obligation_audit AFTER INSERT OR UPDATE ON regulatory.obligation FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER reconciliation_run_audit AFTER INSERT ON regulatory.reconciliation_run FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER reconciliation_diff_audit AFTER INSERT OR UPDATE ON regulatory.reconciliation_diff FOR EACH ROW EXECUTE FUNCTION audit.capture();
