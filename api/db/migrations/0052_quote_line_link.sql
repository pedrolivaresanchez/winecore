-- WineCore · 0052_quote_line_link · dialecto DuckDB (ADR 002).
-- El presupuesto llega al albarán y a la factura por el pedido
-- (sales_order.quote_id → delivery_note.sales_order_id → invoice_line).
-- La línea del presupuesto no guardaba qué línea de pedido la continúa, así que
-- una entrega parcial no se podía restar línea a línea si el pedido se editaba.
-- Sin REFERENCES: DuckDB rehace el UPDATE como DELETE + INSERT y lo rechaza
-- si otra fila apunta a la clave. Esta tabla no la referencia nadie.

CREATE TABLE sales.quote_line_link (
  quote_line_id  uuid PRIMARY KEY,
  quote_id       uuid NOT NULL,
  order_id       uuid NOT NULL,
  order_line_id  uuid NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX quote_line_link_quote_idx ON sales.quote_line_link(quote_id);
CREATE UNIQUE INDEX quote_line_link_order_line_idx ON sales.quote_line_link(order_line_id);

-- Histórico: un presupuesto convertido en un solo pedido, misma línea y producto.
-- INSERT en la tabla nueva; no se actualiza ninguna fila ya referenciada.
INSERT INTO sales.quote_line_link (quote_line_id, quote_id, order_id, order_line_id)
SELECT ql.id, ql.quote_id, o.id, ol.id
FROM sales.quote_line ql
JOIN sales.sales_order o ON o.quote_id = ql.quote_id
JOIN sales.sales_order_line ol
  ON ol.order_id = o.id
 AND ol.line_no = ql.line_no
 AND (ql.product_id IS NULL OR ol.product_id = ql.product_id)
WHERE (
  SELECT count(*) FROM sales.sales_order other WHERE other.quote_id = ql.quote_id
) = 1;
