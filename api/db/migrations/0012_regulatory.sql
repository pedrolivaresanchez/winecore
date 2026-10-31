-- WineCore · 0012_regulatory · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0012_regulatory.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

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
CREATE TABLE regulatory.runner (id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9-]{2,40}$'),
  -- 'timbal-api', 'local-bodega-mac'
  kind           VARCHAR NOT NULL CHECK (kind IN ('timbal','local','provider')),
  description    VARCHAR NOT NULL,
  api_client_id  uuid,
  -- credencial con la que reclama trabajos
  capabilities   VARCHAR[] NOT NULL DEFAULT [],
  -- p. ej. {'aeat_certificate','sisv','aecocedi'}
  last_seen_at   TIMESTAMPTZ,
  status         VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE regulatory.connector (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow             VARCHAR NOT NULL CHECK (flow IN ('verifactu','silicie','sisv','emcs','edi','organic','aeat_model')),
  legal_entity_id  uuid NOT NULL,
  mode             VARCHAR NOT NULL CHECK (mode IN ('api','computer_use','file_upload','manual')),
  environment      VARCHAR NOT NULL CHECK (environment IN ('test','production')),
  runner_id        uuid REFERENCES regulatory.runner(id),
  config           JSON NOT NULL DEFAULT '{}'::JSON,
  -- endpoints, URLs de portal, ids de procedimiento (nunca secretos)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- Envío regulatorio genérico (estado: docs/03-maquinas-estado.md §11)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.submission (id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow                  VARCHAR NOT NULL CHECK (flow IN ('verifactu','silicie','sisv','emcs','edi','organic','aeat_model')),
  legal_entity_id       uuid NOT NULL,
  connector_id          uuid REFERENCES regulatory.connector(id),
  kind                  VARCHAR NOT NULL,
  -- p. ej. 'silicie.asientos', 'sisv.libro_envasado', 'emcs.ie815', 'edi.invoic'
  period_start          date,
  period_end            date,
  status                VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN (
                          'draft','validated','pending_approval','approved','submitting','submitted',
                          'accepted','accepted_with_errors','rejected','failed','cancelled','rectified')),
  payload               JSON NOT NULL,
  -- datos canónicos (el "qué"): lo que se envía, independiente del conector
  payload_sha256        VARCHAR NOT NULL,
  rendered_attachment_id uuid,
  -- fichero/XML/ficha generada a partir del payload
  validation_errors     JSON NOT NULL DEFAULT '[]'::JSON,
  approval_request_id   uuid,
  external_ref          VARCHAR,
  -- nº de asiento, ARC, CSV de la AEAT, nº de registro SISV…
  response_summary      JSON,
  rectifies_submission_id uuid REFERENCES regulatory.submission(id),
  due_date              date,
  created_by            VARCHAR NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved','submitting','submitted','accepted','accepted_with_errors') OR approval_request_id IS NOT NULL OR flow = 'verifactu'),
  CHECK (status NOT IN ('validated','pending_approval','approved','submitting','submitted','accepted','accepted_with_errors')
         OR json_array_length(validation_errors) = 0)
);

CREATE INDEX submission_status_idx ON regulatory.submission(flow, status);


-- El contenido no cambia una vez pedida la aprobación (WC120)

CREATE TABLE regulatory.submission_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES regulatory.submission(id),
  item_table     VARCHAR NOT NULL CHECK (item_table ~ '^[a-z_]+\.[a-z_]+$'),   -- 'regulatory.silicie_entry', 'regulatory.sisv_entry', …
  item_id        uuid NOT NULL,
  result         VARCHAR CHECK (result IN ('accepted','rejected','warning')),
  result_detail  JSON,
  UNIQUE (submission_id, item_table, item_id)
);


-- Cada intento de un conector (cola para el ejecutor; lease para que nunca haya dos a la vez)
CREATE TABLE regulatory.connector_run (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id      uuid NOT NULL REFERENCES regulatory.submission(id),
  attempt            smallint NOT NULL CHECK (attempt BETWEEN 1 AND 10),
  action             VARCHAR NOT NULL CHECK (action IN ('submit','check_status','fetch_receipt','read_inbox','cancel')),
  status             VARCHAR NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','running','succeeded','failed','needs_human','expired')),
  runner_id          uuid REFERENCES regulatory.runner(id),
  claimed_at         TIMESTAMPTZ,
  lease_until        TIMESTAMPTZ,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  outcome            JSON,                                  -- resultado estructurado (nº registro, CSV, ARC, errores del portal)
  error              VARCHAR,
  trace_ref          VARCHAR,                                   -- id de traza de Timbal o del ejecutor local
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, action, attempt)
);


