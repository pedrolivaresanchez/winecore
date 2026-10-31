-- =====================================================================
-- WineCore · Migración 0015 · conocimiento de añadas (knowledge) y fichas de etiqueta (catalog) — posterior
-- Notas de cata años después (módulo aparte) y datos de etiquetado (ingredientes, nutrición, e-etiqueta).
-- Especificación: docs/02-modelo-dominio.md §17 · Etiquetado: docs/04-regulatorio/etiquetado.md
-- =====================================================================

CREATE TABLE knowledge.tasting_note (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id      uuid REFERENCES catalog.wine(id),
  vintage      smallint CHECK (vintage BETWEEN 1990 AND 2100),
  lot_id       uuid REFERENCES inventory.lot(id),
  tasted_on    date NOT NULL,
  place        text,                                                   -- restaurante, feria, bodega
  glass        text,
  serving_temp_c numeric(4,1),
  score        smallint CHECK (score BETWEEN 0 AND 100),
  evolution    text CHECK (evolution IN ('improving','peak','stable','declining','faulty')),
  notes        text NOT NULL,
  author       text NOT NULL,
  source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (wine_id IS NOT NULL OR lot_id IS NOT NULL)
);
CREATE INDEX tasting_note_wine_idx ON knowledge.tasting_note(wine_id, vintage);

CREATE TABLE catalog.label_spec (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            uuid NOT NULL REFERENCES catalog.product(id),
  lot_id                uuid REFERENCES inventory.lot(id),             -- NULL = válida para todos los lotes de la añada
  version               integer NOT NULL CHECK (version >= 1),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  legal_name            text NOT NULL,                                 -- denominación de venta
  alcohol_pct_label     numeric(4,1) NOT NULL,
  nominal_volume_ml     integer NOT NULL,
  allergens             text[] NOT NULL DEFAULT '{sulphites}',
  ingredients           jsonb NOT NULL,                                -- lista ordenada con categorías (uva, conservantes, correctores de acidez…)
  nutrition_per_100ml   jsonb NOT NULL,                                -- energía kJ/kcal, grasas, hidratos, azúcares, proteínas, sal
  e_label_url           text,
  organic_control_code  text CHECK (organic_control_code ~ '^ES-ECO-[0-9]{3}-[A-Z]{2,3}$'), -- código del organismo de control
  organic_origin        text CHECK (organic_origin IN ('Agricultura España','Agricultura UE')),  -- mismo campo visual que el logotipo
  origin_statement      text NOT NULL DEFAULT 'Vino de España',        -- sin DOP/IGP no se citan unidades menores (2019/33 art. 55)
  bottler_statement     text NOT NULL,
  bottler_re_number     text,                                          -- nº de Registro de Envasadores (RD 1363/2011 art. 4)
  export_only           boolean NOT NULL DEFAULT false,                -- 1308/2013 art. 119.6 (Reg. 2026/471): sin ingredientes ni nutrición
  language              char(2) NOT NULL DEFAULT 'es',
  CHECK ((organic_control_code IS NULL) = (organic_origin IS NULL)),
  lot_format            text NOT NULL DEFAULT 'L{lot}',
  approved_by           uuid REFERENCES core.app_user(id),
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, language, version)
);

CREATE TRIGGER tasting_note_audit AFTER INSERT OR UPDATE ON knowledge.tasting_note FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER label_spec_audit AFTER INSERT OR UPDATE ON catalog.label_spec FOR EACH ROW EXECUTE FUNCTION audit.capture();
