# Preguntas para Pedro — WineCore

> Fuente única de preguntas abiertas. Cada pregunta tiene dueño, opciones, recomendación y fecha límite.
> **Bloqueante** = sin respuesta no puede empezar (o cerrarse) el hito indicado. **No bloqueante** = hay un valor por defecto documentado y se trabaja con él hasta que Pedro diga otra cosa.
> Convención de estados: `ABIERTA` · `RESPONDIDA (fecha)` · `CERRADA (fecha)`.
> Última revisión: 31-10-2026 (Fase 1, especificación).

## Resumen

| ID | Tema | Bloquea | Fecha límite | Estado |
|---|---|---|---|---|
| Q-001 | El repo de GitHub es **público** | — (Pedro decide mantenerlo público de momento) | Revisar antes del primer código de Fase 2 (M0) | RESPONDIDA (31-10-2026) |
| Q-002 | Verifactu: modalidad y canal de envío (computer use no es viable) | M1 | **05-11-2026** | ABIERTA |
| Q-003 | Verifactu: ¿aprobar la emisión = aprobar el envío del registro? | M1 | **05-11-2026** | ABIERTA |
| Q-004 | Proyecto Timbal (existe: id 3942, entorno Main 4165), conexión con GitHub y credenciales | M0 (infraestructura) | **04-11-2026** | EN CURSO (31-10-2026) |
| Q-005 | Quién aprueba qué (personas identificadas) y desde dónde | M1 | **05-11-2026** | ABIERTA |
| Q-006 | Certificado para Verifactu y custodia | M1 (pruebas en preproducción y producción) | **12-11-2026** | ABIERTA |
| Q-007 | Productor del software (declaración responsable Verifactu) | Paso a producción de M1 | **15-12-2026** | ABIERTA |
| Q-008 | Plan B de Verifactu: Holded u otro software en enero | Gate del 01-12-2026 | **01-12-2026** | ABIERTA |
| Q-009 | Qué entidad factura a El Corte Inglés | M3 (EDI) | 15-01-2027 | ABIERTA |
| Q-010 | Fecha fiscal de la salida en SILICIE (albarán o factura) y naturaleza de TFRP | M2 | 15-12-2026 | ABIERTA |
| Q-011 | Calendario legal de SILICIE (2 presentaciones/año) | M2 | 15-01-2027 | ABIERTA (en verificación) |
| Q-012 | SISV: periodicidad, acceso y formato | M3 | 15-02-2027 | ABIERTA (en verificación) |
| Q-013 | Fecha de corte, aforo físico y quién lo firma | M2 | 01-12-2026 | ABIERTA |
| Q-014 | Envío de facturas por correo (M365) | No bloqueante (M1 usa descarga) | 30-11-2026 | ABIERTA |
| Q-015 | Series y numeración desde 2027 | No bloqueante (hay defecto) | 20-11-2026 | ABIERTA |
| Q-016 | Periodicidad de la factura intercompañía P.O → CVPO | No bloqueante (hay defecto) | 15-12-2026 | ABIERTA |
| Q-017 | Coste unitario por producto (control "no vender bajo coste") | M2 | 15-01-2027 | ABIERTA |
| Q-018 | Tienda web (Stripe): entidad que factura y países de venta | M3 | 15-02-2027 | ABIERTA |
| Q-019 | Ventas a la UE y a Canarias: e-DA/e-DAS y régimen de IVA | M3 | 15-01-2027 | ABIERTA |
| Q-020 | Códigos de depósitos y formatos BIB | M2 | 15-12-2026 | ABIERTA |
| Q-021 | Almacenes externos: qué es cada uno y de quién es el stock | M2 | 15-12-2026 | ABIERTA |
| Q-022 | Alcance contable: ¿WineCore lleva la contabilidad o exporta a la asesoría? | M7 | 01-04-2027 | ABIERTA |
| Q-023 | Clientes de Shopify a migrar (RGPD) | M7 | 01-04-2027 | ABIERTA |
| Q-024 | AECOC: GTIN/GLN, DESADV y credenciales (detalle que Pedro pasará) | M3 | 15-02-2027 | ABIERTA (pendiente §12.3) |
| Q-025 | Reglas iniciales de entidad facturadora (Ajustes) | M1 (precarga) | 20-11-2026 | ABIERTA |
| Q-026 | Equipo dedicado para el ejecutor local de *computer use* (certificado en local) | M2 (SILICIE) | 15-12-2026 | ABIERTA |
| Q-027 | Cuenta de AWS (PostgreSQL + S3 en la UE) y coste mensual | M0 | **06-11-2026** | ABIERTA |
| Q-028 | Preguntas técnicas a Timbal (lista en `07-arquitectura.md` §14) | M0 (parcial) | 06-11-2026 | ABIERTA |
| Q-029 | Cómo recibe CVBOT los eventos de WineCore (URL y firma) | M1 | 13-11-2026 | ABIERTA |