-- ---------------------------------------------------------------------
-- Verifactu (docs/04-regulatorio/verifactu.md)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.verifactu_installation (id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id       uuid NOT NULL,
  environment           VARCHAR NOT NULL CHECK (environment IN ('test','production')),
  mode                  VARCHAR NOT NULL CHECK (mode IN ('verifactu','no_verifactu')),
  system_name           VARCHAR NOT NULL DEFAULT 'WineCore',
  -- NombreSistemaInformatico
  system_id             VARCHAR NOT NULL DEFAULT 'WC',
  -- IdSistemaInformatico
  system_version        VARCHAR NOT NULL,
  -- Version (semver del despliegue)
  installation_number   VARCHAR NOT NULL,
  -- NumeroInstalacion
  producer_name         VARCHAR NOT NULL,
  -- productor del SIF (Q-007)
  producer_tax_id       VARCHAR NOT NULL,
  only_verifactu        boolean NOT NULL DEFAULT true,
  -- TipoUsoPosibleSoloVerifactu
  multi_taxpayer        boolean NOT NULL DEFAULT true,
  -- TipoUsoPosibleMultiOT (P.O y CVPO en el mismo sistema)
  multiple_taxpayers    boolean NOT NULL DEFAULT true,
  -- IndicadorMultiplesOT
  starts_on             date NOT NULL,
  -- CVPO 2027-01-01; P.O 2027-07-01 (o antes, voluntario)
  next_send_not_before  TIMESTAMPTZ,
  -- control de flujo (TiempoEsperaEnvio de la AEAT)
  is_active             boolean NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, environment)
);


CREATE TABLE regulatory.verifactu_record (id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id        uuid NOT NULL REFERENCES regulatory.verifactu_installation(id),
  legal_entity_id        uuid NOT NULL,
  chain_seq              bigint NOT NULL CHECK (chain_seq >= 1),
  -- orden en la cadena de la instalación
  record_type            VARCHAR NOT NULL CHECK (record_type IN ('alta','anulacion')),
  invoice_id             uuid NOT NULL,
  issuer_tax_id          VARCHAR NOT NULL,
  -- IDEmisorFactura
  invoice_number         VARCHAR NOT NULL,
  -- NumSerieFactura
  invoice_issue_date     date NOT NULL,
  -- FechaExpedicionFactura
  invoice_type           VARCHAR,
  -- TipoFactura (alta)
  total_tax              DECIMAL(14,2),
  -- CuotaTotal (alta)
  total_amount           DECIMAL(14,2),
  -- ImporteTotal (alta)
  is_correction          boolean NOT NULL DEFAULT false,
  -- Subsanacion
  rejected_previous      VARCHAR CHECK (rejected_previous IN ('N','S','X')),
  -- RechazoPrevio
  previous_record_id     uuid REFERENCES regulatory.verifactu_record(id),
  previous_hash          VARCHAR,
  -- Huella del registro anterior (NULL si PrimerRegistro)
  generated_at           TIMESTAMPTZ NOT NULL,
  -- FechaHoraHusoGenRegistro
  hash_type              VARCHAR NOT NULL DEFAULT '01',
  -- TipoHuella 01 = SHA-256
  hash                   VARCHAR NOT NULL CHECK (hash ~ '^[0-9A-F]{64}$'),
  record_xml             VARCHAR NOT NULL,
  -- XML canónico del registro (evidencia)
  qr_url                 VARCHAR,
  -- URL de cotejo (alta)
  signature_xml          VARCHAR,
  -- solo NO VERI*FACTU (firma XAdES)
  send_status            VARCHAR NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending','sending','accepted','accepted_with_errors','rejected','not_required')),
  aeat_csv               VARCHAR,
  aeat_error_code        VARCHAR,
  aeat_error_text        VARCHAR,
  submission_id          uuid REFERENCES regulatory.submission(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (installation_id, chain_seq),
  UNIQUE (installation_id, hash),
  CHECK (record_type <> 'alta' OR (invoice_type IS NOT NULL AND total_amount IS NOT NULL AND total_tax IS NOT NULL))
);


-- La cadena solo crece por el final y los registros no se modifican salvo su estado de envío (WC130)

-- Registro de eventos del SIF (obligatorio en NO VERI*FACTU; se mantiene también en VERI*FACTU como evidencia)
CREATE TABLE regulatory.verifactu_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id  uuid NOT NULL REFERENCES regulatory.verifactu_installation(id),
  event_type       VARCHAR NOT NULL,                               -- códigos de la especificación (inicio, fin, detección de anomalías, exportación…)
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  details          JSON NOT NULL DEFAULT '{}'::JSON,
  previous_hash    VARCHAR,
  hash             VARCHAR NOT NULL
);


