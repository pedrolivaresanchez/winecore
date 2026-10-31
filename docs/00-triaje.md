# 00 · Triaje crítico (Fase 0)

> Versión 1 · 31-10-2026 · Autor: especificador (Fase 1).
> Fuentes: `MASTER_PLAN.md` v3 (la §12 prevalece), contexto adjunto (transcripción de la reunión, resumen de HappyScribe, handover de la administradora saliente, especificación previa, informe consolidado, mapeo Holded/Bacosoft, resumen de datos) y los exports reales de Holded y Shopify analizados en local.
> Convención: **HECHO** (con fuente y fecha) · **SUPUESTO** · **PENDIENTE**. Las marcas `[hh:mm:ss]` remiten a la transcripción de la reunión del 31-10-2026 (Hablante 1 = Pedro, dueño de producto; Hablante 2 = titular de P.O).
> **Privacidad**: el repo es público a 31-10-2026 (ver Q-001). Este documento no contiene datos personales, importes ni identificadores fiscales salvo el NIF societario de CVPO, que es público. Los datos originales están en `data/` (fuera de git).

## 1. Resumen de lo entendido

**El negocio.** Bodega ecológica pequeña en la Sierra de Segura (Jaén) que produce menos de 1.000 hl al año, con mínima intervención (solo SO2 y ácido tartárico, fermentaciones espontáneas, todas las elaboraciones con maloláctica). Opera con dos entidades: **P.O** (persona física, autónomo; bodega productora, fábrica de vino con CAE y libros en SISV) y **CVPO** (S.L., B97749790; comercializadora). P.O vende a CVPO con una tarifa intercompañía validada por el asesor (D4) y también factura directamente algunos canales (El Corte Inglés, exportación con e-DA). Hay stock en la bodega, en la tienda y en operadores logísticos externos (TFRP, Ecovitis, Grupamar, Valencia).

**El problema.** El stock vive en cuatro sitios que no cuadran (bodega, SISV, SILICIE, Holded y un Excel personal). SILICIE se prepara a mano en Excel y se sube como CSV; SISV se rellena a mano; las facturas de El Corte Inglés se teclean una a una en AecocEDI para cobrar; la factura intercompañía se hace a mano; ha habido errores de numeración en Holded. La administradora deja la empresa y se abandonan Holded y Shopify.

**El objetivo.** WineCore: un núcleo propio (no un ERP genérico) que sea la fuente de verdad de trazabilidad (parcela → uva → mosto → vino → botella), stock físico y fiscal, comercial, facturación con Verifactu, cobros y obligaciones regulatorias, desplegado en Timbal (org 122), con MCP de primera clase para que CVBOT opere el sistema desde el chat y con aprobación humana en todo envío a terceros.

**Lo que fija el plan.** M1 = facturación de CVPO con Verifactu en preproducción de la AEAT antes del **01-12-2026** (gate de plan B). Después: albaranes, dos stocks (físico por albarán, fiscal por factura) y SILICIE; luego SISV, EMCS y EDI; al final contabilidad y migración histórica. Las integraciones regulatorias empiezan por *computer use* con conector intercambiable (§12.1), **salvo Verifactu**, que por su naturaleza legal necesita servicio web o firma (ver C-21 y Q-002).

## 2. Hechos nuevos obtenidos de los exports (31-10-2026, análisis local, sin datos personales)

