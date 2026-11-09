import rawLines from './bottled-lines.json' with { type: 'json' };
import { MANUAL_PRICE, NOT_FOR_SALE } from '../catalog/tariff-rules';

export const PHOTO_DATE = '2026-11-09';
/** Saldo de la foto. Anterior al arranque del libro (01/01/2027) para que una salida posterior no quede en negativo. */
export const OPENING_AT = '2026-11-09T11:00:00+01:00';

export type WineColor = 'blanco' | 'tinto' | 'rosado' | 'otro';
export type SlotKind = 'caja' | 'nicho' | 'jaulon' | 'palet';
export type PlacementState = 'packaged_labeled' | 'packaged_unlabeled' | 'empty';

export type BottledLine = {
  slot_kind: SlotKind;
  slot_code: string;
  niche_number: number | null;
  pallet_count: number | null;
  line_no: number;
  lot_code: string | null;
  wine_label: string;
  bottles: number;
  volume_ml: number;
  bottle_ml: number | null;
  abv: string | null;
  organic: boolean | null;
  color: WineColor | null;
  state: PlacementState;
  note: string | null;
  source_sheet: string;
  source_row: number;
  not_for_sale: boolean;
};

const KINDS = new Set<SlotKind>(['caja', 'nicho', 'jaulon', 'palet']);
const COLORS = new Set<WineColor>(['blanco', 'tinto', 'rosado', 'otro']);
const STATES = new Set<PlacementState>(['packaged_labeled', 'packaged_unlabeled', 'empty']);

function asLine(value: unknown, index: number): BottledLine {
  const row = value as Partial<BottledLine>;
  if (!row || !KINDS.has(row.slot_kind as SlotKind)) throw new Error(`Línea de envasado ${index} sin tipo`);
  const bottles = Number(row.bottles);
  const volume = Number(row.volume_ml);
  if (!Number.isInteger(bottles) || bottles < 0) throw new Error(`Botellas no enteras en ${row.wine_label}`);
  if (!Number.isInteger(volume) || volume < 0) throw new Error(`Mililitros no enteros en ${row.wine_label}`);
  const bottle = row.bottle_ml == null ? null : Number(row.bottle_ml);
  if (bottle != null && (!Number.isInteger(bottle) || bottle <= 0 || bottles === 0 || volume !== bottles * bottle)) {
    throw new Error(`El formato de ${row.wine_label} no cuadra`);
  }
  const color = row.color == null ? null : row.color;
  if (color != null && !COLORS.has(color)) throw new Error(`Color no válido en ${row.wine_label}`);
  if (!STATES.has(row.state as PlacementState)) throw new Error(`Estado no válido en ${row.wine_label}`);
  const label = String(row.wine_label ?? '');
  return {
    slot_kind: row.slot_kind as SlotKind,
    slot_code: String(row.slot_code),
    niche_number: row.niche_number == null ? null : Number(row.niche_number),
    pallet_count: row.pallet_count == null ? null : Number(row.pallet_count),
    line_no: Number(row.line_no),
    lot_code: row.lot_code == null || row.lot_code === '' ? null : String(row.lot_code),
    wine_label: label,
    bottles,
    volume_ml: volume,
    bottle_ml: bottle,
    abv: row.abv == null || row.abv === '' ? null : String(row.abv),
    organic: row.organic == null ? null : Boolean(row.organic),
    color,
    state: row.state as PlacementState,
    note: row.note == null || row.note === '' ? null : String(row.note),
    source_sheet: String(row.source_sheet),
    source_row: Number(row.source_row),
    not_for_sale: fold(label) === 'wineout',
  };
}

export function bottledLines(): BottledLine[] {
  return (rawLines as unknown[]).map(asLine);
}

export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function sumLines(lines: readonly BottledLine[], kind?: SlotKind): { bottles: number; volume_ml: number } {
  return lines.filter((line) => !kind || line.slot_kind === kind).reduce(
    (total, line) => ({ bottles: total.bottles + line.bottles, volume_ml: total.volume_ml + line.volume_ml }),
    { bottles: 0, volume_ml: 0 },
  );
}

/** Totales que imprime la hoja. TFRP suma 54 L de Llueve Llueve que la celda TOTAL no incluye. */
export const DECLARED = {
  cajas: { bottles: 4251, volume_ml: 3_134_250 },
  nichos: { bottles: 2138, volume_ml: 1_791_500 },
  jaulones: { bottles: 7705, volume_ml: 5_726_250 },
  bodega: { bottles: 14094, volume_ml: 10_652_000 },
  tfrp_sheet_cell: { bottles: 8394, volume_ml: 6_241_500 },
  tfrp_lines: { bottles: 8394, volume_ml: 6_295_500 },
} as const;

