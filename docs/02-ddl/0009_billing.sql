-- =====================================================================
-- WineCore · Migración 0009 · facturación (billing)
-- Códigos de impuesto (mapeados a Verifactu), motor de reglas de entidad facturadora (D3),
-- facturas (completas, simplificadas y rectificativas), desglose, vencimientos e intercompañía (D4).
-- Especificación: docs/02-modelo-dominio.md §12 · Verifactu: docs/04-regulatorio/verifactu.md
-- Estados: docs/03-maquinas-estado.md §5
-- =====================================================================

-- ---------------------------------------------------------------------
-- Códigos de impuesto. Valores de las listas oficiales de Verifactu:
--   impuesto: 01 IVA · 02 IPSI · 03 IGIC · 05 otros
--   clave_regimen (IVA): 01 general · 02 exportación · 11 arrendamiento de local de negocio · 18 recargo de equivalencia …
--   calificacion: S1 sujeta no exenta · S2 sujeta con inversión del sujeto pasivo · N1 no sujeta (art. 7, 14, otros) · N2 no sujeta por localización
--   exencion: E1 art. 20 · E2 art. 21 (exportación) · E3 art. 22 · E4 arts. 23-24 · E5 art. 25 (entrega intracomunitaria) · E6 otros
-- ---------------------------------------------------------------------
CREATE TABLE billing.tax_code (
  code             text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  name_es          text NOT NULL,
  tax              char(2) NOT NULL CHECK (tax IN ('01','02','03','05')),
  regime_key       char(2) NOT NULL CHECK (regime_key ~ '^[0-9]{2}$'),
  qualification    char(2) CHECK (qualification IN ('S1','S2','N1','N2')),
  exemption        char(2) CHECK (exemption IN ('E1','E2','E3','E4','E5','E6')),
  rate             numeric(5,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  surcharge_rate   numeric(5,2) NOT NULL DEFAULT 0 CHECK (surcharge_rate >= 0),
  withholding_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (withholding_rate >= 0),    -- IRPF (no forma parte del desglose Verifactu)
  legal_mention_es text,
  legal_mention_en text,
  requires_vat_id  boolean NOT NULL DEFAULT false,      -- entrega intracomunitaria: NIF-IVA validado
  is_active        boolean NOT NULL DEFAULT true,
  CHECK ((qualification IS NULL) <> (exemption IS NULL)),   -- o sujeta/no sujeta (S/N) o exenta (E)
  CHECK (exemption IS NULL OR rate = 0),
  CHECK (qualification NOT IN ('N1','N2') OR rate = 0)
);
INSERT INTO billing.tax_code(code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate, withholding_rate, legal_mention_es, legal_mention_en, requires_vat_id) VALUES
 ('IVA21',      'IVA general 21 %',                         '01','01','S1',NULL, 21.00, 0.00,  0.00, NULL, NULL, false),
 ('IVA21_RE',   'IVA 21 % + recargo de equivalencia 5,2 %', '01','18','S1',NULL, 21.00, 5.20,  0.00, NULL, NULL, false),
 ('IVA21_ALQ',  'Arrendamiento local IVA 21 % + ret. 19 %', '01','11','S1',NULL, 21.00, 0.00, 19.00, NULL, NULL, false),
 ('EXP_E2',     'Exportación exenta (art. 21 LIVA)',        '01','02',NULL,'E2',  0.00, 0.00,  0.00,
   'Operación exenta de IVA por exportación (art. 21 Ley 37/1992).', 'VAT exempt export (Art. 21 Spanish VAT Act 37/1992).', false),
 ('INTRA_E5',   'Entrega intracomunitaria exenta (art. 25)', '01','01',NULL,'E5', 0.00, 0.00,  0.00,
   'Entrega intracomunitaria exenta de IVA (art. 25 Ley 37/1992).', 'VAT exempt intra-Community supply (Art. 25 Spanish VAT Act 37/1992; Art. 138 Directive 2006/112/EC).', true),
 ('NS_LOC',     'No sujeta por reglas de localización',     '01','01','N2',NULL,  0.00, 0.00,  0.00,
   'Operación no sujeta al IVA español por reglas de localización.', 'Not subject to Spanish VAT (place-of-supply rules).', false);

-- ---------------------------------------------------------------------
-- Motor de reglas de entidad facturadora (D3): cliente > canal > defecto. Versionado.
-- ---------------------------------------------------------------------
CREATE TABLE billing.billing_rule_set (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version             integer NOT NULL UNIQUE CHECK (version >= 1),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded')),
  notes               text,
  approval_request_id uuid REFERENCES ops.approval_request(id),
  activated_at        timestamptz,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR activated_at IS NOT NULL)
);
CREATE UNIQUE INDEX billing_rule_set_active_uq ON billing.billing_rule_set(status) WHERE status = 'active';

