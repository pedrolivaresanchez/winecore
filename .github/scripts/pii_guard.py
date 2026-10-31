#!/usr/bin/env python3
"""Detector de datos personales en ficheros versionados.

Falla (exit 1) si encuentra correos, teléfonos españoles, NIF/NIE de personas o IBAN
que no estén en la lista blanca `.github/pii-allowlist.txt` (un valor exacto por línea).
Los datos de test deben ser sintéticos y, si parecen reales, añadirse a la lista blanca.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ALLOWLIST_FILE = ROOT / ".github" / "pii-allowlist.txt"
TEXT_SUFFIXES = {
    ".md", ".txt", ".ts", ".tsx", ".js", ".mjs", ".json", ".yaml", ".yml", ".py",
    ".sql", ".toml", ".xml", ".csv", ".html", ".css", ".env.example",
}
ALLOWED_EMAIL_DOMAINS = (
    "example.com", "example.org", "example.net", "winecore.test",
    "agenciatributaria.gob.es", "correo.aeat.es", "juntadeandalucia.es",
    "users.noreply.github.com", "github.com",
)
PATTERNS = {
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "telefono_es": re.compile(r"(?<![\w.,/-])(?:\+34[ .-]?)?[6789]\d{2}[ .-]?\d{3}[ .-]?\d{3}(?![\w.,/-])"),
    "nif_persona": re.compile(r"(?<![\w-])\d{8}[A-HJ-NP-TV-Z](?![\w-])"),
    "nie": re.compile(r"(?<![\w-])[XYZ]\d{7}[A-HJ-NP-TV-Z](?![\w-])"),
    "iban_es": re.compile(r"\bES\d{2}[ ]?(?:\d{4}[ ]?){5}\b"),
}
SKIP_FILES = {".github/scripts/pii_guard.py", ".github/pii-allowlist.txt"}


def tracked_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    for line in out.stdout.splitlines():
        p = ROOT / line
        if line in SKIP_FILES or not p.is_file():
            continue
        if p.suffix in TEXT_SUFFIXES or p.name.endswith(".env.example"):
            yield line, p


def main() -> int:
    allow = set()
    if ALLOWLIST_FILE.exists():
        allow = {l.strip() for l in ALLOWLIST_FILE.read_text(encoding="utf-8").splitlines()
                 if l.strip() and not l.startswith("#")}
    findings = []
    for rel, path in tracked_files():
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for n, line in enumerate(text.splitlines(), 1):
            for kind, rx in PATTERNS.items():
                for m in rx.finditer(line):
                    value = m.group(0).strip()
                    if value in allow:
                        continue
                    if kind == "email" and value.lower().split("@")[-1].endswith(ALLOWED_EMAIL_DOMAINS):
                        continue
                    findings.append(f"{rel}:{n}: {kind}: {value}")
    if findings:
        print("Posibles datos personales en ficheros versionados (anonimiza o añade a la lista blanca si es sintético):")
        print("\n".join(findings))
        return 1
    print("OK: no se han detectado datos personales.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
