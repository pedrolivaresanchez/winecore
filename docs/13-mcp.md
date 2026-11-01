# 13 · Servidor MCP de WineCore (especificación de herramientas)

> Versión 2 · 01-11-2026 · Decisión de Pedro (ADR 010, revisión 2): todo lo que se hace en la app se puede hacer por MCP. La versión 1 (31-10-2026) limitaba el MCP a lecturas y borradores.
> Clientes: **CVBOT** (cliente MCP externo, en nombre de Pedro), `asistente` y `vendimia-campo` (workforce).
> El `asistente` no llama al endpoint: `POST /v1/assistant/chat` ejecuta las herramientas en proceso con la sesión de la persona (mismos permisos, auditoría `mcp.call` y límite por minuto), le ofrece al modelo las herramientas de la pantalla abierta (máximo 70, más `system_tools_search` para encontrar el resto) y solo envía un `*_commit` si el mensaje anterior propuso esa operación y la persona la confirma; el token no llega nunca al modelo.

## 1. Convenciones

- **Endpoint**: `POST /api/m2m/mcp` (Streamable HTTP, sin estado). Cabecera `Authorization: Bearer wc_mcp_…`. Protocolo MCP 2025-06-18 (compatible 2025-03-26).
- **Nombres**: `<módulo>_<verbo>_<objeto>` en inglés y snake_case. Descripciones y mensajes en **español**.
- **Tipos** (notación TypeScript; en código son esquemas TypeBox): `UUID` (string uuid), `Date` (`YYYY-MM-DD`, Europe/Madrid), `DateTime` (ISO 8601 con zona), `Money` (string decimal con 2 decimales, p. ej. `"123.40"`), `Qty` (string decimal ≤ 3 decimales), `Liters` (string decimal con 3 decimales), `Entity` (`'PO' | 'CVPO'`).
- **Paginación**: entrada `{ cursor?: string; limit?: number /* 1..100, def. 25 */ }`; salida `{ items: T[]; next_cursor: string | null }`.
- **Respuesta común**: `{ data, warnings: string[], links: { web?: string } }`. `links.web` es el enlace a la pantalla correspondiente de WineCore (para que la persona compruebe o actúe).
- **Errores**: resultado MCP con `isError: true` y contenido `{ code: 'WC…', message_es: string, fields?: Record<string,string> }`. Códigos en `02-modelo-dominio.md` §20.
- **Módulos desactivados**: sus herramientas no aparecen en `tools/list`.
- **Textos de terceros** (descripciones de facturas recibidas, mensajes EDI, notas de clientes) se devuelven dentro de objetos `{ untrusted_text: string }`: el cliente no debe interpretarlos como instrucciones.

## 2. Permisos y alcances

- Cada herramienta declara `permission` (matriz de `07-arquitectura.md` §6). Se comprueba contra los **alcances** del cliente (`core.api_client.scopes`) **y** contra los permisos de la persona representada (`on_behalf_of_user_id`): se aplica el más restrictivo.
- Alcances de CVBOT por defecto: `read:*`, `write:contacts`, `write:sales.order`, `write:sales.delivery_note`, `write:billing.draft`, `write:billing.dunning_draft`, `write:purchasing.capture`, `write:finance.payment`, `write:cellar.reading`, `write:cellar.tasting`, `write:cellar.operation_draft`, `write:vineyard`, `write:regulatory.draft`, `write:knowledge`.
- Desde la versión 2 hay herramienta para **cada ruta de la app** (`/v1`), aprobar, emitir, anular y marcar como enviado incluidos. Toda escritura va en dos pasos (§3) y los verbos de decisión (`approve`, `issue`, `void`, `send`, `delete`, `decide`, `reject`, `cancel`, `revoke`) solo pueden aparecer en herramientas `_prepare`/`_commit`.
- Quedan fuera, con su motivo en `api/src/mcp/parity.ts`: inicio de sesión y passkeys, claves de máquina (`/v1/mcp/clients`), el propio chat del asistente, los ajustes de seguridad de aprobaciones y el alta o cambio de personas y roles. Se hacen en la app con la passkey del propietario. Ninguna herramienta lee secretos.
- Si el propietario activa «Aprobaciones: pedir passkey o código», la API rechaza las aprobaciones por MCP (`WC_STEP_UP_REQUIRED`) y CVBOT da el enlace a la bandeja.
- Alcances extra de un cliente sin tocar su token: tabla `core.api_client_grant` (DuckDB no permite actualizar la lista `core.api_client.scopes` de un cliente con tokens). Migración 0042: `pedro-owner` recibe `read:*`, `write:*`, `manage:*`, `approve:*`, `issue:*`, `void:*`, `deliver:*`, `count:*`, `operate:*` y `prepare:*`. Los alcances efectivos son la unión de las dos listas; los permisos de la persona representada siguen mandando.

