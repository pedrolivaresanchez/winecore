-- WineCore · 0054_tasting_sheets · dialecto DuckDB (ADR 002).
-- Fichas de cata estructuradas. Las plantillas son datos (campos y orden).
-- Las fotos y el audio viven en core.attachment_link (rol photo / other).
-- La transcripción de voz es la columna voice_transcript.
-- Sin claves foráneas entre esquemas: el núcleo comprueba lote, recipiente,
-- parcela, vino, producto, usuario y adjunto (registro de guardas).

CREATE SCHEMA IF NOT EXISTS tasting;

CREATE TABLE tasting.descriptor (
  code       VARCHAR PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,40}$'),
  name_es    VARCHAR NOT NULL,
  family     VARCHAR NOT NULL CHECK (family IN ('visual','nose','mouth','defect','other')),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasting.template (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name        VARCHAR NOT NULL,
  subject     VARCHAR NOT NULL CHECK (subject IN ('grape','must','wine_aging','blend_candidate','bottle')),
  score_scale VARCHAR NOT NULL CHECK (score_scale IN ('0-10','0-100')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  VARCHAR NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasting.template_field (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES tasting.template(id),
  field_key   VARCHAR NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,40}$'),
  label       VARCHAR NOT NULL,
  kind        VARCHAR NOT NULL CHECK (kind IN ('text','number','integer','scale','select','boolean','date')),
  required    BOOLEAN NOT NULL DEFAULT FALSE,
  position    INTEGER NOT NULL CHECK (position >= 0),
  options     JSON,
  min_value   DECIMAL(12,4),
  max_value   DECIMAL(12,4),
  unit        VARCHAR,
  help        VARCHAR,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, field_key)
);

CREATE INDEX tfield_template_idx ON tasting.template_field(template_id, position);

CREATE TABLE tasting.note (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       UUID NOT NULL REFERENCES tasting.template(id),
  tasted_at         TIMESTAMPTZ NOT NULL,
  taster_user_id    UUID,
  taster_name       VARCHAR NOT NULL,
  subject           VARCHAR NOT NULL CHECK (subject IN ('grape','must','wine_aging','blend_candidate','bottle')),
  parcel_id         UUID,
  lot_id            UUID,
  vessel_id         UUID,
  product_id        UUID,
  wine_id           UUID,
  vintage           SMALLINT CHECK (vintage IS NULL OR vintage BETWEEN 1990 AND 2100),
  score_scale       VARCHAR NOT NULL CHECK (score_scale IN ('0-10','0-100')),
  visual_score      DECIMAL(5,2),
  nose_score        DECIMAL(5,2),
  mouth_score       DECIMAL(5,2),
  overall_score     DECIMAL(5,2),
  descriptors       JSON NOT NULL DEFAULT '[]'::JSON,
  descriptors_text  VARCHAR,
  defects           JSON NOT NULL DEFAULT '[]'::JSON,
  decision          VARCHAR,
  notes             VARCHAR,
  voice_transcript  VARCHAR,
  place             VARCHAR,
  glass             VARCHAR,
  context           VARCHAR,
  evolution         VARCHAR CHECK (evolution IS NULL OR evolution IN ('improving','peak','stable','declining','faulty')),
  answers           JSON NOT NULL DEFAULT '{}'::JSON,
  source            VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_by        VARCHAR NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (subject = 'grape' AND parcel_id IS NOT NULL)
    OR (subject IN ('must','wine_aging','blend_candidate') AND lot_id IS NOT NULL)
    OR (subject = 'bottle' AND (lot_id IS NOT NULL OR wine_id IS NOT NULL OR product_id IS NOT NULL))
  )
);

CREATE INDEX tnote_lot_idx ON tasting.note(lot_id, tasted_at);
CREATE INDEX tnote_wine_idx ON tasting.note(wine_id, vintage, tasted_at);
CREATE INDEX tnote_parcel_idx ON tasting.note(parcel_id, tasted_at);