-- ---------------------------------------------------------------------
-- SILICIE (docs/04-regulatorio/silicie.md): ejercicios y asientos por establecimiento (CAE)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.silicie_exercise (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_warehouse_id uuid NOT NULL,
  year             smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  status           VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  UNIQUE (tax_warehouse_id, year)
);


CREATE TABLE regulatory.silicie_entry (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id         uuid NOT NULL REFERENCES regulatory.silicie_exercise(id),
  tax_warehouse_id    uuid NOT NULL,
  local_seq           integer NOT NULL CHECK (local_seq >= 1),
  -- correlativo interno por ejercicio
  movement_date       date NOT NULL,
  -- fecha del movimiento (fecha fiscal)
  entry_kind          VARCHAR NOT NULL,
  -- tipo de asiento/movimiento (lista en silicie.md)
  fields              JSON NOT NULL,
  -- campo a campo según el formato oficial (validado con el esquema de silicie.md)
  status              VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_submission','accepted','rejected','annulled')),
  aeat_entry_number   VARCHAR,
  -- nº de asiento asignado por la AEAT
  annuls_entry_id     uuid REFERENCES regulatory.silicie_entry(id),
  -- asiento de anulación
  submission_id       uuid REFERENCES regulatory.submission(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exercise_id, local_seq)
);

CREATE INDEX silicie_entry_status_idx ON regulatory.silicie_entry(status, movement_date);


-- Mayores contables de SILICIE 2.0: identificación estable de cada producto o materia prima
-- (Orden HAC/998/2019, anexo, campos 9.1–9.8 y 10.1–10.2; docs/04-regulatorio/silicie.md §6)
CREATE TABLE regulatory.silicie_ledger (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_warehouse_id     uuid NOT NULL,
  reference            VARCHAR NOT NULL CHECK (reference ~ '^[A-Z0-9_-]{2,20}$'),              -- 9.8 Referencia
  description          VARCHAR NOT NULL CHECK (length(description) BETWEEN 3 AND 100),           -- 9.7 Descripción (agrupa existencias en 2.0)
  product_class        VARCHAR NOT NULL CHECK (product_class IN ('raw_grape','raw_must','bulk','bulk_wood','packaged','byproduct')),
  epigrafe             VARCHAR,                                                                  -- 9.1 (vino tranquilo: '1')
  epigrafe_code        VARCHAR,                                                                  -- 9.2 (vino tranquilo: 'V0')
  nc_code              VARCHAR NOT NULL CHECK (nc_code ~ '^[0-9]{4}([0-9]{2}){0,2}$'),            -- 9.3 (mínimo 4 dígitos en 2.0)
  product_key          VARCHAR,                                                                  -- 9.4 Clave ('V01' uva, 'V02' mosto)
  container_type       VARCHAR,                                                                  -- 10.1 Tipo de envase ('VF03'…)
  container_capacity_l DECIMAL(7,3),                                                          -- 10.2 Capacidad del envase
  is_active            boolean NOT NULL DEFAULT true,
  validated_by         VARCHAR,                                                                  -- revisión del asesor
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tax_warehouse_id, reference),
  UNIQUE (tax_warehouse_id, description),
  UNIQUE (tax_warehouse_id, reference, product_class),
  CHECK (product_class NOT IN ('bulk','bulk_wood','packaged') OR (epigrafe IS NOT NULL AND epigrafe_code IS NOT NULL)),
  CHECK (product_class <> 'packaged' OR (container_type IS NOT NULL AND container_capacity_l IS NOT NULL))
);

