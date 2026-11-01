-- WineCore · 0047_holded_native_invoices · dialecto DuckDB (ADR 002).
-- El histórico de Holded deja de vivir solo en legacy.* y pasa a ser dato propio:
--   venta    -> billing.invoice (+ líneas, desglose y vencimiento)
--   compra   -> purchasing.supplier_invoice (+ líneas)
-- No consume series, no crea regulatory.verifactu_record y no se reenvía a la AEAT.
-- La numeración original se conserva (también si number_anomaly = 'duplicate':
-- la clave de legacy es sociedad + tipo + número + fecha). La unicidad de una
-- factura NUEVA sigue en la emisión; aquí la idempotencia es el id de Holded.
--
-- Número de migración: 0047. En main la última aplicada antes de esta es
-- 0045_tax_code_iva10.sql. 0046_idea_agenda.sql está en otra rama y no se toca.
-- DuckDB 1.5 solo añade columnas sin NOT NULL ni DEFAULT: origin queda NULL
-- en lo emitido por WineCore y 'holded_import' en lo proyectado.
-- En producción esta migración se aplica aparte (DB_MODE=timbal no migra al arrancar).
--
-- Reejecutar solo el bloque HOLDED_PROJECT (api/src/core/billing/holdedProject.ts)
-- no duplica: ON CONFLICT (id) DO NOTHING y NOT EXISTS por holded_invoice_id.

ALTER TABLE billing.invoice ADD COLUMN origin VARCHAR;
ALTER TABLE billing.invoice ADD COLUMN holded_invoice_id UUID;
ALTER TABLE purchasing.supplier_invoice ADD COLUMN origin VARCHAR;
ALTER TABLE purchasing.supplier_invoice ADD COLUMN holded_invoice_id UUID;

