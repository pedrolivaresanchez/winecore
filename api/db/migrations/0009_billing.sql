-- WineCore · 0009_billing · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0009_billing.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts
-- Sin FK hacia billing.invoice: DuckDB rehace el UPDATE de una fila referenciada
-- como delete+insert y el cobro no podría actualizar amount_paid.

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
CREATE TABLE billing.tax_code (code             VARCHAR PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  name_es          VARCHAR NOT NULL,
  tax              VARCHAR NOT NULL CHECK (tax IN ('01','02','03','05')),
  regime_key       VARCHAR NOT NULL CHECK (regime_key ~ '^[0-9]{2}$'),
  qualification    VARCHAR CHECK (qualification IN ('S1','S2','N1','N2')),
  exemption        VARCHAR CHECK (exemption IN ('E1','E2','E3','E4','E5','E6')),
  rate             DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  surcharge_rate   DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (surcharge_rate >= 0),
  withholding_rate DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (withholding_rate >= 0),
  -- IRPF (no forma parte del desglose Verifactu)
  legal_mention_es VARCHAR,
  legal_mention_en VARCHAR,
  requires_vat_id  boolean NOT NULL DEFAULT false,
  -- entrega intracomunitaria: NIF-IVA validado
  is_active        boolean NOT NULL DEFAULT true,
  CHECK ((qualification IS NULL) <> (exemption IS NULL)),
  -- o sujeta/no sujeta (S/N) o exenta (E)
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
CREATE TABLE billing.billing_rule_set (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version             integer NOT NULL UNIQUE CHECK (version >= 1),
  status              VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','superseded')),
  notes               VARCHAR,
  approval_request_id uuid,
  activated_at        TIMESTAMPTZ,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR activated_at IS NOT NULL)
);


CREATE TABLE billing.billing_rule (id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_set_id        uuid NOT NULL REFERENCES billing.billing_rule_set(id),
  scope              VARCHAR NOT NULL CHECK (scope IN ('customer','channel','default')),
  customer_id        uuid,
  channel            VARCHAR,
  issuing_entity_id  uuid NOT NULL,
  notes              VARCHAR,
  CHECK ((scope = 'customer' AND customer_id IS NOT NULL AND channel IS NULL)
      OR (scope = 'channel'  AND channel IS NOT NULL AND customer_id IS NULL)
      OR (scope = 'default'  AND customer_id IS NULL AND channel IS NULL))
);


-- Resolución determinista (la usa api/src/core/billing/resolveIssuingEntity.ts y se testea en SQL)

