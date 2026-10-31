-- WineCore · 0008_sales · dialecto DuckDB (ADR 002).
-- Referencia: docs/02-ddl/0008_sales.sql
-- Disparadores, funciones e índices únicos parciales: api/src/core/db/guards/registry.ts

-- =====================================================================
-- WineCore · Migración 0008 · comercial (sales)
-- Canales, presupuestos, pedidos (manual, EDI, web, MCP), albaranes e incidencias de transporte.
-- Especificación: docs/02-modelo-dominio.md §11 · Estados: docs/03-maquinas-estado.md §3–§4
-- =====================================================================

CREATE TABLE sales.channel (code     VARCHAR PRIMARY KEY CHECK (code ~ '^[a-z_]{2,20}$'),
  name_es  VARCHAR NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO sales.channel(code, name_es) VALUES
 ('direct','Venta directa'), ('distributor','Distribuidor'), ('horeca','Restauración'),
 ('eci_edi','El Corte Inglés (EDI)'), ('web','Tienda web'), ('fair','Ferias y mercados'),
 ('cellar_shop','Tienda de la bodega'), ('export','Exportación'), ('institutional','Institucional'),
 ('intercompany','Intercompañía');


-- ---------------------------------------------------------------------
-- Presupuestos
-- ---------------------------------------------------------------------
CREATE TABLE sales.quote (id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL,
  series_id       uuid,
  number          VARCHAR,
  status          VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
  customer_id     uuid NOT NULL,
  channel         VARCHAR NOT NULL REFERENCES sales.channel(code),
  issue_date      date,
  valid_until     date,
  currency        VARCHAR NOT NULL DEFAULT 'EUR',
  language        VARCHAR NOT NULL DEFAULT 'es',
  is_proforma     boolean NOT NULL DEFAULT false,
  -- factura proforma (exportación)
  incoterm        VARCHAR CHECK (incoterm IN ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF')),
  notes           VARCHAR,
  subtotal        DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total           DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by      VARCHAR NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR number IS NOT NULL)
);


CREATE TABLE sales.quote_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     uuid NOT NULL REFERENCES sales.quote(id),
  line_no      smallint NOT NULL CHECK (line_no > 0),
  product_id   uuid,
  description  VARCHAR NOT NULL,
  quantity     DECIMAL(14,3) NOT NULL CHECK (quantity > 0),
  unit_price   DECIMAL(14,6) NOT NULL CHECK (unit_price >= 0),
  discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_code     VARCHAR NOT NULL,                                  -- FK a billing.tax_code (0009)
  UNIQUE (quote_id, line_no)
);


-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
CREATE TABLE sales.sales_order (id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id      uuid,
  -- la decide el motor de reglas (D3) al confirmar
  series_id            uuid,
  number               VARCHAR,
  status               VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN (
                         'draft','confirmed','partially_delivered','delivered','closed','cancelled')),
  invoicing_status     VARCHAR NOT NULL DEFAULT 'not_invoiced' CHECK (invoicing_status IN ('not_invoiced','partially_invoiced','invoiced')),
  source               VARCHAR NOT NULL CHECK (source IN ('manual','edi','web','mcp','import')),
  channel              VARCHAR NOT NULL REFERENCES sales.channel(code),
  customer_id          uuid NOT NULL,
  customer_order_ref   VARCHAR,
  -- nº de pedido del cliente (ORDERS BGM, confirmación del importador)
  customer_department  VARCHAR,
  -- departamento/sección del cliente (EDI)
  customer_cost_center VARCHAR,
  -- centro de coste del cliente (INVOIC RFF+API)
  external_ref         VARCHAR,
  -- id externo (EDI, Stripe)
  order_date           date NOT NULL,
  requested_date       date,
  ship_to              JSON,
  -- dirección de entrega congelada (y GLN si EDI)
  incoterm             VARCHAR,
  billing_rule_set_id  uuid,
  -- FK a billing.billing_rule_set (0009)
  billing_rule_id      uuid,
  -- FK a billing.billing_rule (0009)
  billing_rule_trace   JSON,
  -- cómo se resolvió la entidad (cliente > canal > defecto)
  quote_id             uuid REFERENCES sales.quote(id),
  edi_message_id       uuid,
  -- FK a regulatory.edi_message (0012)
  currency             VARCHAR NOT NULL DEFAULT 'EUR',
  notes                VARCHAR,
  subtotal             DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_total            DECIMAL(14,2) NOT NULL DEFAULT 0,
  total                DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by           VARCHAR NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (number IS NOT NULL AND legal_entity_id IS NOT NULL AND billing_rule_id IS NOT NULL))
);


