export const SUBJECTS = ['grape', 'must', 'wine_aging', 'blend_candidate', 'bottle'] as const;
export type Subject = (typeof SUBJECTS)[number];

export const SCORE_SCALES = ['0-10', '0-100'] as const;
export type ScoreScale = (typeof SCORE_SCALES)[number];

export const FIELD_KINDS = ['text', 'number', 'integer', 'scale', 'select', 'boolean', 'date'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const DESCRIPTOR_FAMILIES = ['visual', 'nose', 'mouth', 'defect', 'other'] as const;
export type DescriptorFamily = (typeof DESCRIPTOR_FAMILIES)[number];

export const EVOLUTIONS = ['improving', 'peak', 'stable', 'declining', 'faulty'] as const;
export type Evolution = (typeof EVOLUTIONS)[number];

export const SOURCES = ['manual', 'voice', 'chat'] as const;
export type TastingSource = (typeof SOURCES)[number];

export const SESSION_STATUSES = ['open', 'revealed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** A sample is selected for the blend target when at least half the votes are yes. */
export const SELECTED_YES_RATIO = 0.5;

export function isSubject(value: string): value is Subject {
  return (SUBJECTS as readonly string[]).includes(value);
}

export function isScoreScale(value: string): value is ScoreScale {
  return (SCORE_SCALES as readonly string[]).includes(value);
}

export function isFieldKind(value: string): value is FieldKind {
  return (FIELD_KINDS as readonly string[]).includes(value);
}

export function isDescriptorFamily(value: string): value is DescriptorFamily {
  return (DESCRIPTOR_FAMILIES as readonly string[]).includes(value);
}

export function isEvolution(value: string): value is Evolution {
  return (EVOLUTIONS as readonly string[]).includes(value);
}

export function isSource(value: string): value is TastingSource {
  return (SOURCES as readonly string[]).includes(value);
}

export function scoreMax(scale: ScoreScale): number {
  return scale === '0-10' ? 10 : 100;
}
