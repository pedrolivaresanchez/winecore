"""Workflow ocr-gastos. Un solo paso de modelo; el alta del gasto va por la API."""

from __future__ import annotations

import os
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from timbal import Agent, Workflow
from timbal.guardrails import RedactSecrets
from timbal.state import get_run_context

from client import CaptureError, post_capture
from fields import capture_payload, load_content_base64, resolve_api_base
from prompt import SYSTEM_PROMPT, fence_document


class InvoiceLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(description="Concepto impreso en la línea")
    quantity: str = Field(description="Cantidad, con punto decimal")
    unit_price: str = Field(description="Precio unitario sin IVA")
    line_base: str = Field(description="Base de la línea")
    vat_rate: str = Field(description="Tipo de IVA en porcentaje, por ejemplo 21.00")
    vat_quota: str = Field(description="Cuota de IVA de la línea")
    withholding_rate: str = Field(
        default="0.00",
        description="Retención en porcentaje; 0.00 si no hay",
    )


class VatByRate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rate: str = Field(description="Tipo de IVA")
    base: str = Field(description="Base de ese tipo")
    quota: str = Field(description="Cuota de ese tipo")


class Confidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    supplier_name: float = Field(ge=0, le=1)
    supplier_tax_id: float = Field(ge=0, le=1)
    number: float = Field(ge=0, le=1)
    issue_date: float = Field(ge=0, le=1)
    due_date: float = Field(ge=0, le=1)
    lines: float = Field(ge=0, le=1)
    vat: float = Field(ge=0, le=1)
    totals: float = Field(ge=0, le=1)


class InvoiceExtraction(BaseModel):
    """Esquema estricto que devuelve el único paso LLM."""

    model_config = ConfigDict(extra="forbid")
    supplier_name: str = Field(description="Razón social del proveedor")
    supplier_tax_id: str = Field(description="NIF del proveedor, sin espacios ni prefijo ES")
    buyer_tax_id: str | None = Field(default=None, description="NIF del destinatario, si aparece")
    number: str = Field(description="Número de la factura del proveedor")
    issue_date: str = Field(description="Fecha de expedición AAAA-MM-DD")
    due_date: str | None = Field(default=None, description="Vencimiento AAAA-MM-DD, si aparece")
    lines: list[InvoiceLine]
    vat_by_rate: list[VatByRate]
    subtotal: str = Field(description="Base imponible total")
    tax_total: str = Field(description="Cuota de IVA total")
    withholding_total: str = Field(description="Retención total; 0.00 si no hay")
    total: str = Field(description="Total impreso en la factura")
    confidence: Confidence


extractor = Agent(
    name="extractor",
    model="timbal/auto",
    system_prompt=SYSTEM_PROMPT,
    output_model=InvoiceExtraction,
    guardrails=[RedactSecrets()],
)


def intake(
    filename: str,
    document_text: str | None = None,
    file_path: str | None = None,
    content_base64: str | None = None,
    legal_entity_id: str | None = None,
    source: str = "upload",
    api_base_url: str | None = None,
    api_token: str | None = None,
    dev_user: str | None = None,
) -> dict[str, Any]:
    allowed = {"upload", "photo", "email_forward"}
    return {
        "filename": filename,
        "document_text": document_text,
        "file_path": file_path,
        "content_base64": content_base64,
        "legal_entity_id": legal_entity_id,
        "source": source if source in allowed else "upload",
        "api_base_url": api_base_url,
        "api_token": api_token,
        "dev_user": dev_user,
    }


def compose(bag: dict[str, Any]) -> list[Any]:
    from timbal.types.file import File

    text = bag.get("document_text")
    parts: list[Any] = [
        fence_document(str(bag["filename"]), text if isinstance(text, str) else None),
    ]
    path = bag.get("file_path")
    if isinstance(path, str) and path.strip():
        parts.append(File.validate(path))
    return parts


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def publish(extraction: Any, bag: dict[str, Any]) -> dict[str, Any]:
    dumped = extraction.model_dump() if hasattr(extraction, "model_dump") else dict(extraction)
    content_value = bag.get("content_base64")
    path_value = bag.get("file_path")
    content = load_content_base64(
        content_value if isinstance(content_value, str) else None,
        path_value if isinstance(path_value, str) else None,
    )
    entity = bag.get("legal_entity_id")
    payload = capture_payload(
        dumped,
        filename=str(bag["filename"]),
        content_base64=content,
        legal_entity_id=entity if isinstance(entity, str) else None,
        source=str(bag.get("source") or "upload"),
    )
    explicit = bag.get("api_base_url")
    api_value = explicit if isinstance(explicit, str) or explicit is None else None
    api = resolve_api_base(api_value, os.environ)
    if api:
        if not content:
            raise CaptureError("Falta el fichero")
        token = bag.get("api_token")
        dev_user = bag.get("dev_user")
        api_token = token if isinstance(token, str) else _env("WINECORE_API_TOKEN")
        api_user = dev_user if isinstance(dev_user, str) else _env("WINECORE_DEV_USER")
        payload["result"] = post_capture(
            api_base_url=api,
            body=payload,
            token=api_token,
            dev_user=api_user,
        )
    return payload


workflow = (
    Workflow(name="ocr-gastos")
    .step(intake)
    .step(compose, bag=lambda: get_run_context().step_span("intake").output)
    .step(extractor, prompt=lambda: get_run_context().step_span("compose").output)
    .step(
        publish,
        extraction=lambda: get_run_context().step_span("extractor").output,
        bag=lambda: get_run_context().step_span("intake").output,
    )
)
