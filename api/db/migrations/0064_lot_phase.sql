-- WineCore · 0064 · fases del lote (maceraciones, FA, FML, estabilizaciones, crianza)
-- docs/02-modelo-dominio.md §9.3 · US-BOD-09, US-BOD-10, US-BOD-17
-- Sin FK entre esquemas (DuckDB). lot_id e inoculum_product_id se comprueban en la API.

CREATE TABLE cellar.lot_phase (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              uuid NOT NULL,
  vessel_id           uuid REFERENCES cellar.vessel(id),
  phase               VARCHAR NOT NULL CHECK (phase IN (
                        'cold_soak',
                        'aqueous_maceration',
                        'skin_maceration',
                        'post_fermentation_maceration',
                        'alcoholic_fermentation',
                        'malolactic_fermentation',
                        'natural_cold_stabilisation',
                        'forced_cold_stabilisation',
                        'protein_stabilisation',
                        'aging')),
  status              VARCHAR NOT NULL DEFAULT 'in_progress' CHECK (status IN ('planned','in_progress','completed','stopped')),
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  inoculation         VARCHAR CHECK (inoculation IN ('spontaneous','commercial')),
  inoculum_product_id uuid,
  target_temp_c       DECIMAL(4,1),
  aging_method        VARCHAR CHECK (aging_method IN ('tank','barrel','demijohn_outdoor')),
  end_evidence        VARCHAR CHECK (end_evidence IN ('sensory','analysis','both')),
  end_analysis_id     uuid REFERENCES cellar.analysis(id),
  observations        VARCHAR,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR started_at IS NULL OR ended_at >= started_at),
  CHECK (status <> 'completed' OR ended_at IS NOT NULL),
  CHECK (inoculation IS NULL OR phase IN ('alcoholic_fermentation','malolactic_fermentation')),
  CHECK (inoculation IS DISTINCT FROM 'commercial' OR inoculum_product_id IS NOT NULL),
  CHECK (aging_method IS NULL OR phase = 'aging')
);

CREATE INDEX lot_phase_lot_idx ON cellar.lot_phase(lot_id, phase);
