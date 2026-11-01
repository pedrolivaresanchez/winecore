-- IVA reducido 10 %: servicios de hostelería y catas (petición de Pedro, 01-11-2026). Mismos
-- campos Verifactu que el IVA general (impuesto 01, clave de régimen 01, operación sujeta S1);
-- solo cambia el tipo.
INSERT INTO billing.tax_code(code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate, withholding_rate, legal_mention_es, legal_mention_en, requires_vat_id)
SELECT 'IVA10', 'IVA reducido 10 %', '01', '01', 'S1', NULL, 10.00, 0.00, 0.00, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM billing.tax_code WHERE code = 'IVA10');
