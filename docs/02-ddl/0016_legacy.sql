-- =====================================================================
-- WineCore · Migración 0016 · histórico importado (legacy) — M1 (contactos/productos) y M7 (resto)
-- Archivo de solo lectura de Holded (CVPO y P.O), Shopify, PDF y contabilidad histórica (D7),
-- más las partidas abiertas (cobros/pagos pendientes) al corte.
-- Especificación: docs/06-migracion.md. Contiene datos personales: mismo nivel de protección que party.*
-- Las facturas de Holded NO son facturas de WineCore: no generan registros Verifactu ni usan sus series.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS legacy;

CREATE TABLE legacy.import_batch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL CHECK (source IN ('holded','shopify','accounting_d7','pdf')),
  entity_id     uuid REFERENCES core.legal_entity(id),
  dataset       text NOT NULL,                                  -- p. ej. 'contacts','sales_invoices','sales_invoice_lines'
  file_name     text NOT NULL,
  file_sha256   char(64) NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('dry_run','load')),
  rows_read     integer NOT NULL DEFAULT 0,
  rows_loaded   integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  report        jsonb NOT NULL DEFAULT '{}'::jsonb,              -- calidad: rechazos con motivo, avisos, totales por año
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  run_by        text NOT NULL
);
CREATE UNIQUE INDEX import_batch_file_uq ON legacy.import_batch(source, dataset, file_sha256) WHERE mode = 'load';

-- Facturas emitidas y recibidas de Holded (cabecera)
CREATE TABLE legacy.holded_invoice (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id           uuid NOT NULL REFERENCES core.legal_entity(id),
  kind                text NOT NULL CHECK (kind IN ('sale','purchase')),
  number              text NOT NULL,
  internal_number     text,
  issue_date          date NOT NULL,
  operation_date      date,
  accounting_date     date,
  due_date            date,
  counterparty_name   text NOT NULL,
  counterparty_contact_id uuid REFERENCES party.contact(id),
  description         text,
  tags                text,
  account_label       text,
  payment_method      text,
  subtotal            numeric(14,2) NOT NULL,
  vat                 numeric(14,2) NOT NULL DEFAULT 0,
  vat_2               numeric(14,2),
  withholding         numeric(14,2) NOT NULL DEFAULT 0,
  surcharge           numeric(14,2) NOT NULL DEFAULT 0,
  total               numeric(14,2) NOT NULL,
  paid                numeric(14,2),
  pending             numeric(14,2),
  status_holded       text NOT NULL,                             -- Pagado, Vencido, Anulado, Pendiente, Cobrado
  paid_on             date,
  face_status         text,
  number_anomaly      text CHECK (number_anomaly IN ('suffix','year_mismatch','gap_before','duplicate')),
  raw                 jsonb NOT NULL,
  UNIQUE (entity_id, kind, number, issue_date)
);
CREATE INDEX holded_invoice_cp_idx ON legacy.holded_invoice(counterparty_contact_id);

CREATE TABLE legacy.holded_invoice_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id          uuid NOT NULL REFERENCES core.legal_entity(id),
  kind               text NOT NULL CHECK (kind IN ('sale','purchase','delivery_note','quote')),
  document_number    text NOT NULL,
  document_date      date NOT NULL,
  due_date           date,
  line_seq           integer NOT NULL CHECK (line_seq > 0),          -- orden en el fichero dentro del documento
  description        text,
  is_draft           boolean NOT NULL DEFAULT false,
  counterparty_name  text,
  counterparty_tax_id text,
  postal_code        text,
  city               text,
  country            text,
  sku                text,
  item               text,
  tags               text,
  account_label      text,
  units              numeric(14,3),
  subtotal           numeric(14,2),
  tax_rate_label     text,
  tax_amount         numeric(14,2),
  total              numeric(14,2),
  matched_product_id uuid REFERENCES catalog.product(id),
  raw                jsonb NOT NULL,
  UNIQUE (entity_id, kind, document_number, document_date, line_seq)
);

CREATE TABLE legacy.holded_delivery_note (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id         uuid NOT NULL REFERENCES core.legal_entity(id),
  number            text NOT NULL,
  issue_date        date NOT NULL,
  destination       text,
  shipping          text,
  tags              text,
  description       text,
  channel_label     text,
  warehouse_label   text,
  payment_method    text,
  units             numeric(14,3),
  vat               numeric(14,2),
  withholding       numeric(14,2),
  surcharge         numeric(14,2),
  subtotal          numeric(14,2),
  total             numeric(14,2),
  invoiced_amount   numeric(14,2),
  invoiced_status   text NOT NULL,                               -- Pendiente, Facturado, Parcialmente
  review_decision   text CHECK (review_decision IN ('still_open','closed','ignore')),  -- decisión de Pedro en la migración
  review_note       text,
  raw               jsonb NOT NULL,
  UNIQUE (entity_id, number, issue_date)
);

