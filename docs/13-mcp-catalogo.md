# 13 · Catálogo de herramientas MCP

> Generado con `bun run scripts/mcp-catalog.ts` (en `api/`). 429 herramientas, 207 de escritura en dos pasos (`_prepare` y `_commit`). Reglas y exclusiones: `13-mcp.md`.

## Sistema y búsqueda (15)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `system_attachment_download` | lectura | Descargar adjunto |
| `system_attachment_upload_prepare` / `_commit` | escritura | Adjuntar fichero |
| `system_attachments_list` | lectura | Adjuntos de un registro |
| `system_audit_list` | lectura | Historial de cambios |
| `system_audit_verify` | lectura | Comprobar el registro de auditoría |
| `system_me_get` | lectura | Mi perfil |
| `system_notification_mark_read_prepare` / `_commit` | escritura | Marcar aviso como leído |
| `system_notifications_list` | lectura | Avisos |
| `system_notifications_mark_all_read_prepare` / `_commit` | escritura | Marcar todos los avisos como leídos |
| `system_search` | lectura | Buscar |
| `system_setup_readiness_get` | lectura | Puesta en marcha |
| `system_tool_run` | directa | Usar una herramienta |
| `system_tools_search` | lectura | Buscar herramientas |
| `system_users_list` | lectura | Personas con acceso |
| `system_whoami` | lectura | Quién soy |

## Panel (1)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `dashboard_panel_get` | lectura | Panel de inicio |

## Informes (6)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `reports_expenses_export_csv` | lectura | Informe de gastos (CSV) |
| `reports_expenses_get` | lectura | Informe de gastos |
| `reports_sales_export_csv` | lectura | Informe de ventas (CSV) |
| `reports_sales_get` | lectura | Informe de ventas |
| `reports_stock_export_csv` | lectura | Informe de existencias (CSV) |
| `reports_stock_get` | lectura | Informe de existencias |

## Aprobaciones (8)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `approvals_get_link` | lectura | Enlace a la bandeja |
| `approvals_list_pending` | lectura | Solicitudes pendientes |
| `approvals_policies_list` | lectura | Reglas de aprobación |
| `approvals_request_approve_prepare` / `_commit` | escritura | Aprobar solicitud |
| `approvals_request_get` | lectura | Solicitud de aprobación |
| `approvals_request_reject_prepare` / `_commit` | escritura | Rechazar solicitud |
| `approvals_requests_list` | lectura | Bandeja de aprobaciones |
| `approvals_settings_get` | lectura | Passkey para aprobar |

## Contactos (16)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `contacts_address_add_prepare` / `_commit` | escritura | Añadir dirección |
| `contacts_address_archive_prepare` / `_commit` | escritura | Quitar dirección |
| `contacts_address_update_prepare` / `_commit` | escritura | Editar dirección |
| `contacts_archive_prepare` / `_commit` | escritura | Archivar contacto |
| `contacts_create_prepare` / `_commit` | escritura | Crear contacto |
| `contacts_detail_get` | lectura | Ficha completa del contacto |
| `contacts_export_csv` | lectura | Exportar contactos (CSV) |
| `contacts_get` | lectura | Ficha de contacto |
| `contacts_list` | lectura | Lista de contactos |
| `contacts_person_add_prepare` / `_commit` | escritura | Añadir persona de contacto |
| `contacts_person_archive_prepare` / `_commit` | escritura | Quitar persona de contacto |
| `contacts_person_update_prepare` / `_commit` | escritura | Editar persona de contacto |
| `contacts_search` | lectura | Buscar contactos |
| `contacts_summary_get` | lectura | Resumen comercial del contacto |
| `contacts_unarchive_prepare` / `_commit` | escritura | Recuperar contacto archivado |
| `contacts_update_prepare` / `_commit` | escritura | Editar contacto |