-- ---------------------------------------------------------------------
-- Facturas emitidas
-- ---------------------------------------------------------------------
CREATE TABLE billing.invoice (id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id      uuid NOT NULL,
  series_id            uuid NOT NULL,
  number               VARCHAR CHECK (length(number) <= 60),
  -- NumSerieFactura (Verifactu ≤ 60)
  status               VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','issued','voided','discarded')),
  invoice_type         VARCHAR NOT NULL CHECK (invoice_type IN ('F1','F2','F3','R1','R2','R3','R4','R5')),
  rectification_kind   VARCHAR CHECK (rectification_kind IN ('S','I')),
  issue_date           date,
  -- FechaExpedicionFactura
  operation_date       date,
  -- FechaOperacion si difiere
  customer_id          uuid,
  -- NULL solo en F2 sin identificar
  customer_snapshot    JSON,
  -- nombre, NIF/IDOtro, dirección, país (congelado al emitir)
  channel              VARCHAR,
  sales_order_id       uuid,
  billing_rule_set_id  uuid REFERENCES billing.billing_rule_set(id),
  billing_rule_id      uuid REFERENCES billing.billing_rule(id),
  billing_rule_trace   JSON,
  currency             VARCHAR NOT NULL DEFAULT 'EUR',
  language             VARCHAR NOT NULL DEFAULT 'es' CHECK (language IN ('es','en')),
  description          VARCHAR NOT NULL DEFAULT 'Venta de vino' CHECK (length(description) BETWEEN 1 AND 500),
  -- DescripcionOperacion
  legal_mentions       VARCHAR[] NOT NULL DEFAULT [],
  notes                VARCHAR,
  incoterm             VARCHAR,
  subtotal             DECIMAL(14,2),
  tax_total            DECIMAL(14,2),
  surcharge_total      DECIMAL(14,2),
  withholding_total    DECIMAL(14,2),
  total                DECIMAL(14,2),
  -- a cobrar = base + cuotas + recargo − retención
  amount_paid          DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status       VARCHAR NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid','uncollectible')),
  payment_method       VARCHAR CHECK (payment_method IN ('transfer','direct_debit','card','cash','stripe','other')),
  payment_terms_days   smallint,
  is_intercompany      boolean NOT NULL DEFAULT false,
  intercompany_settlement_id uuid,
  -- FK más abajo
  approval_request_id  uuid,
  -- lotes e intercompañía
  issued_by            uuid,
  issued_at            TIMESTAMPTZ,
  verifactu_record_id  uuid,
  -- FK a regulatory.verifactu_record (0012)
  pdf_attachment_id    uuid,
  sent_at              TIMESTAMPTZ,
  sent_by              uuid,
  sent_channel         VARCHAR CHECK (sent_channel IN ('download','email','edi','portal','paper')),
  voided_at            TIMESTAMPTZ,
  void_reason          VARCHAR,
  legacy_refs          JSON NOT NULL DEFAULT '{}'::JSON,
  created_by           VARCHAR NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft','pending_approval','discarded')
         OR (number IS NOT NULL AND issue_date IS NOT NULL AND issued_at IS NOT NULL AND total IS NOT NULL AND customer_snapshot IS NOT NULL)),
  CHECK ((invoice_type LIKE 'R%') = (rectification_kind IS NOT NULL)),
  CHECK (invoice_type IN ('F2','R5') OR customer_id IS NOT NULL),
  CHECK (status <> 'voided' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);

CREATE INDEX invoice_customer_idx ON billing.invoice(customer_id, issue_date);


-- Tras emitir, solo cambian: cobro, envío, PDF (una vez), enlace Verifactu (una vez) y anulación (WC080)

CREATE TABLE billing.invoice_line (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id             uuid NOT NULL,
  line_no                smallint NOT NULL CHECK (line_no > 0),
  product_id             uuid,
  sku                    VARCHAR,
  description            VARCHAR NOT NULL CHECK (length(description) BETWEEN 1 AND 250),
  lot_id                 uuid,
  lot_code               VARCHAR,                                          -- obligatorio si product.requires_lot (regla de app)
  quantity               DECIMAL(14,3) NOT NULL CHECK (quantity <> 0),
  unit                   VARCHAR NOT NULL DEFAULT 'ud',
  unit_price             DECIMAL(14,6) NOT NULL CHECK (unit_price >= 0),
  discount_pct           DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  line_base              DECIMAL(14,2) NOT NULL,                        -- round(quantity × unit_price × (1 − dto/100), 2) HALF_UP
  tax_code               VARCHAR NOT NULL REFERENCES billing.tax_code(code),
  delivery_note_line_id  uuid,
  order_line_id          uuid,
  unit_cost_snapshot     DECIMAL(14,6),                                 -- coste estándar vigente al emitir (control D4)
  UNIQUE (invoice_id, line_no)
);

CREATE INDEX invoice_line_dn_idx ON billing.invoice_line(delivery_note_line_id);


-- Desglose por impuesto/régimen/tipo (= Desglose/DetalleDesglose de Verifactu). Se calcula al emitir.
CREATE TABLE billing.invoice_tax (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL,
  tax_code         VARCHAR NOT NULL REFERENCES billing.tax_code(code),
  tax              VARCHAR NOT NULL,
  regime_key       VARCHAR NOT NULL,
  qualification    VARCHAR,
  exemption        VARCHAR,
  rate             DECIMAL(5,2) NOT NULL,
  base             DECIMAL(14,2) NOT NULL,                                -- BaseImponibleOimporteNoSujeto
  quota            DECIMAL(14,2) NOT NULL,                                -- CuotaRepercutida = round(base × rate/100, 2)
  surcharge_rate   DECIMAL(5,2) NOT NULL DEFAULT 0,
  surcharge_quota  DECIMAL(14,2) NOT NULL DEFAULT 0,
  withholding_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  withholding      DECIMAL(14,2) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, tax_code)
);