CREATE TABLE legacy.holded_product (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id          uuid NOT NULL REFERENCES core.legal_entity(id),
  name               text NOT NULL,
  description        text,
  sku                text,
  warehouse_label    text,
  stock              numeric(14,3),
  cost               numeric(14,6),
  sale_value         numeric(14,6),
  tax_label          text,
  matched_product_id uuid REFERENCES catalog.product(id),
  raw                jsonb NOT NULL
);

CREATE TABLE legacy.holded_trial_balance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  year          smallint NOT NULL,
  account_code  text NOT NULL,
  account_name  text,
  group_label   text,
  subgroup_1    text,
  subgroup_2    text,
  subgroup_3    text,
  debit         numeric(14,2) NOT NULL,
  credit        numeric(14,2) NOT NULL,
  balance       numeric(14,2) NOT NULL,
  UNIQUE (entity_id, year, account_code)
);

CREATE TABLE legacy.holded_pnl_line (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id   uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  year       smallint NOT NULL,
  line_no    smallint NOT NULL,
  concept    text NOT NULL,
  amount     numeric(14,2),
  UNIQUE (entity_id, year, line_no)
);

-- Shopify (histórico de pedidos web; las facturas se hacían en Holded)
CREATE TABLE legacy.shopify_order (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES legacy.import_batch(id),
  order_name        text NOT NULL UNIQUE,                        -- '#1001'
  shopify_id        text,
  created_at_shop   timestamptz NOT NULL,
  financial_status  text,
  fulfillment_status text,
  source            text,                                        -- web / pos
  currency          char(3),
  subtotal          numeric(14,2),
  shipping          numeric(14,2),
  taxes             numeric(14,2),
  discount_amount   numeric(14,2),
  total             numeric(14,2),
  refunded_amount   numeric(14,2),
  payment_method    text,
  shipping_country  char(2),
  customer_contact_id uuid REFERENCES party.contact(id),
  raw               jsonb NOT NULL                               -- sin datos de tarjeta (no vienen en el export)
);

CREATE TABLE legacy.shopify_order_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES legacy.shopify_order(id),
  line_seq       integer NOT NULL,
  name           text NOT NULL,
  quantity       numeric(14,3) NOT NULL,
  price          numeric(14,2) NOT NULL,
  matched_product_id uuid REFERENCES catalog.product(id),
  UNIQUE (order_id, line_seq)
);

-- Partidas abiertas al corte (cobros y pagos pendientes de Holded): se cobran/pagan desde WineCore
CREATE TABLE legacy.open_item (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id              uuid NOT NULL REFERENCES core.legal_entity(id),
  direction              text NOT NULL CHECK (direction IN ('receivable','payable')),
  holded_invoice_id      uuid NOT NULL UNIQUE REFERENCES legacy.holded_invoice(id),
  counterparty_contact_id uuid REFERENCES party.contact(id),
  document_number        text NOT NULL,
  document_date          date NOT NULL,
  due_date               date,
  amount                 numeric(14,2) NOT NULL CHECK (amount > 0),   -- pendiente al corte
  amount_paid            numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_paid','paid','written_off')),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Contabilidad histórica (D7): formato de entrada esperado del diario (06-migracion.md §8)
CREATE TABLE legacy.accounting_journal_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  year          smallint NOT NULL,
  entry_no      integer NOT NULL,
  line_no       smallint NOT NULL,
  entry_date    date NOT NULL,
  account_code  text NOT NULL CHECK (account_code ~ '^[0-9]{3,10}$'),
  account_name  text,
  concept       text,
  debit         numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  document_ref  text,
  UNIQUE (entity_id, year, entry_no, line_no)
);

-- PDF de facturas y su vinculación con el histórico
CREATE TABLE legacy.document_file (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid NOT NULL REFERENCES legacy.import_batch(id),
  entity_id       uuid REFERENCES core.legal_entity(id),
  attachment_id   uuid NOT NULL REFERENCES core.attachment(id),
  original_path   text NOT NULL,                                 -- ruta dentro del zip de Holded
  parsed_number   text,
  parsed_kind     text CHECK (parsed_kind IN ('sale','purchase','delivery_note','quote','unknown')),
  matched_table   text,
  matched_id      uuid,
  match_rule      text,
  status          text NOT NULL CHECK (status IN ('matched','unmatched','ambiguous')),
  UNIQUE (attachment_id)
);

-- Solo lectura tras la carga: la app no inserta ni modifica (salvo el cobro de partidas abiertas)
CREATE FUNCTION legacy.read_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF core.ctx('actor_type') IS DISTINCT FROM 'migration' THEN
    RAISE EXCEPTION 'WC140: el histórico importado es de solo lectura';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holded_invoice','holded_invoice_line','holded_delivery_note','holded_product',
                           'holded_trial_balance','holded_pnl_line','shopify_order','shopify_order_line',
                           'accounting_journal_line','document_file'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON legacy.%I FOR EACH ROW EXECUTE FUNCTION legacy.read_only()', t || '_ro', t);
  END LOOP;