| # | Hecho | Fuente | Consecuencia |
|---|---|---|---|
| H1 | CVPO emitió entre 183 y 256 facturas al año (2022–2025) y 128 en 2026 hasta el 23-10. P.O emitió entre 92 y 98 al año. | `data/holded/*/ventas/*Ingresos*.xlsx` | **S3 del plan es falso**: el volumen es ~4 veces menor (≈250 + ≈100 facturas/año). Refuerza el MVP sencillo (R8). |
| H2 | CVPO registra ~335–375 albaranes al año; **851 albaranes figuran como "Pendiente" de facturar** desde 2022 y 28 "Parcialmente". | `…Albaranes….xlsx` | Muchos albaranes de valoración nunca se facturaron o se abandonaron. No se migran como abiertos sin revisión (ver `06-migracion.md`). |
| H3 | Numeración: desde 2023 `F`+AA+NNNN (facturas), `CN`+AA+NNNN (rectificativas), `A`+AA+NNNN (albaranes CVPO). En 2026 hay **saltos** (la serie F26 de CVPO llega a 247 con 108 facturas) y **sufijos** `-1`; una factura de 2024 lleva serie F25. | idem | Confirma el incidente de numeración del 23-10-2026. Series nuevas desde 2027 (Q-015) y numeración sin huecos bloqueada en base de datos. |
| H4 | 42 % de los contactos de CVPO no tiene NIF; 3 NIF duplicados en CVPO y 7 en P.O; 30 NIF compartidos entre ambas entidades. | `…Contactos.xlsx` | Deduplicación por NIF y nombre normalizado; facturas completas exigen NIF del destinatario (validación al emitir). |
| H5 | Todos los contactos tienen "Régimen general", pero hay facturas con recargo de equivalencia. | Contactos e Ingresos | El régimen se fijaba a mano por factura; WineCore lo guarda en el cliente y lo valida. |
| H6 | Ambas entidades emiten **facturas de arrendamiento con retención de IRPF** (34 en CVPO, 61 en P.O). | Ingresos (cuenta "Ingresos por arrendamientos") | Facturación de servicios con retención en el MVP (M1). |
| H7 | El 58 % de las líneas de venta de CVPO y el 68 % de las de P.O no tienen SKU (texto libre, ~500–700 descripciones distintas). | `Ventas Exportar items.xlsx` | La migración de líneas históricas no puede vincular producto de forma fiable: el histórico se migra como documento de archivo (PDF + cabecera), no como movimientos de stock. |
| H8 | Los productos de Holded **no tienen coste** (coste 0) ni lotes; P.O tiene 38 productos y CVPO 45. | `…Productos.xlsx` | El control "no vender bajo coste" necesita costes que hoy no existen (Q-017). El stock inicial por lote sale del aforo físico, no de Holded. |
| H9 | La contabilidad de Holded tiene **balances de sumas y saldos anuales 2022–2026** cuadrados (Debe = Haber) para ambas entidades, pero solo con cuentas de grupos 2, 4, 5, 6 y 7 (sin capital, sin existencias). | `contabilidad/cuadro_de_cuentas_20xx.xlsx` | **Contradice** `data_summary.md` ("solo 2026"). La contabilidad oficial la lleva la asesoría (Q-022). |
| H10 | No se usa FACe (todas "No enviado"). | Ingresos | FACe queda fuera del MVP. |
| H11 | Shopify: 2.305 clientes, pero solo **133 con pedidos** y 114 con consentimiento de marketing; 168 pedidos (2022–2026), 18 de TPV; impuestos registrados a 0; sin SKU ni códigos de barras; envíos a DE, DK, FR y NL. | `data/shopify/*` | Minimización RGPD (Q-023); revisar ventas a distancia a la UE (Q-018); los GTIN hay que obtenerlos de AECOC (Q-024). |
| H12 | CVPO vendió a clientes de Francia, Dinamarca, Alemania, Italia, Suiza y EE. UU.; P.O a Reino Unido, Alemania, Suiza y Austria. | Líneas de venta | Hay operaciones intracomunitarias y exportaciones en ambas entidades (Q-019, R16). |
| H13 | Los PDF de facturas (~2.900) y el Excel maestro de SILICIE/SISV **no están** en los adjuntos. | Inventario de `uploads/` | La vinculación de PDF se especifica (`06-migracion.md`) pero no se puede probar con datos reales todavía. |

## 3. Contradicciones y huecos

