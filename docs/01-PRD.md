# 01 · PRD — WineCore

> Versión 1 · 31-10-2026. Decisiones aplicadas: D1–D9 y §12 del plan. Modelo: `02-modelo-dominio.md`; estados: `03-maquinas-estado.md`; regulatorio: `04-regulatorio/`; pantallas: `08-ui/`; hitos: `09-roadmap.md`; tareas: `10-backlog/`.
> Cada historia tiene un identificador `US-<MÓDULO>-NN`, el hito en que se entrega y criterios **Dado / Cuando / Entonces** verificables. Cada tarea del backlog apunta a una o más historias.

## 1. Visión

WineCore es el sistema interno de la bodega y de su comercializadora: **una sola fuente de verdad** desde la parcela hasta la factura y el cobro, que genera solo (y con aprobación humana) lo que hoy se teclea a mano en SILICIE, SISV, EMCS, INFOVI y AecocEDI, que factura con **Verifactu** a tiempo, y que se puede operar desde la web (escritorio excelente, móvil correcto) o hablando con **CVBOT** por MCP. Sustituye a Holded y a Shopify (datos), a los Excel de stock y al trabajo de la administradora que se va.

**Éxito del MVP** (medible):
1. El **aforo de arranque del 31-12-2026** queda cargado en M1 y desde entonces todo el stock, los lotes y las operaciones de bodega se registran en WineCore.
2. P.O deja Holded en **M2** (facturas sin Verifactu hasta el 30-06-2027, intercompañía, compras; con la condición de Q-033) y, desde el **01-07-2027**, P.O y CVPO facturan en WineCore con Verifactu (M4), con **0 errores de numeración**. Hasta M4, CVPO factura en Holded con Verifactu (Q-033).
3. El 100 % de los envasados, mermas y salidas del periodo se generan desde WineCore y el **cuadre SISV ↔ SILICIE** da cero diferencias sin explicar antes de cada presentación.
4. Una inspección sin aviso obtiene **existencias a fecha por ubicación y lote** y la **trazabilidad de un lote** en menos de 1 minuto.
5. Ningún envío a la AEAT, la Junta o AecocEDI sale sin la aprobación de una persona identificada (auditoría al 100 %).

## 2. Usuarios y roles

| Persona | Rol(es) | Qué hace en WineCore | Dispositivo |
|---|---|---|---|
| **Pedro** (dueño de producto) | `owner`, `approver` | Configura, aprueba envíos y lotes de facturas, consulta, opera desde CVBOT | Escritorio y móvil (CVBOT) |
| **Titular de P.O** (bodeguero, enólogo) | `approver` (P.O), `cellar`, `field` | Bodega, viñedo, aforos, aprobación de envíos de P.O (si Q-005 lo confirma) | Móvil en bodega y campo; escritorio |
| **Administración** (persona nueva, la asesoría o Pedro) | `admin` | Facturas, albaranes, compras, cobros, preparación de envíos | Escritorio |
| **Bodega** (operario) | `cellar` | Operaciones de bodega, envasado, lecturas, aforos | Móvil/tableta |
| **Asesoría** | `advisor` | Lectura y exportaciones fiscales y contables | Escritorio |
| **CVBOT** | cliente MCP (`mcp_client`) en nombre de Pedro | Consultas, borradores con confirmación, avisos | — |
| **Agentes de Timbal** | `agent` (alcances mínimos) | OCR de gastos, workflows regulatorios, asistente, vendimia, resumen diario | — |
| **Ejecutor local** | `agent` (`runner-local`) | Ejecuta en portales los envíos ya aprobados | Equipo dedicado |
| **Agente padre y agentes hijo** (Fase 2) | — | Construyen el sistema (no son usuarios de la app) | — |

## 3. Alcance

### 3.1 MVP (M0–M5, hasta julio de 2027)

> Hitos según `09-roadmap.md` v2 (31-10-2026): primero stock, bodega y lotes (M1), después ventas, facturación sin Verifactu y SILICIE (M2); Verifactu pasa a M4. Si un documento discrepa en un hito, manda el roadmap.