CREATE TABLE billing.billing_rule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id        uuid NOT NULL REFERENCES billing.billing_rule_set(id),
  scope              text NOT NULL CHECK (scope IN ('customer','channel','default')),
  customer_id        uuid REFERENCES party.contact(id),
  channel            text REFERENCES sales.channel(code),
  issuing_entity_id  uuid NOT NULL REFERENCES core.legal_entity(id),
  notes              text,
  CHECK ((scope = 'customer' AND customer_id IS NOT NULL AND channel IS NULL)
      OR (scope = 'channel'  AND channel IS NOT NULL AND customer_id IS NULL)
      OR (scope = 'default'  AND customer_id IS NULL AND channel IS NULL))
);
CREATE UNIQUE INDEX billing_rule_customer_uq ON billing.billing_rule(rule_set_id, customer_id) WHERE scope = 'customer';
CREATE UNIQUE INDEX billing_rule_channel_uq  ON billing.billing_rule(rule_set_id, channel)     WHERE scope = 'channel';
CREATE UNIQUE INDEX billing_rule_default_uq  ON billing.billing_rule(rule_set_id)              WHERE scope = 'default';

CREATE FUNCTION billing.rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM billing.billing_rule_set WHERE id = coalesce(NEW.rule_set_id, OLD.rule_set_id);
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'WC070: el conjunto de reglas no está en borrador; crea una versión nueva';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER billing_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON billing.billing_rule
  FOR EACH ROW EXECUTE FUNCTION billing.rule_guard();

-- Resolución determinista (la usa api/src/core/billing/resolveIssuingEntity.ts y se testea en SQL)
CREATE FUNCTION billing.resolve_issuing_entity(p_customer_id uuid, p_channel text)
RETURNS TABLE(rule_set_id uuid, rule_id uuid, issuing_entity_id uuid, matched_scope text)
LANGUAGE sql STABLE AS $$
  SELECT r.rule_set_id, r.id, r.issuing_entity_id, r.scope
    FROM billing.billing_rule r JOIN billing.billing_rule_set s ON s.id = r.rule_set_id AND s.status = 'active'
   WHERE (r.scope = 'customer' AND r.customer_id = p_customer_id)
      OR (r.scope = 'channel'  AND r.channel = p_channel)
      OR (r.scope = 'default')
   ORDER BY CASE r.scope WHEN 'customer' THEN 1 WHEN 'channel' THEN 2 ELSE 3 END
   LIMIT 1
$$;

ALTER TABLE sales.sales_order
  ADD CONSTRAINT sales_order_rule_set_fk FOREIGN KEY (billing_rule_set_id) REFERENCES billing.billing_rule_set(id),
  ADD CONSTRAINT sales_order_rule_fk FOREIGN KEY (billing_rule_id) REFERENCES billing.billing_rule(id);
ALTER TABLE catalog.product
  ADD CONSTRAINT product_default_tax_fk FOREIGN KEY (default_tax_code) REFERENCES billing.tax_code(code);
