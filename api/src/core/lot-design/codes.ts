/** Catálogo único. `settling` es el alias de `desfangado`. El carbón activo está prohibido en casa. */
export const PRACTICES = [
  { code: 'desfangado', name_es: 'Desfangado', intervention: true },
  { code: 'settling', name_es: 'Desfangado', intervention: true },
  { code: 'centrifugado', name_es: 'Centrifugado', intervention: true },
  { code: 'levaduras_comerciales', name_es: 'Levaduras comerciales', intervention: true },
  { code: 'estabilizacion_proteica', name_es: 'Estabilización proteica', intervention: true },
  { code: 'clarificacion', name_es: 'Clarificación', intervention: true },
  { code: 'filtracion', name_es: 'Filtración', intervention: true },
  { code: 'sulfitado', name_es: 'Sulfitado', intervention: true },
  { code: 'carbon_activo', name_es: 'Carbón activo', intervention: true },
  { code: 'sin_sulfitos_anadidos', name_es: 'Sin sulfitos añadidos', intervention: false },
  { code: 'sin_intervencion', name_es: 'Sin intervención', intervention: false },
] as const;

export const DESTINATIONS = ['reference', 'new_collection', 'pending'] as const;
export const VINIFICATIONS = ['blanco', 'tinto', 'rosado', 'orange', 'otro'] as const;
export const INOCULATIONS = ['espontanea', 'comercial'] as const;
export const AGING_METHODS = ['deposito', 'barrica', 'damajuana_intemperie', 'sin_crianza'] as const;

export const OP_TYPES = [
  'reception',
  'bulk_reception',
  'crushing_pressing',
  'fermentation_end',
  'racking',
  'blend',
  'filtration',
  'addition',
  'stabilization',
  'cleaning',
  'sampling',
  'bottling',
  'labeling',
  'loss',
  'destruction',
] as const;

export type DestinationKind = (typeof DESTINATIONS)[number];
export type Vinification = (typeof VINIFICATIONS)[number];
export type InoculationKind = (typeof INOCULATIONS)[number];
export type AgingMethod = (typeof AGING_METHODS)[number];
export type OpType = (typeof OP_TYPES)[number];

const OP_SET = new Set<string>(OP_TYPES);

export function isOpType(value: string): value is OpType {
  return OP_SET.has(value);
}
