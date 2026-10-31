export const ZONE_KINDS = ['elaboration', 'barrel_room', 'outdoor', 'bottle_store', 'other'] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const ZONE_LABELS: Record<ZoneKind, string> = {
  elaboration: 'Nave de elaboración',
  barrel_room: 'Sala de barricas',
  outdoor: 'Exterior / intemperie',
  bottle_store: 'Almacén de botellas',
  other: 'Otra',
};

export const HOLDER_KINDS = ['nicho', 'jaulon'] as const;
export type HolderKind = (typeof HOLDER_KINDS)[number];

export const HOLDER_LABELS: Record<HolderKind, string> = {
  nicho: 'nicho',
  jaulon: 'jaulón',
};

export const PACKAGED_STATES = ['packaged_unlabeled', 'packaged_labeled'] as const;
export type PackagedState = (typeof PACKAGED_STATES)[number];

export const OAK_ORIGINS = ['frances', 'americano', 'centroeuropeo', 'otro'] as const;
export type OakOrigin = (typeof OAK_ORIGINS)[number];

export const OAK_LABELS: Record<OakOrigin, string> = {
  frances: 'francés',
  americano: 'americano',
  centroeuropeo: 'centroeuropeo',
  otro: 'otro',
};

export const TOAST_LEVELS = ['ligero', 'medio', 'medio_plus', 'fuerte'] as const;
export type ToastLevel = (typeof TOAST_LEVELS)[number];

export const TOAST_LABELS: Record<ToastLevel, string> = {
  ligero: 'ligero',
  medio: 'medio',
  medio_plus: 'medio+',
  fuerte: 'fuerte',
};

export const BARREL_STATUSES = ['in_use', 'resting', 'to_retire', 'retired'] as const;
export type BarrelStatus = (typeof BARREL_STATUSES)[number];

export const BARREL_STATUS_LABELS: Record<BarrelStatus, string> = {
  in_use: 'en uso',
  resting: 'en reposo',
  to_retire: 'para retirar',
  retired: 'retirada',
};

export const OUTDOOR_AGING_LABEL = 'crianza a la intemperie';

/** Clave de saldo del soporte: mismo orden que el libro físico, con el soporte como recipiente. */
export interface HolderStockKey {
  ubicacion: string;
  recipiente: string;
  propietario: string;
  lote: string;
  producto: string;
  estado: string;
}

export function holderStockKey(parts: {
  location_id: string;
  holder_id: string;
  owner_entity_id: string;
  lot_id: string;
  product_id: string;
  product_state: string;
}): HolderStockKey {
  return {
    ubicacion: parts.location_id,
    recipiente: parts.holder_id,
    propietario: parts.owner_entity_id,
    lote: parts.lot_id,
    producto: parts.product_id,
    estado: parts.product_state,
  };
}