-- La identificación de un mayor no se cambia: se crea otro y se pasa el saldo con A17/A16

-- Cada movimiento fiscal apunta a un mayor existente y de su misma clase

-- ---------------------------------------------------------------------
-- SISV (docs/04-regulatorio/sisv.md): anotaciones por libro, derivadas de operaciones y documentos
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.sisv_entry (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL,
  -- Libros del "modelo de intercambio" v02 de la Junta (sisv.md §4)
  book             VARCHAR NOT NULL CHECK (book IN ('VINO','IGP','DOP','VARIETAL','ELABORA','PRACTICA','PROCPRACT','ENVASADO','ENTSALENV')),
  installation_ria VARCHAR NOT NULL CHECK (installation_ria ~ '^[0-9]{2}/[0-9]{5}$'),
  -- matrícula RIA (provincia/registro)
  direction        VARCHAR CHECK (direction IN ('E','S')),
  -- entrada/salida (libros de E/S)
  entry_date       date NOT NULL,
  operation        VARCHAR NOT NULL,
  -- tipo de anotación según sisv.md
  fields           JSON NOT NULL,
  source_table     VARCHAR NOT NULL,
  source_id        uuid NOT NULL,
  status           VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_submission','recorded','signed','rejected','annulled')),
  sisv_ref         VARCHAR,
  -- referencia de la anotación en SISV
  annuls_entry_id  uuid REFERENCES regulatory.sisv_entry(id),
  submission_id    uuid REFERENCES regulatory.submission(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((book IN ('ELABORA','PRACTICA')) = (direction IS NULL))
);

CREATE INDEX sisv_entry_status_idx ON regulatory.sisv_entry(book, status, entry_date);


-- ---------------------------------------------------------------------
-- EMCS: documento administrativo electrónico (e-DA) y sus mensajes
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.emcs_document (id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL,
  tax_warehouse_id       uuid NOT NULL,
  kind                   VARCHAR NOT NULL CHECK (kind IN ('e_ad','e_sad')),
  -- suspensivo / impuesto pagado
  destination_type       VARCHAR NOT NULL,
  -- código EMCS (lista en emcs.md)
  status                 VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN (
                           'draft','validated','pending_approval','approved','submitted','accepted','in_transit',
                           'delivered','refused','partially_refused','cancelled','destination_changed','rejected')),
  lrn                    VARCHAR NOT NULL UNIQUE,
  -- número de referencia local
  arc                    VARCHAR,
  -- código de referencia administrativo (ARC)
  consignee_contact_id   uuid,
  consignee_excise_number VARCHAR,
  delivery_place         JSON,
  export_office_code     VARCHAR,
  dispatch_date          date,
  delivery_note_id       uuid,
  fields                 JSON NOT NULL,
  -- campos IE815 según emcs.md
  receipt_status         VARCHAR CHECK (receipt_status IN ('accepted','accepted_with_shortage','refused','partially_refused')),
  receipt_at             TIMESTAMPTZ,
  submission_id          uuid REFERENCES regulatory.submission(id),
  created_by             VARCHAR NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('accepted','in_transit','delivered','refused','partially_refused','destination_changed') OR arc IS NOT NULL)
);


CREATE TABLE regulatory.emcs_item (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emcs_document_id   uuid NOT NULL REFERENCES regulatory.emcs_document(id),
  item_no            smallint NOT NULL CHECK (item_no > 0),
  product_id         uuid,
  lot_id             uuid,
  excise_product_code VARCHAR NOT NULL,                                        -- p. ej. W200
  nc_code            VARCHAR NOT NULL CHECK (nc_code ~ '^[0-9]{8}$'),
  volume_ml          bigint NOT NULL CHECK (volume_ml > 0),
  abv_pct            DECIMAL(5,2) NOT NULL,
  units              integer,
  packages           JSON,
  UNIQUE (emcs_document_id, item_no)
);


