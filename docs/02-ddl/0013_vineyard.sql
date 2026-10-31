-- =====================================================================
-- WineCore · Migración 0013 · viñedo (vineyard) — hito M4
-- Parcelas (SIGPAC/Registro Vitícola), variedades, tratamientos (cuaderno ecológico),
-- labores, controles de maduración (voz/foto) y vendimia.
-- Especificación: docs/02-modelo-dominio.md §15 · Ecológico: docs/04-regulatorio/ecologico.md
-- =====================================================================

CREATE TABLE vineyard.parcel (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  name                 text NOT NULL,                                  -- nombre de pago o paraje
  ownership            text NOT NULL CHECK (ownership IN ('own','leased','supplier')),
  supplier_contact_id  uuid REFERENCES party.contact(id),              -- viticultor proveedor (uva comprada)
  sigpac_province      smallint NOT NULL CHECK (sigpac_province BETWEEN 1 AND 52),
  sigpac_municipality  smallint NOT NULL CHECK (sigpac_municipality BETWEEN 1 AND 999),
  sigpac_aggregate     smallint NOT NULL DEFAULT 0,
  sigpac_zone          smallint NOT NULL DEFAULT 0,
  sigpac_polygon       smallint NOT NULL CHECK (sigpac_polygon > 0),
  sigpac_parcel        integer NOT NULL CHECK (sigpac_parcel > 0),
  sigpac_enclosure     smallint,
  area_ha              numeric(8,4) NOT NULL CHECK (area_ha > 0),
  vineyard_register_ref text,                                           -- referencia en el Registro Vitícola
  is_organic           boolean NOT NULL DEFAULT true,
  organic_since        date,
  altitude_m           smallint,
  soil                 text,
  notes                text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ownership <> 'supplier' OR supplier_contact_id IS NOT NULL),
  UNIQUE (sigpac_province, sigpac_municipality, sigpac_aggregate, sigpac_zone, sigpac_polygon, sigpac_parcel, sigpac_enclosure)
);

CREATE TABLE vineyard.parcel_variety (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id     uuid NOT NULL REFERENCES vineyard.parcel(id),
  variety       text NOT NULL,
  color         text NOT NULL CHECK (color IN ('red','white')),
  area_ha       numeric(8,4) NOT NULL CHECK (area_ha > 0),
  planting_year smallint,
  rootstock     text,
  UNIQUE (parcel_id, variety)
);

-- Cuaderno de tratamientos (lo pide la certificadora ecológica: fecha, operario, producto, dosis, método y factura)
CREATE TABLE vineyard.treatment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id           uuid NOT NULL REFERENCES vineyard.parcel(id),
  applied_on          date NOT NULL,
  operator_name       text NOT NULL,
  product_id          uuid REFERENCES catalog.product(id),
  product_name        text NOT NULL,
  product_registration text,                                             -- nº de registro fitosanitario / certificación ecológica
  is_organic_approved boolean NOT NULL,
  dose                numeric(10,3) NOT NULL CHECK (dose > 0),
  dose_unit           text NOT NULL CHECK (dose_unit IN ('kg/ha','l/ha','g/hl','ml/hl')),
  treated_area_ha     numeric(8,4) NOT NULL CHECK (treated_area_ha > 0),
  method              text NOT NULL,
  target              text,                                              -- plaga/enfermedad
  supplier_invoice_id uuid REFERENCES purchasing.supplier_invoice(id),   -- factura del producto (prueba)
  notes               text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vineyard.field_task (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id   uuid NOT NULL REFERENCES vineyard.parcel(id),
  done_on     date NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('pruning','tillage','mowing','green_pruning','harvest','planting','other')),
  operator_name text,
  hours       numeric(6,2),
  notes       text,
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Control de maduración desde el móvil (voz, foto, tiempo) — lo crea el agente vendimia-campo vía MCP
CREATE TABLE vineyard.maturity_check (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id             uuid NOT NULL REFERENCES vineyard.parcel(id),
  checked_at            timestamptz NOT NULL,
  author                text NOT NULL,
  sensory_notes         text,                                            -- pulpa, pepita, hollejo, acidez percibida
  estimated_days_to_harvest smallint CHECK (estimated_days_to_harvest BETWEEN 0 AND 90),
  sanitary_status       text CHECK (sanitary_status IN ('good','fair','poor')),
  weather_snapshot      jsonb,                                           -- previsión consultada (fuente y fecha)
  probable_abv          numeric(4,2),
  total_acidity         numeric(5,2),
  source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','voice','chat')),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Vendimia por parcela (la recepción en bodega es una cellar.operation 'reception' que la referencia)
CREATE TABLE vineyard.harvest (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id        uuid NOT NULL REFERENCES vineyard.parcel(id),
  vintage          smallint NOT NULL CHECK (vintage BETWEEN 1990 AND 2100),
  harvested_on     date NOT NULL,
  variety          text NOT NULL,
  estimated_kg     numeric(10,1),
  crew_size        smallint,
  reception_operation_id uuid REFERENCES cellar.operation(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER parcel_audit AFTER INSERT OR UPDATE ON vineyard.parcel FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER parcel_variety_audit AFTER INSERT OR UPDATE OR DELETE ON vineyard.parcel_variety FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER treatment_audit AFTER INSERT OR UPDATE ON vineyard.treatment FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER treatment_no_delete BEFORE DELETE ON vineyard.treatment FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();
CREATE TRIGGER field_task_audit AFTER INSERT OR UPDATE ON vineyard.field_task FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER maturity_check_audit AFTER INSERT OR UPDATE ON vineyard.maturity_check FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER harvest_audit AFTER INSERT OR UPDATE ON vineyard.harvest FOR EACH ROW EXECUTE FUNCTION audit.capture();
