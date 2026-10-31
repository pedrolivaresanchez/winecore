-- WineCore · 0055_tasting_sessions · dialecto DuckDB (ADR 002).
-- Cata ciega para elegir lotes de un objetivo (Referencia A, Referencia B, nueva colección).
-- La correspondencia muestra → lote no se actualiza: es parte de la clave única y
-- otras filas la referencian. El estado de la sesión vive en una columna no indexada.
-- No crea operaciones de bodega: solo expone los lotes elegidos.

CREATE TABLE tasting.blind_session (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR NOT NULL,
  target      VARCHAR NOT NULL,
  status      VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','revealed')),
  started_on  DATE NOT NULL,
  days        INTEGER NOT NULL CHECK (days BETWEEN 2 AND 3),
  notes       VARCHAR,
  created_by  VARCHAR NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at TIMESTAMPTZ,
  revealed_by VARCHAR
);

CREATE INDEX tblind_target_idx ON tasting.blind_session(target, started_on);

CREATE TABLE tasting.blind_sample (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES tasting.blind_session(id),
  sample_no  INTEGER NOT NULL CHECK (sample_no >= 1),
  lot_id     UUID NOT NULL,
  vessel_id  UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, sample_no),
  UNIQUE (session_id, lot_id)
);

CREATE INDEX tblind_sample_session_idx ON tasting.blind_sample(session_id);

CREATE TABLE tasting.blind_vote (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES tasting.blind_session(id),
  sample_id   UUID NOT NULL REFERENCES tasting.blind_sample(id),
  day_no      INTEGER NOT NULL CHECK (day_no >= 1),
  taster_user_id UUID,
  taster_name VARCHAR NOT NULL,
  vote        VARCHAR NOT NULL CHECK (vote IN ('yes','no')),
  score       DECIMAL(5,2),
  comment     VARCHAR,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sample_id, day_no, taster_name)
);

CREATE INDEX tblind_vote_session_idx ON tasting.blind_vote(session_id, day_no);

CREATE TABLE tasting.blind_pick (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES tasting.blind_session(id),
  sample_id   UUID NOT NULL REFERENCES tasting.blind_sample(id),
  lot_id      UUID NOT NULL,
  yes_ratio   DECIMAL(6,4) NOT NULL,
  mean_score  DECIMAL(5,2),
  consistency DECIMAL(6,4),
  selected    BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, sample_id)
);

CREATE INDEX tblind_pick_session_idx ON tasting.blind_pick(session_id);
