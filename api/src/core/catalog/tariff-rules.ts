/**
 * Decisiones de Pedro (nov 2026) sobre tarifas y vinos que no se tasan.
 * Los precios salen de Docs/TIMBAL/TARIFAS y del fichero ECI. No se inventan.
 * Demorado: los PDF de cliente, tienda y restaurante imprimen 2023; la añada
 * vigente en todas las tarifas es 2024, lote L2024. Distribución ya dice 2024.
 */

export const DEMORADO = {
  name: 'Demorado',
  vintage: 2024,
  lot: 'L2024',
  formatMl: 500,
  note: 'Añada vigente 2024 (lote L2024) en todas las tarifas. CLIENTE, TIENDA y RESTAURANTE imprimen 2023; no se usa esa añada.',
} as const;

export type TariffLine = {
  list: 'final' | 'shop' | 'distributor' | 'custom-horeca' | 'custom-eci' | 'custom-pyrene';
  wine: string;
  vintage: number | null;
  vintageLabel: string;
  price: string;
  currency: 'EUR';
  lot: string | null;
  formatMl: number | null;
  pdfVintage: number | null;
};

const CHANNELS = [
  { list: 'final' as const, demorado: '30.00', demoradoPdf: 2023 },
  { list: 'shop' as const, demorado: '20.46', demoradoPdf: 2023 },
  { list: 'custom-horeca' as const, demorado: '22.00', demoradoPdf: 2023 },
  { list: 'distributor' as const, demorado: '16.00', demoradoPdf: 2024 },
];

/** Líneas comunes de los PDF 2026. El precio de Demorado cambia; la añada no. */
const SHARED: Omit<TariffLine, 'list' | 'price'>[] = [
  { wine: 'Jaén Tinta', vintage: 2024, vintageLabel: '2024', currency: 'EUR', lot: 'EJT2024', formatMl: 750, pdfVintage: 2024 },
  { wine: 'ECLO', vintage: 2022, vintageLabel: '2022', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2022 },
  { wine: 'enTreDicho', vintage: 2021, vintageLabel: '2021-22', currency: 'EUR', lot: 'E202122', formatMl: 750, pdfVintage: null },
  { wine: 'Nebbia', vintage: 2022, vintageLabel: '2022', currency: 'EUR', lot: 'ENB2022', formatMl: 750, pdfVintage: 2022 },
  { wine: 'Apañao', vintage: 2024, vintageLabel: '2024', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2024 },
  { wine: 'Molinera', vintage: 2023, vintageLabel: '2023', currency: 'EUR', lot: 'EMOL2023', formatMl: 750, pdfVintage: 2023 },
  { wine: 'Demorado', vintage: 2024, vintageLabel: '2024', currency: 'EUR', lot: 'L2024', formatMl: 500, pdfVintage: null },
  { wine: 'CHEMIC', vintage: 2022, vintageLabel: '2022', currency: 'EUR', lot: 'sap2022', formatMl: 500, pdfVintage: 2022 },
  { wine: 'Código de Parras', vintage: 2025, vintageLabel: '2025', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2025 },
  { wine: 'Bobal serie Wild', vintage: 2023, vintageLabel: '2023', currency: 'EUR', lot: 'EB2023', formatMl: 750, pdfVintage: 2023 },
  { wine: 'Bobal Basic', vintage: 2024, vintageLabel: '2024', currency: 'EUR', lot: 'EBO2024', formatMl: 750, pdfVintage: 2024 },
  { wine: 'Arcal', vintage: 2023, vintageLabel: '2023', currency: 'EUR', lot: '2023', formatMl: 750, pdfVintage: 2023 },
  { wine: 'La Muscat', vintage: 2023, vintageLabel: '2023', currency: 'EUR', lot: 'EMUS23', formatMl: 750, pdfVintage: 2023 },
  { wine: 'Interaction', vintage: 2016, vintageLabel: '2016', currency: 'EUR', lot: 'L2021/E1001', formatMl: 750, pdfVintage: 2016 },
  { wine: 'La Gran Oxidación', vintage: 2023, vintageLabel: '2023', currency: 'EUR', lot: 'LEO22023', formatMl: 500, pdfVintage: 2023 },
];

