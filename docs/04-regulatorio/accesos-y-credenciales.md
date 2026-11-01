# Accesos y credenciales para operar SILICIE y lo fiscal

> Versión 1 · 1-11-2026. Pensado para Pedro y la administradora. Dice qué hace falta, quién lo da, cómo y cuándo. Ningún valor secreto va en git ni en un chat: se entrega en mano, por la consola de Timbal o por el gestor de contraseñas de la familia.
> Relacionado: `silicie.md`, `emcs.md`, `sisv.md`, `verifactu.md`, ADR 003 (custodia del certificado), ADR 009 (ejecutor local), Q-006, Q-012, Q-019, Q-026.

## 0. Qué hace hoy el sistema actual y qué sustituye WineCore

| Trámite | Quién lo hace hoy | Con qué | Qué hará WineCore |
|---|---|---|---|
| Asientos de SILICIE (mayores por producto) | La administradora, a mano en la sede de la AEAT | Certificado de P.O y el CAE de P.O | Genera los asientos y el fichero de importación; una persona los aprueba y el ejecutor local los presenta con el certificado de P.O (ADR 009) |
| e-DA (documento electrónico de transporte, EMCS) | La administradora, tecleando el formulario | Certificado de P.O | Prepara el borrador con los datos del albarán; lo presenta el ejecutor local tras aprobación |
| SISV (libros del vino, Junta de Andalucía) | Bacosoft genera los ficheros; la administradora los importa | Certificado de la persona dada de alta | Genera los ficheros de ancho fijo; los importa el ejecutor local tras aprobación |
| Facturas con Verifactu | Holded (envía con el certificado de la empresa o como colaborador social) | Holded | Hasta M4 sigue Holded para CVPO (y para P.O si Holded ya envía registros). Después, WineCore envía por servicio web |
| Modelos AEAT (303, 390, 347, 349, 115, 130) | La administradora | Certificado o Cl@ve | Aplazado: WineCore solo prepara borradores; no presenta |

Regla de oro: **WineCore no presenta nada a la AEAT sin aprobación humana previa** y los certificados **no se guardan en el entorno principal de Timbal** (llegarían a la UI, a la API y a los agentes). Quedan en el equipo del ejecutor local (portales) o en un entorno aislado de Timbal (envío automático de Verifactu).

## 1. Lista concreta de lo que hace falta

