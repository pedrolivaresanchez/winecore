import { domainError } from "../../core/errors";
import {
  castVote,
  castVoteInput,
  createTastingNoteFromDictation,
  createTastingNoteFromDictationInput,
  listSessionSamples,
  listSessionSamplesInput,
} from "../../core/tasting/mcp-tools";
import { defineReadTool, defineWriteTool } from "../registry";
import { actorOf, requireWriter } from "../runtime";

function person(ctx: Parameters<typeof actorOf>[0]): void {
  if (!ctx.actor) {
    throw domainError("WC_VALIDATION", { on_behalf_of: "Hace falta una persona" });
  }
}

export const tastingSessionSamplesList = defineReadTool({
  name: "tasting_session_samples_list",
  module: "cellar",
  scope: "cellar.read",
  title: "Muestras de cata",
  description: "Lista las muestras de una sesión. En cata ciega no revela el lote hasta que se destape.",
  input: listSessionSamplesInput,
  handler: (ctx, input) => listSessionSamples(requireWriter(ctx), input),
});

export const tastingNoteFromDictation = defineWriteTool({
  name: "tasting_note_from_dictation",
  module: "cellar",
  scope: "tasting.write",
  title: "Nota de cata por dictado",
  description: "Prepara una nota de cata a partir de un dictado. La nota se guarda al confirmar.",
  input: createTastingNoteFromDictationInput,
  prepare: async (ctx, input) => {
    person(ctx);
    return {
      preview: {
        dictated_text: input.dictated_text,
        template_code: input.template_code ?? null,
        lot_code: input.lot_code ?? null,
        source: input.source ?? "voice",
      },
      payload: input,
      summary_es: "Se guardará una nota de cata a partir del dictado.",
    };
  },
  commit: async (ctx, raw) => {
    person(ctx);
    const parsed = createTastingNoteFromDictationInput.safeParse(raw);
    if (!parsed.success) throw domainError("WC_VALIDATION", { body: "El dictado ya no es válido" });
    return createTastingNoteFromDictation(requireWriter(ctx), actorOf(ctx, "nota de cata"), parsed.data);
  },
});

export const tastingVoteCast = defineWriteTool({
  name: "tasting_vote_cast",
  module: "cellar",
  scope: "tasting.write",
  title: "Voto de cata",
  description: "Prepara el voto de una muestra. El voto se guarda al confirmar.",
  input: castVoteInput,
  routes: ["POST /v1/tasting-sessions/:id/votes"],
  prepare: async (ctx, input) => {
    person(ctx);
    return {
      preview: {
        session_id: input.session_id,
        sample_no: input.sample_no,
        day_no: input.day_no,
        vote: input.vote,
      },
      payload: input,
      summary_es: `Se registrará un voto ${input.vote} en la muestra ${input.sample_no}.`,
    };
  },
  commit: async (ctx, raw) => {
    person(ctx);
    const parsed = castVoteInput.safeParse(raw);
    if (!parsed.success) throw domainError("WC_VALIDATION", { body: "El voto ya no es válido" });
    return castVote(requireWriter(ctx), actorOf(ctx, "voto de cata"), parsed.data);
  },
});
