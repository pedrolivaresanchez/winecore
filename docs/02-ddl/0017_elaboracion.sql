-- =====================================================================
-- WineCore · Migración 0017 · elaboración completa (cobertura de la reunión de arranque)
-- Zonas y plano, barricas, jaulones y nichos; recepción con sanidad; fases del lote (maceraciones,
-- FA, FML, estabilizaciones, crianza); diseño del lote, prácticas y recetas; catas estructuradas y
-- cata a ciegas; analíticas ampliadas; ajustes enológicos y mermas legales; filtración por placas;
-- higiene, equipos y control de envasado; cata de uva y planificador de vendimia.
-- Especificación: docs/02-modelo-dominio.md §8.1, §9.1–§9.7, §15 · docs/00-cobertura-reunion.md
-- =====================================================================

-- ---------------------------------------------------------------------
-- Zonas de una ubicación y plano de la bodega (§8.1)
-- ---------------------------------------------------------------------
CREATE TABLE inventory.location_zone (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id        uuid NOT NULL REFERENCES inventory.location(id),
  code               text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('production_hall','barrel_room','outdoor','bottle_store','other')),
  plan_attachment_id uuid REFERENCES core.attachment(id),                       -- imagen del plano de la zona
  is_active          boolean NOT NULL DEFAULT true,
  UNIQUE (location_id, code)
);

-- Posición de un recipiente en el plano de su zona (coordenadas relativas 0–1)
CREATE TABLE cellar.vessel_position (
  vessel_id    uuid PRIMARY KEY REFERENCES cellar.vessel(id),
  zone_id      uuid NOT NULL REFERENCES inventory.location_zone(id),
  x            numeric(6,4) NOT NULL CHECK (x BETWEEN 0 AND 1),
  y            numeric(6,4) NOT NULL CHECK (y BETWEEN 0 AND 1),
  width        numeric(6,4) NOT NULL CHECK (width > 0 AND width <= 1),
  height       numeric(6,4) NOT NULL CHECK (height > 0 AND height <= 1),
  rotation_deg smallint NOT NULL DEFAULT 0 CHECK (rotation_deg BETWEEN 0 AND 359)
);

-- Atributos de barrica (1:1 con un recipiente de clase barrel). Los usos suben al llenar una barrica vacía.
CREATE TABLE cellar.barrel (
  vessel_id        uuid PRIMARY KEY REFERENCES cellar.vessel(id),
  oak_origin       text NOT NULL CHECK (oak_origin IN ('french','american','central_european','spanish','other')),
  forest           text,
  toast            text NOT NULL CHECK (toast IN ('light','medium','medium_plus','heavy')),
  head_toast       boolean NOT NULL DEFAULT false,
  cooper           text NOT NULL,
  manufacture_year smallint CHECK (manufacture_year BETWEEN 1950 AND 2100),
  purchased_on     date,
  uses             smallint NOT NULL DEFAULT 0 CHECK (uses >= 0),
  status           text NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use','resting','to_retire','retired')),
  retired_on       date,
  CHECK (status <> 'retired' OR retired_on IS NOT NULL)
);

-- Contenedores de botellas: jaulón numerado (≈600 botellas sin etiquetar) y nicho (hueco de botellero)
CREATE TABLE cellar.bottle_holder (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),     -- 'JAU-001', 'NICHO-A3'
  kind           text NOT NULL CHECK (kind IN ('cage','niche')),
  location_id    uuid NOT NULL REFERENCES inventory.location(id),
  zone_id        uuid REFERENCES inventory.location_zone(id),
  capacity_units integer NOT NULL CHECK (capacity_units > 0),
  format_id      uuid REFERENCES catalog.format(id),
  status         text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','retired')),
  notes          text
);
ALTER TABLE cellar.operation_line ADD COLUMN holder_id uuid REFERENCES cellar.bottle_holder(id);
ALTER TABLE inventory.stock_move  ADD COLUMN holder_id uuid REFERENCES cellar.bottle_holder(id);