---

## Q-001 · El repo de GitHub es público — RESPONDIDA (31-10-2026)

- **Respuesta de Pedro (31-10-2026)**: el repo **se mantiene público de momento**. Consecuencia: **todo** lo que se suba sigue anonimizado (política de `00-triaje.md` §8), la CI bloquea datos reales y datos personales, y el riesgo R14 queda **aceptado y vigilado**. Recomiendo revisar la decisión antes de subir el primer código de Fase 2 (M0), porque el código incluirá la configuración de seguridad (roles, rutas de máquina, procedimientos del ejecutor local). Ventaja colateral: en repos públicos, GitHub Actions y el *secret scanning* con *push protection* son gratuitos (activar ambos en Settings → Code security).
- **Hecho** (comprobado el 31-10-2026 con `gh repo view pedrolivaresanchez/winecore`): `visibility: PUBLIC`. El plan (§3.1) exige **privado**.
- **Por qué importa**: todo lo que se sube (especificación, PR, issues, historial de git) es visible para cualquiera. La especificación describe procesos fiscales, clientes, proveedores, descuadres heredados y la arquitectura de seguridad. Un repo público también expone, para siempre, cualquier error futuro (un `.env`, un fichero de `data/`).
- **Qué he hecho mientras tanto**: todo lo subido está **anonimizado** (sin nombres de personas salvo Pedro, sin correos ni teléfonos, sin importes de facturación, sin el CAE, sin datos de clientes). El contexto original (transcripción, handover, exports) está en `data/` y **no se sube** (está en `.gitignore`). Los descuadres heredados se citan solo de forma genérica.
- **Opciones**:
  1. Hacer el repo **privado hoy** (GitHub → Settings → General → Danger Zone → Change visibility → Private). Coste: ninguno en planes actuales de GitHub; las Actions privadas consumen minutos del plan.
  2. Crear un repo nuevo privado `pedrolivaresanchez/WineCore` y archivar este.
  3. Mantenerlo público y trabajar siempre con especificación anonimizada (no recomendable: la Fase 2 subirá código de seguridad y configuración).
- **Recomendación**: **opción 1, antes de aprobar el PR de especificación**. Tras hacerlo privado, conviene revisar en Settings → Code security que estén activos *secret scanning* y *push protection*.
- **Dueño**: Pedro · **Fecha límite**: 03-11-2026.

## Q-002 · Verifactu: modalidad y canal de envío — BLOQUEANTE para M1

- **Contexto**: la §12.1 pide que las integraciones regulatorias (incluida Verifactu) empiecen por *computer use* sobre portales. Verifactu **no es un portal**: es un requisito sobre el propio software de facturación (WineCore). En modalidad VERI*FACTU, cada registro de facturación se remite a la AEAT **por servicio web** de forma automática al emitir la factura; en modalidad NO VERI*FACTU, el software firma electrónicamente cada registro y lleva un registro de eventos, sin remitirlos salvo requerimiento. El detalle normativo con artículos y URL está en `docs/04-regulatorio/verifactu.md`.
- **Opciones**:
  1. **VERI*FACTU por servicio web de la AEAT** (máquina a máquina, con certificado). Es la vía prevista por la norma; la §12.1 permite pedir acceso a una API "si compensa claramente".
  2. **NO VERI*FACTU**: sin envío, pero con firma XAdES de cada registro, registro de eventos y más requisitos de conservación. Más complejo y con el certificado usado en cada factura.
  3. **Plan B**: facturar CVPO en enero con un software ya adaptado (Holded si lo está, u otro) y pasar a WineCore cuando supere las pruebas.