| # | Contradicción o hueco | Fuente A | Fuente B | Impacto | Resolución / pregunta |
|---|---|---|---|---|---|
| C-01 | El stock se descuenta con la **factura**, no con el albarán | Reunión [00:50:42] | Handover: salidas a TFRP por albarán; correos de cuadre de palets | Alto | **Resuelto por D2** (dos stocks). Queda la fecha legal de la salida fiscal (C-28, Q-010). |
| C-02 | "SIF/CIF" frente a "SISV" | Reunión [00:02:10], [00:08:30], [00:09:46], [01:03:39] | Handover, plan §5.2 | Bajo | **Resuelto por D5**: SISV. |
| C-03 | "AEVOQ" / "iBook EDI" frente a AecocEDI | Reunión [00:02:10], [01:05:49] | Plan §5.3 | Bajo | **Resuelto por D9**: AecocEDI. |
| C-04 | ¿Quién factura a El Corte Inglés? | Reunión [01:05:39]: P.O está dado de alta | Informe consolidado y handover: "CVPO vende a ECI"; cuenta de transporte de CVPO para envíos a ECI desde Valencia | Medio | **Q-009**. Por defecto P.O (regla por cliente). |
| C-05 | Descuento intercompañía 80 % o 60 % | Reunión [01:02:11] | Handover: tarifa 2026 −60 % (2025 −80 %) | Bajo | **Resuelto por D4**: tarifa versionada con vigencia. |
| C-06 | Periodicidad intercompañía: mensual o trimestral | Reunión [01:01:00], [01:02:11]: mensual | Handover: "fecha último día del trimestre"; plan §5.4: mensuales que "se cierran por trimestre" | Medio | **Q-016**. Por defecto mensual. |
| C-07 | Ajustes de fin de año entre entidades para reducir IRPF/IS | Reunión [01:03:39] | D4: WineCore "sin lógica fiscal propia" | Medio | WineCore **no** ofrece simulaciones fiscales; los ajustes son documentos normales con tarifa vigente y aprobación. |
| C-08 | SILICIE: anotar "en el día o al día siguiente" frente a "2 declaraciones al año" | Reunión [01:00:09] (ambas cosas en la misma intervención) | Especificación previa: "se suele citar 4 días hábiles" | Alto | **Q-011** y `04-regulatorio/silicie.md` (verificación normativa). WineCore genera asientos al día en cualquier caso. |
| C-09 | Junta: "comunicaciones mensuales" frente a frecuencia desconocida | Reunión [01:03:39]–[01:05:07] | Plan §5.2: PENDIENTE | Medio | **Q-012** y `04-regulatorio/sisv.md`. |
| C-10 | Formatos: 0,25 / 0,5 / 0,75 / 1,5 L frente a BIB | Reunión [00:42:45] | Handover (palets de BIB en Ecovitis) | Medio | **Q-020**: el catálogo de formatos incluye BIB. |
| C-11 | Nombres de depósitos: "Inox 1–32 / Inox B1–B7" frente a "D1, D2, D3" | Reunión [00:11:16] | Handover (SISV y Excel de aforo) | Medio | **Q-020**: código propio + código SISV como atributo. |
| C-12 | Volumen de facturas | Plan S3: ~1.000 CVPO y ~500 P.O al año | Export Holded (H1): ~250 y ~100 | Bajo (favorable) | Se corrige S3. |
| C-13 | Contabilidad disponible | `data_summary.md`: "solo 2026" | Export (H9): sumas y saldos 2022–2026 | Bajo | Se usa como validación en la migración. |
| C-14 | Nº de contactos (256/220) | `data_summary.md` | Export: 255/219 filas de datos | Nulo | El resumen contó la cabecera. |
| C-15 | Reino Unido tratado como UE | Plan §5.1: "las salidas a la UE llevan el nº de e-DA (distribuidor UK)" | Reino Unido es tercer país desde 2021 | Alto (IVA y aduanas) | Es **exportación** (exención art. 21 LIVA, DUA de exportación). Canarias tampoco es territorio IVA. **Q-019**. |
| C-16 | Certificado digital "enchufado al bot" | Reunión [00:02:52] | Reglas 0.2, D8, R7 | Crítico | El agente **nunca** tiene el certificado (ADR 003). |
| C-17 | Envío automático de facturas por correo | Reunión [00:57:13] | Reglas 0.4 y 0.5 | Medio | **Decisión de Pedro (31-10-2026)**: envío automático al emitir **a través de CVBOT** desde el Outlook de Pedro (WineCore no envía correos): estado "pendiente de envío", registro de envíos, aviso si no se marca enviada en X horas y reenvío. Sin buzón ni Microsoft Graph. Las presentaciones a organismos siguen con revisión humana. |
| C-18 | "El bot puede gestionar el cobro con el cliente" | Reunión [00:57:13] | Regla 0.5 | Medio | El agente prepara el borrador del recordatorio; lo envía una persona. |
| C-19 | Calendario: el titular quiere seguir con el sistema actual hasta fin de año; Pedro, antes | Reunión [00:03:55], [00:04:24] | Verifactu CVPO 01-01-2027 | Alto | Encaja con el plan B (R1/R12): gate el 01-12-2026. |
| C-20 | Integración regulatoria por XML/servicio web | Plan §3.4, §6.1 (golden files XML); especificación previa (IESA1V2, IE815) | §12.1: *computer use* primero | Medio | **Prevalece §12.1**. Los *golden files* se aplican a los datos canónicos que genera el núcleo (CSV/JSON/XML), sea cual sea el conector. |
| C-21 | Verifactu por *computer use* | §12.1 incluye Verifactu en la lista | RD 1007/2023: remisión automática por el propio sistema (ver `04-regulatorio/verifactu.md`) | **Crítico** | **Q-002/Q-003**: Verifactu va por servicio web (o NO VERI*FACTU con firma). |
| C-22 | "Solo Timbal" frente a la web nueva en otra plataforma | Plan §3.1 | Informe: web nueva ya construida en otra plataforma con Stripe | Bajo | La tienda web queda **fuera** de WineCore; WineCore solo recibe sus pedidos (webhooks de Stripe). |
| C-23 | Deduplicar 2.305 clientes de Shopify | Plan §6.1 | H11: 133 con pedidos | Bajo | **Q-023**. |
| C-24 | DESADV/INVOIC por EDI | Especificación previa RF4.5 | Plan §5.3: no hay evidencia de DESADV | Medio | Pendiente del detalle de Pedro (§12.3, Q-024). |
| C-25 | "Productos por lote" en Holded | Handover | Export: sin lotes ni costes (H8) | Medio | El lote nace en WineCore desde el aforo. |
| C-26 | Entidad de la tienda web | Shopify: marca de P.O como vendedor | Informe: "Stripe a nombre de P.O o CVPO por decidir" | Medio | **Q-018**. |
| C-27 | CVPO "tendrá" almacén propio | Plan §2 | Export: CVPO ya tiene un almacén con stock en Holded | Medio | **Q-021**. |
| C-28 | Fecha fiscal de las salidas | D2 y correos: "la barrera es la fecha de facturación" | Ley 38/1992: devengo en la salida de fábrica (ver `04-regulatorio/silicie.md`) | **Alto** | **Q-010**. Ambas fechas se guardan; la regla es configurable (por defecto D2). |
| C-29 | Ventas B2B a la UE de CVPO con impuesto pagado | Export (H12) | Desde 2024, la circulación intracomunitaria con impuesto pagado va por EMCS (en verificación) | Alto | **Q-019**, riesgo R16. |
| C-30 | Ventas a consumidores de la UE por la web | Export Shopify (H11) | II.EE. en destino y OSS de IVA | Medio | **Q-018**. |
| C-31 | Nombres de "Pedro" | Plan: "Pedro" aprueba | Reunión: el titular de P.O es Hablante 2 | Medio | **Q-005**: aprobadores explícitos por entidad y trámite. |
| C-32 | Trasiegos y SILICIE | Regla operativa: "los trasiegos no van a SILICIE" | SILICIE 2.0 (desde 01-01-2025): el vino en barrica y el de depósito son **mayores distintos** y los pasos entre ellos se anotan uno a uno (seminario AEAT 21-07-2025) | **Alto** | Entre depósitos, sin asiento; depósito ↔ barrica, A17/A16 + mermas A30 (`silicie.md` §5). Revisar cómo se anotaron en 2025–2026 (R24). |
| C-33 | Permanencia en VERI*FACTU | Ayuda de Holded: "hasta el 31 de diciembre del año siguiente" | RRSIF art. 16.5 y Orden HAC/1177/2024 art. 17.2: hasta el 31 de diciembre **del año** del primer envío | Medio | Corregido en Q-008; el asesor confirma que cambiar de Holded a WineCore no es renuncia. |
| C-34 | Fecha de la factura intercompañía | Especificación inicial: "factura con fecha 31 del mes" | RD 1619/2012 arts. 11 y 13: recapitulativa con fecha de **operación** fin de mes y **expedición** real antes del día 16 | Medio | Corregido en PRD (US-FACT-09), modelo §12.6 y `verifactu.md` §14. |