## Catálogo, formatos y tarifas (28)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `catalog_customer_price_get` | lectura | Precio de un producto para un cliente |
| `catalog_format_create_prepare` / `_commit` | escritura | Crear formato |
| `catalog_format_material_add_prepare` / `_commit` | escritura | Añadir material al formato |
| `catalog_format_material_remove_prepare` / `_commit` | escritura | Quitar material del formato |
| `catalog_format_material_update_prepare` / `_commit` | escritura | Editar material del formato |
| `catalog_format_materials_list` | lectura | Materiales del formato |
| `catalog_format_update_prepare` / `_commit` | escritura | Editar formato |
| `catalog_formats_list` | lectura | Formatos |
| `catalog_price_list_create_prepare` / `_commit` | escritura | Crear tarifa |
| `catalog_price_list_items_set_prepare` / `_commit` | escritura | Precios de un borrador de tarifa |
| `catalog_price_list_update_prepare` / `_commit` | escritura | Editar tarifa |
| `catalog_price_list_version_activation_request_prepare` / `_commit` | escritura | Pedir la activación de una tarifa |
| `catalog_price_list_version_create_prepare` / `_commit` | escritura | Nueva versión de tarifa |
| `catalog_price_list_versions_list` | lectura | Versiones de una tarifa |
| `catalog_price_lists_list` | lectura | Tarifas |
| `catalog_price_quote` | lectura | Cotizar |
| `catalog_product_create_prepare` / `_commit` | escritura | Crear producto |
| `catalog_product_detail_get` | lectura | Ficha completa del producto |
| `catalog_product_get` | lectura | Ficha de producto |
| `catalog_product_gtin_current_mark_prepare` / `_commit` | escritura | Marcar GTIN vigente |
| `catalog_product_prices_list` | lectura | Precios vigentes del producto |
| `catalog_product_update_prepare` / `_commit` | escritura | Editar producto |
| `catalog_products_export_csv` | lectura | Exportar productos (CSV) |
| `catalog_products_list` | lectura | Lista de productos |
| `catalog_products_search` | lectura | Buscar productos |
| `catalog_wine_create_prepare` / `_commit` | escritura | Crear vino |
| `catalog_wine_update_prepare` / `_commit` | escritura | Editar vino |
| `catalog_wines_list` | lectura | Vinos |

## Ventas: presupuestos, pedidos y albaranes (48)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `sales_billing_rule_set_activate_prepare` / `_commit` | escritura | Activar reglas de facturación |
| `sales_billing_rule_set_activation_request_prepare` / `_commit` | escritura | Pedir aprobación de reglas |
| `sales_billing_rule_set_create_prepare` / `_commit` | escritura | Nueva versión de reglas de facturación |
| `sales_billing_rule_set_impact_get` | lectura | Impacto de unas reglas |
| `sales_billing_rule_set_rules_replace_prepare` / `_commit` | escritura | Cambiar reglas de facturación |
| `sales_billing_rule_sets_list` | lectura | Versiones de reglas de facturación |
| `sales_billing_rules_resolve` | lectura | Qué sociedad factura |
| `sales_billing_rules_state_get` | lectura | Estado de las reglas de facturación |
| `sales_catalog_get` | lectura | Catálogo de venta |
| `sales_delivery_note_create_prepare` / `_commit` | escritura | Crear albarán |
| `sales_delivery_note_dispatch_prepare` / `_commit` | escritura | Marcar albarán como expedido |
| `sales_delivery_note_get` | lectura | Ver albarán |
| `sales_delivery_note_incident_create_prepare` / `_commit` | escritura | Registrar incidencia de transporte |
| `sales_delivery_note_incidents_list` | lectura | Incidencias del albarán |
| `sales_delivery_note_issue_prepare` / `_commit` | escritura | Emitir albarán |
| `sales_delivery_note_loss_confirm_prepare` / `_commit` | escritura | Confirmar merma de una incidencia |
| `sales_delivery_note_mark_delivered_prepare` / `_commit` | escritura | Marcar albarán como entregado |
| `sales_delivery_note_mark_not_invoiceable_prepare` / `_commit` | escritura | Marcar albarán como no facturable |
| `sales_delivery_note_pdf_get` | lectura | PDF del albarán |
| `sales_delivery_note_return_create_prepare` / `_commit` | escritura | Crear devolución |
| `sales_delivery_note_update_prepare` / `_commit` | escritura | Cambiar líneas del albarán |
| `sales_delivery_note_void_prepare` / `_commit` | escritura | Anular albarán |
| `sales_delivery_notes_list` | lectura | Lista de albaranes |
| `sales_delivery_notes_uninvoiced_lines_list` | lectura | Líneas de albarán sin facturar |
| `sales_documents_list` | lectura | Documentos de venta |
| `sales_export_checklist_get` | lectura | Documentos para exportar |
| `sales_export_country_documents_get` | lectura | Requisitos de exportación por país |
| `sales_export_country_documents_update_prepare` / `_commit` | escritura | Cambiar requisitos de exportación |
| `sales_export_documents_generate` | lectura | Generar factura comercial y lista de bultos |
| `sales_export_readiness_check` | lectura | ¿Está lista para exportar? |
| `sales_order_cancel_prepare` / `_commit` | escritura | Cancelar pedido |
| `sales_order_close_prepare` / `_commit` | escritura | Cerrar resto del pedido |
| `sales_order_confirm_prepare` / `_commit` | escritura | Confirmar pedido |
| `sales_order_create_prepare` / `_commit` | escritura | Crear pedido |
| `sales_order_delivery_note_create_prepare` / `_commit` | escritura | Crear albarán del pedido |
| `sales_order_entity_exception_set_prepare` / `_commit` | escritura | Cambiar sociedad que factura |
| `sales_order_get` | lectura | Ver pedido |
| `sales_order_update_prepare` / `_commit` | escritura | Editar pedido |
| `sales_orders_list` | lectura | Lista de pedidos |
| `sales_quote_accept_prepare` / `_commit` | escritura | Aceptar presupuesto |
| `sales_quote_convert_prepare` / `_commit` | escritura | Convertir presupuesto en pedido |
| `sales_quote_create_prepare` / `_commit` | escritura | Crear presupuesto |
| `sales_quote_get` | lectura | Ver presupuesto |
| `sales_quote_mark_sent_prepare` / `_commit` | escritura | Marcar presupuesto como enviado |
| `sales_quote_pdf_get` | lectura | PDF del presupuesto |
| `sales_quote_reject_prepare` / `_commit` | escritura | Rechazar presupuesto |
| `sales_quote_update_prepare` / `_commit` | escritura | Editar presupuesto |
| `sales_quotes_list` | lectura | Lista de presupuestos |