| Módulo | Incluye | Hito |
|---|---|---|
| Núcleo | Acceso (Microsoft + lista blanca), roles por entidad, passkeys para aprobar, módulos activables, auditoría encadenada, series sin huecos, adjuntos, eventos a CVBOT | M0–M1 |
| Contactos y catálogo | Contactos deduplicados compartidos por las dos entidades; vinos, formatos, productos; tarifas versionadas; tarifa intercompañía; coste estándar | M1–M2 |
| Facturación + Verifactu | Facturas completas y rectificativas de P.O (M2, sin Verifactu hasta el 30-06-2027) y de CVPO (en Holded con Verifactu hasta M4, Q-033), IRPF y recargo, exportación/intracomunitaria/Canarias, PDF ES/EN (con QR desde M4), emisión en lote con aprobación, intercompañía mensual; registros Verifactu y envío (M4) | M2 / M4 |
| Ventas | Pedidos (manual, MCP, EDI, web), reglas de entidad facturadora (D3), albaranes (venta, consigna, traspaso, devolución), incidencias de transporte, proformas | M2–M3 |
| Stock | Ubicaciones y almacenes, dos libros (físico y fiscal), aforo de arranque, existencias a fecha, bloqueo de periodos, trazabilidad (M1); conciliación con las ventas (M2) | M1–M2 |
| Bodega | Depósitos, lotes y genealogía, trasiegos, ensamblajes, adiciones, envasado, etiquetado de jaulón, mermas, limpiezas (M1); recepción de uva, prensado, fermentación, analíticas, catas (M5) | M1 / M5 |
| Viñedo y ecológico | Parcelas, tratamientos, labores, maduración, vendimia; informe para la certificadora | M5 |
| Compras | Gastos por foto/PDF con OCR y validación; libro de recibidas | M2 |
| Cobros | Cobros y pagos parciales, pendientes y vencidos, partidas abiertas de Holded | M2 |
| Regulatorio | SILICIE (asientos y fichero en M2; presentación por el ejecutor en M3), SISV, EMCS, AecocEDI, INFOVI, calendario de obligaciones, cuadres, ejecutor local (M3) | M2–M3 |
| IA / MCP | MCP (lectura de stock, lotes y depósitos y borradores de bodega en M1; el resto con su módulo), asistente interno, resumen diario, vigilantes (M3) | M1–M3 |
| Migración | Contactos y catálogo (M1), partidas abiertas y revisión de albaranes (M2) | M1–M2 |

### 3.2 Posterior (M6+)
Conciliación bancaria y remesas SEPA (M6), contabilidad PGC y exportaciones contables (M7), histórico completo de Holded con PDF y diario D7 (M7), borradores de modelos AEAT (M6–M7), etiqueta electrónica y fichas de etiqueta, conocimiento de añadas, planificador de vendimia con meteorología, costes por partida, TPV con factura simplificada, OSS, integraciones de paquetería (etiquetas y seguimiento), APPCC.

### 3.3 Fuera de alcance
CRM con embudos, proyectos y horas, RR. HH. y nóminas, FACe (no se usa), la tienda web (proyecto aparte: WineCore solo recibe sus pedidos), presentación de modelos fiscales (la hace la asesoría), cualquier envío automático a terceros sin aprobación, "escenarios" para optimizar IRPF/IS (D4: sin lógica fiscal propia).

## 4. Historias de usuario

> Formato de criterios: **Dado** (contexto) · **Cuando** (acción) · **Entonces** (resultado verificable). Los textos de interfaz entre comillas son los literales en español.

### 4.1 Núcleo y acceso (CORE)

**US-CORE-01 · Entrar solo si estoy en la lista** (M0)
- Dado un usuario `active` en WineCore con email corporativo · Cuando inicia sesión con Microsoft · Entonces entra al panel en ≤ 3 s.
- Dado un email autenticado por Timbal que no está en `core.app_user` · Cuando accede a cualquier ruta · Entonces ve "No tienes acceso a WineCore" (403) y queda un evento `auth.denied` en auditoría.
- Dado un usuario pasado a `revoked` · Cuando hace cualquier petición · Entonces recibe 403 inmediatamente.

**US-CORE-02 · Personas y roles por entidad** (M0)
- Dado un `owner` · Cuando asigna a una persona el rol `approver` solo para P.O · Entonces esa persona puede aprobar envíos de P.O y no los de CVPO (403 `WC_FORBIDDEN`).
- Cuando cualquier rol cambia · Entonces queda en auditoría con antes/después.

**US-CORE-03 · Passkey para aprobar** (M1)
- Dado un aprobador sin passkey · Cuando intenta aprobar · Entonces se le pide registrar una (enlace mágico + WebAuthn) y no puede aprobar hasta tenerla.
- Dado un aprobador con passkey verificada hace > 5 min · Cuando pulsa "Aprobar" · Entonces se le pide verificarla de nuevo antes de registrar la decisión.

**US-CORE-04 · Activar o desactivar módulos** (M1)
- Dado `silicie` activo · Cuando un `owner` intenta desactivar `inventory` · Entonces ve "Antes desactiva SILICIE" y no cambia nada.
- Dado un módulo desactivado · Cuando alguien llama a su API, abre su pantalla o lista herramientas MCP · Entonces recibe 404 `WC_MODULE_DISABLED`, ve "Módulo desactivado" y no aparecen sus herramientas.
- Cuando se solicita activar/desactivar · Entonces se crea una aprobación `module_toggle` y el cambio solo se aplica al aprobarse.

**US-CORE-05 · Historial de cambios** (M1)
- Dado cualquier registro · Cuando abro "Historial" · Entonces veo cada cambio con quién (persona o agente y en nombre de quién), cuándo, qué campos cambiaron y el motivo.
- Dado el job diario de verificación · Cuando la cadena de auditoría está rota · Entonces se crea una alerta crítica y un evento a CVBOT.

