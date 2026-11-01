-- =====================================================================
-- WineCore · Migración 0006 · bodega (cellar)
-- Recipientes, operaciones de bodega (con conservación de volumen por operación),
-- adiciones, analíticas, controles de fermentación, catas y consumo de materiales.
-- Especificación: docs/02-modelo-dominio.md §9 · Estados: docs/03-maquinas-estado.md §1–§2
-- =====================================================================

CREATE TABLE cellar.vessel (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),    -- 'INOX-01'…'INOX-32', 'INOX-B1'…'INOX-B7', 'BAR-001', 'DAM-001'
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('tank_storage','tank_fermenter','barrel','demijohn','ibc','other')),
  capacity_ml        bigint NOT NULL CHECK (capacity_ml > 0),
  has_cooling_jacket boolean NOT NULL DEFAULT false,
  material           text NOT NULL CHECK (material IN ('stainless_steel','oak','glass','concrete','plastic','other')),
  location_id        uuid NOT NULL REFERENCES inventory.location(id),
  zone               text,                                                          -- zona/nave del plano
  sisv_code          text,                                                          -- código usado en SISV (p. ej. 'D1'), Q-020
  qr_token           text UNIQUE CHECK (qr_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  status             text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','out_of_service','retired')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'tank_fermenter' OR has_cooling_jacket)
);
CREATE TRIGGER vessel_no_delete BEFORE DELETE ON cellar.vessel FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- ---------------------------------------------------------------------
-- Operaciones de bodega
-- ---------------------------------------------------------------------
CREATE TABLE cellar.operation (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL REFERENCES core.legal_entity(id),           -- P.O (productor)
  number                 text,                                                     -- serie 'cellar_operation' al confirmar
  op_type                text NOT NULL CHECK (op_type IN (
                           'reception',          -- entrada de uva (masa)
                           'bulk_reception',     -- entrada de vino/mosto a granel (compra)
                           'crushing_pressing',  -- despalillado/estrujado/prensado/encubado: uva (kg) → mosto (L)
                           'fermentation_end',   -- fin de FA: mosto → vino
                           'racking',            -- trasiego (mismo lote; puede repartir en varios recipientes)
                           'blend',              -- ensamblaje/coupage: varios lotes → lote nuevo
                           'filtration',         -- filtración (placas V00/V07/V13…)
                           'addition',           -- adición de producto enológico (SO2, ácido tartárico)
                           'stabilization',      -- estabilización (natural o por frío)
                           'cleaning',           -- limpieza y desinfección de recipiente (peracético)
                           'sampling',           -- toma de muestras (salida pequeña)
                           'bottling',           -- envasado: granel → botellas/BIB (lote envasado nuevo)
                           'labeling',           -- etiquetado de jaulón: sin etiquetar → etiquetado
                           'loss',               -- merma (derrame, evaporación, rotura)
                           'destruction')),      -- destrucción de producto defectuoso
  occurred_at            timestamptz NOT NULL,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','rectified','discarded')),
  rectifies_operation_id uuid REFERENCES cellar.operation(id),
  reason                 text,                                                     -- obligatorio en rectificaciones, mermas por incidencia y destrucciones
  details                jsonb NOT NULL DEFAULT '{}'::jsonb,                      -- p. ej. placas, temperatura, documento de acompañamiento, fórmula de ensamblaje
  performed_by           text NOT NULL,                                            -- operario (texto libre o usuario)
  confirmed_by           uuid REFERENCES core.app_user(id),
  confirmed_at           timestamptz,
  approval_request_id    uuid REFERENCES ops.approval_request(id),                 -- destrucciones y mermas por incidencia
  sisv_relevant          boolean NOT NULL DEFAULT true,
  silicie_relevant       boolean NOT NULL DEFAULT false,                           -- lo calcula el motor de reglas (04-regulatorio/silicie.md)
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, number),
  CHECK (status <> 'confirmed' OR (number IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (op_type NOT IN ('destruction') OR reason IS NOT NULL),
  CHECK (rectifies_operation_id IS NULL OR reason IS NOT NULL)
);
-- Sin índice en occurred_at desde la migración 0043: en DuckDB impedía cambiar la fecha de un borrador con líneas.
CREATE TRIGGER operation_no_delete BEFORE DELETE ON cellar.operation FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

ALTER TABLE inventory.lot
  ADD CONSTRAINT lot_created_by_operation_fk FOREIGN KEY (created_by_operation_id) REFERENCES cellar.operation(id);
ALTER TABLE inventory.lot_edge
  ADD CONSTRAINT lot_edge_operation_fk FOREIGN KEY (operation_id) REFERENCES cellar.operation(id);

CREATE TABLE cellar.operation_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id  uuid NOT NULL REFERENCES cellar.operation(id),
  role          text NOT NULL CHECK (role IN ('input','output','loss')),
  lot_id        uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id     uuid REFERENCES cellar.vessel(id),
  location_id   uuid REFERENCES inventory.location(id),                            -- para envasado (sin recipiente)
  product_id    uuid REFERENCES catalog.product(id),                               -- para envasado/etiquetado
  product_state text NOT NULL CHECK (product_state IN ('grape','must','wine','packaged_unlabeled','packaged_labeled')),
  volume_ml     bigint NOT NULL DEFAULT 0 CHECK (volume_ml >= 0),
  qty_units     integer NOT NULL DEFAULT 0 CHECK (qty_units >= 0),
  mass_g        bigint NOT NULL DEFAULT 0 CHECK (mass_g >= 0),
  loss_kind     text CHECK (loss_kind IN ('authorized','incident')),
  notes         text,
  CHECK (volume_ml > 0 OR qty_units > 0 OR mass_g > 0),
  CHECK ((role = 'loss') = (loss_kind IS NOT NULL)),
  CHECK (vessel_id IS NOT NULL OR location_id IS NOT NULL OR product_state = 'grape'),
  CHECK (product_state NOT IN ('packaged_unlabeled','packaged_labeled') OR (product_id IS NOT NULL AND qty_units > 0))
);
CREATE INDEX operation_line_op_idx ON cellar.operation_line(operation_id);
CREATE INDEX operation_line_lot_idx ON cellar.operation_line(lot_id);

