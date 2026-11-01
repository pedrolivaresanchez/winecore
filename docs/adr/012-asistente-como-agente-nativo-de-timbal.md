# ADR 012 · El asistente como agente nativo de Timbal

- **Estado**: propuesto · 1-11-2026
- **Fuentes** (1-11-2026): https://docs.timbal.ai/agents/mcp (`MCPServer(..., service="api")`), https://docs.timbal.ai/deployment/platform (la pasarela del entorno sirve la UI en la raíz, la API en `/api/...` y cada miembro de la workforce en `/api/workforce/<miembro>/...`), código del SDK de Python (`timbal/platform/utils.py::_resolve_url_and_headers`: URL y credenciales de `service="api"`; puerta de aprobación de `MCPServer(approval=...)` y reanudación con `parent_id` + `resume`), `@timbal-ai/timbal-react` 4.2.3 (`useTimbalStream`), ADR 010 (servidor MCP) y ADR 011 (ubicación del núcleo).

## Contexto
El asistente (UI-32) era un workflow de Timbal con un único paso LLM. El bucle de herramientas vivía en la API (`POST /v1/assistant/chat`): la API llamaba al workflow, ejecutaba en proceso las herramientas que pedía el modelo, decidía cuándo valía un `*_commit` mirando el mensaje anterior y emitía un SSE propio que la interfaz pintaba con su propio transporte. Eso duplicaba lo que Timbal ya hace (iteraciones, trazas, evals, aprobaciones) y obligaba a mantener un `WINECORE_ASSISTANT_URL`, una credencial y un protocolo propios.

## Decisión
1. **`workforce/asistente` es un agente nativo** (`_type: agent`, `agent.py::agent`) con una sola fuente de herramientas: `MCPServer(name="app", transport="http", service="api")`. Las herramientas no están en el agente: son el catálogo MCP de la API (ADR 010, `13-mcp.md`), con los permisos de quien pregunta y los módulos activos. Modelo `timbal/auto`, `max_iter=12`, guardarraíl `RedactSecrets`, prompt en español con la ruta de la pantalla como contexto.
2. **`POST /api/mcp` es un alias de `/api/m2m/mcp`** con el mismo guard (`requireUserOrMachine`), el mismo manejador y el mismo límite por minuto. Es la ruta que Timbal resuelve para `service="api"` en el entorno desplegado; en local, `timbal start` la apunta al puerto de la API. `api/src/mcp` no se ha tocado.
3. **Aprobación humana con la puerta de Timbal** (`workforce/asistente/policy.py`). Son libres los `*_prepare` y las herramientas marcadas de solo lectura sin sufijo de riesgo. Piden aprobación los `*_commit`, `*_decide`, emitir, anular, enviar, borrar…, toda escritura directa y cualquier herramienta nueva sin anotaciones (falla cerrado). La ejecución se pausa con un evento `APPROVAL`; la interfaz enseña el `summary_es` de la preparación con Confirmar y Cancelar. Confirmar reanuda **la misma ejecución** (`parent_id` = la pausada y `resume: { approval_id: true }`); cancelar no envía nada.
4. **La interfaz usa el runtime de chat de Timbal** (`useTimbalStream`) en lugar de su SSE propio, sin cambiar el aspecto (sistema de diseño de WineCore, no los componentes de la librería). Un `fetch` propio lleva la sesión de la persona como el resto de la app, añade `screen: { path, date }` a cada turno, resuelve de qué ejecución cuelga el siguiente turno y vigila la respuesta para recordar lo que el runtime no guarda (herramientas consultadas, enlaces, aprobación pendiente, cómo acabó el turno). El runtime se carga bajo demanda (~554 kB gzip) al abrir el asistente.
5. **La API deja de orquestar**: se eliminan `POST /v1/assistant/chat`, `api/src/core/assistant/*`, `WINECORE_ASSISTANT_URL` y `WINECORE_ASSISTANT_TOKEN`. Queda `GET /v1/assistant/status`, que devuelve las herramientas de la persona con su título (sugerencias y nombre de los chips).

```
Navegador ──POST /api/workforce/asistente/stream (Bearer de la persona)──▶ pasarela del entorno
   ▲                                                                           │
   │ SSE: START · DELTA · OUTPUT · APPROVAL                                    ▼
   └──────────────────────────────────────────────────── agente `asistente` (Python, timbal/auto)
                                                                               │ MCPServer(service="api") con la identidad de la persona
                                                                               ▼
                                                           POST /api/mcp (alias) ──▶ núcleo de `api/` (permisos, módulos, auditoría `mcp.call`)
```

## Despliegue (lo hace quien despliega; este ADR no ejecuta nada)
Los tres componentes se despliegan juntos: el chat antiguo y el nuevo no conviven (la API nueva ya no tiene `POST /v1/assistant/chat` y la UI nueva no lo usa). Con la UI nueva y sin el agente desplegado, el asistente muestra «no está disponible».