-- ---------------------------------------------------------------------
-- Nuevos tipos de operación y conservación (§9.2)
-- ---------------------------------------------------------------------
ALTER TABLE cellar.operation DROP CONSTRAINT operation_op_type_check;
ALTER TABLE cellar.operation ADD CONSTRAINT operation_op_type_check CHECK (op_type IN (
  'reception','bulk_reception','crushing_pressing','fermentation_end','racking','blend','filtration',
  'addition','stabilization','cleaning','sampling','bottling','labeling','loss','destruction',
  'bleeding',             -- sangrado: parte del mosto/vino de un depósito pasa a otro como lote nuevo
  'pressing_off',         -- descube: vino yema y de prensa salen del depósito con hollejos
  'delestage',            -- délestage: vaciado y retorno al mismo depósito (sin movimiento neto)
  'temperature_control'   -- corrección de temperatura (subir/bajar consigna), sin volumen
));

CREATE OR REPLACE FUNCTION cellar.check_operation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o cellar.operation;
  v_in bigint; v_out bigint; v_loss bigint;
  u_in bigint; u_out bigint; u_loss bigint;
  m_in bigint; m_out bigint;
  n_in int; n_out int;
BEGIN
  SELECT * INTO o FROM cellar.operation WHERE id = NEW.id;
  IF o.status <> 'confirmed' THEN RETURN NULL; END IF;
  SELECT coalesce(sum(volume_ml) FILTER (WHERE role='input'),0),
         coalesce(sum(volume_ml) FILTER (WHERE role='output'),0),
         coalesce(sum(volume_ml) FILTER (WHERE role='loss'),0),
         coalesce(sum(qty_units) FILTER (WHERE role='input'),0),
         coalesce(sum(qty_units) FILTER (WHERE role='output'),0),
         coalesce(sum(qty_units) FILTER (WHERE role='loss'),0),
         coalesce(sum(mass_g)    FILTER (WHERE role='input'),0),
         coalesce(sum(mass_g)    FILTER (WHERE role='output'),0),
         count(*) FILTER (WHERE role='input'),
         count(*) FILTER (WHERE role='output')
    INTO v_in, v_out, v_loss, u_in, u_out, u_loss, m_in, m_out, n_in, n_out
    FROM cellar.operation_line WHERE operation_id = o.id;

  IF o.op_type IN ('fermentation_end','racking','blend','filtration','bottling','bleeding','pressing_off') THEN
    IF n_in = 0 OR n_out = 0 THEN
      RAISE EXCEPTION 'WC020: % necesita entradas y salidas', o.op_type;
    END IF;
    IF v_in <> v_out + v_loss THEN
      RAISE EXCEPTION 'WC020: conservación de volumen incumplida en % (entra % mL, sale % mL, merma % mL)', o.number, v_in, v_out, v_loss;
    END IF;
  ELSIF o.op_type = 'labeling' THEN
    IF u_in <> u_out + u_loss OR n_in = 0 OR n_out = 0 THEN
      RAISE EXCEPTION 'WC020: conservación de unidades incumplida en % (entra %, sale %, roturas %)', o.number, u_in, u_out, u_loss;
    END IF;
  ELSIF o.op_type IN ('reception','bulk_reception') THEN
    IF n_in > 0 OR n_out = 0 THEN
      RAISE EXCEPTION 'WC020: % solo admite líneas de salida (entrada externa)', o.op_type;
    END IF;
  ELSIF o.op_type = 'crushing_pressing' THEN
    IF m_in = 0 OR v_out = 0 THEN
      RAISE EXCEPTION 'WC020: el prensado necesita uva (kg) de entrada y mosto (L) de salida';
    END IF;
  ELSIF o.op_type IN ('loss','destruction','sampling') THEN
    IF n_out > 0 OR (v_loss + u_loss + v_in + u_in) = 0 THEN
      RAISE EXCEPTION 'WC020: % solo admite líneas de merma/entrada', o.op_type;
    END IF;
  ELSIF o.op_type IN ('delestage','temperature_control') THEN
    IF n_in + n_out > 0 THEN
      RAISE EXCEPTION 'WC020: % no mueve volumen; los datos van en details', o.op_type;
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Recepción de uva: contenedores, pesada y sanidad (§9.2)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.grape_intake (
  operation_id        uuid PRIMARY KEY REFERENCES cellar.operation(id),      -- op_type = 'reception'
  container           text NOT NULL CHECK (container IN ('box','bin','tank_trailer','bulk','other')),
  container_count     integer CHECK (container_count > 0),
  container_nominal_kg numeric(7,2) CHECK (container_nominal_kg > 0),          -- p. ej. cajas de 20 kg
  weighing            text NOT NULL CHECK (weighing IN ('weighed','estimated')),
  sanitary_state      text NOT NULL CHECK (sanitary_state IN ('healthy','minor','affected','severe')),
  botrytis_pct        numeric(5,2) CHECK (botrytis_pct BETWEEN 0 AND 100),
  storm_damage        boolean NOT NULL DEFAULT false,                          -- tormenta o granizo
  overripe            boolean NOT NULL DEFAULT false,                          -- sobremaduración
  raisined            boolean NOT NULL DEFAULT false,                          -- pasificación
  microbial_notes     text,                                                    -- infecciones, microorganismos
  decision            text NOT NULL DEFAULT 'accepted' CHECK (decision IN ('accepted','segregated','rejected')),
  grape_temperature_c numeric(4,1) CHECK (grape_temperature_c BETWEEN -5 AND 50),
  CHECK (container <> 'box' OR container_count IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Fases del lote: maceraciones, fermentaciones, estabilizaciones y crianza (§9.3)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.lot_phase (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id           uuid REFERENCES cellar.vessel(id),
  phase               text NOT NULL CHECK (phase IN (
                        'cold_soak',                    -- maceración prefermentativa en frío
                        'aqueous_maceration',           -- maceración acuosa: fermentación paralizada con frío
                        'skin_maceration',              -- encubado con hollejos (tintos y blancos en tinto)
                        'post_fermentation_maceration',
                        'alcoholic_fermentation',
                        'malolactic_fermentation',
                        'natural_cold_stabilisation',   -- frío de invierno
                        'forced_cold_stabilisation',
                        'protein_stabilisation',
                        'aging')),
  status              text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('planned','in_progress','completed','stopped')),
  started_at          timestamptz,
  ended_at            timestamptz,
  inoculation         text CHECK (inoculation IN ('spontaneous','commercial')),   -- solo fermentaciones
  inoculum_product_id uuid REFERENCES catalog.product(id),
  target_temp_c       numeric(4,1),                                             -- p. ej. −(grado/2 + 1) en estabilización por frío
  aging_method        text CHECK (aging_method IN ('tank','barrel','demijohn_outdoor')),
  end_evidence        text CHECK (end_evidence IN ('sensory','analysis','both')),
  end_analysis_id     uuid REFERENCES cellar.analysis(id),
  observations        text,                                                     -- burbujeo, aroma lácteo, depósitos de bitartrato…
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
  CHECK (status <> 'completed' OR ended_at IS NOT NULL),
  CHECK (inoculation IS NULL OR phase IN ('alcoholic_fermentation','malolactic_fermentation')),
  CHECK (inoculation IS DISTINCT FROM 'commercial' OR inoculum_product_id IS NOT NULL),
  CHECK (aging_method IS NULL OR phase = 'aging')
);
CREATE INDEX lot_phase_lot_idx ON cellar.lot_phase(lot_id, phase);

-- ---------------------------------------------------------------------
-- Diseño del lote, prácticas y recetas (§9.5)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.practice (
  code                 text PRIMARY KEY,
  name_es              text NOT NULL,
  prohibited_by_house  boolean NOT NULL DEFAULT false,      -- p. ej. carbón activo: bloquea la operación (WC140)
  allowed_after_fml    boolean NOT NULL DEFAULT false       -- tras la FML solo el SO2 está permitido sin aviso
);
INSERT INTO cellar.practice(code, name_es, prohibited_by_house, allowed_after_fml) VALUES
 ('sulphiting',          'Sulfitado (SO2)',                 false, true),
 ('acidification',       'Acidificación (ácido tartárico)', false, false),
 ('settling',            'Desfangado',                      false, false),
 ('centrifugation',      'Centrifugado',                    false, false),
 ('commercial_yeast',    'Levaduras comerciales',           false, false),
 ('protein_stabilisation','Estabilización proteica',        false, false),
 ('fining',              'Clarificación',                   false, false),
 ('filtration',          'Filtración',                      false, true),
 ('activated_carbon',    'Carbón activo',                   true,  false);

CREATE TABLE cellar.recipe (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,30}$'),
  version        smallint NOT NULL CHECK (version > 0),
  name           text NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  source_lot_id  uuid REFERENCES inventory.lot(id),                          -- lote del que se capturó
  steps          jsonb NOT NULL,                                             -- pasos ordenados: tipo, duración, temperatura, dosis/hL, prácticas
  published_by   uuid REFERENCES core.app_user(id),
  published_at   timestamptz,
  UNIQUE (code, version),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE cellar.lot_design (
  lot_id                   uuid PRIMARY KEY REFERENCES inventory.lot(id),
  intended_destination     text NOT NULL DEFAULT 'undecided' CHECK (intended_destination IN ('reference','new_collection','undecided')),
  destination_wine_id      uuid REFERENCES catalog.wine(id),
  destination_working_name text,
  vinification_type        text CHECK (vinification_type IN ('white','red','rose','white_skin_contact','other')),  -- white_skin_contact = blanca vinificada en tinto
  destemmed                boolean,
  inoculation              text CHECK (inoculation IN ('spontaneous','commercial')),
  aging_method             text CHECK (aging_method IN ('tank','barrel','demijohn_outdoor','none')),
  single_plot              boolean NOT NULL DEFAULT false,                  -- la genealogía llega a una sola parcela (WC141)
  single_plot_parcel_id    uuid REFERENCES vineyard.parcel(id),
  label_number             smallint CHECK (label_number > 0),               -- p. ej. 1 = parcela única, 2 = ensamblaje
  no_intervention          boolean NOT NULL DEFAULT false,
  recipe_id                uuid REFERENCES cellar.recipe(id),
  CHECK (intended_destination <> 'reference' OR destination_wine_id IS NOT NULL),
  CHECK (intended_destination <> 'new_collection' OR destination_working_name IS NOT NULL),
  CHECK (single_plot = (single_plot_parcel_id IS NOT NULL))
);

CREATE TABLE cellar.lot_practice (
  lot_id        uuid NOT NULL REFERENCES inventory.lot(id),
  practice_code text NOT NULL REFERENCES cellar.practice(code),
  applied       boolean NOT NULL,                                            -- false = práctica que la casa NO aplica (p. ej. desfangado)
  notes         text,
  PRIMARY KEY (lot_id, practice_code)
);

-- ---------------------------------------------------------------------
-- Catas estructuradas y cata a ciegas (§9.4)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.tasting_template (
  code     text PRIMARY KEY,
  subject  text NOT NULL CHECK (subject IN ('grape','must','wine','blend_candidate','post_sale')),
  version  smallint NOT NULL DEFAULT 1,
  fields   jsonb NOT NULL                                                    -- campos y escalas (vista, nariz, boca, pepita, hollejo…)
);

ALTER TABLE cellar.tasting ALTER COLUMN lot_id DROP NOT NULL;
ALTER TABLE cellar.tasting
  ADD COLUMN template_code text REFERENCES cellar.tasting_template(code),
  ADD COLUMN parcel_id     uuid REFERENCES vineyard.parcel(id),
  ADD COLUMN product_id    uuid REFERENCES catalog.product(id),
  ADD COLUMN scores        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN descriptors   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN defects       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN overall_score numeric(5,2),
  ADD COLUMN context       jsonb,                                            -- posventa: lugar, copa, años desde el envasado
  ADD COLUMN attachment_ids uuid[] NOT NULL DEFAULT '{}',                    -- fotos y audio del dictado
  ADD CONSTRAINT tasting_subject_check CHECK (lot_id IS NOT NULL OR parcel_id IS NOT NULL OR product_id IS NOT NULL);

CREATE TABLE cellar.blind_session (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  target_wine_id   uuid REFERENCES catalog.wine(id),
  target_label     text,                                                     -- 'nueva colección' u otro destino sin ficha
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','revealed','closed')),
  created_by       uuid NOT NULL REFERENCES core.app_user(id),
  CHECK (ends_on >= starts_on),
  CHECK (target_wine_id IS NOT NULL OR target_label IS NOT NULL)
);
CREATE TABLE cellar.blind_sample (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cellar.blind_session(id),
  number     smallint NOT NULL CHECK (number > 0),                           -- lo único que ve el catador hasta revelar
  lot_id     uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id  uuid REFERENCES cellar.vessel(id),
  UNIQUE (session_id, number)
);
CREATE TABLE cellar.blind_vote (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id  uuid NOT NULL REFERENCES cellar.blind_sample(id),
  taster     text NOT NULL,
  voted_on   date NOT NULL,
  selected   boolean NOT NULL,                                               -- sí / no para el destino de la sesión
  score      numeric(5,2),
  comment    text,
  UNIQUE (sample_id, taster, voted_on)
);

-- ---------------------------------------------------------------------
-- Analíticas: origen, laboratorio, muestra y parámetros nuevos (§9.3)
-- ---------------------------------------------------------------------
ALTER TABLE cellar.analysis ALTER COLUMN lot_id DROP NOT NULL;
ALTER TABLE cellar.analysis
  ADD COLUMN parcel_id           uuid REFERENCES vineyard.parcel(id),       -- muestras de uva antes de vendimia
  ADD COLUMN lab_contact_id      uuid REFERENCES party.contact(id),        -- laboratorio externo como proveedor
  ADD COLUMN sample_operation_id uuid REFERENCES cellar.operation(id),     -- toma de muestras (sampling) tras homogeneizar
  ADD COLUMN result_at           timestamptz,
  ADD CONSTRAINT analysis_subject_check CHECK (lot_id IS NOT NULL OR parcel_id IS NOT NULL),
  ADD CONSTRAINT analysis_result_after_sample_check CHECK (result_at IS NULL OR result_at >= sampled_at);

INSERT INTO cellar.analysis_parameter(code, name_es, unit, min_value, max_value) VALUES
 ('polymerization_index', 'Índice de polimerización (IP)', '%',   0, 100),
 ('turbidity',            'Turbidez',                      'NTU', 0, 1000);

-- ---------------------------------------------------------------------
-- Ajustes enológicos (umbrales y objetivos) y mermas legales (§9.3)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.enology_setting (
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  key             text NOT NULL CHECK (key IN (
                    'so2_molecular_target_red','so2_molecular_target_white',
                    'volatile_acidity_alert','dry_sugars_max','fml_malic_max',
                    'prebottling_analysis_max_age_days','probable_abv_density_factor',
                    'first_racking_months','bottling_after_month')),
  value           numeric(10,4) NOT NULL,
  confirmed       boolean NOT NULL DEFAULT false,                          -- false = supuesto pendiente de Pedro
  source          text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (legal_entity_id, key)
);

CREATE TABLE cellar.loss_tolerance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process       text NOT NULL CHECK (process IN ('reception','crushing_pressing','fermentation','racking','filtration',
                                                 'stabilization','barrel_aging','bottling','storage')),
  product_state text NOT NULL CHECK (product_state IN ('grape','must','wine','packaged_unlabeled','packaged_labeled')),
  max_pct       numeric(5,2) CHECK (max_pct BETWEEN 0 AND 100),             -- NULL = pendiente del asesor (nunca inventado)
  source_ref    text,                                                       -- norma o criterio que lo fija
  valid_from    date NOT NULL,
  confirmed     boolean NOT NULL DEFAULT false,
  UNIQUE (process, product_state, valid_from)
);