## 3. Escritura con confirmación (dos pasos)

1. `X_prepare(args)` → valida y calcula **sin escribir nada**; devuelve:
   ```ts
   { preview: object /* lo que se hará, en términos de negocio */, summary_es: string /* 1–3 frases para mostrar a la persona */,
     confirmation_token: string /* un solo uso */, expires_at: DateTime /* now + 10 min */ }
   ```
   y guarda en `ops.mcp_confirmation` el hash SHA-256 de los argumentos normalizados y la vista previa.
2. CVBOT muestra `summary_es` (y el detalle si se lo piden) y pide confirmación explícita ("¿Confirmas?").
3. `X_commit({ confirmation_token, idempotency_key })` → ejecuta exactamente lo previsualizado. Falla si el token caducó, ya se usó, pertenece a otro cliente o los datos de base cambiaron de forma que la vista previa ya no es válida (p. ej. el precio de tarifa cambió): `WC_MCP_CONFIRMATION_INVALID` / `WC_MCP_PREVIEW_STALE` (hay que repetir `prepare`).
4. Toda llamada queda en auditoría (`mcp.call`) con herramienta, cliente, persona, hash de argumentos y resultado.

### 3.1 Herramientas sobre las rutas de la app (versión 2)

- **Puente** (`api/src/mcp/rest.ts`): la mayoría de herramientas repiten en proceso la ruta `/v1` de la pantalla equivalente con la sesión de la persona representada, así que los permisos, validaciones, aprobaciones y auditoría son exactamente los de la app. Las peticiones llevan `x-request-id: mcp.<id>`, y las escrituras `Idempotency-Key` (fijada en `prepare`) e `If-Match` con el `updated_at` leído en `prepare`. `commit` vuelve a leer el registro y falla con `WC_MCP_PREVIEW_STALE` si cambió.
- Los PATCH que sustituyen el registro entero se componen sobre el registro actual: la persona solo indica los campos que cambian.
- **Ficheros**: las subidas llevan `file_base64`, `filename` y `content_type`; las descargas devuelven texto (CSV) o `base64` con `sha256` (PDF, máximo 10 MB). WineCore no envía correos: CVBOT descarga el PDF, lo envía y lo marca como enviado.
- **Listado**: `tools/list` devuelve todas las herramientas permitidas. `?tools=compact` devuelve solo las principales más la pasarela (`system_tools_search` para buscar por texto y `system_tool_run` para ejecutar una de las encontradas); `?toolsets=billing,sales` filtra por prefijo.
- **Paridad**: `api/test/mcp/route-parity.test.ts` falla si una ruta `/v1` no tiene herramienta (`routes` en su definición) ni exclusión en `parity.ts`. `bun run scripts/mcp-missing-routes.ts` lista las que faltan.

## 4. Catálogo

> Las tablas de esta sección son las herramientas de la versión 1 y siguen existiendo. La lista completa de la versión 2 (429 herramientas) está en `13-mcp-catalogo.md`, generada desde el código; cada cliente ve en `tools/list` solo las que le permiten sus alcances, la persona representada y los módulos activos.

### 4.1 Sistema y aprobaciones (M1)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `system_whoami` | read | — | `{}` | `{ client: string; on_behalf_of: { id: UUID; name: string } \| null; roles: string[]; scopes: string[]; modules_enabled: string[] }` |
| `system_search` | read | `*.read` | `{ q: string /* ≥ 2 car. */; types?: ('contact'\|'product'\|'lot'\|'invoice'\|'order'\|'delivery_note')[]; limit?: number }` | `{ items: { type: string; id: UUID; title: string; subtitle: string; link: string }[] }` |
| `approvals_list_pending` | read | `*.read` | `{ entity?: Entity; kind?: string }` | `{ items: { id: UUID; kind: string; entity: Entity \| null; summary: string; requested_at: DateTime; expires_at: DateTime; link: string }[] }` |
| `approvals_get_link` | read | `*.read` | `{ approval_id: UUID }` | `{ link: string; status: string; summary: string }` |

