-- WineCore · 0038_integration_overlap · dialecto DuckDB (ADR 002).
-- Una sola lista de prácticas (unión de diseño de lote y elaboración).
-- Los umbrales de elaboración leen cellar.enology_setting, alias de enology.parameter.
-- DuckDB 1.5 no admite ADD COLUMN con DEFAULT ni NOT NULL.

ALTER TABLE cellar.practice ADD COLUMN prohibited_by_house BOOLEAN;

UPDATE cellar.practice SET prohibited_by_house = FALSE WHERE prohibited_by_house IS NULL;

INSERT INTO cellar.practice (code, name_es, intervention, prohibited_by_house) VALUES
  ('settling', 'Desfangado', TRUE, FALSE),
  ('levaduras_comerciales', 'Levaduras comerciales', TRUE, FALSE),
  ('sulfitado', 'Sulfitado', TRUE, FALSE),
  ('carbon_activo', 'Carbón activo', TRUE, TRUE);

-- Alias de los umbrales que la elaboración ya consultaba por clave.
-- La fila de plantilla tiene legal_entity_id NULL. La de la entidad la tapa.
CREATE VIEW cellar.enology_setting AS
SELECT
  legal_entity_id,
  entity_key,
  CASE code
    WHEN 'volatile_acidity_alert_g_l' THEN 'volatile_acidity_alert'
    WHEN 'dryness_glucose_fructose_g_l' THEN 'dry_sugars_max'
    WHEN 'malolactic_malic_g_l' THEN 'fml_malic_max'
  END AS key,
  value_num AS value
FROM enology.parameter
WHERE superseded_at IS NULL
  AND code IN (
    'volatile_acidity_alert_g_l',
    'dryness_glucose_fructose_g_l',
    'malolactic_malic_g_l'
  );