**US-CORE-06 · Series de numeración** (M1)
- Dado la serie `CF27-` con próximo 0001 · Cuando se emiten dos facturas a la vez · Entonces reciben 0001 y 0002 sin repetir ni saltar.
- Dado una emisión que falla después de tomar número · Cuando la transacción se deshace · Entonces el número vuelve a estar disponible (sin hueco).
- Dado el 1 de enero · Cuando corre el job de cambio de año · Entonces existen las series del año nuevo con contador a 1.

**US-CORE-07 · Avisos a CVBOT** (M1)
- Dado un evento de la lista de `02-modelo-dominio.md` §5.2 · Cuando se produce · Entonces CVBOT recibe un `POST` firmado (HMAC) en ≤ 1 min, con reintentos si falla, y sin datos personales innecesarios.

### 4.2 Aprobaciones (APR)

**US-APR-01 · Bandeja de aprobaciones** (M1)
- Dado un envío pendiente · Cuando abro la bandeja · Entonces veo qué se enviará exactamente (resumen, nº de registros, importes, destinatario), quién lo pidió y cuándo caduca.
- Cuando apruebo con passkey · Entonces la decisión guarda mi identidad, método, hora y el hash del contenido, y la acción se ejecuta una sola vez.
- Dado que el contenido cambió después de pedir la aprobación · Cuando intento aprobar · Entonces veo "El contenido ha cambiado; vuelve a pedir la aprobación" (`WC040`).

**US-APR-02 · Rechazar** (M1)
- Cuando rechazo con un motivo · Entonces el elemento vuelve a su estado anterior (p. ej. "validado") y el solicitante recibe el aviso.

**US-APR-03 · Caducidad y recordatorios** (M1)
- Dado una aprobación pendiente · Cuando pasan 4 h laborables · Entonces se envía un recordatorio; Cuando caduca · Entonces queda "caducada" y no se puede ejecutar.

### 4.3 Contactos (CONT)

**US-CONT-01 · Alta con NIF validado** (M1)
- Cuando creo un contacto con NIF "00000000-t" (ficticio) · Entonces se guarda normalizado "00000000T" si la letra es correcta; si no, veo "La letra del NIF no es correcta".
- Dado un NIF ya existente · Cuando intento crear otro contacto con él · Entonces veo el contacto existente y la opción de abrirlo.
- Cuando el nombre y el CP coinciden con otro contacto · Entonces se muestra "Posible duplicado" con enlace.

**US-CONT-02 · Fusionar duplicados** (M1)
- Dado dos contactos duplicados · Cuando los fusiono eligiendo campo a campo · Entonces queda uno, el otro apunta a él (`merged_into_id`), los documentos se reasignan y la fusión queda registrada.

**US-CONT-03 · Condiciones por entidad** (M1)
- Dado un cliente de P.O y de CVPO · Cuando fijo descuento 5 % solo en CVPO · Entonces las facturas de CVPO lo aplican y las de P.O no.

**US-CONT-04 · Derechos RGPD** (M2)
- Dado una persona física · Cuando un `owner` pide "Exportar sus datos" · Entonces descarga un JSON con todos sus datos en ≤ 10 s.
- Cuando pide "Suprimir" y hay facturas · Entonces se seudonimizan sus datos de contacto y se conservan los datos fiscales obligatorios, con aviso explicativo.

### 4.4 Catálogo (CAT)

**US-CAT-01 · Vinos, formatos y productos** (M1)
- Cuando creo "Entredicho 2023 0,75 L" · Entonces queda un producto con vino, añada, formato, SKU, GTIN opcional y "requiere lote".
- Dado un producto de vino · Cuando intento crear otro con el mismo vino, añada y formato · Entonces veo "Ya existe".

**US-CAT-02 · Tarifas versionadas** (M1)
- Dado la tarifa "distribuidor" v1 activa · Cuando creo la v2 con vigencia desde el 01-03-2027 y la activo con aprobación · Entonces los documentos con fecha ≥ 01-03-2027 usan v2 y los anteriores conservan v1.
- Dado una versión activa · Cuando intento editar un precio · Entonces veo "Crea una versión nueva" (`WC050`).

**US-CAT-03 · Tarifa intercompañía** (M2)
- Cuando registro "distribuidor − 60 %" con vigencia y la referencia de la validación del asesor · Entonces queda activa tras aprobación y WineCore la aplica sin recalcularla.
- Dado un precio intercompañía por debajo del coste estándar · Cuando se cierra el periodo · Entonces la línea queda marcada "bajo coste" y el cierre exige aprobación.

**US-CAT-04 · Coste estándar** (M2)
- Cuando registro el coste de un producto con fecha de vigencia · Entonces el control de bajo coste usa el vigente en la fecha del documento.

### 4.5 Ventas (VENT)

**US-VENT-01 · Pedido con entidad resuelta** (M2)
- Dado la regla "cliente X → P.O" y la regla por defecto "CVPO" · Cuando creo un pedido para X · Entonces el pedido queda en P.O y muestra "Regla: cliente X (v3)".
- Dado un pedido confirmado · Cuando cambian las reglas · Entonces el pedido conserva la entidad y la regla con que se confirmó.

