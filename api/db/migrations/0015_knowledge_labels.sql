-- WineCore · 0015_knowledge_labels · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0015_knowledge_labels.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0015 · conocimiento de añadas (knowledge) y fichas de etiqueta (catalog) — posterior
-- Notas de cata años después (módulo aparte) y datos de etiquetado (ingredientes, nutrición, e-etiqueta).
-- Especificación: docs/02-modelo-dominio.md §17 · Etiquetado: docs/04-regulatorio/etiquetado.md
-- =====================================================================

CREATE TABLE knowledge.tasting_note (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id      uuid,
  vintage      smallint CHECK (vintage BETWEEN 1990 AND 2100),
  lot_id       uuid,
  tasted_on    date NOT NULL,
  place        VARCHAR,                                                   -- restaurante, feria, bodega
  glass        VARCHAR,
  serving_temp_c DECIMAL(4,1),
  score        smallint CHECK (score BETWEEN 0 AND 100),
  evolution    VARCHAR CHECK (evolution IN ('improving','peak','stable','declining','faulty')),
  notes        VARCHAR NOT NULL,
  author       VARCHAR NOT NULL,
  source       VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (wine_id IS NOT NULL OR lot_id IS NOT NULL)
);

CREATE INDEX tasting_note_wine_idx ON knowledge.tasting_note(wine_id, vintage);


CREATE TABLE catalog.label_spec (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            uuid NOT NULL REFERENCES catalog.product(id),
  lot_id                uuid,             -- NULL = válida para todos los lotes de la añada
  version               integer NOT NULL CHECK (version >= 1),
  status                VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  legal_name            VARCHAR NOT NULL,                                 -- denominación de venta
  alcohol_pct_label     DECIMAL(4,1) NOT NULL,
  nominal_volume_ml     integer NOT NULL,
  allergens             VARCHAR[] NOT NULL DEFAULT ['sulphites'],
  ingredients           JSON NOT NULL,                                -- lista ordenada con categorías (uva, conservantes, correctores de acidez…)
  nutrition_per_100ml   JSON NOT NULL,                                -- energía kJ/kcal, grasas, hidratos, azúcares, proteínas, sal
  e_label_url           VARCHAR,
  organic_control_code  VARCHAR CHECK (organic_control_code ~ '^ES-ECO-[0-9]{3}-[A-Z]{2,3}$'), -- código del organismo de control
  organic_origin        VARCHAR CHECK (organic_origin IN ('Agricultura España','Agricultura UE')),  -- mismo campo visual que el logotipo
  origin_statement      VARCHAR NOT NULL DEFAULT 'Vino de España',        -- sin DOP/IGP no se citan unidades menores (2019/33 art. 55)
  bottler_statement     VARCHAR NOT NULL,
  bottler_re_number     VARCHAR,                                          -- nº de Registro de Envasadores (RD 1363/2011 art. 4)
  export_only           boolean NOT NULL DEFAULT false,                -- 1308/2013 art. 119.6 (Reg. 2026/471): sin ingredientes ni nutrición
  language              VARCHAR NOT NULL DEFAULT 'es',
  CHECK ((organic_control_code IS NULL) = (organic_origin IS NULL)),
  lot_format            VARCHAR NOT NULL DEFAULT 'L{lot}',
  approved_by           uuid,
  approved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, language, version)
);