1. **Variables de la API** (entorno de Timbal, `timbal env push` o el panel): **quitar** `WINECORE_ASSISTANT_URL` y `WINECORE_ASSISTANT_TOKEN` (la API ya no las lee; si quedan, no hacen nada). **No se añade ninguna.** Comprobar que `APP_PUBLIC_URL` es el origen público de la UI: los enlaces `links.web` de las herramientas salen de ahí y la interfaz solo los abre como ruta interna si son de su mismo origen (si no, se muestran como texto).
2. **Variables de la UI** (compilación): sin cambios (`VITE_AUTH_ENABLED=true`, `VITE_TIMBAL_BASE_URL`, `VITE_TIMBAL_ORG_ID`, `VITE_TIMBAL_PROJECT_ID`). `VITE_API_BASE_URL` vacío (`/api`): el chat se pide a `/api/workforce/asistente/stream` en el mismo origen. Opcional `VITE_ASSISTANT_WORKFORCE` si el miembro cambia de nombre (por defecto `asistente`).
3. **Código**: desde la rama con estos cambios, `timbal push` (API, UI y workforce salen del mismo repositorio). El miembro conserva su `_id` (`6e52ca51…`) y cambia `_type` de `workflow` a `agent`. Si la plataforma rechaza el cambio de tipo sobre un miembro existente, crear el miembro de nuevo con `timbal add` (nuevo `_id`) con el mismo nombre `asistente` y retirar el antiguo: la interfaz lo busca por nombre.
4. **Despliegue** de los tres componentes desde el panel de Timbal. El miembro depende de `timbal>=2.8.1` (`workforce/asistente/pyproject.toml`).
5. **Variables del miembro**: ninguna propia. Timbal inyecta la URL del entorno y la identidad de quien llama; el agente no guarda credenciales.

## Cómo comprobarlo en producción
`$ORIGEN` es el origen público del entorno y `$TOKEN` la sesión de una persona con acceso (no se guarda en ficheros ni se pega en la salida).

```bash
# 1. El alias MCP exige credenciales (esperado: 401)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ORIGEN/api/mcp" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 2. Con la sesión: 200 y solo las herramientas de esa persona
curl -s -X POST "$ORIGEN/api/mcp" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400

# 3. Herramientas y títulos que verá la interfaz
curl -s "$ORIGEN/api/v1/assistant/status" -H "Authorization: Bearer $TOKEN" | head -c 400

# 4. El agente a través de la pasarela (eventos START, DELTA, OUTPUT; el último OUTPUT con status.code = success)
curl -N -X POST "$ORIGEN/api/workforce/asistente/stream" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"¿Qué puedes consultar?","screen":{"path":"/panel","date":"2026-11-01"}}'
```

Después, en la interfaz: Cmd/Ctrl+J, «Busca el contacto …» (chips «Buscar contactos», «Ficha de contacto» y un enlace que abre la ficha dentro de WineCore) y «Crea el contacto de prueba …»: debe aparecer la tarjeta «Pendiente de tu confirmación» y **no** existir el contacto hasta pulsar Confirmar. Cancelar no debe crear nada.

## Consecuencias
- Lo que el agente puede hacer crece con el catálogo MCP, sin tocar el agente ni la interfaz: una herramienta nueva con título y anotaciones aparece con su chip; una escritura nueva queda tras la aprobación aunque nadie piense en ella.
- El `confirmation_token` de un `*_prepare` ahora lo ve el modelo (lo necesita para pedir el `*_commit`). Antes lo guardaba la API. La barrera pasa a ser la aprobación humana de Timbal, más las defensas del propio token (un solo uso, 10 minutos, ligado al hash de los argumentos y al cliente).
- **Límite por minuto**: el alias comparte el límite de ADR 010 (60 llamadas por minuto y cliente) y cada llamada de herramienta del agente son varias peticiones HTTP al MCP (medido en local con `MCPServer(service="api")`: 10 peticiones para un turno con una herramienta y 17 con dos, unas 7 por herramienta). Una persona que encadene unas tres preguntas con herramientas en un minuto verá «Demasiadas preguntas seguidas» (429 con aviso y «Reintentar»). Subirlo para `/mcp` (límite propio en el alias, o `mcpRatePerMinute`) es una decisión de producto pendiente; no se ha cambiado.
- Si una persona cierra la pestaña o pulsa «Parar» a mitad de turno, la ejecución del servidor puede seguir hasta terminar. Una escritura ya aprobada no se deshace; las que no se aprobaron no se ejecutan.
- Reanudar una aprobación necesita recuperar la ejecución pausada. Se ha probado en local con un único proceso; en el entorno desplegado hay que comprobar con una escritura de prueba (arriba) que Confirmar la reanuda, sobre todo si el miembro corre con varios procesos.
- Las evals (`workforce/asistente/evals/eval_asistente.yaml`) necesitan un modelo real y la API con datos sintéticos; no se ejecutan en CI.
