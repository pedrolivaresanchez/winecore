"""Agente asistente de WineCore.

Un agente nativo de Timbal con una sola fuente de herramientas: el servidor MCP de la API
del proyecto (`MCPServer(service="api")`). Timbal resuelve la URL (`/api/mcp` en el
entorno desplegado, el puerto local de la API con `timbal start`) y llama con la identidad de
quien pregunta, así que `tools/list` ya viene filtrado por sus permisos y su módulo activo.
Las herramientas no están en este fichero: crecen con el catálogo MCP de la API.

Lecturas y `*_prepare` son libres. Todo lo que escribe o decide pasa por la puerta de
aprobación de Timbal (`policy.approval_policy`) y la persona lo confirma en la interfaz.

Entrada además de `prompt`: `screen` (opcional) con la ruta de la pantalla de WineCore.
"""

from __future__ import annotations

from typing import Any

from timbal import Agent
from timbal.core.mcp import MCPServer
from timbal.guardrails import RedactSecrets
from timbal.state import get_run_context

from policy import approval_policy
from prompt import build_system_prompt

MODEL = "timbal/auto"
MAX_ITER = 12


def system_prompt() -> str:
    screen = get_run_context().current_span().input.get("screen")
    return build_system_prompt(screen)


def build_agent(model: Any = MODEL) -> Agent:
    return Agent(
        name="asistente",
        model=model,
        system_prompt=system_prompt,
        tools=[
            MCPServer(
                name="app",
                transport="http",
                service="api",
                approval=approval_policy,
                elicitation=False,
                timeout=60.0,
                connect_timeout=15.0,
            )
        ],
        guardrails=[RedactSecrets()],
        max_iter=MAX_ITER,
    )


agent = build_agent()