-- DuckDB 1.5 no admite índices parciales. Los NULL (facturas nativas) no chocan
-- entre sí; el id de Holded sí queda único.
CREATE UNIQUE INDEX IF NOT EXISTS billing_invoice_holded_id_uq
  ON billing.invoice(holded_invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_holded_id_uq
  ON purchasing.supplier_invoice(holded_invoice_id);

-- Tipos que el histórico necesita y que no son el IVA10 de 0045.
INSERT INTO billing.tax_code(code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate, withholding_rate, legal_mention_es, legal_mention_en, requires_vat_id) VALUES
 ('IVA4', 'IVA superreducido 4 %', '01', '01', 'S1', NULL, 4.00, 0.00, 0.00, NULL, NULL, false),
 ('HLD_OTRO', 'IVA histórico de tipo no estándar', '01', '01', 'S1', NULL, 0.00, 0.00, 0.00, NULL, NULL, false)
ON CONFLICT (code) DO NOTHING;

-- BEGIN HOLDED_PROJECT
CREATE OR REPLACE MACRO billing.holded_uuid(seed) AS (
  CAST(
    substring(md5(CAST(seed AS VARCHAR)), 1, 8) || '-' ||
    substring(md5(CAST(seed AS VARCHAR)), 9, 4) || '-' ||
    '7' || substring(md5(CAST(seed AS VARCHAR)), 14, 3) || '-' ||
    '8' || substring(md5(CAST(seed AS VARCHAR)), 18, 3) || '-' ||
    substring(md5(CAST(seed AS VARCHAR)), 21, 12)
  AS UUID)
);

CREATE OR REPLACE MACRO billing.holded_rate(base, quota) AS (
  CASE
    WHEN base IS NULL OR base = 0 OR quota IS NULL THEN 0
    ELSE round(CAST(quota AS DOUBLE) / CAST(base AS DOUBLE) * 100, 2)
  END
);

CREATE OR REPLACE MACRO billing.holded_tax_code(rate, label, surcharge, has_iva10) AS (
  CASE
    WHEN coalesce(surcharge, 0) <> 0 AND abs(rate - 21) < 0.51 THEN 'IVA21_RE'
    WHEN abs(rate - 21) < 0.51 THEN 'IVA21'
    WHEN abs(rate - 10) < 0.51 AND has_iva10 THEN 'IVA10'
    WHEN abs(rate - 10) < 0.51 THEN 'HLD_OTRO'
    WHEN abs(rate - 4) < 0.51 THEN 'IVA4'
    WHEN abs(rate) < 0.51 AND lower(coalesce(label, '')) LIKE '%intra%' THEN 'INTRA_E5'
    WHEN abs(rate) < 0.51 AND (
      lower(coalesce(label, '')) LIKE '%exent%' OR lower(coalesce(label, '')) LIKE '%export%'
    ) THEN 'EXP_E2'
    WHEN abs(rate) < 0.51 THEN 'NS_LOC'
    ELSE 'HLD_OTRO'
  END
);

CREATE OR REPLACE MACRO billing.holded_book_rate(code, rate) AS (
  CASE code
    WHEN 'IVA21' THEN 21
    WHEN 'IVA21_RE' THEN 21
    WHEN 'IVA21_ALQ' THEN 21
    WHEN 'IVA10' THEN 10
    WHEN 'IVA4' THEN 4
    WHEN 'EXP_E2' THEN 0
    WHEN 'INTRA_E5' THEN 0
    WHEN 'NS_LOC' THEN 0
    ELSE rate
  END
);

CREATE OR REPLACE MACRO billing.holded_payment(label) AS (
  CASE
    WHEN label IS NULL OR trim(CAST(label AS VARCHAR)) = '' THEN NULL
    WHEN lower(CAST(label AS VARCHAR)) LIKE '%transfer%' THEN 'transfer'
    WHEN lower(CAST(label AS VARCHAR)) LIKE '%domicil%'
      OR lower(CAST(label AS VARCHAR)) LIKE '%recibo%'
      OR lower(CAST(label AS VARCHAR)) LIKE '%sepa%' THEN 'direct_debit'
    WHEN lower(CAST(label AS VARCHAR)) LIKE '%tarjeta%' THEN 'card'
    WHEN lower(CAST(label AS VARCHAR)) LIKE '%contado%'
      OR lower(CAST(label AS VARCHAR)) LIKE '%efectivo%' THEN 'cash'
    ELSE 'other'
  END
);

CREATE OR REPLACE MACRO billing.holded_name(name) AS (
  CASE
    WHEN length(trim(coalesce(CAST(name AS VARCHAR), ''))) = 0 THEN 'Sin identificar'
    ELSE substring(trim(CAST(name AS VARCHAR)), 1, 120)
  END
);

CREATE OR REPLACE MACRO billing.holded_number(number) AS (
  substring(trim(CAST(number AS VARCHAR)), 1, 60)
);

-- Contactos que el histórico nombra y todavía no están en party.contact.
INSERT INTO party.contact (
  id, kind, legal_name, tax_id, tax_id_type, is_customer, is_supplier, legacy_refs, created_by
)
SELECT
  gen_random_uuid(),
  'company',
  names.legal_name,
  NULL,
  'none',
  names.is_customer,
  names.is_supplier,
  json_object('source', 'holded_import'),
  'holded_import'
FROM (
  SELECT
    billing.holded_name(h.counterparty_name) AS legal_name,
    max(CASE WHEN h.kind = 'sale' THEN 1 ELSE 0 END) = 1 AS is_customer,
    max(CASE WHEN h.kind = 'purchase' THEN 1 ELSE 0 END) = 1 AS is_supplier
  FROM legacy.holded_invoice h
  WHERE h.counterparty_contact_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM party.contact c WHERE c.id = h.counterparty_contact_id)
  GROUP BY 1
) names
WHERE NOT EXISTS (
  SELECT 1 FROM party.contact c
  WHERE lower(trim(c.legal_name)) = lower(names.legal_name)
);