**US-VENT-02 · Reglas de entidad facturadora en Ajustes** (M2)
- Cuando creo una versión nueva de reglas (cliente > canal > defecto) y la activo con aprobación · Entonces solo hay una versión activa y la pantalla muestra con qué regla se resolvería un cliente/canal de prueba.

**US-VENT-03 · Albarán desde pedido** (M2)
- Dado un pedido de 24 botellas · Cuando emito un albarán de 12 desde la bodega con el lote sugerido · Entonces el stock físico de ese lote baja 12, el pedido queda "parcialmente servido" y el albarán toma número.
- Dado stock insuficiente en la fecha del albarán · Cuando intento emitir · Entonces veo "No hay existencias suficientes del lote L… en BOD" (`WC024`).

**US-VENT-04 · Consigna a un operador logístico** (M2)
- Cuando emito un albarán de consigna de BOD a TFRP · Entonces el stock sale de BOD y entra en TFRP con el mismo propietario, y aparece en el informe "albaranes sin facturar".

**US-VENT-05 · Anular o devolver** (M2)
- Dado un albarán emitido no enviado · Cuando lo anulo con motivo · Entonces se revierten sus movimientos.
- Dado un albarán ya enviado · Cuando hay devolución · Entonces se crea un albarán de devolución a la ubicación de devoluciones (Q-030).

**US-VENT-06 · Incidencias de transporte** (M2)
- Cuando registro una rotura con fotos · Entonces queda la incidencia con plazo de reclamación y un aviso 3 días antes de que venza.

**US-VENT-07 · Presupuesto y proforma** (M2)
- Cuando creo una proforma en inglés con Incoterm "FCA" · Entonces el PDF sale en inglés con Incoterm, sin número de factura y con la mención "Proforma".

### 4.6 Facturación (FACT)

**US-FACT-01 · Borrador de factura** (M2)
- Cuando creo un borrador para un cliente de CVPO · Entonces no tiene número, puedo editarlo y no tiene efectos fiscales ni de stock.
- Cuando lo creo desde dos albaranes · Entonces trae sus líneas y lotes, y los albaranes pasan a "facturado" al emitir.

**US-FACT-02 · Emitir** (M2)
- Dado un borrador válido · Cuando pulso "Emitir" · Entonces en una sola operación: toma el siguiente número de la serie, fija la fecha, congela los datos del cliente, calcula el desglose (redondeo por tipo) y los vencimientos, y genera el registro Verifactu; si algo falla, no se emite nada.
- Dado un cliente sin NIF · Cuando emito una factura completa · Entonces veo "El cliente necesita NIF para una factura completa".
- Dado una línea de vino sin lote · Cuando emito · Entonces veo "Indica el lote de la línea N".
- Dado una factura emitida · Cuando intento cambiar un importe · Entonces no es posible (`WC080`) y se ofrece "Crear rectificativa".

**US-FACT-03 · PDF con QR** (M2)
- Cuando se emite · Entonces se genera el PDF (ES o EN según el cliente) con todos los datos obligatorios, el QR de cotejo y la leyenda Verifactu, y no cambia nunca más.

**US-FACT-04 · Rectificativa** (M2)
- Cuando creo una rectificativa por diferencias de una factura (incluida una de Holded por número y fecha) · Entonces sale en la serie de rectificativas, referencia la original y su registro Verifactu lleva tipo y facturas rectificadas.

**US-FACT-05 · Anular una emitida por error** (M2)
- Dado una factura que no debió expedirse · Cuando un aprobador la anula con motivo de la lista · Entonces queda "anulada", se genera el registro de anulación y el número no se reutiliza.

**US-FACT-06 · IRPF y recargo** (M2)
- Cuando facturo un arrendamiento con `IVA21_ALQ` · Entonces el total a cobrar descuenta la retención del 19 % y el PDF lo muestra.
- Cuando facturo a un cliente en recargo de equivalencia · Entonces se añade el 5,2 % y su cuota.

**US-FACT-07 · Exportación, intracomunitaria y Canarias** (M2)
- Dado un cliente del Reino Unido · Cuando emito · Entonces se usa `EXP_E2` con la mención de exención por exportación.
- Dado un cliente UE sin NIF-IVA validado · Cuando elijo entrega intracomunitaria · Entonces veo "Valida el NIF-IVA en VIES".

**US-FACT-08 · Emisión en lote** (M2)
- Cuando selecciono 10 borradores y pido emitirlos · Entonces se crea una aprobación con el resumen (nº, clientes, total); al aprobarla se emiten en orden de fecha con números consecutivos.

**US-FACT-09 · Intercompañía mensual** (M2)
- Dado ventas de CVPO con stock de P.O en octubre · Cuando llega el 1 de noviembre · Entonces se cierra la liquidación de octubre, se crea el borrador de factura recapitulativa P.O → CVPO con **fecha de operación 31 de octubre** y la tarifa vigente, y se pide aprobación con aviso si quedan menos de 3 días para el día 16 (RD 1619/2012, arts. 11 y 13: se expide antes del día 16 de noviembre, con la fecha real de expedición).
- Cuando se aprueba · Entonces se emite la factura de P.O y se crea la factura recibida espejo en CVPO.

