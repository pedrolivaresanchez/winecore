const AFFIRMATIVE = /^(si|confirmo|confirmado|confirmar|confirma|adelante|hazlo|procede|de acuerdo|ok|okay|vale|correcto|perfecto|guardalo|crealo|registralo)\b/;
const HESITANT = /\b(no|cancela|cancelar|cancelo|espera|aun no|todavia|cambia|cambiar|modifica|antes|pero)\b|\?/;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[¡!.,;:«»"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Un `_commit` solo se ejecuta si el último mensaje de la persona es un «sí»
 * corto y sin condiciones. Si duda, pregunta o cambia algo, cuenta como «no».
 */
export function isExplicitConfirmation(text: string): boolean {
  const normalized = normalize(text);
  if (normalized === '' || normalized.length > 80) return false;
  if (HESITANT.test(normalized)) return false;
  return AFFIRMATIVE.test(normalized);
}