## Facturación, series y sociedades (38)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `billing_invoice_create_prepare` / `_commit` | escritura | Crear borrador de factura |
| `billing_invoice_deliveries_list` | lectura | Historial de envíos de la factura |
| `billing_invoice_deliveries_pending_list` | lectura | Facturas pendientes de envío |
| `billing_invoice_delivery_mark_failed` | directa | Marcar entrega fallida |
| `billing_invoice_delivery_mark_sent` | directa | Marcar factura enviada |
| `billing_invoice_delivery_package_get` | lectura | Preparar el envío de la factura |
| `billing_invoice_delivery_record_failed_prepare` / `_commit` | escritura | Registrar envío fallido |
| `billing_invoice_delivery_record_sent_prepare` / `_commit` | escritura | Registrar factura enviada |
| `billing_invoice_delivery_resend_prepare` / `_commit` | escritura | Volver a enviar factura |
| `billing_invoice_discard_prepare` / `_commit` | escritura | Descartar borrador |
| `billing_invoice_get` | lectura | Ficha de la factura |
| `billing_invoice_issue_prepare` / `_commit` | escritura | Emitir factura |
| `billing_invoice_pdf_download` | lectura | Descargar PDF de la factura |
| `billing_invoice_pdf_get` | lectura | PDF de factura |
| `billing_invoice_update_prepare` / `_commit` | escritura | Editar borrador de factura |
| `billing_invoice_validate` | lectura | Comprobar borrador antes de emitir |
| `billing_invoice_void_prepare` / `_commit` | escritura | Anular factura |
| `billing_invoices_batch_issue_prepare` / `_commit` | escritura | Emitir lote aprobado |
| `billing_invoices_batch_issue_request_prepare` / `_commit` | escritura | Pedir aprobación para emitir un lote |
| `billing_invoices_book_export` | lectura | Libro de facturas expedidas (CSV) |
| `billing_invoices_list` | lectura | Lista de facturas |
| `billing_invoices_pending_delivery_list` | lectura | Facturas pendientes de entrega |
| `billing_legacy_document_get` | lectura | Albarán o presupuesto histórico |
| `billing_legacy_document_pdf_download` | lectura | PDF de albarán o presupuesto histórico |
| `billing_legacy_documents_list` | lectura | Albaranes y presupuestos históricos |
| `billing_legacy_invoice_get` | lectura | Factura histórica de Holded |
| `billing_legacy_invoice_pdf_download` | lectura | PDF de factura histórica |
| `billing_legacy_invoices_list` | lectura | Facturas históricas de Holded |
| `billing_legacy_overview_get` | lectura | Resumen del histórico de Holded |
| `billing_legacy_products_list` | lectura | Productos históricos de Holded |
| `billing_legal_entities_list` | lectura | Sociedades |
| `billing_legal_entities_update_prepare` / `_commit` | escritura | Editar datos fiscales de la sociedad |
| `billing_series_bulk_create_prepare` / `_commit` | escritura | Abrir varias series a la vez |
| `billing_series_create_prepare` / `_commit` | escritura | Crear serie de numeración |
| `billing_series_deactivate_prepare` / `_commit` | escritura | Desactivar serie |
| `billing_series_list` | lectura | Series de numeración |
| `billing_series_open_prepare` / `_commit` | escritura | Abrir la numeración del año |
| `billing_series_proposal_get` | lectura | Propuesta de numeración del año |