### 4.2 Contactos (M1)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `contacts_search` | read | `contacts.read` | `{ q?: string; role?: 'customer'\|'supplier'\|'carrier'; country?: string; cursor?; limit? }` | `{ items: ContactSummary[]; next_cursor }` · `ContactSummary = { id; legal_name; tax_id_masked: string /* ****1234A */; country; is_customer; is_supplier; default_channel?: string }` |
| `contacts_get` | read | `contacts.read` | `{ contact_id: UUID }` | `ContactDetail = ContactSummary & { kind; trade_name?; addresses: Address[]; persons: { full_name; role?; email?; phone? }[] /* solo si el permiso incluye datos de contacto */; vat_regime; payment_terms_days; payment_method?; iban_last4?; terms_by_entity: { entity: Entity; customer_account?; discount_pct }[]; open_receivables: Money }` |
| `contacts_create_prepare` / `_commit` | write | `contacts.write` | `{ kind: 'company'\|'person'; legal_name: string; tax_id?: string; country: string; address?: Address; email?: string; phone?: string; is_customer?: boolean; is_supplier?: boolean; vat_regime?: string; payment_terms_days?: number; default_channel?: string }` | prepare: vista previa con NIF normalizado y **duplicados candidatos** (`{ contact_id; legal_name; rule }[]`); commit: `{ contact_id }` |
| `contacts_update_prepare` / `_commit` | write | `contacts.write` | `{ contact_id; changes: Partial<{ address: Address; email: string; phone: string; payment_terms_days: number; default_channel: string; vat_regime: string }> }` | prepare: antes/después; commit: `{ contact_id }` |

### 4.3 Catálogo y precios (M1)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `catalog_products_search` | read | `catalog.read` | `{ q?: string; kind?: string; wine_code?: string; vintage?: number; active?: boolean; cursor?; limit? }` | `{ items: { id; sku; name; kind; vintage?; format?: string; gtin?: string; active: boolean }[]; next_cursor }` |
| `catalog_product_get` | read | `catalog.read` | `{ product_id: UUID }` | `{ product; prices: { price_list: string; unit_price: Money; valid_from: Date }[]; stock_summary?: { location: string; qty_units: number }[] /* si inventory activo */ }` |
| `catalog_price_quote` | read | `catalog.read` | `{ customer_id?: UUID; channel: string; date?: Date; lines: { sku: string; quantity: Qty }[] }` | `{ issuing_entity: Entity; rule: { scope; id }; lines: { sku; unit_price: Money; price_list: string; discount_pct: string; line_base: Money; tax_code: string }[]; totals: { subtotal; tax_total; total } }` |

### 4.4 Ventas (M1: pedidos; M2: albaranes)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `sales_orders_list` | read | `sales.read` | `{ status?; channel?; customer_id?; from?: Date; to?: Date; cursor?; limit? }` | `{ items: { id; number?; status; channel; customer: string; order_date: Date; total: Money; entity?: Entity }[]; next_cursor }` |
| `sales_order_get` | read | `sales.read` | `{ order_id }` | Pedido con líneas, entregado y facturado por línea, documentos relacionados y enlaces |
| `sales_order_create_prepare` / `_commit` | write | `sales.write` | `{ customer_id; channel; customer_order_ref?; requested_date?: Date; ship_to_address_id?: UUID; lines: { sku; quantity: Qty; unit_price?: Money /* si se omite, tarifa */; discount_pct?: string }[]; notes?: string; confirm?: boolean /* def. false: queda en borrador */ }` | prepare: entidad resuelta por D3 con la regla, precios, totales y avisos (stock insuficiente, precio bajo coste); commit: `{ order_id; number? }` |
| `sales_delivery_notes_list` | read | `sales.read` | `{ status?; invoicing_status?; from?; to?; location?; cursor?; limit? }` | Lista con estado, origen, destino y días sin facturar |
| `sales_delivery_note_get` | read | `sales.read` | `{ delivery_note_id }` | Detalle con líneas, lotes, transportista y e-DA |
| `sales_delivery_note_from_order_prepare` / `_commit` | write | `sales.write` | `{ order_id; from_location: string; lines?: { order_line_id; quantity: Qty; lot_code?: string }[]; issue?: boolean /* def. false */ }` | prepare: lotes sugeridos (el más antiguo con saldo en origen), saldo tras la salida, efectos intercompañía; commit: `{ delivery_note_id; number? }` |

