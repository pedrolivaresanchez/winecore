-- IVA reducido 10 % (petición de Pedro, 01-11-2026): necesario para catas y otros
-- servicios al tipo reducido. El sistema de IVA es una tabla de códigos, así que añadir
-- o cambiar tipos en el futuro es insertar o actualizar una fila en billing.tax_code.
INSERT INTO billing.tax_code(code, name_es, tax, regime_key, qualification, exemption, rate, surcharge_rate, withholding_rate, legal_mention_es, legal_mention_en, requires_vat_id) VALUES
 ('IVA10', 'IVA reducido 10 %', '01','01','S1',NULL, 10.00, 0.00, 0.00, NULL, NULL, false)
ON CONFLICT (code) DO NOTHING;