-- Las líneas de una operación confirmada no se tocan (WC031)
CREATE FUNCTION cellar.operation_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM cellar.operation WHERE id = coalesce(NEW.operation_id, OLD.operation_id);
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'WC031: la operación no está en borrador; se corrige con una rectificación';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER operation_line_guard BEFORE INSERT OR UPDATE OR DELETE ON cellar.operation_line
  FOR EACH ROW EXECUTE FUNCTION cellar.operation_line_guard();

-- Una operación confirmada solo puede pasar a 'rectified' (WC032)
CREATE FUNCTION cellar.operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NOT (NEW.status = 'rectified' AND NEW.op_type = OLD.op_type
       AND NEW.occurred_at = OLD.occurred_at AND NEW.number = OLD.number) THEN
    RAISE EXCEPTION 'WC032: una operación confirmada solo puede marcarse como rectificada';
  END IF;
  IF OLD.status IN ('rectified','discarded') THEN
    RAISE EXCEPTION 'WC032: la operación % es definitiva (%)', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER operation_guard BEFORE UPDATE ON cellar.operation
  FOR EACH ROW EXECUTE FUNCTION cellar.operation_guard();

-- Conservación de volumen por operación al confirmar (WC020). Diferida al final de la transacción.
CREATE FUNCTION cellar.check_operation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
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

  IF o.op_type IN ('fermentation_end','racking','blend','filtration','bottling') THEN
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
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER operation_balance AFTER INSERT OR UPDATE OF status ON cellar.operation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cellar.check_operation_balance();