-- Emitidas. El id es el de legacy.holded_invoice: reejecutar no duplica.
INSERT INTO billing.invoice (
  id, legal_entity_id, series_id, number, status, invoice_type, rectification_kind,
  issue_date, operation_date, customer_id, customer_snapshot, currency, language, description,
  notes, subtotal, tax_total, surcharge_total, withholding_total, total, amount_paid, payment_status,
  payment_method, issued_by, issued_at, voided_at, void_reason, legacy_refs, created_by, created_at, updated_at,
  origin, holded_invoice_id
)
SELECT
  h.id,
  h.entity_id,
  NULL,
  billing.holded_number(h.number),
  CASE WHEN src.is_void THEN 'voided' ELSE 'issued' END,
  CASE WHEN src.is_credit THEN 'R1' ELSE 'F1' END,
  CASE WHEN src.is_credit THEN 'I' ELSE NULL END,
  h.issue_date,
  h.operation_date,
  src.customer_id,
  json_object(
    'name', billing.holded_name(h.counterparty_name),
    'tax_id', src.tax_id,
    'source', 'holded_import'
  ),
  'EUR',
  'es',
  CASE
    WHEN length(trim(coalesce(h.description, ''))) >= 1 THEN substring(trim(h.description), 1, 500)
    ELSE 'Venta de vino'
  END,
  CASE
    WHEN h.number_anomaly IS NOT NULL
      THEN 'Importada de Holded. Anomalía de numeración: ' || h.number_anomaly || '. No se envía a Verifactu.'
    ELSE 'Importada de Holded. Histórica: no se envía a Verifactu.'
  END,
  h.subtotal,
  h.vat + coalesce(h.vat_2, 0),
  h.surcharge,
  h.withholding,
  h.total,
  src.amount_paid,
  CASE
    WHEN src.amount_paid = 0 THEN 'unpaid'
    WHEN h.total > 0 AND src.amount_paid >= h.total THEN 'paid'
    ELSE 'partially_paid'
  END,
  billing.holded_payment(h.payment_method),
  CAST('00000000-0000-4000-8000-000000000047' AS UUID),
  CAST(h.issue_date AS TIMESTAMPTZ),
  CASE WHEN src.is_void THEN CAST(h.issue_date AS TIMESTAMPTZ) ELSE NULL END,
  CASE WHEN src.is_void THEN 'Anulada en Holded antes de la importación' ELSE NULL END,
  json_object(
    'source', 'holded_import',
    'holded_invoice_id', CAST(h.id AS VARCHAR),
    'number_anomaly', coalesce(h.number_anomaly, ''),
    'status_holded', h.status_holded,
    'original_number', h.number,
    'verifactu', 'not_applicable',
    'batch_id', CAST(h.batch_id AS VARCHAR)
  ),
  'holded_import',
  CAST(h.issue_date AS TIMESTAMPTZ),
  CAST(h.issue_date AS TIMESTAMPTZ),
  'holded_import',
  h.id
FROM legacy.holded_invoice h
JOIN (
  SELECT
    h2.id,
    lower(trim(h2.status_holded)) IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada') AS is_void,
    (h2.total < 0 OR upper(substring(trim(h2.number), 1, 2)) = 'CN') AS is_credit,
    CASE
      WHEN lower(trim(h2.status_holded)) IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada') THEN CAST(0 AS DECIMAL(14,2))
      WHEN h2.total <= 0 THEN CAST(0 AS DECIMAL(14,2))
      WHEN lower(trim(h2.status_holded)) IN ('pagado', 'pagada', 'cobrado', 'cobrada') THEN h2.total
      WHEN coalesce(h2.pending, 0) <= 0 THEN h2.total
      WHEN coalesce(h2.paid, 0) > 0 THEN least(greatest(h2.paid, CAST(0 AS DECIMAL(14,2))), h2.total)
      ELSE CAST(0 AS DECIMAL(14,2))
    END AS amount_paid,
    COALESCE(
      (SELECT c.id FROM party.contact c WHERE c.id = h2.counterparty_contact_id LIMIT 1),
      (
        SELECT c.id FROM party.contact c
        WHERE lower(trim(c.legal_name)) = lower(billing.holded_name(h2.counterparty_name))
        ORDER BY c.created_at
        LIMIT 1
      )
    ) AS customer_id,
    (
      SELECT cleaned FROM (
        SELECT upper(regexp_replace(trim(l.counterparty_tax_id), '[^A-Za-z0-9]', '', 'g')) AS cleaned
        FROM legacy.holded_invoice_line l
        WHERE l.entity_id = h2.entity_id
          AND l.kind = 'sale'
          AND l.document_number = h2.number
          AND l.document_date = h2.issue_date
          AND l.counterparty_tax_id IS NOT NULL
        ORDER BY l.line_seq
        LIMIT 1
      ) raw_tax
      WHERE cleaned ~ '^[A-Z0-9]{2,20}$'
    ) AS tax_id
  FROM legacy.holded_invoice h2
  WHERE h2.kind = 'sale'
) src ON src.id = h.id
WHERE h.kind = 'sale'
  AND src.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM billing.invoice i
    WHERE i.id = h.id
       OR i.holded_invoice_id = h.id
       OR (
         i.legal_entity_id = h.entity_id
         AND i.number = billing.holded_number(h.number)
         AND i.issue_date = h.issue_date
       )
  )
ON CONFLICT (id) DO NOTHING;

