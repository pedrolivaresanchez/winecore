-- =====================================================================
-- WineCore · Migración 0008 · comercial (sales)
-- Canales, presupuestos, pedidos (manual, EDI, web, MCP), albaranes e incidencias de transporte.
-- Especificación: docs/02-modelo-dominio.md §11 · Estados: docs/03-maquinas-estado.md §3–§4
-- =====================================================================

CREATE TABLE sales.channel (
  code     text PRIMARY KEY CHECK (code ~ '^[a-z_]{2,20}$'),
  name_es  text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO sales.channel(code, name_es) VALUES
 ('direct','Venta directa'), ('distributor','Distribuidor'), ('horeca','Restauración'),
 ('eci_edi','El Corte Inglés (EDI)'), ('web','Tienda web'), ('fair','Ferias y mercados'),
 ('cellar_shop','Tienda de la bodega'), ('export','Exportación'), ('institutional','Institucional'),
 ('intercompany','Intercompañía');

ALTER TABLE party.contact
  ADD CONSTRAINT contact_default_channel_fk FOREIGN KEY (default_channel) REFERENCES sales.channel(code);

-- ---------------------------------------------------------------------
-- Presupuestos
-- ---------------------------------------------------------------------
CREATE TABLE sales.quote (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id uuid NOT NULL REFERENCES core.legal_entity(id),
  series_id       uuid REFERENCES core.number_series(id),
  number          text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
  customer_id     uuid NOT NULL REFERENCES party.contact(id),
  channel         text NOT NULL REFERENCES sales.channel(code),
  issue_date      date,
  valid_until     date,
  currency        char(3) NOT NULL DEFAULT 'EUR',
  language        char(2) NOT NULL DEFAULT 'es',
  is_proforma     boolean NOT NULL DEFAULT false,              -- factura proforma (exportación)
  incoterm        text CHECK (incoterm IN ('EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF')),
  notes           text,
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  tax_total       numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, number),
  CHECK (status = 'draft' OR number IS NOT NULL)
);
CREATE TRIGGER quote_touch BEFORE UPDATE ON sales.quote FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE sales.quote_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     uuid NOT NULL REFERENCES sales.quote(id),
  line_no      smallint NOT NULL CHECK (line_no > 0),
  product_id   uuid REFERENCES catalog.product(id),
  description  text NOT NULL,
  quantity     numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(14,6) NOT NULL CHECK (unit_price >= 0),
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_code     text NOT NULL,                                  -- FK a billing.tax_code (0009)
  UNIQUE (quote_id, line_no)
);

-- ---------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------
CREATE TABLE sales.sales_order (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id      uuid REFERENCES core.legal_entity(id),        -- la decide el motor de reglas (D3) al confirmar
  series_id            uuid REFERENCES core.number_series(id),
  number               text,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN (
                         'draft','confirmed','partially_delivered','delivered','closed','cancelled')),
  invoicing_status     text NOT NULL DEFAULT 'not_invoiced' CHECK (invoicing_status IN ('not_invoiced','partially_invoiced','invoiced')),
  source               text NOT NULL CHECK (source IN ('manual','edi','web','mcp','import')),
  channel              text NOT NULL REFERENCES sales.channel(code),
  customer_id          uuid NOT NULL REFERENCES party.contact(id),
  customer_order_ref   text,                                          -- nº de pedido del cliente (ORDERS BGM, confirmación del importador)
  external_ref         text,                                          -- id externo (EDI, Stripe)
  order_date           date NOT NULL,
  requested_date       date,
  ship_to              jsonb,                                         -- dirección de entrega congelada (y GLN si EDI)
  incoterm             text,
  billing_rule_set_id  uuid,                                          -- FK a billing.billing_rule_set (0009)
  billing_rule_id      uuid,                                          -- FK a billing.billing_rule (0009)
  billing_rule_trace   jsonb,                                         -- cómo se resolvió la entidad (cliente > canal > defecto)
  quote_id             uuid REFERENCES sales.quote(id),
  edi_message_id       uuid,                                          -- FK a regulatory.edi_message (0012)
  currency             char(3) NOT NULL DEFAULT 'EUR',
  notes                text,
  subtotal             numeric(14,2) NOT NULL DEFAULT 0,
  tax_total            numeric(14,2) NOT NULL DEFAULT 0,
  total                numeric(14,2) NOT NULL DEFAULT 0,
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, number),
  CHECK (status = 'draft' OR (number IS NOT NULL AND legal_entity_id IS NOT NULL AND billing_rule_id IS NOT NULL))
);
CREATE UNIQUE INDEX sales_order_external_uq ON sales.sales_order(source, external_ref) WHERE external_ref IS NOT NULL;
CREATE TRIGGER sales_order_touch BEFORE UPDATE ON sales.sales_order FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER sales_order_no_delete BEFORE DELETE ON sales.sales_order FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE sales.sales_order_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES sales.sales_order(id),
  line_no        smallint NOT NULL CHECK (line_no > 0),
  product_id     uuid NOT NULL REFERENCES catalog.product(id),
  description    text NOT NULL,
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price     numeric(14,6) NOT NULL CHECK (unit_price >= 0),
  discount_pct   numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  tax_code       text NOT NULL,
  external_line_ref text,                                            -- nº de línea EDI
  UNIQUE (order_id, line_no)
);

