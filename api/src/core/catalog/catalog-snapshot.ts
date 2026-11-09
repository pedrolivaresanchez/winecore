/** Catálogo real: tarifas 2026/2027/ECI 2025 y referencias del stock. No incluye lo importado de Holded. */

export type CatalogWine = {
  sku: string;
  wine: string;
  wineCode: string;
  name: string;
  vintage: number | null;
  formatMl: number;
  color: 'red' | 'white' | 'rose' | 'other';
  organic: boolean;
  abv: string | null;
  lot: string | null;
  forSale: boolean;
  priced: boolean;
};

export const CATALOG_WINES: CatalogWine[] = [
  { sku: 'EJT2024', wine: 'Jaén Tinta', wineCode: 'JAEN-TINTA', name: 'Jaén Tinta 2024', vintage: 2024, formatMl: 750, color: 'red', organic: true, abv: '13.00', lot: 'EJT2024', forSale: true, priced: true },
  { sku: 'JAEN-2022', wine: 'Jaén Tinta', wineCode: 'JAEN-TINTA', name: 'Jaén Tinta 2022', vintage: 2022, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: true, priced: true },
  { sku: 'ECLO-2022', wine: 'ECLO', wineCode: 'ECLO', name: 'ECLO 2022', vintage: 2022, formatMl: 750, color: 'red', organic: true, abv: '15.00', lot: null, forSale: true, priced: true },
  { sku: 'EE2024', wine: 'ECLO', wineCode: 'ECLO', name: 'Eclo 2024', vintage: 2024, formatMl: 750, color: 'red', organic: true, abv: '15.00', lot: 'EE2024', forSale: true, priced: false },
  { sku: 'ECLO-2020', wine: 'ECLO', wineCode: 'ECLO', name: 'ECLO 2020', vintage: 2020, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: true, priced: true },
  { sku: 'E202122', wine: 'enTreDicho', wineCode: 'ENTREDICHO', name: 'enTreDicho 2021-22', vintage: 2021, formatMl: 750, color: 'red', organic: true, abv: '14.50', lot: 'E202122', forSale: true, priced: true },
  { sku: 'ENT-2324', wine: 'enTreDicho', wineCode: 'ENTREDICHO', name: 'enTreDicho 23-24', vintage: 2023, formatMl: 750, color: 'red', organic: true, abv: '14.50', lot: '202324', forSale: true, priced: false },
  { sku: 'ENB2022', wine: 'Nebbia', wineCode: 'NEBBIA', name: 'Nebbia 2022', vintage: 2022, formatMl: 750, color: 'red', organic: true, abv: '14.00', lot: 'ENB2022', forSale: true, priced: true },
  { sku: 'APANAO-2024', wine: 'Apañao', wineCode: 'APANAO', name: 'Apañao 2024', vintage: 2024, formatMl: 750, color: 'red', organic: true, abv: '14.00', lot: null, forSale: true, priced: true },
  { sku: 'EN2025', wine: 'Apañao', wineCode: 'APANAO', name: 'Apañao 2025', vintage: 2025, formatMl: 750, color: 'red', organic: true, abv: '14.00', lot: 'EN2025', forSale: true, priced: false },
  { sku: 'EMOL2023', wine: 'Molinera', wineCode: 'MOLINERA', name: 'Molinera 2023', vintage: 2023, formatMl: 750, color: 'red', organic: false, abv: '12.00', lot: 'EMOL2023', forSale: true, priced: true },
  { sku: 'L2024', wine: 'Demorado', wineCode: 'DEMORADO', name: 'Demorado 2024', vintage: 2024, formatMl: 500, color: 'red', organic: true, abv: '15.50', lot: 'L2024', forSale: true, priced: true },
  { sku: 'SAP2022', wine: 'CHEMIC', wineCode: 'CHEMIC', name: 'CHEMIC 2022', vintage: 2022, formatMl: 500, color: 'red', organic: false, abv: '14.50', lot: 'SAP2022', forSale: true, priced: true },
  { sku: 'PARRAS-2025', wine: 'Código de Parras', wineCode: 'PARRAS', name: 'Código de Parras 2025', vintage: 2025, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: true, priced: true },
  { sku: 'EB2023', wine: 'Bobal serie Wild', wineCode: 'BOBAL-WILD', name: 'Bobal wild 2023', vintage: 2023, formatMl: 750, color: 'red', organic: true, abv: '14.50', lot: 'EB2023', forSale: true, priced: true },
  { sku: 'BOBAL-WILD-2021', wine: 'Bobal serie Wild', wineCode: 'BOBAL-WILD', name: 'Bobal serie Wild 2021', vintage: 2021, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: true, priced: true },
  { sku: 'EBO2024', wine: 'Bobal Basic', wineCode: 'BOBAL-BASIC', name: 'Bobal basic 2024', vintage: 2024, formatMl: 750, color: 'red', organic: true, abv: '14.00', lot: 'EBO2024', forSale: true, priced: true },
  { sku: 'ARCAL-2023', wine: 'Arcal', wineCode: 'ARCAL', name: 'Arcal 2023', vintage: 2023, formatMl: 750, color: 'white', organic: true, abv: '13.00', lot: '2023', forSale: true, priced: true },
  { sku: 'EMUS23', wine: 'La Muscat', wineCode: 'MUSCAT', name: 'La Muscat blanc d’Argila 2023', vintage: 2023, formatMl: 750, color: 'white', organic: true, abv: '12.50', lot: 'EMUS23', forSale: true, priced: true },
  { sku: 'XPO-2016', wine: 'Interaction', wineCode: 'XPO', name: 'XPO Interaction 2016', vintage: 2016, formatMl: 750, color: 'white', organic: true, abv: '15.50', lot: 'L2021/E1001', forSale: true, priced: true },
  { sku: 'LEO22023', wine: 'La Gran Oxidación', wineCode: 'OXIDACION', name: 'La Gran Oxidación O2 2023', vintage: 2023, formatMl: 500, color: 'white', organic: false, abv: '15.00', lot: 'LEO22023', forSale: true, priced: true },
  { sku: 'BOBASTRELL-2022', wine: 'Bobastrell', wineCode: 'BOBASTRELL', name: 'Bobastrell 2022', vintage: 2022, formatMl: 750, color: 'red', organic: true, abv: '14.50', lot: null, forSale: true, priced: true },
  { sku: 'ELL2025', wine: 'Llueve Llueve', wineCode: 'LLUEVE', name: 'Llueve Llueve 2025', vintage: 2025, formatMl: 750, color: 'white', organic: true, abv: '13.50', lot: 'ELL2025', forSale: true, priced: false },
  { sku: 'EGP2023', wine: 'Garnacha Pirotécnica', wineCode: 'GARNACHA-P', name: 'Garnacha Pirotécnica 2023', vintage: 2023, formatMl: 750, color: 'red', organic: true, abv: '13.00', lot: 'EGP2023', forSale: true, priced: false },
  { sku: 'MELOS-2019', wine: 'Melós', wineCode: 'MELOS', name: 'Melós 2019', vintage: 2019, formatMl: 750, color: 'red', organic: true, abv: '15.00', lot: '2019', forSale: true, priced: false },
  { sku: 'BURRO', wine: 'El burro de las gaseosas', wineCode: 'BURRO', name: 'El burro de las gaseosas', vintage: null, formatMl: 750, color: 'red', organic: true, abv: '13.50', lot: null, forSale: true, priced: false },
  { sku: 'EEB2024', wine: 'La Maison du Peter', wineCode: 'MAISON-PETER', name: 'La Maison du Peter 2024', vintage: 2024, formatMl: 750, color: 'red', organic: true, abv: '12.50', lot: 'EEB2024', forSale: true, priced: false },
  { sku: 'WINEOUT', wine: 'WINEOUT', wineCode: 'WINEOUT', name: 'WINEOUT', vintage: null, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: false, priced: false },
  { sku: 'APLATINAO', wine: 'Aplatinao', wineCode: 'APLATINAO', name: 'Aplatinao', vintage: 2014, formatMl: 750, color: 'red', organic: true, abv: '14.50', lot: 'LAT2025', forSale: true, priced: false },
  { sku: 'BOBAL-PLUS-2019', wine: 'Bobal Plus', wineCode: 'BOBAL-PLUS', name: 'Bobal Plus 2019', vintage: 2019, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: true, priced: false },
  { sku: 'ENT-FT-2016', wine: 'enTreDicho Ft', wineCode: 'ENTREDICHO', name: 'enTreDicho Ft 2016', vintage: 2016, formatMl: 750, color: 'red', organic: true, abv: null, lot: null, forSale: true, priced: false },
  { sku: 'LEM2023', wine: 'La Gran Oxidación', wineCode: 'OXIDACION', name: 'La Gran Oxidación O1', vintage: 2023, formatMl: 500, color: 'white', organic: true, abv: '14.50', lot: 'LEM2023', forSale: true, priced: false },
];

export const EXTRA_LOTS = ['LAB2025', 'LAT2025'] as const;