END $$;
-- Excepción controlada: la decisión de revisión de albaranes la registra una persona
CREATE OR REPLACE FUNCTION legacy.delivery_note_review_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF core.ctx('actor_type') = 'migration' THEN RETURN NEW; END IF;
  IF TG_OP <> 'UPDATE' OR (to_jsonb(NEW) - ARRAY['review_decision','review_note']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['review_decision','review_note']) THEN
    RAISE EXCEPTION 'WC140: del histórico de albaranes solo se registra la decisión de revisión';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER holded_delivery_note_review BEFORE INSERT OR UPDATE OR DELETE ON legacy.holded_delivery_note
  FOR EACH ROW EXECUTE FUNCTION legacy.delivery_note_review_only();

CREATE TRIGGER open_item_no_delete BEFORE DELETE ON legacy.open_item FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();
CREATE TRIGGER import_batch_audit AFTER INSERT OR UPDATE ON legacy.import_batch FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER open_item_audit AFTER INSERT OR UPDATE ON legacy.open_item FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER holded_delivery_note_audit AFTER UPDATE ON legacy.holded_delivery_note FOR EACH ROW EXECUTE FUNCTION audit.capture();

-- Cobros de partidas abiertas desde finanzas
ALTER TABLE finance.payment_allocation DROP CONSTRAINT payment_allocation_target_table_check;
ALTER TABLE finance.payment_allocation ADD CONSTRAINT payment_allocation_target_table_check
  CHECK (target_table IN ('billing.invoice','purchasing.supplier_invoice','legacy.open_item'));

CREATE OR REPLACE FUNCTION finance.refresh_document_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_paid numeric(14,2); v_total numeric(14,2); v_alloc_sum numeric(14,2); v_payment numeric(14,2);
BEGIN
  SELECT coalesce(sum(a.amount),0) INTO v_alloc_sum FROM finance.payment_allocation a WHERE a.payment_id = NEW.payment_id;
  SELECT amount INTO v_payment FROM finance.payment WHERE id = NEW.payment_id;
  IF v_alloc_sum > v_payment THEN
    RAISE EXCEPTION 'WC100: se imputan % € de un pago de % €', v_alloc_sum, v_payment;
  END IF;
  SELECT coalesce(sum(a.amount),0) INTO v_paid
    FROM finance.payment_allocation a JOIN finance.payment p ON p.id = a.payment_id AND p.status = 'registered'
   WHERE a.target_table = NEW.target_table AND a.target_id = NEW.target_id;
  IF NEW.target_table = 'billing.invoice' THEN
    SELECT total INTO v_total FROM billing.invoice WHERE id = NEW.target_id AND status = 'issued';
    IF v_total IS NULL THEN RAISE EXCEPTION 'WC101: solo se cobran facturas emitidas'; END IF;
    IF v_paid > v_total THEN RAISE EXCEPTION 'WC100: cobro (%) superior al total (%)', v_paid, v_total; END IF;
    UPDATE billing.invoice SET amount_paid = v_paid,
           payment_status = CASE WHEN v_paid = 0 THEN 'unpaid' WHEN v_paid < v_total THEN 'partially_paid' ELSE 'paid' END
     WHERE id = NEW.target_id;
  ELSIF NEW.target_table = 'purchasing.supplier_invoice' THEN
    SELECT total INTO v_total FROM purchasing.supplier_invoice WHERE id = NEW.target_id AND status = 'approved';
    IF v_total IS NULL THEN RAISE EXCEPTION 'WC101: solo se pagan facturas recibidas aprobadas'; END IF;
    IF v_paid > v_total THEN RAISE EXCEPTION 'WC100: pago (%) superior al total (%)', v_paid, v_total; END IF;
    UPDATE purchasing.supplier_invoice SET amount_paid = v_paid,
           payment_status = CASE WHEN v_paid = 0 THEN 'unpaid' WHEN v_paid < v_total THEN 'partially_paid' ELSE 'paid' END
     WHERE id = NEW.target_id;
  ELSE
    SELECT amount INTO v_total FROM legacy.open_item WHERE id = NEW.target_id AND status IN ('open','partially_paid');
    IF v_total IS NULL THEN RAISE EXCEPTION 'WC101: la partida abierta no admite más cobros/pagos'; END IF;
    IF v_paid > v_total THEN RAISE EXCEPTION 'WC100: importe (%) superior al pendiente (%)', v_paid, v_total; END IF;
    UPDATE legacy.open_item SET amount_paid = v_paid,
           status = CASE WHEN v_paid = 0 THEN 'open' WHEN v_paid < v_total THEN 'partially_paid' ELSE 'paid' END
     WHERE id = NEW.target_id;
  END IF;
  RETURN NULL;
END $$;