- **Recomendación**: **opción 1** (VERI*FACTU por servicio web) con el gate del 01-12-2026 y la opción 3 como plan B. *Computer use* no sirve para Verifactu.
- **Dueño**: Pedro (con su asesor) · **Fecha límite**: 05-11-2026.

## Q-003 · ¿Aprobar la emisión de la factura = aprobar el envío del registro Verifactu? — BLOQUEANTE para M1

- **Contexto**: la regla dura 0.3 exige aprobación humana antes de cualquier envío a la AEAT. En VERI*FACTU el envío del registro es consecuencia automática de emitir la factura y la norma pide que sea inmediato.
- **Opciones**:
  1. La **aprobación de la emisión** (una factura o un lote) por una persona identificada **es** la aprobación del envío de su registro. El envío posterior es automático, con reintentos y alertas. *(Recomendada.)*
  2. Doble aprobación: aprobar la factura y, después, aprobar el envío. Incompatible con la inmediatez exigida y añade riesgo de registros sin enviar.
- **Recomendación**: opción 1. Las facturas sueltas las aprueba quien las emite (si tiene permiso de emisión); los lotes de facturas requieren aprobación expresa en la bandeja.
- **Dueño**: Pedro · **Fecha límite**: 05-11-2026.

## Q-004 · Proyecto Timbal, conexión con GitHub y credenciales — EN CURSO (bloquea M0)

- **Hecho (Pedro, 31-10-2026)**: existe el proyecto **WineCore**, id **3942**, en la org **122**, con el entorno **Main (id 4165)** asociado a la rama `main`. Remoto git: `https://api.timbal.ai/orgs/122/projects/3942/git`. El Composer de Timbal generó **por su cuenta** un andamiaje (commit `f89f339`, 5 ficheros) que se trata como **desechable**: la fuente de verdad es GitHub. GitHub **aún no está conectado** (lo hará Pedro). En este entorno sigo sin credencial de Timbal; no he ejecutado nada contra Timbal y **no he tocado la org 1 ni el proyecto SDR**.
- **Plan de remotos actualizado**: `docs/adr/001-repo-y-remotos.md` (Plan A: conexión de GitHub verificada con la lista V1–V7; Plan B: CI empuja al remoto `timbal`, con un arranque único que sustituye `f89f339` con *lease* sobre su SHA exacta, solo con tu aprobación expresa).
- **Qué falta** (en orden):
  1. **Proteger ramas en GitHub antes de conectar** (`main` con PR y tu aprobación; `staging`/`dev` con PR y checks; sin *force push*; sin *bypass* para apps).
  2. **Conectar GitHub** en el proyecto 3942 (Settings → Git Settings → Connect GitHub, cuenta `pedrolivaresanchez`, repo `pedrolivaresanchez/winecore`, `main` ↔ Main 4165) y **anotar V1–V7** del ADR 001 (permisos que pide la app, qué queda en `main`, si despliega solo, entornos para `staging`/`dev`, entornos efímeros, si el Composer sigue haciendo commits).
  3. **Crear los entornos `staging` y `dev`** asociados a sus ramas y pasarme sus id.
  4. **Solo si hace falta el Plan B**: una **cuenta de Timbal dedicada, miembro solo de la org 122**, y su API key en GitHub Secrets (`TIMBAL_API_KEY`). No uses tu API key personal: hereda permisos en todas tus organizaciones, incluida la org 1.
  5. **No usar el Composer** en `main`, `staging` ni `dev`.
  6. Copia de solo lectura del código del SDR (sigue pendiente) para el sistema de diseño; sin ella, la UI se hace con las reglas de `docs/08-ui/00-sistema-diseno.md`.
