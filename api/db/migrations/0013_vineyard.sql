-- WineCore · 0013_vineyard · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0013_vineyard.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0013 · viñedo (vineyard) — hito M4
-- Parcelas (SIGPAC/Registro Vitícola), variedades, tratamientos (cuaderno ecológico),
-- labores, controles de maduración (voz/foto) y vendimia.
-- Especificación: docs/02-modelo-dominio.md §15 · Ecológico: docs/04-regulatorio/ecologico.md
-- =====================================================================

CREATE TABLE vineyard.parcel (id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name                 VARCHAR NOT NULL,
  -- nombre de pago o paraje
  ownership            VARCHAR NOT NULL CHECK (ownership IN ('own','leased','supplier')),
  supplier_contact_id  uuid,
  -- viticultor proveedor (uva comprada)
  sigpac_province      smallint NOT NULL CHECK (sigpac_province BETWEEN 1 AND 52),
  sigpac_municipality  smallint NOT NULL CHECK (sigpac_municipality BETWEEN 1 AND 999),
  sigpac_aggregate     smallint NOT NULL DEFAULT 0,
  sigpac_zone          smallint NOT NULL DEFAULT 0,
  sigpac_polygon       smallint NOT NULL CHECK (sigpac_polygon > 0),
  sigpac_parcel        integer NOT NULL CHECK (sigpac_parcel > 0),
  sigpac_enclosure     smallint,
  area_ha              DECIMAL(8,4) NOT NULL CHECK (area_ha > 0),
  vineyard_register_ref VARCHAR,
  -- referencia en el Registro Vitícola
  is_organic           boolean NOT NULL DEFAULT true,
  organic_since        date,
  altitude_m           smallint,
  soil                 VARCHAR,
  notes                VARCHAR,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ownership <> 'supplier' OR supplier_contact_id IS NOT NULL),
  UNIQUE (sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone, sigpac_polygon, sigpac_parcel, sigpac_enclosure)
);


CREATE TABLE vineyard.parcel_variety (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id     uuid NOT NULL REFERENCES vineyard.parcel(id),
  variety       VARCHAR NOT NULL,
  color         VARCHAR NOT NULL CHECK (color IN ('red','white')),
  area_ha       DECIMAL(8,4) NOT NULL CHECK (area_ha > 0),
  planting_year smallint,
  rootstock     VARCHAR,
  UNIQUE (parcel_id, variety)
);


-- Cuaderno de tratamientos (lo pide la certificadora ecológica: fecha, operario, producto, dosis, método y factura)
CREATE TABLE vineyard.treatment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id           uuid NOT NULL REFERENCES vineyard.parcel(id),
  applied_on          date NOT NULL,
  operator_name       VARCHAR NOT NULL,
  product_id          uuid,
  product_name        VARCHAR NOT NULL,
  product_registration VARCHAR,                                             -- nº de registro fitosanitario / certificación ecológica
  is_organic_approved boolean NOT NULL,
  dose                DECIMAL(10,3) NOT NULL CHECK (dose > 0),
  dose_unit           VARCHAR NOT NULL CHECK (dose_unit IN ('kg/ha','l/ha','g/hl','ml/hl')),
  treated_area_ha     DECIMAL(8,4) NOT NULL CHECK (treated_area_ha > 0),
  method              VARCHAR NOT NULL,
  target              VARCHAR,                                              -- plaga/enfermedad
  advisor_name        VARCHAR,                                              -- asesor (RD 1311/2012, anexo III I B d)
  equipment_roma      VARCHAR,                                              -- equipo y nº ROMA (anexo III I B h)
  efficacy            VARCHAR,                                              -- evaluación de la eficacia (anexo III I B j)
  cue_recorded_at     TIMESTAMPTZ,                                       -- anotado en el CUE (obligatorio en 1 mes desde 01-01-2027)
  supplier_invoice_id uuid,   -- factura del producto (prueba)
  notes               VARCHAR,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE vineyard.field_task (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id   uuid NOT NULL REFERENCES vineyard.parcel(id),
  done_on     date NOT NULL,
  kind        VARCHAR NOT NULL CHECK (kind IN ('pruning','tillage','mowing','green_pruning','harvest','planting','other')),
  operator_name VARCHAR,
  hours       DECIMAL(6,2),
  notes       VARCHAR,
  source      VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Control de maduración desde el móvil (voz, foto, tiempo) — lo crea el agente vendimia-campo vía MCP
CREATE TABLE vineyard.maturity_check (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id             uuid NOT NULL REFERENCES vineyard.parcel(id),
  checked_at            TIMESTAMPTZ NOT NULL,
  author                VARCHAR NOT NULL,
  sensory_notes         VARCHAR,                                            -- pulpa, pepita, hollejo, acidez percibida
  estimated_days_to_harvest smallint CHECK (estimated_days_to_harvest BETWEEN 0 AND 90),
  sanitary_status       VARCHAR CHECK (sanitary_status IN ('good','fair','poor')),
  weather_snapshot      JSON,                                           -- previsión consultada (fuente y fecha)
  probable_abv          DECIMAL(4,2),
  total_acidity         DECIMAL(5,2),
  source                VARCHAR NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Vendimia por parcela (la recepción en bodega es una cellar.operation 'reception' que la referencia)
CREATE TABLE vineyard.harvest (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        uuid NOT NULL REFERENCES vineyard.parcel(id),
  vintage          smallint NOT NULL CHECK (vintage BETWEEN 1990 AND 2100),
  harvested_on     date NOT NULL,
  variety          VARCHAR NOT NULL,
  estimated_kg     DECIMAL(10,1),
  crew_size        smallint,
  reception_operation_id uuid,
  notes            VARCHAR,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