## Tesorería: cobros, pagos, remesas, bancos e intercompañía (30)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `finance_bank_account_create_prepare` / `_commit` | escritura | Dar de alta cuenta bancaria |
| `finance_bank_accounts_list` | lectura | Cuentas bancarias |
| `finance_bank_statement_import_prepare` / `_commit` | escritura | Importar extracto bancario |
| `finance_bank_statement_line_confirm_prepare` / `_commit` | escritura | Conciliar movimiento del extracto |
| `finance_bank_statement_line_ignore_prepare` / `_commit` | escritura | Ignorar movimiento del extracto |
| `finance_bank_statement_suggestions_list` | lectura | Movimientos de un extracto con sugerencias |
| `finance_bank_statements_list` | lectura | Extractos bancarios importados |
| `finance_intercompany_invoice_request_prepare` / `_commit` | escritura | Pedir la factura intercompañía |
| `finance_intercompany_period_close_prepare` / `_commit` | escritura | Cerrar mes intercompañía |
| `finance_intercompany_settlement_close_prepare` / `_commit` | escritura | Cerrar liquidación intercompañía |
| `finance_intercompany_settlement_open_prepare` / `_commit` | escritura | Abrir liquidación intercompañía del mes |
| `finance_intercompany_settlements_list` | lectura | Liquidaciones intercompañía |
| `finance_intercompany_tariff_activate_prepare` / `_commit` | escritura | Activar tarifa intercompañía |
| `finance_intercompany_tariff_create_prepare` / `_commit` | escritura | Crear tarifa intercompañía |
| `finance_intercompany_tariff_get` | lectura | Detalle de una tarifa intercompañía |
| `finance_intercompany_tariff_retire_prepare` / `_commit` | escritura | Retirar tarifa intercompañía |
| `finance_intercompany_tariff_update_prepare` / `_commit` | escritura | Editar tarifa intercompañía |
| `finance_intercompany_tariffs_list` | lectura | Tarifas intercompañía |
| `finance_payment_get` | lectura | Detalle de un cobro o pago |
| `finance_payment_record_prepare` / `_commit` | escritura | Registrar cobro o pago |
| `finance_payment_reverse_prepare` / `_commit` | escritura | Anular cobro o pago |
| `finance_payments_list` | lectura | Cobros y pagos registrados |
| `finance_receivables_list` | lectura | Pendiente de cobro y de pago |
| `finance_remittance_create_prepare` / `_commit` | escritura | Crear remesa SEPA |
| `finance_remittance_file_generate_prepare` / `_commit` | escritura | Generar fichero SEPA de la remesa |
| `finance_remittance_file_get` | lectura | Descargar fichero SEPA de la remesa |
| `finance_remittance_get` | lectura | Detalle de una remesa |
| `finance_remittance_mark_submitted_prepare` / `_commit` | escritura | Marcar remesa subida al banco |
| `finance_remittance_request_approval_prepare` / `_commit` | escritura | Pedir aprobación de la remesa |
| `finance_remittances_list` | lectura | Remesas SEPA |

## Gastos (10)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `purchasing_expense_approval_request_prepare` / `_commit` | escritura | Pedir aprobación del gasto |
| `purchasing_expense_approve_prepare` / `_commit` | escritura | Aprobar gasto |
| `purchasing_expense_categories_list` | lectura | Categorías de gasto |
| `purchasing_expense_get` | lectura | Ficha del gasto |
| `purchasing_expense_reject_prepare` / `_commit` | escritura | Rechazar gasto |
| `purchasing_expense_update_prepare` / `_commit` | escritura | Corregir gasto |
| `purchasing_expense_upload_prepare` / `_commit` | escritura | Capturar gasto |
| `purchasing_expense_validate_prepare` / `_commit` | escritura | Validar gasto |
| `purchasing_expenses_export_csv` | lectura | Libro de facturas recibidas (CSV) |
| `purchasing_expenses_list` | lectura | Gastos |

## Stock, aforos y ubicaciones (23)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `inventory_count_close_prepare` / `_commit` | escritura | Cerrar el recuento del aforo |
| `inventory_count_create_prepare` / `_commit` | escritura | Abrir aforo |
| `inventory_count_get` | lectura | Ficha del aforo |
| `inventory_count_holder_line_add_prepare` / `_commit` | escritura | Contar un nicho o jaulón en el aforo |
| `inventory_count_lines_save_prepare` / `_commit` | escritura | Anotar lo contado en el aforo |
| `inventory_count_posting_request_prepare` / `_commit` | escritura | Pedir la contabilización del aforo |
| `inventory_counts_list` | lectura | Aforos |
| `inventory_fiscal_balances_list` | lectura | Existencias fiscales |
| `inventory_holder_stock_list` | lectura | Botellas en nichos y jaulones |
| `inventory_inspection_report_get` | lectura | Informe de existencias para inspección |
| `inventory_location_archive_prepare` / `_commit` | escritura | Archivar ubicación |
| `inventory_location_create_prepare` / `_commit` | escritura | Crear ubicación |
| `inventory_location_get` | lectura | Ficha de la ubicación |
| `inventory_location_update_prepare` / `_commit` | escritura | Editar ubicación |
| `inventory_locations_list` | lectura | Ubicaciones |
| `inventory_material_receipt_create_prepare` / `_commit` | escritura | Registrar entrada de material |
| `inventory_materials_stock_list` | lectura | Existencias de materiales de envasado |
| `inventory_movements_list` | lectura | Movimientos |
| `inventory_reconcile_physical_fiscal` | lectura | Cuadre físico y fiscal |
| `inventory_stock_at` | lectura | Stock a una fecha |
| `inventory_stock_balances_list` | lectura | Existencias físicas |
| `inventory_stock_moves_list` | lectura | Movimientos de stock |
| `inventory_tax_warehouses_list` | lectura | Depósitos fiscales |