-- Líneas reales cuando cuadran al céntimo con la cabecera y no hay recargo
-- (el recargo vive en la cabecera y el libro exige igualdad exacta).
INSERT INTO billing.invoice_line (
  id, invoice_id, line_no, product_id, sku, description, quantity, unit, unit_price,
  discount_pct, line_base, tax_code
)
SELECT
  l.id,
  h.id,
  CAST(l.line_seq AS SMALLINT),
  l.matched_product_id,
  CASE WHEN l.sku IS NULL OR trim(l.sku) = '' THEN NULL ELSE substring(trim(l.sku), 1, 80) END,
  CASE
    WHEN length(trim(coalesce(l.description, l.item, ''))) >= 1 THEN substring(trim(coalesce(l.description, l.item)), 1, 250)
    ELSE 'Línea histórica'
  END,
  CAST(CASE
    WHEN l.units IS NOT NULL AND l.units <> 0 THEN l.units
    WHEN coalesce(l.subtotal, 0) < 0 THEN -1
    ELSE 1
  END AS DECIMAL(14,3)),
  'ud',
  CAST(CASE
    WHEN l.units IS NOT NULL AND l.units <> 0 THEN abs(coalesce(l.subtotal, 0) / l.units)
    ELSE abs(coalesce(l.subtotal, 0))
  END AS DECIMAL(14,6)),
  0,
  CAST(coalesce(l.subtotal, 0) AS DECIMAL(14,2)),
  billing.holded_tax_code(
    billing.holded_rate(coalesce(l.subtotal, 0), coalesce(l.tax_amount, 0)),
    l.tax_rate_label,
    0,
    (EXISTS (SELECT 1 FROM billing.tax_code WHERE code = 'IVA10'))
  )
FROM legacy.holded_invoice_line l
JOIN legacy.holded_invoice h
  ON h.entity_id = l.entity_id
 AND h.kind = 'sale'
 AND h.number = l.document_number
 AND h.issue_date = l.document_date
JOIN billing.invoice i ON i.id = h.id AND i.origin = 'holded_import'
WHERE l.kind = 'sale'
  AND NOT l.is_draft
  AND l.line_seq BETWEEN 1 AND 32767
  AND h.surcharge = 0
  AND (
    SELECT count(*) > 0
       AND max(l2.line_seq) <= 32767
       AND CAST(coalesce(sum(coalesce(l2.subtotal, 0)), 0) AS DECIMAL(14,2)) = h.subtotal
       AND CAST(coalesce(sum(coalesce(l2.tax_amount, 0)), 0) AS DECIMAL(14,2)) = h.vat + coalesce(h.vat_2, 0)
    FROM legacy.holded_invoice_line l2
    WHERE l2.entity_id = h.entity_id
      AND l2.kind = 'sale'
      AND l2.document_number = h.number
      AND l2.document_date = h.issue_date
      AND NOT l2.is_draft
  )
  AND NOT EXISTS (SELECT 1 FROM billing.invoice_line existing WHERE existing.invoice_id = h.id)
ON CONFLICT (id) DO NOTHING;

-- Una línea sintética cuando las de Holded no cuadran: el libro usa el desglose, no estas líneas.
INSERT INTO billing.invoice_line (
  id, invoice_id, line_no, description, quantity, unit, unit_price, discount_pct, line_base, tax_code
)
SELECT
  billing.holded_uuid('sale-line:' || CAST(h.id AS VARCHAR)),
  h.id,
  1,
  'Histórico Holded',
  CAST(CASE WHEN h.subtotal < 0 THEN -1 ELSE 1 END AS DECIMAL(14,3)),
  'ud',
  CAST(abs(h.subtotal) AS DECIMAL(14,6)),
  0,
  h.subtotal,
  billing.holded_tax_code(
    billing.holded_rate(h.subtotal, h.vat + coalesce(h.vat_2, 0)),
    (
      SELECT l.tax_rate_label
      FROM legacy.holded_invoice_line l
      WHERE l.entity_id = h.entity_id AND l.kind = 'sale'
        AND l.document_number = h.number AND l.document_date = h.issue_date
      ORDER BY l.line_seq
      LIMIT 1
    ),
    h.surcharge,
    (EXISTS (SELECT 1 FROM billing.tax_code WHERE code = 'IVA10'))
  )
FROM legacy.holded_invoice h
JOIN billing.invoice i ON i.id = h.id AND i.origin = 'holded_import'
WHERE h.kind = 'sale'
  AND NOT EXISTS (SELECT 1 FROM billing.invoice_line existing WHERE existing.invoice_id = h.id)