INSERT INTO tasting.descriptor(code, name_es, family) VALUES
 ('ruby', 'Rubí', 'visual'),
 ('garnet', 'Granate', 'visual'),
 ('purple', 'Púrpura', 'visual'),
 ('gold', 'Dorado', 'visual'),
 ('pale', 'Pálido', 'visual'),
 ('bright', 'Brillante', 'visual'),
 ('cloudy', 'Turbio', 'visual'),
 ('red_fruit', 'Fruta roja', 'nose'),
 ('black_fruit', 'Fruta negra', 'nose'),
 ('citrus', 'Cítrico', 'nose'),
 ('floral', 'Floral', 'nose'),
 ('yeast', 'Levadura', 'nose'),
 ('oak', 'Madera', 'nose'),
 ('butter', 'Mantequilla', 'nose'),
 ('mineral', 'Mineral', 'nose'),
 ('vegetal', 'Vegetal', 'nose'),
 ('acid', 'Ácido', 'mouth'),
 ('tannic', 'Tánico', 'mouth'),
 ('sweet', 'Dulce', 'mouth'),
 ('bitter', 'Amargo', 'mouth'),
 ('saline', 'Salino', 'mouth'),
 ('long_finish', 'Final largo', 'mouth'),
 ('short_finish', 'Final corto', 'mouth'),
 ('balanced', 'Equilibrado', 'mouth'),
 ('volatile', 'Volátil', 'defect'),
 ('reduction', 'Reducción', 'defect'),
 ('oxidation', 'Oxidación', 'defect'),
 ('brett', 'Brett', 'defect'),
 ('cork', 'Corcho', 'defect'),
 ('mouse', 'Ratón', 'defect');

INSERT INTO tasting.template(id, code, name, subject, score_scale, created_by) VALUES
 (CAST('019a5400-0000-7000-8000-000000000001' AS UUID), 'UVA', 'Uva en viña', 'grape', '0-10', 'migration'),
 (CAST('019a5400-0000-7000-8000-000000000002' AS UUID), 'MOSTO', 'Mosto en fermentación', 'must', '0-10', 'migration'),
 (CAST('019a5400-0000-7000-8000-000000000003' AS UUID), 'CRIANZA', 'Vino en crianza', 'wine_aging', '0-10', 'migration'),
 (CAST('019a5400-0000-7000-8000-000000000004' AS UUID), 'ENSAMBLAJE', 'Candidato a ensamblaje', 'blend_candidate', '0-10', 'migration'),
 (CAST('019a5400-0000-7000-8000-000000000005' AS UUID), 'BOTELLA', 'Botella años después', 'bottle', '0-100', 'migration');