## 4. Riesgos

Los R1–R12 son los del plan (§9), revisados; R13–R25 son nuevos de este triaje. Estado a 31-10-2026.

| ID | Riesgo | Prob. | Impacto | Mitigación / plan B | Estado |
|---|---|---|---|---|---|
| R1 | Verifactu de CVPO no listo para el 01-01-2027 | Alta | Crítico | M1 solo facturación CVPO + Verifactu; gate 01-12-2026; plan B (Q-008). Aprobación rápida de esta especificación. | Abierto |
| R2 | Responsabilidad como productor del software Verifactu | Media | Alto | Declaración responsable (Q-007), checklist de requisitos en `04-regulatorio/verifactu.md`, revisión del asesor. | Abierto |
| R3 | SISV sin API: *computer use* frágil | Alta | Medio | Conector intercambiable, capturas como evidencia, aprobación por envío, cuadre semanal. | Abierto |
| R4 | AecocEDI solo web; términos de uso | Media | Medio | Ficha para teclear como respaldo; consultar términos (Q-024). | Abierto |
| R5 | Descuadres heredados (operador logístico, depósito, embotellado sin declarar, venta pendiente) | Alta | Alto | Aforo físico antes de cargar stock; regularización con motivo; no migrar movimientos de SISV/SILICIE (Q-013). | Abierto |
| R6 | Histórico contable tarde (D7) | Media | Medio | El arranque no depende de él; saldos de apertura del asesor. | Abierto |
| R7 | Custodia del certificado en la nube | Media | Crítico | ADR 003: certificado dedicado (preferible sello de CVPO) como secreto de un entorno propio de Timbal (`verifactu`) donde solo corre el emisor, lejos de los agentes; el certificado de P.O no sale del equipo del ejecutor local (Q-006). | Abierto |
| R8 | Sobredimensionar para 1–3 usuarios | Media | Medio | MVP estricto; H1 confirma volúmenes bajos. | Abierto |
| R9 | Coste de agentes (escalados a Opus) | Media | Medio | Criterios §7.3; coste visible en PROGRESS. | Abierto |
| R10 | Doble remoto o despliegue doble | Media | Medio | Un solo mecanismo (ADR 001 Plan A o B; ADR 007) + job diario de comparación de SHA. **Agravante confirmado**: el Composer de Timbal ya hizo un commit por su cuenta en el proyecto 3942 (`f89f339`); se prohíbe el Composer en ramas de entorno. | Abierto |
| R11 | Pérdida del know-how de la administradora | Alta | Alto | Sus reglas convertidas en casos de test (ver `11-tests.md` §6). Pedir el Excel maestro antes de su salida. | Abierto |
| R12 | El titular quiere seguir con el sistema actual hasta fin de año | Media | Medio | Encaja con el plan B; decisión el 01-12-2026 con datos. | Abierto |
| **R13** | La fecha fiscal por factura (D2) difiera de la salida física y una inspección encuentre menos stock del contabilizado | Media | Alto | Doble fecha guardada, regla configurable, informe permanente de diferencias, confirmación escrita del asesor (Q-010). | Nuevo |
| **R14** | Repo público: exposición de datos y de la arquitectura de seguridad | **Alta (hecho)** | Alto | Pedro decide mantenerlo público de momento (Q-001, 31-10-2026): todo se sube anonimizado; gitleaks, bloqueo de `data/` y detector de datos personales en CI; revisar la decisión antes del primer código de M0. | **Aceptado y vigilado** |
| **R15** | Interpretar que Verifactu puede hacerse por *computer use* | Media | Crítico | Q-002/Q-003; documentación normativa citada. | Nuevo |
| **R16** | Ventas intracomunitarias con impuesto pagado y ventas a distancia sin documento EMCS ni representante fiscal | Media | Alto | Q-018/Q-019; restringir países en la web; validar con el asesor. | Nuevo |
| **R17** | Calidad de datos de Holded (sin NIF, sin SKU, saltos de numeración, albaranes huérfanos) | Alta (hecho) | Medio | Migración con *dry-run*, informes de calidad y decisiones explícitas (`06-migracion.md`). | Nuevo |
| **R18** | Sin costes no se puede controlar la venta bajo coste | Alta (hecho) | Medio | Coste estándar por producto (Q-017). | Nuevo |
| **R19** | Capacidades de Timbal no documentadas (base de datos transaccional, *computer use*, autenticación de la app, conexión con GitHub) | Media | Alto | ADR 002/005/007/008 con alternativas mínimas; preguntas en Q-004. | Nuevo |
| **R20** | Plazo de M1 (4 semanas con infraestructura) y latencia de aprobación de esta especificación | Alta | Crítico | Backlog de M0/M1 paralelizable sin ficheros solapados; aprobación de la especificación en 48–72 h. | Nuevo |
| **R21** | Aprobaciones desde el chat vulnerables a inyección de instrucciones | Media | Alto | Aprobación solo en la web con passkey/TOTP (Q-005); el MCP no expone herramientas de aprobación. | Nuevo |
| **R22** | Factura electrónica B2B obligatoria (RD 238/2026 y Orden HAC/1028/2026, en vigor el 06-10-2026): ECI desde 06-10-2027; P.O y CVPO desde 06-10-2028 (estados de P.O desde 06-10-2029) | **Alta (hecho)** | Medio | Hito M8 (UBL por la solución pública de la AEAT o plataforma conforme); recepción de cargos de ECI a confirmar con el asesor (Q-032). | Abierto (verificado) |
| **R23** | Un único aprobador disponible (vacaciones, enfermedad) | Media | Medio | Al menos dos aprobadores por entidad (Q-005). | Nuevo |
| **R24** | Asientos SILICIE de 2025–2026 sin los pasos depósito ↔ barrica que exige SILICIE 2.0 (C-32), y comunicación de cierre del ejercicio 2025 que vence ahora (31-10-2026, sábado → primer día hábil siguiente; si no, cierre de oficio) | Media | Alto (inspección) | Pedro lo comprueba con la administradora; si faltan asientos, corrección con A42/A43 o en el ejercicio abierto con el asesor; WineCore los genera solos desde 2027 | Nuevo |
| **R25** | Plazo de Verifactu aplazado a 2028 por nota de prensa (05-10-2026) pero no publicado en el BOE | Media | Medio | Se planifica con el BOE (CVPO 01-01-2027); vigilante `boe-watch` (TASK-REG-010); si se publica, Pedro decide si arrancar igualmente (ADR 004) | Nuevo |