ON CONFLICT (id) DO NOTHING;

-- Desglose agrupado (sin recargo) cuando las líneas suman exactamente la cabecera.
INSERT INTO billing.invoice_tax (
  id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate,
  base, quota, surcharge_rate, surcharge_quota, withholding_rate, withholding
)
SELECT
  billing.holded_uuid('sale-tax:' || CAST(g.invoice_id AS VARCHAR) || ':' || g.code),
  g.invoice_id,
  g.code,
  c.tax,
  c.regime_key,
  c.qualification,
  c.exemption,
  CAST(billing.holded_book_rate(g.code, g.blended) AS DECIMAL(5,2)),
  CAST(g.base AS DECIMAL(14,2)),
  CAST(g.quota AS DECIMAL(14,2)),
  0,
  0,
  0,
  0
FROM (
  SELECT
    tagged.invoice_id,
    tagged.code,
    sum(tagged.base) AS base,
    sum(tagged.quota) AS quota,
    CASE
      WHEN sum(tagged.base) = 0 THEN 0
      ELSE round(CAST(sum(tagged.quota) AS DOUBLE) / CAST(sum(tagged.base) AS DOUBLE) * 100, 2)
    END AS blended
  FROM (
    SELECT
      h.id AS invoice_id,
      billing.holded_tax_code(
        billing.holded_rate(coalesce(l.subtotal, 0), coalesce(l.tax_amount, 0)),
        l.tax_rate_label,
        0,
        (EXISTS (SELECT 1 FROM billing.tax_code WHERE code = 'IVA10'))
      ) AS code,
      coalesce(l.subtotal, 0) AS base,
      coalesce(l.tax_amount, 0) AS quota
    FROM legacy.holded_invoice_line l
    JOIN legacy.holded_invoice h
      ON h.entity_id = l.entity_id AND h.kind = 'sale'
     AND h.number = l.document_number AND h.issue_date = l.document_date
    JOIN billing.invoice i ON i.id = h.id AND i.origin = 'holded_import'
    WHERE l.kind = 'sale'
      AND NOT l.is_draft
      AND h.surcharge = 0
      AND (
        SELECT count(*) > 0
           AND CAST(coalesce(sum(coalesce(l2.subtotal, 0)), 0) AS DECIMAL(14,2)) = h.subtotal
           AND CAST(coalesce(sum(coalesce(l2.tax_amount, 0)), 0) AS DECIMAL(14,2)) = h.vat + coalesce(h.vat_2, 0)
        FROM legacy.holded_invoice_line l2
        WHERE l2.entity_id = h.entity_id AND l2.kind = 'sale'
          AND l2.document_number = h.number AND l2.document_date = h.issue_date
          AND NOT l2.is_draft
      )
      AND NOT EXISTS (SELECT 1 FROM billing.invoice_tax t WHERE t.invoice_id = h.id)
  ) tagged
  GROUP BY tagged.invoice_id, tagged.code
) g
JOIN billing.tax_code c ON c.code = g.code
ON CONFLICT (id) DO NOTHING;

-- Desglose de cabecera (un tipo, con recargo si lo hay) para el resto.
INSERT INTO billing.invoice_tax (
  id, invoice_id, tax_code, tax, regime_key, qualification, exemption, rate,
  base, quota, surcharge_rate, surcharge_quota, withholding_rate, withholding
)
SELECT
  billing.holded_uuid('sale-tax:' || CAST(h.id AS VARCHAR) || ':' || code.code),
  h.id,
  code.code,
  c.tax,
  c.regime_key,
  c.qualification,
  c.exemption,
  CAST(billing.holded_book_rate(code.code, code.rate) AS DECIMAL(5,2)),
  h.subtotal,
  h.vat + coalesce(h.vat_2, 0),
  CAST(CASE
    WHEN h.subtotal = 0 OR h.surcharge = 0 THEN 0
    ELSE round(CAST(h.surcharge AS DOUBLE) / CAST(h.subtotal AS DOUBLE) * 100, 2)
  END AS DECIMAL(5,2)),
  h.surcharge,
  CAST(CASE
    WHEN h.subtotal = 0 OR h.withholding = 0 THEN 0
    ELSE round(CAST(h.withholding AS DOUBLE) / CAST(h.subtotal AS DOUBLE) * 100, 2)
  END AS DECIMAL(5,2)),
  h.withholding
