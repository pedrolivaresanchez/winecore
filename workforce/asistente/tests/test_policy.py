"""Política de aprobación: qué herramientas del MCP exigen confirmación humana."""

from __future__ import annotations

import unittest

import support  # noqa: F401
from mcp.types import Tool, ToolAnnotations
from policy import APPROVAL_KIND, approval_policy, needs_approval


def tool(name: str, annotations: ToolAnnotations | None, title: str | None = None) -> Tool:
    return Tool(
        name=name,
        title=title,
        description=f"Descripción de {name}",
        inputSchema={"type": "object"},
        annotations=annotations,
    )


READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True)


class NeedsApprovalTests(unittest.TestCase):
    def test_reads_and_prepares_are_free(self) -> None:
        self.assertFalse(needs_approval("cellar_lot_get", READ))
        self.assertFalse(needs_approval("contacts_create_prepare", WRITE))
        self.assertFalse(needs_approval("contacts_create_prepare", None))

    def test_commits_and_decisions_are_gated(self) -> None:
        for name in (
            "contacts_create_commit",
            "approvals_decide",
            "billing_invoice_issue",
            "billing_invoice_void",
            "billing_invoice_send",
            "approvals_approve",
            "contacts_delete",
        ):
            self.assertTrue(needs_approval(name, WRITE), name)

    def test_a_gated_name_wins_over_a_read_only_hint(self) -> None:
        self.assertTrue(needs_approval("contacts_create_commit", READ))

    def test_unknown_or_unannotated_tools_fail_closed(self) -> None:
        self.assertTrue(needs_approval("mystery_tool", None))
        self.assertTrue(needs_approval("direct_write", WRITE))
        self.assertTrue(needs_approval("anything", ToolAnnotations()))


class DecisionTests(unittest.TestCase):
    def test_free_tool_does_not_ask(self) -> None:
        decision = approval_policy(tool("cellar_lot_get", READ, "Lote"), {"lot_code": "L-1"})
        self.assertFalse(decision.required)

    def test_commit_asks_in_spanish_and_cannot_be_remembered(self) -> None:
        decision = approval_policy(
            tool("contacts_create_commit", WRITE, "Crear contacto · confirmar"),
            {"confirmation_token": "t"},
        )
        self.assertTrue(decision.required)
        self.assertEqual(decision.prompt, "¿Confirmas «Crear contacto · confirmar»?")
        self.assertEqual(decision.kind, APPROVAL_KIND)
        self.assertFalse(decision.grantable)
        self.assertEqual(decision.ui, {"tool": "contacts_create_commit", "title": "Crear contacto · confirmar"})

    def test_untitled_tool_falls_back_to_its_name(self) -> None:
        decision = approval_policy(tool("mystery_tool", None))
        self.assertTrue(decision.required)
        self.assertIn("mystery_tool", decision.prompt or "")


if __name__ == "__main__":
    unittest.main()