## Bodega: depósitos, operaciones, lotes y enología (86)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `cellar_analysis_report_attach_prepare` / `_commit` | escritura | Adjuntar informe a una analítica |
| `cellar_analysis_report_get` | lectura | Informe de laboratorio |
| `cellar_barrel_create_prepare` / `_commit` | escritura | Crear ficha de barrica |
| `cellar_barrel_get` | lectura | Ficha de la barrica |
| `cellar_barrel_update_prepare` / `_commit` | escritura | Editar ficha de barrica |
| `cellar_barrels_use_count_recalculate_prepare` / `_commit` | escritura | Recalcular usos de las barricas |
| `cellar_enology_blend_calculate` | lectura | Calcular coupage |
| `cellar_enology_checks_run` | lectura | Comprobar una operación |
| `cellar_enology_cold_stabilisation_calculate` | lectura | Calcular estabilización por frío |
| `cellar_enology_probable_alcohol_calculate` | lectura | Calcular alcohol probable |
| `cellar_enology_settings_get` | lectura | Ajustes de enología |
| `cellar_enology_settings_update_prepare` / `_commit` | escritura | Cambiar ajustes de enología |
| `cellar_enology_so2_calculate` | lectura | Calcular sulfuroso |
| `cellar_fermentation_reading_record_prepare` / `_commit` | escritura | Anotar lectura de fermentación |
| `cellar_fermentation_readings_list` | lectura | Lecturas de fermentación |
| `cellar_holder_create_prepare` / `_commit` | escritura | Nuevo nicho o jaulón |
| `cellar_holder_get` | lectura | Nicho o jaulón |
| `cellar_holder_move_record_prepare` / `_commit` | escritura | Meter o sacar botellas |
| `cellar_holder_moves_list` | lectura | Movimientos del nicho o jaulón |
| `cellar_holder_update_prepare` / `_commit` | escritura | Editar nicho o jaulón |
| `cellar_holders_list` | lectura | Nichos y jaulones |
| `cellar_lot_additions_list` | lectura | Adiciones del lote |
| `cellar_lot_analyses_list` | lectura | Analíticas del lote |
| `cellar_lot_analysis_latest_get` | lectura | Última analítica del lote |
| `cellar_lot_analysis_record_prepare` / `_commit` | escritura | Anotar analítica del lote |
| `cellar_lot_design_update_prepare` / `_commit` | escritura | Guardar diseño del lote |
| `cellar_lot_detail_get` | lectura | Ficha del lote |
| `cellar_lot_deviations_get` | lectura | Desvíos frente a la receta |
| `cellar_lot_evolution_get` | lectura | Evolución del lote |
| `cellar_lot_fermentation_curve_get` | lectura | Curva de fermentación |
| `cellar_lot_get` | lectura | Lote |
| `cellar_lot_moves_list` | lectura | Movimientos del lote |
| `cellar_lot_phase_end_prepare` / `_commit` | escritura | Dar por terminada una fase |
| `cellar_lot_phase_start_prepare` / `_commit` | escritura | Empezar fase del lote |
| `cellar_lot_phase_stop_prepare` / `_commit` | escritura | Parar una fase |
| `cellar_lot_phases_list` | lectura | Fases del lote |
| `cellar_lot_plan_get` | lectura | Plan del lote |
| `cellar_lot_recipe_create_prepare` / `_commit` | escritura | Receta desde un lote |
| `cellar_lot_sales_list` | lectura | Ventas del lote |
| `cellar_lot_samples_list` | lectura | Muestras del lote |
| `cellar_lot_tasting_record_prepare` / `_commit` | escritura | Anotar cata del lote |
| `cellar_lot_tastings_list` | lectura | Catas del lote |
| `cellar_lot_traceability_get` | lectura | Trazabilidad del lote |
| `cellar_lots_list` | lectura | Lotes |
| `cellar_map_get` | lectura | Plano de la bodega |
| `cellar_operation_confirm_prepare` / `_commit` | escritura | Confirmar operación de bodega |
| `cellar_operation_create_prepare` / `_commit` | escritura | Nueva operación de bodega (borrador) |
| `cellar_operation_detail_get` | lectura | Operación de bodega completa |
| `cellar_operation_draft_prepare` / `_commit` | escritura | Borrador de operación |
| `cellar_operation_get` | lectura | Operación |
| `cellar_operation_preview` | lectura | Vista previa de confirmar una operación |
| `cellar_operation_rectify_prepare` / `_commit` | escritura | Rectificar operación confirmada |
| `cellar_operation_update_prepare` / `_commit` | escritura | Editar borrador de operación |
| `cellar_operations_browse` | lectura | Operaciones de bodega (lista completa) |
| `cellar_operations_list` | lectura | Operaciones |
| `cellar_recipe_get` | lectura | Receta |
| `cellar_recipe_publish_prepare` / `_commit` | escritura | Publicar receta |
| `cellar_recipe_update_prepare` / `_commit` | escritura | Editar receta |
| `cellar_recipe_version_create_prepare` / `_commit` | escritura | Nueva versión de receta |
| `cellar_vessel_by_qr_get` | lectura | Recipiente por su QR |
| `cellar_vessel_capacity_get` | lectura | Capacidad y aforos del recipiente |
| `cellar_vessel_capacity_record_prepare` / `_commit` | escritura | Registrar nueva capacidad (aforo) |
| `cellar_vessel_create_prepare` / `_commit` | escritura | Alta de recipiente |
| `cellar_vessel_demijohn_get` | lectura | Damajuana: crianza a la intemperie |
| `cellar_vessel_demijohn_set_prepare` / `_commit` | escritura | Marcar crianza a la intemperie |
| `cellar_vessel_get` | lectura | Ficha del recipiente |
| `cellar_vessel_history_list` | lectura | Historial del recipiente |
| `cellar_vessel_plan_card_get` | lectura | Tarjeta del recipiente en el plano |
| `cellar_vessel_qr_get` | lectura | QR del recipiente |
| `cellar_vessel_retire_prepare` / `_commit` | escritura | Dar de baja un recipiente |
| `cellar_vessel_update_prepare` / `_commit` | escritura | Editar recipiente |
| `cellar_vessels_browse` | lectura | Recipientes (lista completa) |
| `cellar_vessels_import_prepare` / `_commit` | escritura | Importar recipientes |
| `cellar_vessels_import_template_get` | lectura | Plantilla de importación de recipientes |
| `cellar_vessels_list` | lectura | Recipientes |
| `cellar_winemaking_fermentation_alerts_run_prepare` / `_commit` | escritura | Revisar alertas de fermentación |
| `cellar_zone_create_prepare` / `_commit` | escritura | Nueva zona del plano |
| `cellar_zone_get` | lectura | Zona del plano |
| `cellar_zone_position_add_prepare` / `_commit` | escritura | Colocar en el plano |
| `cellar_zone_position_remove_prepare` / `_commit` | escritura | Quitar del plano |
| `cellar_zone_position_update_prepare` / `_commit` | escritura | Mover en el plano |
| `cellar_zone_update_prepare` / `_commit` | escritura | Editar zona del plano |
| `cellar_zones_list` | lectura | Zonas del plano |
| `lot_design_get` | lectura | Diseño de lote |
| `lot_plan_from_recipe_prepare` / `_commit` | escritura | Plan desde receta |
| `recipes_list` | lectura | Recetas |

