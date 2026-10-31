# 10 · Backlog de implementación (Fase 2)

> Versión 1 · 31-10-2026. Cada tarea dura **0,5–2 días** de un agente hijo, toca un conjunto acotado de ficheros y tiene interfaz exacta, criterios verificables y tests. El agente padre las asigna en orden de hito y de ruta crítica (Verifactu primero) sin ficheros solapados (plan §7.1–7.2).
> **Escalado** (plan §7.3): "sí" cuando la tarea toca lógica regulatoria o fiscal, contabilidad o conciliación físico ↔ fiscal, migración, o arquitectura (esquema transversal, concurrencia, idempotencia, seguridad, certificado). La revisión de esas tareas la hace Opus.
> Trazabilidad: cada historia del MVP (M0–M4) tiene al menos una tarea (§3) y cada tarea apunta a historias (`US-…`) o requisitos no funcionales (`RNF-…`, `01-PRD.md` §5).

## 1. Plantilla de tarea

```
# TASK-<MÓDULO>-NNN · <título>
- Hito · Estimación · Escalado (sí/no y motivo)
- Historias / RNF
- Depende de
## Objetivo
## Contexto (enlaces a la especificación)
## Ficheros
## Interfaz exacta
## Criterios de aceptación (verificables)
## Tests requeridos
```

Reglas para todas las tareas: primero los tests; PR pequeño con el TASK-ID; sin datos reales (solo `api/db/synthetic.ts`); sin secretos; si la especificación es ambigua, `BLOQUEADO: <pregunta>` en el PR (plan §7.2).

## 2. Tareas

