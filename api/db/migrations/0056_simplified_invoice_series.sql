-- WineCore · 0056_simplified_invoice_series · dialecto DuckDB (ADR 002).
-- Factura simplificada (F2, «Venta bodega») solo de CVPO.
-- Serie CS de 2026 y 2027, aparte de F26/F27. P.O no tiene serie simplificada.
-- cellar_sales es el canal de venta en bodega (tope 3.000 €, con web y cellar_shop).

INSERT INTO sales.channel (code, name_es)
SELECT 'cellar_sales', 'Venta en bodega'
WHERE NOT EXISTS (SELECT 1 FROM sales.channel WHERE code = 'cellar_sales');

INSERT INTO core.number_series (
  id, legal_entity_id, doc_type, code, year, prefix, padding, next_value, is_default, verifactu, is_active
)
SELECT gen_random_uuid(), e.id, 'simplified_invoice', 'CS', 2026, 'CS26-', 4, 1, TRUE, FALSE, TRUE
FROM core.legal_entity e
WHERE e.code = 'CVPO'
  AND NOT EXISTS (
    SELECT 1 FROM core.number_series s
    WHERE s.legal_entity_id = e.id AND s.doc_type = 'simplified_invoice' AND s.year = 2026
  );

INSERT INTO core.number_series (
  id, legal_entity_id, doc_type, code, year, prefix, padding, next_value, is_default, verifactu, is_active
)
SELECT gen_random_uuid(), e.id, 'simplified_invoice', 'CS', 2027, 'CS27-', 4, 1, TRUE, FALSE, TRUE
FROM core.legal_entity e
WHERE e.code = 'CVPO'
  AND NOT EXISTS (
    SELECT 1 FROM core.number_series s
    WHERE s.legal_entity_id = e.id AND s.doc_type = 'simplified_invoice' AND s.year = 2027
  );