| # | Qué | Para qué | Quién lo da | Cómo | Cuándo | Estado |
|---|---|---|---|---|---|---|
| 1 | **Certificado digital de P.O** (persona física, FNMT u otro prestador reconocido), fichero `.p12` o `.pfx` con contraseña | Entrar en SILICIE, EMCS y SISV; firmar trámites de P.O | El titular de P.O (la persona que hoy lo usa) | Exportarlo desde el navegador o el equipo donde está instalado («Exportar con la clave privada», contraseña larga). Se instala **solo** en el equipo del ejecutor local (llavero del sistema). No se sube a Timbal ni a git | Antes del primer envío real de SILICIE (cierre del ejercicio y apertura de 2027) | Existe (lo usa la administradora). Falta copiarlo al equipo dedicado |
| 2 | **Equipo dedicado para el ejecutor local** (macOS o Linux actual, disco cifrado, usuario propio, encendido en horario laboral) | Alojar el certificado de P.O y ejecutar los trabajos aprobados | Pedro | Elegir el equipo (el ordenador nuevo de la reunión) y pasarme el sistema operativo; yo preparo el instalador (`runner/`) | 15-12-2026 (Q-026) | Pendiente |
| 3 | **CAE de P.O `ES00023V1013E`** y datos del establecimiento: dirección, tipo de almacén fiscal, códigos de actividad, categorías de producto autorizadas | Cada asiento de SILICIE lleva el CAE; se carga en `regulatory.tax_warehouse` | Administradora (copia de la ficha del CAE en la sede o el documento de alta) | Foto o PDF de la ficha del CAE. Yo lo cargo en Puesta en marcha. No hace falta ninguna contraseña | Antes del aforo de arranque | El código ya está; falta la ficha |
| 4 | **CVPO sin CAE** (confirmación por escrito) | Saber qué mercancía pasa por el CAE de P.O y cuál por CVPO. CVPO no puede tener vino en suspensión sin CAE propio | Administradora o asesor | Un correo con la respuesta a: ¿CVPO compra el vino a P.O con impuesto ya devengado o con salida en suspensivo a un destinatario registrado? ¿Va a pedir CAE propio? | 15-01-2027 (Q-019) | Pendiente |
| 5 | **Certificado de representante de CVPO** (persona jurídica) o **sello electrónico** de CVPO | Verifactu de CVPO (envío automático, M4); trámites de CVPO | Representante legal de CVPO (Pedro) | Solicitar al prestador (FNMT: «Certificado de representante de persona jurídica» o «sello electrónico»). Lo sube Pedro **solo** al entorno aislado `verifactu` de Timbal, como variable secreta (ADR 003). Para pruebas basta un certificado reconocido de pruebas | 15-12-2026 (Q-006) | Aplazado por Pedro hasta el final |
| 6 | **Apoderamientos** en la sede de la AEAT | Que un solo certificado pueda actuar por ambas sociedades: P.O apodera a CVPO para Verifactu; el titular de P.O apodera a la persona designada para SILICIE, EMCS y modelos si no es él quien firma | Titular de P.O y representante de CVPO; el asesor lo tramita | En la sede, «Apoderamientos» (o presentación por colaboración social del asesor). Hay que confirmar con el asesor el alcance exacto (trámites y plazo) | Antes de activar Verifactu en producción | Pendiente de decidir con el asesor |
| 7 | **Entorno de pruebas** de SILICIE 2.0 y CAE de pruebas | Probar la batería de asientos de `api/test/golden/silicie/` con 0 errores antes de presentar nada real | Administradora o asesor | Pedir a la AEAT el acceso al entorno de pruebas de SILICIE (es el mismo certificado). Mientras no se tenga, el primer fichero real se presenta con revisión manual de la administradora | Antes de la primera presentación real | Pendiente (supuesto: se pide con el asesor) |
| 8 | **Entorno de preproducción de Verifactu** (`prewww1`/`prewww10`) | Gate del 01-12-2026 con datos sintéticos | Nadie: lo hago yo | Basta cualquier certificado reconocido de pruebas, no hace falta cerrar la decisión del certificado definitivo | 01-12-2026 | Listo para empezar cuando haya certificado de pruebas |
| 9 | **Declaración responsable del productor del software** (Verifactu) | Obligatoria por versión del sistema | Pedro con el asesor: decidir quién figura como productor (Pedro, CVPO u otra) | Documento firmado; WineCore lo muestra en Ajustes → Verifactu y la integración continua lo exige antes de desplegar | 15-12-2026 (Q-007) | Pendiente |
| 10 | **Acceso a SISV** de la Junta de Andalucía: persona dada de alta, matrícula RIA, códigos SISV de los depósitos | Importar los libros del mes (antes del día 10 del mes siguiente) | Administradora | Indicar quién tiene hoy el acceso y con qué certificado; matrícula RIA y la lista de códigos de depósito | 15-02-2027 (Q-012) | Pendiente |
| 11 | **Un fichero real de Bacosoft por libro** de un mes reciente | Validar los ficheros que genera WineCore | Administradora | Entregar los ficheros a Pedro; se guardan solo en `data/` (no en git) | 15-02-2027 | Pendiente |
| 12 | **Garantía y datos de e-DA/e-DAS** (ventas fuera de España) | Documentos EMCS de las ventas a la UE con impuesto pagado | Asesor | Respuesta a Q-019: qué entidad expide hoy los e-DA y cómo se documentan las ventas de CVPO a Francia y Dinamarca | 15-01-2027 | Pendiente |
| 13 | **Cl@ve** (opcional) | Alternativa al certificado en portales que la admiten | Titular de P.O | Alta en Cl@ve Permanente. No sustituye al certificado en SILICIE ni en Verifactu por servicio web | Solo si el asesor lo pide | Opcional |
| 14 | **Organismo de control ecológico** y certificado vigente de P.O (y de CVPO si lo tiene) | Etiquetado y trazabilidad ecológica | Pedro | PDF del certificado y el código `ES-ECO-0XX-AN` | 15-02-2027 | Pendiente |

## 2. Qué no hace falta (y por qué)

- Ninguna contraseña de la AEAT en WineCore: los portales se usan con el certificado del equipo dedicado.
- Ninguna API key de Holded para presentar nada: Holded solo se usa para el histórico y, hasta M4, para emitir con Verifactu.
- Ninguna credencial bancaria: los extractos entran por fichero (Norma 43 o CSV) y las remesas SEPA se descargan y se suben a mano al banco.

## 3. Cómo se entrega cada cosa (sin riesgos)

1. **Certificados**: en mano, en un USB cifrado, o exportados por la propia persona al equipo dedicado. Nunca por correo, chat ni repositorio.
2. **Secretos para Timbal** (certificado de CVPO para Verifactu): los sube Pedro desde la consola de Timbal, en el entorno `verifactu`, y nadie más ve el fichero ni la contraseña (ADR 003).
3. **Datos que no son secretos** (CAE, matrícula RIA, códigos de depósito): por escrito a Pedro; los carga el equipo en Puesta en marcha o por la API en producción.
4. **Aviso de caducidad**: WineCore avisa 30 días antes de que caduque un certificado.

## 4. Orden recomendado

1. Esta semana: confirmar con la administradora el CAE y la ficha del almacén fiscal (3) y quién firma hoy en la AEAT (1, 6).
2. Antes del 01-12-2026: certificado de pruebas para el gate de Verifactu (8) y decisión de productor (9).
3. Antes del 15-12-2026: equipo dedicado (2), certificado de CVPO (5) y apoderamientos (6).
4. Enero de 2027: apertura de 2027 en SILICIE con entorno de pruebas (7) y respuesta de e-DA (4, 12).
5. Febrero de 2027: SISV (10, 11) y organismo de control (14).