**US-FACT-10 · Enviar al cliente** (M2)
- Cuando descargo el PDF · Entonces la factura queda "enviada (descarga)" con quién y cuándo.
- (M2, si Q-014) Cuando pulso "Enviar por correo" · Entonces se envía desde el buzón dedicado tras mi clic y queda registrado; ningún agente puede enviarla.

**US-FACT-11 · Libro de emitidas** (M2)
- Cuando exporto el trimestre · Entonces obtengo el libro de facturas emitidas (formato de `modelos-aeat.md`) y los PDF en un ZIP.

### 4.7 Verifactu (VFT)

**US-VFT-01 · Registro encadenado** (M4)
- Cuando se emite una factura de una entidad con instalación activa · Entonces se crea su registro de alta con la huella calculada según la especificación y encadenada al anterior; la cadena no puede modificarse (`WC130`).

**US-VFT-02 · Envío a la AEAT** (M4)
- Dado registros pendientes · Cuando se respeta el tiempo de espera indicado por la AEAT · Entonces se envían (como máximo el número permitido por envío) y se guarda la respuesta por registro (CSV, estado, errores).
- Dado un fallo técnico · Cuando se reintenta · Entonces se aplica la espera exponencial y, al tercer fallo, se avisa a CVBOT y al panel.

**US-VFT-03 · Estado por factura** (M4)
- Cuando abro una factura · Entonces veo "Verifactu: aceptada / aceptada con errores / rechazada / pendiente" y el detalle.

**US-VFT-04 · Subsanación** (M4)
- Dado un registro rechazado o aceptado con errores · Cuando corrijo los datos · Entonces se genera el registro de subsanación encadenado según la especificación.

**US-VFT-05 · Declaración responsable y eventos** (M4)
- Cuando abro "Ajustes > Verifactu" · Entonces veo la declaración responsable del productor, versión e instalación, y el registro de eventos del sistema.

**US-VFT-06 · Control de preproducción** (M4)
- Dado el entorno de pruebas de la AEAT · Cuando se ejecuta la batería de casos de `verifactu.md` · Entonces todos dan "Correcto" (o el error esperado en los casos negativos) antes del 01-06-2027.

### 4.8 Stock (INV)

**US-INV-01 · Aforo de arranque** (M1)
- Cuando registro el aforo de la fecha de corte (volumen por depósito y lote; unidades por ubicación, producto, lote y estado) y el titular lo firma · Entonces se crean los saldos iniciales en el libro físico y en el fiscal, y no se puede repetir para la misma fecha.

**US-INV-02 · Existencias a fecha** (M1)
- Cuando pido existencias "ahora" o "a 15-03-2027 10:00" · Entonces veo por ubicación, recipiente, lote, producto y estado, con totales de granel y envasado, y puedo descargar el PDF para la inspección en ≤ 10 s.

**US-INV-03 · Físico frente a fiscal** (M1 libros / M2 salidas por venta y conciliación)
- Cuando abro la conciliación de un periodo · Entonces veo los albaranes sin facturar, las facturas sin salida física y las diferencias por lote, con enlaces a los documentos.

**US-INV-04 · Aforo periódico** (M1)
- Dado un recuento con diferencias · Cuando se aprueba con motivo por línea · Entonces se crean regularizaciones físicas y fiscales.

**US-INV-05 · Periodos cerrados** (M1)
- Dado el periodo fiscal cerrado hasta el 31-07-2027 · Cuando intento registrar un movimiento con fecha anterior · Entonces veo "El periodo está cerrado hasta el 31-07-2027" (`WC021`).

**US-INV-06 · Trazabilidad de un lote** (M1 envasado / M5 completa)
- Cuando busco el lote impreso en una botella · Entonces veo su diagrama hasta las parcelas o proveedores de uva, con operaciones, analíticas y adiciones, y quién la compró.

### 4.9 Bodega (BOD)

**US-BOD-01 · Depósitos** (M1)
- Cuando abro "Depósitos" · Entonces veo cada uno con código, tipo, capacidad, contenido (lote, estado, litros, % de llenado) y última lectura; al escanear su QR desde el móvil se abre su ficha.

**US-BOD-02 · Trasiego** (M1)
- Dado 1.000 L del lote L en INOX-01 · Cuando registro un trasiego de 1.000 L a INOX-03 con 20 L de lías · Entonces al confirmar INOX-01 queda vacío e INOX-03 con 980 L; si la suma no cuadra veo "El volumen no cuadra: entran 1.000 L y salen 999 L" (`WC020`).
- Dado INOX-03 con otro lote · Cuando intento trasegar ahí · Entonces veo "El depósito contiene otro lote; usa Ensamblaje" (`WC026`).

**US-BOD-03 · Ensamblaje con fórmula** (M1 sin fórmula / M5 con fórmula)
- Cuando introduzco la fórmula de cata en mL por muestra y el volumen objetivo · Entonces WineCore calcula % y litros por depósito; al confirmar crea un lote nuevo con su genealogía.

