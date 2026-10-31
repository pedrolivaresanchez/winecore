-- WineCore · 0010_purchasing · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0010_purchasing.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0010 · compras y gastos (purchasing)
-- Facturas recibidas (foto, PDF, reenvío), extracción OCR por agente y validación humana.
-- Especificación: docs/02-modelo-dominio.md §13 · Estados: docs/03-maquinas-estado.md §7
-- =====================================================================

CREATE TABLE purchasing.expense_category (code             VARCHAR PRIMARY KEY CHECK (code ~ '^[a-z_]{2,30}$'),
  name_es          VARCHAR NOT NULL,
  default_account  VARCHAR NOT NULL CHECK (default_account ~ '^6[0-9]{2,7}$'),
  organic_relevant boolean NOT NULL DEFAULT false,
  -- productos para viñedo/bodega: alimenta el cuaderno ecológico
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


CREATE TABLE purchasing.supplier_invoice (id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id         uuid NOT NULL,
  supplier_id             uuid,
  -- puede faltar en 'captured' (OCR sin casar)
  supplier_invoice_number VARCHAR,
  issue_date              date,
  accounting_date         date,
  received_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                  VARCHAR NOT NULL CHECK (source IN ('upload','photo','email_forward','intercompany','import')),
  status                  VARCHAR NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','validated','approved','rejected','duplicate')),
  category_code           VARCHAR REFERENCES purchasing.expense_category(code),
  currency                VARCHAR NOT NULL DEFAULT 'EUR',
  subtotal                DECIMAL(14,2),
  tax_total               DECIMAL(14,2),
  withholding_total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total                   DECIMAL(14,2),
  amount_paid             DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status          VARCHAR NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  due_date                date,
  payment_method          VARCHAR CHECK (payment_method IN ('transfer','direct_debit','card','cash','other')),
  ocr_extraction          JSON,
  -- salida del agente ocr-gastos (campos + confianza)
  ocr_confidence          DECIMAL(4,3) CHECK (ocr_confidence BETWEEN 0 AND 1),
  validated_by            uuid,
  validated_at            TIMESTAMPTZ,
  approved_by             uuid,
  approved_at             TIMESTAMPTZ,
  rejection_reason        VARCHAR,
  duplicate_of_id         uuid REFERENCES purchasing.supplier_invoice(id),
  is_intercompany         boolean NOT NULL DEFAULT false,
  notes                   VARCHAR,
  legacy_refs             JSON NOT NULL DEFAULT '{}'::JSON,
  created_by              VARCHAR NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'captured' OR status IN ('rejected','duplicate')
         OR (supplier_id IS NOT NULL AND supplier_invoice_number IS NOT NULL AND issue_date IS NOT NULL AND total IS NOT NULL)),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);


CREATE TABLE purchasing.supplier_invoice_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_invoice_id uuid NOT NULL REFERENCES purchasing.supplier_invoice(id),
  line_no             smallint NOT NULL CHECK (line_no > 0),
  description         VARCHAR NOT NULL,
  product_id          uuid,                  -- compras con stock (enológicos, envases, mercaderías)
  expense_account     VARCHAR NOT NULL CHECK (expense_account ~ '^6[0-9]{2,7}$'),
  quantity            DECIMAL(14,3) NOT NULL DEFAULT 1,
  unit_price          DECIMAL(14,6) NOT NULL,
  line_base           DECIMAL(14,2) NOT NULL,
  vat_rate            DECIMAL(5,2) NOT NULL DEFAULT 21,
  vat_deductible_pct  DECIMAL(5,2) NOT NULL DEFAULT 100 CHECK (vat_deductible_pct BETWEEN 0 AND 100),
  vat_quota           DECIMAL(14,2) NOT NULL,
  withholding_rate    DECIMAL(5,2) NOT NULL DEFAULT 0,
  UNIQUE (supplier_invoice_id, line_no)
);
