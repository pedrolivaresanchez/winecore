import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guards } from "../../src/core/db/guards/registry";
import {
  partialUniqueIndexNames,
  readReferenceFiles,
  wcCodesIn,
} from "./parse_reference";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("cada WC y cada índice único parcial de la referencia está en el registro", () => {
  const sql = readReferenceFiles(root)
    .map((entry) => entry.sql)
    .join("\n");
  const ids = new Set(guards.map((guard) => guard.id));
  const text = guards.map((guard) => `${guard.id}\n${guard.description}`).join("\n");
  const missingCodes = wcCodesIn(sql).filter((code) => !ids.has(code));
  const missingIndexes = partialUniqueIndexNames(sql).filter((name) => !text.includes(name));
  expect(missingCodes).toEqual([]);
  expect(missingIndexes).toEqual([]);
  expect(new Set(guards.map((guard) => guard.id)).size).toBe(guards.length);
  const implemented = guards.filter((guard) => guard.implemented).map((guard) => guard.id).sort();
  expect(implemented).toEqual([
    "UQ:cellar.operation(legal_entity_id,number)",
    "UQ:cellar.vessel(qr_token)",
    "WC020",
    "WC021",
    "WC024",
    "WC025",
    "WC026",
    "WC027",
    "WC028",
    "WC030",
    "WC031",
    "WC032",
  ].sort());
});
