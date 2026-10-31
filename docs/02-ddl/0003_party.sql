-- =====================================================================
-- WineCore · Migración 0003 · contactos (party)
-- Un maestro único de contactos compartido por P.O y CVPO (deduplicado), con
-- cuentas contables y condiciones por entidad.
-- Especificación: docs/02-modelo-dominio.md §6 · Migración: docs/06-migracion.md §3
-- =====================================================================

CREATE TABLE party.contact (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL CHECK (kind IN ('company','person')),
  legal_name          text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 120),   -- Verifactu: NombreRazon ≤ 120
  trade_name          text,
  tax_id              text CHECK (tax_id ~ '^[A-Z0-9]{2,20}$'),                        -- normalizado: sin espacios, guiones ni prefijo ES
  tax_id_type         text NOT NULL DEFAULT 'none' CHECK (tax_id_type IN ('nif','nie','vat_eu','passport','foreign_id','none')),
  tax_id_country      char(2),
  vat_id_validated_at timestamptz,                                                    -- validación VIES (operaciones intracomunitarias)
  country_code        char(2) NOT NULL DEFAULT 'ES',
  language            char(2) NOT NULL DEFAULT 'es' CHECK (language IN ('es','en')),
  currency            char(3) NOT NULL DEFAULT 'EUR',
  is_customer         boolean NOT NULL DEFAULT false,
  is_supplier         boolean NOT NULL DEFAULT false,
  is_carrier          boolean NOT NULL DEFAULT false,
  is_logistics_operator boolean NOT NULL DEFAULT false,
  vat_regime          text NOT NULL DEFAULT 'general' CHECK (vat_regime IN (
                        'general','equivalence_surcharge','export','intra_eu','canary_ceuta_melilla','exempt_other')),
  default_channel     text,                                                            -- FK a sales.channel (se añade en 0007)
  default_price_list_id uuid,                                                          -- FK a catalog.price_list (se añade en 0004)
  payment_method      text CHECK (payment_method IN ('transfer','direct_debit','card','cash','stripe','other')),
  payment_terms_days  smallint NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 180),
  iban_enc            bytea,                                                           -- cifrado con WINECORE_DATA_KEY
  iban_last4          char(4),
  sepa_mandate_ref    text,
  sepa_mandate_date   date,
  excise_number       text,                                                            -- CAE/SEED del destinatario (e-DA)
  eori                text,
  gln                 char(13) CHECK (gln ~ '^[0-9]{13}$'),
  include_in_m347     boolean NOT NULL DEFAULT true,
  marketing_consent   boolean NOT NULL DEFAULT false,
  marketing_consent_at timestamptz,
  marketing_consent_source text,
  notes               text,
  merged_into_id      uuid REFERENCES party.contact(id),
  archived_at         timestamptz,
  legacy_refs         jsonb NOT NULL DEFAULT '{}'::jsonb,                               -- {"holded_cvpo":"…","holded_po":"…","shopify":"…"}
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  CHECK (tax_id IS NOT NULL OR tax_id_type = 'none')
);
-- Un NIF solo puede pertenecer a un contacto vivo (los fusionados quedan apuntando al superviviente)
CREATE UNIQUE INDEX contact_tax_id_uq ON party.contact(tax_id)
  WHERE tax_id IS NOT NULL AND merged_into_id IS NULL AND archived_at IS NULL;
CREATE INDEX contact_name_trgm_idx ON party.contact(lower(legal_name));
CREATE INDEX contact_roles_idx ON party.contact(is_customer, is_supplier) WHERE merged_into_id IS NULL;
CREATE TRIGGER contact_touch BEFORE UPDATE ON party.contact FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER contact_no_delete BEFORE DELETE ON party.contact FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE party.contact_address (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES party.contact(id),
  kind          text NOT NULL CHECK (kind IN ('billing','shipping','both')),
  label         text,
  line1         text NOT NULL,
  line2         text,
  postal_code   text NOT NULL,
  city          text NOT NULL,
  province      text,
  country_code  char(2) NOT NULL,
  gln           char(13) CHECK (gln ~ '^[0-9]{13}$'),          -- lugar de entrega (EDI)
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
CREATE UNIQUE INDEX contact_address_default_uq ON party.contact_address(contact_id, kind)
  WHERE is_default AND archived_at IS NULL;

CREATE TABLE party.contact_person (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES party.contact(id),
  full_name   text NOT NULL,
  role        text,
  email       citext,
  phone       text,
  receives_invoices boolean NOT NULL DEFAULT false,
  receives_dunning  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX contact_person_email_idx ON party.contact_person(email);

-- Condiciones y cuenta contable por entidad (el mismo cliente puede serlo de P.O y de CVPO)
CREATE TABLE party.contact_entity_terms (
  contact_id        uuid NOT NULL REFERENCES party.contact(id),
  legal_entity_id   uuid NOT NULL REFERENCES core.legal_entity(id),
  customer_account  text CHECK (customer_account ~ '^43[0-9]{6}$'),
  supplier_account  text CHECK (supplier_account ~ '^4[01][0-9]{6}$'),
  discount_pct      numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  credit_limit      numeric(14,2),
  edi_supplier_code text,                       -- código de proveedor asignado por el cliente (p. ej. ECI)
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, legal_entity_id)
);

-- GLN del cliente por función (EDI: comprador, facturar a, pagador, receptor del mensaje, punto de entrega)
CREATE TABLE party.contact_gln (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES party.contact(id),
  role        text NOT NULL CHECK (role IN ('buyer','invoicee','payer','message_receiver','delivery','supplier_assigned')),
  gln         char(13) NOT NULL CHECK (gln ~ '^[0-9]{13}$'),
  label       text,                                              -- p. ej. "Centro X", "Departamento 209"
  address_id  uuid REFERENCES party.contact_address(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (contact_id, role, gln)
);

-- Registro de fusiones de duplicados (deduplicación manual o asistida)
CREATE TABLE party.contact_merge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id   uuid NOT NULL REFERENCES party.contact(id),
  merged_id     uuid NOT NULL REFERENCES party.contact(id),
  rule          text NOT NULL CHECK (rule IN ('same_tax_id','same_email','same_name_postal_code','manual')),
  field_choices jsonb NOT NULL,                 -- qué valor se quedó por campo
  merged_by     text NOT NULL,
  merged_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (survivor_id <> merged_id)
);

CREATE TRIGGER contact_audit AFTER INSERT OR UPDATE ON party.contact FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER contact_address_audit AFTER INSERT OR UPDATE ON party.contact_address FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER contact_person_audit AFTER INSERT OR UPDATE ON party.contact_person FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER contact_entity_terms_audit AFTER INSERT OR UPDATE ON party.contact_entity_terms FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER contact_merge_audit AFTER INSERT ON party.contact_merge FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER contact_gln_audit AFTER INSERT OR UPDATE ON party.contact_gln FOR EACH ROW EXECUTE FUNCTION audit.capture();