ALTER TABLE sales.quote_line ADD CONSTRAINT quote_line_tax_fk FOREIGN KEY (tax_code) REFERENCES billing.tax_code(code);
ALTER TABLE sales.sales_order_line ADD CONSTRAINT sales_order_line_tax_fk FOREIGN KEY (tax_code) REFERENCES billing.tax_code(code);
ALTER TABLE sales.delivery_note_line ADD CONSTRAINT delivery_note_line_tax_fk FOREIGN KEY (tax_code) REFERENCES billing.tax_code(code);

-- ---------------------------------------------------------------------
-- Facturas emitidas
-- ---------------------------------------------------------------------
CREATE TABLE billing.invoice (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id      uuid NOT NULL REFERENCES core.legal_entity(id),
  series_id            uuid NOT NULL REFERENCES core.number_series(id),
  number               text CHECK (length(number) <= 60),                   -- NumSerieFactura (Verifactu ≤ 60)
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','issued','voided','discarded')),
  invoice_type         char(2) NOT NULL CHECK (invoice_type IN ('F1','F2','F3','R1','R2','R3','R4','R5')),
  rectification_kind   char(1) CHECK (rectification_kind IN ('S','I')),
  issue_date           date,                                                -- FechaExpedicionFactura
  operation_date       date,                                                -- FechaOperacion si difiere
  customer_id          uuid REFERENCES party.contact(id),                   -- NULL solo en F2 sin identificar
  customer_snapshot    jsonb,                                               -- nombre, NIF/IDOtro, dirección, país (congelado al emitir)
  channel              text REFERENCES sales.channel(code),
  sales_order_id       uuid REFERENCES sales.sales_order(id),
  billing_rule_set_id  uuid REFERENCES billing.billing_rule_set(id),
  billing_rule_id      uuid REFERENCES billing.billing_rule(id),
  billing_rule_trace   jsonb,
  currency             char(3) NOT NULL DEFAULT 'EUR',
  language             char(2) NOT NULL DEFAULT 'es' CHECK (language IN ('es','en')),
  description          text NOT NULL DEFAULT 'Venta de vino' CHECK (length(description) BETWEEN 1 AND 500),   -- DescripcionOperacion
  legal_mentions       text[] NOT NULL DEFAULT '{}',
  notes                text,
  incoterm             text,
  subtotal             numeric(14,2),
  tax_total            numeric(14,2),
  surcharge_total      numeric(14,2),
  withholding_total    numeric(14,2),
  total                numeric(14,2),                                       -- a cobrar = base + cuotas + recargo − retención
  amount_paid          numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status       text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid','uncollectible')),
  payment_method       text CHECK (payment_method IN ('transfer','direct_debit','card','cash','stripe','other')),
  payment_terms_days   smallint,
  is_intercompany      boolean NOT NULL DEFAULT false,
  intercompany_settlement_id uuid,                                          -- FK más abajo
  approval_request_id  uuid REFERENCES ops.approval_request(id),           -- lotes e intercompañía
  issued_by            uuid REFERENCES core.app_user(id),
  issued_at            timestamptz,
  verifactu_record_id  uuid,                                                -- FK a regulatory.verifactu_record (0012)
  pdf_attachment_id    uuid REFERENCES core.attachment(id),
  sent_at              timestamptz,
  sent_by              uuid REFERENCES core.app_user(id),
  sent_channel         text CHECK (sent_channel IN ('download','email','edi','portal','paper')),
  voided_at            timestamptz,
  void_reason          text,
  legacy_refs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('draft','pending_approval','discarded')
         OR (number IS NOT NULL AND issue_date IS NOT NULL AND issued_at IS NOT NULL AND total IS NOT NULL AND customer_snapshot IS NOT NULL)),
  CHECK ((invoice_type LIKE 'R%') = (rectification_kind IS NOT NULL)),
  CHECK (invoice_type IN ('F2','R5') OR customer_id IS NOT NULL),
  CHECK (status <> 'voided' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE UNIQUE INDEX invoice_number_uq ON billing.invoice(legal_entity_id, number) WHERE number IS NOT NULL;
CREATE INDEX invoice_customer_idx ON billing.invoice(customer_id, issue_date);
-- Registro de envíos de facturas por correo (envío automático al emitir y reenvíos)
CREATE TABLE billing.invoice_delivery (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          uuid NOT NULL REFERENCES billing.invoice(id),
  trigger             text NOT NULL CHECK (trigger IN ('auto_on_issue','resend')),
  recipients          text[] NOT NULL,
  status              text NOT NULL CHECK (status IN ('queued','sent','failed','bounced','no_recipient')),
  provider_message_id text,
  error               text,
  requested_by        text NOT NULL,                      -- 'system' en el envío automático
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);
CREATE INDEX invoice_delivery_invoice_idx ON billing.invoice_delivery(invoice_id, created_at);
CREATE TRIGGER invoice_delivery_no_delete BEFORE DELETE ON billing.invoice_delivery FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE INDEX invoice_open_idx ON billing.invoice(payment_status) WHERE status = 'issued' AND payment_status IN ('unpaid','partially_paid');
CREATE TRIGGER invoice_touch BEFORE UPDATE ON billing.invoice FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER invoice_no_delete BEFORE DELETE ON billing.invoice FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- Tras emitir, solo cambian: cobro, envío, PDF (una vez), enlace Verifactu (una vez) y anulación (WC080)
CREATE FUNCTION billing.invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['amount_paid','payment_status','sent_at','sent_by','sent_channel',
                          'pdf_attachment_id','verifactu_record_id','status','voided_at','void_reason','updated_at'];
  k text;
BEGIN
  IF OLD.status IN ('issued','voided') THEN
    FOR k IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF NOT (k = ANY(allowed)) AND (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
        RAISE EXCEPTION 'WC080: la factura % está emitida; el campo % no se modifica (se rectifica)', OLD.number, k;
      END IF;
    END LOOP;
    IF OLD.pdf_attachment_id IS NOT NULL AND NEW.pdf_attachment_id IS DISTINCT FROM OLD.pdf_attachment_id THEN
      RAISE EXCEPTION 'WC080: el PDF de una factura emitida no se sustituye';
    END IF;
    IF OLD.verifactu_record_id IS NOT NULL AND NEW.verifactu_record_id IS DISTINCT FROM OLD.verifactu_record_id THEN
      RAISE EXCEPTION 'WC080: el registro Verifactu de alta no se sustituye';
    END IF;
    IF OLD.status = 'issued' AND NEW.status NOT IN ('issued','voided') THEN
      RAISE EXCEPTION 'WC080: transición no permitida % → %', OLD.status, NEW.status;
    END IF;
    IF OLD.status = 'voided' AND NEW.status <> 'voided' THEN
      RAISE EXCEPTION 'WC080: una factura anulada es definitiva';
    END IF;
  ELSIF OLD.status = 'discarded' THEN
    RAISE EXCEPTION 'WC080: un borrador descartado es definitivo';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_guard BEFORE UPDATE ON billing.invoice FOR EACH ROW EXECUTE FUNCTION billing.invoice_guard();

CREATE TABLE billing.invoice_line (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id             uuid NOT NULL REFERENCES billing.invoice(id),
  line_no                smallint NOT NULL CHECK (line_no > 0),
  product_id             uuid REFERENCES catalog.product(id),
  sku                    text,
  description            text NOT NULL CHECK (length(description) BETWEEN 1 AND 250),
  lot_id                 uuid REFERENCES inventory.lot(id),
  lot_code               text,                                          -- obligatorio si product.requires_lot (regla de app)
  quantity               numeric(14,3) NOT NULL CHECK (quantity <> 0),
  unit                   text NOT NULL DEFAULT 'ud',
  unit_price             numeric(14,6) NOT NULL CHECK (unit_price >= 0),
  discount_pct           numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  line_base              numeric(14,2) NOT NULL,                        -- round(quantity × unit_price × (1 − dto/100), 2) HALF_UP
  tax_code               text NOT NULL REFERENCES billing.tax_code(code),
  delivery_note_line_id  uuid REFERENCES sales.delivery_note_line(id),
  order_line_id          uuid REFERENCES sales.sales_order_line(id),
  unit_cost_snapshot     numeric(14,6),                                 -- coste estándar vigente al emitir (control D4)
  UNIQUE (invoice_id, line_no)
);
CREATE INDEX invoice_line_dn_idx ON billing.invoice_line(delivery_note_line_id);

CREATE FUNCTION billing.invoice_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM billing.invoice WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id);
  IF v_status NOT IN ('draft','pending_approval') THEN
    RAISE EXCEPTION 'WC080: la factura está emitida; sus líneas, desglose y vencimientos no se modifican';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_line
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_child_guard();

-- Desglose por impuesto/régimen/tipo (= Desglose/DetalleDesglose de Verifactu). Se calcula al emitir.
CREATE TABLE billing.invoice_tax (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES billing.invoice(id),
  tax_code         text NOT NULL REFERENCES billing.tax_code(code),
  tax              char(2) NOT NULL,
  regime_key       char(2) NOT NULL,
  qualification    char(2),
  exemption        char(2),
  rate             numeric(5,2) NOT NULL,
  base             numeric(14,2) NOT NULL,                                -- BaseImponibleOimporteNoSujeto
  quota            numeric(14,2) NOT NULL,                                -- CuotaRepercutida = round(base × rate/100, 2)
  surcharge_rate   numeric(5,2) NOT NULL DEFAULT 0,
  surcharge_quota  numeric(14,2) NOT NULL DEFAULT 0,
  withholding_rate numeric(5,2) NOT NULL DEFAULT 0,
  withholding      numeric(14,2) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, tax_code)
);
CREATE TRIGGER invoice_tax_guard BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_tax
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_child_guard();

