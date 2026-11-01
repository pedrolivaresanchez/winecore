import { parseProviderStep, type AssistantProvider, type ProviderInput } from './provider';

export interface ScriptedStep {
  reply?: string;
  tool_calls?: { name: string; arguments?: unknown; arguments_json?: string }[];
}

export type Script = readonly ScriptedStep[] | ((input: ProviderInput, call: number) => ScriptedStep);

/** Proveedor determinista para pruebas y demos: devuelve los pasos del guion y guarda lo que recibe. */
export function scriptedAssistant(script: Script): AssistantProvider & { inputs: ProviderInput[] } {
  const inputs: ProviderInput[] = [];
  return {
    available: true,
    inputs,
    next(input) {
      const call = inputs.length;
      inputs.push(structuredClone(input));
      const step = typeof script === 'function'
        ? script(input, call)
        : script[Math.min(call, script.length - 1)];
      return Promise.resolve(parseProviderStep(step ?? {}, 'fake/scripted'));
    },
  };
}
