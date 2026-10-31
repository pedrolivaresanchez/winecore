-- WineCore · 0052_enology_config · dialecto DuckDB.
-- Calculadoras y umbrales de enología. Los valores SUPUESTO nacen sin confirmar.
-- DuckDB reescribe el UPDATE de una columna PK/UNIQUE si otra tabla la referencia:
-- aquí no hay claves foráneas, y las escrituras solo tocan columnas que no están
-- en la UNIQUE (el valor, el texto, la confirmación y superseded_at).

CREATE SCHEMA IF NOT EXISTS enology;

-- Plantilla: entity_key cero y legal_entity_id NULL. Cada entidad copia al guardar.
CREATE TABLE enology.parameter (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key       VARCHAR NOT NULL,
  legal_entity_id  uuid,
  code             VARCHAR NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{0,60}$'),
  value_num        DECIMAL(14,6),
  value_text       VARCHAR,
  unit             VARCHAR,
  basis            VARCHAR NOT NULL CHECK (basis IN ('hecho','supuesto','pendiente')),
  source_ref       VARCHAR NOT NULL,
  valid_from       DATE NOT NULL,
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     uuid,
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_key, code, valid_from)
);

CREATE TABLE enology.so2_limit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key       VARCHAR NOT NULL,
  legal_entity_id  uuid,
  scope            VARCHAR NOT NULL CHECK (scope IN ('organic','legal')),
  wine_color       VARCHAR NOT NULL CHECK (wine_color IN ('tinto','blanco','rosado')),
  sugar_band       VARCHAR NOT NULL CHECK (sugar_band IN ('lt_2','from_2_to_5','gte_5')),
  sugar_min_g_l    DECIMAL(8,3) NOT NULL,
  sugar_max_g_l    DECIMAL(8,3),
  limit_mg_l       DECIMAL(8,2),
  basis            VARCHAR NOT NULL CHECK (basis IN ('hecho','supuesto','pendiente')),
  source_ref       VARCHAR NOT NULL,
  note             VARCHAR,
  valid_from       DATE NOT NULL,
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     uuid,
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_key, scope, wine_color, sugar_band, valid_from)
);

CREATE TABLE enology.loss_tolerance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key       VARCHAR NOT NULL,
  legal_entity_id  uuid,
  process          VARCHAR NOT NULL CHECK (process IN (
                     'reception','crushing_pressing','fermentation','racking',
                     'filtration','stabilisation','aging_barrel','bottling')),
  product_state    VARCHAR NOT NULL CHECK (product_state IN (
                     'grape','must','wine','packaged_unlabeled','packaged_labeled')),
  max_pct          DECIMAL(6,3),
  basis            VARCHAR NOT NULL CHECK (basis IN ('hecho','supuesto','pendiente')),
  source_ref       VARCHAR NOT NULL,
  valid_from       DATE NOT NULL,
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     uuid,
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_key, process, product_state, valid_from)
);

CREATE TABLE enology.prohibited_practice (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key       VARCHAR NOT NULL,
  legal_entity_id  uuid,
  name_es          VARCHAR NOT NULL,
  name_key         VARCHAR NOT NULL,
  match_terms      VARCHAR NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  basis            VARCHAR NOT NULL CHECK (basis IN ('hecho','supuesto','pendiente')),
  source_ref       VARCHAR NOT NULL,
  confirmed_at     TIMESTAMPTZ,
  confirmed_by     uuid,
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_key, name_key)
);

CREATE TABLE enology.required_analysis (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key       VARCHAR NOT NULL,
  legal_entity_id  uuid,
  parameter_code   VARCHAR NOT NULL,
  name_es          VARCHAR NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_key, parameter_code)
);

