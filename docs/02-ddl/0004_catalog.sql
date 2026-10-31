-- =====================================================================
-- WineCore · Migración 0004 · catálogo (catalog)
-- Vinos (referencias/marcas), formatos, productos vendibles, tarifas versionadas,
-- tarifa intercompañía (D4) y coste estándar (Q-017).
-- Especificación: docs/02-modelo-dominio.md §7
-- =====================================================================

CREATE TABLE catalog.wine (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),   -- p. ej. 'ARCAL', 'ENTREDICHO'
  name           text NOT NULL,
  color          text NOT NULL CHECK (color IN ('red','white','rose','orange','sweet','sparkling','other')),
  category       text NOT NULL DEFAULT 'wine' CHECK (category IN ('wine','pgi_wine','pdo_wine','fortified','other')),
  pdo_pgi_name   text,                                                        -- DOP/IGP si aplica
  is_single_plot boolean NOT NULL DEFAULT false,                              -- vino de parcela única
  is_organic     boolean NOT NULL DEFAULT true,
  no_added_sulfites boolean NOT NULL DEFAULT false,
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog.format (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,10}$'),     -- 'B025','B050','B075','B150','BIB3','BIB5','BIB10'
  name             text NOT NULL,
  container        text NOT NULL CHECK (container IN ('bottle','bag_in_box','keg','other')),
  nominal_volume_ml integer NOT NULL CHECK (nominal_volume_ml > 0),
  units_per_case   smallint NOT NULL DEFAULT 6 CHECK (units_per_case > 0),
  cases_per_pallet smallint NOT NULL DEFAULT 112 CHECK (cases_per_pallet > 0),  -- palet americano; el europeo se configura aparte
  is_active        boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.product (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                text NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{1,39}$'),
  name               text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  name_en            text,
  kind               text NOT NULL CHECK (kind IN (
                       'wine','bulk_wine','packaging_material','oenological_product',
                       'merchandise','service','gift_card','other')),
  wine_id            uuid REFERENCES catalog.wine(id),
  vintage            smallint CHECK (vintage BETWEEN 1990 AND 2100),
  format_id          uuid REFERENCES catalog.format(id),
  unit               text NOT NULL DEFAULT 'ud' CHECK (unit IN ('ud','l','kg','h','month','service')),
  gtin               text CHECK (gtin ~ '^[0-9]{8}$|^[0-9]{12,14}$'),          -- EAN/GTIN de la unidad de venta
  gtin_case          text CHECK (gtin_case ~ '^[0-9]{14}$'),                    -- GTIN-14 de la caja
  nc_code            text CHECK (nc_code ~ '^[0-9]{8}$'),                       -- nomenclatura combinada (EMCS/SILICIE/aduanas)
  excise_product_key text,                                                       -- clave de producto II.EE. (ver 04-regulatorio/silicie.md)
  alcohol_pct        numeric(4,2) CHECK (alcohol_pct BETWEEN 0 AND 25),
  default_tax_code   text,                                                       -- FK a billing.tax_code (se añade en 0009)
  sales_account      text CHECK (sales_account ~ '^7[0-9]{2,7}$'),
  is_stock_tracked   boolean NOT NULL DEFAULT true,
  requires_lot       boolean NOT NULL DEFAULT false,                             -- true para vino (regla de facturación)
  is_active          boolean NOT NULL DEFAULT true,
  legacy_refs        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'wine' OR (wine_id IS NOT NULL AND format_id IS NOT NULL AND requires_lot)),
  CHECK (kind NOT IN ('service','gift_card') OR NOT is_stock_tracked)
);
CREATE UNIQUE INDEX product_wine_vintage_format_uq ON catalog.product(wine_id, coalesce(vintage, 0), format_id)
  WHERE kind = 'wine';
CREATE UNIQUE INDEX product_gtin_uq ON catalog.product(gtin) WHERE gtin IS NOT NULL;
CREATE TRIGGER product_touch BEFORE UPDATE ON catalog.product FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER product_no_delete BEFORE DELETE ON catalog.product FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