- **Recomendación**: Plan A si V2–V4 y V6 salen bien; si no, Plan B.
- **Dueño**: Pedro · **Fecha límite**: 04-11-2026.

## Q-005 · Quién aprueba qué y desde dónde — BLOQUEANTE para M1

- **Contexto**: hay dos "Pedro" en el contexto: Pedro (dueño de producto) y el titular de P.O (su padre, que es quien firma con su certificado). Las reglas exigen "una persona identificada".
- **Preguntas**: ¿quién puede aprobar (a) emisión de facturas de CVPO, (b) de P.O, (c) envíos regulatorios de P.O (SILICIE, SISV, EMCS), (d) EDI? ¿Se puede aprobar desde el chat de CVBOT?
- **Opciones para el canal**: (1) solo en la web de WineCore con verificación reforzada (passkey o TOTP) — CVBOT avisa y manda el enlace; (2) también por chat con un código de un solo uso.
- **Recomendación**: aprobadores configurables por entidad y tipo de trámite; por defecto Pedro y el titular de P.O; **aprobación solo en la web con passkey/TOTP** (opción 1). Evita que una inyección de instrucciones en el chat apruebe un envío.
- **Dueño**: Pedro · **Fecha límite**: 05-11-2026.

## Q-006 · Certificado para Verifactu y su custodia — BLOQUEANTE para M1

- **Preguntas**: ¿qué certificado firmará/autenticará los envíos de CVPO (representante de persona jurídica o sello de entidad) y de P.O (persona física)? ¿Se puede emitir uno específico para el sistema?
- **Opciones** (ADR 003): (1) certificado específico cifrado como secreto de Timbal, usado solo por el paso de envío tras la aprobación; (2) un pequeño servicio de envío en un equipo de Pedro; (3) proveedor externo de envío.
- **Recomendación**: (1) con un certificado **dedicado** (no el personal del móvil), rotación anual y revocación inmediata si hay incidente. Para preproducción vale cualquier certificado reconocido.
- **Dueño**: Pedro · **Fecha límite**: 12-11-2026.

## Q-007 · Productor del software para la declaración responsable — BLOQUEANTE para producción (M1)

- **Contexto**: todo sistema de facturación debe incluir una **declaración responsable** de su productor. Si el desarrollo lo hace Pedro (o una empresa suya o Timbal) para las dos entidades familiares, hay que decidir quién figura como productor y revisarlo con el asesor.
- **Opciones**: (1) Pedro como persona física; (2) una sociedad (CVPO u otra); (3) Timbal.
- **Recomendación**: decidirlo con el asesor antes del 15-12-2026; WineCore mostrará la declaración en Ajustes y en la documentación del sistema.
- **Dueño**: Pedro + asesor · **Fecha límite**: 15-12-2026.

## Q-008 · Plan B de Verifactu — BLOQUEANTE para el gate del 01-12-2026

- **Pregunta**: si el 01-12-2026 WineCore no supera las pruebas en preproducción, ¿con qué se factura CVPO desde el 01-01-2027? ¿Se mantiene la suscripción de Holded hasta entonces?
- **Recomendación**: **no dar de baja Holded** hasta que WineCore emita en producción sin incidencias durante 2 semanas; verificar (ver `docs/04-regulatorio/verifactu.md`) si Holded está adaptado.
- **Dueño**: Pedro · **Fecha límite**: 01-12-2026.

## Q-009 · ¿Qué entidad factura a El Corte Inglés? — Bloquea M3

- **Contradicción**: en la reunión se dice que P.O es quien está dado de alta en ECI; el informe y el handover dicen que CVPO vende a ECI.
- **Opciones**: P.O (como hoy) · CVPO (requiere alta de CVPO como proveedor) · configurable por pedido.
- **Recomendación**: mantener **P.O** (regla por cliente en Ajustes) hasta que haya alta de CVPO en ECI.
- **Fecha límite**: 15-01-2027.

