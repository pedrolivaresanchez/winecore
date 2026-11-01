"""Partes deterministas del turno: entrada que llega de la API y salida que vuelve a ella.

Contrato HTTP del workflow (lo llama `POST /v1/assistant/chat` de la API):
  entrada  {"messages": [...], "tools": [...], "context": {"path", "today", "roles"}}
  salida   {"reply": str | None, "tool_calls": [{"name": str, "arguments": dict | str}]}
El miembro no ejecuta herramientas ni guarda estado: la API las ejecuta con la sesión
de la persona y vuelve a llamar con los resultados.
"""

from __future__ import annotations

import json
import re
from typing import Any

MAX_CALLS = 4
MAX_CONTENT_CHARS = 16_000
TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{1,79}$")
FALLBACK_REPLY = "No he podido preparar una respuesta. ¿Puedes reformular la pregunta?"


def _text(value: Any, limit: int = MAX_CONTENT_CHARS) -> str:
    return value[:limit] if isinstance(value, str) else ""


def normalize_messages(messages: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in messages if isinstance(messages, list) else []:
        if not isinstance(raw, dict):
            continue
        role = raw.get("role")
        if role == "user":
            out.append({"role": "user", "content": _text(raw.get("content"))})
        elif role == "tool" and isinstance(raw.get("name"), str):
            out.append(
                {
                    "role": "tool",
                    "name": raw["name"][:80],
                    "ok": raw.get("ok") is True,
                    "content": _text(raw.get("content")),
                }
            )
        elif role == "assistant":
            message: dict[str, Any] = {"role": "assistant", "content": _text(raw.get("content"))}
            calls = [
                {"name": call["name"][:80], "arguments": call.get("arguments")}
                for call in raw.get("tool_calls") or []
                if isinstance(call, dict) and isinstance(call.get("name"), str)
            ]
            if calls:
                message["tool_calls"] = calls
            pending = raw.get("pending")
            if isinstance(pending, dict) and isinstance(pending.get("tool"), str):
                message["pending"] = {
                    "tool": pending["tool"][:80],
                    "summary_es": _text(pending.get("summary_es"), 2000),
                    "expires_at": _text(pending.get("expires_at"), 40),
                }
            out.append(message)
    return out


def normalize_tools(tools: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in tools if isinstance(tools, list) else []:
        if not isinstance(raw, dict) or not TOOL_NAME.match(str(raw.get("name", ""))):
            continue
        schema = raw.get("input_schema")
        out.append(
            {
                "name": raw["name"],
                "kind": raw.get("kind")
                if raw.get("kind") in ("read", "prepare", "commit")
                else "read",
                "title": _text(raw.get("title"), 120),
                "description": _text(raw.get("description"), 600),
                "input_schema": schema if isinstance(schema, dict) else {"type": "object"},
            }
        )
    return out


def normalize_context(context: Any) -> dict[str, Any]:
    data = context if isinstance(context, dict) else {}
    path = data.get("path")
    roles = data.get("roles")
    return {
        "path": path[:200] if isinstance(path, str) and path.startswith("/") else None,
        "today": _text(data.get("today"), 10),
        "roles": [str(role)[:40] for role in roles[:10]] if isinstance(roles, list) else [],
    }


def _arguments(raw: Any) -> dict[str, Any] | str:
    if not isinstance(raw, str) or raw.strip() == "":
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    return parsed if isinstance(parsed, dict) else raw


def publish_step(step: dict[str, Any], tools: list[dict[str, Any]]) -> dict[str, Any]:
    """Herramientas fuera del catálogo del turno se descartan; la API vuelve a comprobarlo todo."""
    offered = {tool["name"] for tool in tools}
    calls: list[dict[str, Any]] = []
    for raw in step.get("tool_calls") or []:
        if len(calls) >= MAX_CALLS:
            break
        name = raw.get("name") if isinstance(raw, dict) else None
        if not isinstance(name, str) or name not in offered:
            continue
        calls.append({"name": name, "arguments": _arguments(raw.get("arguments_json"))})
    if calls:
        return {"reply": None, "tool_calls": calls}
    reply = step.get("reply")
    text = reply.strip() if isinstance(reply, str) else ""
    return {"reply": text or FALLBACK_REPLY, "tool_calls": []}
