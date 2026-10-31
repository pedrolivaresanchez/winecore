import { z } from "zod";

import { defineReadTool } from "../registry";

const emptyInput = z.object({});

export const systemWhoami = defineReadTool({
  name: "system_whoami",
  module: "system",
  scope: "",
  title: "Quién soy",
  description: "Identificador del cliente, alcances y persona representada. No modifica nada.",
  input: emptyInput,
  handler: (ctx) => ({
    client: ctx.client.id,
    on_behalf_of: ctx.actor ? { id: ctx.actor.id, name: ctx.actor.name } : null,
    roles: ctx.actor?.roles ?? [],
    scopes: ctx.client.scopes,
    modules_enabled: ctx.activeModules,
  }),
});

export const systemModules = defineReadTool({
  name: "system_modules",
  module: "system",
  scope: "",
  title: "Módulos activos",
  description: "Módulos activos inyectados en esta petición. No activa ni desactiva módulos.",
  input: emptyInput,
  handler: (ctx) => ({
    modules: ctx.activeModules,
  }),
});