## Q-010 · Fecha fiscal de la salida en SILICIE y naturaleza de TFRP — Bloquea M2

- **Contexto**: D2 dice que el stock fiscal se mueve con la factura y la regla de la bodega es "la barrera es la fecha de facturación". La norma de II.EE. sitúa el devengo en la **salida de fábrica** (ver `docs/04-regulatorio/silicie.md`). Si la mercancía sale físicamente a un operador logístico que no es depósito fiscal, en una inspección el aforo físico será menor que el saldo contable hasta que se facture.
- **Opciones**: (1) salida fiscal en la fecha de la **factura** (D2, como hoy); (2) en la fecha del **albarán** (salida física).
- **Recomendación**: WineCore guarda **las dos fechas** y la regla es configurable (por defecto, D2). Pedir al asesor una confirmación por escrito antes de la primera presentación de 2027. Confirmar también que TFRP **no** es depósito fiscal (supuesto S2).
- **Fecha límite**: 15-12-2026.

## Q-011 · Calendario legal de SILICIE — Bloquea M2 (en verificación)

- La reunión dice "2 declaraciones al año (agosto y diciembre)" por producir < 100.000 L. Estoy verificando la base legal (ver `docs/04-regulatorio/silicie.md`). Pregunta a Pedro/asesor: ¿tienen la autorización o comunicación de la AEAT que lo permite? ¿Fechas exactas de las últimas presentaciones?
- **Fecha límite**: 15-01-2027.

## Q-012 · SISV: periodicidad, acceso y formato — Bloquea M3 (en verificación)

- ¿Cada cuánto se firman y remiten los libros? ¿Se entra con certificado o con usuario y contraseña? ¿SISV permite importar ficheros? ¿Qué libros se usan exactamente (Varietal, Vinos envasados, Envasado, ¿entrada de uva? ¿elaboración?)?
- **Recomendación**: Pedro hace una sesión grabada (captura de pantalla) de un envío real de SISV para diseñar el conector de *computer use*.
- **Fecha límite**: 15-02-2027.

## Q-013 · Fecha de corte, aforo físico y firma — Bloquea M2

- **Opciones**: corte el **31-12-2026** (aforo el 31-12 o el 02-01-2027) · corte a la puesta en marcha de M2.
- **Recomendación**: aforo físico completo (granel por depósito y envasado por ubicación y lote) el **31-12-2026**, firmado por el titular de P.O; WineCore arranca los libros desde ese aforo (no se migran movimientos de SISV/SILICIE). Los descuadres heredados se regularizan **antes** con su motivo.
- **Fecha límite**: 01-12-2026 (para planificarlo).

## Q-014 · Envío de facturas por correo — No bloqueante

- **Contexto**: la reunión pide envío automático de facturas; las reglas prohíben que los agentes envíen correos y exigen aprobación para enviar a terceros.
- **Opciones**: (1) M1: descargar PDF y enviarlo a mano desde Outlook; (2) envío desde un buzón dedicado (p. ej. `facturacion@`) vía Microsoft Graph con permiso solo de envío, disparado por una persona con un clic; nunca por un agente.
- **Recomendación**: (1) en M1 y (2) en M2.
- **Fecha límite**: 30-11-2026.

## Q-015 · Series y numeración desde 2027 — No bloqueante

- **Hecho** (export de Holded): hoy ambas entidades usan `F` + año (2 cifras) + 4 dígitos para facturas, `CN…` para rectificativas y `A…` para albaranes (CVPO). En 2026 hay saltos de numeración y números con sufijo `-1`.
- **Defecto propuesto**: series nuevas por entidad, tipo y año, distintas entre entidades: CVPO `CF27-0001` (facturas), `CR27-0001` (rectificativas), `CA27-0001` (albaranes); P.O `PF27-0001`, `PR27-0001`, `PA27-0001`, y `PI27-0001` para la intercompañía P.O → CVPO. Configurable en Ajustes.
- **Fecha límite**: 20-11-2026.

