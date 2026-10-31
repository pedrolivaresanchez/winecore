-- WineCore · 0006_cellar · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0006_cellar.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0006 · bodega (cellar)
-- Recipientes, operaciones de bodega (con conservación de volumen por operación),
-- adiciones, analíticas, controles de fermentación, catas y consumo de materiales.
-- Especificación: docs/02-modelo-dominio.md §9 · Estados: docs/03-maquinas-estado.md §1–§2
-- =====================================================================

CREATE TABLE cellar.vessel (id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  -- 'INOX-01'…'INOX-32', 'INOX-B1'…'INOX-B7', 'BAR-001', 'DAM-001'
  name               VARCHAR NOT NULL,
  kind               VARCHAR NOT NULL CHECK (kind IN ('tank_storage','tank_fermenter','barrel','demijohn','ibc','other')),
  capacity_ml        bigint NOT NULL CHECK (capacity_ml > 0),
  has_cooling_jacket boolean NOT NULL DEFAULT false,
  material           VARCHAR NOT NULL CHECK (material IN ('stainless_steel','oak','glass','concrete','plastic','other')),
  location_id        uuid NOT NULL,
  zone               VARCHAR,
  -- zona/nave del plano
  sisv_code          VARCHAR,
  -- código usado en SISV (p. ej. 'D1'), Q-020
  qr_token           VARCHAR CHECK (qr_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  status             VARCHAR NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','out_of_service','retired')),
  notes              VARCHAR,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'tank_fermenter' OR has_cooling_jacket)
);


-- ---------------------------------------------------------------------
-- Operaciones de bodega
-- ---------------------------------------------------------------------
CREATE TABLE cellar.operation (id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id        uuid NOT NULL,
  -- P.O (productor)
  number                 VARCHAR,
  -- serie 'cellar_operation' al confirmar
  op_type                VARCHAR NOT NULL CHECK (op_type IN (
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
                           'destruction')),
  -- destrucción de producto defectuoso
  occurred_at            TIMESTAMPTZ NOT NULL,
  status                 VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','rectified','discarded')),
  rectifies_operation_id uuid REFERENCES cellar.operation(id),
  reason                 VARCHAR,
  -- obligatorio en rectificaciones, mermas por incidencia y destrucciones
  details                JSON NOT NULL DEFAULT '{}'::JSON,
  -- p. ej. placas, temperatura, documento de acompañamiento, fórmula de ensamblaje
  performed_by           VARCHAR NOT NULL,
  -- operario (texto libre o usuario)
  confirmed_by           uuid,
  confirmed_at           TIMESTAMPTZ,
  approval_request_id    uuid,
  -- destrucciones y mermas por incidencia
  sisv_relevant          boolean NOT NULL DEFAULT true,
  silicie_relevant       boolean NOT NULL DEFAULT false,
  -- lo calcula el motor de reglas (04-regulatorio/silicie.md)
  created_by             VARCHAR NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'confirmed' OR (number IS NOT NULL AND confirmed_at IS NOT NULL)),
  CHECK (op_type NOT IN ('destruction') OR reason IS NOT NULL)
);

CREATE INDEX operation_time_idx ON cellar.operation(occurred_at);


CREATE TABLE cellar.operation_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id  uuid NOT NULL REFERENCES cellar.operation(id),
  role          VARCHAR NOT NULL CHECK (role IN ('input','output','loss')),
  lot_id        uuid NOT NULL,
  vessel_id     uuid REFERENCES cellar.vessel(id),
  location_id   uuid,                            -- para envasado (sin recipiente)
  product_id    uuid,                               -- para envasado/etiquetado
  product_state VARCHAR NOT NULL CHECK (product_state IN ('grape','must','wine','packaged_unlabeled','packaged_labeled')),
  volume_ml     bigint NOT NULL DEFAULT 0 CHECK (volume_ml >= 0),
  qty_units     integer NOT NULL DEFAULT 0 CHECK (qty_units >= 0),
  mass_g        bigint NOT NULL DEFAULT 0 CHECK (mass_g >= 0),
  loss_kind     VARCHAR CHECK (loss_kind IN ('authorized','incident')),
  notes         VARCHAR,
  CHECK (volume_ml > 0 OR qty_units > 0 OR mass_g > 0),
  CHECK ((role = 'loss') = (loss_kind IS NOT NULL)),
  CHECK (vessel_id IS NOT NULL OR location_id IS NOT NULL OR product_state = 'grape'),
  CHECK (product_state NOT IN ('packaged_unlabeled','packaged_labeled') OR (product_id IS NOT NULL AND qty_units > 0))
);

CREATE INDEX operation_line_op_idx ON cellar.operation_line(operation_id);

CREATE INDEX operation_line_lot_idx ON cellar.operation_line(lot_id);


-- Las líneas de una operación confirmada no se tocan (WC031)

-- Una operación confirmada solo puede pasar a 'rectified' (WC032)

-- Conservación de volumen por operación al confirmar (WC020). Diferida al final de la transacción.