-- ---------------------------------------------------------------------
-- Tarifas versionadas (cliente final, distribuidor, tienda)
-- ---------------------------------------------------------------------
CREATE TABLE catalog.price_list (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE CHECK (code IN ('final','distributor','shop') OR code ~ '^custom-[a-z0-9-]{2,30}$'),
  name         text NOT NULL,
  currency     char(3) NOT NULL DEFAULT 'EUR',
  tax_included boolean NOT NULL DEFAULT false,          -- precios con IVA incluido (p. ej. tienda/web)
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog.price_list_version (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id  uuid NOT NULL REFERENCES catalog.price_list(id),
  version        integer NOT NULL CHECK (version >= 1),
  valid_from     date NOT NULL,
  valid_to       date,                                   -- exclusivo; NULL = abierta
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  notes          text,
  approval_request_id uuid REFERENCES ops.approval_request(id),
  activated_at   timestamptz,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, version),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (price_list_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&) WHERE (status = 'active')
);

CREATE TABLE catalog.price_list_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES catalog.price_list_version(id),
  product_id  uuid NOT NULL REFERENCES catalog.product(id),
  min_qty     numeric(14,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0),
  unit_price  numeric(14,6) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (version_id, product_id, min_qty)
);

-- Una versión activa no se edita: se crea otra (WC050)
CREATE FUNCTION catalog.price_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM catalog.price_list_version
   WHERE id = coalesce(NEW.version_id, OLD.version_id);
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'WC050: la versión de tarifa no está en borrador; crea una versión nueva';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER price_list_item_guard BEFORE INSERT OR UPDATE OR DELETE ON catalog.price_list_item
  FOR EACH ROW EXECUTE FUNCTION catalog.price_item_guard();

ALTER TABLE party.contact
  ADD CONSTRAINT contact_default_price_list_fk FOREIGN KEY (default_price_list_id) REFERENCES catalog.price_list(id);

-- ---------------------------------------------------------------------
-- Tarifa intercompañía P.O → CVPO (D4: precio validado por el asesor; WineCore no lo calcula ni opina)
-- unit_price = round(precio_tarifa_base × (1 − discount_pct/100), 6)
-- ---------------------------------------------------------------------
CREATE TABLE catalog.intercompany_tariff (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_entity_id      uuid NOT NULL REFERENCES core.legal_entity(id),
  buyer_entity_id       uuid NOT NULL REFERENCES core.legal_entity(id),
  base_price_list_id    uuid NOT NULL REFERENCES catalog.price_list(id),
  discount_pct          numeric(5,2) NOT NULL CHECK (discount_pct >= 0 AND discount_pct < 100),
  valid_from            date NOT NULL,
  valid_to              date,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  advisor_validation    text NOT NULL CHECK (length(advisor_validation) >= 5),  -- referencia a la validación del asesor (documento adjunto)
  approval_request_id   uuid REFERENCES ops.approval_request(id),
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (seller_entity_id <> buyer_entity_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (seller_entity_id WITH =, buyer_entity_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&)
    WHERE (status = 'active')
);

-- Coste estándar por producto (control "no vender por debajo del coste")
CREATE TABLE catalog.standard_cost (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES catalog.product(id),
  valid_from  date NOT NULL,
  unit_cost   numeric(14,6) NOT NULL CHECK (unit_cost >= 0),
  source      text NOT NULL CHECK (source IN ('manual','costing')),
  notes       text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, valid_from)
);

CREATE TRIGGER wine_audit AFTER INSERT OR UPDATE ON catalog.wine FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER format_audit AFTER INSERT OR UPDATE ON catalog.format FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER product_audit AFTER INSERT OR UPDATE ON catalog.product FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER price_list_audit AFTER INSERT OR UPDATE ON catalog.price_list FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER price_list_version_audit AFTER INSERT OR UPDATE ON catalog.price_list_version FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER price_list_item_audit AFTER INSERT OR UPDATE OR DELETE ON catalog.price_list_item FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER intercompany_tariff_audit AFTER INSERT OR UPDATE ON catalog.intercompany_tariff FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER standard_cost_audit AFTER INSERT OR UPDATE ON catalog.standard_cost FOR EACH ROW EXECUTE FUNCTION audit.capture();