## Q-016 · Periodicidad de la factura intercompañía — No bloqueante

- **Contradicción**: la reunión dice mensual; el handover habla de fecha de fin de trimestre.
- **Defecto propuesto**: **mensual**, con fecha del último día del mes, generada como borrador el día 1 del mes siguiente y aprobada por una persona.
- **Fecha límite**: 15-12-2026.

## Q-017 · Coste unitario por producto — Bloquea M2

- **Hecho**: el export de productos de Holded no tiene costes (coste 0 en todos). Sin coste, WineCore no puede impedir vender por debajo de coste (D4).
- **Opciones**: (1) coste estándar por producto y añada que Pedro aporta (con fecha de vigencia); (2) coste calculado por partida (módulo de costes, posterior).
- **Recomendación**: (1) en M2; (2) más adelante.
- **Fecha límite**: 15-01-2027.

## Q-018 · Tienda web (Stripe): entidad y países — Bloquea M3

- ¿Qué entidad factura la web (P.O o CVPO)? ¿A qué países se venderá?
- **Riesgo**: vender vino a consumidores de otros países de la UE obliga a pagar II.EE. en destino (con representante fiscal) y puede requerir OSS de IVA. En Shopify hay pedidos a Alemania, Dinamarca, Francia y Países Bajos.
- **Recomendación**: CVPO; envíos solo a España (península y Baleares) hasta resolverlo con el asesor.
- **Fecha límite**: 15-02-2027.

## Q-019 · Ventas fuera de España: e-DA/e-DAS e IVA — Bloquea M3

- Reino Unido no es UE: es exportación (no entrega intracomunitaria). Canarias está fuera del territorio IVA. Las ventas B2B a la UE con impuesto pagado requieren documento electrónico en EMCS desde 2024 (en verificación).
- **Pregunta**: ¿qué entidad expide hoy los e-DA y cómo se documentan las ventas de CVPO a Francia/Dinamarca? Revisarlo con el asesor.
- **Fecha límite**: 15-01-2027.

## Q-020 · Códigos de depósitos y formatos — Bloquea M2

- La reunión nombra depósitos "Inox 1–32" e "Inox B1–B7"; los correos y SISV usan "D1, D2, D3…". ¿Cuál es la correspondencia? ¿Capacidad de cada uno? ¿Barricas y damajuanas (número y capacidad)? ¿Formatos de BIB (3, 5, 10 L…)?
- **Recomendación**: Pedro comparte la carpeta "Depósitos" de OneDrive y el plano; WineCore usa códigos propios con el código SISV como atributo.
- **Fecha límite**: 15-12-2026.

## Q-021 · Almacenes externos y propiedad del stock — Bloquea M2

- **Hecho** (export): Holded de CVPO tiene un único almacén con stock (unos 922 albaranes salen de él), distinto de la bodega.
- **Preguntas**: ¿ese almacén es TFRP? ¿Qué stock es de P.O y cuál de CVPO en cada operador (TFRP, Ecovitis, Grupamar, Valencia)? ¿Algún operador es depósito fiscal?
- **Fecha límite**: 15-12-2026.

## Q-022 · Alcance contable — Bloquea M7

- **Hecho** (export): la contabilidad de Holded solo contiene cuentas de clientes, proveedores, ventas, compras, IVA y un banco (sin grupo 1 ni 3); la contabilidad oficial parece llevarla la asesoría.
- **Opciones**: (1) WineCore exporta libros de IVA y facturas a la asesoría; (2) WineCore lleva la contabilidad completa (PGC, cierres).
- **Recomendación**: (1) en el MVP; (2) solo si la asesoría lo pide.
- **Fecha límite**: 01-04-2027.

## Q-023 · Clientes de Shopify a migrar — Bloquea M7

- **Hecho** (export): 2.305 clientes, pero solo 133 tienen al menos un pedido y 114 aceptaron marketing.
- **Recomendación** (minimización RGPD): migrar solo clientes con pedidos o con consentimiento (unos 212); el resto queda en el archivo cifrado de `data/` hasta su borrado.
- **Fecha límite**: 01-04-2027.