**US-BOD-04 · Envasado** (M1)
- Dado 504 L del lote ENT-27A · Cuando registro 672 botellas de 0,75 L · Entonces la merma se calcula (504 − 672 × 0,75 = 0 L) o se pide si no cuadra, se crea el lote envasado, baja el granel, suben las botellas (sin etiquetar o etiquetadas) y se genera la anotación de SILICIE y SISV.

**US-BOD-05 · Adición** (M1)
- Cuando registro 2 g/L de ácido tartárico en INOX-B1 con la factura del producto · Entonces queda en el historial del lote y alimenta etiquetas e informe ecológico.

**US-BOD-06 · Merma y destrucción** (M1)
- Cuando registro una merma por incidencia o una destrucción · Entonces exige motivo, foto opcional y aprobación antes de afectar al stock.

**US-BOD-07 · Etiquetado de jaulón** (M1)
- Cuando paso 600 botellas sin etiquetar a etiquetadas con 2 roturas · Entonces quedan 598 etiquetadas y 2 en mermas.

**US-BOD-08 · Recepción de uva** (M5)
- Cuando registro 3.100 kg de una parcela propia (o de un proveedor con su documento de acompañamiento) · Entonces se crea la partida (lote) de uva con su origen.

**US-BOD-09 · Prensado/encubado y fin de fermentación** (M5)
- Cuando registro el prensado de 3.100 kg con 2.200 L de mosto a INOX-B1 · Entonces el lote pasa a mosto y queda el rendimiento; al registrar el fin de fermentación con grado · Entonces pasa a vino.

**US-BOD-10 · Lecturas de fermentación** (M5)
- Cuando dicto "B1 densidad 1,032 temperatura 18" · Entonces se guarda la lectura y la ficha del lote dibuja la curva; si la densidad no baja en 48 h, llega una alerta.

**US-BOD-11 · Analíticas y catas** (M5)
- Cuando subo el PDF del pack FML y sus valores · Entonces quedan asociados al lote con rangos validados.

**US-BOD-12 · Rectificar una operación** (M1)
- Dado una operación confirmada · Cuando registro su rectificación con motivo · Entonces sus movimientos se anulan y se aplican los nuevos, y las anotaciones de SISV/SILICIE afectadas se anulan y reemplazan.

**US-BOD-13 · Limpiezas** (M1)
- Cuando registro la limpieza de un depósito con ácido peracético · Entonces queda en el historial del depósito y en el informe ecológico.

### 4.10 Viñedo (VIN, M5)

**US-VIN-01 · Parcelas** — Cuando doy de alta una parcela con su referencia SIGPAC completa, superficie y variedades · Entonces no se puede duplicar la misma referencia.
**US-VIN-02 · Tratamientos** — Cuando registro un tratamiento (fecha, operario, producto, dosis, método, factura) · Entonces aparece en el cuaderno y avisa si el producto no consta como apto en ecológico.
**US-VIN-03 · Labores** — Cuando registro una poda por voz · Entonces queda con fecha, parcela y horas.
**US-VIN-04 · Maduración** — Cuando envío por CVBOT "parcela P-07, faltan 10 días" con foto · Entonces se guarda el control con la previsión meteorológica del día.
**US-VIN-05 · Vendimia** — Cuando cierro la vendimia de una parcela · Entonces queda enlazada con su recepción en bodega.

### 4.11 Compras (COMP)

**US-COMP-01 · Capturar un gasto** (M2) — Cuando subo una foto o reenvío un PDF · Entonces en ≤ 2 min aparece un gasto "capturado" con proveedor, número, fechas, líneas e IVA propuestos y la confianza de cada campo.
**US-COMP-02 · Validar y aprobar** (M2) — Dado un gasto capturado · Cuando administración lo valida y Pedro lo aprueba · Entonces queda pagable; si el número ya existe para ese proveedor, se marca "duplicado".
**US-COMP-03 · Libro de recibidas** (M2) — Cuando exporto el trimestre · Entonces obtengo el libro de facturas recibidas y los PDF.

### 4.12 Cobros y pagos (FIN)

**US-FIN-01 · Registrar cobro** (M2) — Dado una factura de 121 € · Cuando registro un cobro de 100 € · Entonces queda "parcialmente cobrada" con 21 € pendientes; si intento imputar más del pendiente, veo `WC100`.
**US-FIN-02 · Pendientes y vencidos** (M2) — Cuando abro "Cobros" · Entonces veo lo pendiente por cliente con antigüedad (0–30, 31–60, 61–90, > 90) y puedo preparar un recordatorio en borrador que solo se envía tras aprobación.
**US-FIN-03 · Extractos y conciliación** (M6) — Cuando importo un Norma 43 · Entonces cada línea se deduplica y recibe sugerencias de factura; confirmar crea el cobro.
**US-FIN-04 · Remesa SEPA** (M6) — Cuando apruebo una remesa · Entonces se genera el fichero para subirlo al banco; WineCore no guarda claves bancarias.

### 4.13 SILICIE (SIL)