| ID | Título | Historias / RNF | Hito | Depende de | Días | Escalado |
|---|---|---|---|---|---|---|
| TASK-INFRA-001 | Monorepo y herramientas | US-CORE-01, RNF-10 | M0 | — | 1 | no |
| TASK-INFRA-002 | CI de calidad (`ci.yml`) | RNF-05, RNF-07 | M0 | INFRA-001 | 1,5 | no |
| TASK-INFRA-003 | AWS base con OpenTofu (RDS, S3 Object Lock, KMS, OIDC) | RNF-04, RNF-08 | M0 | Q-027 | 2 | sí (arquitectura y seguridad) |
| TASK-INFRA-004 | Timbal: entornos y conexión con GitHub (Plan A/B) | RNF-04 | M0 | Q-004 | 1 | sí (arquitectura) |
| TASK-INFRA-005 | Secretos y configuración por entorno | RNF-05 | M0 | INFRA-003, INFRA-004 | 0,5 | sí (seguridad) |
| TASK-INFRA-006 | Despliegue (`deploy.yml`) | RNF-04 | M0 | INFRA-002, INFRA-004, CORE-002 | 1,5 | sí (arquitectura) |
| TASK-INFRA-007 | Comparación de remotos y trabajos nocturnos | RNF-04, RNF-07 | M0 | INFRA-006 | 1 | no |
| TASK-INFRA-008 | Observabilidad, alertas y coste | RNF-04, RNF-06, RNF-11 | M1 | INFRA-006 | 1 | no |
| TASK-INFRA-009 | Runbook y alta del certificado de Verifactu | US-VFT-02, RNF-05 | M1 | INFRA-003, Q-006 | 0,5 | sí (custodia del certificado) |
| TASK-INFRA-010 | Copias, exportación y prueba de restauración | RNF-04, RNF-09 | M1 | INFRA-003 | 1 | no |
| TASK-CORE-001 | Base del núcleo: BD, errores, dinero, fechas | RNF-07, RNF-12 | M0 | INFRA-001 | 1,5 | no |
| TASK-CORE-002 | Migraciones de BD desde la especificación | RNF-07 | M0 | CORE-001 | 1 | sí (esquema transversal) |
| TASK-CORE-003 | API Elysia: módulos, permisos, idempotencia | US-CORE-04, RNF-05 | M0 | CORE-002, AUTH-001 | 1,5 | sí (idempotencia y seguridad) |
| TASK-CORE-004 | Series de numeración sin huecos | US-CORE-06 | M1 | CORE-003 | 0,5 | no |
| TASK-CORE-005 | Auditoría: consulta y verificación de la cadena | US-CORE-05 | M1 | CORE-003 | 1 | no |
| TASK-CORE-006 | Adjuntos en S3 con hash | RNF-08 | M1 | CORE-003, INFRA-003 | 1 | no |
| TASK-CORE-007 | Outbox, notificaciones y eventos a CVBOT | US-CORE-07 | M1 | CORE-003 | 1 | no |
| TASK-CORE-008 | Ajustes y búsqueda global | US-CORE-04, US-MCP-01 | M1 | CORE-003 | 1 | no |
| TASK-AUTH-001 | Acceso con Timbal y lista blanca | US-CORE-01 | M0 | CORE-001, INFRA-004 | 1 | sí (seguridad) |
| TASK-AUTH-002 | Roles por entidad y permisos | US-CORE-02 | M0 | AUTH-001, CORE-003 | 1,5 | sí (seguridad) |
| TASK-AUTH-003 | Passkeys y TOTP (verificación reforzada) | US-CORE-03 | M1 | AUTH-002 | 1,5 | sí (seguridad) |
| TASK-AUTH-004 | Clientes de máquina y tokens con alcances | US-MCP-01, US-CORE-07 | M1 | AUTH-002 | 1 | sí (seguridad) |
| TASK-AUTH-005 | Autenticación de las rutas `/api/m2m/*` | US-MCP-01, US-SIL-03 | M1 | AUTH-004, Q-028 | 1 | sí (seguridad) |
| TASK-APR-001 | Servicio de aprobaciones ligadas al hash | US-APR-01, US-APR-02, US-APR-03 | M1 | AUTH-003 | 1,5 | sí (seguridad) |
| TASK-APR-002 | Bandeja de aprobaciones (UI-03) | US-APR-01, US-APR-02 | M1 | APR-001, UI-002 | 1,5 | no |
| TASK-APR-003 | Políticas de aprobación (UI-39) | US-APR-03 | M1 | APR-001 | 0,5 | no |
| TASK-UI-001 | Esqueleto de la UI: rutas, menú y estados | US-CORE-04, RNF-10 | M0 | INFRA-001, AUTH-001 | 1,5 | no |
| TASK-UI-002 | Primitivas del sistema de diseño | RNF-10 | M0 | UI-001 | 2 | no |
| TASK-UI-003 | Panel (UI-02) | US-APR-01, US-VFT-02, US-FIN-02 | M1 | UI-002, CORE-007 | 1 | no |
| TASK-SET-001 | Ajustes, series, módulos, conectores e historial (UI-34/36/38/40) | US-CORE-04, US-CORE-05, US-CORE-06 | M1 | CORE-004, CORE-005, CORE-008, UI-002 | 2 | no |
| TASK-CONT-001 | Contactos: NIF y alta/edición | US-CONT-01 | M1 | CORE-003 | 1,5 | no |
| TASK-CONT-002 | Contactos: UI-04 y UI-05 | US-CONT-01, US-CONT-03 | M1 | CONT-001, UI-002 | 2 | no |
| TASK-CONT-003 | Duplicados y fusión (UI-06) | US-CONT-02 | M1 | CONT-001 | 1,5 | sí (deduplicación) |
| TASK-CONT-004 | Derechos RGPD | US-CONT-04, RNF-06 | M2 | CONT-001, APR-001 | 1 | no |
| TASK-CAT-001 | Vinos, formatos y productos (UI-07/08) | US-CAT-01 | M1 | CORE-003, UI-002 | 2 | no |
| TASK-CAT-002 | Tarifas versionadas (UI-09) | US-CAT-02 | M1 | CAT-001, APR-001 | 1,5 | no |
| TASK-CAT-003 | Tarifa intercompañía | US-CAT-03 | M2 | CAT-002 | 1 | no |
| TASK-CAT-004 | Coste estándar | US-CAT-04 | M2 | CAT-001 | 0,5 | no |
| TASK-VENT-001 | Reglas de entidad facturadora (UI-35) | US-VENT-02 | M1 | CONT-001, APR-001 | 1,5 | no |
| TASK-VENT-002 | Pedidos (UI-10) | US-VENT-01 | M1 | VENT-001, CAT-002 | 2 | no |
| TASK-VENT-003 | Albaranes con lote y movimientos físicos (UI-11) | US-VENT-03 | M2 | VENT-002, INV-001 | 2 | sí (libros y cambio de propietario) |
| TASK-VENT-004 | Consigna, traspasos y devoluciones | US-VENT-04, US-VENT-05 | M2 | VENT-003 | 1,5 | no |
| TASK-VENT-005 | Incidencias de transporte | US-VENT-06 | M2 | VENT-003 | 0,5 | no |
| TASK-VENT-006 | Presupuestos y proformas | US-VENT-07 | M2 | VENT-002 | 1 | no |
| TASK-FACT-001 | Cálculo de la factura (`computeInvoice`) | US-FACT-02, US-FACT-06 | M1 | CORE-001 | 1,5 | sí (IVA) |
| TASK-FACT-002 | Borradores de factura | US-FACT-01 | M1 | FACT-001, CONT-001, CAT-001 | 1,5 | no |
| TASK-FACT-003 | Emisión transaccional (`issueInvoice`) | US-FACT-02, US-VFT-01 | M1 | FACT-002, CORE-004, VFT-002 | 2 | sí (fiscal e idempotencia) |
| TASK-FACT-004 | PDF de factura ES/EN con QR | US-FACT-03 | M1 | FACT-003, CORE-006 | 1,5 | sí (representación Verifactu) |
| TASK-FACT-005 | Rectificativas (UI-14) | US-FACT-04 | M1 | FACT-003 | 1,5 | sí (fiscal) |
| TASK-FACT-006 | Anulación de factura emitida por error | US-FACT-05 | M1 | FACT-003, APR-001 | 0,5 | sí (fiscal) |
| TASK-FACT-007 | Exportación, intracomunitaria y Canarias | US-FACT-07 | M2 | FACT-003 | 1 | sí (IVA) |
| TASK-FACT-008 | Emisión en lote con aprobación | US-FACT-08 | M1 | FACT-003, APR-001 | 1 | sí (concurrencia) |
| TASK-FACT-009 | Intercompañía mensual (UI-16) | US-FACT-09 | M2 | FACT-003, CAT-003, VENT-003 | 2 | sí (fiscal y stock) |
| TASK-FACT-010 | Envío al cliente (descarga y correo) | US-FACT-10 | M1/M2 | FACT-004 | 1 | no |
| TASK-FACT-011 | Libro de emitidas y exportación | US-FACT-11 | M2 | FACT-003 | 1 | sí (fiscal) |
| TASK-FACT-012 | Pantallas de facturas (UI-12, UI-13) | US-FACT-01, US-FACT-02, US-FACT-03 | M1 | FACT-003, UI-002 | 2 | no |
| TASK-FIN-001 | Cobros e imputaciones | US-FIN-01, US-MIG-03 | M1 | FACT-003 | 1,5 | no |
| TASK-FIN-002 | Pendientes y vencidos (UI-18) | US-FIN-02 | M1 | FIN-001, UI-002 | 1 | no |
| TASK-VFT-001 | Huella y serialización canónica | US-VFT-01 | M1 | CORE-001 | 1 | sí (Verifactu) |
| TASK-VFT-002 | Registros de alta y anulación encadenados | US-VFT-01 | M1 | VFT-001, CORE-002 | 2 | sí (Verifactu) |
| TASK-VFT-003 | Cliente SOAP y respuestas | US-VFT-02 | M1 | VFT-002 | 1,5 | sí (Verifactu) |
| TASK-VFT-004 | Emisor `verifactu-sender` (Lambda) | US-VFT-02 | M1 | VFT-003, INFRA-009 | 2 | sí (Verifactu y certificado) |
| TASK-VFT-005 | Subsanaciones, rechazos y duplicados | US-VFT-04 | M1 | VFT-004 | 1 | sí (Verifactu) |
| TASK-VFT-006 | Pantalla Verifactu (UI-15) | US-VFT-03, US-VFT-05 | M1 | VFT-004, UI-002 | 1,5 | no |
| TASK-VFT-007 | Batería de preproducción VF-01…VF-22 | US-VFT-06 | M1 | VFT-005, FACT-005, FACT-006 | 2 | sí (Verifactu) |
| TASK-VFT-008 | Instalación y declaración responsable | US-VFT-05 | M1 | VFT-002, Q-007 | 0,5 | sí (Verifactu) |
| TASK-INV-001 | Libros físico y fiscal | US-INV-03, US-INV-05 | M2 | CORE-002 | 1,5 | sí (libros) |
| TASK-INV-002 | Regla de fecha fiscal y salidas fiscales | US-INV-03 | M2 | INV-001, FACT-003 | 1,5 | sí (II.EE.) |
| TASK-INV-003 | Aforos (UI-22) | US-INV-04 | M2 | INV-001, APR-001 | 2 | sí (conciliación) |
| TASK-INV-004 | Aforo de arranque y saldos de apertura | US-INV-01 | M2 | INV-003, Q-013 | 1 | sí (aforo inicial) |
| TASK-INV-005 | Existencias a fecha e informe de inspección (UI-19) | US-INV-02 | M2 | INV-001, UI-002 | 1,5 | no |
| TASK-INV-006 | Movimientos y conciliación físico ↔ fiscal (UI-20/21) | US-INV-03 | M2 | INV-002, UI-002 | 1,5 | sí (conciliación) |
| TASK-INV-007 | Trazabilidad de lotes (UI-24) | US-INV-06 | M2 | BOD-002 | 1,5 | no |
| TASK-BOD-001 | Recipientes y QR (UI-23) | US-BOD-01 | M2 | CORE-003, UI-002 | 1,5 | no |
| TASK-BOD-002 | Motor de operaciones de bodega | US-BOD-02, US-BOD-12 | M2 | INV-001, BOD-001 | 2 | sí (libros y concurrencia) |
| TASK-BOD-003 | Trasiego y filtración (con cambio de mayor) | US-BOD-02 | M2 | BOD-002, REG-005 | 1 | sí (II.EE.) |
| TASK-BOD-004 | Ensamblaje con y sin fórmula | US-BOD-03 | M2 / M4 | BOD-002 | 1,5 | no |
| TASK-BOD-005 | Envasado y etiquetado de jaulón | US-BOD-04, US-BOD-07 | M2 | BOD-002 | 1,5 | no |
| TASK-BOD-006 | Adiciones y limpiezas | US-BOD-05, US-BOD-13 | M2 | BOD-002 | 1 | no |
| TASK-BOD-007 | Mermas y destrucciones con aprobación | US-BOD-06 | M2 | BOD-002, APR-001 | 1 | no |
| TASK-BOD-008 | Formulario de operación (UI-25) | US-BOD-02, US-BOD-04, US-BOD-05, US-BOD-06, US-BOD-07 | M2 | BOD-003…BOD-007, UI-002 | 2 | no |
| TASK-BOD-009 | Recepción de uva, prensado y fin de fermentación | US-BOD-08, US-BOD-09 | M4 | BOD-002 | 2 | no |
| TASK-BOD-010 | Lecturas de fermentación y alertas | US-BOD-10 | M4 | BOD-009 | 1 | no |
| TASK-BOD-011 | Analíticas y catas | US-BOD-11 | M4 | BOD-002 | 1 | no |
| TASK-VIN-001 | Parcelas y variedades (UI-26) | US-VIN-01 | M4 | CORE-003, UI-002 | 1,5 | no |
| TASK-VIN-002 | Tratamientos y cuaderno (CUE) | US-VIN-02 | M4 | VIN-001 | 1,5 | no |
| TASK-VIN-003 | Labores, maduración y vendimia | US-VIN-03, US-VIN-04, US-VIN-05 | M4 | VIN-001, BOD-009 | 1,5 | no |
| TASK-COMP-001 | Captura de gastos y extracción | US-COMP-01 | M2 | CORE-006 | 2 | no |
| TASK-COMP-002 | Validación y aprobación de gastos (UI-17) | US-COMP-02 | M2 | COMP-001, UI-002 | 1,5 | no |
| TASK-COMP-003 | Libro de recibidas | US-COMP-03 | M2 | COMP-002 | 1 | sí (fiscal) |
| TASK-RUN-001 | Ejecutor local: instalación, latido y cola | US-SIL-03 | M2 | AUTH-005, REG-001 | 2 | sí (certificado y seguridad) |
| TASK-RUN-002 | Procedimientos de *computer use* | US-SIL-03 | M2 | RUN-001 | 2 | sí (envíos regulatorios) |
| TASK-REG-001 | Conector regulatorio y ciclo de vida de envíos | US-SIL-02, US-SIL-03 | M2 | APR-001, CORE-006 | 2 | sí (idempotencia de envíos) |
| TASK-REG-002 | Calendario de obligaciones y vigilante de plazos (UI-27) | US-SIL-06, US-ASIS-03 | M2 | REG-001 | 1,5 | sí (plazos regulatorios) |
| TASK-REG-003 | Pantalla de envío regulatorio (UI-28) | US-SIL-02, US-SIL-03 | M2 | REG-001, UI-002 | 1,5 | no |
| TASK-REG-004 | Motor de asientos SILICIE | US-SIL-01 | M2 | INV-002, REG-005 | 2 | sí (II.EE.) |
| TASK-REG-005 | Mayores SILICIE | US-SIL-01 | M2 | CORE-002 | 0,5 | sí (II.EE.) |
| TASK-REG-006 | CSV de SILICIE (IESA1 V2 e IESX4) | US-SIL-02 | M2 | REG-004 | 1,5 | sí (II.EE.) |
| TASK-REG-007 | Presentación de SILICIE por el ejecutor | US-SIL-03 | M2 | REG-006, RUN-002 | 2 | sí (envío regulatorio) |
| TASK-REG-008 | Apertura y cierre del ejercicio SILICIE | US-SIL-06 | M2 | REG-007 | 1 | sí (II.EE.) |
| TASK-REG-009 | Anulación y rectificación de asientos | US-SIL-04 | M2 | REG-007 | 1 | sí (II.EE.) |
| TASK-REG-010 | Vigilancia normativa y declaración en CI | US-VFT-05, US-ASIS-03 | M1 | INFRA-002 | 1 | sí (regulatorio) |
| TASK-REG-011 | Cuadre SISV ↔ SILICIE (UI-29) | US-SIL-05 | M3 | REG-004, REG-012 | 1,5 | sí (cuadre SISV ↔ SILICIE) |
| TASK-REG-012 | Motor de anotaciones SISV | US-SISV-01 | M3 | BOD-002, VENT-003 | 2 | sí (registros vitivinícolas) |
| TASK-REG-013 | Fichero SISV v02 | US-SISV-02 | M3 | REG-012 | 1,5 | sí (registros vitivinícolas) |
| TASK-REG-014 | Importación en SISV por el ejecutor | US-SISV-02 | M3 | REG-013, RUN-002 | 1,5 | sí (envío regulatorio) |
| TASK-REG-015 | Certificación del enólogo | US-SISV-02 | M3 | REG-013 | 0,5 | no |
| TASK-REG-016 | e-DA desde albarán | US-EMCS-01, US-SISV-03 | M3 | VENT-003, REG-001 | 2 | sí (II.EE.) |
| TASK-REG-017 | Presentación de e-DA y mensajes posteriores | US-EMCS-02, US-EMCS-03 | M3 | REG-016, RUN-002 | 2 | sí (envío regulatorio) |
| TASK-REG-018 | Paquete del transitario y pantalla e-DA (UI-31) | US-EMCS-04 | M3 | REG-016, UI-002 | 1 | no |
| TASK-REG-019 | Avisos de AecocEDI desde el buzón (solo lectura) | US-EDI-01 | M3 | CORE-007 | 1 | sí (acceso a buzón) |
| TASK-REG-020 | Lectura de pedidos y avisos en AecocEDI | US-EDI-02 | M3 | REG-019, RUN-002, VENT-002 | 2 | sí (datos de terceros) |
| TASK-REG-021 | Factura a El Corte Inglés en AecocEDI | US-EDI-03 | M3 | REG-020, FACT-003 | 2 | sí (envío a terceros) |
| TASK-REG-022 | Confirmaciones de pago y bandeja EDI (UI-30) | US-EDI-04 | M3 | REG-020, FIN-001 | 1 | no |
| TASK-REG-023 | INFOVI y declaración de cosecha | US-INFOVI-01 | M3 | INV-005, REG-002 | 1 | sí (declaraciones obligatorias) |
| TASK-REG-024 | Certificados ecológicos | US-ECO-01 | M4 | CONT-001 | 1 | sí (normativa ecológica) |
| TASK-REG-025 | Informe para el organismo de control | US-ECO-01 | M4 | REG-024, VIN-002, BOD-006 | 1,5 | sí (normativa ecológica) |
| TASK-REG-026 | Límites de SO₂ y sustancias autorizadas | US-ECO-02 | M4 | BOD-011, REG-024 | 0,5 | sí (normativa ecológica) |
| TASK-MIG-001 | Pipeline de migración | US-MIG-01 | M1 | CORE-002 | 1,5 | sí (migración) |
| TASK-MIG-002 | Contactos desde Holded y Shopify | US-MIG-01 | M1 | MIG-001, CONT-003 | 1,5 | sí (migración) |
| TASK-MIG-003 | Catálogo propuesto y aprobado | US-MIG-02 | M1 | MIG-001, CAT-001 | 1 | sí (migración) |
| TASK-MIG-004 | Partidas abiertas al corte | US-MIG-03 | M1 | MIG-001, FIN-001 | 1 | sí (migración) |
| TASK-MIG-005 | Revisión de albaranes pendientes | US-MIG-04 | M2 | MIG-001, VENT-003 | 1 | sí (migración) |
| TASK-MIG-006 | Pantalla de migración (UI-41) | US-MIG-01, US-MIG-02, US-MIG-03, US-MIG-04 | M1 | MIG-001, UI-002 | 1 | no |
| TASK-MCP-001 | Servidor MCP y confirmación en dos pasos | US-MCP-01, US-MCP-02, US-MCP-03 | M1 | AUTH-005, APR-001 | 2 | sí (seguridad e idempotencia) |
| TASK-MCP-002 | Herramientas MCP de ventas y facturación | US-MCP-02 | M1 | MCP-001, VENT-002, FACT-002 | 1,5 | no |
| TASK-MCP-003 | Herramientas MCP de stock, bodega, viñedo, regulatorio e informes | US-MCP-01 | M2/M3 | MCP-001, INV-005 | 2 | no |
| TASK-MCP-004 | Pruebas de seguridad del MCP | US-MCP-03 | M1 | MCP-001 | 1 | sí (seguridad) |
| TASK-ASIS-001 | Asistente interno (UI-32) | US-ASIS-01 | M3 | MCP-003 | 2 | no |
| TASK-ASIS-002 | Resumen diario a CVBOT | US-ASIS-02 | M3 | CORE-007, UI-003 | 1 | no |
| TASK-ASIS-003 | Vigilantes | US-ASIS-03 | M3 | INV-006, REG-002, VFT-004 | 1,5 | no |
| TASK-REP-001 | Informes y paquete para la asesoría (UI-33) | US-FACT-11, US-COMP-03 | M3 | FACT-011, COMP-003, INV-005 | 1,5 | sí (fiscal) |

