-- WineCore · 0004_catalog · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0004_catalog.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0004 · catálogo (catalog)
-- Vinos (referencias/marcas), formatos, productos vendibles, tarifas versionadas,
-- tarifa intercompañía (D4) y coste estándar (Q-017).
-- Especificación: docs/02-modelo-dominio.md §7
-- =====================================================================

CREATE TABLE catalog.wine (id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  -- p. ej. 'ARCAL', 'ENTREDICHO'
  name           VARCHAR NOT NULL,
  color          VARCHAR NOT NULL CHECK (color IN ('red','white','rose','orange','sweet','sparkling','other')),
  category       VARCHAR NOT NULL DEFAULT 'wine' CHECK (category IN ('wine','pgi_wine','pdo_wine','fortified','other')),
  pdo_pgi_name   VARCHAR,
  -- DOP/IGP si aplica
  is_single_plot boolean NOT NULL DEFAULT false,
  -- vino de parcela única
  is_organic     boolean NOT NULL DEFAULT true,
  no_added_sulfites boolean NOT NULL DEFAULT false,
  description    VARCHAR,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE catalog.format (id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             VARCHAR NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,10}$'),
  -- 'B025','B050','B075','B150','BIB3','BIB5','BIB10'
  name             VARCHAR NOT NULL,
  container        VARCHAR NOT NULL CHECK (container IN ('bottle','bag_in_box','keg','other')),
  nominal_volume_ml integer NOT NULL CHECK (nominal_volume_ml > 0),
  units_per_case   smallint NOT NULL DEFAULT 6 CHECK (units_per_case > 0),
  cases_per_pallet smallint NOT NULL DEFAULT 112 CHECK (cases_per_pallet > 0),
  -- palet americano; el europeo se configura aparte
  unit_gross_weight_g integer CHECK (unit_gross_weight_g > 0),
  -- e-DA, DESADV y transporte
  unit_net_weight_g   integer CHECK (unit_net_weight_g > 0),
  is_active        boolean NOT NULL DEFAULT true,
  CHECK (unit_net_weight_g IS NULL OR unit_gross_weight_g IS NULL OR unit_net_weight_g <= unit_gross_weight_g)
);


CREATE TABLE catalog.product (id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                VARCHAR NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{1,39}$'),
  name               VARCHAR NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  name_en            VARCHAR,
  kind               VARCHAR NOT NULL CHECK (kind IN (
                       'wine','bulk_wine','packaging_material','oenological_product',
                       'merchandise','service','gift_card','other')),
  wine_id            uuid REFERENCES catalog.wine(id),
  vintage            smallint CHECK (vintage BETWEEN 1990 AND 2100),
  format_id          uuid REFERENCES catalog.format(id),
  unit               VARCHAR NOT NULL DEFAULT 'ud' CHECK (unit IN ('ud','l','kg','h','month','service')),
  gtin               VARCHAR CHECK (gtin ~ '^[0-9]{8}$|^[0-9]{12,14}$'),
  -- EAN/GTIN de la unidad de venta
  gtin_case          VARCHAR CHECK (gtin_case ~ '^[0-9]{14}$'),
  -- GTIN-14 de la caja
  nc_code            VARCHAR CHECK (nc_code ~ '^[0-9]{8}$'),
  -- nomenclatura combinada (EMCS/SILICIE/aduanas)
  excise_product_key VARCHAR,
  -- clave de producto II.EE. (ver 04-regulatorio/silicie.md)
  alcohol_pct        DECIMAL(4,2) CHECK (alcohol_pct BETWEEN 0 AND 25),
  default_tax_code   VARCHAR,
  -- FK a billing.tax_code (se añade en 0009)
  sales_account      VARCHAR CHECK (sales_account ~ '^7[0-9]{2,7}$'),
  is_stock_tracked   boolean NOT NULL DEFAULT true,
  requires_lot       boolean NOT NULL DEFAULT false,
  -- true para vino (regla de facturación)
  is_active          boolean NOT NULL DEFAULT true,
  legacy_refs        JSON NOT NULL DEFAULT '{}'::JSON,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('service','gift_card') OR NOT is_stock_tracked)
);


CREATE TABLE catalog.gtin_current (
  gtin        VARCHAR PRIMARY KEY CHECK (gtin ~ '^[0-9]{8}$|^[0-9]{12,14}$'),
  product_id  uuid NOT NULL REFERENCES catalog.product(id),
  updated_by  VARCHAR NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Código de artículo que asigna cada cliente (p. ej. "departamento + referencia" de un gran almacén)
CREATE TABLE catalog.customer_item_code (
  contact_id  uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES catalog.product(id),
  code        VARCHAR NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, product_id),
  UNIQUE (contact_id, code)
);


-- ---------------------------------------------------------------------
-- Tarifas versionadas (cliente final, distribuidor, tienda)
-- ---------------------------------------------------------------------
CREATE TABLE catalog.price_list (id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR NOT NULL UNIQUE CHECK (code IN ('final','distributor','shop') OR code ~ '^custom-[a-z0-9-]{2,30}$'),
  name         VARCHAR NOT NULL,
  currency     VARCHAR NOT NULL DEFAULT 'EUR',
  tax_included boolean NOT NULL DEFAULT false,
  -- precios con IVA incluido (p. ej. tienda/web)
  is_active    boolean NOT NULL DEFAULT true
);


CREATE TABLE catalog.price_list_version (id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id  uuid NOT NULL REFERENCES catalog.price_list(id),
  version        integer NOT NULL CHECK (version >= 1),
  valid_from     date NOT NULL,
  valid_to       date,
  -- exclusivo; NULL = abierta
  status         VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  notes          VARCHAR,
  approval_request_id uuid,
  activated_at   TIMESTAMPTZ,
  created_by     VARCHAR NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, version),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);


CREATE TABLE catalog.price_list_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES catalog.price_list_version(id),
  product_id  uuid NOT NULL REFERENCES catalog.product(id),
  min_qty     DECIMAL(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  unit_price  DECIMAL(14,6) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (version_id, product_id, min_qty)
);


-- Una versión activa no se edita: se crea otra (WC050)

-- ---------------------------------------------------------------------
-- Tarifa intercompañía P.O → CVPO (D4: precio validado por el asesor; WineCore no lo calcula ni opina)
-- unit_price = round(precio_tarifa_base × (1 − discount_pct/100), 6)
-- ---------------------------------------------------------------------
CREATE TABLE catalog.intercompany_tariff (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_entity_id      uuid NOT NULL,
  buyer_entity_id       uuid NOT NULL,
  base_price_list_id    uuid NOT NULL REFERENCES catalog.price_list(id),
  discount_pct          DECIMAL(5,2) NOT NULL CHECK (discount_pct >= 0 AND discount_pct < 100),
  valid_from            date NOT NULL,
  valid_to              date,
  status                VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  advisor_validation    VARCHAR NOT NULL CHECK (length(advisor_validation) >= 5),  -- referencia a la validación del asesor (documento adjunto)
  approval_request_id   uuid,
  created_by            VARCHAR NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (seller_entity_id <> buyer_entity_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);


-- Coste estándar por producto (control "no vender por debajo del coste")
CREATE TABLE catalog.standard_cost (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES catalog.product(id),
  valid_from  date NOT NULL,
  unit_cost   DECIMAL(14,6) NOT NULL CHECK (unit_cost >= 0),
  source      VARCHAR NOT NULL CHECK (source IN ('manual','costing')),
  notes       VARCHAR,
  created_by  VARCHAR NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, valid_from)
);