-- Facturas rectificadas o sustituidas por una rectificativa/F3
CREATE TABLE billing.invoice_rectification (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rectifying_invoice_id  uuid NOT NULL REFERENCES billing.invoice(id),
  rectified_invoice_id   uuid REFERENCES billing.invoice(id),            -- NULL si la original es de Holded (legacy)
  rectified_number       text NOT NULL,
  rectified_issue_date   date NOT NULL,
  rectified_issuer_tax_id text NOT NULL,
  relation               text NOT NULL CHECK (relation IN ('rectified','substituted')),
  base_rectified         numeric(14,2),                                  -- ImporteRectificacion (tipo S)
  quota_rectified        numeric(14,2),
  surcharge_rectified    numeric(14,2),
  reason                 text NOT NULL,
  UNIQUE (rectifying_invoice_id, rectified_number, rectified_issue_date)
);
CREATE FUNCTION billing.invoice_rectification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM billing.invoice
   WHERE id = coalesce(NEW.rectifying_invoice_id, OLD.rectifying_invoice_id);
  IF v_status NOT IN ('draft','pending_approval') THEN
    RAISE EXCEPTION 'WC080: la rectificativa está emitida; sus referencias no se modifican';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER invoice_rectification_guard BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_rectification
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_rectification_guard();

