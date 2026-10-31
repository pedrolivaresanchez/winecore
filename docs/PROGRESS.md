# Progreso WineCore — actualizado 31-10-2026 12:27 CET (Europe/Madrid)
Fase: 1 · Hito: especificación (antes de M0) · Estado: en curso

## Hecho desde la última actualización
- Leído el plan maestro y todo el contexto (reunión, resumen, traspaso de la administradora, especificación previa, informe y mapeo).
- Analizados los exports reales de Holded y Shopify **en local** (solo estructura y totales; nada se sube a GitHub).
- Hallazgo importante: el volumen real es de unas **250 facturas al año en CVPO y 100 en P.O** (el plan suponía 1.000 y 500). Es más sencillo de lo previsto.
- Hallazgo importante: el repositorio de GitHub es **público**. Todo lo que he subido está anonimizado. Hay que hacerlo privado (pregunta Q-001).
- Escrito el triaje (`docs/00-triaje.md`): 31 contradicciones, 23 riesgos y 25 preguntas (`docs/QUESTIONS.md`).
- Creada la rama `spec/fase-1`. Los datos reales están en la carpeta `data/`, que git ignora.

## Siguiente
- Terminar la verificación normativa (Verifactu, SILICIE, SISV, EMCS, AecocEDI, etiquetado y ecológico) y de la plataforma Timbal.
- Escribir el resto de la especificación: producto, modelo de datos, estados, regulatorio, migración, arquitectura, pantallas, hitos, tareas y tests.
- Abrir la solicitud de revisión (PR) para que Pedro la apruebe.

## Bloqueos
- No hay credenciales de Timbal en este entorno: el proyecto WineCore de la org 122 aún no existe (Q-004). No bloquea la especificación; sí el arranque de la Fase 2.

## Necesita decisión de Pedro   (pregunta · opciones · recomendación · fecha límite)
- **Q-001 Repo público** · hacerlo privado / repo nuevo privado / dejarlo público · **hacerlo privado hoy** · 03-11-2026.
- **Q-004 Proyecto Timbal** · lo crea Pedro / me da una credencial · **Pedro lo crea en la org 122, conecta GitHub y genera una clave para CI** · 04-11-2026.
- **Q-002 Verifactu** · envío por servicio web / sin envío con firma / software externo en enero · **servicio web** (el *computer use* no sirve para Verifactu) · 05-11-2026.
- **Q-003 Aprobación en Verifactu** · aprobar la factura ya aprueba su envío / doble aprobación · **aprobar la factura ya aprueba su envío** · 05-11-2026.
- **Q-005 Quién aprueba** · solo en la web con verificación / también por chat · **solo en la web; CVBOT avisa y manda el enlace** · 05-11-2026.
- **Q-006 Certificado** · certificado dedicado cifrado en Timbal / equipo de Pedro / proveedor externo · **certificado dedicado cifrado** · 12-11-2026.
- Resto de preguntas (no urgentes): ver `docs/QUESTIONS.md`.

## Riesgos (R1… con estado)
- R1 Verifactu de CVPO no listo para el 01-01-2027 · **abierto, el más grave**; control el 01-12-2026 con plan B.
- R14 Repo público · **abierto**; mitigado con contenido anonimizado.
- R13 Fecha fiscal por factura frente a salida física (inspección) · abierto; requiere confirmación del asesor.
- R5 Descuadres heredados · abierto; se resuelven con un aforo físico antes de cargar el stock.
- R20 Plazo de M1 muy corto · abierto; depende de aprobar la especificación en 2–3 días.
- Lista completa (R1–R23) en `docs/00-triaje.md`.

## Coste y créditos (Opus/Grok usados; escalados con su motivo)
- **Agente principal**: 1 especificador con Claude Opus 5.5 (razonamiento máximo).
- **Subagentes lanzados en total: 8**, todos con **Claude Opus 5.5** (el mismo modelo que el especificador) y todos de **investigación documental** de fuentes oficiales: Timbal, Verifactu, SILICIE/EMCS, SISV/Junta, ecológico y etiquetado, AecocEDI, Holded/Bacosoft y modelos de la AEAT. Se lanzaron a las 12:03 CET, **antes** de la instrucción de Pedro de limitar el gasto (12:25 CET).
- **Límite aplicado desde las 12:25 CET**: máximo **2 subagentes Opus en paralelo**. Los 8 ya lanzados no se pueden detener con las herramientas disponibles, así que **no se lanzará ninguno nuevo hasta que terminen**. Después: solo si una tarea no la puedo hacer yo directamente y reutilizando el contexto de un subagente ya terminado antes que lanzar uno nuevo. Toda la redacción de la especificación la hago yo.
- Sin escalados (aún no hay Fase 2).

## Enlaces (PRs, despliegue de staging)
- Rama: `spec/fase-1` (el PR se abrirá al terminar la especificación).
- Staging: no existe todavía (pendiente del proyecto Timbal).