-- ---------------------------------------------------------------------
-- Adiciones de productos enológicos (alimentan el etiquetado y el cuaderno ecológico)
-- ---------------------------------------------------------------------
CREATE TABLE cellar.addition (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id        uuid NOT NULL REFERENCES cellar.operation(id),
  lot_id              uuid NOT NULL,
  vessel_id           uuid REFERENCES cellar.vessel(id),
  additive_product_id uuid NOT NULL,            -- kind = 'oenological_product'
  quantity            DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
  quantity_unit       VARCHAR NOT NULL CHECK (quantity_unit IN ('g','kg','ml','l')),
  dose                DECIMAL(12,3) NOT NULL CHECK (dose > 0),
  dose_unit           VARCHAR NOT NULL CHECK (dose_unit IN ('g/hl','mg/l','g/l')),
  purpose             VARCHAR NOT NULL CHECK (purpose IN ('acidification','sulphiting','cleaning','other')),
  supplier_invoice_id uuid,                                                     -- FK a purchasing.supplier_invoice (0010): prueba ecológica
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Limpieza y desinfección de recipientes e instalaciones (Reg. (UE) 2018/848, anexo II IV 1.4 b y VI 2.3):
-- producto, sustancia activa, lugar y comprobación de la eficacia
CREATE TABLE cellar.cleaning_record (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id        uuid NOT NULL REFERENCES cellar.operation(id),       -- op_type = 'cleaning'
  vessel_id           uuid REFERENCES cellar.vessel(id),
  location_id         uuid,
  product_id          uuid NOT NULL,
  active_substance    VARCHAR NOT NULL,                                      -- p. ej. ácido peracético
  quantity            DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
  quantity_unit       VARCHAR NOT NULL CHECK (quantity_unit IN ('g','kg','ml','l')),
  efficacy_check      VARCHAR NOT NULL,                                      -- cómo se comprobó (aclarado, tira de pH, visual…)
  supplier_invoice_id uuid,                                               -- FK a purchasing.supplier_invoice (0010)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (vessel_id IS NOT NULL OR location_id IS NOT NULL)
);


-- ---------------------------------------------------------------------
-- Analíticas, controles de fermentación y catas
-- ---------------------------------------------------------------------
CREATE TABLE cellar.analysis_parameter (code      VARCHAR PRIMARY KEY,
  name_es   VARCHAR NOT NULL,
  unit      VARCHAR NOT NULL,
  min_value DECIMAL(12,4),
  max_value DECIMAL(12,4)
);


CREATE TABLE cellar.analysis (id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id               uuid NOT NULL,
  vessel_id            uuid REFERENCES cellar.vessel(id),
  kind                 VARCHAR NOT NULL CHECK (kind IN ('grape','must','fml_pack','pre_bottling','control','other')),
  sampled_at           TIMESTAMPTZ NOT NULL,
  lab                  VARCHAR NOT NULL CHECK (lab IN ('internal','external')),
  lab_name             VARCHAR,
  report_attachment_id uuid,
  notes                VARCHAR,
  created_by           VARCHAR NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE cellar.analysis_result (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id    uuid NOT NULL REFERENCES cellar.analysis(id),
  parameter_code VARCHAR NOT NULL REFERENCES cellar.analysis_parameter(code),
  value          DECIMAL(12,4) NOT NULL,
  method         VARCHAR,
  UNIQUE (analysis_id, parameter_code)
);


CREATE TABLE cellar.fermentation_reading (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id        uuid NOT NULL,
  vessel_id     uuid NOT NULL REFERENCES cellar.vessel(id),
  measured_at   TIMESTAMPTZ NOT NULL,
  density       DECIMAL(6,4) CHECK (density BETWEEN 0.9800 AND 1.2000),         -- g/mL
  temperature_c DECIMAL(4,1) CHECK (temperature_c BETWEEN -5 AND 45),
  measured_by   VARCHAR NOT NULL,
  source        VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','sensor','import')),
  notes         VARCHAR,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (density IS NOT NULL OR temperature_c IS NOT NULL),
  UNIQUE (vessel_id, measured_at)
);

CREATE INDEX fermentation_reading_lot_idx ON cellar.fermentation_reading(lot_id, measured_at);


CREATE TABLE cellar.tasting (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      uuid NOT NULL,
  vessel_id   uuid REFERENCES cellar.vessel(id),
  tasted_at   TIMESTAMPTZ NOT NULL,
  author      VARCHAR NOT NULL,
  notes       VARCHAR NOT NULL,
  decision    VARCHAR,                                                            -- p. ej. "destinar a ENTREDICHO", "a barrica"
  source      VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE cellar.material_consumption (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES cellar.operation(id),
  product_id   uuid NOT NULL,                   -- botellas, tapones, cápsulas, etiquetas, cajas
  quantity     DECIMAL(12,3) NOT NULL CHECK (quantity > 0),
  unit         VARCHAR NOT NULL DEFAULT 'ud'
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
