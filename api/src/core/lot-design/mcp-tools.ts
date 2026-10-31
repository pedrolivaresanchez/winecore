import type { Actor, Writer } from '../db/writer';
import { readDesign } from './design';
import { applyRecipe, type PlanRequest } from './plan';
import { listRecipeSummaries } from './recipes';

/**
 * MCP-oriented handlers. They are plain functions and are not registered
 * in the MCP server; the HTTP routes enforce cellar.read / cellar.operate / owner.
 */
export function getLotDesign(
  writer: Writer,
  input: { code: string; producer_entity_id?: string | null },
) {
  return readDesign(writer, input.code, input.producer_entity_id ?? null);
}

export function listRecipes(
  writer: Writer,
  input: { status?: string | null; limit?: number; lot_id?: string | null } = {},
) {
  return listRecipeSummaries(writer, input);
}

export function planFromRecipe(writer: Writer, actor: Actor, input: PlanRequest) {
  return applyRecipe(writer, actor, input);
}
