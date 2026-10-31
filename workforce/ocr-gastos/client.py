"""POST a WineCore. El miembro no abre la base de datos."""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from collections.abc import Mapping


class CaptureError(Exception):
    def __init__(self, status: int | str) -> None:
        super().__init__(f"La captura ha respondido {status}")
        self.status = status


def idempotency_key(filename: str, content_base64: str) -> str:
    digest = hashlib.sha256(f"{filename}:{content_base64}".encode()).hexdigest()
    return f"ocr-{digest[:32]}"


def post_capture(
    *,
    api_base_url: str,
    body: Mapping[str, object],
    token: str | None,
    dev_user: str | None,
    timeout: float = 30.0,
) -> dict[str, object]:
    content = body.get("content_base64")
    filename = body.get("filename")
    if not isinstance(content, str) or not isinstance(filename, str):
        raise CaptureError("Falta el fichero")
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key(filename, content),
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if dev_user:
        headers["X-Dev-User"] = dev_user
    url = api_base_url.rstrip("/") + "/v1/supplier-invoices/capture"
    request = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raise CaptureError(error.code) from None
    except urllib.error.URLError:
        raise CaptureError("red") from None
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise CaptureError("respuesta")
    return parsed
