"""Workflow asistente. Un solo paso de modelo que decide el siguiente paso del chat.

La API de WineCore lo llama una vez por paso con la conversación, el catálogo de
herramientas MCP visibles para la persona y el contexto de pantalla. Devuelve una
respuesta o las herramientas que hay que ejecutar; nunca las ejecuta él.
Despliegue: miembro de la workforce del proyecto; la API lo encuentra con
`WINECORE_ASSISTANT_URL` (y `WINECORE_ASSISTANT_TOKEN` si el endpoint lo exige).

Entrada: `conversation`, `catalog` y `screen`. Timbal reserva `messages` (lo toma el
paso del agente y lo convierte en objetos Message) y `context` (el servidor lo saca
de la petición como contexto de ejecución), así que no sirven como nombres.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from timbal import Agent, Workflow
from timbal.guardrails import RedactSecrets
from timbal.state import get_run_context

from conversation import normalize_context, normalize_messages, normalize_tools, publish_step
from prompt import SYSTEM_PROMPT, compose_prompt


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(description="Nombre exacto de una herramienta del catálogo")
    arguments_json: str = Field(
        description='Argumentos: objeto JSON en texto, por ejemplo {"q":"tinto"}; "{}" si no hay',
    )


class Step(BaseModel):
    """Esquema estricto que devuelve el único paso LLM."""

    model_config = ConfigDict(extra="forbid")
    reply: str | None = Field(
        default=None,
        description="Respuesta final en español; null si pides herramientas",
    )
    tool_calls: list[ToolCall] = Field(
        default_factory=list,
        description="Herramientas que hay que ejecutar ahora (máximo 4); vacío si respondes",
    )


planner = Agent(
    name="planner",
    model="timbal/auto",
    system_prompt=SYSTEM_PROMPT,
    output_model=Step,
    guardrails=[RedactSecrets()],
)


def intake(
    conversation: list[dict[str, Any]],
    catalog: list[dict[str, Any]] | None = None,
    screen: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "messages": normalize_messages(conversation),
        "tools": normalize_tools(catalog),
        "context": normalize_context(screen),
    }


def compose(bag: dict[str, Any]) -> str:
    return compose_prompt(bag["messages"], bag["tools"], bag["context"])


def publish(step: Any, bag: dict[str, Any]) -> dict[str, Any]:
    dumped = step.model_dump() if hasattr(step, "model_dump") else dict(step)
    return publish_step(dumped, bag["tools"])


workflow = (
    Workflow(name="asistente")
    .step(intake)
    .step(compose, bag=lambda: get_run_context().step_span("intake").output)
    .step(planner, prompt=lambda: get_run_context().step_span("compose").output)
    .step(
        publish,
        step=lambda: get_run_context().step_span("planner").output,
        bag=lambda: get_run_context().step_span("intake").output,
    )
)