**US-SIL-01 · Asientos al día** (M2) — Cuando se confirma un envasado, una merma o se emite una factura de P.O · Entonces se crean los asientos SILICIE correspondientes (los trasiegos no generan asiento) con su justificante.
**US-SIL-02 · Preparar la presentación** (M2) — Dado el plazo de agosto o diciembre · Cuando preparo el envío del periodo · Entonces WineCore valida (sin saldos negativos, campos obligatorios), genera el fichero, muestra el resumen por producto y pide aprobación.
**US-SIL-03 · Presentar** (M3) — Dado el envío aprobado · Cuando el ejecutor local lo presenta · Entonces se guardan el fichero enviado, el acuse, los números de asiento y las capturas; si algo falla, se detiene y avisa.
**US-SIL-04 · Anular o rectificar** (M3) — Cuando se rectifica un movimiento ya presentado · Entonces se prepara la anulación y el asiento nuevo para el siguiente envío.
**US-SIL-05 · Cuadre SISV ↔ SILICIE** (M3) — Cuando ejecuto el cuadre de un periodo · Entonces envasados y salidas coinciden en ambos o se listan las diferencias con su causa.
**US-SIL-06 · Cierre de ejercicio** (M3) — Cuando llega el plazo de cierre · Entonces WineCore avisa y prepara la comunicación de cierre para aprobación.

### 4.14 SISV (M3)

**US-SISV-01 · Anotaciones por libro** — Cuando se confirma una operación de bodega o sale mercancía · Entonces se crean las anotaciones del libro SISV correspondiente con los códigos SISV (variedad, designación, país).
**US-SISV-02 · Importación mensual y envío de libros** — Antes del día 10 de cada mes · Cuando preparo el mes anterior · Entonces WineCore genera los ficheros de importación, el ejecutor los importa tras aprobación y prepara el envío de libros, que también se aprueba.
**US-SISV-03 · Salidas con e-DA** — Dado un albarán con ARC · Entonces su anotación de salida en SISV lleva el número de e-DA/ARC.

### 4.15 EMCS (M3)

**US-EMCS-01 · e-DA desde albarán** — Dado un albarán a Reino Unido, Canarias o la UE · Cuando lo emito · Entonces se crea el e-DA en borrador con los datos del albarán y del destinatario.
**US-EMCS-02 · Presentar** — Cuando se aprueba · Entonces el ejecutor lo presenta y el ARC queda en el albarán, el e-DA y los libros.
**US-EMCS-03 · Recepción, anulación, cambio de destino** — Cuando llega el certificado de recepción · Entonces el e-DA pasa a "recibido" (o rechazado y se crea la devolución).
**US-EMCS-04 · Paquete para el transitario** — Cuando lo pido · Entonces descargo factura comercial, ARC e Incoterm en un ZIP.

### 4.16 AecocEDI / El Corte Inglés (EDI, M3)

**US-EDI-01 · Aviso de pedido** — Cuando llega el correo "nuevo pedido" de AecocEDI · Entonces WineCore lo detecta (buzón solo lectura), avisa a CVBOT y encola la lectura del pedido en el portal.
**US-EDI-02 · Pedido de ECI** — Cuando el ejecutor lee el pedido · Entonces se crea el pedido en WineCore por GTIN (o se marca qué productos no casan).
**US-EDI-03 · Factura en AecocEDI** — Dado la factura emitida a ECI · Cuando se aprueba su envío · Entonces el ejecutor la teclea en el portal con evidencias; si no es posible, WineCore muestra la ficha para teclear con todos los campos.
**US-EDI-04 · Confirmación de pago** — Cuando llega una confirmación de pago · Entonces se propone el cobro imputado a las facturas que cita.

### 4.17 INFOVI (M3)

**US-INFOVI-01 · Declaraciones** — Antes del 20 de diciembre y del 20 de agosto, y del 10 de diciembre para la cosecha · Cuando preparo la declaración · Entonces WineCore calcula los cuadros desde los libros, genera el fichero y pide aprobación para presentarla.

### 4.18 Ecológico (ECO, M5)

**US-ECO-01 · Informe para la certificadora** — Cuando lo genero para un año · Entonces incluye tratamientos, adiciones, limpiezas, compras de insumos con factura y el balance de materias por lote.
**US-ECO-02 · Límites** — Dado un vino ecológico con SO2 total por encima del límite ecológico de su tipo · Cuando se registra la analítica · Entonces aparece una alerta.

### 4.19 Migración (MIG)

**US-MIG-01 · Contactos** (M1) — Cuando ejecuto el ensayo de contactos de CVPO · Entonces obtengo el informe (fusiones, avisos de NIF) y solo puedo cargar con ese informe aprobado; repetir la carga no duplica.
**US-MIG-02 · Catálogo aprobado** (M1) — Cuando apruebo la propuesta de catálogo · Entonces se cargan vinos, formatos, productos y la tarifa final en borrador.
**US-MIG-03 · Partidas abiertas** (M2) — Cuando cargo las facturas pendientes al corte · Entonces se pueden cobrar desde WineCore y el total coincide al céntimo con Holded.
**US-MIG-04 · Albaranes pendientes** (M2) — Cuando reviso los albaranes pendientes de Holded · Entonces marco cada uno como vivo, cerrado o ignorado, y los vivos se recrean solo si el aforo lo confirma.
**US-MIG-05 · Histórico con cuadre** (M7) — Cuando cargo el histórico · Entonces los totales por entidad, tipo y año coinciden al céntimo con el manifiesto.
**US-MIG-06 · PDF** (M7) — Cuando cargo los PDF · Entonces cada uno queda vinculado o en la lista de no vinculados.
**US-MIG-07 · Contabilidad histórica (D7)** (M7) — Cuando cargo el diario en el formato de `06-migracion.md` §8 · Entonces cada asiento cuadra y los saldos coinciden con el cuadro de cuentas.

