-- =====================================================================
-- WineCore · Migración 0011 · finanzas (finance)
-- Cuentas bancarias, cobros y pagos con imputación parcial, extractos (Norma 43/CAMT/CSV),
-- conciliación y remesas SEPA (fichero que sube una persona al banco; WineCore no guarda claves bancarias).
-- Especificación: docs/02-modelo-dominio.md §14 · Estados: docs/03-maquinas-estado.md §6
-- =====================================================================

CREATE TABLE finance.bank_account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id    uuid NOT NULL REFERENCES core.legal_entity(id),
  bank_name          text NOT NULL,
  iban_enc           bytea NOT NULL,                       -- cifrado con WINECORE_DATA_KEY
  iban_last4         char(4) NOT NULL,
  bic                text,
  currency           char(3) NOT NULL DEFAULT 'EUR',
  accounting_account text CHECK (accounting_account ~ '^57[0-9]{1,6}$'),
  sepa_creditor_id   text,                                 -- identificador de acreedor SEPA (adeudos)
  is_default         boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_account_default_uq ON finance.bank_account(legal_entity_id) WHERE is_default AND is_active;

CREATE TABLE finance.payment (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL REFERENCES core.legal_entity(id),
  direction              text NOT NULL CHECK (direction IN ('in','out')),
  method                 text NOT NULL CHECK (method IN ('transfer','direct_debit','card','cash','stripe','compensation','other')),
  amount                 numeric(14,2) NOT NULL CHECK (amount > 0),
  currency               char(3) NOT NULL DEFAULT 'EUR',
  value_date             date NOT NULL,
  bank_account_id        uuid REFERENCES finance.bank_account(id),
  counterparty_id        uuid REFERENCES party.contact(id),
  reference              text,
  source                 text NOT NULL CHECK (source IN ('manual','bank_import','stripe','remittance','edi_remittance_advice','migration')),
  status                 text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','reversed')),
  reverses_payment_id    uuid REFERENCES finance.payment(id),
  reversal_reason        text,
  notes                  text,
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'reversed' OR reversal_reason IS NOT NULL)
);
CREATE INDEX payment_counterparty_idx ON finance.payment(counterparty_id, value_date);
CREATE TRIGGER payment_no_delete BEFORE DELETE ON finance.payment FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE finance.payment_allocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid NOT NULL REFERENCES finance.payment(id),
  target_table  text NOT NULL CHECK (target_table IN ('billing.invoice','purchasing.supplier_invoice')),
  target_id     uuid NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  allocated_by  text NOT NULL,
  allocated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, target_table, target_id)
);
CREATE INDEX payment_allocation_target_idx ON finance.payment_allocation(target_table, target_id);
CREATE TRIGGER payment_allocation_no_delete BEFORE DELETE ON finance.payment_allocation FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Recalcula el cobrado/pagado del documento y su estado (WC100 si se imputa de más)
CREATE FUNCTION finance.refresh_document_payment() RETURNS trigger LANGUAGE plpgsql AS $$
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
  ELSE
    SELECT total INTO v_total FROM purchasing.supplier_invoice WHERE id = NEW.target_id AND status = 'approved';
    IF v_total IS NULL THEN RAISE EXCEPTION 'WC101: solo se pagan facturas recibidas aprobadas'; END IF;
    IF v_paid > v_total THEN RAISE EXCEPTION 'WC100: pago (%) superior al total (%)', v_paid, v_total; END IF;
    UPDATE purchasing.supplier_invoice SET amount_paid = v_paid,
           payment_status = CASE WHEN v_paid = 0 THEN 'unpaid' WHEN v_paid < v_total THEN 'partially_paid' ELSE 'paid' END
     WHERE id = NEW.target_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER payment_allocation_refresh AFTER INSERT ON finance.payment_allocation
  FOR EACH ROW EXECUTE FUNCTION finance.refresh_document_payment();