**Total**: 132 tareas · 180 días de agente · 71 con escalado a Opus (revisión).

## 3. Trazabilidad historia → tareas (MVP)

| Historia | Tareas |
|---|---|
| US-CORE-01 | INFRA-001, AUTH-001 |
| US-CORE-02 | AUTH-002 |
| US-CORE-03 | AUTH-003 |
| US-CORE-04 | CORE-003, CORE-008, UI-001, SET-001 |
| US-CORE-05 | CORE-005, SET-001 |
| US-CORE-06 | CORE-004, SET-001 |
| US-CORE-07 | CORE-007, AUTH-004 |
| US-APR-01 / 02 / 03 | APR-001, APR-002, APR-003, UI-003 |
| US-CONT-01 | CONT-001, CONT-002 |
| US-CONT-02 | CONT-003 |
| US-CONT-03 | CONT-002 |
| US-CONT-04 | CONT-004 |
| US-CAT-01 / 02 / 03 / 04 | CAT-001, CAT-002, CAT-003, CAT-004 |
| US-VENT-01 | VENT-002 |
| US-VENT-02 | VENT-001 |
| US-VENT-03 | VENT-003 |
| US-VENT-04 / 05 | VENT-004 |
| US-VENT-06 | VENT-005 |
| US-VENT-07 | VENT-006 |
| US-FACT-01 | FACT-002, FACT-012 |
| US-FACT-02 | FACT-001, FACT-003, FACT-012 |
| US-FACT-03 | FACT-004, FACT-012 |
| US-FACT-04 | FACT-005 |
| US-FACT-05 | FACT-006 |
| US-FACT-06 | FACT-001 |
| US-FACT-07 | FACT-007 |
| US-FACT-08 | FACT-008 |
| US-FACT-09 | FACT-009 |
| US-FACT-10 | FACT-010 |
| US-FACT-11 | FACT-011, REP-001 |
| US-VFT-01 | VFT-001, VFT-002, FACT-003 |
| US-VFT-02 | VFT-003, VFT-004, INFRA-009, UI-003 |
| US-VFT-03 | VFT-006 |
| US-VFT-04 | VFT-005 |
| US-VFT-05 | VFT-006, VFT-008, REG-010 |
| US-VFT-06 | VFT-007 |
| US-INV-01 | INV-004 |
| US-INV-02 | INV-005 |
| US-INV-03 | INV-001, INV-002, INV-006 |
| US-INV-04 | INV-003 |
| US-INV-05 | INV-001 |
| US-INV-06 | INV-007 |
| US-BOD-01 | BOD-001 |
| US-BOD-02 | BOD-002, BOD-003, BOD-008 |
| US-BOD-03 | BOD-004 |
| US-BOD-04 / 07 | BOD-005, BOD-008 |
| US-BOD-05 / 13 | BOD-006 |
| US-BOD-06 | BOD-007 |
| US-BOD-08 / 09 | BOD-009 |
| US-BOD-10 | BOD-010 |
| US-BOD-11 | BOD-011 |
| US-BOD-12 | BOD-002 |
| US-VIN-01 | VIN-001 |
| US-VIN-02 | VIN-002 |
| US-VIN-03 / 04 / 05 | VIN-003 |
| US-COMP-01 / 02 / 03 | COMP-001, COMP-002, COMP-003 |
| US-FIN-01 / 02 | FIN-001, FIN-002 |
| US-SIL-01 | REG-004, REG-005 |
| US-SIL-02 | REG-001, REG-003, REG-006 |
| US-SIL-03 | REG-007, RUN-001, RUN-002 |
| US-SIL-04 | REG-009 |
| US-SIL-05 | REG-011 |
| US-SIL-06 | REG-002, REG-008 |
| US-SISV-01 | REG-012 |
| US-SISV-02 | REG-013, REG-014, REG-015 |
| US-SISV-03 | REG-016 |
| US-EMCS-01 | REG-016 |
| US-EMCS-02 / 03 | REG-017 |
| US-EMCS-04 | REG-018 |
| US-EDI-01 | REG-019 |
| US-EDI-02 | REG-020 |
| US-EDI-03 | REG-021 |
| US-EDI-04 | REG-022 |
| US-INFOVI-01 | REG-023 |
| US-ECO-01 | REG-024, REG-025 |
| US-ECO-02 | REG-026 |
| US-MIG-01 | MIG-001, MIG-002, MIG-006 |
| US-MIG-02 | MIG-003 |
| US-MIG-03 | MIG-004, FIN-001 |
| US-MIG-04 | MIG-005 |
| US-MCP-01 / 02 / 03 | MCP-001, MCP-002, MCP-003, MCP-004 |
| US-ASIS-01 / 02 / 03 | ASIS-001, ASIS-002, ASIS-003 |

Historias posteriores al MVP (M5+): US-FIN-03/04, US-MIG-05/06/07, US-CONTA-01/02, US-MOD-01, US-ETQ-01, US-CONO-01. Se desglosarán en tareas al planificar M6–M7 (no bloquean el MVP).

## 4. Ruta crítica de M1 (gate del 01-12-2026)

`INFRA-001 → CORE-001 → CORE-002 → VFT-001 → VFT-002 → (FACT-001 → FACT-002) → FACT-003 → VFT-003 → INFRA-009 → VFT-004 → VFT-005 → VFT-007`, con `AUTH-001/002/003 → APR-001` en paralelo para la emisión en lote y las anulaciones.