## 5. Supuestos del plan (§9) revisados

| ID | Supuesto | Estado tras el triaje |
|---|---|---|
| S1 | La AEAT ofrece servicios web de SILICIE utilizables por un pequeño productor | Irrelevante a corto plazo por §12.1 (*computer use* sobre la carga de fichero actual). Documentado en `04-regulatorio/silicie.md`. |
| S2 | TFRP es almacén de CVPO o en depósito, no depósito fiscal | **Sin confirmar** (Q-010, Q-021). |
| S3 | ~1.000 facturas/año CVPO y ~500 P.O | **Falso** (H1): ~250 y ~100. |
| S4 | Timbal soporta CI con token y entornos por rama | **Parcial**: entornos por rama sí (documentación); el CLI no tiene modo no interactivo y la credencial es una API key personal que abarca todas las organizaciones del usuario. El proyecto 3942 ya existe (entorno Main 4165) y la conexión con GitHub existe en la UI (Pedro), con comportamiento por verificar (ADR 001, V1–V7). |

## 6. Preguntas bloqueantes

La lista completa, con opciones, recomendación y fecha límite, está en [`QUESTIONS.md`](QUESTIONS.md). Orden de prioridad:

1. **Q-001** Repo público — **respondida** (31-10-2026): se mantiene público de momento; todo sigue anonimizado.
2. **Q-004** Proyecto Timbal (ya existe: 3942 / Main 4165), conexión con GitHub y credenciales — **en curso** (04-11-2026).
3. **Q-002 / Q-003** Verifactu: servicio web y aprobación en la emisión (05-11-2026). Sin respuesta: se aplica la recomendación como supuesto.
4. **Q-005** Aprobadores y canal de aprobación (05-11-2026). Sin respuesta: se aplica la recomendación como supuesto.
5. **Q-006** Certificado y custodia: aplazada por Pedro al final (como tarde 15-12-2026; solo bloquea producción).
6. **Q-008** Plan B (01-12-2026) y **Q-007** productor del software (15-12-2026).
7. **Q-010 / Q-013 / Q-020 / Q-021** para M2 (diciembre de 2026).