-- SUPUESTO: objetivos y umbrales de casa, pendientes de confirmar por la dirección.
-- FACT: la ventana de febrero-marzo del primer trasiego.
INSERT INTO enology.parameter (
  entity_key, legal_entity_id, code, value_num, value_text, unit, basis, source_ref, valid_from
) VALUES
('00000000-0000-0000-0000-000000000000', NULL, 'molecular_so2_tinto_mg_l', 0.5, NULL, 'mg/L', 'supuesto',
 'SUPUESTO de la reunión de arranque: objetivo de SO2 molecular por tipo de vino. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'molecular_so2_blanco_mg_l', 0.8, NULL, 'mg/L', 'supuesto',
 'SUPUESTO de la reunión de arranque: objetivo de SO2 molecular por tipo de vino. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'molecular_so2_rosado_mg_l', 0.8, NULL, 'mg/L', 'supuesto',
 'SUPUESTO de la reunión de arranque: objetivo de SO2 molecular por tipo de vino. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'density_alcohol_factor', 7.5, NULL, 'factor', 'supuesto',
 'SUPUESTO de la reunión de arranque: (densidad g/L - 1000) / 7,5. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'volatile_acidity_alert_g_l', 0.6, NULL, 'g/L', 'supuesto',
 'SUPUESTO de la reunión de arranque: alerta de acidez volátil a 0,6 g/L de acético. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'volatile_acidity_legal_max_g_l', NULL, NULL, 'g/L', 'pendiente',
 'docs/04-regulatorio no recoge un máximo legal de acidez volátil. El valor queda vacío.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'dryness_glucose_fructose_g_l', 2, NULL, 'g/L', 'supuesto',
 'SUPUESTO de la reunión de arranque: glucosa + fructosa <= 2 g/L indica fin de fermentación. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'malolactic_malic_g_l', 0.3, NULL, 'g/L', 'supuesto',
 'SUPUESTO de la reunión de arranque: málico <= 0,3 g/L indica fin de la fermentación maloláctica. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'pre_bottling_freshness_days', 30, NULL, 'd', 'supuesto',
 'SUPUESTO de la reunión de arranque: la analítica de preembotellado caduca a los 30 días. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'bottling_analysis_mode', NULL, 'warning', NULL, 'supuesto',
 'SUPUESTO de la reunión de arranque: sin analítica fresca el embotellado avisa; se puede configurar para bloquear. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'winter_racking_month_from', 2, NULL, 'mes', 'hecho',
 'FACT de la reunión de arranque: el primer trasiego es tras el frío del invierno, en febrero y marzo.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'winter_racking_month_to', 3, NULL, 'mes', 'hecho',
 'FACT de la reunión de arranque: el primer trasiego es tras el frío del invierno, en febrero y marzo.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'bottling_reminder_month_from', 6, NULL, 'mes', 'supuesto',
 'SUPUESTO: el recordatorio de embotellar empieza en junio, después de la primavera meteorológica, y sigue hasta diciembre. Pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'bottling_reminder_month_to', 12, NULL, 'mes', 'supuesto',
 'SUPUESTO: el recordatorio de embotellar empieza en junio, después de la primavera meteorológica, y sigue hasta diciembre. Pendiente de confirmar.', DATE '2026-01-01');

