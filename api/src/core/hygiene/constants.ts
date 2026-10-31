/** Nota fija: el destino del efluente se guarda, el requisito ambiental no está cerrado. */
export const EFFLUENT_PENDING = 'El requisito ambiental está PENDIENTE de confirmar.';

export const CHECKLIST_SETTING_KEY = 'hygiene.bottling_checklist_required';

export const DOSE_UNITS = ['g/hl', 'mg/l', 'g/l', 'pct', 'ml/l', 'ppm'] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

export const PROCEDURE_PURPOSES = ['cleaning', 'disinfection', 'both'] as const;
export type ProcedurePurpose = (typeof PROCEDURE_PURPOSES)[number];

export const EQUIPMENT_KINDS = [
  'bottler', 'filter', 'filter_housing', 'pump', 'press', 'destemmer', 'other',
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const VESSEL_KINDS = [
  'tank_storage', 'tank_fermenter', 'barrel', 'demijohn', 'ibc', 'other',
] as const;

export const APPLICABLE_CLASSES = [
  ...VESSEL_KINDS.filter((kind) => kind !== 'other'),
  ...EQUIPMENT_KINDS,
] as const;

export const CAPACITY_UNITS = ['ud', 'l', 'hl', 'ml', 'plates'] as const;

export const CONSUMABLE_KINDS = ['filter_plate', 'cleaning_product', 'other'] as const;
export type ConsumableKind = (typeof CONSUMABLE_KINDS)[number];

export const PLATE_GRADES = ['V00', 'V07', 'V13'] as const;
export type PlateGrade = (typeof PLATE_GRADES)[number];

export const PLATE_GRADE_LABEL: Record<PlateGrade, string> = {
  V00: 'V00 desbaste',
  V07: 'V07 intermedia',
  V13: 'V13 amicróbica',
};

export const CLOSURE_TYPES = ['natural_cork', 'agglomerated_cork'] as const;
export type ClosureType = (typeof CLOSURE_TYPES)[number];

export const SEAL_TYPES = ['capsule', 'wax_seal'] as const;
export type SealType = (typeof SEAL_TYPES)[number];

export const CLOSURE_LABEL: Record<ClosureType, string> = {
  natural_cork: 'corcho natural',
  agglomerated_cork: 'corcho aglomerado',
};

export const SEAL_LABEL: Record<SealType, string> = {
  capsule: 'cápsula',
  wax_seal: 'lacre',
};

export const EQUIPMENT_ROLES = ['used', 'cleaned'] as const;