-- Vencimientos (cobros previstos). Se fijan al emitir.
CREATE TABLE billing.invoice_due (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES billing.invoice(id),
  seq         smallint NOT NULL CHECK (seq > 0),
  due_date    date NOT NULL,
  amount      numeric(14,2) NOT NULL,
  UNIQUE (invoice_id, seq)
);
CREATE TRIGGER invoice_due_guard BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_due
  FOR EACH ROW EXECUTE FUNCTION billing.invoice_child_guard();

-- Pendiente de cobro y vencido (lo usan el panel, el vigilante de cobros y el MCP)
CREATE VIEW billing.v_receivable AS
SELECT i.id AS invoice_id, i.legal_entity_id, i.number, i.issue_date, i.customer_id, i.total, i.amount_paid,
       (i.total - i.amount_paid) AS outstanding,
       min(d.due_date) AS first_due_date,
       (min(d.due_date) < (now() AT TIME ZONE 'Europe/Madrid')::date AND i.total > i.amount_paid) AS is_overdue
  FROM billing.invoice i LEFT JOIN billing.invoice_due d ON d.invoice_id = i.id
 WHERE i.status = 'issued' AND i.payment_status IN ('unpaid','partially_paid')
 GROUP BY i.id;

-- ---------------------------------------------------------------------
-- Intercompañía P.O → CVPO (D4): liquidación por periodo
-- ---------------------------------------------------------------------
CREATE TABLE billing.intercompany_settlement (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  buyer_entity_id      uuid NOT NULL REFERENCES core.legal_entity(id),
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','invoiced','cancelled')),
  tariff_id            uuid REFERENCES catalog.intercompany_tariff(id),
  invoice_id           uuid REFERENCES billing.invoice(id),
  purchase_invoice_id  uuid,                                                -- FK a purchasing.supplier_invoice (0010): gasto espejo en CVPO
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (seller_entity_id <> buyer_entity_id),
  CHECK (period_end >= period_start),
  CHECK (status <> 'invoiced' OR invoice_id IS NOT NULL),
  EXCLUDE USING gist (seller_entity_id WITH =, buyer_entity_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
    WHERE (status <> 'cancelled')
);

CREATE TABLE billing.intercompany_settlement_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id     uuid NOT NULL REFERENCES billing.intercompany_settlement(id),
  source_table      text NOT NULL CHECK (source_table IN ('sales.delivery_note_line','billing.invoice_line','inventory.stock_move')),
  source_id         uuid NOT NULL,
  product_id        uuid NOT NULL REFERENCES catalog.product(id),
  lot_id            uuid REFERENCES inventory.lot(id),
  quantity          numeric(14,3) NOT NULL CHECK (quantity <> 0),
  base_unit_price   numeric(14,6) NOT NULL,                                 -- precio de la tarifa base vigente
  discount_pct      numeric(5,2) NOT NULL,
  unit_price        numeric(14,6) NOT NULL,                                 -- round(base × (1 − dto/100), 6)
  unit_cost         numeric(14,6),                                          -- coste estándar vigente
  below_cost        boolean NOT NULL DEFAULT false,                         -- unit_price < unit_cost → bloquea el cierre salvo aprobación
  occurred_at       timestamptz NOT NULL,
  UNIQUE (source_table, source_id)
);
CREATE INDEX intercompany_settlement_line_idx ON billing.intercompany_settlement_line(settlement_id);

ALTER TABLE billing.invoice
  ADD CONSTRAINT invoice_settlement_fk FOREIGN KEY (intercompany_settlement_id) REFERENCES billing.intercompany_settlement(id);

CREATE TRIGGER tax_code_audit AFTER INSERT OR UPDATE ON billing.tax_code FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER billing_rule_set_audit AFTER INSERT OR UPDATE ON billing.billing_rule_set FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER billing_rule_audit AFTER INSERT OR UPDATE OR DELETE ON billing.billing_rule FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER invoice_audit AFTER INSERT OR UPDATE ON billing.invoice FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER invoice_line_audit AFTER INSERT OR UPDATE OR DELETE ON billing.invoice_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER invoice_tax_audit AFTER INSERT OR UPDATE OR DELETE ON billing.invoice_tax FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER invoice_rectification_audit AFTER INSERT OR UPDATE OR DELETE ON billing.invoice_rectification FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER invoice_due_audit AFTER INSERT OR UPDATE OR DELETE ON billing.invoice_due FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER intercompany_settlement_audit AFTER INSERT OR UPDATE ON billing.intercompany_settlement FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER intercompany_settlement_line_audit AFTER INSERT OR UPDATE OR DELETE ON billing.intercompany_settlement_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