-- ---------------------------------------------------------------------
-- Filtración por placas, consumibles, higiene, equipos y control de envasado (§9.6)
-- ---------------------------------------------------------------------
ALTER TABLE catalog.product DROP CONSTRAINT product_kind_check;
ALTER TABLE catalog.product ADD CONSTRAINT product_kind_check CHECK (kind IN (
  'wine','bulk_wine','packaging_material','oenological_product','cellar_consumable',
  'merchandise','service','gift_card','other'));

CREATE TABLE cellar.equipment (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code     text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  kind     text NOT NULL CHECK (kind IN ('bottler','filter','pump','press','destemmer','other')),
  name     text NOT NULL,
  spouts   smallint CHECK (spouts > 0),                                      -- embotelladora manual de 4 caños
  capacity text,
  status   text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','maintenance','retired')),
  notes    text
);

CREATE TABLE cellar.filtration_detail (
  operation_id        uuid PRIMARY KEY REFERENCES cellar.operation(id),     -- op_type = 'filtration'
  plate_grade         text NOT NULL CHECK (plate_grade IN ('V00','V07','V13','other')),  -- desbaste, intermedia, amicróbica
  plate_format        text,
  plates_used         integer CHECK (plates_used > 0),
  plate_product_id    uuid REFERENCES catalog.product(id),                  -- consumible con stock
  supplier_contact_id uuid REFERENCES party.contact(id),
  equipment_id        uuid REFERENCES cellar.equipment(id)
);