### 4.5 Facturación (M1)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `billing_invoices_list` | read | `billing.read` | `{ entity?; status?; payment_status?; overdue?: boolean; customer_id?; from?; to?; cursor?; limit? }` | `{ items: { id; number?; entity; type; status; issue_date?; customer: string; total: Money; outstanding: Money; verifactu: 'n/a'\|'pending'\|'accepted'\|'accepted_with_errors'\|'rejected' }[]; next_cursor }` |
| `billing_invoice_get` | read | `billing.read` | `{ invoice_id }` | Factura con líneas, desglose, vencimientos, cobros, rectificaciones, estado Verifactu (CSV, errores) y enlace al PDF |
| `billing_invoice_draft_from_delivery_notes_prepare` / `_commit` | write | `billing.write` | `{ delivery_note_ids: UUID[]; issue_date_proposal?: Date }` | prepare: borrador (líneas agrupadas, totales, entidad, validaciones pendientes para emitir); commit: `{ invoice_id }` (**borrador**: la emisión se hace en la web) |
| `billing_invoice_draft_prepare` / `_commit` | write | `billing.write` | `{ entity?: Entity /* si se omite, D3 */; customer_id; channel; lines: { sku?; description: string; quantity: Qty; unit_price?: Money; discount_pct?; tax_code?; lot_code? }[]; notes? }` | ídem |
| `billing_receivables_report` | read | `billing.read` | `{ entity?; as_of?: Date; group_by?: 'customer'\|'age' }` | `{ total_outstanding: Money; overdue: Money; buckets: { label: '0-30'\|'31-60'\|'61-90'\|'>90'; amount: Money }[]; by_customer: { customer; outstanding; oldest_due: Date }[] }` |
| `billing_verifactu_status` | read | `billing.read` | `{ entity? }` | `{ pending: number; sending: number; rejected: { invoice_number; error_code; error_text }[]; last_accepted_at?: DateTime; next_send_not_before?: DateTime }` |
| `billing_intercompany_status` | read | `billing.read` | `{ period?: 'current'\|'previous' }` | `{ period: { start; end; status }; lines: number; amount: Money; below_cost: { sku; lot?; unit_price; unit_cost }[]; draft_invoice_id?: UUID }` |
| `billing_dunning_draft_prepare` / `_commit` | write | `billing.write` | `{ invoice_id; tone?: 'amable'\|'firme'; language?: 'es'\|'en' }` | prepare: texto propuesto del recordatorio; commit: `{ approval_id; link }` — **no se envía**: queda pendiente de aprobación `third_party_message` y lo envía una persona |

### 4.6 Compras y gastos (M2)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `purchasing_supplier_invoices_list` | read | `purchasing.read` | `{ entity?; status?; payment_status?; supplier_id?; from?; to?; cursor?; limit? }` | Lista con proveedor, número, total, estado y vencimiento |
| `purchasing_supplier_invoice_capture_prepare` / `_commit` | write | `purchasing.write` | `{ entity: Entity; file: { filename: string; mime: 'application/pdf'\|'image/jpeg'\|'image/png'; base64: string /* ≤ 10 MB */ }; note?: string }` | prepare: comprobación de tamaño/tipo y duplicado por hash; commit: `{ supplier_invoice_id; status: 'captured' }` (el OCR se lanza después) |
| `purchasing_payables_report` | read | `purchasing.read` | `{ entity?; as_of?: Date }` | Pendiente de pago por proveedor y vencimiento |

### 4.7 Finanzas (M2 básico; M6 bancos)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `finance_payments_list` | read | `finance.read` | `{ entity?; direction?; from?; to?; counterparty_id?; cursor?; limit? }` | Lista de cobros/pagos con imputaciones |
| `finance_payment_register_prepare` / `_commit` | write | `finance.write` | `{ entity: Entity; direction: 'in'\|'out'; amount: Money; value_date: Date; method: string; counterparty_id: UUID; reference?: string; allocations: { invoice_id?: UUID; supplier_invoice_id?: UUID; amount: Money }[] }` | prepare: estado resultante de cada documento; commit: `{ payment_id }` |
| `finance_bank_unmatched_list` | read | `finance.read` | `{ bank_account?: string; cursor?; limit? }` | Líneas de extracto sin conciliar con sugerencias |

