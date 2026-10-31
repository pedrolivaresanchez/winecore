const HINTS: readonly (readonly [RegExp, string])[] = [
  [/uva|vendimia/iu, 'grapes'],
  [/granel/iu, 'bulk_wine'],
  [/metabisulfito|tart[aá]rico|enol[oó]g/iu, 'oenological'],
  [/fitosanitari|herbicid/iu, 'vineyard_inputs'],
  [/limpieza|desinfec/iu, 'cleaning'],
  [/botella|tap[oó]n|c[aá]psula|etiqueta/iu, 'packaging'],
  [/transport/iu, 'transport'],
  [/almac[eé]n|log[ií]stic/iu, 'warehousing'],
  [/alquiler|arrendamient/iu, 'rent'],
  [/suministro|electric|energ[ií]a/iu, 'utilities'],
  [/publicidad/iu, 'marketing'],
  [/software|licencia/iu, 'software'],
  [/honorario|asesor[ií]a|abogad|profesional/iu, 'professional'],
  [/laboratorio|an[aá]lisis/iu, 'lab'],
];

/** Una sola categoría si todas las líneas que encajan coinciden. Si no, ninguna. */
export function suggestCategory(descriptions: readonly string[]): string | null {
  const found = new Set<string>();
  for (const description of descriptions) {
    for (const [pattern, code] of HINTS) {
      if (pattern.test(description)) {
        found.add(code);
        break;
      }
    }
  }
  if (found.size !== 1) return null;
  return [...found][0] ?? null;
}