-- Límites de SO2 total sembrados desde docs/04-regulatorio/ecologico.md.
-- Donde el documento no da la cifra, limit_mg_l queda NULL.
INSERT INTO enology.so2_limit (
  entity_key, legal_entity_id, scope, wine_color, sugar_band,
  sugar_min_g_l, sugar_max_g_l, limit_mg_l, basis, source_ref, note, valid_from
) VALUES
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'tinto', 'lt_2', 0, 2, 100, 'hecho',
 'HECHO docs/04-regulatorio/ecologico.md: tinto 100 mg/L con azúcar residual menor de 2 g/L (2021/1165 anexo V D).',
 NULL, DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'blanco', 'lt_2', 0, 2, 150, 'hecho',
 'HECHO docs/04-regulatorio/ecologico.md: blanco y rosado 150 mg/L con azúcar residual menor de 2 g/L (2021/1165 anexo V D).',
 NULL, DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'rosado', 'lt_2', 0, 2, 150, 'hecho',
 'HECHO docs/04-regulatorio/ecologico.md: blanco y rosado 150 mg/L con azúcar residual menor de 2 g/L (2021/1165 anexo V D).',
 NULL, DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'tinto', 'from_2_to_5', 2, 5, 120, 'supuesto',
 'SUPUESTO aritmético docs/04-regulatorio/ecologico.md: ejemplo tinto de 2 a 5 g/L, 120 mg/L (límite general menos 30). Pendiente de confirmar.',
 'Cifra de ejemplo, pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'blanco', 'from_2_to_5', 2, 5, 170, 'supuesto',
 'SUPUESTO aritmético docs/04-regulatorio/ecologico.md: ejemplo blanco y rosado de 2 a 5 g/L, 170 mg/L (límite general menos 30). Pendiente de confirmar.',
 'Cifra de ejemplo, pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'rosado', 'from_2_to_5', 2, 5, 170, 'supuesto',
 'SUPUESTO aritmético docs/04-regulatorio/ecologico.md: ejemplo blanco y rosado de 2 a 5 g/L, 170 mg/L (límite general menos 30). Pendiente de confirmar.',
 'Cifra de ejemplo, pendiente de confirmar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'tinto', 'gte_5', 5, NULL, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md: para el resto de azúcares el límite ecológico es el general menos 30 mg/L, y el documento no da la cifra de esta banda.',
 'Sin cifra en la documentación para esta banda de azúcar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'blanco', 'gte_5', 5, NULL, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md: para el resto de azúcares el límite ecológico es el general menos 30 mg/L, y el documento no da la cifra de esta banda.',
 'Sin cifra en la documentación para esta banda de azúcar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'organic', 'rosado', 'gte_5', 5, NULL, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md: para el resto de azúcares el límite ecológico es el general menos 30 mg/L, y el documento no da la cifra de esta banda.',
 'Sin cifra en la documentación para esta banda de azúcar.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'tinto', 'lt_2', 0, 2, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'blanco', 'lt_2', 0, 2, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'rosado', 'lt_2', 0, 2, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'tinto', 'from_2_to_5', 2, 5, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'blanco', 'from_2_to_5', 2, 5, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'rosado', 'from_2_to_5', 2, 5, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'tinto', 'gte_5', 5, NULL, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'blanco', 'gte_5', 5, NULL, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'legal', 'rosado', 'gte_5', 5, NULL, NULL, 'pendiente',
 'PENDIENTE docs/04-regulatorio/ecologico.md cita el límite general del Reg. Delegado (UE) 2019/934 anexo I B y no transcribe la cifra.',
 'Sin cifra legal en la documentación regulatoria del repositorio.', DATE '2026-01-01');

-- Porcentajes NULL a propósito: los aporta el asesor. No se inventan.
INSERT INTO enology.loss_tolerance (
  entity_key, legal_entity_id, process, product_state, max_pct, basis, source_ref, valid_from
) VALUES
('00000000-0000-0000-0000-000000000000', NULL, 'reception', 'grape', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'crushing_pressing', 'grape', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'crushing_pressing', 'must', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'fermentation', 'must', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'fermentation', 'wine', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'racking', 'must', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'racking', 'wine', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'filtration', 'wine', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'stabilisation', 'wine', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'aging_barrel', 'wine', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'bottling', 'wine', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'bottling', 'packaged_unlabeled', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01'),
('00000000-0000-0000-0000-000000000000', NULL, 'bottling', 'packaged_labeled', NULL, 'pendiente',
 'PENDIENTE: el asesor indica el máximo porcentual. WineCore no inventa tolerancias.', DATE '2026-01-01');

INSERT INTO enology.prohibited_practice (
  entity_key, legal_entity_id, name_es, name_key, match_terms, active, basis, source_ref
) VALUES (
  '00000000-0000-0000-0000-000000000000', NULL, 'carbones activos', 'carbones activos',
  'carbones activos,activated carbon,carbon activo', true, 'hecho',
  'Regla de casa de la reunión de arranque: los carbones activos están prohibidos.'
);

INSERT INTO enology.required_analysis (
  entity_key, legal_entity_id, parameter_code, name_es, active, sort_order
) VALUES
('00000000-0000-0000-0000-000000000000', NULL, 'abv', 'Grado alcohólico', true, 1),
('00000000-0000-0000-0000-000000000000', NULL, 'total_acidity', 'Acidez total', true, 2),
('00000000-0000-0000-0000-000000000000', NULL, 'volatile_acidity', 'Acidez volátil', true, 3),
('00000000-0000-0000-0000-000000000000', NULL, 'ph', 'pH', true, 4),
('00000000-0000-0000-0000-000000000000', NULL, 'free_so2', 'SO2 libre', true, 5),
('00000000-0000-0000-0000-000000000000', NULL, 'total_so2', 'SO2 total', true, 6),
('00000000-0000-0000-0000-000000000000', NULL, 'glucose_fructose', 'Azúcares (glucosa y fructosa)', true, 7);