INSERT INTO tasting.template_field(
  id, template_id, field_key, label, kind, required, position, options, min_value, max_value, help
) VALUES
 (CAST('019a5401-0000-7000-8000-000000000001' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'seed_colour', 'Color de la pepita', 'select', TRUE, 10, '["green","brown","brown_striped"]'::JSON, NULL, NULL, 'Verde, marrón o marrón rallado'),
 (CAST('019a5401-0000-7000-8000-000000000002' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'seed_crunch', 'Crujido de la pepita', 'select', TRUE, 20, '["soft","firm","crunchy"]'::JSON, NULL, NULL, 'Blanda, firme o crujiente'),
 (CAST('019a5401-0000-7000-8000-000000000003' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'skin_astringency', 'Astringencia del hollejo', 'scale', TRUE, 30, NULL, 1, 5, '1 suave, 5 muy astringente'),
 (CAST('019a5401-0000-7000-8000-000000000004' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'skin_colour', 'Color del hollejo', 'select', TRUE, 40, '["green","pink","red","purple"]'::JSON, NULL, NULL, NULL),
 (CAST('019a5401-0000-7000-8000-000000000005' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'pulp_sweetness', 'Dulzor de la pulpa', 'scale', TRUE, 50, NULL, 1, 5, NULL),
 (CAST('019a5401-0000-7000-8000-000000000006' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'pulp_acidity', 'Acidez de la pulpa', 'scale', TRUE, 60, NULL, 1, 5, NULL),
 (CAST('019a5401-0000-7000-8000-000000000007' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'phenolic_maturity', 'Madurez fenólica', 'integer', TRUE, 70, NULL, 1, 5, 'Escala 1 a 5'),
 (CAST('019a5401-0000-7000-8000-000000000008' AS UUID), CAST('019a5400-0000-7000-8000-000000000001' AS UUID),
  'estimated_days_to_harvest', 'Días estimados para vendimia', 'integer', TRUE, 80, NULL, 0, 90, NULL),
 (CAST('019a5401-0000-7000-8000-000000000009' AS UUID), CAST('019a5400-0000-7000-8000-000000000002' AS UUID),
  'sweetness_impression', 'Impresión de dulzor', 'scale', FALSE, 10, NULL, 1, 5, 'Cata diaria del mosto'),
 (CAST('019a5401-0000-7000-8000-000000000010' AS UUID), CAST('019a5400-0000-7000-8000-000000000002' AS UUID),
  'ferment_aroma', 'Aroma fermentativo', 'text', FALSE, 20, NULL, NULL, NULL, NULL),
 (CAST('019a5401-0000-7000-8000-000000000011' AS UUID), CAST('019a5400-0000-7000-8000-000000000002' AS UUID),
  'co2', 'Hay carbónico', 'boolean', FALSE, 30, NULL, NULL, NULL, NULL),
 (CAST('019a5401-0000-7000-8000-000000000012' AS UUID), CAST('019a5400-0000-7000-8000-000000000003' AS UUID),
  'fruit', 'Fruta', 'scale', FALSE, 10, NULL, 1, 5, 'Cata periódica en crianza'),
 (CAST('019a5401-0000-7000-8000-000000000013' AS UUID), CAST('019a5400-0000-7000-8000-000000000003' AS UUID),
  'oak', 'Madera', 'scale', FALSE, 20, NULL, 1, 5, NULL),
 (CAST('019a5401-0000-7000-8000-000000000014' AS UUID), CAST('019a5400-0000-7000-8000-000000000003' AS UUID),
  'tannin', 'Tanino', 'scale', FALSE, 30, NULL, 1, 5, NULL),
 (CAST('019a5401-0000-7000-8000-000000000015' AS UUID), CAST('019a5400-0000-7000-8000-000000000003' AS UUID),
  'balance', 'Equilibrio', 'scale', FALSE, 40, NULL, 1, 5, NULL),
 (CAST('019a5401-0000-7000-8000-000000000016' AS UUID), CAST('019a5400-0000-7000-8000-000000000004' AS UUID),
  'role', 'Papel en el ensamblaje', 'select', FALSE, 10, '["structure","fruit","freshness","oak"]'::JSON, NULL, NULL, NULL),
 (CAST('019a5401-0000-7000-8000-000000000017' AS UUID), CAST('019a5400-0000-7000-8000-000000000004' AS UUID),
  'fit_comment', 'Encaje con el objetivo', 'text', FALSE, 20, NULL, NULL, NULL, NULL),
 (CAST('019a5401-0000-7000-8000-000000000018' AS UUID), CAST('019a5400-0000-7000-8000-000000000005' AS UUID),
  'place', 'Lugar', 'text', TRUE, 10, NULL, NULL, NULL, 'Restaurante, feria o casa'),
 (CAST('019a5401-0000-7000-8000-000000000019' AS UUID), CAST('019a5400-0000-7000-8000-000000000005' AS UUID),
  'glass', 'Copa', 'text', TRUE, 20, NULL, NULL, NULL, NULL),
 (CAST('019a5401-0000-7000-8000-000000000020' AS UUID), CAST('019a5400-0000-7000-8000-000000000005' AS UUID),
  'context', 'Contexto', 'text', TRUE, 30, NULL, NULL, NULL, 'Comida, compañía, servicio'),
 (CAST('019a5401-0000-7000-8000-000000000021' AS UUID), CAST('019a5400-0000-7000-8000-000000000005' AS UUID),
  'evolution', 'Evolución', 'select', TRUE, 40, '["improving","peak","stable","declining","faulty"]'::JSON, NULL, NULL, NULL);
