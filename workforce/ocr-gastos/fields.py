"""Normaliza la extracción y prepara el cuerpo que acepta la API. Sin modelo."""

from __future__ import annotations

import base64
from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

CENT = Decimal("0.01")
MONEY = Decimal("0.01")
PUBLIC_KEYS = (
    "supplier_name",
    "supplier_tax_id",
    "buyer_tax_id",
    "number",
    "issue_date",
    "due_date",
    "lines",
    "vat_by_rate",
    "subtotal",
    "tax_total",
    "withholding_total",
    "total",
    "currency",
    "confidence",
    "totals_mismatch",
)
SCORE_FIELDS = ("supplier_tax_id", "issue_date", "total", "number", "subtotal", "tax_total")
SOURCES = {"upload", "photo", "email_forward"}


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def as_decimal(value: object) -> Decimal:
    return Decimal(str(value).strip().replace(",", "."))


def line_withholding(line: Mapping[str, object]) -> Decimal:
    base = as_decimal(line.get("line_base", "0"))
    rate = as_decimal(line.get("withholding_rate", "0"))
    return money(base * rate / Decimal(100))


def computed_total(extraction: Mapping[str, object]) -> Decimal:
    lines = extraction.get("lines")
    if not isinstance(lines, list):
        raise ValueError("sin líneas")
    base = Decimal(0)
    vat = Decimal(0)
    withheld = Decimal(0)
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError("línea no válida")
        base += as_decimal(line.get("line_base", "0"))
        vat += as_decimal(line.get("vat_quota", "0"))
        withheld += line_withholding(line)
    return money(base + vat - withheld)


def totals_match(extraction: Mapping[str, object]) -> bool:
    try:
        declared = money(as_decimal(extraction.get("total", "0")))
        return abs(declared - computed_total(extraction)) <= CENT
    except (ArithmeticError, ValueError):
        return False


def _cap(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return 0.0
    try:
        number = float(value)
    except ValueError:
        return 0.0
    if number < 0:
        return 0.0
    if number > 1:
        return 1.0
    return round(number, 3)


def apply_totals_guard(raw: dict[str, object]) -> dict[str, object]:
    """Un total que no cuadra no se acepta sin aviso: baja la confianza."""
    extraction = dict(raw)
    raw_confidence = extraction.get("confidence")
    confidence: dict[object, object] = {}
    if isinstance(raw_confidence, dict):
        confidence = dict(raw_confidence.items())
    matches = totals_match(extraction)
    extraction["totals_mismatch"] = not matches
    if not matches:
        confidence["totals"] = min(_cap(confidence.get("totals", 1)), 0.5)
    extraction["confidence"] = {
        key: _cap(confidence.get(key, 0))
        for key in (
            "supplier_name",
            "supplier_tax_id",
            "number",
            "issue_date",
            "due_date",
            "lines",
            "vat",
            "totals",
        )
    }
    return extraction


def public_extraction(raw: Mapping[str, object]) -> dict[str, object]:
    guarded = apply_totals_guard(dict(raw))
    return {key: guarded[key] for key in PUBLIC_KEYS if key in guarded}


def capture_payload(
    raw: Mapping[str, object],
    *,
    filename: str,
    content_base64: str | None,
    legal_entity_id: str | None,
    source: str,
) -> dict[str, object]:
    chosen = source if source in SOURCES else "upload"
    return {
        "legal_entity_id": legal_entity_id,
        "source": chosen,
        "filename": filename,
        "content_base64": content_base64,
        "extraction": public_extraction(raw),
    }


def resolve_api_base(explicit: str | None, environ: Mapping[str, str]) -> str | None:
    """None usa el entorno. La cadena vacía pide solo la extracción, sin crear el gasto."""
    if explicit is not None:
        cleaned = explicit.strip()
        return cleaned or None
    value = environ.get("WINECORE_API_URL", "").strip()
    return value or None


def load_content_base64(content_base64: str | None, file_path: str | None) -> str | None:
    if content_base64:
        return content_base64
    if file_path:
        return base64.b64encode(Path(file_path).read_bytes()).decode("ascii")
    return None


def norm_tax(value: object) -> str:
    text = str(value or "").upper().replace(" ", "").replace("-", "")
    if text.startswith("ES") and len(text) == 11:
        return text[2:]
    return text


def norm_amount(value: object) -> str:
    return f"{money(as_decimal(value)):.2f}"


def norm_date(value: object) -> str:
    return str(value or "")[:10]


def score_fields(expected: Mapping[str, object], actual: Mapping[str, object]) -> float:
    hits = 0
    for field in SCORE_FIELDS:
        if field in {"total", "subtotal", "tax_total"}:
            same = norm_amount(actual.get(field)) == norm_amount(expected[field])
        elif field == "supplier_tax_id":
            same = norm_tax(actual.get(field)) == norm_tax(expected[field])
        elif field == "issue_date":
            same = norm_date(actual.get(field)) == norm_date(expected[field])
        else:
            same = str(actual.get(field) or "").strip() == str(expected[field]).strip()
        hits += int(same)
    return hits / len(SCORE_FIELDS)


def wrong_total_without_warning(extraction: Mapping[str, object]) -> bool:
    if totals_match(extraction):
        return False
    if extraction.get("totals_mismatch") is True:
        return False
    confidence = extraction.get("confidence")
    totals = 1.0
    if isinstance(confidence, dict):
        totals = _cap(confidence.get("totals", 1))
    return totals > 0.5


def meets_bar(pairs: list[tuple[Mapping[str, object], Mapping[str, object]]]) -> bool:
    if len(pairs) < 30:
        return False
    average = sum(score_fields(expected, actual) for expected, actual in pairs) / len(pairs)
    warned = all(not wrong_total_without_warning(actual) for _, actual in pairs)
    return average >= 0.95 and warned