-- Facturas rectificadas o sustituidas por una rectificativa/F3
CREATE TABLE billing.invoice_rectification (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rectifying_invoice_id  uuid NOT NULL,
  rectified_invoice_id   uuid,            -- NULL si la original es de Holded (legacy)
  rectified_number       VARCHAR NOT NULL,
  rectified_issue_date   date NOT NULL,
  rectified_issuer_tax_id VARCHAR NOT NULL,
  relation               VARCHAR NOT NULL CHECK (relation IN ('rectified','substituted')),
  base_rectified         DECIMAL(14,2),                                  -- ImporteRectificacion (tipo S)
  quota_rectified        DECIMAL(14,2),
  surcharge_rectified    DECIMAL(14,2),
  reason                 VARCHAR NOT NULL,
  UNIQUE (rectifying_invoice_id, rectified_number, rectified_issue_date)
);


-- Vencimientos (cobros previstos). Se fijan al emitir.
CREATE TABLE billing.invoice_due (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL,
  seq         smallint NOT NULL CHECK (seq > 0),
  due_date    date NOT NULL,
  amount      DECIMAL(14,2) NOT NULL,
  UNIQUE (invoice_id, seq)
);


-- Pendiente de cobro y vencido (lo usan el panel, el vigilante de cobros y el MCP)
CREATE VIEW billing.v_receivable AS
SELECT i.id AS invoice_id, i.legal_entity_id, i.number, i.issue_date, i.customer_id, i.total, i.amount_paid,
       (i.total - i.amount_paid) AS outstanding,
       min(d.due_date) AS first_due_date,
       (min(d.due_date) < (now() AT TIME ZONE 'Europe/Madrid')::date AND i.total > i.amount_paid) AS is_overdue
  FROM billing.invoice i LEFT JOIN billing.invoice_due d ON d.invoice_id = i.id
 WHERE i.status = 'issued' AND i.payment_status IN ('unpaid','partially_paid')
 GROUP BY i.id, i.legal_entity_id, i.number, i.issue_date, i.customer_id, i.total, i.amount_paid;


-- ---------------------------------------------------------------------
-- Intercompañía P.O → CVPO (D4): liquidación por periodo
-- ---------------------------------------------------------------------
CREATE TABLE billing.intercompany_settlement (id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_entity_id     uuid NOT NULL,
  buyer_entity_id      uuid NOT NULL,
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  status               VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','invoiced','cancelled')),
  tariff_id            uuid,
  invoice_id           uuid,
  purchase_invoice_id  uuid,
  -- FK a purchasing.supplier_invoice (0010): gasto espejo en CVPO
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (seller_entity_id <> buyer_entity_id),
  CHECK (period_end >= period_start)
);


CREATE TABLE billing.intercompany_settlement_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id     uuid NOT NULL REFERENCES billing.intercompany_settlement(id),
  source_table      VARCHAR NOT NULL CHECK (source_table IN ('sales.delivery_note_line','billing.invoice_line','inventory.stock_move')),
  source_id         uuid NOT NULL,
  product_id        uuid NOT NULL,
  lot_id            uuid,
  quantity          DECIMAL(14,3) NOT NULL CHECK (quantity <> 0),
  base_unit_price   DECIMAL(14,6) NOT NULL,                                 -- precio de la tarifa base vigente
  discount_pct      DECIMAL(5,2) NOT NULL,
  unit_price        DECIMAL(14,6) NOT NULL,                                 -- round(base × (1 − dto/100), 6)
  unit_cost         DECIMAL(14,6),                                          -- coste estándar vigente
  below_cost        boolean NOT NULL DEFAULT false,                         -- unit_price < unit_cost → bloquea el cierre salvo aprobación
  occurred_at       TIMESTAMPTZ NOT NULL,
  UNIQUE (source_table, source_id)
);

CREATE INDEX intercompany_settlement_line_idx ON billing.intercompany_settlement_line(settlement_id);
