# Progreso WineCore — actualizado 31-10-2026 13:00 CET (Europe/Madrid)
Fase: 1 · Hito: especificación (antes de M0) · Estado: en curso

## Hecho desde la última actualización
- **Proyecto Timbal**: anotados los datos que me ha pasado Pedro (proyecto WineCore id 3942 en la org 122, entorno Main 4165 con la rama `main`). El andamiaje que creó Timbal por su cuenta (commit `f89f339`) se descarta. Plan de remotos rehecho con dos caminos: A) conectar GitHub desde Timbal (lo hará Pedro) y comprobar 7 puntos; B) que la integración continua empuje a Timbal. Ver `docs/adr/001-repo-y-remotos.md`.
- **Repo público**: Pedro decide mantenerlo público de momento. Todo sigue anonimizado y la integración continua bloquea datos reales y datos personales.
- **Modelo de datos completo** (15 bloques de tablas) y **comprobado en una base de datos real de pruebas**: pasan las 15 pruebas de reglas básicas (no se borra nada, numeración sin huecos, el volumen de vino cuadra en cada operación, no hay existencias negativas, las facturas emitidas no se pueden tocar, las aprobaciones valen solo para lo que se aprobó, la cadena de Verifactu no se puede alterar).
- Escritos: modelo de dominio, estados de cada documento, arquitectura y 9 decisiones técnicas (repo, base de datos, despliegue, acceso, conector con los portales, MCP, ubicación del núcleo) y el catálogo completo de herramientas MCP para CVBOT.
- Hallazgos de la investigación de Timbal que cambian el plan: su base de datos interna no sirve para facturas (no garantiza transacciones), no ofrece navegador automatizado ni custodia de certificados, y sus claves de acceso valen para todas las organizaciones del usuario (riesgo para la org 1). Propuestas: base de datos PostgreSQL en AWS (UE), equipo dedicado en la bodega para los trámites con certificado, y una cuenta de Timbal solo para la org 122.

## Siguiente
- Incorporar la investigación normativa que falta (Verifactu, SILICIE/EMCS, SISV, AecocEDI, modelos AEAT, Holded/Bacosoft) y escribir los documentos regulatorios.
- Producto (PRD), pantallas, hitos con fechas, tareas pequeñas para los agentes, tests y glosario.
- Abrir el PR de la especificación para que Pedro la apruebe.

## Bloqueos
- Sin credencial de Timbal (no hace falta para la especificación). Para arrancar M0 falta que Pedro conecte GitHub en Timbal, cree los entornos `staging` y `dev`, y que haya cuenta de AWS para la base de datos (Q-004, Q-027).

## Necesita decisión de Pedro   (pregunta · opciones · recomendación · fecha límite)
- **Q-004 Conectar GitHub en Timbal** · conexión de GitHub (Plan A) / que la integración continua empuje (Plan B) · **Plan A, protegiendo antes las ramas de GitHub y anotando las 7 comprobaciones del ADR 001** · 04-11-2026.
- **Q-002 Verifactu** · envío por servicio web / sin envío con firma / software externo en enero · **servicio web** (el *computer use* no sirve para Verifactu) · 05-11-2026.
- **Q-003 Aprobación en Verifactu** · aprobar la factura ya aprueba su envío / doble aprobación · **aprobar la factura ya aprueba su envío** · 05-11-2026.
- **Q-005 Quién aprueba** · solo en la web con verificación / también por chat · **solo en la web; CVBOT avisa y manda el enlace** · 05-11-2026.
- **Q-027 Base de datos** · AWS (UE) / Neon / Supabase · **AWS en Estocolmo, cuenta a nombre de CVPO (~25–40 €/mes)** · 06-11-2026.
- **Q-028 Preguntas a Timbal** · — · **reenviar la lista de `07-arquitectura.md` §14** · 06-11-2026.
- **Q-006 Certificado para Verifactu** · certificado dedicado cifrado en Timbal / equipo de Pedro / proveedor externo · **certificado dedicado** · 12-11-2026.
- Resto (no urgentes, con valor por defecto): ver `docs/QUESTIONS.md` (29 preguntas).

## Riesgos (R1… con estado)
- R1 Verifactu de CVPO no listo para el 01-01-2027 · **abierto, el más grave**; control el 01-12-2026 con plan B.
- R14 Repo público · **aceptado por Pedro y vigilado** (contenido anonimizado y barreras en la integración continua).
- R10 Despliegue doble o remotos desincronizados · abierto; **se confirmó** que Timbal hace commits por su cuenta: prohibido usar su editor en las ramas de entorno.
- R19 Capacidades de Timbal no documentadas · abierto; preguntas en Q-028.
- R13 Fecha fiscal por factura frente a salida física · abierto; requiere confirmación del asesor.
- R20 Plazo de M1 muy corto · abierto; depende de aprobar la especificación en 2–3 días.
- Lista completa (R1–R23) en `docs/00-triaje.md`.

## Coste y créditos (Opus/Grok usados; escalados con su motivo)
- **Agente principal**: 1 especificador con Claude Opus 5.5 (razonamiento máximo).
- **Subagentes lanzados en total: 8**, todos con **Claude Opus 5.5** y todos de **investigación documental** (Timbal, Verifactu, SILICIE/EMCS, SISV/Junta, ecológico y etiquetado, AecocEDI, Holded/Bacosoft, modelos de la AEAT). Lanzados a las 12:03 CET, antes de la instrucción de limitar el gasto. Han terminado 2 de 8 (Timbal; ecológico y etiquetado). **No se ha lanzado ninguno más**; límite desde las 12:25 CET: máximo 2 en paralelo y solo si no puedo hacerlo yo.
- Sin escalados (aún no hay Fase 2).

## Enlaces (PRs, despliegue de staging)
- Rama: `spec/fase-1` (el PR se abrirá al terminar la especificación).
- Proyecto Timbal: org 122, proyecto 3942, entorno Main 4165 (sin despliegue de WineCore todavía).
- Staging: no existe todavía.