-- ---------------------------------------------------------------------
-- EDI (AecocEDI): mensajes recibidos y enviados
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.edi_message (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id   uuid NOT NULL,
  partner_contact_id uuid NOT NULL,
  direction         VARCHAR NOT NULL CHECK (direction IN ('in','out')),
  message_type      VARCHAR NOT NULL CHECK (message_type IN ('ORDERS','DESADV','INVOIC','REMADV','RECADV','VARCHAR','OTHER')),
  external_id       VARCHAR,                                                  -- id en el portal / nº de documento
  document_number   VARCHAR,
  document_date     date,
  status            VARCHAR NOT NULL DEFAULT 'received' CHECK (status IN (
                      'notified','received','parsed','linked','prepared','pending_approval','approved','sent','acknowledged','error','ignored')),
  parsed            JSON,                                                 -- campos normalizados (ver aecoc-edi.md)
  raw_attachment_id uuid,                   -- captura/fichero tal cual
  sales_order_id    uuid,
  invoice_id        uuid,
  submission_id     uuid REFERENCES regulatory.submission(id),
  received_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- Calendario de obligaciones (alimenta avisos a CVBOT y al panel)
-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- Producción ecológica (docs/04-regulatorio/ecologico.md): certificados propios y de proveedores
-- Reg. (UE) 2018/848, arts. 34-35 (el operador comprueba el certificado de cada proveedor)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.organic_certificate (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_kind         VARCHAR NOT NULL CHECK (holder_kind IN ('own','supplier')),
  legal_entity_id     uuid,
  contact_id          uuid,
  control_body_code   VARCHAR NOT NULL CHECK (control_body_code ~ '^[A-Z]{2}-[A-Z]{3}-[0-9]{1,3}(-[A-Z]{2,3})?$'),  -- p. ej. ES-ECO-001-AN
  product_categories  VARCHAR[] NOT NULL CHECK (cardinality(product_categories) > 0),  -- art. 35.7: 'a' vegetales, 'f' vino…
  certificate_number  VARCHAR,
  valid_from          date NOT NULL,
  valid_to            date NOT NULL,
  attachment_id       uuid,
  verified_by         uuid,
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from),
  CHECK ((holder_kind = 'own') = (legal_entity_id IS NOT NULL)),
  CHECK ((holder_kind = 'supplier') = (contact_id IS NOT NULL))
);

CREATE INDEX organic_certificate_contact_idx ON regulatory.organic_certificate(contact_id, valid_to);


CREATE TABLE regulatory.obligation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL,
  flow             VARCHAR NOT NULL,
  title            VARCHAR NOT NULL,
  period_start     date,
  period_end       date,
  due_date         date NOT NULL,
  legal_basis      VARCHAR NOT NULL,                                          -- norma y artículo (ver 04-regulatorio)
  status           VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','not_applicable')),
  submission_id    uuid REFERENCES regulatory.submission(id),
  owner_user_id    uuid,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, flow, title, due_date)
);


-- ---------------------------------------------------------------------
-- Cuadres (SISV ↔ SILICIE, físico ↔ fiscal, WineCore ↔ AEAT)
-- ---------------------------------------------------------------------
CREATE TABLE regulatory.reconciliation_run (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             VARCHAR NOT NULL CHECK (kind IN ('sisv_vs_silicie','physical_vs_fiscal','winecore_vs_aeat','winecore_vs_sisv')),
  legal_entity_id  uuid NOT NULL,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  run_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           VARCHAR NOT NULL CHECK (status IN ('balanced','differences','failed')),
  summary          JSON NOT NULL,
  run_by           VARCHAR NOT NULL
);


CREATE TABLE regulatory.reconciliation_diff (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES regulatory.reconciliation_run(id),
  dimension        JSON NOT NULL,                                         -- producto, lote, recipiente, fecha…
  left_value_ml    bigint,
  right_value_ml   bigint,
  difference_ml    bigint NOT NULL,
  explanation      VARCHAR,                                                   -- p. ej. "albarán X sin facturar"
  documents        JSON NOT NULL DEFAULT '[]'::JSON,
  resolution       VARCHAR CHECK (resolution IN ('explained','regularized','pending')),
  resolved_by      VARCHAR,
  resolved_at      TIMESTAMPTZ
);