## Q-024 · AECOC/ECI — Bloquea M3 (Pedro lo pasará más adelante, §12.3)

- GTIN de cada formato, GLN de las entidades, si ECI exige DESADV/SSCC, credenciales de AecocEDI (al gestor de secretos), y si los términos de AecocEDI permiten *computer use*.
- **Fecha límite**: 15-02-2027.

## Q-025 · Reglas iniciales de entidad facturadora — No bloqueante para empezar M1

- **Defecto propuesto** (D3): por defecto **CVPO**; por cliente: El Corte Inglés → **P.O**; exportación con e-DA (Reino Unido) → **P.O** (es quien expide el e-DA según el export de Holded); intercompañía → **P.O**.
- **Fecha límite**: 20-11-2026.

## Q-026 · Equipo dedicado para el ejecutor local — Bloquea M2

- **Contexto**: Timbal no ofrece *computer use* ni custodia de certificados (sus variables secretas llegan a todos los componentes). Para operar SILICIE, EMCS, SISV y AecocEDI por *computer use* sin sacar el certificado de P.O a la nube, propongo un **ejecutor local** (ADR 009) en un equipo dedicado (el ordenador nuevo que se mencionó en la reunión) con el certificado en su llavero.
- **Opciones**: (1) equipo dedicado en la bodega o en casa de Pedro, encendido en horario laboral; (2) el portátil de Pedro (peor: mezcla usos); (3) navegador en Timbal con el certificado como secreto (no recomendable).
- **Recomendación**: (1). Requisitos mínimos: macOS o Linux actual, disco cifrado, usuario de sistema propio, conexión estable; ningún puerto abierto hacia fuera.
- **Fecha límite**: 15-12-2026.

## Q-027 · Cuenta de AWS para la base de datos y los ficheros — Bloquea M0

- **Contexto**: la Knowledge Base de Timbal es DuckDB por HTTP sin transacciones documentadas: no sirve para facturas, numeración ni libros fiscales (ADR 002).
- **Opciones**: (1) **AWS RDS PostgreSQL + S3 en eu-north-1** (misma región que Timbal; ~25–40 €/mes); (2) Neon (PostgreSQL serverless en la UE) + S3; (3) Supabase.
- **Recomendación**: (1), cuenta de AWS a nombre de CVPO con facturación a CVPO, MFA en la cuenta raíz y un usuario administrador para Pedro. Necesito que me digas quién la crea; yo no necesito acceso a la consola, solo las cadenas de conexión como secretos de Timbal y de GitHub.
- **Fecha límite**: 06-11-2026.

## Q-028 · Preguntas técnicas a Timbal — Bloquea M0 (parcialmente)

- Lista completa en `07-arquitectura.md` §14. Las urgentes para M0: (a) si `timbalAuth` permite rutas de máquina con token propio (`/api/m2m/*`, MCP de CVBOT, webhooks); (b) quién puede iniciar sesión en la app (solo miembros/invitados de la org 122); (c) si un merge en GitHub despliega solo (se verá al conectar GitHub, V3); (d) IP de salida fija o red privada hacia la base de datos.
- **Dueño**: Pedro (canaliza con Timbal) · **Fecha límite**: 06-11-2026.

## Q-029 · Canal de eventos hacia CVBOT — Bloquea M1

- **Contexto**: §12.1 pide que WineCore avise a CVBOT de trámites (aprobaciones pendientes, vencimientos, pedidos EDI, incidencias).
- **Pregunta**: ¿CVBOT tiene una URL para recibir eventos? ¿Con qué autenticación?
- **Defecto propuesto**: `POST` JSON a `CVBOT_EVENTS_URL` con cabecera `X-WineCore-Signature: sha256=<HMAC del cuerpo>` y reintentos (1 min, 5 min, 30 min, 2 h). Si CVBOT no puede recibir, consultará `approvals_list_pending` y `regulatory_obligations_list` por MCP periódicamente.
- **Fecha límite**: 13-11-2026.