## Higiene (27)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `hygiene_appcc_report_get` | lectura | Registro APPCC |
| `hygiene_bottling_check_get` | lectura | Control de envasado |
| `hygiene_bottling_check_save_prepare` / `_commit` | escritura | Guardar control de envasado |
| `hygiene_bottling_checks_list` | lectura | Controles de envasado |
| `hygiene_cleaning_log_record_prepare` / `_commit` | escritura | Anotar una limpieza |
| `hygiene_cleaning_logs_list` | lectura | Registros de limpieza |
| `hygiene_consumable_balances_list` | lectura | Saldo de consumibles |
| `hygiene_consumable_receipt_record_prepare` / `_commit` | escritura | Anotar entrada de consumibles |
| `hygiene_consumable_receipts_list` | lectura | Entradas de consumibles |
| `hygiene_consumable_register_prepare` / `_commit` | escritura | Dar de alta un consumible |
| `hygiene_consumables_list` | lectura | Consumibles de higiene |
| `hygiene_equipment_create_prepare` / `_commit` | escritura | Nuevo equipo |
| `hygiene_equipment_get` | lectura | Equipo |
| `hygiene_equipment_links_list` | lectura | Equipos usados en operaciones |
| `hygiene_equipment_list` | lectura | Equipos |
| `hygiene_equipment_maintenance_record_prepare` / `_commit` | escritura | Anotar mantenimiento de un equipo |
| `hygiene_equipment_update_prepare` / `_commit` | escritura | Editar equipo |
| `hygiene_filtration_record_prepare` / `_commit` | escritura | Anotar una filtración |
| `hygiene_filtrations_list` | lectura | Filtraciones |
| `hygiene_maintenance_list` | lectura | Mantenimientos |
| `hygiene_operation_equipment_link_prepare` / `_commit` | escritura | Vincular equipo a una operación |
| `hygiene_policy_get` | lectura | Ajuste del control de envasado |
| `hygiene_policy_update_prepare` / `_commit` | escritura | Cambiar el control de envasado |
| `hygiene_procedure_create_prepare` / `_commit` | escritura | Nuevo procedimiento de limpieza |
| `hygiene_procedure_get` | lectura | Procedimiento de limpieza |
| `hygiene_procedure_update_prepare` / `_commit` | escritura | Editar procedimiento de limpieza |
| `hygiene_procedures_list` | lectura | Procedimientos de limpieza |