### 4.8 Inventario y trazabilidad (M2)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `inventory_stock_at` | read | `inventory.read` | `{ at?: DateTime /* def. ahora */; location?: string; vessel?: string; lot_code?: string; sku?: string; state?: string; owner?: Entity }` | `{ at; rows: { location; vessel?; owner; lot_code?; sku?; state; qty_units: number; liters: Liters }[]; totals: { bulk_liters: Liters; packaged_units: number; packaged_liters: Liters } }` — pensada para **inspección sin aviso** |
| `inventory_movements_list` | read | `inventory.read` | `{ ledger: 'physical'\|'fiscal'; from?; to?; lot_code?; sku?; location?; cursor?; limit? }` | Movimientos con documento origen y enlace |
| `inventory_reconcile_physical_fiscal` | read | `inventory.read` | `{ from: Date; to: Date; persist?: false }` | `{ balanced: boolean; differences: { sku?; lot_code?; physical_liters; fiscal_liters; difference_liters; explanation; documents: { type; number; date; link }[] }[] }` |
| `inventory_count_start_prepare` / `_commit` | write | `inventory.count` | `{ kind: 'periodic'\|'inspection'\|'spot'; locations: string[]; counted_at?: DateTime }` | prepare: líneas esperadas; commit: `{ count_id; link }` (el recuento se rellena en la web o por voz) |
| `traceability_lot` | read | `inventory.read` | `{ lot_code: string; direction?: 'up'\|'down'\|'both' }` | `{ lot; ancestors: Edge[]; descendants: Edge[]; operations: OperationSummary[]; analyses: AnalysisSummary[]; additions: AdditionSummary[]; receptions: { parcel?; supplier?; kg; accompanying_doc? }[]; exits: { doc_type; number; date; customer; qty }[]; mermaid: string /* diagrama listo para mostrar */ }` |

### 4.9 Bodega (M2 mínimo; M4 completo)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `cellar_vessels_list` | read | `cellar.read` | `{ kind?; zone?; only_with_content?: boolean }` | `{ items: { code; name; kind; capacity_liters; content: { lot_code; state; liters; fill_pct } \| null; last_reading?: { at; density?; temperature_c? }; status }[] }` |
| `cellar_lot_get` | read | `cellar.read` | `{ lot_code }` | Lote con ubicación actual, últimos análisis, lecturas (serie para gráfica), adiciones y catas |
| `cellar_fermentation_reading_add_prepare` / `_commit` | write | `cellar.operate` | `{ vessel_code: string; measured_at?: DateTime; density?: string; temperature_c?: string; note?: string; source?: 'voice'\|'chat' }` | prepare: lote del depósito, lectura anterior y alerta si procede; commit: `{ reading_id }` |
| `cellar_tasting_add_prepare` / `_commit` | write | `cellar.operate` | `{ lot_code?: string; vessel_code?: string; notes: string; decision?: string; source? }` | commit: `{ tasting_id }` |
| `cellar_analysis_add_prepare` / `_commit` | write | `cellar.operate` | `{ lot_code; vessel_code?; kind; sampled_at: DateTime; lab: 'internal'\|'external'; results: { parameter: string; value: string }[]; report_file?: File }` | prepare: valida rangos de parámetros; commit: `{ analysis_id }` |
| `cellar_operation_draft_prepare` / `_commit` | write | `cellar.operate` | `{ op_type: 'racking'\|'blend'\|'filtration'\|'addition'\|'bottling'\|'loss'\|'sampling'; occurred_at?: DateTime; inputs: { lot_code; vessel_code?; liters?: Liters; units?: number }[]; outputs: { lot_code?: string /* nuevo si blend/bottling */; vessel_code?; sku?; liters?; units?: number }[]; losses?: { lot_code; vessel_code?; liters?; units?; kind: 'authorized'\|'incident' }[]; details?: object }` | prepare: comprobación de conservación y capacidad; commit: `{ operation_id; link }` (**borrador**: se confirma en la web) |

### 4.10 Viñedo (M4)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `vineyard_parcels_list` | read | `vineyard.read` | `{ only_own?: boolean }` | Parcelas con SIGPAC, superficie, variedades y última observación |
| `vineyard_maturity_check_add_prepare` / `_commit` | write | `vineyard.write` | `{ parcel_code; checked_at?: DateTime; sensory_notes?: string; estimated_days_to_harvest?: number; sanitary_status?: 'good'\|'fair'\|'poor'; photos?: File[]; source? }` | prepare: añade previsión meteorológica del día; commit: `{ maturity_check_id }` |
| `vineyard_treatment_add_prepare` / `_commit` | write | `vineyard.write` | `{ parcel_code; applied_on: Date; operator_name; product_name; dose: string; dose_unit; treated_area_ha: string; method: string; supplier_invoice_id?: UUID }` | prepare: avisa si el producto no consta como apto en ecológico; commit: `{ treatment_id }` |
| `vineyard_field_task_add_prepare` / `_commit` | write | `vineyard.write` | `{ parcel_code; done_on: Date; kind; hours?: string; notes? }` | commit: `{ field_task_id }` |

