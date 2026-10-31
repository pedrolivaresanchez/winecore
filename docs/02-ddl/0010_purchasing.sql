-- =====================================================================
-- WineCore · Migración 0010 · compras y gastos (purchasing)
-- Facturas recibidas (foto, PDF, reenvío), extracción OCR por agente y validación humana.
-- Especificación: docs/02-modelo-dominio.md §13 · Estados: docs/03-maquinas-estado.md §7
-- =====================================================================

CREATE TABLE purchasing.expense_category (
  code             text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,30}$'),
  name_es          text NOT NULL,
  default_account  text NOT NULL CHECK (default_account ~ '^6[0-9]{2,7}$'),
  organic_relevant boolean NOT NULL DEFAULT false,     -- productos para viñedo/bodega: alimenta el cuaderno ecológico
  is_active        boolean NOT NULL DEFAULT true
);
INSERT INTO purchasing.expense_category(code, name_es, default_account, organic_relevant) VALUES
 ('grapes',              'Compra de uva',                         '601', true),
 ('bulk_wine',           'Compra de vino a granel',               '600', true),
 ('oenological',         'Productos enológicos (SO2, tartárico)', '602', true),
 ('vineyard_inputs',     'Productos para el viñedo',              '602', true),
 ('cleaning',            'Limpieza y desinfección',               '602', true),
 ('packaging',           'Botellas, tapones, cápsulas, etiquetas, cajas', '602', false),
 ('goods_for_resale',    'Mercaderías',                           '600', false),
 ('transport',           'Transportes',                           '624', false),
 ('warehousing',         'Almacenaje (operadores logísticos)',    '621', false),
 ('rent',                'Arrendamientos',                        '621', false),
 ('utilities',           'Suministros',                           '628', false),
 ('marketing',           'Publicidad y relaciones públicas',      '627', false),
 ('software',            'Aplicaciones informáticas',             '629', false),
 ('professional',        'Servicios profesionales',               '623', false),
 ('lab',                 'Análisis de laboratorio',               '623', false),
 ('other_services',      'Otros servicios',                       '629', false);

CREATE TABLE purchasing.supplier_invoice (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id         uuid NOT NULL REFERENCES core.legal_entity(id),
  supplier_id             uuid REFERENCES party.contact(id),                -- puede faltar en 'captured' (OCR sin casar)
  supplier_invoice_number text,
  issue_date              date,
  accounting_date         date,
  received_at             timestamptz NOT NULL DEFAULT now(),
  source                  text NOT NULL CHECK (source IN ('upload','photo','email_forward','intercompany','import')),
  status                  text NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','validated','approved','rejected','duplicate')),
  category_code           text REFERENCES purchasing.expense_category(code),
  currency                char(3) NOT NULL DEFAULT 'EUR',
  subtotal                numeric(14,2),
  tax_total               numeric(14,2),
  withholding_total       numeric(14,2) NOT NULL DEFAULT 0,
  total                   numeric(14,2),
  amount_paid             numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status          text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  due_date                date,
  payment_method          text CHECK (payment_method IN ('transfer','direct_debit','card','cash','other')),
  ocr_extraction          jsonb,                                            -- salida del agente ocr-gastos (campos + confianza)
  ocr_confidence          numeric(4,3) CHECK (ocr_confidence BETWEEN 0 AND 1),
  validated_by            uuid REFERENCES core.app_user(id),
  validated_at            timestamptz,
  approved_by             uuid REFERENCES core.app_user(id),
  approved_at             timestamptz,
  rejection_reason        text,
  duplicate_of_id         uuid REFERENCES purchasing.supplier_invoice(id),
  is_intercompany         boolean NOT NULL DEFAULT false,
  notes                   text,
  legacy_refs             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by              text NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'captured' OR status IN ('rejected','duplicate')
         OR (supplier_id IS NOT NULL AND supplier_invoice_number IS NOT NULL AND issue_date IS NOT NULL AND total IS NOT NULL)),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL),
  CHECK (status <> 'duplicate' OR duplicate_of_id IS NOT NULL),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE UNIQUE INDEX supplier_invoice_uq ON purchasing.supplier_invoice(legal_entity_id, supplier_id, supplier_invoice_number)
  WHERE status IN ('validated','approved');
CREATE TRIGGER supplier_invoice_touch BEFORE UPDATE ON purchasing.supplier_invoice FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER supplier_invoice_no_delete BEFORE DELETE ON purchasing.supplier_invoice FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE purchasing.supplier_invoice_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES purchasing.supplier_invoice(id),
  line_no             smallint NOT NULL CHECK (line_no > 0),
  description         text NOT NULL,
  product_id          uuid REFERENCES catalog.product(id),                  -- compras con stock (enológicos, envases, mercaderías)
  expense_account     text NOT NULL CHECK (expense_account ~ '^6[0-9]{2,7}$'),
  quantity            numeric(14,3) NOT NULL DEFAULT 1,
  unit_price          numeric(14,6) NOT NULL,
  line_base           numeric(14,2) NOT NULL,
  vat_rate            numeric(5,2) NOT NULL DEFAULT 21,
  vat_deductible_pct  numeric(5,2) NOT NULL DEFAULT 100 CHECK (vat_deductible_pct BETWEEN 0 AND 100),
  vat_quota           numeric(14,2) NOT NULL,
  withholding_rate    numeric(5,2) NOT NULL DEFAULT 0,
  UNIQUE (supplier_invoice_id, line_no)
);

CREATE FUNCTION purchasing.supplier_invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM purchasing.supplier_invoice WHERE id = coalesce(NEW.supplier_invoice_id, OLD.supplier_invoice_id);
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'WC090: la factura recibida está aprobada; se corrige con una nueva factura (abono del proveedor)';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER supplier_invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON purchasing.supplier_invoice_line
  FOR EACH ROW EXECUTE FUNCTION purchasing.supplier_invoice_line_guard();

ALTER TABLE cellar.addition
  ADD CONSTRAINT addition_supplier_invoice_fk FOREIGN KEY (supplier_invoice_id) REFERENCES purchasing.supplier_invoice(id);
ALTER TABLE billing.intercompany_settlement
  ADD CONSTRAINT settlement_purchase_invoice_fk FOREIGN KEY (purchase_invoice_id) REFERENCES purchasing.supplier_invoice(id);

CREATE TRIGGER expense_category_audit AFTER INSERT OR UPDATE ON purchasing.expense_category FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER supplier_invoice_audit AFTER INSERT OR UPDATE ON purchasing.supplier_invoice FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER supplier_invoice_line_audit AFTER INSERT OR UPDATE OR DELETE ON purchasing.supplier_invoice_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