## Catas (28)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `tasting_descriptor_create_prepare` / `_commit` | escritura | Nuevo descriptor de cata |
| `tasting_descriptor_update_prepare` / `_commit` | escritura | Editar descriptor de cata |
| `tasting_descriptors_list` | lectura | Descriptores de cata |
| `tasting_evolution_get` | lectura | Evolución en cata |
| `tasting_note_create_prepare` / `_commit` | escritura | Nueva nota de cata |
| `tasting_note_delete_prepare` / `_commit` | escritura | Borrar nota de cata |
| `tasting_note_from_dictation_prepare` / `_commit` | escritura | Nota de cata por dictado |
| `tasting_note_get` | lectura | Nota de cata |
| `tasting_note_update_prepare` / `_commit` | escritura | Editar nota de cata |
| `tasting_notes_list` | lectura | Notas de cata |
| `tasting_session_create_prepare` / `_commit` | escritura | Nueva cata a ciegas |
| `tasting_session_delete_prepare` / `_commit` | escritura | Borrar cata a ciegas |
| `tasting_session_get` | lectura | Cata a ciegas |
| `tasting_session_reveal_prepare` / `_commit` | escritura | Destapar la cata a ciegas |
| `tasting_session_sample_add_prepare` / `_commit` | escritura | Añadir muestra a la cata |
| `tasting_session_samples_list` | lectura | Muestras de cata |
| `tasting_session_selection_get` | lectura | Selección de la cata |
| `tasting_session_selection_update_prepare` / `_commit` | escritura | Cambiar selección de la cata |
| `tasting_sessions_list` | lectura | Catas a ciegas |
| `tasting_template_create_prepare` / `_commit` | escritura | Nueva plantilla de cata |
| `tasting_template_field_add_prepare` / `_commit` | escritura | Añadir campo a la plantilla |
| `tasting_template_field_update_prepare` / `_commit` | escritura | Editar campo de la plantilla |
| `tasting_template_get` | lectura | Plantilla de cata |
| `tasting_template_update_prepare` / `_commit` | escritura | Editar plantilla de cata |
| `tasting_templates_list` | lectura | Plantillas de cata |
| `tasting_vintage_comparison_csv_get` | lectura | Comparar añadas (CSV) |
| `tasting_vintage_comparison_get` | lectura | Comparar añadas |
| `tasting_vote_cast_prepare` / `_commit` | escritura | Voto de cata |