FROM legacy.holded_invoice h
JOIN billing.invoice i ON i.id = h.id AND i.origin = 'holded_import'
CROSS JOIN LATERAL (
  SELECT
    billing.holded_rate(h.subtotal, h.vat + coalesce(h.vat_2, 0)) AS rate,
    billing.holded_tax_code(
      billing.holded_rate(h.subtotal, h.vat + coalesce(h.vat_2, 0)),
      (
        SELECT l.tax_rate_label
        FROM legacy.holded_invoice_line l
        WHERE l.entity_id = h.entity_id AND l.kind = 'sale'
          AND l.document_number = h.number AND l.document_date = h.issue_date
        ORDER BY l.line_seq
        LIMIT 1
      ),
      h.surcharge,
      (EXISTS (SELECT 1 FROM billing.tax_code WHERE code = 'IVA10'))
    ) AS code
) code
JOIN billing.tax_code c ON c.code = code.code
WHERE h.kind = 'sale'
  AND NOT EXISTS (SELECT 1 FROM billing.invoice_tax t WHERE t.invoice_id = h.id)
ON CONFLICT (id) DO NOTHING;

-- Vencimiento informativo. El cobro vivo sigue en legacy.open_item: las consultas
-- de pendiente excluyen origin = 'holded_import' para no cobrar dos veces.
INSERT INTO billing.invoice_due (id, invoice_id, seq, due_date, amount)
SELECT
  billing.holded_uuid('sale-due:' || CAST(h.id AS VARCHAR)),
  h.id,
  1,
  h.due_date,
  h.total
FROM legacy.holded_invoice h
JOIN billing.invoice i ON i.id = h.id AND i.origin = 'holded_import'
WHERE h.kind = 'sale'
  AND h.due_date IS NOT NULL
  AND h.total > 0
  AND NOT EXISTS (SELECT 1 FROM billing.invoice_due d WHERE d.invoice_id = h.id)
ON CONFLICT (id) DO NOTHING;

-- Recibidas. source = 'import' (canal ya permitido); origin marca el histórico.
INSERT INTO purchasing.supplier_invoice (
  id, legal_entity_id, supplier_id, supplier_invoice_number, issue_date, accounting_date,
  received_at, source, status, category_code, currency, subtotal, tax_total, withholding_total, total,
  amount_paid, payment_status, due_date, payment_method, validated_by, validated_at, approved_by, approved_at,
  notes, legacy_refs, created_by, created_at, updated_at, origin, holded_invoice_id
)
SELECT
  h.id,
  h.entity_id,
  src.supplier_id,
  billing.holded_number(h.number),
  h.issue_date,
  coalesce(h.accounting_date, h.issue_date),
  CAST(h.issue_date AS TIMESTAMPTZ),
  'import',
  'approved',
  CASE substring(coalesce(regexp_extract(coalesce(h.account_label, ''), '(6[0-9]{2})', 1), ''), 1, 3)
    WHEN '600' THEN 'goods_for_resale'
    WHEN '601' THEN 'grapes'
    WHEN '602' THEN 'oenological'
    WHEN '621' THEN 'rent'
    WHEN '623' THEN 'professional'
    WHEN '624' THEN 'transport'
    WHEN '627' THEN 'marketing'
    WHEN '628' THEN 'utilities'
    ELSE 'other_services'
  END,
  'EUR',
  h.subtotal,
  h.total - h.subtotal + src.withheld,
  src.withheld,
  h.total,
  src.amount_paid,
  CASE
    WHEN src.amount_paid = 0 THEN 'unpaid'
    WHEN h.total > 0 AND src.amount_paid >= h.total THEN 'paid'
    ELSE 'partially_paid'
  END,
  h.due_date,
  billing.holded_payment(h.payment_method),
  CAST('00000000-0000-4000-8000-000000000047' AS UUID),
  CAST(h.issue_date AS TIMESTAMPTZ),
  CAST('00000000-0000-4000-8000-000000000047' AS UUID),
  CAST(h.issue_date AS TIMESTAMPTZ),
  CASE
    WHEN h.number_anomaly IS NOT NULL
      THEN 'Importada de Holded. Anomalía de numeración: ' || h.number_anomaly || '.'
    ELSE 'Importada de Holded.'
  END,
  json_object(
    'source', 'holded_import',
    'holded_invoice_id', CAST(h.id AS VARCHAR),
    'number_anomaly', coalesce(h.number_anomaly, ''),
    'status_holded', h.status_holded,
    'original_number', h.number,
    'original_vat', CAST(h.vat AS VARCHAR),
    'original_vat_2', CAST(coalesce(h.vat_2, 0) AS VARCHAR),
    'original_surcharge', CAST(h.surcharge AS VARCHAR),
    'original_withholding', CAST(h.withholding AS VARCHAR),
    'verifactu', 'not_applicable'
  ),
  'holded_import',
  CAST(h.issue_date AS TIMESTAMPTZ),
  CAST(h.issue_date AS TIMESTAMPTZ),
  'holded_import',
  h.id
