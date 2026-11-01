# UI-32 · Asistente

| | |
|---|---|
| Ruta | `/asistente` |
| Objetivo | Preguntar en lenguaje natural sobre los datos (existencias a fecha, trazabilidad de un lote, cobros pendientes, ventas) con respuestas que citan su fuente; útil en una inspección |
| Historias | US-ASIS-01, US-MCP-01 |
| Módulo y permiso | assistant · autenticado (el asistente solo ve lo que la persona puede ver) |
| Patrón | Chat |

## Componentes
Dock flotante abajo a la derecha en cualquier pantalla (lanzador en el rail, «Preguntar al asistente» en Cmd-K, Cmd/Ctrl+J) que se amplía a `/asistente` con el mismo hilo (`src/app/shell/assistant-*`). Mensajes con párrafos, listas, negritas y enlaces internos; un chip por herramienta consultada, con su título («Ficha de contacto»); enlaces a los registros usados; tarjeta Confirmar/Cancelar cuando el agente va a escribir; sugerencias según las herramientas que la persona puede usar; parar y reintentar; conversación en `sessionStorage`.

El chat corre sobre el runtime de Timbal (`useTimbalStream` de `@timbal-ai/timbal-react`), que se carga bajo demanda al abrir el asistente por primera vez (~554 kB gzip, fuera del arranque). La interfaz sigue siendo la del sistema de diseño: el runtime no dibuja nada. `src/lib/assistant-stream.ts` sigue la misma respuesta SSE y guarda, por ejecución, las herramientas consultadas, los enlaces, la aprobación pendiente y cómo acabó el turno.

## Datos (API)
- `POST /api/workforce/asistente/stream` (SSE): lo sirve la pasarela del entorno de Timbal al miembro `workforce/asistente`, un **agente nativo** (ADR 012). No pasa por la API de WineCore. La interfaz lo llama con la sesión de la persona (Bearer) y añade la pantalla (`screen: { path, date }`: ruta actual y fecha del día) a cada turno.
- El agente usa las herramientas del servidor MCP de la API (`POST /api/mcp`, alias de `/m2m/mcp`, 13-mcp.md) con la identidad de quien pregunta: mismos permisos, módulos activos, auditoría `mcp.call` y límite por minuto.
- `GET /v1/assistant/status`: las herramientas que esa persona puede usar, con su título. Sirve para las sugerencias y para nombrar los chips.
- Lecturas y `*_prepare`, libres. Todo lo que escribe o decide (`*_commit` y cualquier herramienta sin marca de solo lectura) pausa la ejecución con una **aprobación** de Timbal: el dock enseña el `summary_es` de la preparación y los botones Confirmar y Cancelar. Confirmar reanuda la misma ejecución y el resultado se pliega en el mismo mensaje; Cancelar, o escribir otra cosa, descarta la escritura sin enviar nada. No hay herramientas de aprobación, emisión, anulación ni envío: las gobierna la web.
- El miembro se busca por nombre (`asistente`, `VITE_ASSISTANT_WORKFORCE`), nunca como «el primero»: el proyecto también tiene `ocr-gastos`.
- En desarrollo, Vite reenvía `/api/workforce` al servidor de la workforce (`VITE_WORKFORCE_PROXY_TARGET`, por defecto `http://localhost:4455`).
- Despliegue y comprobación: `adr/012-asistente-como-agente-nativo-de-timbal.md`.

## Reglas
- Respuestas con cifras: siempre con la fuente («según el libro físico a 31-01-2027 18:00») y enlace.
- Si no hay datos suficientes: lo dice; nunca inventa.
- Texto de terceros (correos, documentos) se trata como no fiable (`untrusted_text`).
- Sin iconos de IA ni nombres de agentes en la interfaz.
- Los enlaces que devuelven las herramientas (`links.web`) son absolutos (`APP_PUBLIC_URL`); la interfaz solo los abre como ruta interna si son de su mismo origen. Cualquier otro enlace queda como texto.
- El `confirmation_token` no se muestra: la interfaz solo lo usa para ligar la tarjeta con el resumen de su preparación, y confirmar reenvía únicamente la respuesta a la aprobación.

## Estados
Respuesta en curso: chips «Consultando…» y «Pensando»; herramienta con error: chip en rojo con el motivo al pasar por encima; escritura pendiente: tarjeta «Pendiente de tu confirmación» con el resumen y la caducidad; cancelada: «Cancelado. No se ha guardado nada.»; turno cortado o parado: el motivo y «Reintentar»; demasiadas preguntas seguidas (429): «Espera un minuto»; asistente no disponible o sin acceso: aviso con «Reintentar»; el runtime no carga: aviso para volver a probar.

## Móvil
El dock ocupa todo el ancho de la pantalla (390×844 comprobado); el botón de la barra superior lo abre y se puede ampliar a pantalla completa. La tarjeta de confirmación cabe sin desplazamiento horizontal.

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
