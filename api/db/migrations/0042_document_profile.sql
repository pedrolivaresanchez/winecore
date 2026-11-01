-- WineCore · 0042_document_profile · dialecto DuckDB (ADR 002).
-- Plantilla de los PDF al estilo de Holded.
--
-- 1. core.document_profile: logotipo, contacto, líneas de pie y variante de plantilla de cada
--    sociedad. Una fila por sociedad. El logotipo es un adjunto (core.attachment, rol 'other').
--    Sin claves foráneas: DuckDB no cruza esquemas y rechaza el UPDATE de un padre con hijos;
--    la aplicación comprueba que la sociedad y el adjunto existen.
-- 2. Campos que Holded imprime y WineCore no guardaba. DuckDB 1.5 solo añade columnas sin
--    NOT NULL ni DEFAULT, así que todas son opcionales:
--      · dirección de envío del documento (ship_to, congelada igual que la del pedido)
--      · referencias del cliente (texto libre, una por línea: PEDIDO, CENTRO, PROVEEDOR…)
--      · unidad de la línea (Botellas, Cajas…) en presupuestos y albaranes; la factura ya la tenía

CREATE TABLE core.document_profile (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_entity_id     uuid NOT NULL UNIQUE,
  variant             VARCHAR NOT NULL DEFAULT 'po' CHECK (variant IN ('po','cvpo')),
  email               VARCHAR CHECK (email IS NULL OR length(email) <= 200),
  phone               VARCHAR CHECK (phone IS NULL OR length(phone) <= 60),
  website             VARCHAR CHECK (website IS NULL OR length(website) <= 200),
  footer_lines        VARCHAR[] NOT NULL DEFAULT [],
  logo_attachment_id  uuid,
  updated_by          VARCHAR,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE billing.invoice ADD COLUMN ship_to JSON;
ALTER TABLE billing.invoice ADD COLUMN customer_references VARCHAR;

ALTER TABLE sales.quote ADD COLUMN ship_to JSON;
ALTER TABLE sales.quote ADD COLUMN customer_references VARCHAR;
ALTER TABLE sales.quote_line ADD COLUMN unit VARCHAR;

ALTER TABLE sales.delivery_note ADD COLUMN customer_references VARCHAR;
ALTER TABLE sales.delivery_note_line ADD COLUMN unit VARCHAR;

ALTER TABLE sales.sales_order ADD COLUMN customer_references VARCHAR;
ALTER TABLE sales.sales_order_line ADD COLUMN unit VARCHAR;
