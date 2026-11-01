# UI-32 · Asistente

| | |
|---|---|
| Ruta | `/asistente` |
| Objetivo | Preguntar en lenguaje natural sobre los datos (existencias a fecha, trazabilidad de un lote, cobros pendientes, ventas) con respuestas que citan su fuente; útil en una inspección |
| Historias | US-ASIS-01, US-MCP-01 |
| Módulo y permiso | assistant · autenticado (el asistente solo ve lo que la persona puede ver) |
| Patrón | Chat |

## Componentes
Dock flotante abajo a la derecha en cualquier pantalla (lanzador en el rail, «Preguntar al asistente» en Cmd-K, Cmd/Ctrl+J) que se amplía a `/asistente` con el mismo hilo (`src/app/shell/assistant-*`). Mensajes con párrafos, listas, negritas y enlaces internos; un chip por herramienta consultada; enlaces a los registros usados; sugerencias según las herramientas que la persona puede usar; parar y reintentar; conversación en `sessionStorage`.

## Datos (API)
- `POST /v1/assistant/chat` (SSE con `Accept: text/event-stream`) y `GET /v1/assistant/status`. El workflow `asistente` (workforce) decide; la API ejecuta las herramientas MCP con la sesión de la persona (13-mcp.md), con la ruta actual como contexto.
- Lecturas libres. Escrituras solo con `*_prepare`: la respuesta enseña el resumen y una tarjeta Confirmar/Cancelar, y el `*_commit` solo se ejecuta si el siguiente mensaje lo confirma sin condiciones. Sin herramientas de aprobación, emisión, anulación ni envío.
- Sin workforce conectada (`WINECORE_ASSISTANT_URL`), la API responde 503 `WC_ASSISTANT_UNAVAILABLE` y el dock lo explica.
- Despliegue (1-11-2026): el miembro `workforce/asistente` se despliega con `timbal push`. `WINECORE_ASSISTANT_URL` apunta a su ejecución en la plataforma (`https://api.timbal.ai/orgs/122/projects/3942/workforce/asistente/run?rev=main`) y es una variable normal del entorno. Sin `WINECORE_ASSISTANT_TOKEN`, la API usa la credencial del proyecto, solo si la URL es del propio host de Timbal. La entrada del workflow es `{ conversation, catalog, screen }`: Timbal reserva `messages` y `context`.

## Reglas
- Respuestas con cifras: siempre con la fuente ("según el libro físico a 31-01-2027 18:00") y enlace.
- Si no hay datos suficientes: lo dice; nunca inventa.
- Texto de terceros (correos, documentos) se trata como no fiable (`untrusted_text`).
- Sin iconos de IA ni nombres de agentes en la interfaz.

## Estados
Respuesta en curso: chips «Consultando…» y «Pensando»; herramienta con error: chip en rojo con el motivo al pasar por encima; turno cortado o parado: el motivo y «Reintentar»; sin conectar: estado vacío con aviso.

## Móvil
El dock ocupa el ancho de la pantalla; el botón de la barra superior lo abre y se puede ampliar a pantalla completa.

## Wireframe
```
Asistente
  ¿Cuánto vino hay en cada depósito ahora?
  ┌ Existencias a 31-01-2027 18:02 (libro físico) ────────────┐
  │ INOX-03 L25-T01 4.800 L · BAR-012 L24-C02 225 L · …       │
  │ Ver en Existencias →                                        │
  └────────────────────────────────────────────────────────────┘
[Escribe una pregunta…]                                    [Enviar]
```