const PRICES: Record<string, Record<(typeof CHANNELS)[number]['list'], string>> = {
  'Jaén Tinta': { final: '40.00', shop: '28.83', 'custom-horeca': '31.00', distributor: '23.45' },
  ECLO: { final: '32.00', shop: '22.32', 'custom-horeca': '24.00', distributor: '18.00' },
  enTreDicho: { final: '15.00', shop: '10.32', 'custom-horeca': '11.10', distributor: '8.40' },
  Nebbia: { final: '105.00', shop: '79.05', 'custom-horeca': '85.00', distributor: '64.00' },
  Apañao: { final: '12.50', shop: '8.22', 'custom-horeca': '8.30', distributor: '6.30' },
  Molinera: { final: '12.00', shop: '9.23', 'custom-horeca': '9.92', distributor: '7.35' },
  Demorado: { final: '30.00', shop: '20.46', 'custom-horeca': '22.00', distributor: '16.00' },
  CHEMIC: { final: '30.00', shop: '20.46', 'custom-horeca': '22.00', distributor: '16.00' },
  'Código de Parras': { final: '12.00', shop: '9.30', 'custom-horeca': '10.00', distributor: '7.35' },
  'Bobal serie Wild': { final: '15.00', shop: '10.42', 'custom-horeca': '11.21', distributor: '8.60' },
  'Bobal Basic': { final: '12.50', shop: '8.22', 'custom-horeca': '8.30', distributor: '6.30' },
  Arcal: { final: '18.00', shop: '12.56', 'custom-horeca': '13.50', distributor: '9.90' },
  'La Muscat': { final: '14.00', shop: '9.92', 'custom-horeca': '10.67', distributor: '7.90' },
  Interaction: { final: '205.00', shop: '162.75', 'custom-horeca': '175.00', distributor: '130.00' },
  'La Gran Oxidación': { final: '48.00', shop: '38.92', 'custom-horeca': '41.85', distributor: '31.00' },
};

export function channelTariffLines(): TariffLine[] {
  const lines: TariffLine[] = [];
  for (const channel of CHANNELS) {
    for (const row of SHARED) {
      const price = PRICES[row.wine]?.[channel.list];
      if (!price) continue;
      lines.push({
        ...row,
        list: channel.list,
        price,
        pdfVintage: row.wine === 'Demorado' ? channel.demoradoPdf : row.pdfVintage,
      });
    }
  }
  return lines;
}

/** Les Caves de Pyrène 2027. El Excel está en euros aunque el cliente sea de Reino Unido. */
export const PYRENE_LINES: TariffLine[] = [
  { list: 'custom-pyrene', wine: 'Bobastrell', vintage: 2022, vintageLabel: '2022', price: '6.00', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2022 },
  { list: 'custom-pyrene', wine: 'La Muscat', vintage: 2023, vintageLabel: '2023', price: '6.75', currency: 'EUR', lot: 'EMUS23', formatMl: 750, pdfVintage: 2023 },
  { list: 'custom-pyrene', wine: 'Demorado', vintage: 2024, vintageLabel: '2024', price: '13.00', currency: 'EUR', lot: 'L2024', formatMl: 500, pdfVintage: 2024 },
  { list: 'custom-pyrene', wine: 'Arcal', vintage: 2023, vintageLabel: '2023', price: '9.00', currency: 'EUR', lot: '2023', formatMl: 750, pdfVintage: 2023 },
  { list: 'custom-pyrene', wine: 'Bobal Basic', vintage: 2024, vintageLabel: '2024', price: '6.00', currency: 'EUR', lot: 'EBO2024', formatMl: 750, pdfVintage: 2024 },
];

/**
 * Plantilla ECI Gourmet 2025 (5 líneas). El precio de tarifa es el coste neto.
 * El PVP de ECI no es el de cliente final 2026. Pedro ampliará la lista después.
 */
