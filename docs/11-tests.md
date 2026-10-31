# 11 · Estrategia de tests y QA

> Versión 1 · 31-10-2026. Regla de oro: **en CI solo datos sintéticos** (regla dura 0.6). Ningún test depende de datos de `data/`.

## 1. Niveles y herramientas

| Nivel | Qué prueba | Herramienta | Dónde vive | Cuándo corre |
|---|---|---|---|---|
| Unitario | Funciones puras del núcleo (cálculos, normalizaciones, máquinas de estado, renderizadores) | `bun test` | `api/test/unit/**/*.test.ts` | Cada PR |
| Invariantes de BD | Triggers y restricciones (`02-modelo-dominio.md` §19) | `psql` + `docs/02-ddl/tests/invariants_test.sql` (copiado a `api/test/db/`) | `api/test/db/` | Cada PR |
| Propiedades | Conservación, saldos, numeración, totales, genealogía, cuadres | `fast-check` + PostgreSQL de servicio | `api/test/property/**/*.prop.test.ts` | Cada PR (≥ 1.000 casos/propiedad) y nocturno (20.000) |
| Golden files | Salidas regulatorias y documentos byte a byte | `bun test` | `api/test/golden/**` | Cada PR |
| Integración | API + BD real (sintética), permisos, idempotencia, módulos activables, MCP | `bun test` + PostgreSQL de servicio | `api/test/integration/**` | Cada PR |
| Contrato del ejecutor | Protocolo `/api/m2m/runner/*` y procedimientos contra portales simulados | `bun test` + Playwright sobre páginas HTML de prueba | `runner/test/**` | Cada PR que toque `runner/` o `m2m/` |
| E2E | Flujos de usuario en navegador (escritorio y móvil) | Playwright (autenticador virtual WebAuthn) | `ui/e2e/**` | Cada PR (humo) y nocturno (completo) |
| Evals | Agentes de la workforce | `python -m timbal.evals.cli` | `workforce/*/evals/*.yaml` | Cada PR que toque `workforce/` y gate de despliegue en Timbal |
| Preproducción AEAT | Verifactu (y más adelante otros servicios) contra el entorno de pruebas | `bun api/scripts/verifactu-preprod.ts` | — | Manual y nocturno en `staging` (environment protegido) |

## 2. Qué bloquea un merge

Un PR **no** se puede fusionar si falla cualquiera de:
1. `guardrails` (gitleaks, ficheros prohibidos, datos personales).
2. `lint-ts`, `typecheck`, `lint-py`, `typecheck-py`.
3. `unit`, `db-invariants`, `property`, `golden`, `integration`.
4. `evals` (si toca `workforce/`).
5. `e2e-smoke`.
6. Cobertura de líneas por debajo del umbral en los módulos críticos: `api/src/core/billing/**`, `api/src/core/regulatory/**`, `api/src/core/inventory/**`, `api/src/core/cellar/**` ≥ **90 %**; resto de `api/src/core/**` ≥ 80 %.
7. Un *golden file* modificado sin la etiqueta `golden-update` y sin revisión de Opus (§13).
8. Lista de comprobación del PR incompleta (plantilla `.github/pull_request_template.md`).

## 3. Convenciones de los tests unitarios
- Nombre: `<función>.test.ts`, `describe('<función>')`, casos `it('<condición> → <resultado esperado>')` en español.
- Sin red ni reloj real: `api/src/core/time.ts` se inyecta (`Clock`); fechas fijas en Europe/Madrid, incluidos los días de cambio de hora (último domingo de marzo y de octubre).
- Dinero con `Decimal`; las comparaciones de importes, siempre como cadenas con 2 decimales.
- Prohibido "vaciar" un caso con mocks: los mocks solo se permiten para fronteras externas (AEAT, Timbal, CVBOT).

## 4. Invariantes de base de datos
`invariants_test.sql` (16 bloques a 31-10-2026) se ejecuta en un PostgreSQL 16 de servicio tras aplicar todas las migraciones. Cada invariante nuevo del modelo debe añadir su bloque (prueba negativa con su código `WCnnn` y prueba positiva).

## 5. Tests de propiedades (obligatorios)

