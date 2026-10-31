export interface DictationParse {
  template_code: string | null;
  lot_code: string | null;
  parcel_code: string | null;
  vessel_code: string | null;
  vintage: number | null;
  visual_score: number | null;
  nose_score: number | null;
  mouth_score: number | null;
  overall_score: number | null;
  defects: string[];
  decision: string | null;
  values: Record<string, unknown>;
}

const DEFECT_RULES: readonly { pattern: RegExp; code: string }[] = [
  { pattern: /vol[aá]til|ac[eé]tic/i, code: 'volatile' },
  { pattern: /reduc/i, code: 'reduction' },
  { pattern: /oxid/i, code: 'oxidation' },
  { pattern: /brett/i, code: 'brett' },
  { pattern: /corcho/i, code: 'cork' },
  { pattern: /rat[oó]n|\bmouse\b/i, code: 'mouse' },
];

/** Pulls a tasting sheet out of dictated Spanish. Explicit fields from the caller win later. */
export function parseDictation(text: string): DictationParse {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const lower = cleaned.toLowerCase();
  const defects = /sin defecto/.test(lower)
    ? []
    : DEFECT_RULES.filter((rule) => rule.pattern.test(cleaned)).map((rule) => rule.code);
  const values: Record<string, unknown> = {};
  const maturity = /madurez(?:\s+fen[oó]lica)?\s*[:=]?\s*([1-5])\b/i.exec(cleaned);
  if (maturity?.[1]) values.phenolic_maturity = Number(maturity[1]);
  const days = /(?:faltan\s+)?(\d{1,3})\s+d[ií]as\b/i.exec(cleaned);
  if (days?.[1]) values.estimated_days_to_harvest = Number(days[1]);
  const vintage = /a[nñ]ada\s+(19\d{2}|20\d{2}|2100)\b/i.exec(cleaned);
  const lot = /\blote\s+([A-Za-z0-9][A-Za-z0-9./-]{1,29})\b/i.exec(cleaned);
  const parcel = /\bparcela\s+([A-Za-z0-9-]{2,20})\b/i.exec(cleaned);
  const vessel = /\b(?:dep[oó]sito|recipiente)\s+([A-Za-z0-9-]{2,20})\b/i.exec(cleaned);
  const decision = /decisi[oó]n\s*[:=]?\s*(.+)$/i.exec(cleaned);
  return {
    template_code: inferTemplate(lower),
    lot_code: lot?.[1] ? lot[1].toUpperCase() : null,
    parcel_code: parcel?.[1] ? parcel[1].toUpperCase() : null,
    vessel_code: vessel?.[1] ? vessel[1].toUpperCase() : null,
    vintage: vintage?.[1] ? Number(vintage[1]) : null,
    visual_score: grabScore(cleaned, /\b(?:visual|vista)\b/i),
    nose_score: grabScore(cleaned, /\b(?:nariz|aroma)\b/i),
    mouth_score: grabScore(cleaned, /\b(?:boca|gusto)\b/i),
    overall_score: grabScore(cleaned, /\b(?:conjunto|global|puntuaci[oó]n)\b/i),
    defects,
    decision: decision?.[1] ? decision[1].trim() : null,
    values,
  };
}

function inferTemplate(lower: string): string | null {
  if (/\b(botella|copa|restaurante)\b/.test(lower)) return 'BOTELLA';
  if (/\b(uva|viña|vina|pepita|hollejo)\b/.test(lower)) return 'UVA';
  if (/\b(mosto|ferment)/.test(lower)) return 'MOSTO';
  if (/\b(crianza|barrica|envejec)/.test(lower)) return 'CRIANZA';
  if (/\b(ensambl|coupage|candidato)/.test(lower)) return 'ENSAMBLAJE';
  return null;
}

function grabScore(text: string, label: RegExp): number | null {
  const re = new RegExp(`${label.source}\\s*[:=]?\\s*(\\d{1,3}(?:[.,]\\d{1,2})?)`, 'i');
  const match = re.exec(text);
  if (!match?.[1]) return null;
  return Number(match[1].replace(',', '.'));
}