## Viñedo (49)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `vineyard_crew_availability_delete_prepare` / `_commit` | escritura | Quitar cuadrilla de un día |
| `vineyard_crew_availability_list` | lectura | Disponibilidad de cuadrillas |
| `vineyard_crew_availability_set_prepare` / `_commit` | escritura | Fijar cuadrilla de un día |
| `vineyard_field_task_create_prepare` / `_commit` | escritura | Anotar labor de campo |
| `vineyard_field_tasks_list` | lectura | Labores de campo |
| `vineyard_grape_reception_confirm_prepare` / `_commit` | escritura | Confirmar entrada de uva |
| `vineyard_grape_reception_create_prepare` / `_commit` | escritura | Nueva entrada de uva (borrador) |
| `vineyard_grape_reception_get` | lectura | Entrada de uva |
| `vineyard_grape_reception_preview` | lectura | Vista previa de la entrada de uva |
| `vineyard_grape_reception_rectify_prepare` / `_commit` | escritura | Rectificar entrada de uva |
| `vineyard_grape_reception_update_prepare` / `_commit` | escritura | Corregir entrada de uva en borrador |
| `vineyard_grape_receptions_list` | lectura | Entradas de uva |
| `vineyard_grape_varieties_list` | lectura | Catálogo de variedades de uva |
| `vineyard_grape_variety_create_prepare` / `_commit` | escritura | Alta de variedad de uva |
| `vineyard_grape_variety_get` | lectura | Variedad de uva |
| `vineyard_grape_variety_update_prepare` / `_commit` | escritura | Editar variedad de uva |
| `vineyard_harvest_close_prepare` / `_commit` | escritura | Cerrar vendimia |
| `vineyard_harvest_create_prepare` / `_commit` | escritura | Anotar vendimia de una parcela |
| `vineyard_harvest_plan_confirm_prepare` / `_commit` | escritura | Confirmar fecha de vendimia |
| `vineyard_harvest_plan_create_prepare` / `_commit` | escritura | Nuevo plan de vendimia |
| `vineyard_harvest_plan_get` | lectura | Plan de vendimia |
| `vineyard_harvest_plan_suggest_prepare` / `_commit` | escritura | Calcular fecha de vendimia |
| `vineyard_harvest_plan_update_prepare` / `_commit` | escritura | Editar plan de vendimia |
| `vineyard_harvest_plans_list` | lectura | Planes de vendimia |
| `vineyard_harvests_list` | lectura | Vendimias |
| `vineyard_harvests_summary_get` | lectura | Kilos vendimiados de la campaña |
| `vineyard_maturity_check_create_prepare` / `_commit` | escritura | Anotar control de maduración |
| `vineyard_maturity_checks_list` | lectura | Controles de maduración |
| `vineyard_notebook_cue_pending_list` | lectura | Tratamientos sin anotar en el CUE |
| `vineyard_notebook_cue_reminders_notify_prepare` / `_commit` | escritura | Avisar de tratamientos sin anotar en el CUE |
| `vineyard_notebook_export_csv` | lectura | Exportar cuaderno de campo (CSV) |
| `vineyard_notebook_operation_add_prepare` / `_commit` | escritura | Anotar labor en el cuaderno |
| `vineyard_notebook_operations_list` | lectura | Otras labores del cuaderno |
| `vineyard_notebook_product_create_prepare` / `_commit` | escritura | Alta de producto del cuaderno |
| `vineyard_notebook_product_get` | lectura | Producto del cuaderno de campo |
| `vineyard_notebook_product_update_prepare` / `_commit` | escritura | Editar producto del cuaderno |
| `vineyard_notebook_products_list` | lectura | Productos del cuaderno de campo |
| `vineyard_parcel_analyses_list` | lectura | Analíticas de uva de la parcela |
| `vineyard_parcel_analysis_create_prepare` / `_commit` | escritura | Registrar analítica de uva de la parcela |
| `vineyard_parcel_create_prepare` / `_commit` | escritura | Alta de parcela |
| `vineyard_parcel_get` | lectura | Ficha de parcela |
| `vineyard_parcel_options_list` | lectura | Selector de parcelas activas |
| `vineyard_parcel_update_prepare` / `_commit` | escritura | Editar parcela |
| `vineyard_parcels_list` | lectura | Parcelas de viñedo |
| `vineyard_parcels_summary_get` | lectura | Resumen del viñedo |
| `vineyard_treatment_create_prepare` / `_commit` | escritura | Anotar tratamiento |
| `vineyard_treatment_get` | lectura | Tratamiento |
| `vineyard_treatment_update_prepare` / `_commit` | escritura | Completar tratamiento |
| `vineyard_treatments_list` | lectura | Tratamientos del cuaderno de campo |

## Regulatorio y SILICIE (16)

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `regulatory_obligations_list` | lectura | Calendario de obligaciones regulatorias |
| `regulatory_obligations_sync_prepare` / `_commit` | escritura | Actualizar calendario regulatorio |
| `regulatory_silicie_exercise_open_prepare` / `_commit` | escritura | Abrir ejercicio SILICIE |
| `regulatory_silicie_ledger_create_prepare` / `_commit` | escritura | Crear libro SILICIE |
| `regulatory_silicie_ledger_validate_prepare` / `_commit` | escritura | Validar libro SILICIE |
| `regulatory_silicie_ledgers_list` | lectura | Libros SILICIE del depósito fiscal |
| `regulatory_submission_cancel_prepare` / `_commit` | escritura | Anular envío SILICIE |
| `regulatory_submission_correct_prepare` / `_commit` | escritura | Corregir envío SILICIE |
| `regulatory_submission_create_prepare` / `_commit` | escritura | Preparar envío SILICIE |
| `regulatory_submission_file_get` | lectura | Descargar fichero SILICIE |
| `regulatory_submission_get` | lectura | Detalle de una presentación |
| `regulatory_submission_mark_result_prepare` / `_commit` | escritura | Registrar respuesta de la AEAT |
| `regulatory_submission_mark_submitted_prepare` / `_commit` | escritura | Marcar envío presentado en la AEAT |
| `regulatory_submission_request_approval_prepare` / `_commit` | escritura | Pedir aprobación del envío SILICIE |
| `regulatory_submission_validate_prepare` / `_commit` | escritura | Validar envío SILICIE |
| `regulatory_submissions_list` | lectura | Presentaciones regulatorias |
