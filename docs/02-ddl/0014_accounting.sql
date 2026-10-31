-- =====================================================================
-- WineCore · Migración 0014 · contabilidad (accounting) — hito M7 (Q-022)
-- Plan de cuentas PGC por entidad, ejercicios, asientos por partida doble generados
-- desde documentos con reglas de contabilización, y saldos de apertura del asesor (R6).
-- Especificación: docs/02-modelo-dominio.md §16
-- =====================================================================

CREATE TABLE accounting.fiscal_year (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  year             smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  closed_by        uuid REFERENCES core.app_user(id),
  closed_at        timestamptz,
  UNIQUE (legal_entity_id, year),
  CHECK (ends_on > starts_on)
);

CREATE TABLE accounting.account (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  code             text NOT NULL CHECK (code ~ '^[1-9][0-9]{2,9}$'),
  name             text NOT NULL,
  pgc_group        smallint NOT NULL CHECK (pgc_group BETWEEN 1 AND 9),
  is_postable      boolean NOT NULL DEFAULT true,                       -- solo subcuentas de detalle
  contact_id       uuid REFERENCES party.contact(id),                    -- 430/400 por tercero
  is_active        boolean NOT NULL DEFAULT true,
  UNIQUE (legal_entity_id, code)
);

CREATE TABLE accounting.journal_entry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  fiscal_year_id   uuid NOT NULL REFERENCES accounting.fiscal_year(id),
  entry_no         integer NOT NULL CHECK (entry_no > 0),
  entry_date       date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('opening','regular','adjustment','closing','reversal')),
  source_table     text,
  source_id        uuid,
  description      text NOT NULL,
  posted_by        text NOT NULL,
  posted_at        timestamptz NOT NULL DEFAULT now(),
  reverses_entry_id uuid REFERENCES accounting.journal_entry(id),
  UNIQUE (legal_entity_id, fiscal_year_id, entry_no),
  CHECK ((kind = 'reversal') = (reverses_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX journal_entry_source_uq ON accounting.journal_entry(source_table, source_id, kind)
  WHERE source_id IS NOT NULL AND kind <> 'reversal';

CREATE TABLE accounting.journal_line (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES accounting.journal_entry(id),
  line_no     smallint NOT NULL CHECK (line_no > 0),
  account_id  uuid NOT NULL REFERENCES accounting.account(id),
  debit       numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  UNIQUE (entry_id, line_no),
  CHECK ((debit = 0) <> (credit = 0))
);

-- Un asiento cuadra (Debe = Haber) al cerrar la transacción (WC110) y nunca se modifica
CREATE FUNCTION accounting.check_entry_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0) INTO d, c FROM accounting.journal_line WHERE entry_id = NEW.id;
  IF d <> c OR d = 0 THEN
    RAISE EXCEPTION 'WC110: el asiento % no cuadra (Debe %, Haber %)', NEW.entry_no, d, c;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_entry_balance AFTER INSERT ON accounting.journal_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.check_entry_balance();

CREATE FUNCTION accounting.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'WC111: los asientos no se modifican ni se borran; se anulan con un asiento de anulación';
END $$;
CREATE TRIGGER journal_entry_immutable BEFORE UPDATE OR DELETE ON accounting.journal_entry FOR EACH ROW EXECUTE FUNCTION accounting.immutable();
CREATE TRIGGER journal_line_immutable BEFORE UPDATE OR DELETE ON accounting.journal_line FOR EACH ROW EXECUTE FUNCTION accounting.immutable();

-- Reglas de contabilización por tipo de documento (plantillas)
CREATE TABLE accounting.posting_rule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  document_kind   text NOT NULL CHECK (document_kind IN ('sales_invoice','sales_credit_note','supplier_invoice','payment_in','payment_out','intercompany_invoice')),
  template        jsonb NOT NULL,                                    -- líneas: cuenta | origen del importe | signo
  valid_from      date NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, document_kind, valid_from)
);

CREATE TRIGGER fiscal_year_audit AFTER INSERT OR UPDATE ON accounting.fiscal_year FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER account_audit AFTER INSERT OR UPDATE ON accounting.account FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER journal_entry_audit AFTER INSERT ON accounting.journal_entry FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER journal_line_audit AFTER INSERT ON accounting.journal_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER posting_rule_audit AFTER INSERT OR UPDATE ON accounting.posting_rule FOR EACH ROW EXECUTE FUNCTION audit.capture();