| ID | Propiedad | Generador | Comprobación |
|---|---|---|---|
| P-01 | **Conservación de volumen**: para toda secuencia válida de operaciones de bodega, Σ entradas = Σ salidas + Σ mermas + existencias, por lote y por recipiente, en cada instante | Secuencias aleatorias de recepción, prensado, fin de FA, trasiego, ensamblaje, envasado, etiquetado, merma, con volúmenes aleatorios coherentes | Recalcular saldos desde el libro y comparar con la suma por tipo |
| P-02 | **Nunca saldo negativo**: cualquier operación que dejaría un saldo negativo en cualquier fecha se rechaza (`WC024`) y no deja rastro | Secuencias con operaciones inválidas intercaladas y fechas pasadas | El libro tras la secuencia = libro con solo las válidas |
| P-03 | **Un lote por recipiente y capacidad** | Trasiegos a recipientes ocupados o llenos | Rechazo con `WC026`/`WC025` |
| P-04 | **Numeración sin huecos con concurrencia**: N emisiones concurrentes (con fallos aleatorios) producen números consecutivos sin repetición | 2–20 tareas concurrentes, 0–30 % de fallos | Conjunto de números = {1..k} |
| P-05 | **Totales de factura**: para líneas y tipos aleatorios, `total = Σ base + Σ cuota + Σ recargo − Σ retención`, con redondeo por grupo; recalcular desde `invoice_tax` da lo mismo | Líneas con cantidades y precios con hasta 6 decimales | Igualdad exacta |
| P-06 | **Reglas D3 deterministas**: cliente > canal > defecto | Conjuntos de reglas aleatorios | Coincide con un oráculo simple |
| P-07 | **Genealogía acíclica y completa** | Ensamblajes y envasados aleatorios | Sin ciclos; todo lote envasado alcanza al menos un lote de origen |
| P-08 | **Identidad físico–fiscal** (I-17): `salidas físicas − salidas fiscales = albaranes sin facturar − facturas sin salida` en el perímetro fiscal | Albaranes, facturas y regla fiscal (`invoice`/`delivery_note`) aleatorios | Igualdad por producto y lote |
| P-09 | **Cadena Verifactu**: cada registro enlaza con la huella del anterior y recalcular las huellas desde los datos guardados da las mismas | Emisiones y anulaciones aleatorias | Igualdad de huellas |
| P-10 | **Cuadre SISV ↔ SILICIE**: envasados y salidas del periodo coinciden en ambos | Operaciones y salidas aleatorias (con trasiegos que solo van a SISV) | Diferencias = 0 |

## 6. Reglas de la administradora convertidas en tests (R11)

| Test (nombre en código) | Regla (fuente: traspaso, mes del correo) |
|---|---|
| `silicie.racking_generates_no_entry` | Los trasiegos internos no van a SILICIE, sí a SISV (ago/oct-2026) |
| `silicie.bottling_generates_entry_with_loss` | Los envasados van a SILICIE con su merma (oct-2026) |
| `silicie.consignment_exit_waits_for_invoice` | Lo enviado con albarán a un operador se declara al facturar, con esa fecha (regla por defecto D2) |
| `silicie.ead_exit_carries_arc` | Las salidas con e-DA llevan el ARC (oct-2026) |
| `silicie.destruction_as_storage_loss` | Las destrucciones se declaran como "mermas de almacenamiento" (dic-2025) |
| `silicie.file_alcohol_three_decimals` | Alcohol con 3 decimales; fechas sin huecos (dic-2025) |
| `silicie.no_negative_balance_in_period` | Ningún saldo negativo en el periodo presentado (ago-2026) |
| `reconcile.sisv_equals_silicie_outputs_and_bottlings` | "SISV y SILICIE tienen que ser lo mismo" (ago-2026) |
| `sisv.vessel_zero_after_full_bottling` | Un depósito embotellado entero queda a 0 (oct-2026) |
| `billing.draft_not_exportable` | Un borrador no se envía ni va a la asesoría (sep/oct-2026) |
| `billing.number_taken_only_on_issue` | El número se fija al emitir, sin intervención manual (incidente oct-2026) |
| `billing.intercompany_dated_last_day_of_period` | La factura P.O → CVPO lleva fecha del último día del periodo (sep-2026) |
| `billing.intercompany_mirrored_as_expense_in_cvpo` | La factura intercompañía se registra también como gasto en CVPO (sep-2026) |
| `billing.samples_credit_note` | Abono por muestras comerciales con su motivo (sep-2026) |
| `edi.invoice_matches_portal_form` | Lo tecleado en AecocEDI coincide con la factura de WineCore (proceso ECI) |

## 7. Datos sintéticos
- Generador determinista `api/db/synthetic.ts --seed <n> --size small|x10`: 2 entidades ficticias (NIF ficticios con letra válida), 60 contactos (personas y empresas), 30 productos (8 vinos × añadas × formatos), 40 recipientes, un año de operaciones de bodega, 400 facturas, 400 albaranes, 300 gastos, cobros parciales, 4 envíos regulatorios.
- Los nombres se generan de listas inventadas; los NIF ficticios se añaden a `.github/pii-allowlist.txt` si el detector los marca.
- Staging y dev se cargan **solo** con este generador (nunca copias de producción).
- Ficheros Holded sintéticos para la migración: `api/test/fixtures/makeHoldedFixtures.ts` reproduce cabeceras exactas, filas de informe y sello final (`06-migracion.md` §14).

