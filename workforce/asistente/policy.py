"""Qué herramientas de WineCore piden confirmación humana antes de ejecutarse.

Lecturas (`readOnlyHint`) y `*_prepare` son libres: no guardan nada. Todo lo demás
(`*_commit`, `*_decide`, emitir, anular, enviar, escrituras directas y cualquier herramienta
nueva sin anotaciones) pasa por la puerta de aprobación de Timbal. Falla cerrado: una
herramienta desconocida se confirma, no se deja pasar.
"""

from __future__ import annotations

import re
from typing import Any

from timbal.types import ApprovalPolicyDecision

PREPARE_SUFFIX = "_prepare"
APPROVAL_KIND = "winecore_write"
_GATED_NAME = re.compile(
    r"_(commit|decide|approve|reject|issue|emit|void|annul|delete|remove|send|cancel|revoke)$"
)


def _read_only(annotations: Any) -> bool:
    return getattr(annotations, "readOnlyHint", None) is True


def needs_approval(name: str, annotations: Any = None) -> bool:
    if name.endswith(PREPARE_SUFFIX):
        return False
    if _GATED_NAME.search(name):
        return True
    return not _read_only(annotations)


def approval_policy(tool: Any, arguments: dict[str, Any] | None = None) -> ApprovalPolicyDecision:
    """Política por llamada de `MCPServer(approval=...)`: recibe la herramienta del servidor."""
    name = str(tool.name)
    if not needs_approval(name, getattr(tool, "annotations", None)):
        return ApprovalPolicyDecision(required=False)
    title = str(getattr(tool, "title", None) or name)
    return ApprovalPolicyDecision(
        required=True,
        prompt=f"¿Confirmas «{title}»?",
        description=str(getattr(tool, "description", None) or "") or None,
        kind=APPROVAL_KIND,
        ui={"tool": name, "title": title},
        grantable=False,
    )
