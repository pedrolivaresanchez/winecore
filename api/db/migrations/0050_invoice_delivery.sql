-- Entrega de facturas a CVBOT. WineCore no envía correo.
-- DuckDB 1.5: VARCHAR[] y len(); sin text[] ni trucos de restricción sobre listas.
-- La factura emitida no se actualiza (la FK de las líneas lo impide): el estado vive aquí.

CREATE TABLE billing.invoice_delivery (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES billing.invoice(id),
  attempt       smallint NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  channel       VARCHAR NOT NULL DEFAULT 'cvbot_outlook' CHECK (channel IN ('cvbot_outlook', 'download')),
  recipients    VARCHAR[],
  status        VARCHAR NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'no_recipient')),
  message_id    VARCHAR,
  error         VARCHAR,
  requested_by  VARCHAR NOT NULL,
  marked_by     VARCHAR,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  UNIQUE (invoice_id, attempt),
  CHECK (status <> 'sent' OR (message_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (recipients IS NULL OR len(recipients) >= 0)
);

CREATE INDEX invoice_delivery_invoice_idx ON billing.invoice_delivery(invoice_id, created_at);
CREATE INDEX invoice_delivery_pending_idx ON billing.invoice_delivery(status, created_at);