FROM legacy.holded_invoice h
JOIN (
  SELECT
    h2.id,
    CASE
      WHEN h2.subtotal <= 0 OR h2.withholding = 0 THEN CAST(0 AS DECIMAL(14,2))
      ELSE CAST(round(
        CAST(h2.subtotal AS DOUBLE) * round(CAST(h2.withholding AS DOUBLE) / CAST(h2.subtotal AS DOUBLE) * 100, 2) / 100,
        2
      ) AS DECIMAL(14,2))
    END AS withheld,
    CASE
      WHEN lower(trim(h2.status_holded)) IN ('anulado', 'anulada', 'voided', 'cancelled', 'cancelada') THEN CAST(0 AS DECIMAL(14,2))
      WHEN h2.total <= 0 THEN CAST(0 AS DECIMAL(14,2))
      WHEN lower(trim(h2.status_holded)) IN ('pagado', 'pagada', 'cobrado', 'cobrada') THEN h2.total
      WHEN coalesce(h2.pending, 0) <= 0 THEN h2.total
      WHEN coalesce(h2.paid, 0) > 0 THEN least(greatest(h2.paid, CAST(0 AS DECIMAL(14,2))), h2.total)
      ELSE CAST(0 AS DECIMAL(14,2))
    END AS amount_paid,
    COALESCE(
      (SELECT c.id FROM party.contact c WHERE c.id = h2.counterparty_contact_id LIMIT 1),
      (
        SELECT c.id FROM party.contact c
        WHERE lower(trim(c.legal_name)) = lower(billing.holded_name(h2.counterparty_name))
        ORDER BY c.created_at
        LIMIT 1
      )
    ) AS supplier_id
  FROM legacy.holded_invoice h2
  WHERE h2.kind = 'purchase'
) src ON src.id = h.id
WHERE h.kind = 'purchase'
  AND src.supplier_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM purchasing.supplier_invoice s
    WHERE s.id = h.id OR s.holded_invoice_id = h.id
  )
ON CONFLICT (id) DO NOTHING;

-- Líneas de compra por tipo cuando cuadran y no hay recargo ni retención
-- (el libro de recibidas mete la retención en el tipo de la línea).
INSERT INTO purchasing.supplier_invoice_line (
  id, supplier_invoice_id, line_no, description, expense_account, quantity, unit_price,
  line_base, vat_rate, vat_quota, withholding_rate
)
SELECT
  billing.holded_uuid('purchase-line:' || CAST(g.invoice_id AS VARCHAR) || ':' || CAST(g.vat_rate AS VARCHAR)),
  g.invoice_id,
  CAST(g.line_no AS SMALLINT),
  CASE
    WHEN length(trim(coalesce(g.description, ''))) >= 1 THEN substring(trim(g.description), 1, 500)
    ELSE 'Compra histórica'
  END,
  g.expense_account,
  CAST(CASE WHEN g.line_base < 0 THEN -1 ELSE 1 END AS DECIMAL(14,3)),
  CAST(abs(g.line_base) AS DECIMAL(14,6)),
  CAST(g.line_base AS DECIMAL(14,2)),
  CAST(g.vat_rate AS DECIMAL(5,2)),
  CAST(g.vat_quota AS DECIMAL(14,2)),
  0
