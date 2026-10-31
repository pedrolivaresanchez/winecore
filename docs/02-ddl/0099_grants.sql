-- =====================================================================
-- WineCore · 0099 · permisos (se reaplica tras cada migración; idempotente)
-- ADR 002 §3: la aplicación NO puede borrar ni truncar, ni modificar la auditoría.
-- =====================================================================
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['core','audit','ops','party','catalog','inventory','cellar','sales','billing',
                           'purchasing','finance','regulatory','vineyard','accounting','knowledge'] LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO winecore_app, winecore_readonly', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO winecore_app, winecore_readonly', s);
    EXECUTE format('GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA %I TO winecore_app', s);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA %I FROM winecore_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO winecore_app', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO winecore_app, winecore_readonly', s);
  END LOOP;
  -- Auditoría: solo inserción y lectura
  REVOKE UPDATE ON audit.audit_log FROM winecore_app;
  -- Tablas donde el borrado SÍ es legítimo (no son de negocio): enlaces de adjuntos en borrador y claves de idempotencia caducadas
  GRANT DELETE ON core.attachment_link, ops.idempotency_key TO winecore_app;
  -- Las líneas de documentos en borrador se reemplazan (los triggers impiden tocar las emitidas)
  GRANT DELETE ON sales.quote_line, sales.sales_order_line, sales.delivery_note_line, billing.invoice_line,
                  billing.invoice_tax, billing.invoice_due, billing.invoice_rectification, cellar.operation_line,
                  purchasing.supplier_invoice_line, inventory.inventory_count_line, catalog.price_list_item,
                  billing.billing_rule, regulatory.emcs_item, vineyard.parcel_variety TO winecore_app;
END $$;
