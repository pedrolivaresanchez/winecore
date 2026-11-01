import { z } from "zod";

import { getLotDesign, listRecipes, planFromRecipe } from "../../core/lot-design/mcp-tools";
import { requireLot } from "../../core/lot-design/lot-ref";
import { readRecipeVersion } from "../../core/lot-design/recipes";
import { domainError } from "../../core/errors";
import { defineReadTool, defineWriteTool } from "../registry";
import { actorOf, requireWriter } from "../runtime";

const designInput = z.object({
  code: z.string().trim().min(2).max(40),
  producer_entity_id: z.string().uuid().nullable().optional(),
});

const recipesInput = z.object({
  status: z.string().nullable().optional(),
  limit: z.number().int().positive().max(200).optional(),
  lot_id: z.string().uuid().nullable().optional(),
});

const planInput = z.object({
  code: z.string().trim().min(2).max(40),
  producer_entity_id: z.string().uuid().nullable().optional(),
  recipe_id: z.string().uuid(),
  version_no: z.number().int().positive().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});

type PlanPayload = z.infer<typeof planInput>;

export const lotDesignGet = defineReadTool({
  name: "lot_design_get",
  module: "cellar",
  scope: "cellar.read",
  title: "Diseño de lote",
  description: "Lee el diseño de destino de un lote.",
  input: designInput,
  routes: ["GET /v1/lots/:code/design"],
  handler: (ctx, input) => getLotDesign(requireWriter(ctx), input),
});

export const recipesList = defineReadTool({
  name: "recipes_list",
  module: "cellar",
  scope: "cellar.read",
  title: "Recetas",
  description: "Lista las recetas de elaboración.",
  input: recipesInput,
  routes: ["GET /v1/recipes"],
  handler: (ctx, input) => listRecipes(requireWriter(ctx), input),
});

export const lotPlanFromRecipe = defineWriteTool({
  name: "lot_plan_from_recipe",
  module: "cellar",
  scope: "cellar.operate",
  extraScopes: ["write:cellar"],
  title: "Plan desde receta",
  description: "Prepara un plan de fechas a partir de una receta. No confirma operaciones de bodega.",
  input: planInput,
  routes: ["POST /v1/lots/:code/plan"],
  prepare: async (ctx, input) => {
    const writer = requireWriter(ctx);
    const lot = await requireLot(writer, input.code, input.producer_entity_id ?? null);
    const version = await readRecipeVersion(writer, input.recipe_id, input.version_no ?? null, null);
    const payload: PlanPayload = input;
    return {
      preview: {
        lot_code: lot.code,
        recipe_id: version.recipe_id,
        version_id: version.id,
        version_no: version.version_no,
        start_date: input.start_date,
        steps: version.steps.length,
        creates_operations: false,
      },
      payload,
      summary_es: `Se sugerirá un plan para ${lot.code}. No se confirman operaciones de bodega.`,
    };
  },
  commit: async (ctx, raw) => {
    const parsed = planInput.safeParse(raw);
    if (!parsed.success) throw domainError("WC_VALIDATION", { body: "El plan ya no es válido" });
    return planFromRecipe(requireWriter(ctx), actorOf(ctx, "plan de receta"), parsed.data);
  },
});