## 8. Integración: casos obligatorios
- **Permisos**: para cada ruta y herramienta MCP, un test por rol permitido (200) y uno no permitido (403), generado desde la matriz de `07-arquitectura.md` §6.
- **Módulos**: con el módulo desactivado, rutas → 404 `WC_MODULE_DISABLED`; herramientas MCP ausentes en `tools/list`; jobs no se ejecutan.
- **Idempotencia**: repetir una escritura con la misma `Idempotency-Key` devuelve la misma respuesta; con otro cuerpo → 409.
- **MCP**: confirmación de dos pasos (token caducado, reutilizado, de otro cliente, con datos cambiados → error); ninguna herramienta prohibida en el catálogo (`13-mcp.md` §6).
- **Aprobaciones**: sin verificación reforzada → 401 `WC_STEP_UP_REQUIRED`; hash distinto → `WC040`; doble consumo imposible.
- **Ejecutor**: dos ejecutores reclamando a la vez obtienen trabajos distintos; un *lease* vencido deja el intento `expired` y exige `check_status`.

## 9. Golden files

| Carpeta | Contenido | Regeneración |
|---|---|---|
| `api/test/golden/verifactu/` | XML de alta, anulación y subsanación; vectores de huella (incluidos los ejemplos oficiales de la AEAT); URL del QR | Solo con `golden-update` + revisión de Opus |
| `api/test/golden/silicie/` | Fichero de carga del periodo (CSV/XML según `silicie.md`) para un escenario sintético | Ídem |
| `api/test/golden/sisv/` | Ficheros de importación por libro | Ídem |
| `api/test/golden/infovi/` | XML de declaración | Ídem |
| `api/test/golden/emcs/` | Plan de formulario del e-DA (JSON) | Ídem |
| `api/test/golden/edi/` | Pedido parseado, ficha de factura, aviso de pago | Ídem |
| `api/test/golden/pdf/` | Facturas ES/EN: texto extraído + imagen de referencia por página (comparación visual con tolerancia 0,1 %) | Ídem |
| `api/test/golden/exports/` | Libros de IVA emitidas/recibidas | Ídem |

Los PDF se generan con fecha de creación fija en modo test para ser reproducibles.

## 10. E2E y QA visual (§12.7)
- Flujos de humo (cada PR): entrar (sesión de prueba), crear y emitir una factura, aprobar un lote con passkey virtual, registrar un envasado, consultar existencias a fecha, ver una trazabilidad.
- Completo (nocturno): todos los flujos de las historias del hito en curso.
- **Escritorio** 1440×900 y **móvil** 390×844: capturas por pantalla comparadas con las de referencia (tolerancia 0,2 %); la revisión visual de cambios la hace el agente padre y, en cada hito, CVBOT con *computer use* sobre `staging`.
- Accesibilidad: `@axe-core/playwright` sin violaciones "serious/critical" en los flujos principales.

## 11. Evals de la workforce
| Miembro | Eval | Umbral |
|---|---|---|
| `ocr-gastos` | 30 facturas sintéticas (PDF e imagen): proveedor, número, fechas, base, IVA, total | ≥ 95 % de campos correctos; 0 totales incorrectos aceptados sin aviso |
| `asistente` | 20 preguntas de inspección y cobros sobre datos sintéticos | Respuestas con las cifras exactas de la API; nunca inventa; nunca intenta aprobar |
| `regulatorio-*` | Recorrido preparar → aprobar → encolar con aprobación simulada | Secuencia exacta de pasos (`seq!`) |
| `vendimia-campo` | 15 notas de voz transcritas (sintéticas) | Herramienta y campos correctos ≥ 90 % |
| `resumen-diario` | 5 días sintéticos | ≤ 10 líneas; incluye todas las alertas del día |

## 12. Preproducción de la AEAT (gate M1)
Batería de casos de `04-regulatorio/verifactu.md` (alta F1, F2, rectificativas S e I, anulación, subsanación, envío con varios registros, errores esperados) ejecutada contra el entorno de pruebas con un certificado reconocido. Resultado firmado en `docs/qa/M1-verifactu-preprod.md` con CSV de cada envío. Es la condición del gate del 01-12-2026.

## 13. QA por hito y revisión de Opus
Cada hito pasa, en `staging` con datos sintéticos:
1. Todos los tests automáticos en verde.
2. QA funcional y visual: Playwright completo + recorrido con *computer use* de CVBOT siguiendo las historias del hito; informe en `docs/qa/M<x>.md`.
3. **Revisión de Opus** de los cambios críticos (regulatorio, fiscal, contable, migración, seguridad; criterios de §7.3): un PR no se fusiona en `staging` sin el comentario de revisión de Opus aprobando esos ficheros.
4. Demo a Pedro y aprobación del PR `staging` → `main`.

## 14. Seguridad
- Escaneo de dependencias (`osv-scanner`) semanal y en cada PR que cambie *lockfiles*.
- Test de cabeceras (CSP, HSTS…) en integración.
- Test de que ningún log contiene NIF, IBAN, email o teléfono (se inyectan valores trampa y se buscan en la salida).

## 15. Copias y recuperación
Trimestral: restaurar el último PITR de producción en una base temporal **privada**, ejecutar `audit.verify_chain()`, comprobar recuentos por tabla y borrar la base; resultado en `docs/qa/restauracion-<fecha>.md` (sin datos).