export const ECI_LINES: TariffLine[] = [
  { list: 'custom-eci', wine: 'enTreDicho', vintage: 2021, vintageLabel: '2021', price: '9.75', currency: 'EUR', lot: 'E202122', formatMl: 750, pdfVintage: 2021 },
  { list: 'custom-eci', wine: 'Bobal serie Wild', vintage: 2021, vintageLabel: '2021', price: '9.10', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2021 },
  { list: 'custom-eci', wine: 'Arcal', vintage: 2023, vintageLabel: '2023', price: '10.50', currency: 'EUR', lot: '2023', formatMl: 750, pdfVintage: 2023 },
  { list: 'custom-eci', wine: 'Jaén Tinta', vintage: 2022, vintageLabel: '2022', price: '22.00', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2022 },
  { list: 'custom-eci', wine: 'ECLO', vintage: 2020, vintageLabel: '2020', price: '18.25', currency: 'EUR', lot: null, formatMl: 750, pdfVintage: 2020 },
];

/** El Excel de Les Caves no dice la moneda. Se guarda en EUR y queda marcado para que Pedro lo confirme. */
export const CAVES_CURRENCY_UNSTATED = true;

/**
 * El PDF dice «Bobal serie Wild» y la ficha de EB2023 se llama «Bobal wild».
 * Apañao 2024 no entra: hay dos productos y lo decide Pedro.
 */
export const WINE_NAME_ALIASES: Record<string, readonly string[]> = {
  'Bobal serie Wild': ['Bobal wild'],
};

export const TARIFF_LINES: TariffLine[] = [...channelTariffLines(), ...PYRENE_LINES, ...ECI_LINES];

export const MANUAL_PRICE = [
  { wine: 'Llueve Llueve', lot: 'ELL2025', vintage: 2025, reason: 'Está en la web y en el stock (2025). No está en las tarifas 2026.' },
  { wine: 'enTreDicho Ft', lot: null, vintage: 2016, reason: 'En la web a 38,00 € (2016). No está en las tarifas 2026 ni en la plantilla ECI 2025.' },
  { wine: 'Bobal Plus', lot: null, vintage: 2019, reason: 'En la web a 30,00 € (2019). No está en las tarifas 2026 ni en la plantilla ECI 2025.' },
  { wine: 'Aplatinao', lot: 'LAT2025', vintage: null, reason: 'No tiene tarifa. En el nicho 8 hay 54 botellas y 45 L, sin formato entero.' },
  { wine: 'Melós', lot: '2019', vintage: 2019, reason: 'Queda muy poco. Precio manual. Hay que asignarlo al lote 2019.' },
  { wine: 'Garnacha Pirotécnica', lot: 'EGP2023', vintage: 2023, reason: 'Queda muy poco. Precio manual. Hay que asignarlo al lote EGP2023.' },
] as const;

export const NOT_FOR_SALE = {
  wine: 'WINEOUT',
  reason: 'Vino ligeramente defectuoso. Sigue en stock hasta que se dé de baja. No se vende y no tiene tarifa.',
} as const;

export const LIST_NAMES: Record<TariffLine['list'], { name: string; currency: 'EUR' }> = {
  final: { name: 'Cliente final 2026', currency: 'EUR' },
  shop: { name: 'Tienda 2026', currency: 'EUR' },
  distributor: { name: 'Distribución 2026', currency: 'EUR' },
  'custom-horeca': { name: 'Restaurante 2026', currency: 'EUR' },
  'custom-eci': { name: 'El Corte Inglés', currency: 'EUR' },
  'custom-pyrene': { name: 'Les Caves de Pyrène 2027', currency: 'EUR' },
};

export const TAX_INCLUDED_LISTS = new Set<TariffLine['list']>(['final']);

export function demoradoLines(): TariffLine[] {
  return TARIFF_LINES.filter((line) => line.wine === 'Demorado');
}