FROM (
  SELECT
    tagged.invoice_id,
    tagged.vat_rate,
    sum(tagged.line_base) AS line_base,
    sum(tagged.vat_quota) AS vat_quota,
    any_value(tagged.description) AS description,
    any_value(tagged.expense_account) AS expense_account,
    row_number() OVER (PARTITION BY tagged.invoice_id ORDER BY tagged.vat_rate) AS line_no
  FROM (
    SELECT
      h.id AS invoice_id,
      CAST(billing.holded_book_rate(
        billing.holded_tax_code(
          billing.holded_rate(coalesce(l.subtotal, 0), coalesce(l.tax_amount, 0)),
          l.tax_rate_label,
          0,
          (EXISTS (SELECT 1 FROM billing.tax_code WHERE code = 'IVA10'))
        ),
        billing.holded_rate(coalesce(l.subtotal, 0), coalesce(l.tax_amount, 0))
      ) AS DECIMAL(5,2)) AS vat_rate,
      coalesce(l.subtotal, 0) AS line_base,
      coalesce(l.tax_amount, 0) AS vat_quota,
      coalesce(l.description, l.item) AS description,
      CASE
        WHEN regexp_extract(coalesce(h.account_label, ''), '(6[0-9]{2,7})', 1) ~ '^6[0-9]{2,7}$'
          THEN regexp_extract(coalesce(h.account_label, ''), '(6[0-9]{2,7})', 1)
        ELSE '629'
      END AS expense_account
    FROM legacy.holded_invoice_line l
    JOIN legacy.holded_invoice h
      ON h.entity_id = l.entity_id AND h.kind = 'purchase'
     AND h.number = l.document_number AND h.issue_date = l.document_date
    JOIN purchasing.supplier_invoice s ON s.id = h.id AND s.origin = 'holded_import'
    WHERE l.kind = 'purchase'
      AND NOT l.is_draft
      AND h.surcharge = 0
      AND h.withholding = 0
      AND h.total - h.subtotal = h.vat + coalesce(h.vat_2, 0)
      AND (
        SELECT count(*) > 0
           AND CAST(coalesce(sum(coalesce(l2.subtotal, 0)), 0) AS DECIMAL(14,2)) = h.subtotal
           AND CAST(coalesce(sum(coalesce(l2.tax_amount, 0)), 0) AS DECIMAL(14,2)) = h.vat + coalesce(h.vat_2, 0)
        FROM legacy.holded_invoice_line l2
        WHERE l2.entity_id = h.entity_id AND l2.kind = 'purchase'
          AND l2.document_number = h.number AND l2.document_date = h.issue_date
          AND NOT l2.is_draft
      )
      AND NOT EXISTS (
        SELECT 1 FROM purchasing.supplier_invoice_line existing WHERE existing.supplier_invoice_id = h.id
      )
  ) tagged
  GROUP BY tagged.invoice_id, tagged.vat_rate
) g
ON CONFLICT (id) DO NOTHING;

-- Línea sintética: base, cuota (IVA + recargo + descuadre) y retención cuadran con el total.
INSERT INTO purchasing.supplier_invoice_line (
  id, supplier_invoice_id, line_no, description, expense_account, quantity, unit_price,
  line_base, vat_rate, vat_quota, withholding_rate
)
SELECT
  billing.holded_uuid('purchase-line:' || CAST(h.id AS VARCHAR)),
  h.id,
  1,
  'Histórico Holded',
  CASE
    WHEN regexp_extract(coalesce(h.account_label, ''), '(6[0-9]{2,7})', 1) ~ '^6[0-9]{2,7}$'
      THEN regexp_extract(coalesce(h.account_label, ''), '(6[0-9]{2,7})', 1)
    ELSE '629'
  END,
  CAST(CASE WHEN h.subtotal < 0 THEN -1 ELSE 1 END AS DECIMAL(14,3)),
  CAST(abs(h.subtotal) AS DECIMAL(14,6)),
  h.subtotal,
  CAST(CASE
    WHEN h.subtotal <= 0 THEN 0
    ELSE round(CAST(s.tax_total AS DOUBLE) / CAST(h.subtotal AS DOUBLE) * 100, 2)
  END AS DECIMAL(5,2)),
  s.tax_total,
  CAST(CASE
    WHEN h.subtotal <= 0 OR s.withholding_total = 0 THEN 0
    ELSE round(CAST(s.withholding_total AS DOUBLE) / CAST(h.subtotal AS DOUBLE) * 100, 2)
  END AS DECIMAL(5,2))
FROM legacy.holded_invoice h
JOIN purchasing.supplier_invoice s ON s.id = h.id AND s.origin = 'holded_import'
WHERE h.kind = 'purchase'
  AND NOT EXISTS (
    SELECT 1 FROM purchasing.supplier_invoice_line existing WHERE existing.supplier_invoice_id = h.id
  )
ON CONFLICT (id) DO NOTHING;
-- END HOLDED_PROJECT