-- ---------------------------------------------------------------------
-- Extractos bancarios y conciliación
-- ---------------------------------------------------------------------
CREATE TABLE finance.bank_statement_import (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id   uuid NOT NULL REFERENCES finance.bank_account(id),
  format            text NOT NULL CHECK (format IN ('n43','camt053','csv')),
  attachment_id     uuid NOT NULL REFERENCES core.attachment(id),
  file_sha256       char(64) NOT NULL,
  period_from       date NOT NULL,
  period_to         date NOT NULL,
  lines_count       integer NOT NULL CHECK (lines_count >= 0),
  imported_by       text NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, file_sha256)
);

CREATE TABLE finance.bank_statement_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id          uuid NOT NULL REFERENCES finance.bank_statement_import(id),
  bank_account_id    uuid NOT NULL REFERENCES finance.bank_account(id),
  booking_date       date NOT NULL,
  value_date         date,
  amount             numeric(14,2) NOT NULL CHECK (amount <> 0),       -- + abono, − cargo
  description        text NOT NULL,
  counterparty_name  text,
  reference          text,
  external_id        text NOT NULL,                                     -- hash estable de la línea (deduplicación)
  status             text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','suggested','matched','ignored')),
  suggestions        jsonb NOT NULL DEFAULT '[]'::jsonb,                -- [{payment|invoice, score, reason}]
  matched_payment_id uuid REFERENCES finance.payment(id),
  ignored_reason     text,
  UNIQUE (bank_account_id, external_id),
  CHECK (status <> 'matched' OR matched_payment_id IS NOT NULL),
  CHECK (status <> 'ignored' OR ignored_reason IS NOT NULL)
);
CREATE INDEX bank_statement_line_open_idx ON finance.bank_statement_line(status) WHERE status IN ('unmatched','suggested');

-- ---------------------------------------------------------------------
-- Remesas SEPA (pain.008 adeudos / pain.001 transferencias): fichero aprobado que una persona sube al banco
-- ---------------------------------------------------------------------
CREATE TABLE finance.remittance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  kind                text NOT NULL CHECK (kind IN ('direct_debit','credit_transfer')),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','file_generated','uploaded_by_user','settled','partially_rejected','cancelled')),
  bank_account_id     uuid NOT NULL REFERENCES finance.bank_account(id),
  execution_date      date NOT NULL,
  total               numeric(14,2) NOT NULL DEFAULT 0,
  file_attachment_id  uuid REFERENCES core.attachment(id),
  approval_request_id uuid REFERENCES ops.approval_request(id),
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.remittance_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id  uuid NOT NULL REFERENCES finance.remittance(id),
  target_table   text NOT NULL CHECK (target_table IN ('billing.invoice','purchasing.supplier_invoice')),
  target_id      uuid NOT NULL,
  counterparty_id uuid NOT NULL REFERENCES party.contact(id),
  amount         numeric(14,2) NOT NULL CHECK (amount > 0),
  mandate_ref    text,
  end_to_end_id  text NOT NULL CHECK (length(end_to_end_id) <= 35),
  status         text NOT NULL DEFAULT 'included' CHECK (status IN ('included','settled','rejected','returned')),
  reject_reason  text,
  UNIQUE (remittance_id, target_table, target_id)
);

CREATE TRIGGER bank_account_audit AFTER INSERT OR UPDATE ON finance.bank_account FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER payment_audit AFTER INSERT OR UPDATE ON finance.payment FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER payment_allocation_audit AFTER INSERT ON finance.payment_allocation FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER bank_statement_import_audit AFTER INSERT ON finance.bank_statement_import FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER bank_statement_line_audit AFTER INSERT OR UPDATE ON finance.bank_statement_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER remittance_audit AFTER INSERT OR UPDATE ON finance.remittance FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER remittance_item_audit AFTER INSERT OR UPDATE ON finance.remittance_item FOR EACH ROW EXECUTE FUNCTION audit.capture();