### 4.11 Regulatorio (M2–M3)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `regulatory_obligations_list` | read | `regulatory.read` | `{ entity?; from?: Date; to?: Date; status? }` | `{ items: { flow; title; due_date; status; days_left: number; link }[] }` |
| `regulatory_submissions_list` | read | `regulatory.read` | `{ flow?; status?; cursor?; limit? }` | Envíos con estado, periodo, referencia externa y enlace |
| `regulatory_submission_get` | read | `regulatory.read` | `{ submission_id }` | Resumen del payload, errores de validación, aprobación, intentos y evidencias (enlaces) |
| `regulatory_submission_draft_prepare` / `_commit` | write | `regulatory.prepare` | `{ flow: 'silicie'\|'sisv'\|'emcs'\|'edi'; entity: Entity; period_start?: Date; period_end?: Date; ref_id?: UUID /* albarán, factura… */ }` | prepare: nº de anotaciones, totales por producto, validaciones; commit: `{ submission_id; link }` |
| `regulatory_submission_request_approval_prepare` / `_commit` | write | `regulatory.prepare` | `{ submission_id }` | prepare: resumen exacto que verá el aprobador; commit: `{ approval_id; link }` (aprobar se hace en la web) |
| `regulatory_reconcile_sisv_silicie` | read | `regulatory.read` | `{ from: Date; to: Date }` | `{ balanced; differences: { product; sisv_liters; silicie_liters; difference; explanation }[] }` |
| `regulatory_edi_inbox_list` | read | `regulatory.read` | `{ status?; type?; cursor?; limit? }` | Mensajes EDI con estado y pedido/factura enlazados |
| `regulatory_emcs_list` | read | `regulatory.read` | `{ status?; from?; to? }` | e-DA con ARC, destino y estado de recepción |

### 4.12 Informes (M2+)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `reports_kpis` | read | `*.read` | `{ entity?; period?: 'month'\|'quarter'\|'year' }` | Ventas, cobros pendientes, vencido, stock valorado (si hay costes), envíos pendientes, alertas |
| `reports_sales_summary` | read | `billing.read` | `{ entity?; from: Date; to: Date; group_by: 'channel'\|'product'\|'customer'\|'month' }` | Importes, unidades, margen estimado (si hay coste) |

### 4.13 Conocimiento de añadas (posterior)

| Herramienta | Tipo | Permiso | Entrada | Salida |
|---|---|---|---|---|
| `knowledge_tasting_notes_search` | read | `knowledge.read` | `{ wine_code?; vintage?; q?: string }` | Notas con fecha, lugar y evolución |
| `knowledge_tasting_note_add_prepare` / `_commit` | write | `knowledge.write` | `{ wine_code?; vintage?; lot_code?; tasted_on?: Date; place?; glass?; score?: number; evolution?; notes: string; source? }` | commit: `{ tasting_note_id }` |

## 5. Ejemplo de conversación (CVBOT)

1. Pedro: "¿Cuánto Entredicho 2023 nos queda y dónde?" → `inventory_stock_at({ sku: 'ENTREDICHO-2023-075' })`.
2. Pedro: "Hazle un pedido a [cliente] de 24 botellas" → `sales_order_create_prepare(...)` → CVBOT: "Pedido de CVPO (regla por canal 'distribuidor') a [cliente]: 24 × Entredicho 2023 0,75 a 9,50 € = 228,00 € + IVA. ¿Confirmas?" → "Sí" → `sales_order_create_commit({ confirmation_token, idempotency_key })`.
3. Pedro: "¿Hay algo pendiente de aprobar?" → `approvals_list_pending()` → CVBOT devuelve los enlaces; Pedro aprueba en la web con su passkey.

## 6. Pruebas obligatorias del MCP (resumen; detalle en `11-tests.md` §8)

- Cada herramienta `read` devuelve solo lo permitido por alcance y persona (tests con un cliente sin `contacts.read`).
- Cada `_commit` falla con token caducado, reutilizado, de otro cliente o con argumentos distintos.
- `tools/list` no muestra herramientas de módulos desactivados.
- No existe ninguna herramienta cuyo nombre contenga `approve`, `issue`, `void`, `send`, `delete`, `module`, `role` o `secret` (test de catálogo).
- Las respuestas con texto de terceros van en `untrusted_text`.