### 4.20 MCP y CVBOT (MCP)

**US-MCP-01 · Consultar** (M1) — Cuando CVBOT pregunta por facturas vencidas · Entonces recibe la lista que Pedro puede ver, con enlaces.
**US-MCP-02 · Escribir con confirmación** (M1–M2) — Cuando CVBOT prepara un pedido · Entonces recibe una vista previa y un token; solo al confirmar se crea; un token caducado o reutilizado no hace nada.
**US-MCP-03 · Nunca aprobar por chat** (M1) — Cuando CVBOT intenta aprobar · Entonces no existe herramienta; recibe el enlace a la bandeja.

### 4.21 Asistente y agentes (ASIS)

**US-ASIS-01 · Asistente de inspección** (M3) — Cuando pregunto "¿cuánto vino hay en cada depósito ahora?" · Entonces responde con la tabla y el enlace a la existencia a fecha.
**US-ASIS-02 · Resumen diario** (M3) — Cada día laborable a las 8:00 · Entonces CVBOT recibe el resumen (aprobaciones pendientes, vencimientos, cola, descuadres) en ≤ 10 líneas.
**US-ASIS-03 · Vigilantes** (M3) — Cuando un vigilante detecta un descuadre, un cobro vencido, un plazo a 7 días, una cola atascada o el ejecutor caído · Entonces emite un evento a CVBOT y un aviso en el panel.

### 4.22 Posteriores (resumen)
**US-CONTA-01** asientos automáticos y exportación a la asesoría (M7) · **US-CONTA-02** saldos de apertura (M7) · **US-MOD-01** datos para 303/390/347/349/115 (M6) · **US-ETQ-01** ficha de etiqueta y e-etiqueta (posterior) · **US-CONO-01** notas de cata años después (posterior).

## 5. Requisitos no funcionales

| ID | Tema | Requisito | Verificación |
|---|---|---|---|
| RNF-01 | Usuarios | 1–3 simultáneos, ≤ 10 cuentas | Pruebas de carga ligeras (10 usuarios virtuales) |
| RNF-02 | Volumen | ~400 facturas/año, ~400 albaranes, ~1.000 gastos, ~3.000 movimientos de stock; diseño holgado ×10 | Datos sintéticos ×10 en staging |
| RNF-03 | Rendimiento | Lecturas de API p95 < 300 ms; emisión de factura p95 < 1 s (sin el envío a la AEAT); carga de pantalla p95 < 1,5 s en escritorio; MCP p95 < 2 s | Pruebas e2e con medición |
| RNF-04 | Disponibilidad | Horario laboral (8–20 h, Europe/Madrid); objetivo 99,5 % mensual (Timbal no publica SLA); RPO ≤ 5 min (PITR); RTO ≤ 4 h | Prueba de restauración trimestral |
| RNF-05 | Seguridad | ADR 003, 008, 009; sin secretos en el repo; cabeceras seguras; aprobaciones con passkey; mínimos privilegios en BD | CI (gitleaks), tests de permisos, revisión con Opus de cambios críticos |
| RNF-06 | Privacidad | RGPD según `07-arquitectura.md` §11; datos personales fuera de logs y prompts innecesarios | Tests de logs; detector de datos personales en CI |
| RNF-07 | Integridad | Nada se borra; auditoría encadenada; libros solo de inserción; invariantes de `02-modelo-dominio.md` §19 | Tests SQL de invariantes + propiedades |
| RNF-08 | Conservación | Documentos y evidencias ≥ 6 años, sin borrado (documentos de la Knowledge Base con hash y exportación semanal) | Revisión de configuración y prueba de restauración |
| RNF-09 | Exportabilidad | Volcado semanal y CSV mensual de todas las tablas de negocio | Job y prueba de restauración |
| RNF-10 | Usabilidad | Español por defecto; documentos en ES/EN; escritorio excelente, móvil correcto (§12.4); accesibilidad WCAG 2.1 AA en los flujos principales | QA visual (Playwright) y revisión manual |
| RNF-11 | Coste | Recurrente fuera de Timbal ≈ 30–70 €/mes; modelos de IA ≤ 30 €/mes; objetivo total (con Timbal) ≤ 200 €/mes, a confirmar con el plan de Timbal | Panel de costes en PROGRESS |
| RNF-12 | Zona horaria | Fechas de negocio en Europe/Madrid | Tests de cambio de hora |