Todo lo demás tiene un valor por defecto documentado y no bloquea.

## 7. Propuesta de alcance del MVP y fechas (detalle en `09-roadmap.md`)

- **M0 Fundaciones** (04-11 → 13-11-2026): repo privado, proyecto Timbal, CI, base de datos y migraciones, autenticación, auditoría, numeración, módulos activables, esqueleto de UI y MCP.
- **M1 Facturación CVPO + Verifactu** (09-11 → 30-11-2026; **gate 01-12-2026**): contactos y catálogo de CVPO, reglas de entidad facturadora, facturas y rectificativas, PDF con QR, registros Verifactu encadenados y envío a preproducción, bandeja de aprobaciones, MCP de facturación. Puesta en producción el 01-01-2027 si pasa el gate.
- **M2 Albaranes, dos stocks, bodega mínima y SILICIE** (enero–febrero de 2027): aforo inicial, depósitos y lotes, envasado y mermas, conciliación físico/fiscal, facturación de P.O e intercompañía, asientos SILICIE.
- **M3 SISV, EMCS y AecocEDI** por *computer use* (marzo–abril de 2027).
- **M4 Bodega completa** antes de la vendimia de 2027 (recepción de uva, fermentaciones, analíticas, genealogía DAG).
- **M5 Verifactu de P.O en producción** antes del 01-07-2027 (gate 01-06-2027).
- **M6 Cobros y tesorería**; **M7 Contabilidad y migración histórica**.

## 8. Qué se publica y qué no (mientras el repo sea público)

| Se sube a git | No se sube nunca |
|---|---|
| Especificación anonimizada (`docs/`), resumen anonimizado del contexto (`context/`), esquemas de los exports (cabeceras y tipos), datos **sintéticos** de test | `data/` (exports reales, PDF, contexto original), `.env`, certificados, credenciales, el CAE, NIF de personas, nombres/correos/teléfonos de terceros, importes reales de facturación |