export type BarrelRow = {
  number: number;
  capacity_ml: number;
  fill_ml: number;
  wine: string | null;
  capacity_2024_ml: number | null;
};

export const BARRELS: BarrelRow[] = [
  { number: 1, capacity_ml: 500_000, fill_ml: 0, wine: null, capacity_2024_ml: 500_000 },
  { number: 2, capacity_ml: 225_000, fill_ml: 0, wine: null, capacity_2024_ml: 225_000 },
  { number: 3, capacity_ml: 225_000, fill_ml: 0, wine: null, capacity_2024_ml: 225_000 },
  { number: 4, capacity_ml: 500_000, fill_ml: 0, wine: null, capacity_2024_ml: 500_000 },
  { number: 5, capacity_ml: 500_000, fill_ml: 0, wine: null, capacity_2024_ml: 500_000 },
  { number: 6, capacity_ml: 500_000, fill_ml: 0, wine: null, capacity_2024_ml: 500_000 },
  { number: 7, capacity_ml: 300_000, fill_ml: 0, wine: null, capacity_2024_ml: 300_000 },
  { number: 8, capacity_ml: 300_000, fill_ml: 0, wine: null, capacity_2024_ml: 300_000 },
  { number: 10, capacity_ml: 500_000, fill_ml: 500_000, wine: 'MOLINERA', capacity_2024_ml: 500_000 },
  { number: 11, capacity_ml: 300_000, fill_ml: 0, wine: null, capacity_2024_ml: 300_000 },
  { number: 12, capacity_ml: 300_000, fill_ml: 300_000, wine: 'MEZCLA TINTO', capacity_2024_ml: 225_000 },
  { number: 13, capacity_ml: 300_000, fill_ml: 300_000, wine: 'MEZCLA TINTO', capacity_2024_ml: 300_000 },
  { number: 15, capacity_ml: 500_000, fill_ml: 0, wine: null, capacity_2024_ml: 500_000 },
  { number: 17, capacity_ml: 500_000, fill_ml: 0, wine: null, capacity_2024_ml: 500_000 },
  { number: 18, capacity_ml: 500_000, fill_ml: 500_000, wine: 'MERLOT', capacity_2024_ml: 500_000 },
  { number: 19, capacity_ml: 225_000, fill_ml: 225_000, wine: 'MEZCLA TINTO', capacity_2024_ml: 225_000 },
];

export const BARREL_GAP = {
  operational: BARRELS.map((row) => row.number),
  full_ml: BARRELS.reduce((sum, row) => sum + row.fill_ml, 0),
  missing_from_sheet: [9, 14, 16],
  inventory_2024: 'Barricas 1 a 19. La 14 y la 16 figuran a 0 L. Hay además Tinaja 1 y Tinaja 2 (225 L).',
  pedro_memory: 17,
  note: 'La hoja operativa lista 16 barricas (faltan 9, 14 y 16). El inventario de 2024 numera 1–19; si se dejan fuera la 14 y la 16 (volumen 0) quedan 17, que es la cifra que recuerda Pedro. La 9 estaba como vinagre en 2024 y no está en la hoja actual. La 12 pasa de 225 L (2024) a 300 L. No se crean la 9, la 14, la 16 ni las tinajas.',
} as const;

export const DEMIJOHNS = { units: 26, capacity_ml: 34_000, fill_ml: 26_000 } as const;
export const LEES = { code: 'LIAS', name: 'Depósito plástico lías', capacity_ml: 1_000_000, fill_ml: 936_000 } as const;

export const TFRP_STORAGE = {
  operator: 'TRANSPORTES FRIGORIFICOS RP, S.L.',
  taxId: 'B23376155',
  price: '7.20',
  countedPallets: 13,
  invoices: [
    { number: 'B-26-0913', date: '2026-08-31', billed: 12, amount: '86.40' },
    { number: 'B-26-1024', date: '2026-09-30', billed: 12, amount: '86.40' },
  ],
} as const;

export function requiredLots(): { wine: string; lot: string }[] {
  return [
    { wine: 'Demorado', lot: 'L2024' },
    ...MANUAL_PRICE.filter((row) => row.lot).map((row) => ({ wine: row.wine, lot: row.lot as string })),
    { wine: NOT_FOR_SALE.wine, lot: '0' },
  ];
}

export function isWineout(label: string): boolean {
  return fold(label) === fold(NOT_FOR_SALE.wine);
}
