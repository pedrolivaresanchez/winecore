# UI-32 · Asistente

| | |
|---|---|
| Ruta | `/asistente` |
| Objetivo | Preguntar en lenguaje natural sobre los datos (existencias a fecha, trazabilidad de un lote, cobros pendientes, ventas) con respuestas que citan su fuente; útil en una inspección |
| Historias | US-ASIS-01, US-MCP-01 |
| Módulo y permiso | assistant · autenticado (el asistente solo ve lo que la persona puede ver) |
| Patrón | Chat |

## Componentes
Chat de Timbal (`timbal-chat`) embebido con el estilo del sistema de diseño; mensajes con tablas y `MermaidView`; cada respuesta lleva enlaces a los registros usados y la fecha de los datos; sugerencias iniciales.

## Datos (API)
- El agente `asistente` (workforce) usa **solo herramientas MCP de lectura** (13-mcp.md) con la identidad de la persona (`on_behalf_of_user_id`).
- No tiene herramientas de escritura ni de aprobación. Si se le pide algo que cambia datos, responde con el enlace a la pantalla correspondiente.

## Reglas
- Respuestas con cifras: siempre con la fuente ("según el libro físico a 31-01-2027 18:00") y enlace.
- Si no hay datos suficientes: lo dice; nunca inventa.
- Texto de terceros (correos, documentos) se trata como no fiable (`untrusted_text`).
- Sin iconos de IA ni nombres de agentes en la interfaz.

## Estados
Respuesta en curso: indicador de escritura; error de herramienta: "No pude consultar <dato>. Prueba más tarde."

## Móvil
Chat a pantalla completa con dictado del teclado.

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