-- ---------------------------------------------------------------------
-- Albaranes (mueven el stock FÍSICO, D2)
-- ---------------------------------------------------------------------
CREATE TABLE sales.delivery_note (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL REFERENCES core.legal_entity(id),
  series_id           uuid REFERENCES core.number_series(id),
  number              text,
  kind                text NOT NULL CHECK (kind IN ('sale','consignment','transfer','return','sample')),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','shipped','delivered','cancelled')),
  invoicing_status    text NOT NULL DEFAULT 'not_invoiced' CHECK (invoicing_status IN (
                        'not_invoiced','partially_invoiced','invoiced','not_invoiceable')),
  customer_id         uuid REFERENCES party.contact(id),
  sales_order_id      uuid REFERENCES sales.sales_order(id),
  channel             text REFERENCES sales.channel(code),
  issue_date          date,
  from_location_id    uuid NOT NULL REFERENCES inventory.location(id),
  to_location_id      uuid REFERENCES inventory.location(id),         -- consigna/traspaso/devolución
  ship_to             jsonb,
  carrier_contact_id  uuid REFERENCES party.contact(id),
  tracking_ref        text,
  packages            smallint CHECK (packages >= 0),
  pallets             smallint CHECK (pallets >= 0),
  incoterm            text,
  is_valued           boolean NOT NULL DEFAULT false,                  -- albarán valorado
  currency            char(3) NOT NULL DEFAULT 'EUR',
  emcs_document_id    uuid,                                            -- FK a regulatory.emcs_document (0012)
  shipped_at          timestamptz,
  delivered_at        timestamptz,
  pod_attachment_id   uuid REFERENCES core.attachment(id),             -- prueba de entrega
  notes               text,
  cancelled_reason    text,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (legal_entity_id, number),
  CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL)),
  CHECK (kind NOT IN ('sale','sample') OR customer_id IS NOT NULL),
  CHECK (kind NOT IN ('consignment','transfer','return') OR to_location_id IS NOT NULL),
  CHECK (to_location_id IS NULL OR to_location_id <> from_location_id),
  CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);
CREATE INDEX delivery_note_pending_inv_idx ON sales.delivery_note(invoicing_status) WHERE status IN ('issued','shipped','delivered');
CREATE TRIGGER delivery_note_touch BEFORE UPDATE ON sales.delivery_note FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER delivery_note_no_delete BEFORE DELETE ON sales.delivery_note FOR EACH ROW EXECUTE FUNCTION core.forbid_delete();

CREATE TABLE sales.delivery_note_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id   uuid NOT NULL REFERENCES sales.delivery_note(id),
  line_no            smallint NOT NULL CHECK (line_no > 0),
  order_line_id      uuid REFERENCES sales.sales_order_line(id),
  product_id         uuid NOT NULL REFERENCES catalog.product(id),
  lot_id             uuid REFERENCES inventory.lot(id),
  description        text NOT NULL,
  quantity           numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price         numeric(14,6) CHECK (unit_price >= 0),            -- solo si es valorado
  discount_pct       numeric(5,2) NOT NULL DEFAULT 0,
  tax_code           text,
  UNIQUE (delivery_note_id, line_no)
);

-- Un albarán emitido solo cambia estado logístico/facturación (WC060)
CREATE FUNCTION sales.delivery_note_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.number IS DISTINCT FROM OLD.number OR NEW.legal_entity_id <> OLD.legal_entity_id OR
       NEW.kind <> OLD.kind OR NEW.from_location_id <> OLD.from_location_id OR
       NEW.to_location_id IS DISTINCT FROM OLD.to_location_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
       NEW.issue_date IS DISTINCT FROM OLD.issue_date) THEN
    RAISE EXCEPTION 'WC060: un albarán emitido no se edita; se anula (si no ha salido) o se hace una devolución';
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'WC060: el albarán % está anulado', OLD.number;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER delivery_note_guard BEFORE UPDATE ON sales.delivery_note FOR EACH ROW EXECUTE FUNCTION sales.delivery_note_guard();

CREATE FUNCTION sales.delivery_note_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM sales.delivery_note WHERE id = coalesce(NEW.delivery_note_id, OLD.delivery_note_id);
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'WC060: las líneas de un albarán emitido no se modifican';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER delivery_note_line_guard BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_note_line
  FOR EACH ROW EXECUTE FUNCTION sales.delivery_note_line_guard();

-- ---------------------------------------------------------------------
-- Incidencias de transporte (roturas, pérdidas, rechazos)
-- ---------------------------------------------------------------------
CREATE TABLE sales.shipping_incident (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id  uuid NOT NULL REFERENCES sales.delivery_note(id),
  kind              text NOT NULL CHECK (kind IN ('breakage','loss','delay','refused','other')),
  reported_at       timestamptz NOT NULL,
  description       text NOT NULL,
  units_affected    integer CHECK (units_affected >= 0),
  carrier_claim_ref text,
  claim_deadline    date,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','compensated','rejected','closed')),
  amount_claimed    numeric(14,2),
  amount_recovered  numeric(14,2),
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER quote_audit AFTER INSERT OR UPDATE ON sales.quote FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER quote_line_audit AFTER INSERT OR UPDATE OR DELETE ON sales.quote_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER sales_order_audit AFTER INSERT OR UPDATE ON sales.sales_order FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER sales_order_line_audit AFTER INSERT OR UPDATE OR DELETE ON sales.sales_order_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER delivery_note_audit AFTER INSERT OR UPDATE ON sales.delivery_note FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER delivery_note_line_audit AFTER INSERT OR UPDATE OR DELETE ON sales.delivery_note_line FOR EACH ROW EXECUTE FUNCTION audit.capture();
CREATE TRIGGER shipping_incident_audit AFTER INSERT OR UPDATE ON sales.shipping_incident FOR EACH ROW EXECUTE FUNCTION audit.capture();