CREATE TABLE sales.sales_order_line (id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES sales.sales_order(id),
  line_no        smallint NOT NULL CHECK (line_no > 0),
  product_id     uuid NOT NULL,
  description    VARCHAR NOT NULL,
  quantity       DECIMAL(14,3) NOT NULL CHECK (quantity > 0),
  unit_price     DECIMAL(14,6) NOT NULL CHECK (unit_price >= 0),
  discount_pct   DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_code       VARCHAR NOT NULL,
  external_line_ref VARCHAR,
  -- nº de línea EDI
  UNIQUE (order_id, line_no)
);


-- ---------------------------------------------------------------------
-- Albaranes (mueven el stock FÍSICO, D2)
-- ---------------------------------------------------------------------
CREATE TABLE sales.delivery_note (id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL,
  series_id           uuid,
  number              VARCHAR,
  kind                VARCHAR NOT NULL CHECK (kind IN ('sale','consignment','transfer','return','sample')),
  status              VARCHAR NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','shipped','delivered','cancelled')),
  invoicing_status    VARCHAR NOT NULL DEFAULT 'not_invoiced' CHECK (invoicing_status IN (
                        'not_invoiced','partially_invoiced','invoiced','not_invoiceable')),
  customer_id         uuid,
  sales_order_id      uuid REFERENCES sales.sales_order(id),
  channel             VARCHAR REFERENCES sales.channel(code),
  issue_date          date,
  from_location_id    uuid NOT NULL,
  to_location_id      uuid,
  -- consigna/traspaso/devolución
  ship_to             JSON,
  carrier_contact_id  uuid,
  tracking_ref        VARCHAR,
  packages            smallint CHECK (packages >= 0),
  pallets             smallint CHECK (pallets >= 0),
  incoterm            VARCHAR,
  is_valued           boolean NOT NULL DEFAULT false,
  -- albarán valorado
  currency            VARCHAR NOT NULL DEFAULT 'EUR',
  emcs_document_id    uuid,
  -- FK a regulatory.emcs_document (0012)
  shipped_at          TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  pod_attachment_id   uuid,
  -- prueba de entrega
  notes               VARCHAR,
  cancelled_reason    VARCHAR,
  created_by          VARCHAR NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL)),
  CHECK (kind NOT IN ('sale','sample') OR customer_id IS NOT NULL),
  CHECK (kind NOT IN ('consignment','transfer','return') OR to_location_id IS NOT NULL),
  CHECK (to_location_id IS NULL OR to_location_id <> from_location_id),
  CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);


CREATE TABLE sales.delivery_note_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id   uuid NOT NULL REFERENCES sales.delivery_note(id),
  line_no            smallint NOT NULL CHECK (line_no > 0),
  order_line_id      uuid REFERENCES sales.sales_order_line(id),
  product_id         uuid NOT NULL,
  lot_id             uuid,
  description        VARCHAR NOT NULL,
  quantity           DECIMAL(14,3) NOT NULL CHECK (quantity > 0),
  unit_price         DECIMAL(14,6) CHECK (unit_price >= 0),            -- solo si es valorado
  discount_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_code           VARCHAR,
  UNIQUE (delivery_note_id, line_no)
);


-- Un albarán emitido solo cambia estado logístico/facturación (WC060)

-- Unidades logísticas con SSCC (solo si un cliente exige albarán EDI/etiqueta GS1-128; posterior)
CREATE TABLE sales.handling_unit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id uuid NOT NULL REFERENCES sales.delivery_note(id),
  kind             VARCHAR NOT NULL CHECK (kind IN ('pallet','case')),
  sscc             VARCHAR NOT NULL UNIQUE CHECK (sscc ~ '^[0-9]{18}$'),
  gtin_pallet      VARCHAR,
  cases            smallint,
  contents         JSON NOT NULL,                                   -- [{product_id, lot_id, qty}]
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------
-- Incidencias de transporte (roturas, pérdidas, rechazos)
-- ---------------------------------------------------------------------
CREATE TABLE sales.shipping_incident (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id  uuid NOT NULL REFERENCES sales.delivery_note(id),
  kind              VARCHAR NOT NULL CHECK (kind IN ('breakage','loss','delay','refused','other')),
  reported_at       TIMESTAMPTZ NOT NULL,
  description       VARCHAR NOT NULL,
  units_affected    integer CHECK (units_affected >= 0),
  carrier_claim_ref VARCHAR,
  claim_deadline    date,
  status            VARCHAR NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','compensated','rejected','closed')),
  amount_claimed    DECIMAL(14,2),
  amount_recovered  DECIMAL(14,2),
  created_by        VARCHAR NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
