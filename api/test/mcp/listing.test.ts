/// <reference path="./bun-test.d.ts" />
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { defineReadTool, defineWriteTool } from "../../src/mcp/registry";
import { baseTools, visibleToolNames } from "../../src/mcp/server";
import { CLIENT_A, makeCtx } from "./fixture";

const contactsSearch = defineReadTool({
  name: "contacts_search",
  module: "contacts",
  scope: "contacts.read",
  title: "Buscar contactos",
  description: "Busca contactos sintéticos.",
  input: z.object({ q: z.string().optional() }),
  handler: () => ({ items: [] }),
});

const vineyardList = defineReadTool({
  name: "vineyard_parcels_list",
  module: "vineyard",
  scope: "vineyard.read",
  title: "Parcelas",
  description: "Lista parcelas sintéticas.",
  input: z.object({}),
  handler: () => ({ items: [] }),
});

const cellarDraft = defineWriteTool({
  name: "cellar_operation_draft",
  module: "cellar",
  scope: "write:cellar.operation_draft",
  title: "Borrador de operación",
  description: "Prepara un borrador de operación de bodega.",
  input: z.object({ note: z.string() }),
  prepare: (_ctx, input) => ({ preview: { note: input.note }, payload: input }),
  commit: () => ({ operation_id: "00000000-0000-4000-8000-0000000000d1" }),
});

const catalogue = [...baseTools, contactsSearch, vineyardList, cellarDraft];

describe("tool listing", () => {
  test("filters by scope and active module", () => {
    const names = visibleToolNames(
      makeCtx({
        client: { id: CLIENT_A, scopes: ["read:*"] },
        activeModules: ["contacts"],
      }),
      catalogue,
    );
    expect(names).toContain("system_whoami");
    expect(names).toContain("system_modules");
    expect(names).toContain("approvals_get_link");
    expect(names).toContain("contacts_search");
    expect(names).not.toContain("vineyard_parcels_list");
    expect(names).not.toContain("cellar_operation_draft_prepare");
    expect(names).not.toContain("cellar_operation_draft_commit");
  });

  test("hides read tools when the client lacks the scope", () => {
    const names = visibleToolNames(
      makeCtx({
        client: { id: CLIENT_A, scopes: ["write:contacts"] },
        activeModules: ["contacts", "vineyard", "cellar"],
      }),
      catalogue,
    );
    expect(names).toContain("system_whoami");
    expect(names).not.toContain("contacts_search");
    expect(names).not.toContain("approvals_get_link");
    expect(names).not.toContain("vineyard_parcels_list");
    expect(names).not.toContain("cellar_operation_draft_prepare");
  });

  test("shows a write pair only with its scope and module", () => {
    const names = visibleToolNames(
      makeCtx({
        client: { id: CLIENT_A, scopes: ["write:cellar.operation_draft"] },
        activeModules: ["cellar"],
      }),
      catalogue,
    );
    expect(names).toContain("cellar_operation_draft_prepare");
    expect(names).toContain("cellar_operation_draft_commit");
    expect(names).not.toContain("contacts_search");
  });
});
