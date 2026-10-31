-- WineCore · 0003_party · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0003_party.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0003 · contactos (party)
-- Un maestro único de contactos compartido por P.O y CVPO (deduplicado), con
-- cuentas contables y condiciones por entidad.
-- Especificación: docs/02-modelo-dominio.md §6 · Migración: docs/06-migracion.md §3
-- =====================================================================

CREATE TABLE party.contact (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                VARCHAR NOT NULL CHECK (kind IN ('company','person')),
  legal_name          VARCHAR NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 120),
  -- Verifactu: NombreRazon ≤ 120
  trade_name          VARCHAR,
  tax_id              VARCHAR CHECK (tax_id ~ '^[A-Z0-9]{2,20}$'),
  -- normalizado: sin espacios, guiones ni prefijo ES
  tax_id_type         VARCHAR NOT NULL DEFAULT 'none' CHECK (tax_id_type IN ('nif','nie','vat_eu','passport','foreign_id','none')),
  tax_id_country      VARCHAR,
  vat_id_validated_at TIMESTAMPTZ,
  -- validación VIES (operaciones intracomunitarias)
  country_code        VARCHAR NOT NULL DEFAULT 'ES',
  language            VARCHAR NOT NULL DEFAULT 'es' CHECK (language IN ('es','en')),
  currency            VARCHAR NOT NULL DEFAULT 'EUR',
  is_customer         boolean NOT NULL DEFAULT false,
  is_supplier         boolean NOT NULL DEFAULT false,
  is_carrier          boolean NOT NULL DEFAULT false,
  is_logistics_operator boolean NOT NULL DEFAULT false,
  vat_regime          VARCHAR NOT NULL DEFAULT 'general' CHECK (vat_regime IN (
                        'general','equivalence_surcharge','export','intra_eu','canary_ceuta_melilla','exempt_other')),
  default_channel     VARCHAR,
  -- FK a sales.channel (se añade en 0007)
  default_price_list_id uuid,
  -- FK a catalog.price_list (se añade en 0004)
  payment_method      VARCHAR CHECK (payment_method IN ('transfer','direct_debit','card','cash','stripe','other')),
  payment_terms_days  smallint NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 180),
  iban_enc            BLOB,
  -- cifrado con WINECORE_DATA_KEY
  iban_last4          VARCHAR,
  sepa_mandate_ref    VARCHAR,
  sepa_mandate_date   date,
  excise_number       VARCHAR,
  -- CAE/SEED del destinatario (e-DA)
  eori                VARCHAR,
  gln                 VARCHAR CHECK (gln ~ '^[0-9]{13}$'),
  include_in_m347     boolean NOT NULL DEFAULT true,
  marketing_consent   boolean NOT NULL DEFAULT false,
  marketing_consent_at TIMESTAMPTZ,
  marketing_consent_source VARCHAR,
  notes               VARCHAR,
  merged_into_id      uuid REFERENCES party.contact(id),
  archived_at         TIMESTAMPTZ,
  legacy_refs         JSON NOT NULL DEFAULT '{}'::JSON,
  -- {"holded_cvpo":"…","holded_po":"…","shopify":"…"}
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tax_id IS NOT NULL OR tax_id_type = 'none')
);


CREATE TABLE party.contact_address (id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES party.contact(id),
  kind          VARCHAR NOT NULL CHECK (kind IN ('billing','shipping','both')),
  label         VARCHAR,
  line1         VARCHAR NOT NULL,
  line2         VARCHAR,
  postal_code   VARCHAR NOT NULL,
  city          VARCHAR NOT NULL,
  province      VARCHAR,
  country_code  VARCHAR NOT NULL,
  gln           VARCHAR CHECK (gln ~ '^[0-9]{13}$'),
  -- lugar de entrega (EDI)
  is_default    boolean NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);


CREATE TABLE party.contact_person (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES party.contact(id),
  full_name   VARCHAR NOT NULL,
  role        VARCHAR,
  email VARCHAR CHECK (email IS NULL OR email = lower(email)),
  phone       VARCHAR,
  receives_invoices boolean NOT NULL DEFAULT false,
  receives_dunning  boolean NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX contact_person_email_idx ON party.contact_person(email);


-- Condiciones y cuenta contable por entidad (el mismo cliente puede serlo de P.O y de CVPO)
CREATE TABLE party.contact_entity_terms (
  contact_id        uuid NOT NULL REFERENCES party.contact(id),
  legal_entity_id   uuid NOT NULL,
  customer_account  VARCHAR CHECK (customer_account ~ '^43[0-9]{6}$'),
  supplier_account  VARCHAR CHECK (supplier_account ~ '^4[01][0-9]{6}$'),
  discount_pct      DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  credit_limit      DECIMAL(14,2),
  edi_supplier_code VARCHAR,                       -- código de proveedor asignado por el cliente (p. ej. ECI)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, legal_entity_id)
);


-- GLN del cliente por función (EDI: comprador, facturar a, pagador, receptor del mensaje, punto de entrega)
CREATE TABLE party.contact_gln (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES party.contact(id),
  role        VARCHAR NOT NULL CHECK (role IN ('buyer','invoicee','payer','message_receiver','delivery','supplier_assigned')),
  gln         VARCHAR NOT NULL CHECK (gln ~ '^[0-9]{13}$'),
  label       VARCHAR,                                              -- p. ej. "Centro X", "Departamento 209"
  address_id  uuid REFERENCES party.contact_address(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (contact_id, role, gln)
);


-- Registro de fusiones de duplicados (deduplicación manual o asistida)
CREATE TABLE party.contact_merge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_id   uuid NOT NULL REFERENCES party.contact(id),
  merged_id     uuid NOT NULL REFERENCES party.contact(id),
  rule          VARCHAR NOT NULL CHECK (rule IN ('same_tax_id','same_email','same_name_postal_code','manual')),
  field_choices JSON NOT NULL,                 -- qué valor se quedó por campo
  merged_by     VARCHAR NOT NULL,
  merged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (survivor_id <> merged_id)
);