CREATE TABLE cellar.cleaning_procedure (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  product_id           uuid NOT NULL REFERENCES catalog.product(id),
  active_substance     text NOT NULL,                                      -- p. ej. ácido peracético
  concentration        text NOT NULL,
  contact_minutes      smallint CHECK (contact_minutes > 0),
  rinse                text,
  applies_to           text[] NOT NULL DEFAULT '{}',                       -- clases de recipiente o equipo
  effluent_destination text,                                               -- p. ej. canal a pozo de biodegradación (Q-039)
  is_active            boolean NOT NULL DEFAULT true
);
ALTER TABLE cellar.cleaning_record
  ADD COLUMN procedure_id         uuid REFERENCES cellar.cleaning_procedure(id),
  ADD COLUMN contact_minutes      smallint,
  ADD COLUMN equipment_id         uuid REFERENCES cellar.equipment(id),
  ADD COLUMN effluent_destination text;

CREATE TABLE cellar.bottling_check (
  operation_id              uuid PRIMARY KEY REFERENCES cellar.operation(id),   -- op_type = 'bottling'
  bottles_disinfected       boolean NOT NULL,
  disinfection_procedure_id uuid REFERENCES cellar.cleaning_procedure(id),
  visual_check_done         boolean NOT NULL,
  rejects_fill              integer NOT NULL DEFAULT 0 CHECK (rejects_fill >= 0),
  rejects_closure           integer NOT NULL DEFAULT 0 CHECK (rejects_closure >= 0),
  rejects_label             integer NOT NULL DEFAULT 0 CHECK (rejects_label >= 0),
  closure_type              text NOT NULL CHECK (closure_type IN ('natural_cork','agglomerated','screwcap','other')),
  seal_type                 text NOT NULL CHECK (seal_type IN ('capsule','wax','none')),
  equipment_id              uuid REFERENCES cellar.equipment(id),
  checked_by                text NOT NULL,
  notes                     text,
  CHECK (NOT bottles_disinfected OR disinfection_procedure_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Viñedo: cata de uva estructurada y planificador de vendimia (§15)
-- ---------------------------------------------------------------------
ALTER TABLE vineyard.maturity_check
  ADD COLUMN seed_color        text CHECK (seed_color IN ('green','mixed','brown')),
  ADD COLUMN seed_crunch       boolean,
  ADD COLUMN skin_astringency  smallint CHECK (skin_astringency BETWEEN 1 AND 5),
  ADD COLUMN skin_color_release smallint CHECK (skin_color_release BETWEEN 1 AND 5),
  ADD COLUMN pulp_sweetness    smallint CHECK (pulp_sweetness BETWEEN 1 AND 5),
  ADD COLUMN pulp_acidity      smallint CHECK (pulp_acidity BETWEEN 1 AND 5),
  ADD COLUMN phenolic_maturity smallint CHECK (phenolic_maturity BETWEEN 1 AND 5),
  ADD COLUMN photo_attachment_id uuid REFERENCES core.attachment(id);

CREATE TABLE vineyard.crew_availability (
  day     date PRIMARY KEY,
  people  smallint NOT NULL CHECK (people >= 0),
  notes   text
);

CREATE TABLE vineyard.harvest_plan (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id            uuid NOT NULL REFERENCES vineyard.parcel(id),
  vintage              smallint NOT NULL CHECK (vintage BETWEEN 1990 AND 2100),
  ripeness_ready_on    date,                                                -- de los controles de maduración
  weather_risk         text CHECK (weather_risk IN ('none','heat_wave','rain','storm','hail')),
  weather_note         text,
  crew_needed          smallint CHECK (crew_needed > 0),
  earliest_on          date,
  latest_on            date,
  suggested_on         date,
  rationale            text,                                                -- por qué esa fecha (maduración, meteo, personal)
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','done','cancelled')),
  UNIQUE (parcel_id, vintage),
  CHECK (latest_on IS NULL OR earliest_on IS NULL OR latest_on >= earliest_on)
);

-- ---------------------------------------------------------------------
-- Auditoría y no borrado
-- ---------------------------------------------------------------------
CREATE TRIGGER location_zone_audit     AFTER INSERT OR UPDATE ON inventory.location_zone FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER vessel_position_audit   AFTER INSERT OR UPDATE OR DELETE ON cellar.vessel_position FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER barrel_audit            AFTER INSERT OR UPDATE ON cellar.barrel FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER bottle_holder_audit     AFTER INSERT OR UPDATE ON cellar.bottle_holder FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER grape_intake_audit      AFTER INSERT OR UPDATE ON cellar.grape_intake FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER lot_phase_audit         AFTER INSERT OR UPDATE ON cellar.lot_phase FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER recipe_audit            AFTER INSERT OR UPDATE ON cellar.recipe FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER lot_design_audit        AFTER INSERT OR UPDATE ON cellar.lot_design FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER lot_practice_audit      AFTER INSERT OR UPDATE OR DELETE ON cellar.lot_practice FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER tasting_template_audit  AFTER INSERT OR UPDATE ON cellar.tasting_template FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER blind_session_audit     AFTER INSERT OR UPDATE ON cellar.blind_session FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER blind_sample_audit      AFTER INSERT OR UPDATE ON cellar.blind_sample FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER blind_vote_audit        AFTER INSERT OR UPDATE ON cellar.blind_vote FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER enology_setting_audit   AFTER INSERT OR UPDATE ON cellar.enology_setting FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER loss_tolerance_audit    AFTER INSERT OR UPDATE ON cellar.loss_tolerance FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER equipment_audit         AFTER INSERT OR UPDATE ON cellar.equipment FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER filtration_detail_audit AFTER INSERT OR UPDATE ON cellar.filtration_detail FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER cleaning_procedure_audit AFTER INSERT OR UPDATE ON cellar.cleaning_procedure FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER bottling_check_audit    AFTER INSERT OR UPDATE ON cellar.bottling_check FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER crew_availability_audit AFTER INSERT OR UPDATE OR DELETE ON vineyard.crew_availability FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER harvest_plan_audit      AFTER INSERT OR UPDATE ON vineyard.harvest_plan FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER blind_vote_no_delete    BEFORE DELETE ON cellar.blind_vote FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();
CREATE TRIGGER lot_phase_no_delete     BEFORE DELETE ON cellar.lot_phase FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();
