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
    "CK:catalog.product#1",
    "FK:cellar.addition.additive_product_id",
    "FK:cellar.addition.lot_id",
    "FK:cellar.cleaning_record.location_id",
    "FK:cellar.cleaning_record.product_id",
    "FK:cellar.operation.legal_entity_id",
    "FK:cellar.operation_line.location_id",
    "FK:cellar.operation_line.lot_id",
    "FK:cellar.operation_line.product_id",
    "FK:cellar.vessel.location_id",
    "FK:inventory.lot.wine_id",
    "FK:inventory.stock_move.vessel_id",
    "FK:ops.approval_decision.decided_by",
    "FK:ops.approval_policy.legal_entity_id",
    "FK:ops.approval_request.legal_entity_id",
    "FN:billing.resolve_issuing_entity",
    "UQ:catalog.price_list_version(price_list_id,valid_from,valid_to)",
    "UQ:catalog.product(wine_id,vintage,format_id)",
    "UQ:cellar.operation(legal_entity_id,number)",
    "UQ:cellar.vessel(qr_token)",
    "UQ:core.number_series(legal_entity_id,doc_type,year)",
    "UQ:party.contact(tax_id)",
    "UQ:party.contact_address(contact_id,kind)",
    "WC001",
    "WC010",
    "WC011",
    "WC020",
    "WC021",
    "WC023",
    "WC024",
    "WC025",
    "WC026",
    "WC027",
    "WC028",
    "WC030",
    "WC031",
    "WC032",
    "WC040",
    "WC041",
    "WC042",
    "WC043",
    "WC050",
    "WC060",
    "WC070",
  ]);
});