-- ---------------------------------------------------------------------
-- Adiciones de productos enológicos (alimentan el etiquetado y el cuaderno ecológico)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.addition (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id        uuid NOT NULL REFERENCES cellar.operation(id),
  lot_id              uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id           uuid REFERENCES cellar.vessel(id),
  additive_product_id uuid NOT NULL REFERENCES catalog.product(id),            -- kind = 'oenological_product'
  quantity            numeric(12,3) NOT NULL CHECK (quantity > 0),
  quantity_unit       text NOT NULL CHECK (quantity_unit IN ('g','kg','ml','l')),
  dose                numeric(12,3) NOT NULL CHECK (dose > 0),
  dose_unit           text NOT NULL CHECK (dose_unit IN ('g/hl','mg/l','g/l')),
  purpose             text NOT NULL CHECK (purpose IN ('acidification','sulphiting','cleaning','other')),
  supplier_invoice_id uuid,                                                     -- FK a purchasing.supplier_invoice (0010): prueba ecológica
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Limpieza y desinfección de recipientes e instalaciones (Reg. (UE) 2018/848, anexo II IV 1.4 b y VI 2.3):
-- producto, sustancia activa, lugar y comprobación de la eficacia
CREATE TABLE cellar.cleaning_record (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id        uuid NOT NULL REFERENCES cellar.operation(id),       -- op_type = 'cleaning'
  vessel_id           uuid REFERENCES cellar.vessel(id),
  location_id         uuid REFERENCES inventory.location(id),
  product_id          uuid NOT NULL REFERENCES catalog.product(id),
  active_substance    text NOT NULL,                                      -- p. ej. ácido peracético
  quantity            numeric(12,3) NOT NULL CHECK (quantity > 0),
  quantity_unit       text NOT NULL CHECK (quantity_unit IN ('g','kg','ml','l')),
  efficacy_check      text NOT NULL,                                      -- cómo se comprobó (aclarado, tira de pH, visual…)
  supplier_invoice_id uuid,                                               -- FK a purchasing.supplier_invoice (0010)
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (vessel_id IS NOT NULL OR location_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Analíticas, controles de fermentación y catas
-- ---------------------------------------------------------------------
CREATE TABLE cellar.analysis_parameter (
  code      text PRIMARY KEY,
  name_es   text NOT NULL,
  unit      text NOT NULL,
  min_value numeric(12,4),
  max_value numeric(12,4)
);

CREATE TABLE cellar.analysis (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id               uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id            uuid REFERENCES cellar.vessel(id),
  kind                 text NOT NULL CHECK (kind IN ('grape','must','fml_pack','pre_bottling','control','other')),
  sampled_at           timestamptz NOT NULL,
  lab                  text NOT NULL CHECK (lab IN ('internal','external')),
  lab_name             text,
  report_attachment_id uuid REFERENCES core.attachment(id),
  notes                text,
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cellar.analysis_result (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    uuid NOT NULL REFERENCES cellar.analysis(id),
  parameter_code text NOT NULL REFERENCES cellar.analysis_parameter(code),
  value          numeric(12,4) NOT NULL,
  method         text,
  UNIQUE (analysis_id, parameter_code)
);

CREATE TABLE cellar.fermentation_reading (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id        uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id     uuid NOT NULL REFERENCES cellar.vessel(id),
  measured_at   timestamptz NOT NULL,
  density       numeric(6,4) CHECK (density BETWEEN 0.9800 AND 1.2000),         -- g/mL
  temperature_c numeric(4,1) CHECK (temperature_c BETWEEN -5 AND 45),
  measured_by   text NOT NULL,
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','sensor','import')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (density IS NOT NULL OR temperature_c IS NOT NULL),
  UNIQUE (vessel_id, measured_at)
);
CREATE INDEX fermentation_reading_lot_idx ON cellar.fermentation_reading(lot_id, measured_at);

CREATE TABLE cellar.tasting (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      uuid NOT NULL REFERENCES inventory.lot(id),
  vessel_id   uuid REFERENCES cellar.vessel(id),
  tasted_at   timestamptz NOT NULL,
  author      text NOT NULL,
  notes       text NOT NULL,
  decision    text,                                                            -- p. ej. "destinar a ENTREDICHO", "a barrica"
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cellar.material_consumption (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES cellar.operation(id),
  product_id   uuid NOT NULL REFERENCES catalog.product(id),                   -- botellas, tapones, cápsulas, etiquetas, cajas
  quantity     numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit         text NOT NULL DEFAULT 'ud'
);

INSERT INTO cellar.analysis_parameter(code, name_es, unit, min_value, max_value) VALUES
 ('density',               'Densidad',                       'g/mL',   0.9800, 1.2000),
 ('temperature',           'Temperatura',                    '°C',     -5,     45),
 ('probable_abv',          'Grado probable',                 '% vol',  0,      20),
 ('abv',                   'Grado alcohólico adquirido',     '% vol',  0,      20),
 ('total_acidity',         'Acidez total (tartárico)',       'g/L',    0,      20),
 ('volatile_acidity',      'Acidez volátil (acético)',       'g/L',    0,      3),
 ('ph',                    'pH',                             'pH',     2.5,    4.5),
 ('free_so2',              'SO2 libre',                      'mg/L',   0,      100),
 ('total_so2',             'SO2 total',                      'mg/L',   0,      400),
 ('glucose_fructose',      'Glucosa + fructosa',             'g/L',    0,      300),
 ('malic_acid',            'Ácido málico',                   'g/L',    0,      10),
 ('lactic_acid',           'Ácido láctico',                  'g/L',    0,      10),
 ('dry_extract',           'Extracto seco',                  'g/L',    0,      100),
 ('total_polyphenol_index','Índice de polifenoles totales',  'IPT',    0,      150),
 ('color_intensity',       'Intensidad colorante',           'UA',     0,      30);

CREATE TRIGGER vessel_audit AFTER INSERT OR UPDATE ON cellar.vessel FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER operation_audit AFTER INSERT OR UPDATE ON cellar.operation FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER operation_line_audit AFTER INSERT OR UPDATE OR DELETE ON cellar.operation_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER addition_audit AFTER INSERT OR UPDATE ON cellar.addition FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER cleaning_record_audit AFTER INSERT OR UPDATE ON cellar.cleaning_record FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER analysis_audit AFTER INSERT OR UPDATE ON cellar.analysis FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER analysis_result_audit AFTER INSERT OR UPDATE ON cellar.analysis_result FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER fermentation_reading_audit AFTER INSERT OR UPDATE ON cellar.fermentation_reading FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER tasting_audit AFTER INSERT OR UPDATE ON cellar.tasting FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER material_consumption_audit AFTER INSERT OR UPDATE ON cellar.material_consumption FOR EACH ROW EXECUTE FUNCTION audit.capture();
